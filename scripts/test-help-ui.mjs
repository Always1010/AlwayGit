import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

/** Exercise the installed Webview's CSP shape, offline assets, and read-only behavior. */
export async function verifyHelp(browser, url) {
  await mkdir('artifacts', { recursive: true });
  for (const language of ['en', 'zh-CN']) {
    const active = language === 'zh-CN', page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await page.route('**/*', async route => {
        const request = route.request();
        if (new URL(request.url()).origin !== new URL(url).origin) { externalRequests.push(request.url()); await route.abort(); return; }
        if (!request.isNavigationRequest()) { await route.continue(); return; }
        const response = await route.fetch();
        const body = (await response.text()).replace(/<script /g, '<script nonce="help-test" ').replace('<head>', '<head><meta property="csp-nonce" nonce="help-test">');
        await route.fulfill({ response, body, headers: { ...response.headers(), 'content-security-policy': "default-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'nonce-help-test'; connect-src 'none'" } });
      });
      await page.addInitScript(({ language, active }) => {
        const repo = { id: 'help-repo', root: '/help-repo', commonDir: '/help-repo/.git', name: 'Help fixture' };
        const commit = { oid: 'a'.repeat(40), parents: [], author: 'Fixture', email: 'test@example.com', timestamp: 0, subject: 'Existing commit' };
        const fixture = window.__helpFixture = {
          calls: [], session: { version: 2, language, repoId: active ? repo.id : undefined, drafts: { [repo.id]: 'Keep this draft' }, layout: { preset: 'workbench', sidebar: 248, details: 330, diff: 230, author: 112, date: 130, font: 13, row: 24 }, views: { [repo.id]: { search: '', tab: 'changes' } } },
        };
        window.acquireVsCodeApi = () => ({ getState: () => fixture.session, setState: session => { fixture.session = session; }, postMessage(request) {
          fixture.calls.push(request);
          let result;
          if (request.method === 'repositories') result = active ? [repo] : [];
          if (request.method === 'repositoryCollections' || request.method === 'repositoryStatuses') result = [];
          if (request.method === 'operationSettings') result = { allowDetachedHead: false, scope: 'user' };
          if (request.method === 'snapshot') result = { repository: repo, branch: 'main', head: commit.oid, ahead: 0, behind: 0, remotes: [], changes: [{ path: 'notes.txt', indexStatus: ' ', worktreeStatus: 'M', untracked: false }], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
          if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
          if (request.method === 'details') result = { commit, body: '', files: [] };
          if (request.method === 'diffPreview') result = { path: 'notes.txt', leftLabel: 'Index', rightLabel: 'Working Tree', left: 'before', right: 'after' };
          setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 0);
        } });
      }, { language, active });
      await page.goto(url);
      await page.getByTestId('workbench').waitFor();
      if (active) {
        await page.getByRole('textbox', { name: 'Commit message' }).waitFor();
        await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
        await page.getByTestId('diff-preview').waitFor();
      } else await page.getByText('No repositories added', { exact: true }).waitFor();
      const baseline = await page.evaluate(() => structuredClone(window.__helpFixture.session));
      const label = language === 'en' ? 'Help & Guide' : '帮助与指南';
      const trigger = active ? page.getByRole('button', { name: label, exact: true }) : page.getByRole('button', { name: 'Quick start', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      await dialog.getByRole('heading', { name: language === 'en' ? 'Quick start: make your first commit' : '快速开始：完成第一次提交', exact: true }).waitFor({ timeout: 10000 });
      const image = dialog.locator('img').first();
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const image = document.querySelector('.help-content img'); return image?.complete && image.naturalWidth > 0; });
      await page.screenshot({ path: `artifacts/help-${language}.png` });

      await dialog.getByRole('button', { name: language === 'en' ? 'Install and launch' : '安装与启动', exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: language === 'en' ? 'Full manual' : '完整手册', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.ok(await dialog.locator('.help-content').evaluate(element => element.scrollTop > 0), 'An internal link locates the requested subsection');
      await dialog.getByRole('button', { name: language === 'en' ? 'Common tasks' : '常见任务', exact: true }).click();
      const search = dialog.getByRole('searchbox');
      await search.fill('INDEX');
      assert.ok(await dialog.locator('.help-topic').count() > 0, 'Search covers body content in both editions');
      await search.fill('no-such-topic-12345');
      assert.equal(await dialog.locator('.help-topic').count(), 0);
      await dialog.getByRole('status').waitFor();
      await search.fill('');
      await dialog.getByRole('button', { name: language === 'en' ? 'Quick start' : '快速开始', exact: true }).click();
      await dialog.locator('.help-topic').last().click();
      await dialog.locator('table').waitFor();
      for (const width of [600, 380]) {
        await page.setViewportSize({ width, height: 820 });
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Dialog fits narrow windows');
        assert.ok(await dialog.locator('.help-content').evaluate(element => element.clientHeight > 100), 'Content remains scrollable in narrow windows');
      }
      await page.screenshot({ path: `artifacts/help-${language}-narrow.png` });
      // Keyboard focus stays within the dialog and returns to the invoking control.
      const headerClose = dialog.locator('.modal-heading button');
      await headerClose.focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.locator('.modal-footer button').evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Tab');
      assert.equal(await headerClose.evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      if (active) {
        assert.equal(await page.getByRole('textbox', { name: 'Commit message' }).inputValue(), 'Keep this draft');
        assert.ok(await page.getByTestId('diff-preview').getByText('after', { exact: true }).count() > 0);
      }
      const after = await page.evaluate(() => structuredClone(window.__helpFixture.session));
      for (const key of ['repoId', 'drafts', 'layout', 'views', 'language', 'appearance']) assert.deepEqual(after[key], baseline[key], `Help preserves ${key}`);
      assert.deepEqual(await page.evaluate(() => window.__helpFixture.calls.filter(call => ['action', 'openFile', 'openProject', 'openWorkbench', 'openWorktree'].includes(call.method))), [], 'Help never performs repository or native editor operations');
      assert.deepEqual(externalRequests, [], 'Manual content and images are available offline');
      assert.deepEqual(errors, []);
    } catch (error) {
      console.error('Help diagnostics:', JSON.stringify({ errors, externalRequests }));
      await page.screenshot({ path: `artifacts/help-${language}-failure.png` });
      throw error;
    } finally { await page.close(); }
  }
}
