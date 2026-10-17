import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('category seed entrypoint loads its shared catalog and defaults to a dry run', () => {
  const result = spawnSync(process.execPath, ['functions/scripts/seed-tool-categories.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: {
      ...process.env,
      GCLOUD_PROJECT: 'demo-lilies-tests',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:1',
    },
    encoding: 'utf8',
    timeout: 20000,
  });

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /^Dry run: \d+ fixed categories\s*$/);
});
