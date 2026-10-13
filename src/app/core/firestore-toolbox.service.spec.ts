import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (count: number) => ({ count }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  getDocs: sdk.getDocs,
  onSnapshot: sdk.onSnapshot,
  runTransaction: sdk.runTransaction,
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: () => 'server-time',
  Timestamp: class {},
}));

import { FirebaseClientService } from './firebase-client.service';
import { FirestoreToolboxService } from './firestore-toolbox.service';

const notification = (id: string, createdAt: string, recipientId = '') => ({
  id,
  data: () => ({ type: 'borrow', title: 'Borrow', message: 'A request', recipientId, createdAt }),
});

describe('recipient notification queries', () => {
  let service: FirestoreToolboxService;
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        FirestoreToolboxService,
        { provide: FirebaseClientService, useValue: { firestore: {} } },
      ],
    });
    service = TestBed.inject(FirestoreToolboxService);
  });

  it('loads bounded recipient and broadcast queries and sorts their combined results', async () => {
    sdk.getDocs
      .mockResolvedValueOnce({ docs: [notification('personal', '2026-10-12', 'UserA')] })
      .mockResolvedValueOnce({ docs: [notification('broadcast', '2026-10-13')] });
    expect((await service.loadNotifications('UserA')).map((item) => item.id)).toEqual([
      'broadcast',
      'personal',
    ]);
    const queries = sdk.getDocs.mock.calls.map(([source]) => source.constraints);
    expect(queries[0]).toEqual([
      { field: 'recipientId', op: 'in', value: ['UserA', 'usera'] },
      { field: 'createdAt', direction: 'desc' },
      { count: 50 },
    ]);
    expect(queries[1][0]).toEqual({ field: 'recipientId', op: 'in', value: ['', null] });
    expect(queries[1][2]).toEqual({ count: 50 });
  });

  it('waits for both streams, replaces changed results and releases every listener', () => {
    const callbacks: Array<(snapshot: unknown) => void> = [];
    const errors: Array<(error: Error) => void> = [];
    const stops = [vi.fn(), vi.fn()];
    sdk.onSnapshot.mockImplementation((_source, callback, error) => {
      callbacks.push(callback);
      errors.push(error);
      return stops[callbacks.length - 1];
    });
    const changed = vi.fn(),
      failed = vi.fn();
    const stop = service.watchNotifications('user', changed, failed);
    callbacks[0]({ docs: [notification('p', '2026-10-12')] });
    expect(changed).not.toHaveBeenCalled();
    callbacks[1]({ docs: [notification('b', '2026-10-13')] });
    expect(changed.mock.lastCall?.[0].map((item: { id: string }) => item.id)).toEqual(['b', 'p']);
    callbacks[0]({ docs: [] });
    expect(changed.mock.lastCall?.[0].map((item: { id: string }) => item.id)).toEqual(['b']);
    errors[1](new Error('offline'));
    expect(failed).toHaveBeenCalledOnce();
    stop();
    expect(stops.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
    callbacks[0]({ docs: [] });
    errors[0](new Error('late'));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledOnce();
  });

  it('merges read history from the transaction snapshot and protects visible old marks', async () => {
    const set = vi.fn();
    sdk.runTransaction.mockImplementation(async (_db, callback) =>
      callback({
        get: async () => ({
          data: () => ({ readNotificationIds: Array.from({ length: 600 }, (_, i) => `n${i}`) }),
        }),
        set,
      }),
    );
    await service.markNotificationsRead('user', ['new'], ['n0', 'new']);
    const written = set.mock.calls[0][1].readNotificationIds;
    expect(written).toHaveLength(500);
    expect(written).toEqual(expect.arrayContaining(['n0', 'n599', 'new']));
    expect(set.mock.calls[0][2]).toEqual({ merge: true });
  });
});
