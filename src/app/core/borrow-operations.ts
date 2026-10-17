import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';

// Shared by the app and the emulator tests. Transactions require a live server;
// a cached availability indicator never authorizes borrowing.
export async function reserveTool(db: Firestore, toolId: string, borrowerId: string, date: string): Promise<void> {
  const loanRef = doc(collection(db, 'loan'));
  const toolRef = doc(db, 'tools', toolId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(toolRef);
    const tool = snapshot.data();
    if (!snapshot.exists() || tool?.['deleted'] === true || tool?.['deleted'] === 'true') {
      throw new Error('This tool is no longer available.');
    }
    if (tool?.['borrowStateVersion'] !== 1) throw new Error('This tool needs its loan history migrated before borrowing.');
    if (tool['activeLoanId'] !== null) throw new Error('Someone has already borrowed this tool. Refresh to see its current status.');
    if (tool['ownerId'] === borrowerId) throw new Error('You cannot borrow your own tool.');
    transaction.set(loanRef, { toolId, borrowerId, loanDate: date, returnDate: '', createdAt: serverTimestamp() });
    transaction.update(toolRef, { activeLoanId: loanRef.id, latestLoanId: loanRef.id, updatedAt: serverTimestamp() });
  });
}

export async function returnLoan(db: Firestore, loanId: string, date: string): Promise<void> {
  const loanRef = doc(db, 'loan', loanId);
  await runTransaction(db, async (transaction) => {
    const currentLoan = await transaction.get(loanRef);
    const data = currentLoan.data();
    if (!currentLoan.exists()) throw new Error('This loan no longer exists.');
    if (data?.['returnDate']) return;
    const toolId = data?.['toolId'] || data?.['itemId'];
    const toolRef = doc(db, 'tools', toolId);
    const tool = await transaction.get(toolRef);
    if (tool.data()?.['activeLoanId'] !== loanId) throw new Error('This loan needs reconciliation before it can be returned.');
    transaction.update(loanRef, { returnDate: date, updatedAt: serverTimestamp() });
    transaction.update(toolRef, { activeLoanId: null, updatedAt: serverTimestamp() });
  });
}
