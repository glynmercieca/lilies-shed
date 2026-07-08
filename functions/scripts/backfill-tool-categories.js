const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const serviceAccountPath = readArg('--service-account');
const dryRun = process.argv.includes('--dry-run');

if (!serviceAccountPath) {
  console.error('Missing required --service-account argument.');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const CATEGORIES = [
  { id: 'hand-tools', name: 'Hand tools', order: 10 },
  { id: 'power-tools', name: 'Power tools', order: 20 },
  { id: 'garden-outdoor', name: 'Garden and outdoor', order: 30 },
  { id: 'ladders-access', name: 'Ladders and access', order: 40 },
  { id: 'electrical', name: 'Electrical', order: 50 },
  { id: 'plumbing', name: 'Plumbing', order: 60 },
  { id: 'painting-decorating', name: 'Painting and decorating', order: 70 },
  { id: 'measuring-layout', name: 'Measuring and layout', order: 80 },
  { id: 'safety', name: 'Safety gear', order: 90 },
  { id: 'cleaning', name: 'Cleaning', order: 100 },
  { id: 'automotive', name: 'Automotive', order: 110 },
  { id: 'other', name: 'Other', order: 120 },
];

const CATEGORY_NAME_MATCHERS = [
  {
    categoryId: 'automotive',
    terms: ['obd', 'odb', 'jump starter', 'battery charger', 'torque wrench', 'axle stand', 'car jack'],
  },
  {
    categoryId: 'measuring-layout',
    terms: ['tape measure', 'vernier', 'caliper', 'calliper', 'level', 'laser', 'square', 'ruler', 'measure'],
  },
  {
    categoryId: 'electrical',
    terms: ['ethernet', 'network', 'multimeter', 'clamp meter', 'tester', 'test kit', 'extension lead', 'cable', 'wire stripper', 'crimper', 'soldering', 'solder', 'welder', 'flood light'],
  },
  {
    categoryId: 'plumbing',
    terms: ['pipe', 'plunger', 'basin', 'tap', 'drain', 'pipe cutter', 'spring bender'],
  },
  {
    categoryId: 'hand-tools',
    terms: ['threading', 'screwdriver', 'hammer', 'spanner', 'wrench', 'pliers', 'clamp', 'chisel', 'file', 'socket', 'ratchet', 'miter box', 'mitre box', 'mither box'],
  },
  {
    categoryId: 'power-tools',
    terms: ['drill', 'impact driver', 'saw', 'sander', 'grinder', 'jigsaw', 'router', 'multitool', 'heat gun', 'nail gun'],
  },
  {
    categoryId: 'garden-outdoor',
    terms: ['mower', 'trimmer', 'strimmer', 'rake', 'shovel', 'spade', 'hoe', 'shears', 'hose', 'sprayer'],
  },
  {
    categoryId: 'ladders-access',
    terms: ['ladder', 'steps', 'step ladder', 'scaffold', 'platform'],
  },
  {
    categoryId: 'painting-decorating',
    terms: ['paint', 'brush', 'roller', 'tray', 'scraper', 'wallpaper', 'decorating'],
  },
  {
    categoryId: 'safety',
    terms: ['gloves', 'goggles', 'mask', 'respirator', 'helmet', 'ear defenders', 'knee pads'],
  },
  {
    categoryId: 'cleaning',
    terms: ['vacuum', 'washer', 'pressure washer', 'mop', 'bucket', 'broom', 'cleaner', 'air duster'],
  },
];

void backfill().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function backfill() {
  if (!dryRun) {
    await seedCategories();
  }

  const toolsSnapshot = await db.collection('tools').get();
  let changedCount = 0;
  let unchangedCount = 0;

  for (const documentSnapshot of toolsSnapshot.docs) {
    const data = documentSnapshot.data() || {};
    const toolName = readString(data.name);
    const category = detectCategory(toolName);
    const currentCategoryId = readString(data.categoryId);
    const currentCategoryName = readString(data.categoryName);
    const isChanged = currentCategoryId !== category.id || currentCategoryName !== category.name;

    if (!isChanged) {
      unchangedCount += 1;
      continue;
    }

    changedCount += 1;
    console.log(`${dryRun ? 'Would update' : 'Updating'} ${toolName || documentSnapshot.id} (${documentSnapshot.id}): ${currentCategoryName || currentCategoryId || 'none'} -> ${category.name}`);

    if (dryRun) {
      continue;
    }

    await documentSnapshot.ref.update({
      categoryId: category.id,
      categoryName: category.name,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`Category backfill complete. Changed: ${changedCount}, unchanged: ${unchangedCount}, dryRun: ${dryRun}`);
}

async function seedCategories() {
  await Promise.all(
    CATEGORIES.map((category) =>
      db.collection('categories').doc(category.id).set(category, { merge: true }),
    ),
  );
}

function detectCategory(name) {
  const normalizedName = readString(name).toLowerCase();
  if (!normalizedName) {
    return resolveCategory('other');
  }

  const match = CATEGORY_NAME_MATCHERS.find((matcher) =>
    matcher.terms.some((term) => normalizedName.includes(term)),
  );

  return resolveCategory(match?.categoryId || 'other');
}

function resolveCategory(categoryId) {
  return CATEGORIES.find((category) => category.id === categoryId) || CATEGORIES.at(-1);
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return process.argv[index + 1] || '';
}
