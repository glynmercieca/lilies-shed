import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }),
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (count: number) => ({ count }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  getDocs: sdk.getDocs,
  onSnapshot: sdk.onSnapshot,
  runTransaction: sdk.runTransaction,
  getDoc: sdk.getDoc,
  setDoc: sdk.setDoc,
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

const missingIndex = () => Object.assign(new Error('The query requires an index.'), {
  code: 'failed-precondition',
});

describe('recipient notification queries', () => {
  let service: FirestoreToolboxService;
  beforeEach(() => {
    vi.resetAllMocks();
    sdk.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
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

  it('loads tools at startup when the notification index is missing', async () => {
    sdk.getDocs.mockImplementation(async (source) => {
      const path = source.source?.path ?? source.path;
      if (path === 'notifications') {
        if (source.constraints.some((constraint: { direction?: string }) => constraint.direction)) {
          throw missingIndex();
        }
        return { docs: [notification('broadcast', '2026-10-13')] };
      }
      return { docs: path === 'tools'
        ? [{ id: 'tool-doc', data: () => ({ id: '1', name: 'Drill', ownerId: 'user' }) }]
        : [] };
    });

    const snapshot = await service.loadSnapshot('user');
    expect(snapshot.tools.map((tool) => tool.name)).toEqual(['Drill']);
    expect(snapshot.notifications.map((item) => item.id)).toEqual(['broadcast']);
  });

  it('falls back per recipient stream and sorts before keeping the newest 50', async () => {
    const history = Array.from({ length: 60 }, (_, index) => notification(
      `n${index}`, new Date(Date.UTC(2026, 0, index + 1)).toISOString(), 'user',
    ));
    sdk.getDocs
      .mockRejectedValueOnce(missingIndex())
      .mockResolvedValueOnce({ docs: [notification('broadcast', '2026-10-13')] })
      .mockResolvedValueOnce({ docs: [...history, notification('undated', '')] });

    const notifications = await service.loadNotifications('user');
    expect(notifications).toHaveLength(51);
    expect(notifications[0].id).toBe('broadcast');
    expect(notifications[1].id).toBe('n59');
    expect(notifications.at(-1)?.id).toBe('n10');
    expect(sdk.getDocs.mock.calls[2][0].constraints).toEqual([
      { field: 'recipientId', op: 'in', value: ['user'] },
    ]);
  });

  it('propagates permission and unrelated precondition errors without fallback reads', async () => {
    for (const error of [
      Object.assign(new Error('Permission denied'), { code: 'permission-denied' }),
      Object.assign(new Error('Other precondition'), { code: 'failed-precondition' }),
    ]) {
      sdk.getDocs.mockReset().mockRejectedValue(error);
      await expect(service.loadNotifications('user')).rejects.toBe(error);
      expect(sdk.getDocs).toHaveBeenCalledTimes(2);
    }
  });

  it('retries a missing-index listener once and cleans up fallback listeners', () => {
    const callbacks: Array<(snapshot: unknown) => void> = [];
    const errors: Array<(error: Error) => void> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    sdk.onSnapshot.mockImplementation((_source, callback, error) => {
      callbacks.push(callback);
      errors.push(error);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    const changed = vi.fn(), failed = vi.fn();
    const stop = service.watchNotifications('user', changed, failed);
    errors[0](missingIndex());
    expect(sdk.onSnapshot.mock.calls[2][0].constraints).toEqual([
      { field: 'recipientId', op: 'in', value: ['user'] },
    ]);
    callbacks[1]({ docs: [notification('broadcast', '2026-10-12')] });
    expect(changed).not.toHaveBeenCalled();
    callbacks[2]({ docs: [notification('older', '2026-10-11'), notification('newer', '2026-10-13')] });
    expect(changed.mock.lastCall?.[0].map((item: { id: string }) => item.id))
      .toEqual(['newer', 'broadcast', 'older']);
    expect(failed).not.toHaveBeenCalled();
    errors[2](missingIndex());
    expect(sdk.onSnapshot).toHaveBeenCalledTimes(3);
    expect(failed).toHaveBeenCalledOnce();
    stop();
    expect(stops.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
    callbacks[2]({ docs: [] });
    errors[1](missingIndex());
    expect(changed).toHaveBeenCalledOnce();
    expect(sdk.onSnapshot).toHaveBeenCalledTimes(3);
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

  it('reads only referenced loan summaries/profiles, caches reference data and targets a changed tool', async () => {
    const tools = Array.from({ length: 60 }, (_, i) => ({ id: `tool-${i}`, data: () => ({
      id: String(100000 + i), name: `Tool ${i}`, ownerId: 'owner', latestLoanId: `loan-${i}`, activeLoanId: null,
    }) }));
    let documentReads = 0;
    sdk.getDocs.mockImplementation(async (source) => {
      const path = source.source?.path ?? source.path;
      let docs: Array<{ id: string; data(): unknown }> = [];
      if (path === 'tools') docs = tools;
      if (path === 'loan') {
        // A whole-history read would include 1,000 records in this fixture.
        expect(source.constraints).toHaveLength(1);
        const ids = source.constraints[0].value as string[];
        expect(ids.length).toBeLessThanOrEqual(30);
        docs = ids.map((id) => ({ id, data: () => ({ toolId: `tool-${id.slice(5)}`, borrowerId: 'borrower', loanDate: '2026-10-01', returnDate: '2026-10-02' }) }));
      }
      documentReads += docs.length;
      return { docs };
    });
    sdk.getDoc.mockImplementation(async (reference) => {
      documentReads++;
      if (reference.path === 'tools') return { ...tools[0], exists: () => true };
      expect(['owner', 'borrower']).toContain(reference.id);
      return { exists: () => true, data: () => ({ firstName: reference.id === 'owner' ? 'Olivia' : 'Ben', email: `${reference.id}@example.com` }) };
    });
    const snapshot = await service.loadSnapshot('user');
    expect(snapshot.tools).toHaveLength(60);
    expect(snapshot.loans).toHaveLength(60);
    expect(snapshot.tools[0].ownerFirstName).toBe('Olivia');
    expect(snapshot.loans[0].borrowerFirstName).toBe('Ben');
    expect(documentReads).toBe(122); // 60 tools, 60 latest loans, 2 profiles
    expect(sdk.setDoc).not.toHaveBeenCalled();
    expect(sdk.getDocs.mock.calls.filter(([source]) => (source.source?.path ?? source.path) === 'users')).toHaveLength(0);
    const beforeTargeted = documentReads;
    const updated = await service.loadToolUpdate('tool-0');
    expect(updated.tools).toHaveLength(1);
    expect(updated.loans).toHaveLength(1);
    expect(documentReads - beforeTargeted).toBe(2);
    await service.loadSnapshot('user');
    expect(sdk.getDoc).toHaveBeenCalledTimes(3); // two profiles plus targeted tool
    expect(sdk.getDocs.mock.calls.filter(([source]) => source.source?.path === 'categories')).toHaveLength(1);
  });

  it('retains unmigrated legacy history and numeric tool links', async () => {
    sdk.getDocs.mockImplementation(async (source) => {
      const path = source.source?.path ?? source.path;
      return { docs: path === 'tools' ? [{ id: 'canonical', data: () => ({ id: '100000', name: 'Drill' }) }]
        : path === 'loan' ? [{ id: 'legacy', data: () => ({ itemId: '100000', loanDate: '2026-01-01', returnDate: '' }) }]
        : [] };
    });
    const result = await service.loadSnapshot('user');
    expect(result.loans[0].itemId).toBe('canonical');
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });
});
