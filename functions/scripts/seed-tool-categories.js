const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const categories = require('../../src/app/core/tool-categories.json');

async function main() {
  if (!process.env.GCLOUD_PROJECT) throw new Error('Set GCLOUD_PROJECT explicitly.');
  console.log(`${process.argv.includes('--apply') ? 'Seeding' : 'Dry run:'} ${categories.length} fixed categories`);
  if (!process.argv.includes('--apply')) return;
  initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore();
  for (const category of categories) {
    // Create only missing records; preserve any existing discovered/admin edits.
    await db.runTransaction(async (transaction) => {
      const ref = db.collection('categories').doc(category.id);
      if (!(await transaction.get(ref)).exists) transaction.create(ref, category);
    });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
