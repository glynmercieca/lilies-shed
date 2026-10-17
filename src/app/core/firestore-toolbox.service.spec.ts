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
  doc: (database: { path?: string }, path?: string, id?: string) => path ? ({ path, id }) : ({ path: database.path, id: 'generated-tool' }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, direction: string) => ({ field, direction }),
  limit: (count: number) => ({ count }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  getDocs: sdk.getDocs,
  getDocsFromServer: sdk.getDocs,
  onSnapshot: sdk.onSnapshot,
  runTransaction: sdk.runTransaction,
  getDoc: sdk.getDoc,
  getDocFromServer: sdk.getDoc,
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
      { field: 'recipientId', op: 'in', value: ['UserA'] },
      { field: 'createdAt', direction: 'desc' },
      { count: 50 },
    ]);
    expect(queries[1][0]).toEqual({ field: 'recipientId', op: 'in', value: [''] });
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

  it('keeps fallback queries bounded and sorts the returned window', async () => {
    const history = Array.from({ length: 49 }, (_, index) => notification(
      `n${index}`, new Date(Date.UTC(2026, 0, index + 1)).toISOString(), 'user',
    ));
    sdk.getDocs
      .mockRejectedValueOnce(missingIndex())
      .mockResolvedValueOnce({ docs: [notification('broadcast', '2026-10-13')] })
      .mockResolvedValueOnce({ docs: [...history, notification('undated', '')] });

    const notifications = await service.loadNotifications('user');
    expect(notifications).toHaveLength(50);
    expect(notifications[0].id).toBe('broadcast');
    expect(notifications[1].id).toBe('n48');
    expect(notifications.at(-1)?.id).toBe('n0');
    expect(sdk.getDocs.mock.calls[2][0].constraints).toEqual([
      { field: 'recipientId', op: 'in', value: ['user'] },
      { count: 50 },
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
      { count: 50 },
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
      if (reference.path === 'appConfig') return { exists: () => true, data: () => ({ schemaVersion: 1 }) };
      if (reference.path === 'tools') return { ...tools[0], exists: () => true };
      expect(reference.path).toBe('publicProfiles');
      expect(['owner', 'borrower']).toContain(reference.id);
      return { exists: () => true, data: () => ({ firstName: reference.id === 'owner' ? 'Olivia' : 'Ben', email: `${reference.id}@example.com` }) };
    });
    const snapshot = await service.loadSnapshot('user');
    expect(snapshot.tools).toHaveLength(60);
    expect(snapshot.loans).toHaveLength(60);
    expect(snapshot.tools[0].ownerFirstName).toBe('Olivia');
    expect(snapshot.loans[0].borrowerFirstName).toBe('Ben');
    expect(documentReads).toBe(123); // one migration gate, 60 tools, 60 latest loans, 2 profiles
    expect(sdk.setDoc).not.toHaveBeenCalled();
    expect(sdk.getDocs.mock.calls.filter(([source]) => (source.source?.path ?? source.path) === 'users')).toHaveLength(0);
    const beforeTargeted = documentReads;
    const updated = await service.loadToolUpdate('tool-0');
    expect(updated.tools).toHaveLength(1);
    expect(updated.loans).toHaveLength(1);
    expect(documentReads - beforeTargeted).toBe(2);
    await service.loadSnapshot('user');
    expect(sdk.getDoc).toHaveBeenCalledTimes(4); // migration gate, two profiles plus targeted tool
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
    expect(result.loans).toHaveLength(1); // toolId/itemId query overlap is deduplicated
    const loanQueries = sdk.getDocs.mock.calls.filter(([source]) => source.source?.path === 'loan');
    expect(loanQueries.map(([source]) => source.constraints[0])).toEqual([
      { field: 'toolId', op: 'in', value: ['canonical', '100000'] },
      { field: 'itemId', op: 'in', value: ['canonical', '100000'] },
    ]);
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });
  it('creates tools using their unique document ID without accessing shared counters', async () => {
    const owner = { id: 'owner', name: 'Olivia', email: 'private@example.com', firstName: 'Olivia', lastName: '', picture: '' };
    const result = await service.addTool({ name: 'Drill', categoryId: 'other', description: 'Drill', notes: '', imageUrl: '', imageFile: null }, owner);
    expect(result).toBe('generated-tool');
    expect(sdk.setDoc.mock.calls[0][0]).toEqual({ path: 'tools', id: 'generated-tool' });
    expect(sdk.setDoc.mock.calls[0][1]).toMatchObject({ id: 'generated-tool', ownerId: 'owner', activeLoanId: null, latestLoanId: null, borrowStateVersion: 1 });
    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });

  it('preserves creation timestamps when loading new and legacy tools', async () => {
    sdk.getDocs.mockImplementation(async source => ({ docs:
      (source.source?.path ?? source.path) === 'tools' ? [
        { id: 'new', data: () => ({ name: 'New drill', latestLoanId: null, createdAt: '2026-10-17T10:00:00Z' }) },
        { id: 'legacy', data: () => ({ name: 'Old drill', latestLoanId: null }) },
      ] : [],
    }));
    const snapshot = await service.loadSnapshot('user');
    expect(snapshot.tools.map(tool => tool.createdAt)).toEqual(['2026-10-17T10:00:00.000Z', '']);
  });

  it('watches server changes, including initial races and removals, without treating cached writes as verified', async () => {
    const stop = vi.fn();
    sdk.onSnapshot.mockReturnValue(stop);
    const changed = vi.fn(), failed = vi.fn();
    const unsubscribe = service.watchToolChanges([{ documentId: 'known', updatedAt: '2026-10-17T10:00:00.000Z' }] as Parameters<typeof service.watchToolChanges>[0], changed, failed);
    await vi.waitFor(() => expect(sdk.onSnapshot).toHaveBeenCalledOnce());
    const callback = sdk.onSnapshot.mock.calls[0][2];
    const snapshot = (ids: string[], cached = false) => ({ metadata: { fromCache: cached, hasPendingWrites: false }, docs: ids.map(id => ({ id, data: () => ({ updatedAt: '2026-10-17T10:00:00Z' }) })) });
    callback(snapshot(['known']));
    expect(changed).not.toHaveBeenCalled();
    callback(snapshot(['known', 'added'], true));
    expect(changed).not.toHaveBeenCalled();
    callback(snapshot(['known', 'added']));
    expect(changed).toHaveBeenLastCalledWith(['added']);
    callback(snapshot(['added']));
    expect(changed).toHaveBeenLastCalledWith(['known']);
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('preserves discovered categories when creating and editing tools and rejects unknown categories', async () => {
    sdk.getDocs.mockResolvedValue({ docs: [{ id: 'woodworking', data: () => ({ name: 'Woodworking', order: 130 }) }] });
    const owner = { id: 'owner', name: 'Olivia', email: '', firstName: 'Olivia', lastName: '', picture: '' };
    const form = { name: 'Plane', categoryId: 'woodworking', description: 'Hand plane', notes: '', imageUrl: '', imageFile: null };
    await service.addTool(form, owner);
    expect(sdk.setDoc.mock.calls[0][1]).toMatchObject({ categoryId: 'woodworking', categoryName: 'Woodworking' });
    const update = vi.fn();
    sdk.runTransaction.mockImplementation(async (_db, action) => action({
      get: async () => ({ exists: () => true, data: () => ({ borrowStateVersion: 1, activeLoanId: null }) }), update,
    }));
    await service.updateTool({ documentId: 'plane' } as Parameters<typeof service.updateTool>[0], form);
    expect(update.mock.calls[0][1]).toMatchObject({ categoryId: 'woodworking', categoryName: 'Woodworking' });
    expect(sdk.getDocs).toHaveBeenCalledOnce();
    await expect(service.addTool({ ...form, categoryId: 'missing' }, owner)).rejects.toThrow('category is no longer available');
    expect(sdk.setDoc).toHaveBeenCalledOnce();
  });

  it('loads legacy inventory without public-profile access and retries display profiles after rules are ready', async () => {
    sdk.getDocs.mockImplementation(async source => {
      const path = source.source?.path ?? source.path;
      return { docs: path === 'tools' ? [{ id: 'tool', data: () => ({ id: '100000', name: 'Drill', ownerId: 'owner' }) }]
        : path === 'loan' ? [{ id: 'loan', data: () => ({ itemId: '100000', borrowerId: 'borrower', loanDate: '2026-10-17', returnDate: '' }) }]
        : [] };
    });
    sdk.getDoc.mockImplementation(async reference => {
      if (reference.path === 'appConfig') return { exists: () => false, data: () => undefined };
      throw Object.assign(new Error('Profile rules not ready'), { code: 'permission-denied' });
    });
    const snapshot = await service.loadSnapshot('user');
    expect(snapshot.tools.map(tool => tool.name)).toEqual(['Drill']);
    expect(snapshot.loans[0].itemId).toBe('tool');
    expect(sdk.getDoc.mock.calls.every(([reference]) => ['publicProfiles', 'appConfig'].includes(reference.path))).toBe(true);
    sdk.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ firstName: 'Alice' }) });
    const refreshed = await service.loadSnapshot('user');
    expect(refreshed.tools[0].ownerFirstName).toBe('Alice');
    expect(sdk.getDoc).toHaveBeenCalledTimes(5);
  });

  it('excludes deleted tools only after the trusted migration gate is published', async () => {
    sdk.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ schemaVersion: 1 }) });
    sdk.getDocs.mockResolvedValue({ docs: [] });
    await service.loadSnapshot('user');
    const toolsQuery = sdk.getDocs.mock.calls.find(([source]) => source.source?.path === 'tools')![0];
    expect(toolsQuery.constraints).toEqual([{ field: 'deleted', op: '==', value: false }]);
    service.watchToolChanges([], vi.fn(), vi.fn());
    await vi.waitFor(() => expect(sdk.onSnapshot).toHaveBeenCalledOnce());
    expect(sdk.onSnapshot.mock.calls[0][0]).toEqual(toolsQuery);
  });

  it('does not mask a failed inventory read as an empty successful result', async () => {
    const denied = Object.assign(new Error('Tool access denied'), { code: 'permission-denied' });
    sdk.getDocs.mockImplementation(async source => {
      if ((source.source?.path ?? source.path) === 'tools') throw denied;
      return { docs: [] };
    });
    await expect(service.loadSnapshot('user')).rejects.toBe(denied);
  });

});
