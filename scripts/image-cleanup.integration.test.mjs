import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import cleanup from '../functions/scripts/plan-image-cleanup.js';

const bucket = 'test-bucket';
const path = suffix => `tools/owner/1234-dead-beef-${suffix}.webp`;
const url = name => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
const now = Date.parse('2026-10-17T00:00:00Z');
const oldFile = name => ({ name, generation: '12', size: '100', timeCreated: '2026-10-01T00:00:00Z', updated: '2026-10-01T00:00:00Z' });

test('cleanup protects linked detail/thumbnail images, soft-deleted tools, recent uploads and legacy assets', () => {
  const files = [oldFile(path('detail')), oldFile(path('thumb')), oldFile('tools/owner/legacy.jpg'), oldFile('elsewhere/1234-dead-detail.webp'),
    { ...oldFile('tools/owner/5678-beef-detail.webp'), updated: '2026-10-16T00:00:00Z' }, oldFile('tools/owner/9876-beef-detail.webp')];
  const tools = [{ deleted: true, image: url(path('detail')), thumbnail: url(path('thumb')) }];
  assert.deepEqual(cleanup.planImageCleanup(files, tools, bucket, now), [{ path: 'tools/owner/9876-beef-detail.webp', generation: '12', bytes: 100 }]);
  assert.deepEqual(cleanup.planImageCleanup([oldFile(path('detail'))], [{ image: url(path('detail')).replace(bucket, 'another-bucket') }], bucket, now).map(file => file.path), [path('detail')]);
});

async function runCleanup(args, tools = []) {
  const deletes = [];
  let toolReads = 0;
  const file = { name: path('detail'), metadata: oldFile(path('detail')), delete: async options => deletes.push(options) };
  const modules = {
    'firebase-admin/app': { initializeApp: () => {} },
    'firebase-admin/firestore': { getFirestore: () => ({ collection: () => ({ get: async () => { toolReads++; return { docs: tools.map(data => ({ data: () => data })) }; } }) }) },
    'firebase-admin/storage': { getStorage: () => ({ bucket: () => ({ getFiles: async () => [[file]], file: () => file }) }) },
    './plan-image-cleanup': { ...cleanup, planImageCleanup: (files, records, name) => cleanup.planImageCleanup(files, records, name, now) },
  };
  let error = '';
  const context = vm.createContext({ require: name => modules[name], process: { argv: ['node', 'cleanup', ...args], env: { GCLOUD_PROJECT: 'demo', STORAGE_BUCKET: bucket } }, console: { log: () => {}, error: message => { error = message; } } });
  vm.runInContext(await readFile('functions/scripts/cleanup-tool-images.js', 'utf8'), context);
  // The script uses resolved local fake APIs; flush its asynchronous main/catch.
  for (let index = 0; index < 20; index++) await Promise.resolve();
  return { deletes, toolReads, error };
}

test('maintenance cleanup is dry-run by default and requires paused writes before conditional deletion', async () => {
  assert.equal((await runCleanup([])).deletes.length, 0);
  const denied = await runCleanup(['--apply']);
  assert.match(denied.error, /Pause application writes/);
  assert.equal(denied.deletes.length, 0);
  const applied = await runCleanup(['--apply', '--writes-paused']);
  assert.equal(applied.toolReads, 2);
  assert.equal(applied.deletes.length, 1);
  assert.equal(applied.deletes[0].ifGenerationMatch, '12');
  assert.equal((await runCleanup(['--apply', '--writes-paused'], [{ image: url(path('detail')) }])).deletes.length, 0);
});
