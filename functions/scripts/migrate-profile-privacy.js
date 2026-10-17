// Dry run by default. Maintenance window required; use explicit GCLOUD_PROJECT.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { publicProfile, canonicalRecipient } = require('./plan-profile-migration');
async function main() {
  const projectId = process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('Set GCLOUD_PROJECT explicitly.');
  initializeApp({ projectId });
  const db = getFirestore();
  const [users, notifications] = await Promise.all([db.collection('users').get(), db.collection('notifications').get()]);
  const ids = users.docs.map(d => d.id);
  const updates = [], conflicts = [];
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
