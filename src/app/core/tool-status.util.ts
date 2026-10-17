import { LoanRecord, SheetsSnapshot, ToolWithStatus } from './models';

export function decorateTools(snapshot: Pick<SheetsSnapshot, 'tools' | 'loans'>): ToolWithStatus[] {
  const activeLoanByTool = new Map<string, LoanRecord>();
  const latestLoanByTool = new Map<string, LoanRecord>();

  for (const loan of snapshot.loans) {
    const latest = latestLoanByTool.get(loan.itemId);
    if (!latest || loan.loanDate > latest.loanDate || (loan.loanDate === latest.loanDate && loan.id > latest.id)) {
      latestLoanByTool.set(loan.itemId, loan);
    }
    if (!loan.returnDate) {
      activeLoanByTool.set(loan.itemId, loan);
    }
  }

  return snapshot.tools.map((tool) => ({
    ...tool,
    activeLoan: activeLoanByTool.get(tool.documentId),
    latestLoan: latestLoanByTool.get(tool.documentId),
    available: !tool.deleted && !tool.activeLoanId && !activeLoanByTool.has(tool.documentId),
  }));
}
