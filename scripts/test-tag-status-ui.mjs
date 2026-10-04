import assert from 'node:assert/strict';

export async function verifyTagStatus(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const oid = 'a'.repeat(40), other = 'b'.repeat(40), repository = { id: 'tags', root: '/tags', commonDir: '/tags/.git', name: 'Tags' };
      const refs = ['synced', 'local', 'different'].map(name => ({ kind: 'tag', name, fullName: `refs/tags/${name}`, oid, refOid: oid, targetType: 'commit' }));
      let snapshot = { repository, branch: 'main', head: oid, refs, remotes: ['origin', 'upstream', 'publish'], remoteReadDestinations: { origin: 'read-origin', upstream: 'read-upstream', publish: 'read-publish' }, remoteDestinations: { origin: 'push-origin', upstream: 'push-upstream', publish: 'push-publish' }, changes: [], ahead: 0, behind: 0, stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
      const commit = { oid, parents: [], author: 'Test', email: 'test@example.com', timestamp: 0, subject: 'Tag status fixture', pushed: true };
      window.__tagFixture = { fail: false, requests: 0, actions: [], changePublishAddress() {
        snapshot = { ...snapshot, version: snapshot.version + 1,
          remoteReadDestinations: { ...snapshot.remoteReadDestinations, publish: 'f'.repeat(64) },
          remoteDestinations: { ...snapshot.remoteDestinations, publish: 'e'.repeat(64) } };
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'changed', repoId: repository.id, snapshot } }));
      } };
      window.acquireVsCodeApi = () => ({
        getState: () => ({ repoId: 'tags', language: 'en', views: { tags: { checkedRefs: refs.map(ref => ref.fullName), search: '', tab: 'history' } } }),
        setState: () => {},
        postMessage(request) {
          let result;
          if (request.method === 'cancelQuery') return;
          if (request.method === 'repositories') result = [repository];
          else if (request.method === 'repositoryCollections') result = [];
          else if (request.method === 'repositoryStatuses') result = [{ repositoryId: repository.id, branch: 'main', ahead: 0, unpushed: 0 }];
          else if (request.method === 'snapshot') result = snapshot;
          else if (request.method === 'history') result = { commits: [commit], tips: [oid], nextOffset: 1, hasMore: false };
          else if (request.method === 'details') result = { commit, parent: undefined, body: '', files: [] };
          else if (request.method === 'interfaceSettings') result = {};
          else if (request.method === 'operationSettings') result = { allowDetachedHead: false, pushFollowTags: false, pushTagAfterCreate: false, defaultResetMode: 'mixed', scope: 'workspace' };
          else if (request.method === 'action') { window.__tagFixture.actions.push(request.payload); result = snapshot; }
          else if (request.method === 'remoteTags') {
            window.__tagFixture.requests++;
            result = { remote: request.payload.remote, destination: request.payload.expectedDestination, separatePush: request.payload.remote === 'origin', refs: request.payload.remote === 'origin' ? { 'refs/tags/synced': oid, 'refs/tags/different': other, 'refs/tags/remote-only': 'c'.repeat(40) } : request.payload.remote === 'publish' ? { 'refs/tags/publish-only': 'd'.repeat(40) } : {}, checkedAt: Date.now() - 24 * 60 * 60_000 };
          }
          const error = request.method === 'remoteTags' && window.__tagFixture.fail ? { message: 'offline', code: 'GIT_FAILED' } : undefined;
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'response', id: request.id, result, error } })), 10);
        },
      });
    });
    await page.goto(url);
    const rows = page.locator('.tag-row');
    await rows.locator('.tag-status').first().waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('.tag-status-synced'));
    assert.deepEqual(await rows.locator('.tag-status').allTextContents(), ['', '', '', '']);
    assert.equal(await rows.locator('.tag-status-remote').count(), 1);
    assert.ok((await rows.locator('.tag-status-remote').getAttribute('title')).includes('exists only on the remote'));
    assert.equal(await page.locator('.ref-badge.tag .tag-status').count(), 3);
    assert.equal(await page.locator('.tag-status-compact.tag-status-synced').count(), 1);
    assert.ok((await rows.locator('.tag-status-synced').getAttribute('title')).includes('Read and push addresses differ'));
    for (const theme of ['paper', 'dark']) {
      await page.getByTestId('workbench').evaluate((element, theme) => element.setAttribute('data-theme', theme), theme);
      assert.ok(await rows.locator('.tag-status').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().width >= 22 && element.getBoundingClientRect().width <= 32 && getComputedStyle(element).display !== 'none')));
      const colors = await rows.locator('.tag-status').evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
      assert.equal(new Set(colors).size, 4, 'Synced, local, remote-only and differing Tags need distinct theme colors');
      assert.ok(await rows.locator('.tag-status .codicon').evaluateAll(elements => elements.every(element => !['none', 'normal', '""'].includes(getComputedStyle(element, '::before').content))));
      assert.ok(await rows.locator('.tag-status').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().right <= element.closest('[data-testid="sidebar"]').getBoundingClientRect().right + 1)));
    }
    await rows.locator('.tag-status-synced').click();
    const dialog = page.getByRole('dialog', { name: 'synced · Tag remote status' });
    await dialog.waitFor(); assert.ok((await dialog.innerText()).includes('Last successful check:'));
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('combobox', { name: 'Remote to compare local Tags against' }).selectOption('publish');
    await page.waitForFunction(() => document.querySelectorAll('.tag-row-remote').length === 1);
    await page.locator('.tag-row-remote').click({button:'right'});
    await page.getByTestId('context-menu').getByRole('menuitem',{name:'Delete Remote Tag…',exact:true}).click();
    const remoteDelete = page.getByRole('dialog', { name: 'Delete Tag', exact: true });
    await remoteDelete.waitFor();
    assert.ok((await remoteDelete.innerText()).includes('This deletes the Tag from the shared remote repository publish.'));
    assert.equal(await remoteDelete.getByRole('button',{name:'Delete Remote Tag',exact:true}).isEnabled(),true);
    await page.evaluate(() => window.__tagFixture.changePublishAddress());
    await page.waitForFunction(() => document.querySelector('[role="dialog"] .form-error')?.textContent?.includes('Refresh and reopen the Tag deletion dialog.'));
    assert.equal(await remoteDelete.getByRole('button',{name:'Delete Remote Tag',exact:true}).isDisabled(),true);
    // A direct submit bypasses the disabled button and must still fail closed.
    await remoteDelete.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.deepEqual(await page.evaluate(() => window.__tagFixture.actions), []);
    await remoteDelete.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.locator('.tag-row-remote').waitFor();
    await page.locator('.tag-row-remote').click({button:'right'});
    await page.getByTestId('context-menu').getByRole('menuitem',{name:'Delete Remote Tag…',exact:true}).click();
    await remoteDelete.waitFor();
    assert.equal(await remoteDelete.getByRole('button',{name:'Delete Remote Tag',exact:true}).isEnabled(),true);
    await remoteDelete.getByRole('button',{name:'Delete Remote Tag',exact:true}).click();
    await page.waitForFunction(() => window.__tagFixture.actions.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__tagFixture.actions), [{ type: 'tag.delete', name: 'publish-only', remote: 'publish',
      expectedRemoteOid: 'd'.repeat(40), expectedDestination: 'e'.repeat(64) }]);
    await remoteDelete.waitFor({ state: 'hidden' });
    await page.getByRole('combobox', { name: 'Remote to compare local Tags against' }).selectOption('upstream');
    await page.waitForFunction(() => document.querySelectorAll('.tag-row .tag-status-local').length === 3);
    await page.evaluate(() => { window.__tagFixture.fail = true; });
    await page.locator('.tag-remote-controls').getByRole('button', { name: 'Check remote Tag status' }).click();
    await page.waitForFunction(() => document.querySelector('.tag-row .tag-status')?.getAttribute('title')?.includes('Status check failed: offline'));
    assert.equal(await page.locator('.tag-row .tag-status-local').count(), 3);
    assert.ok((await rows.locator('.tag-status').first().getAttribute('title')).includes('Status check failed: offline'));
    await page.evaluate(() => { window.__tagFixture.fail = false; });
    await page.locator('.tag-remote-controls').getByRole('button', { name: 'Check remote Tag status' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.tag-row .tag-status-local').length === 3);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error('Tag UI diagnostics:', errors, (await page.locator('body').innerText()).slice(0, 2500));
    throw error;
  } finally { await page.close(); }
}
