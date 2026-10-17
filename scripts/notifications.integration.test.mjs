import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
async function backend(records) {
  const reads = [], notifications = [], updates = [], sends = [];
  const db = { collection: path => ({
    doc: id => ({ get: async () => { reads.push([path, id]); return { exists: Boolean(records[path]?.[id]), data: () => records[path]?.[id] }; }, update: async data => updates.push({ path, id, data }) }),
    add: async data => notifications.push(data),
    get: async () => { reads.push([path]); return { forEach: callback => Object.entries(records[path] || {}).forEach(([id, data]) => callback({ id, data: () => data })) }; },
  }) };
  const messaging = { sendEachForMulticast: async message => { sends.push(message); return { responses: message.tokens.map(() => ({ success: false, error: { code: 'messaging/registration-token-not-registered' } })) }; } };
  const modules = {
    'firebase-functions/v2/firestore': { onDocumentCreated: (_config, handler) => handler, onDocumentUpdated: (_config, handler) => handler },
    'firebase-functions/logger': { warn: () => {} },
    'firebase-admin/app': { initializeApp: () => {} },
    'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => 'server-time', arrayRemove: (...tokens) => ({ remove: tokens }) } },
    'firebase-admin/messaging': { getMessaging: () => messaging },
  };
  const context = vm.createContext({ exports: {}, require: name => { if (!(name in modules)) throw new Error(name); return modules[name]; }, process: { env: {} }, URL });
  vm.runInContext(await readFile('functions/index.js', 'utf8'), context);
  return { handlers: context.exports, reads, notifications, updates, sends };
}
test('owner notifications use public actor names and private tokens, including invalid-token cleanup', async () => {
  const app = await backend({ tools: { tool: { ownerId: 'Owner', name: 'Drill' } }, users: { Owner: { notificationTokens: ['secret-token'], email: 'private@example.com' } }, publicProfiles: { Borrower: { firstName: 'Ben', displayName: 'Ben' } } });
  await app.handlers.notifyOwnerOnBorrow({ data: { data: () => ({ toolId: 'tool', borrowerId: 'Borrower' }) } });
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
  await app.handlers.notifyUsersOnToolRequest({ data: { data: () => ({ requesterId: 'Requester', message: 'Need a drill' }) } });
  assert.equal(app.notifications[0].recipientId, '');
  assert.equal(app.notifications[0].actorFirstName, 'Alice');
  assert.equal(app.sends[0].tokens.length, 1);
  assert.equal(app.sends[0].tokens[0], 'other-token');
  assert.deepEqual(app.reads, [['publicProfiles', 'Requester'], ['users']]);
  assert.equal(app.updates[0].path, 'users');
  assert.equal(app.updates[0].id, 'Other');
});
