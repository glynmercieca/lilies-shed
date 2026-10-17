// Dry run by default. Maintenance window required; use explicit GCLOUD_PROJECT.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { publicProfile, canonicalRecipient } = require('./plan-profile-migration');
async function main() {
  const projectId = process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Set GCLOUD_PROJECT explicitly.');
  initializeApp({ projectId });
  const db = getFirestore();
  const [users, notifications, tools, loans] = await Promise.all([
    db.collection('users').get(), db.collection('notifications').get(),
    db.collection('tools').get(), db.collection('loan').get(),
  ]);
  // Auth, not client profile fields, is authoritative for recipient identity.
  const ids = [];
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    ids.push(...page.users.map(user => user.uid));
    pageToken = page.pageToken;
  } while (pageToken);
  const updates = [], conflicts = [];
  for (const tool of tools.docs) {
    if (!ids.includes(tool.data().ownerId)) conflicts.push({ id: tool.id, reason: 'Tool owner is not an exact Auth UID; reconcile through trusted administration.' });
  }
  for (const loan of loans.docs) {
    if (!loan.data().returnDate && !ids.includes(loan.data().borrowerId)) conflicts.push({ id: loan.id, reason: 'Active borrower is not an exact Auth UID; reconcile through trusted administration.' });
  }
  for (const notification of notifications.docs) {
    try {
      const recipientId = canonicalRecipient(notification.data().recipientId, ids);
      if (recipientId !== notification.data().recipientId) updates.push({ ref: notification.ref, recipientId });
    } catch (error) { conflicts.push({ id: notification.id, reason: error.message }); }
  }
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify({ apply, profiles: users.size, recipientUpdates: updates.length, conflicts }, null, 2));
  if (conflicts.length) throw new Error('Resolve recipients before applying; no writes made.');
  if (!apply) return;
  for (const user of users.docs) {
    // Replacement removes any unexpected fields if this projection was created before.
    await db.collection('publicProfiles').doc(user.id).set(publicProfile(user.data()));
  }
  for (const update of updates) await update.ref.update({ recipientId: update.recipientId });
  // users stays private, including all legacy tokens, read marks and preferences.
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
