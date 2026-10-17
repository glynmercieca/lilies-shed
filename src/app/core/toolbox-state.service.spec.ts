import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app.routes';
import { ToolboxStateService } from './toolbox-state.service';
import { FirestoreToolboxService } from './firestore-toolbox.service';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { ImageUploadService } from './image-upload.service';
import { SheetsSnapshot, UserProfile } from './models';
import { NetworkStatusService } from './network-status.service';

const user: UserProfile = { id: 'borrower', email: 'b@example.com', name: 'Ben', firstName: 'Ben', lastName: '', picture: '' };
const empty = (): SheetsSnapshot => ({ categories: [], tools: [], loans: [], notifications: [] });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => resolve = done); return { promise, resolve }; };

describe('toolbox refresh and targeted mutations', () => {
  let currentUser: ReturnType<typeof signal<UserProfile | null>>;
  let service: ToolboxStateService;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let sheetOpen: ReturnType<typeof vi.fn>;
  let storage: { loadSnapshot: ReturnType<typeof vi.fn>; loadReadNotificationIds: ReturnType<typeof vi.fn>; loadToolUpdate: ReturnType<typeof vi.fn>; addBorrowRequest: ReturnType<typeof vi.fn>; watchToolChanges: ReturnType<typeof vi.fn>; watchNotifications: ReturnType<typeof vi.fn>; watchReadNotificationIds: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    window.localStorage.setItem('shed-theme-mode', 'light');
    vi.stubGlobal('Notification', { permission: 'default' });
    currentUser = signal<UserProfile | null>(user);
    dialogOpen = vi.fn().mockImplementation(() => ({
      componentInstance: { submitRequested: new Subject(), saving: () => false, setSaving: vi.fn() },
      afterClosed: () => new Subject(), close: vi.fn(),
    }));
    sheetOpen = vi.fn().mockImplementation(() => ({ instance: { tool: signal(null) }, afterDismissed: () => new Subject(), dismiss: vi.fn() }));
    storage = { loadSnapshot: vi.fn().mockResolvedValue(empty()), loadReadNotificationIds: vi.fn().mockResolvedValue(new Set()), loadToolUpdate: vi.fn(), addBorrowRequest: vi.fn().mockResolvedValue(undefined), watchToolChanges: vi.fn().mockReturnValue(vi.fn()), watchNotifications: vi.fn().mockReturnValue(vi.fn()), watchReadNotificationIds: vi.fn().mockReturnValue(vi.fn()) };
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideNoopAnimations(),
      { provide: FirebaseAuthService, useValue: { currentUser, ensureValidSession: async () => Boolean(currentUser()), isConfigured: () => true, isBusy: () => false, error: () => null } },
      { provide: FirestoreToolboxService, useValue: storage },
      { provide: FirebaseMessagingService, useValue: { syncCurrentUser: vi.fn() } },
      { provide: ImageUploadService, useValue: {} },
      { provide: MatDialog, useValue: { open: dialogOpen } }, { provide: MatBottomSheet, useValue: { open: sheetOpen } },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
    ] });
    service = TestBed.inject(ToolboxStateService);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.removeItem('shed-theme-mode'); });

  it('coalesces overlapping refreshes, including sign-in effect, into one load', async () => {
    const pending = deferred<SheetsSnapshot>();
    storage.loadSnapshot.mockReturnValue(pending.promise);
    const first = service.refresh();
    const second = service.refresh();
    TestBed.tick();
    await Promise.resolve();
    expect(storage.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(storage.loadReadNotificationIds).toHaveBeenCalledTimes(1);
    pending.resolve(empty());
    await Promise.all([first, second]);
    expect(service.loading()).toBe(false);
  });

  it('discards an old account snapshot after the signed-in user changes', async () => {
    const pending = deferred<SheetsSnapshot>();
    storage.loadSnapshot.mockReturnValue(pending.promise);
    const refresh = service.refresh();
    await Promise.resolve();
    currentUser.set(null);
    pending.resolve({ ...empty(), categories: [{ id: 'private', name: 'Old session', order: 1 }] });
    await refresh;
    expect(service.categories().some((category) => category.id === 'private')).toBe(false);
  });

  it('sorts date-added by creation time rather than random IDs, with stable legacy fallbacks', async () => {
    const base = { documentId: 'tool', id: '', name: 'Tool', categoryId: 'other', categoryName: 'Other', description: '', notes: '', deleted: false, ownerId: 'owner', owner: '', ownerEmail: '', ownerFirstName: '', ownerLastName: '', image: '' };
    storage.loadSnapshot.mockResolvedValue({ ...empty(), tools: [
      { ...base, id: 'zz-random', createdAt: '2026-10-01T10:00:00Z' },
      { ...base, id: '100002' },
      { ...base, id: 'aa-random', createdAt: '2026-10-17T10:00:00Z' },
      { ...base, id: '100001', createdAt: 'invalid' },
      { ...base, id: 'bb-random', createdAt: '2026-10-17T10:00:00Z' },
    ] });
    await service.refresh();
    expect(service.filteredTools().map(tool => tool.id)).toEqual([
      'bb-random', 'aa-random', 'zz-random', '100002', '100001',
    ]);
    service.setToolSortMode('name');
    expect(service.filteredTools()).toHaveLength(5);
  });

  it('refreshes only the borrowed tool while keeping search, categories and borrowed counts current', async () => {
    const tool = { documentId: 'tool', id: '100000', name: 'Drill', categoryId: 'power-tools', categoryName: 'Power tools', description: '', notes: '', deleted: false, ownerId: 'owner', owner: 'Olivia', ownerEmail: '', ownerFirstName: 'Olivia', ownerLastName: '', image: '', activeLoanId: null };
    storage.loadSnapshot.mockResolvedValue({ ...empty(), tools: [tool] });
    await service.refresh();
    const loan = { id: 'loan', itemId: 'tool', borrowerId: user.id, borrower: 'Ben', borrowerEmail: user.email, borrowerFirstName: 'Ben', borrowerLastName: '', loanDate: '2026-10-17', returnDate: '' };
    storage.loadToolUpdate.mockResolvedValue({ tools: [{ ...tool, activeLoanId: 'loan' }], loans: [loan] });
    expect(await service.borrowTool(service.tools()[0])).toBe(true);
    expect(storage.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(storage.loadToolUpdate).toHaveBeenCalledWith('tool');
    expect(service.borrowedTools()).toHaveLength(1);
    expect(service.filteredTools()).toHaveLength(0);
    service.toggleUnavailableTools();
    service.setSearchTerm('Olivia');
    service.setSelectedCategory('power-tools');
    expect(service.filteredTools()).toHaveLength(1);
    expect(service.tools()[0].latestLoan?.id).toBe('loan');
    const navigatorOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    expect(TestBed.inject(NetworkStatusService).online()).toBe(false);
    expect(await service.borrowTool({ ...service.tools()[0], available: true })).toBe(false);
    expect(storage.addBorrowRequest).toHaveBeenCalledTimes(1);
    TestBed.tick();
    navigatorOnline.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    TestBed.tick();
    await vi.waitFor(() => expect(storage.loadSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(TestBed.inject(NetworkStatusService).availabilityVerified()).toBe(true));
    storage.loadSnapshot.mockRejectedValueOnce(new Error('Server unavailable'));
    await service.refresh();
    expect(TestBed.inject(NetworkStatusService).availabilityVerified()).toBe(false);
  });

  it('renders lazy secondary pages, preserves query parameters and redirects protected deep links', async () => {
    const harness = await RouterTestingHarness.create();
    for (const path of ['/shed', '/borrowed', '/my-tools', '/options', '/about', '/privacy']) {
      await harness.navigateByUrl(path);
      expect(harness.routeNativeElement?.textContent?.trim().length).toBeGreaterThan(0);
    }
    await harness.navigateByUrl('/shed?dialog=add-tool');
    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1));
    TestBed.tick();
    expect(dialogOpen).toHaveBeenCalledTimes(1);
    await harness.navigateByUrl('/shed');
    await harness.navigateByUrl('/options?dialog=request-tool');
    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(2));
    currentUser.set(null);
    await harness.navigateByUrl('/borrowed?sheet=borrowed-stats');
    const router = TestBed.inject(Router);
    expect(router.url).toContain('/home');
    expect(router.parseUrl(router.url).queryParamMap.get('returnUrl')).toBe('/borrowed?sheet=borrowed-stats');
  });

  it('opens a lazy tool sheet and image-preview deep link once, and closes both on navigation', async () => {
    storage.loadSnapshot.mockResolvedValue({ ...empty(), tools: [{
      documentId: 'tool', id: '100000', name: 'Drill', categoryId: 'other', categoryName: 'Other', description: '', notes: '', deleted: false, ownerId: 'owner', owner: 'Olivia', ownerEmail: '', ownerFirstName: 'Olivia', ownerLastName: '', image: '/drill.jpg',
    }] });
    const harness = await RouterTestingHarness.create();
    await service.refresh();
    await harness.navigateByUrl('/shed?sheet=tool&mode=shed&toolId=tool&preview=tool-image');
    await vi.waitFor(() => {
      expect(sheetOpen).toHaveBeenCalledTimes(1);
      expect(dialogOpen).toHaveBeenCalledTimes(1);
    });
    TestBed.tick();
    expect(sheetOpen.mock.calls[0][1].data.tool.name).toBe('Drill');
    expect(dialogOpen.mock.calls[0][1].data.image).toBe('/drill.jpg');
    const changed = { ...service.tools()[0], name: 'Updated drill', activeLoanId: 'someone-else' };
    storage.loadToolUpdate.mockResolvedValue({ tools: [changed], loans: [] });
    storage.watchToolChanges.mock.calls[0][1](['tool']);
    await vi.waitFor(() => expect(sheetOpen.mock.results[0].value.instance.tool().name).toBe('Updated drill'));
    expect(sheetOpen).toHaveBeenCalledOnce();
    expect(service.tools()[0].available).toBe(false);
    await harness.navigateByUrl('/shed');
    expect(sheetOpen.mock.results[0].value.dismiss).toHaveBeenCalled();
    expect(dialogOpen.mock.results[0].value.close).toHaveBeenCalled();
  });

  it('refreshes changed tools without resetting paging and releases the listener on sign-out', async () => {
    TestBed.tick();
    await service.refresh();
    service.showMoreFilteredTools();
    storage.loadToolUpdate.mockResolvedValue({ tools: [], loans: [] });
    const callback = storage.watchToolChanges.mock.calls[0][1];
    callback(['removed']);
    await vi.waitFor(() => expect(storage.loadToolUpdate).toHaveBeenCalledWith('removed'));
    expect(service.shedVisibleCount()).toBe(36);
    const stop = storage.watchToolChanges.mock.results[0].value;
    currentUser.set(null);
    TestBed.tick();
    expect(stop).toHaveBeenCalledOnce();
    callback(['old-session']);
    await Promise.resolve();
    expect(storage.loadToolUpdate).not.toHaveBeenCalledWith('old-session');
  });

  it('refreshes on returning to the visible app, while throttling repeated focus events', async () => {
    TestBed.tick();
    await service.refresh();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(storage.loadSnapshot).toHaveBeenCalledTimes(2));
    await service.refresh();
    const count = storage.loadSnapshot.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(storage.loadSnapshot).toHaveBeenCalledTimes(count);
  });

  it('keeps inventory and filtered-list references stable when notifications and read marks change', async () => {
    await service.refresh();
    const tools = service.tools(), filtered = service.filteredTools(), categories = service.categories();
    service.startNotificationsLiveRefresh();
    storage.watchNotifications.mock.calls[0][1]([{ id: 'notice', recipientId: user.id, title: 'Borrowed', message: 'Drill borrowed', type: 'borrow', actorUserId: 'owner', actorFirstName: 'Alice', createdAt: '2026-10-17T10:00:00Z' }]);
    expect(service.unreadNotificationCount()).toBe(1);
    storage.watchReadNotificationIds.mock.calls[0][1](new Set(['notice']));
    expect(service.unreadNotificationCount()).toBe(0);
    expect(service.recentNotifications()[0].read).toBe(true);
    expect(service.tools()).toBe(tools);
    expect(service.filteredTools()).toBe(filtered);
    expect(service.categories()).toBe(categories);
  });
});
