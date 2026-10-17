function planBorrowMigration(tools, loans) {
  const aliases = new Map();
  const conflicts = [];
  const activeByTool = new Map();
  const loanUpdates = [];
  for (const tool of tools) {
    for (const alias of new Set([tool.documentId, String(tool.id ?? tool.documentId)])) {
      if (aliases.has(alias) && aliases.get(alias) !== tool.documentId) conflicts.push(`Ambiguous tool ID: ${alias}`);
      aliases.set(alias, tool.documentId);
    }
  }
  for (const loan of loans) {
    const toolId = aliases.get(String(loan.toolId || loan.itemId || ''));
    const active = !loan.returnDate || (typeof loan.returnDate === 'string' && !loan.returnDate.trim());
    if (!toolId) {
      if (active) conflicts.push(`Orphaned active loan: ${loan.documentId}`);
      continue;
    }
    if (active) {
      if (activeByTool.has(toolId)) conflicts.push(`Multiple active loans for tool: ${toolId}`);
      if (!loan.borrowerId) conflicts.push(`Missing borrower: ${loan.documentId}`);
      activeByTool.set(toolId, loan.documentId);
    }
    loanUpdates.push({ id: loan.documentId, data: { toolId, ...(active ? { returnDate: '' } : {}) } });
  }
  return {
    conflicts,
    loans: loanUpdates,
    tools: tools.map((tool) => ({ id: tool.documentId, data: {
      borrowStateVersion: 1,
      activeLoanId: activeByTool.get(tool.documentId) ?? null,
      deleted: tool.deleted === true || String(tool.deleted).toLowerCase() === 'true',
    } })),
  };
}
module.exports = { planBorrowMigration };
