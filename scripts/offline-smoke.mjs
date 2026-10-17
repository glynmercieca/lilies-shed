import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = resolve('dist/lilies-shed/browser');
const originalIndex = await readFile(resolve(root, 'index.html'), 'utf8');
const basePath = new URL(originalIndex.match(/<base href="([^"]+)"/)[1], 'http://localhost').pathname;
const manifest = JSON.parse(await readFile(resolve(root, 'ngsw.json'), 'utf8'));
await readFile(resolve(root, 'ngsw-worker.js'));
await readFile(resolve(root, 'firebase-messaging-sw.js'));
assert.equal(manifest.dataGroups.length, 0, 'Business data must not be cached by the app-shell worker');
assert.ok(!Object.keys(manifest.hashTable).some((path) => /firebase-messaging-sw|app-version\.json/.test(path)));
let nextVersion = false;
const updatedIndex = originalIndex.replace('</head>', '<meta name="offline-smoke-version" content="2"></head>');
const updatedManifest = { ...manifest, timestamp: manifest.timestamp + 1, appData: { smokeVersion: 2 },
  hashTable: { ...manifest.hashTable, [manifest.index]: createHash('sha1').update(updatedIndex).digest('hex') } };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    // An inert messaging worker tests separate registration scopes without
    // importing external Firebase code or contacting a production service.
    if (path === '/firebase-messaging-sw.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end("self.addEventListener('install', () => self.skipWaiting());");
      return;
    }
    if (path === basePath + 'ngsw.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(nextVersion ? updatedManifest : manifest));
      return;
    }
    if (!path.startsWith(basePath)) throw new Error('Outside app base path');
    const relativePath = path.slice(basePath.length);
    const filePath = !extname(relativePath) ? 'index.html' : relativePath;
    const absolute = resolve(root, filePath);
    if (!absolute.startsWith(root + '/') && !absolute.startsWith(root + '\\')) throw new Error('Invalid path');
    const content = filePath === 'index.html' && nextVersion ? updatedIndex : await readFile(absolute);
    response.setHeader('Content-Type', types[extname(filePath)] || 'application/octet-stream');
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  // No sign-in, live data or production requests are part of this smoke check.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + basePath + 'home');
  await page.getByRole('button', { name: 'Sign in with Google' }).waitFor();
  await page.waitForFunction(async (base) => Boolean((await navigator.serviceWorker.getRegistration(base))?.active), basePath, { timeout: 45_000 });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/ngsw-worker.js'));
  await page.getByRole('button', { name: 'Sign in with Google' }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase-cloud-messaging-push-scope' }));
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope));
  assert.ok(registrations.includes(origin + basePath));
  assert.ok(registrations.includes(origin + '/firebase-cloud-messaging-push-scope'));
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Sign in with Google' }).waitFor();
  await page.getByRole('status').filter({ hasText: 'You’re offline' }).waitFor();
  // Lazy routes were prefetched into the installed version as app-shell code.
  await page.goto(origin + basePath + 'privacy');
  await page.locator('app-privacy-view').waitFor();
  console.log('PASS: production worker, separate scopes, offline reload and lazy deep link');
  await context.setOffline(false);
  nextVersion = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('An updated version is ready.', { exact: true }).waitFor({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('meta[name="offline-smoke-version"]')?.getAttribute('content') === '2');
  await page.locator('app-privacy-view').waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.locator('app-privacy-view').waitFor();
  assert.equal(await page.locator('meta[name="offline-smoke-version"]').getAttribute('content'), '2');
  await mkdir('tmp', { recursive: true });
  await page.screenshot({ path: 'tmp/offline-smoke.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: ready-version prompt, reload to updated version, updated offline shell; no page errors');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
