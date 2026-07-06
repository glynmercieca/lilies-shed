import { LoanRecord, SheetsSnapshot, ToolWithStatus } from './models';

export function decorateTools(snapshot: SheetsSnapshot): ToolWithStatus[] {
  const activeLoanByTool = new Map<string, LoanRecord>();
  const latestLoanByTool = new Map<string, LoanRecord>();

  for (const loan of snapshot.loans) {
    latestLoanByTool.set(loan.itemId, loan);
    if (!loan.returnDate) {
      activeLoanByTool.set(loan.itemId, loan);
    }
  }

  return snapshot.tools.map((tool) => ({
    ...tool,
    activeLoan: activeLoanByTool.get(tool.documentId),
    latestLoan: latestLoanByTool.get(tool.documentId),
    available: !activeLoanByTool.has(tool.documentId),
  }));
}
