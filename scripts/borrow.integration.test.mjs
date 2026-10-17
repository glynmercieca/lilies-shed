import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { reserveTool, returnLoan } from '../src/app/core/borrow-operations.ts';
import migration from '../functions/scripts/plan-borrow-migration.js';

let env;
const db = (uid = 'borrower') => env.authenticatedContext(uid).firestore();
const date = '2026-10-17';
const tool = { id: '100000', name: 'Drill', ownerId: 'owner', deleted: false, borrowStateVersion: 1, activeLoanId: null, latestLoanId: null };
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-lilies-tests', firestore: {
    host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8'),
  } });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'tools', 'tool'), tool));
});

test('two competing borrows commit exactly one loan and reservation; return allows another borrow', async () => {
  const outcomes = await Promise.allSettled([reserveTool(db('a'), 'tool', 'a', date), reserveTool(db('b'), 'tool', 'b', date)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const loans = await getDocs(collection(db(), 'loan'));
  assert.equal(loans.size, 1);
  const loan = loans.docs[0];
  assert.equal((await getDoc(doc(db(), 'tools', 'tool'))).data().activeLoanId, loan.id);
  await assertFails(returnLoan(db('stranger'), loan.id, date));
  await assertFails(updateDoc(doc(db('owner'), 'tools', 'tool'), { deleted: true }));
  await returnLoan(db(loan.data().borrowerId), loan.id, date);
  await returnLoan(db(loan.data().borrowerId), loan.id, date); // retry is harmless
  await reserveTool(db('next'), 'tool', 'next', date);
  assert.equal((await getDocs(collection(db(), 'loan'))).size, 2);
});

test('missing, deleted, unmigrated and owned tools cannot be borrowed and create no loan', async () => {
  await assert.rejects(reserveTool(db(), 'missing', 'borrower', date));
  await assert.rejects(reserveTool(db('owner'), 'tool', 'owner', date));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'tools', 'deleted'), { ...tool, deleted: true });
    await setDoc(doc(context.firestore(), 'tools', 'legacy'), { id: '2', ownerId: 'owner', deleted: false });
  });
  await assert.rejects(reserveTool(db(), 'deleted', 'borrower', date));
  await assert.rejects(reserveTool(db(), 'legacy', 'borrower', date));
  assert.equal((await getDocs(collection(db(), 'loan'))).size, 0);
});

test('rules reject standalone loans, standalone reservations, forged borrowers and anonymous clients', async () => {
  await assertFails(setDoc(doc(db(), 'loan', 'fake'), { toolId: 'tool', borrowerId: 'borrower', loanDate: date, returnDate: '', createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db(), 'tools', 'tool'), { activeLoanId: 'fake' }));
  await assertFails(reserveTool(db('a'), 'tool', 'b', date));
  await assertFails(reserveTool(env.unauthenticatedContext().firestore(), 'tool', 'a', date));
  assert.equal((await getDoc(doc(db(), 'tools', 'tool'))).data().activeLoanId, null);
  assert.equal((await getDocs(collection(db(), 'loan'))).size, 0);
});

test('owner can return, edit and soft-delete; strangers cannot and deleted tools stay unavailable', async () => {
  await assertFails(updateDoc(doc(db(), 'tools', 'tool'), { name: 'Changed' }));
  await reserveTool(db(), 'tool', 'borrower', date);
  const loanId = (await getDoc(doc(db(), 'tools', 'tool'))).data().activeLoanId;
  await assertFails(updateDoc(doc(db(), 'loan', loanId), { returnDate: date }));
  await assertFails(updateDoc(doc(db('owner'), 'tools', 'tool'), { name: 'Changed' }));
  await returnLoan(db('owner'), loanId, date);
  await updateDoc(doc(db('owner'), 'tools', 'tool'), { name: 'Changed' });
  await updateDoc(doc(db('owner'), 'tools', 'tool'), { deleted: true });
  await assert.rejects(reserveTool(db(), 'tool', 'borrower', date));
});

test('failed return batch cannot release reservation or overwrite immutable loan fields', async () => {
  await reserveTool(db(), 'tool', 'borrower', date);
  const loanId = (await getDoc(doc(db(), 'tools', 'tool'))).data().activeLoanId;
  const client = db();
  const batch = writeBatch(client);
  batch.update(doc(client, 'tools', 'tool'), { activeLoanId: null });
  batch.update(doc(client, 'loan', loanId), { borrowerId: 'forged', returnDate: date });
  await assertFails(batch.commit());
  assert.equal((await getDoc(doc(db(), 'tools', 'tool'))).data().activeLoanId, loanId);
  assert.equal((await getDoc(doc(db(), 'loan', loanId))).data().returnDate, '');
});

test('borrow versus delete cannot leave a deleted tool on an active loan', async () => {
  await Promise.allSettled([
    reserveTool(db(), 'tool', 'borrower', date),
    updateDoc(doc(db('owner'), 'tools', 'tool'), { deleted: true }),
  ]);
  const final = (await getDoc(doc(db(), 'tools', 'tool'))).data();
  assert.equal(Boolean(final.deleted && final.activeLoanId), false);
  assert.ok(final.deleted || final.activeLoanId);
});

test('a migrated legacy active loan stays reserved and can be returned', async () => {
  const plan = migration.planBorrowMigration([{ documentId: 'tool', ...tool }], [
    { documentId: 'legacy', itemId: '100000', borrowerId: 'borrower', loanDate: date },
  ]);
  await env.withSecurityRulesDisabled(async (context) => {
    const client = context.firestore();
    await setDoc(doc(client, 'loan', 'legacy'), { itemId: '100000', borrowerId: 'borrower', loanDate: date, ...plan.loans[0].data });
    await updateDoc(doc(client, 'tools', 'tool'), plan.tools[0].data);
  });
  await assert.rejects(reserveTool(db('other'), 'tool', 'other', date));
  await returnLoan(db(), 'legacy', date);
  assert.equal((await getDoc(doc(db(), 'tools', 'tool'))).data().activeLoanId, null);
});

test('migration canonicalizes legacy IDs and blocks ambiguous, duplicate and orphaned active loans', () => {
  const tools = [{ documentId: 'doc', id: '100000' }];
  const loans = [{ documentId: 'old', itemId: '100000', borrowerId: 'a' }];
  const plan = migration.planBorrowMigration(tools, loans);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.tools[0].data.activeLoanId, 'old');
  assert.deepEqual(plan.loans[0].data, { toolId: 'doc', returnDate: '' });
  assert.ok(migration.planBorrowMigration(tools, [...loans, { ...loans[0], documentId: 'dup' }]).conflicts.length);
  assert.ok(migration.planBorrowMigration([], loans).conflicts.length);
  assert.ok(migration.planBorrowMigration([...tools, { documentId: 'other', id: '100000' }], loans).conflicts.length);
});
