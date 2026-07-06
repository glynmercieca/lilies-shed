const { randomUUID } = require('node:crypto');
const { extname } = require('node:path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const serviceAccountPath = readArg('--service-account');
const bucketName = readArg('--bucket') || 'shed-3fc03.firebasestorage.app';
const dryRun = process.argv.includes('--dry-run');

if (!serviceAccountPath) {
  console.error('Missing required --service-account argument.');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: bucketName,
});

const db = getFirestore();
const bucket = getStorage().bucket(bucketName);

void migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function migrate() {
  const toolsSnapshot = await db.collection('tools').get();
  let migratedCount = 0;
  let skippedCount = 0;

  for (const documentSnapshot of toolsSnapshot.docs) {
    const data = documentSnapshot.data() || {};
    const imageUrl = readString(data.image);
    const ownerId = readString(data.ownerId) || 'unknown';
    const toolName = readString(data.name) || documentSnapshot.id;

    if (!shouldMigrateImage(imageUrl)) {
      skippedCount += 1;
      continue;
    }

    console.log(`Migrating ${toolName} (${documentSnapshot.id}) from ${imageUrl}`);
    if (dryRun) {
      migratedCount += 1;
      continue;
    }

    const upload = await downloadAndUploadImage(imageUrl, ownerId, documentSnapshot.id);
    await documentSnapshot.ref.update({
      image: upload.downloadUrl,
      updatedAt: new Date(),
    });
    migratedCount += 1;
  }

  console.log(`Migration complete. Migrated: ${migratedCount}, skipped: ${skippedCount}, dryRun: ${dryRun}`);
}

async function downloadAndUploadImage(imageUrl, ownerId, toolDocumentId) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Unable to download image: ${imageUrl} (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const extension = resolveExtension(imageUrl, contentType);
  const filePath = `tools/${ownerId}/migrated-${toolDocumentId}-${Date.now()}.${extension}`;
  const token = randomUUID();
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      cacheControl: 'public,max-age=31536000,immutable',
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return {
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`,
    filePath,
  };
}

function shouldMigrateImage(imageUrl) {
  if (!imageUrl) {
    return false;
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    return false;
  }

  return !imageUrl.includes('firebasestorage.googleapis.com') && !imageUrl.includes('storage.googleapis.com');
}

function resolveExtension(imageUrl, contentType) {
  const fromUrl = extname(new URL(imageUrl).pathname).replace('.', '').trim().toLowerCase();
  if (fromUrl) {
    return sanitizeExtension(fromUrl);
  }

  const fromContentType = contentType.split('/').pop()?.trim().toLowerCase() || 'bin';
  return sanitizeExtension(fromContentType.replace('jpeg', 'jpg'));
}

function sanitizeExtension(extension) {
  return extension.replace(/[^a-z0-9]/g, '') || 'bin';
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
