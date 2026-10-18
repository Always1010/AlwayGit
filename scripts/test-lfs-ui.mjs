import assert from 'node:assert/strict';

/** Browser-side extension-host fixture for current and historical Git LFS flows. */
function installFixture() {
  const repo = { id: 'lfs-fixture', root: '/lfs', commonDir: '/lfs/.git', name: 'LFS fixture' };
  const head = 'a'.repeat(40), parent = 'b'.repeat(40), object = 'c'.repeat(64), currentObject = 'd'.repeat(64), path = 'assets/model.bin';
  const commit = { oid: head, parents: [parent], author: 'Fixture', email: 'fixture@example.com', timestamp: 1700000000, subject: 'Historical LFS fixture' };
  const destinations = {
    origin: { fetch: '1'.repeat(64), push: '2'.repeat(64) },
    backup: { fetch: '3'.repeat(64), push: '4'.repeat(64) },
  };
  const fixture = window.__lfsFixture = {
    calls: [], actions: [], version: 1, historicalAvailable: false, trackApplied: false,
    session: { version: 2, language: 'en', repoId: repo.id, views: { [repo.id]: { tab: 'history', search: '', selectedOid: head, selectedFile: path } } },
  };
  const snapshot = () => ({ repository: repo, branch: 'main', head, ahead: 0, behind: 0, remotes: ['origin', 'backup'], changes: [],
    refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: head }], stashes: [], worktrees: [],
    operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: fixture.version });
  const status = () => ({ available: true, version: 'git-lfs/3.6.1', filterConfigured: true, files: [{ path, oid: currentObject, size: 4096,
    worktree: 'pointer', localObject: 'missing', staged: false, unstaged: false }],
    statusText: 'On branch main\nObjects to be pushed to origin/main:', checkedAt: 1700000000000, remoteAvailability: 'unknown', truncated: false,
    destinations, head, branch: 'main' });
  window.acquireVsCodeApi = () => ({ getState: () => fixture.session, setState: state => { fixture.session = state; }, postMessage(request) {
    fixture.calls.push(structuredClone(request)); let result;
    if (request.method === 'repositories') result = [repo];
    if (['repositoryCollections', 'repositoryStatuses'].includes(request.method)) result = [];
    if (request.method === 'repositoryOrder') result = { root: [], collections: {} };
    if (request.method === 'interfaceSettings') result = { language: 'en' };
    if (request.method === 'operationSettings') result = { scope: 'user' };
    if (request.method === 'snapshot') result = snapshot();
    if (request.method === 'history') result = { commits: [commit], tips: [head], nextOffset: 1, hasMore: false };
    if (request.method === 'details') result = { commit, parent, body: '', files: [{ path, status: 'M' }] };
    if (request.method === 'lfsStatus') result = status();
    if (request.method === 'lfsDestinations') result = destinations;
    if (request.method === 'lfsTrackPreview') result = { token: '11111111-1111-4111-8111-111111111111', before: '',
      after: `${request.payload.pattern} filter=lfs diff=lfs merge=lfs -text\n`, pattern: request.payload.pattern, operation: request.payload.operation, head, branch: 'main' };
    if (request.method === 'diffPreview') {
      const target = request.payload;
      result = fixture.historicalAvailable
        ? { kind: 'text', path: target.path, leftLabel: 'Historical LFS content', rightLabel: 'Current working file', left: 'downloaded historical object\n', right: 'current content\n',
            lfs: [{ side: 'left', revision: head, path, oid: object, size: 4096, localObject: 'available', resolved: true, downloadable: false }] }
        : { kind: 'binary', reason: 'lfs-missing', path: target.path, leftLabel: 'Historical LFS pointer', rightLabel: 'Current working file',
            lfs: [{ side: 'left', revision: head, path, oid: object, size: 4096, localObject: 'missing', resolved: false, downloadable: true }] };
    }
    if (request.method === 'action') {
      fixture.actions.push(structuredClone(request.payload));
      if (request.payload.type === 'lfs.fetchHistorical') fixture.historicalAvailable = true;
      if (request.payload.type === 'lfs.track') fixture.trackApplied = true;
      fixture.version++; result = { snapshot: snapshot() };
    }
    setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 0);
  } });
}

export async function verifyLfs(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1520, height: 1080 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(installFixture);
    await page.goto(url.replace('?demo=1', ''));
    const diff = page.getByTestId('diff-preview');
    await diff.getByText('This historical LFS object is missing from the local cache', { exact: true }).waitFor();
    const initialTarget = await page.evaluate(() => window.__lfsFixture.calls.filter(call => call.method === 'diffPreview').at(-1).payload);
    assert.deepEqual(initialTarget, { kind: 'commit', oid: 'a'.repeat(40), path: 'assets/model.bin', previousPath: undefined,
      parent: 'b'.repeat(40), paged: true });

    await page.getByTestId('toolbar-more').click();
    await page.getByRole('menuitem', { name: 'Git LFS', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Git LFS', exact: true });
    await dialog.getByText('git-lfs/3.6.1', { exact: true }).waitFor();
    await dialog.getByText('LFS process filter configured', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__lfsFixture.actions.length), 0, 'Opening status performs no LFS transfer');

    const remote = dialog.getByRole('combobox', { name: 'Remote', exact: true });
    await remote.selectOption('backup');
    await dialog.getByRole('checkbox', { name: 'Select assets/model.bin', exact: true }).check();
    await dialog.getByRole('button', { name: 'Fetch selected', exact: true }).click();
    await page.waitForFunction(() => window.__lfsFixture.actions.some(action => action.type === 'lfs.fetch'));
    const selectedFetch = await page.evaluate(() => window.__lfsFixture.actions.find(action => action.type === 'lfs.fetch'));
    assert.deepEqual(selectedFetch, { type: 'lfs.fetch', remote: 'backup', expectedDestination: '3'.repeat(64), oids: ['d'.repeat(64)], expectedHead: 'a'.repeat(40), expectedBranch: 'main' }, 'Selected fetch is explicit and bound to the reviewed remote');

    await dialog.getByRole('button', { name: 'Retry branch object upload', exact: true }).click();
    await page.waitForFunction(() => window.__lfsFixture.actions.some(action => action.type === 'lfs.push'));
    const push = await page.evaluate(() => window.__lfsFixture.actions.find(action => action.type === 'lfs.push'));
    assert.deepEqual(push, { type: 'lfs.push', remote: 'backup', expectedDestination: '4'.repeat(64), expectedHead: 'a'.repeat(40), expectedBranch: 'main' }, 'Upload remains bound to the selected remote and direction');

    await dialog.getByRole('textbox', { name: 'Filename / glob', exact: true }).fill('assets/new.bin');
    await dialog.getByRole('button', { name: 'Preview attributes', exact: true }).click();
    await dialog.getByText('assets/new.bin filter=lfs diff=lfs merge=lfs -text', { exact: true }).waitFor();
    await dialog.screenshot({ path: 'artifacts/lfs-dialog.png' });
    const preview = await page.evaluate(() => window.__lfsFixture.calls.filter(call => call.method === 'lfsTrackPreview').at(-1).payload);
    assert.deepEqual(preview, { pattern: 'assets/new.bin', literal: true, operation: 'track' });
    await dialog.getByRole('button', { name: 'Apply attributes preview', exact: true }).click();
    await page.waitForFunction(() => window.__lfsFixture.trackApplied);
    const track = await page.evaluate(() => window.__lfsFixture.actions.find(action => action.type === 'lfs.track'));
    assert.deepEqual(track, { type: 'lfs.track', token: '11111111-1111-4111-8111-111111111111' }, 'Apply submits only the reviewed preview token');
    await dialog.getByRole('button', { name: 'Apply attributes preview', exact: true }).waitFor({ state: 'hidden' });
    await dialog.getByText('Close', { exact: true }).click();

    await diff.getByRole('button', { name: 'Download historical LFS object…', exact: true }).click();
    const download = page.getByRole('dialog', { name: 'Download historical LFS object…', exact: true });
    await download.getByRole('combobox', { name: 'Download remote', exact: true }).selectOption('backup');
    await download.screenshot({ path: 'artifacts/lfs-historical-download.png' });
    await download.getByRole('button', { name: 'Download to local cache', exact: true }).click();
    await page.waitForFunction(() => window.__lfsFixture.actions.some(action => action.type === 'lfs.fetchHistorical'));
    const historical = await page.evaluate(() => window.__lfsFixture.actions.find(action => action.type === 'lfs.fetchHistorical'));
    assert.deepEqual(historical, { type: 'lfs.fetchHistorical', revision: 'a'.repeat(40), path: 'assets/model.bin', oid: 'c'.repeat(64), remote: 'backup', expectedDestination: '3'.repeat(64) });
    await diff.getByText('downloaded historical object', { exact: true }).waitFor();
    await diff.screenshot({ path: 'artifacts/lfs-historical-resolved.png' });
    const targets = await page.evaluate(() => window.__lfsFixture.calls.filter(call => call.method === 'diffPreview').map(call => call.payload));
    assert.ok(targets.length >= 2, 'Historical download refreshes the preview');
    assert.deepEqual(targets.at(-1), initialTarget, 'Historical download reissues the same immutable preview target');
    assert.deepEqual(errors, [], 'Git LFS flows must not produce browser runtime errors');
  } catch (error) { console.error((await page.locator('body').innerText()).slice(-6000)); throw error; }
  finally { await page.close(); }
}
