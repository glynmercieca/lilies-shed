const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');

const workspaceRoot = process.cwd();
const environmentFile = join(workspaceRoot, 'src', 'environments', 'environment.ts');
const outputFile = join(workspaceRoot, 'public', 'app-version.json');
const versionPattern = /version:\s*'(\d+\.\d+\.\d+)'/;

const content = readFileSync(environmentFile, 'utf8');
const match = content.match(versionPattern);

if (!match) {
  throw new Error(`Unable to locate app version in ${environmentFile}.`);
}

const payload = {
  version: match[1],
  generatedAt: new Date().toISOString(),
};

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`);
