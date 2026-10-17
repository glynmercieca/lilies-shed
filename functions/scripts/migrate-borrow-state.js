// Run with Application Default Credentials against an explicitly selected project.
// Dry-run by default. Deploy the reservation rules BEFORE applying this migration.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { planBorrowMigration } = require('./plan-borrow-migration');

async function main() {
  const projectId = process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Set GCLOUD_PROJECT explicitly.');
  initializeApp({ projectId });
  const db = getFirestore();
  const apply = process.argv.includes('--apply');
  const [tools, loans] = await Promise.all([db.collection('tools').get(), db.collection('loan').get()]);
  const plan = planBorrowMigration(
    tools.docs.map((doc) => ({ documentId: doc.id, ...doc.data() })),
    loans.docs.map((doc) => ({ documentId: doc.id, ...doc.data() })),
  );
  console.log(JSON.stringify({ apply, tools: plan.tools.length, loans: plan.loans.length, conflicts: plan.conflicts }, null, 2));
  if (plan.conflicts.length) throw new Error('Resolve conflicting/orphaned active loans before applying. No writes made.');
  if (!apply) return;
  // Maintenance window required: rules deny legacy writes, and no new client may
  // borrow until the migration is complete. Re-running is safe in that window.
  for (const update of plan.loans) await db.collection('loan').doc(update.id).update(update.data);
  for (const update of plan.tools) await db.collection('tools').doc(update.id).update(update.data);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
