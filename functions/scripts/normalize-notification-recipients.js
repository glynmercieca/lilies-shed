// Dry run by default. Run with Application Default Credentials and an explicit project.
// --apply writes only recipientId; document IDs, dates and users' read marks are preserved.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');

const projectIndex = process.argv.indexOf('--project');
const projectId = projectIndex >= 0 ? process.argv[projectIndex + 1] : '';
if (!projectId || projectId.startsWith('--')) {
  console.error(
    'Usage: node scripts/normalize-notification-recipients.js --project PROJECT_ID [--apply]',
  );
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const apply = process.argv.includes('--apply');

async function normalize() {
  let cursor;
  let changed = 0;
  let scanned = 0;
  while (true) {
    let source = db.collection('notifications').orderBy(FieldPath.documentId()).limit(400);
    if (cursor) source = source.startAfter(cursor);
    const page = await source.get();
    if (page.empty) break;
    const batch = db.batch();
    let writes = 0;
    for (const snapshot of page.docs) {
      const original = snapshot.data().recipientId;
      const normalized = typeof original === 'string' ? original.trim().toLowerCase() : '';
      if (original !== normalized) {
        changed++;
        writes++;
        if (apply) batch.update(snapshot.ref, { recipientId: normalized });
      }
    }
    if (apply && writes) await batch.commit();
    scanned += page.size;
    cursor = page.docs.at(-1);
  }
  console.log(
    `${apply ? 'Updated' : 'Would update'} ${changed} of ${scanned} notifications in ${projectId}.`,
  );
}

normalize().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
