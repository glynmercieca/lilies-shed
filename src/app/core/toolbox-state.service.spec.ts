import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolboxStateService } from './toolbox-state.service';
import { FirestoreToolboxService } from './firestore-toolbox.service';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { ImageUploadService } from './image-upload.service';
import { SheetsSnapshot, UserProfile } from './models';

const user: UserProfile = { id: 'borrower', email: 'b@example.com', name: 'Ben', firstName: 'Ben', lastName: '', picture: '' };
const empty = (): SheetsSnapshot => ({ categories: [], tools: [], loans: [], notifications: [] });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => resolve = done); return { promise, resolve }; };

describe('toolbox refresh and targeted mutations', () => {
  let currentUser: ReturnType<typeof signal<UserProfile | null>>;
  let service: ToolboxStateService;
  let storage: { loadSnapshot: ReturnType<typeof vi.fn>; loadReadNotificationIds: ReturnType<typeof vi.fn>; loadToolUpdate: ReturnType<typeof vi.fn>; addBorrowRequest: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    currentUser = signal<UserProfile | null>(user);
    storage = { loadSnapshot: vi.fn().mockResolvedValue(empty()), loadReadNotificationIds: vi.fn().mockResolvedValue(new Set()), loadToolUpdate: vi.fn(), addBorrowRequest: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: FirebaseAuthService, useValue: { currentUser, ensureValidSession: async () => true } },
      { provide: FirestoreToolboxService, useValue: storage },
      { provide: FirebaseMessagingService, useValue: { syncCurrentUser: vi.fn() } },
      { provide: ImageUploadService, useValue: {} },
      { provide: MatDialog, useValue: {} }, { provide: MatBottomSheet, useValue: {} },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
    ] });
    service = TestBed.inject(ToolboxStateService);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

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
  });
});
