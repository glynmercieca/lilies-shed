import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import planner from '../functions/scripts/plan-profile-migration.js';
async function migration(apply, recipient = 'usera') {
  const writes = [], logs = [];
  const records = { users: { UserA: { displayName: 'Alice Smith', notificationTokens: ['secret'], readNotificationIds: ['read'], email: 'private@example.com' } }, notifications: { note: { recipientId: recipient } }, tools: { tool: { ownerId: 'UserA' } }, loan: { loan: { borrowerId: 'UserA', returnDate: '' } } };
  const db = { collection: path => ({ get: async () => { const docs = Object.entries(records[path] || {}).map(([id, data]) => ({ id, data: () => data, ref: { update: async value => writes.push({ path, id, value }) } })); return { docs, size: docs.length }; }, doc: id => ({ set: async value => writes.push({ path, id, value }) }) }) };
  const modules = { 'firebase-admin/app': { initializeApp: () => {} }, 'firebase-admin/firestore': { getFirestore: () => db }, 'firebase-admin/auth': { getAuth: () => ({ listUsers: async () => ({ users: [{ uid: 'UserA' }] }) }) }, './plan-profile-migration': planner };
  const process = { env: { GCLOUD_PROJECT: 'demo-lilies-tests' }, argv: apply ? ['--apply'] : [], exitCode: undefined };
  const context = vm.createContext({ require: name => { if (!(name in modules)) throw new Error(name); return modules[name]; }, process, console: { log: value => logs.push(value), error: value => logs.push(value) } });
  await vm.runInContext(await readFile('functions/scripts/migrate-profile-privacy.js', 'utf8'), context);
  return { writes, logs, process, records };
}
test('migration dry run writes nothing and apply publishes only safe projections and canonical recipients', async () => {
  const dry = await migration(false);
  assert.equal(dry.writes.length, 0);
  const apply = await migration(true);
  assert.equal(apply.process.exitCode, undefined);
  assert.equal(apply.writes.length, 2);
  assert.equal(apply.writes[0].path, 'publicProfiles');
  assert.deepEqual(Object.keys(apply.writes[0].value).sort(), ['displayName', 'firstName', 'lastName', 'photoURL'].sort());
  assert.equal(apply.writes[1].value.recipientId, 'UserA');
  assert.equal(apply.records.users.UserA.notificationTokens[0], 'secret');
  assert.equal(JSON.stringify(apply.writes).includes('secret'), false);
  assert.equal(JSON.stringify(apply.logs).includes('secret'), false);
});
test('migration refuses every write when an unknown recipient is present', async () => {
  const result = await migration(true, 'unknown');
  assert.equal(result.process.exitCode, 1);
  assert.equal(result.writes.length, 0);
});
