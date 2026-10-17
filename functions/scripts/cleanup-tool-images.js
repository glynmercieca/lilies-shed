// Dry run by default. Apply only with application writes paused, to prevent a
// new reference appearing between the final Firestore scan and Storage deletion.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { planImageCleanup, referencedImagePaths } = require('./plan-image-cleanup');

async function main() {
  const projectId = process.env.GCLOUD_PROJECT, bucketName = process.env.STORAGE_BUCKET;
  if (!projectId || !bucketName) throw new Error('Set GCLOUD_PROJECT and STORAGE_BUCKET explicitly.');
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--writes-paused')) throw new Error('Pause application writes, then pass --writes-paused with --apply.');
  initializeApp({ projectId, storageBucket: bucketName });
  const db = getFirestore(), bucket = getStorage().bucket(bucketName);
  const readTools = async () => (await db.collection('tools').get()).docs.map(doc => doc.data());
  const [files, tools] = await Promise.all([bucket.getFiles({ prefix: 'tools/' }).then(([files]) => files), readTools()]);
  const plan = planImageCleanup(files.map(file => ({ name: file.name, ...file.metadata })), tools, bucketName);
  console.log(JSON.stringify({ apply, objects: plan.length, bytes: plan.reduce((sum, file) => sum + file.bytes, 0), plan }, null, 2));
  if (!apply) return;
  const protectedPaths = referencedImagePaths(await readTools(), bucketName);
  for (const object of plan) {
    if (protectedPaths.has(object.path)) continue;
    // A replaced/rewritten generation must never be deleted by an older plan.
    await bucket.file(object.path).delete({ ifGenerationMatch: object.generation, ignoreNotFound: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
