import assert from 'node:assert/strict';

export async function verifyFiles(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'files', root: '/files', commonDir: '/files/.git', name: 'File fixture' };
      const commit = { oid: 'a'.repeat(40), parents: [], author: 'Fixture', email: 'test@example.com', timestamp: 0, subject: 'File selection' };
      const paths = ['src/features/auth/login.ts', 'src/services/auth/login.ts', 'README.md'];
      const fixture = window.__filesFixture = { calls: [], paths,
        snapshot: { repository: repo, branch: 'main', head: commit.oid, ahead: 0, behind: 0, changes: paths.map((path, i) => ({ path, indexStatus: i === 0 ? 'M' : ' ', worktreeStatus: 'M', conflict: false, untracked: false })), refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 0 },
      };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        if (request.method === 'saveSession') return;
        fixture.calls.push(request);
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = structuredClone({ ...fixture.snapshot, version: ++fixture.snapshot.version });
        if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
        if (request.method === 'details') result = { commit, body: '', files: paths.map(path => ({ path, status: 'M' })) };
        if (request.method === 'diffPreview') result = { path: request.payload.path, leftLabel: 'Before', rightLabel: 'After', left: 'before', right: 'after' };
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 10);
      } });
    });
    await page.goto(url);
    const details = page.getByTestId('details'), panel = details.locator('.file-selection-panel');
    await panel.getByText('./src/features/auth', { exact: true }).waitFor();
    await panel.getByText('./src/services/auth', { exact: true }).waitFor();
    await panel.getByText('./', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'src/features/auth/login.ts', exact: true }).click();
    await page.keyboard.press('Control+a');
    assert.equal(await panel.locator('.file-item[aria-selected="true"]').count(), 3);
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '', 'Ctrl+A must not select page text');
    await panel.getByRole('button', { name: 'Copy Paths (3)', exact: true }).click();
    await page.waitForFunction(() => window.__filesFixture.calls.some(call => call.method === 'copyText'));
    assert.equal(await page.evaluate(() => window.__filesFixture.calls.find(call => call.method === 'copyText').payload.text), 'src/features/auth/login.ts\nsrc/services/auth/login.ts\nREADME.md');
    await page.keyboard.press('Escape');
    assert.equal(await panel.locator('.file-item[aria-selected="true"]').count(), 0);
    await panel.getByRole('button', { name: 'README.md', exact: true }).click({ modifiers: ['Control'] });
    assert.equal(await panel.locator('.file-item[aria-selected="true"]').count(), 1);
    await panel.getByRole('button', { name: 'README.md', exact: true }).click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await menu.waitFor();
    assert.deepEqual((await menu.getByRole('menuitem').allTextContents()).map(value=>value.trim()), ['Open Diff in VS Code','Edit in VS Code','Copy Path']);
    await page.keyboard.press('Escape');
    await page.getByTestId('history').locator('[data-working-tree]').click();
    const groups = details.locator('.change-groups'), unstaged = groups.locator('.change-group:has(.change-heading-unstaged)'), staged = groups.locator('.change-group:has(.change-heading-staged)');
    await unstaged.getByRole('button', { name: 'Stage All', exact: true }).waitFor();
    assert.equal(await unstaged.getByRole('button', { name: 'Discard selected files…', exact: true }).isDisabled(), true);
    await unstaged.getByRole('button', { name: 'src/features/auth/login.ts', exact: true }).click();
    await page.keyboard.press('Control+a');
    assert.equal(await groups.locator('.change-file[aria-selected="true"]').count(), 4);
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
    await unstaged.getByRole('button', { name: 'Stage (3)', exact: true }).click();
    await page.waitForFunction(() => window.__filesFixture.calls.some(call => call.method === 'action'));
    assert.deepEqual(await page.evaluate(() => window.__filesFixture.calls.find(call => call.method === 'action').payload), { type: 'stage', paths: ['src/features/auth/login.ts', 'src/services/auth/login.ts', 'README.md'] });
    await page.getByTestId('action-feedback').getByText('Stage completed', { exact: true }).waitFor();
    await staged.getByRole('button', { name: 'Unstage (1)', exact: true }).click();
    await page.waitForFunction(() => window.__filesFixture.calls.filter(call => call.method === 'action').length === 2);
    assert.deepEqual(await page.evaluate(() => window.__filesFixture.calls.filter(call => call.method === 'action')[1].payload), { type: 'unstage', paths: ['src/features/auth/login.ts'] });
    await page.getByTestId('action-feedback').getByText('Unstage completed', { exact: true }).waitFor();
    await groups.focus(); await page.keyboard.press('Escape');
    assert.equal(await groups.locator('.change-file[aria-selected="true"]').count(), 0);
    await unstaged.getByRole('button', { name: 'README.md', exact: true }).click({ modifiers: ['Control'] });
    await unstaged.getByRole('button', { name: 'Discard selected files…', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.equal((await dialog.locator('.discard-paths').innerText()).trim(), 'README.md');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const draft = details.getByRole('textbox', { name: 'Commit message' });
    await draft.fill('draft stays editable'); await draft.press('Control+a'); await draft.press('Backspace');
    assert.equal(await draft.inputValue(), '', 'Text area keeps native Select All');
    assert.equal(await groups.locator('.change-file[aria-selected="true"]').count(), 1, 'Editing Ctrl+A must not change file selection');
    await unstaged.getByRole('button', { name: 'README.md', exact: true }).click({ button: 'right' });
    await menu.waitFor();
    assert.deepEqual((await menu.getByRole('menuitem').allTextContents()).map(value=>value.trim()), ['Open Diff in VS Code','Edit in VS Code','Stage 1 File','Discard 1 File…','Copy Path']);
    await page.keyboard.press('Escape');
    await draft.click({ button: 'right' });
    assert.equal(await menu.isVisible(), false, 'Editable text keeps the native context menu');
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_FILES_UI_TESTS_PASSED: full parent paths, scoped select-all, file context menus, group actions, explicit Discard and native textarea');
  } finally { await page.close(); }
}
