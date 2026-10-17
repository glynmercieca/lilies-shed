const { planBorrowMigration } = require('./plan-borrow-migration');

function verifyInventoryReadModel(tools, loans) {
  const plan = planBorrowMigration(tools, loans);
  const conflicts = [...plan.conflicts];
  const toolMap = new Map(tools.map(tool => [tool.documentId, tool]));
  const loanMap = new Map(loans.map(loan => [loan.documentId, loan]));
  for (const update of plan.tools) {
    if (Object.entries(update.data).some(([key, value]) => toolMap.get(update.id)[key] !== value)) conflicts.push(`Tool needs migration: ${update.id}`);
  }
  for (const update of plan.loans) {
    if (Object.entries(update.data).some(([key, value]) => loanMap.get(update.id)[key] !== value)) conflicts.push(`Loan needs migration: ${update.id}`);
  }
  return conflicts;
}

module.exports = { verifyInventoryReadModel };
