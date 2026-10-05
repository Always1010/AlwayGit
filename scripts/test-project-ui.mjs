import assert from 'node:assert/strict';

export async function verifyProjectOpen(browser, url) {
  for (const language of ['en', 'zh-CN']) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(language => {
        const repo = { id: 'project', root: 'D:\\Projects\\Current repository', commonDir: 'D:\\Projects\\Current repository\\.git', name: 'Current repository' };
        const other = { ...repo, id: 'other', root: 'D:\\Projects\\Other repository', commonDir: 'D:\\Projects\\Other repository\\.git', name: 'Other repository' };
        const fixture = window.__projectFixture = {
          calls: [], result: { kind: 'current-window', root: repo.root, exactRoot: true }, hold: false, pending: [], error: undefined,
          session: { repoId: repo.id, drafts: { [repo.id]: 'Keep this draft' } },
          reply(request) { window.postMessage({ type: 'response', id: request.id, result: this.result, ...(this.error ? { error: { message: this.error } } : {}) }, '*'); },
        };
        window.acquireVsCodeApi = () => ({
          getState: () => fixture.session, setState: value => { fixture.session = value; },
          postMessage(request) {
            fixture.calls.push(request);
            if (request.method === 'openProject') {
              if (fixture.hold) fixture.pending.push(request); else fixture.reply(request);
              return;
            }
            let result;
            if (request.method === 'interfaceSettings') result = { language };
            if (request.method === 'repositories') result = [repo, other];
            if (['repositoryCollections', 'repositoryStatuses', 'terminalList'].includes(request.method)) result = [];
            if (request.method === 'snapshot') result = { repository: request.repoId === other.id ? other : repo, branch: 'main', ahead: 0, behind: 0, changes: [], refs: [], remotes: [], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
            if (request.method === 'history') result = { commits: [], tips: [], nextOffset: 0, hasMore: false };
            if (request.method === 'operationSettings') result = { allowDetachedHead: false, scope: 'user' };
            window.postMessage({ type: 'response', id: request.id, result }, '*');
          },
        });
      }, language);
      await page.goto(url);
      const button = page.getByTestId('open-project'), notice = page.locator('.project-open-notice');
      await button.waitFor(); await page.waitForFunction(() => !document.querySelector('[data-testid="open-project"]').disabled);
      await page.clock.install();
      await button.click(); await notice.waitFor();
      assert.match(await notice.innerText(), language === 'en' ? /already using the repository folder/ : /当前窗口已位于此仓库目录/);
      assert.match(await notice.innerText(), /D:\\Projects\\Current repository/);
      assert.equal(await notice.getAttribute('role'), 'status');
      await page.clock.fastForward(2000);
      await button.click(); await notice.waitFor();
      await page.clock.fastForward(1500);
      assert.equal(await notice.count(), 1, 'Repeated clicks refresh a single notice timer');
      await page.clock.fastForward(1600); await notice.waitFor({ state: 'hidden' });

      await page.evaluate(() => { window.__projectFixture.result.exactRoot = false; });
      await page.getByTestId('workbench').focus(); await page.keyboard.press('o'); await notice.waitFor();
      assert.match(await notice.innerText(), language === 'en' ? /current window's workspace/ : /当前窗口的工作区中/);
      await page.setViewportSize({ width: 380, height: 800 });
      assert.ok(await notice.evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth), 'Notice fits narrow windows');
      await page.setViewportSize({ width: 1000, height: 800 });

      await page.evaluate(() => { window.__projectFixture.result = { kind: 'other-window' }; });
      await button.click(); await notice.waitFor({ state: 'hidden' });
      await page.evaluate(() => { window.__projectFixture.error = 'Explorer unavailable'; });
      await button.click(); await page.getByRole('alert').getByText('Explorer unavailable', { exact: true }).waitFor();
      assert.equal(await notice.count(), 0, 'Errors do not produce a success notice');
      await page.evaluate(() => {
        const fixture = window.__projectFixture; fixture.error = undefined; fixture.hold = true;
        fixture.result = { kind: 'current-window', root: 'D:\\Projects\\Current repository', exactRoot: true };
      });
      await button.click();
      await page.waitForFunction(() => window.__projectFixture.pending.length === 1);
      await page.getByRole('option', { name: 'Other repository', exact: true }).dblclick();
      await page.waitForFunction(() => document.querySelector('[data-testid="open-project"]').title.includes('D:\\Projects\\Other repository'));
      await page.evaluate(() => { const fixture = window.__projectFixture; fixture.reply(fixture.pending.shift()); });
      await page.clock.fastForward(100);
      assert.equal(await notice.count(), 0, 'Late responses cannot show the previous repository notice');
      assert.equal(await page.evaluate(() => window.__projectFixture.session.drafts.project), 'Keep this draft');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  console.log('ALWAYGIT_PROJECT_UI_TESTS_PASSED: bilingual current-window notices, shortcut, timer renewal, narrow layout, other-window/error handling, stale replies and draft preservation');
}
