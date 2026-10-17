const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGED_PATH = /^tools\/[^/]+\/\d+-[0-9a-f-]+-(detail|thumb)\.(webp|png)$/;

function storagePathFromUrl(value, bucket) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'gs:' && url.hostname === bucket) return decodeURIComponent(url.pathname.slice(1));
    const prefix = `/v0/b/${bucket}/o/`;
    if (url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith(prefix)) return decodeURIComponent(url.pathname.slice(prefix.length));
    if (url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/' + bucket + '/')) return decodeURIComponent(url.pathname.slice(bucket.length + 2));
  } catch { /* Malformed and third-party links do not identify managed objects. */ }
  return null;
}

function referencedImagePaths(tools, bucket) {
  // Soft-deleted tools still protect their images; only genuinely unreferenced
  // replacements and failed uploads are eligible for garbage collection.
  return new Set(tools.flatMap(tool => [tool.image, tool.thumbnail]).map(url => storagePathFromUrl(url, bucket)).filter(Boolean));
}

function planImageCleanup(files, tools, bucket, now = Date.now()) {
  const referenced = referencedImagePaths(tools, bucket);
  return files.filter(file => {
    const created = Date.parse(file.timeCreated), updated = Date.parse(file.updated ?? file.timeCreated);
    return MANAGED_PATH.test(file.name) && !referenced.has(file.name) && file.generation
      && Number.isFinite(created) && Number.isFinite(updated)
      && Math.max(created, updated) <= now - RETENTION_MS;
  }).map(file => ({ path: file.name, generation: String(file.generation), bytes: Number(file.size) || 0 }));
}

module.exports = { planImageCleanup, referencedImagePaths, RETENTION_MS };
