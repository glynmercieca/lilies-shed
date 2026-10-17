import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
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
  assert.equal(migration.publicProfile({ email: 'private@example.com', displayName: 'private@example.com' }).displayName, 'Member');
});
