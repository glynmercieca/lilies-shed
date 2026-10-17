import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit, serverTimestamp, deleteDoc, writeBatch } from 'firebase/firestore';
import { reserveTool, returnLoan } from '../src/app/core/borrow-operations.ts';
import migration from '../functions/scripts/plan-profile-migration.js';
let env;
const db = (uid = 'UserA') => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-lilies-tests', firestore: {
  host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8'),
} }); });
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const client = context.firestore();
    await setDoc(doc(client, 'users', 'UserA'), { notificationTokens: ['secret'], readNotificationIds: ['old'], unknownLegacyPreference: true });
    await setDoc(doc(client, 'publicProfiles', 'UserA'), migration.publicProfile({ firstName: 'Alice', notificationTokens: ['secret'] }));
    for (const [id, recipientId] of [['personal', 'UserA'], ['other', 'UserB'], ['broadcast', ''], ['legacyBroadcast', null]]) {
      await setDoc(doc(client, 'notifications', id), { recipientId, createdAt: new Date(), title: 'Test' });
    }
  });
});
test('private records and tokens are isolated, including legacy records and collection queries', async () => {
  await assertSucceeds(getDoc(doc(db(), 'users', 'UserA')));
  for (const uid of ['UserB', null]) {
    await assertFails(getDoc(doc(db(uid), 'users', 'UserA')));
    await assertFails(updateDoc(doc(db(uid), 'users', 'UserA'), { notificationTokens: ['stolen'] }));
    await assertFails(getDocs(collection(db(uid), 'users')));
  }
  await assertFails(getDocs(collection(db(), 'users')));
  await assertSucceeds(updateDoc(doc(db(), 'users', 'UserA'), { readNotificationIds: ['new'], updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db(), 'users', 'UserA'), { notificationTokens: ['new-token'] }));
  await assertFails(updateDoc(doc(db(), 'users', 'UserA'), { admin: true }));
  await assertFails(updateDoc(doc(db(), 'users', 'UserA'), { readNotificationIds: Array(501).fill('x') }));
});
test('display projections share only allowed fields and cannot be forged for another account', async () => {
  const profile = migration.publicProfile({ firstName: 'Alice', email: 'private@example.com', notificationTokens: ['secret'], preferences: { private: true } });
  assert.deepEqual(Object.keys(profile).sort(), ['displayName', 'firstName', 'lastName', 'photoURL'].sort());
  await assertSucceeds(getDoc(doc(db('UserB'), 'publicProfiles', 'UserA')));
  await assertFails(getDoc(doc(db(null), 'publicProfiles', 'UserA')));
  await assertSucceeds(setDoc(doc(db(), 'publicProfiles', 'UserA'), profile));
  await assertFails(setDoc(doc(db('UserB'), 'publicProfiles', 'UserA'), profile));
  await assertFails(updateDoc(doc(db(), 'publicProfiles', 'UserA'), { notificationTokens: ['leak'] }));
  await assertFails(updateDoc(doc(db(), 'publicProfiles', 'UserA'), { email: 'leak@example.com' }));
});
test('recipient and broadcast queries succeed while broad, other-user and lowercased-UID queries fail', async () => {
  const notifications = collection(db(), 'notifications');
  await assertSucceeds(getDocs(query(notifications, where('recipientId', 'in', ['UserA']), orderBy('createdAt', 'desc'), limit(50))));
  await assertSucceeds(getDocs(query(notifications, where('recipientId', 'in', ['']), orderBy('createdAt', 'desc'), limit(50))));
  await assertSucceeds(getDocs(query(notifications, where('recipientId', 'in', ['UserA']))));
  await assertFails(getDocs(notifications));
  await assertFails(getDocs(query(notifications, where('recipientId', 'in', ['UserA', 'usera']))));
  await assertFails(getDoc(doc(db(), 'notifications', 'other')));
  await assertFails(getDoc(doc(db(null), 'notifications', 'broadcast')));
  await assertFails(setDoc(doc(db(), 'notifications', 'forged'), { recipientId: 'UserA' }));
  await assertFails(updateDoc(doc(db(), 'notifications', 'personal'), { title: 'forged' }));
});
test('migration preserves canonical IDs, repairs unique legacy casing and refuses ambiguous recipients', () => {
  assert.equal(migration.canonicalRecipient('usera', ['UserA']), 'UserA');
  assert.equal(migration.canonicalRecipient('UserA', ['UserA', 'usera']), 'UserA');
  assert.equal(migration.canonicalRecipient(null, ['UserA']), '');
  assert.throws(() => migration.canonicalRecipient('USERA', ['UserA', 'usera']));
  assert.throws(() => migration.canonicalRecipient('unknown', ['UserA']));
  assert.equal(migration.publicProfile({ email: 'private@example.com', displayName: 'private@example.com', firstName: 'private@example.com' }).displayName, 'Member');
  assert.equal(migration.publicProfile({ firstName: 'Alice', displayName: 'Alice Smith' }).displayName, 'Alice Smith');
});

const newTool = (id = 'new') => ({ id, name: 'Drill', categoryId: 'other', categoryName: 'Other', description: 'A drill', notes: '', image: '', thumbnail: '', ownerId: 'UserA', deleted: false, borrowStateVersion: 1, activeLoanId: null, latestLoanId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
async function seedCategory() {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'categories', 'other'), { id: 'other', name: 'Other', order: 1 }));
}
test('tool creation binds identity and IDs, validates schema and never needs a counter', async () => {
  await seedCategory();
  await assertSucceeds(setDoc(doc(db(), 'tools', 'new'), newTool()));
  for (const patch of [{ ownerId: 'UserB' }, { id: 'forged' }, { activeLoanId: 'forged' }, { latestLoanId: 'forged' }, { deleted: true }, { name: '' }, { name: 'x'.repeat(201) }, { notes: 42 }, { hidden: 'forged' }, { categoryName: 'Forged' }, { createdAt: new Date(0) }]) {
    await assertFails(setDoc(doc(db(), 'tools', 'bad'), { ...newTool('bad'), ...patch }));
  }
  await assertFails(setDoc(doc(db(null), 'tools', 'anonymous'), newTool('anonymous')));
  await assertFails(getDoc(doc(db(null), 'tools', 'new')));
  await assertFails(deleteDoc(doc(db(), 'tools', 'new')));
});
test('owners can edit and delete only available tools; ownership, IDs and history are immutable', async () => {
  await seedCategory();
  await setDoc(doc(db(), 'tools', 'new'), newTool());
  const ref = doc(db(), 'tools', 'new');
  await assertSucceeds(updateDoc(ref, { name: 'Updated', updatedAt: serverTimestamp() }));
  for (const patch of [{ ownerId: 'UserB' }, { id: 'other' }, { borrowStateVersion: 2 }, { createdAt: new Date(0) }, { latestLoanId: 'fake' }, { deleted: 'true' }, { unknown: true }, { description: 'x'.repeat(4001) }]) {
    await assertFails(updateDoc(ref, { ...patch, updatedAt: serverTimestamp() }));
  }
  await assertFails(updateDoc(doc(db('UserB'), 'tools', 'new'), { name: 'Stolen', updatedAt: serverTimestamp() }));
  await reserveTool(db('UserB'), 'new', 'UserB', '2026-10-17');
  await assertFails(updateDoc(ref, { deleted: true, updatedAt: serverTimestamp() }));
  const loanId = (await getDoc(ref)).data().activeLoanId;
  await returnLoan(db(), loanId, '2026-10-17');
  await assertSucceeds(updateDoc(ref, { deleted: true, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { deleted: false, updatedAt: serverTimestamp() }));
});
test('borrowers cannot smuggle tool edits and closed loans cannot reopen or change identity', async () => {
  await seedCategory();
  await setDoc(doc(db(), 'tools', 'new'), newTool());
  const client = db('UserB'), batch = writeBatch(client);
  batch.set(doc(client, 'loan', 'smuggled'), { toolId: 'new', borrowerId: 'UserB', loanDate: '2026-10-17', returnDate: '', createdAt: serverTimestamp() });
  batch.update(doc(client, 'tools', 'new'), { activeLoanId: 'smuggled', latestLoanId: 'smuggled', name: 'Stolen', updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
  await assertFails(reserveTool(client, 'new', 'UserB', 'not-a-date'));
  await reserveTool(client, 'new', 'UserB', '2026-10-17');
  const loanId = (await getDoc(doc(client, 'tools', 'new'))).data().activeLoanId;
  await assertFails(updateDoc(doc(client, 'loan', loanId), { borrowerId: 'UserC' }));
  await assertFails(returnLoan(db('UserC'), loanId, '2026-10-17'));
  await assertFails(returnLoan(client, loanId, 'not-a-date'));
  await returnLoan(client, loanId, '2026-10-17');
  await assertFails(updateDoc(doc(client, 'loan', loanId), { returnDate: '', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(client, 'loan', loanId), { toolId: 'other' }));
});
test('category administration is enforced by Firebase UID and all client meta access is denied', async () => {
  const data = { id: 'discovered', name: 'Discovered', order: 20, discoveredAt: serverTimestamp() };
  for (const uid of ['UserA', null]) await assertFails(setDoc(doc(db(uid), 'categories', 'discovered'), data));
  const admin = db('R01SeK0oBJPFVBt0Okm12BnLxgs2');
  await assertSucceeds(setDoc(doc(admin, 'categories', 'discovered'), data));
  await assertFails(updateDoc(doc(admin, 'categories', 'discovered'), { extra: true }));
  await assertFails(setDoc(doc(env.authenticatedContext('UserA', { admin: true }).firestore(), 'categories', 'discovered'), data));
  for (const uid of ['UserA', 'R01SeK0oBJPFVBt0Okm12BnLxgs2', null]) {
    await assertFails(setDoc(doc(db(uid), 'meta', 'counters'), { nextToolId: 1 }));
    await assertFails(getDoc(doc(db(uid), 'meta', 'counters')));
  }
});
test('tool requests bind requester identity, timestamps and fields and cannot be edited', async () => {
  const data = { requesterId: 'UserA', message: 'Need a drill', createdAt: serverTimestamp() };
  const ref = doc(db(), 'requests', 'request');
  await assertSucceeds(setDoc(ref, data));
  await assertFails(updateDoc(ref, { message: 'Changed' }));
  for (const patch of [{ requesterId: 'UserB' }, { recipientId: 'UserB' }, { message: '' }, { message: 'x'.repeat(1001) }, { createdAt: new Date(0) }]) {
    await assertFails(setDoc(doc(db(), 'requests', 'forged'), { ...data, ...patch }));
  }
  await assertFails(setDoc(doc(db(null), 'requests', 'anonymous'), data));
});

test('anonymous clients cannot read any shared application collection and unknown paths deny by default', async () => {
  for (const path of ['tools', 'loan', 'requests', 'categories', 'publicProfiles', 'notifications', 'users', 'meta']) {
    await assertFails(getDocs(collection(db(null), path)));
  }
  await assertFails(setDoc(doc(db(), 'admin', 'UserA'), { role: 'admin' }));
  await assertFails(getDoc(doc(db(), 'unknown', 'record')));
});
