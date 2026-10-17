import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { createNotificationDelivery } = createRequire(import.meta.url)('../functions/notification-delivery.js');
async function backend(records, responseForToken = () => ({ success: false, error: { code: 'messaging/registration-token-not-registered' } })) {
  const reads = [], notifications = [], updates = [], sends = [];
  const db = { collection: path => ({
    doc: id => ({
      get: async () => { if (['tools', 'users', 'publicProfiles'].includes(path)) reads.push([path, id]); return { exists: Boolean(records[path]?.[id]), data: () => records[path]?.[id] }; },
      create: async data => { records[path] ??= {}; if (records[path][id]) throw Object.assign(new Error('Exists'), { code: 6 }); records[path][id] = data; if (path === 'notifications') notifications.push(data); },
      set: async data => { records[path] ??= {}; records[path][id] = data; },
      collection: child => db.collection(path + '/' + id + '/' + child),
      update: async data => updates.push({ path, id, data }),
    }),
    get: async () => { reads.push([path]); return { forEach: callback => Object.entries(records[path] || {}).forEach(([id, data]) => callback({ id, data: () => data })) }; },
  }) };
  db.getAll = (...refs) => Promise.all(refs.map(ref => ref.get()));
  db.batch = () => { const writes = []; return { set: (ref, data) => writes.push(() => ref.set(data)), commit: async () => { for (const write of writes) await write(); } }; };
  let pending = Promise.resolve();
  db.runTransaction = action => {
    const result = pending.then(() => action({ get: ref => ref.get(), set: (ref, data) => ref.set(data) }));
    pending = result.catch(() => {});
    return result;
  };
  const messaging = { sendEachForMulticast: async message => { sends.push(message); return { responses: await Promise.all(message.tokens.map(responseForToken)) }; } };
  const modules = {
    'firebase-functions/v2/firestore': { onDocumentCreated: (_config, handler) => handler, onDocumentUpdated: (_config, handler) => handler },
    'firebase-functions/logger': { warn: () => {} },
    'firebase-admin/app': { initializeApp: () => {} },
    'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => 'server-time', arrayRemove: (...tokens) => ({ remove: tokens }) } },
    'firebase-admin/messaging': { getMessaging: () => messaging },
    './notification-delivery': { createNotificationDelivery },
  };
  const context = vm.createContext({ exports: {}, require: name => { if (!(name in modules)) throw new Error(name); return modules[name]; }, process: { env: {} }, URL });
  vm.runInContext(await readFile('functions/index.js', 'utf8'), context);
  return { handlers: context.exports, reads, notifications, updates, sends, records, delivery: createNotificationDelivery({ db, messaging, FieldValue: modules['firebase-admin/firestore'].FieldValue }) };
}
test('owner notifications use public actor names and private tokens, including invalid-token cleanup', async () => {
  const app = await backend({ tools: { tool: { ownerId: 'Owner', name: 'Drill' } }, users: { Owner: { notificationTokens: ['secret-token'], email: 'private@example.com' } }, publicProfiles: { Borrower: { firstName: 'Ben', displayName: 'Ben' } } });
  await app.handlers.notifyOwnerOnBorrow({ id: 'borrow-event', data: { data: () => ({ toolId: 'tool', borrowerId: 'Borrower' }) } });
  assert.deepEqual(app.reads, [['tools', 'tool'], ['users', 'Owner'], ['publicProfiles', 'Borrower']]);
  assert.equal(app.notifications[0].recipientId, 'Owner');
  assert.equal(app.notifications[0].actorFirstName, 'Ben');
  assert.equal(app.sends[0].tokens[0], 'secret-token');
  assert.equal(app.updates[0].path, 'users');
  assert.equal(app.updates[0].id, 'Owner');
  assert.equal(app.updates[0].data.notificationTokens.remove[0], 'secret-token');
  assert.equal(JSON.stringify(app.notifications).includes('secret-token'), false);
});
test('request notifications broadcast to members while token fanout and cleanup stay private', async () => {
  const app = await backend({ users: { Requester: { notificationTokens: ['own-token'] }, Other: { notificationTokens: ['other-token'] } }, publicProfiles: { Requester: { firstName: 'Alice' } } });
  await app.handlers.notifyUsersOnToolRequest({ id: 'request-event', data: { data: () => ({ requesterId: 'Requester', message: 'Need a drill' }) } });
  assert.equal(app.notifications[0].recipientId, '');
  assert.equal(app.notifications[0].actorFirstName, 'Alice');
  assert.equal(app.sends[0].tokens.length, 1);
  assert.equal(app.sends[0].tokens[0], 'other-token');
  assert.deepEqual(app.reads, [['publicProfiles', 'Requester'], ['users']]);
  assert.equal(app.updates[0].path, 'users');
  assert.equal(app.updates[0].id, 'Other');
});

test('replayed events create one notification and do not resend completed tokens', async () => {
  const app = await backend({ users: { Other: { notificationTokens: ['token'] } } }, () => ({ success: true }));
  const event = { id: 'repeated-event', data: { data: () => ({ requesterId: 'Requester', message: 'Need a drill' }) } };
  await app.handlers.notifyUsersOnToolRequest(event);
  await app.handlers.notifyUsersOnToolRequest(event);
  assert.equal(app.notifications.length, 1);
  assert.equal(app.sends.length, 1);
  assert.equal(app.sends[0].webpush.notification.tag, app.sends[0].data.notificationId);
});

test('fanout uses at most 500 tokens, skips opted-out members, and retries only transient failures', async () => {
  let retry = false;
  const tokens = Array.from({ length: 1001 }, (_, i) => 'token-' + String(i).padStart(4, '0'));
  const app = await backend({ users: {
    Other: { notificationTokens: tokens },
    Disabled: { notificationsEnabled: false, notificationTokens: ['disabled'] },
    Inactive: { active: false, notificationTokens: ['inactive'] },
  } }, token => token === 'token-0001' && !retry ? ({ success: false, error: { code: 'messaging/internal-error' } }) : ({ success: true }));
  const event = { id: 'large-event', data: { data: () => ({ requesterId: 'Requester', message: 'Need tools' }) } };
  await assert.rejects(app.handlers.notifyUsersOnToolRequest(event), /failed temporarily/);
  assert.deepEqual(app.sends.map(send => send.tokens.length), [500, 500, 1]);
  retry = true;
  await app.handlers.notifyUsersOnToolRequest(event);
  assert.deepEqual(app.sends.at(-1).tokens, ['token-0001']);
  assert.equal(app.notifications.length, 1);
});

test('a delivery lease prevents concurrent invocation from duplicating push sends', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = await backend({}, async () => { await gate; return { success: true }; });
  const first = app.delivery.sendPush('same-event', { webpush: {} }, ['token'], async () => {});
  while (!app.sends.length) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(app.delivery.sendPush('same-event', {}, ['token'], async () => {}), /already running/);
  release();
  await first;
  assert.equal(app.sends.length, 1);
});
