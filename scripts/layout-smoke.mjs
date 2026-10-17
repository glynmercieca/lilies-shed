// Compile the real shell, state and inventory with local fixtures; never initialize Firebase.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const directory = resolve('tmp/layout-smoke');
await mkdir(directory, { recursive: true });
const entry = `
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { App } from '../../src/app/app';
import { ShedViewComponent } from '../../src/app/shed-view';
import { AboutViewComponent } from '../../src/app/about-view';
import { FirebaseClientService } from '../../src/app/core/firebase-client.service';
import { FirebaseAuthService } from '../../src/app/core/firebase-auth.service';
import { FirebaseMessagingService } from '../../src/app/core/firebase-messaging.service';
import { FirestoreToolboxService } from '../../src/app/core/firestore-toolbox.service';
import { ImageUploadService } from '../../src/app/core/image-upload.service';
import { VersionCheckService } from '../../src/app/core/version-check.service';
import { UserProfile } from '../../src/app/core/models';
const member: UserProfile = { id: 'member', email: 'member@example.test', name: 'Member', firstName: 'Member', lastName: '', picture: '' };
const currentUser = signal<UserProfile | null>(member);
const tools = Array.from({ length: 6 }, (_, i) => ({ documentId: 'tool-' + i, id: String(100000 + i), name: ['Drill', 'Hammer', 'Saw', 'Spanner', 'Sander', 'Ladder'][i], categoryId: 'other', categoryName: 'Other', description: 'Local fixture', notes: '', deleted: false, activeLoanId: null, ownerId: 'owner', owner: 'Alice', ownerFirstName: 'Alice', ownerLastName: '', ownerEmail: '', image: '/logo-minimal.svg' }));
(window as unknown as { setSignedIn: (value: boolean) => void }).setSignedIn = value => currentUser.set(value ? member : null);
bootstrapApplication(App, { providers: [provideZonelessChangeDetection(), provideNoopAnimations(),
  provideRouter([{ path: 'shed', component: ShedViewComponent }, { path: 'about', component: AboutViewComponent }]),
  { provide: FirebaseClientService, useFactory: () => { throw new Error('Layout smoke must not initialize Firebase'); } },
  { provide: FirebaseAuthService, useValue: { currentUser, ensureValidSession: async () => Boolean(currentUser()), isConfigured: () => true, isBusy: () => false, error: () => null } },
  { provide: FirebaseMessagingService, useValue: { foregroundNotification: signal(null), notificationOpenRequests: signal(0), syncCurrentUser: async () => undefined } },
  { provide: FirestoreToolboxService, useValue: { loadSnapshot: async () => ({ tools, loans: [], categories: [], notifications: [] }), loadReadNotificationIds: async () => new Set(), watchToolChanges: () => () => undefined } },
  { provide: ImageUploadService, useValue: {} },
  { provide: VersionCheckService, useValue: { start: () => undefined } },
] }).catch(error => { console.error(error); throw error; });
`;
await writeFile(resolve(directory, 'entry.ts'), entry);
await writeFile(resolve(directory, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.app.json', include: ['entry.ts', '../../src/**/*.ts'], exclude: ['../../src/**/*.spec.ts'] }));
const compile = spawnSync(process.execPath, ['scripts/run-ng.cjs', 'build', '--configuration=development', '--browser=tmp/layout-smoke/entry.ts', '--ts-config=tmp/layout-smoke/tsconfig.json', '--output-path=tmp/layout-smoke/dist'], { stdio: 'inherit', windowsHide: true });
assert.equal(compile.status, 0, 'Fixture application must compile');
const root = resolve(directory, 'dist/browser');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = extname(pathname) ? resolve(root, '.' + pathname) : resolve(root, 'index.html');
    assert.ok(file.startsWith(root + (process.platform === 'win32' ? '\\' : '/')));
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    const permitted = url.origin === origin
      || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
    return permitted ? route.continue() : route.abort();
  });
  for (const width of [1920, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '/shed');
    await page.waitForFunction(() => document.querySelectorAll('.tool-card').length === 6);
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
      return { content: box('.content-shell'), header: box('.app-header'), grid: box('.tool-section-grid'), nav: box('.bottom-nav'), overflow: document.documentElement.scrollWidth > innerWidth, cards: Array.from(document.querySelectorAll('.tool-card')).map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })) };
    });
    assert.ok(Math.abs((layout.content.left + layout.content.right) / 2 - width / 2) < 1, 'Content must be centered at ' + width);
    assert.ok(layout.content.width <= 920.5);
    assert.ok(layout.grid.top >= layout.header.bottom, 'Cards must clear the header');
    assert.equal(layout.overflow, false, 'Page must not overflow horizontally');
    const columns = width >= 992 ? 3 : 2;
    assert.equal(layout.cards.slice(0, columns).every(card => Math.abs(card.y - layout.cards[0].y) < 1), true);
    assert.ok(layout.cards[columns].y > layout.cards[0].y, 'Cards must wrap at ' + width);
    await page.screenshot({ path: resolve(directory, 'shed-' + width + '.png'), fullPage: false });
    console.log('PASS: signed-in shell, loaded inventory and responsive grid at ' + width + 'px');
  }
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(origin + '/about');
  await page.evaluate(() => window.setSignedIn(false));
  await page.waitForFunction(() => !document.querySelector('.app-header'));
  const publicContent = await page.locator('.content-shell').boundingBox();
  assert.ok(Math.abs(publicContent.x + publicContent.width / 2 - 960) < 1, 'Public content stays centered');
  assert.deepEqual(errors, []);
  console.log('PASS: signed-out desktop centering and no browser errors; Firebase never initialized');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
