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
  let storage: { loadSnapshot: ReturnType<typeof vi.fn>; loadReadNotificationIds: ReturnType<typeof vi.fn>; loadToolUpdate: ReturnType<typeof vi.fn>; addBorrowRequest: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    window.localStorage.setItem('shed-theme-mode', 'light');
    vi.stubGlobal('Notification', { permission: 'default' });
    currentUser = signal<UserProfile | null>(user);
    dialogOpen = vi.fn().mockImplementation(() => ({
      componentInstance: { submitRequested: new Subject(), saving: () => false, setSaving: vi.fn() },
      afterClosed: () => new Subject(), close: vi.fn(),
    }));
    sheetOpen = vi.fn().mockImplementation(() => ({ afterDismissed: () => new Subject(), dismiss: vi.fn() }));
    storage = { loadSnapshot: vi.fn().mockResolvedValue(empty()), loadReadNotificationIds: vi.fn().mockResolvedValue(new Set()), loadToolUpdate: vi.fn(), addBorrowRequest: vi.fn().mockResolvedValue(undefined) };
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
    await harness.navigateByUrl('/shed');
    expect(sheetOpen.mock.results[0].value.dismiss).toHaveBeenCalled();
    expect(dialogOpen.mock.results[0].value.close).toHaveBeenCalled();
  });
});
