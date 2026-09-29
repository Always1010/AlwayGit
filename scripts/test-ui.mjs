import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('dist/webview');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (path.relative(root, filename).startsWith('..')) { response.writeHead(403); response.end(); return; }
  try { const data = await readFile(filename); response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream'); response.end(data); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch(process.env.ALWAYGIT_BROWSER_EXECUTABLE ? { executablePath: process.env.ALWAYGIT_BROWSER_EXECUTABLE } : process.platform === 'win32' ? { channel: 'msedge' } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/?demo=1`;
  await page.goto(url);
  await page.getByRole('table', { name: 'Commit history' }).waitFor();
  await page.locator('.commit-row').first().waitFor();
  await page.locator('.commit-body').waitFor();
  assert.ok(await page.locator('.commit-row').count() < 180, 'History should render a virtualized subset');
  assert.ok(await page.locator('svg[role="img"]').count() > 0, 'History must have accessible Git graph rows');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/workbench-history.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Search commit history' }).fill('native diff');
  await page.waitForFunction(() => { const rows = [...document.querySelectorAll('.commit-row')]; return rows.length > 0 && rows.every(row => row.textContent.includes('native diff')); });
  assert.ok((await page.locator('.commit-row').first().innerText()).includes('native diff'));
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('navigation', { name: 'Workbench view' }).getByRole('button', { name: /Changes/ }).click();
  await page.getByRole('textbox', { name: 'Commit message' }).fill('Test UI commit draft');
  await page.getByRole('button', { name: 'Stage webview/styles.css', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'stage completed' }).waitFor();
  assert.ok(await page.locator('.change-group.staged .change-file').count() >= 2);
  await page.screenshot({ path: 'artifacts/workbench-changes.png', fullPage: true });
  await page.getByRole('button', { name: 'Commit staged changes', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'commit completed' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Commit message' }).inputValue(), '');
  await page.getByRole('button', { name: 'Create branch', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('New branch name', { exact: true }).fill('feature/ui-check');
  await page.getByRole('dialog').getByRole('button', { name: 'Create branch', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('button', { name: 'feature/ui-check', exact: true }).count());
  await page.setViewportSize({ width: 960, height: 700 });
  await page.screenshot({ path: 'artifacts/workbench-compact.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Outer workbench should not overflow horizontally');
  await page.evaluate(() => document.documentElement.classList.add('vscode-light'));
  await page.screenshot({ path: 'artifacts/workbench-light.png', fullPage: true });
  await page.evaluate(() => { document.documentElement.classList.remove('vscode-light'); document.documentElement.classList.add('vscode-high-contrast'); });
  await page.screenshot({ path: 'artifacts/workbench-high-contrast.png', fullPage: true });
  assert.deepEqual(errors, [], 'UI must not throw runtime errors');
  console.log('ALWAYGIT_UI_TESTS_PASSED: virtual graph, search, staging, commit, branch dialog, compact layout, themes');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
