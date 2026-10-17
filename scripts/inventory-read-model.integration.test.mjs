import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, query, where } from 'firebase/firestore';
import verification from '../functions/scripts/verify-inventory-read-model.js';

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-lilies-tests', firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') } });
});
after(async () => env?.cleanup());

test('migration verifies legacy records before enabling active-only queries, without hiding active tools', async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'tools', 'legacy'), { id: '1', name: 'Legacy drill', ownerId: 'owner' });
    await setDoc(doc(context.firestore(), 'tools', 'deleted'), { id: '2', name: 'Deleted drill', ownerId: 'owner', deleted: 'true' });
  });
  const db = env.authenticatedContext('owner').firestore();
  assert.equal((await getDoc(doc(db, 'appConfig', 'inventory'))).exists(), false);
  const dryRun = spawnSync(process.execPath, ['functions/scripts/migrate-borrow-state.js'], { env: { ...process.env, GCLOUD_PROJECT: 'demo-lilies-tests' }, encoding: 'utf8' });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal((await getDoc(doc(db, 'appConfig', 'inventory'))).exists(), false);
  const apply = spawnSync(process.execPath, ['functions/scripts/migrate-borrow-state.js', '--apply'], { env: { ...process.env, GCLOUD_PROJECT: 'demo-lilies-tests' }, encoding: 'utf8' });
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal((await getDoc(doc(db, 'appConfig', 'inventory'))).data().schemaVersion, 1);
  assert.deepEqual((await getDocs(query(collection(db, 'tools'), where('deleted', '==', false)))).docs.map(doc => doc.id), ['legacy']);
  await assertFails(setDoc(doc(db, 'appConfig', 'inventory'), { schemaVersion: 1 }));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'appConfig', 'inventory')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('other').firestore(), 'appConfig', 'inventory')));
});

test('verification rejects missing pointers, non-boolean flags and inconsistent legacy links', () => {
  assert.ok(verification.verifyInventoryReadModel([{ documentId: 'legacy', id: '1' }], []).length);
  assert.deepEqual(verification.verifyInventoryReadModel([{ documentId: 'tool', deleted: false, borrowStateVersion: 1, activeLoanId: null, latestLoanId: null }], []), []);
  assert.ok(verification.verifyInventoryReadModel([{ documentId: 'tool', deleted: false, borrowStateVersion: 1, activeLoanId: null, latestLoanId: null }], [{ documentId: 'loan', toolId: 'tool', borrowerId: 'borrower', loanDate: '2026-10-17', returnDate: '' }]).length);
});
