import assert from 'node:assert/strict';

export async function verifyTagStatus(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const oid = 'a'.repeat(40),
        other = 'b'.repeat(40),
        repository = { id: 'tags', root: '/tags', commonDir: '/tags/.git', name: 'Tags' };
      const refs = ['synced', 'local', 'different'].map((name) => ({
        kind: 'tag',
        name,
        fullName: `refs/tags/${name}`,
        oid: name === 'local' ? other : oid,
        refOid: name === 'local' ? other : oid,
        targetType: 'commit',
      }));
      let snapshot = {
        repository,
        branch: 'main',
        head: oid,
        refs,
        remotes: ['origin', 'upstream', 'publish'],
        remoteReadDestinations: {
          origin: 'read-origin',
          upstream: 'read-upstream',
          publish: 'read-publish',
        },
        remoteDestinations: {
          origin: 'push-origin',
          upstream: 'push-upstream',
          publish: 'push-publish',
        },
        changes: [],
        ahead: 0,
        behind: 0,
        stashes: [],
        worktrees: [],
        operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false },
        version: 1,
      };
      const commit = {
        oid,
        parents: [],
        author: 'Test',
        email: 'test@example.com',
        timestamp: 0,
        subject: 'Tag status fixture',
        pushed: true,
      };
      const otherCommit = { ...commit, oid: other, subject: 'Tag outside current Graph' };
      window.__tagFixture = {
        fail: false,
        requests: 0,
        historyRequests: [],
        detailsRequests: [],
        actions: [],
        session: undefined,
        nonCommit(enabled) {
          snapshot = {
            ...snapshot,
            version: snapshot.version + 1,
            refs: enabled
              ? [
                  ...refs,
                  {
                    kind: 'tag',
                    name: 'blob',
                    fullName: 'refs/tags/blob',
                    oid: 'f'.repeat(40),
                    refOid: 'f'.repeat(40),
                    targetType: 'blob',
                  },
                ]
              : refs,
          };
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'changed', repoId: repository.id, snapshot },
            }),
          );
        },
        changePublishAddress() {
          snapshot = {
            ...snapshot,
            version: snapshot.version + 1,
            remoteReadDestinations: { ...snapshot.remoteReadDestinations, publish: 'f'.repeat(64) },
            remoteDestinations: { ...snapshot.remoteDestinations, publish: 'e'.repeat(64) },
          };
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'changed', repoId: repository.id, snapshot },
            }),
          );
        },
      };
      window.acquireVsCodeApi = () => ({
        getState: () => ({
          repoId: 'tags',
          language: 'en',
          views: {
            tags: { checkedRefs: refs.map((ref) => ref.fullName), search: '', tab: 'history' },
          },
        }),
        setState: (session) => {
          window.__tagFixture.session = session;
        },
        postMessage(request) {
          let result;
          if (request.method === 'cancelQuery') return;
          if (request.method === 'repositories') result = [repository];
          else if (request.method === 'repositoryCollections') result = [];
          else if (request.method === 'repositoryStatuses')
            result = [{ repositoryId: repository.id, branch: 'main', ahead: 0, unpushed: 0 }];
          else if (request.method === 'snapshot') result = snapshot;
          else if (request.method === 'history') {
            window.__tagFixture.historyRequests.push(request.payload);
            const target =
              request.payload.tips?.length === 1 && request.payload.tips[0] === 'refs/tags/local'
                ? otherCommit
                : commit;
            result = { commits: [target], tips: [target.oid], nextOffset: 1, hasMore: false };
          } else if (request.method === 'details') {
            window.__tagFixture.detailsRequests.push(request.payload);
            result = {
              commit: request.payload.oid === other ? otherCommit : commit,
              parent: undefined,
              body: '',
              files: [{ path: 'tag.txt', status: 'M' }],
            };
          } else if (request.method === 'diffPreview')
            result = {
              kind: 'text',
              path: 'tag.txt',
              leftLabel: 'Before',
              rightLabel: 'After',
              left: 'before Tag selection',
              right: 'after Tag selection',
              truncated: false,
            };
          else if (request.method === 'interfaceSettings') result = {};
          else if (request.method === 'operationSettings')
            result = {
              allowDetachedHead: false,
              pushFollowTags: false,
              pushTagAfterCreate: false,
              defaultResetMode: 'mixed',
              scope: 'workspace',
            };
          else if (request.method === 'action') {
            window.__tagFixture.actions.push(request.payload);
            result = snapshot;
          } else if (request.method === 'remoteTags') {
            window.__tagFixture.requests++;
            result = {
              remote: request.payload.remote,
              destination: request.payload.expectedDestination,
              separatePush: request.payload.remote === 'origin',
              refs:
                request.payload.remote === 'origin'
                  ? {
                      'refs/tags/synced': oid,
                      'refs/tags/different': other,
                      'refs/tags/remote-only': 'c'.repeat(40),
                    }
                  : request.payload.remote === 'publish'
                    ? { 'refs/tags/publish-only': 'd'.repeat(40) }
                    : {},
              checkedAt: Date.now() - 24 * 60 * 60_000,
            };
          }
          const error =
            request.method === 'remoteTags' && window.__tagFixture.fail
              ? { message: 'offline', code: 'GIT_FAILED' }
              : undefined;
          setTimeout(
            () =>
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: { type: 'response', id: request.id, result, error },
                }),
              ),
            10,
          );
        },
      });
    });
    await page.goto(url);
    const rows = page.locator('.tag-row');
    await rows.locator('.tag-status').first().waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('.tag-status-synced'));
    assert.deepEqual(await rows.locator('.tag-status').allTextContents(), ['', '', '', '']);
    assert.equal(await rows.locator('.tag-status-remote').count(), 1);
    assert.ok(
      (await rows.locator('.tag-status-remote').getAttribute('title')).includes(
        'exists only on the remote',
      ),
    );
    assert.equal(await page.locator('.ref-badge.tag .tag-status').count(), 2);
    assert.equal(await page.locator('.tag-status-compact.tag-status-synced').count(), 1);
    assert.ok(
      (await rows.locator('.tag-status-synced').getAttribute('title')).includes(
        'Read and push addresses differ',
      ),
    );
    for (const theme of ['paper', 'dark']) {
      await page
        .getByTestId('workbench')
        .evaluate((element, theme) => element.setAttribute('data-theme', theme), theme);
      assert.ok(
        await rows
          .locator('.tag-status')
          .evaluateAll((elements) =>
            elements.every(
              (element) =>
                element.getBoundingClientRect().width >= 22 &&
                element.getBoundingClientRect().width <= 32 &&
                getComputedStyle(element).display !== 'none',
            ),
          ),
      );
      const colors = await rows
        .locator('.tag-status')
        .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
      assert.equal(
        new Set(colors).size,
        4,
        'Synced, local, remote-only and differing Tags need distinct theme colors',
      );
      assert.ok(
        await rows
          .locator('.tag-status .codicon')
          .evaluateAll((elements) =>
            elements.every(
              (element) =>
                !['none', 'normal', '""'].includes(getComputedStyle(element, '::before').content),
            ),
          ),
      );
      assert.ok(
        await rows
          .locator('.tag-status')
          .evaluateAll((elements) =>
            elements.every(
              (element) =>
                element.getBoundingClientRect().right <=
                element.closest('[data-testid="sidebar"]').getBoundingClientRect().right + 1,
            ),
          ),
      );
    }
    await rows.locator('.tag-status-synced').click();
    const dialog = page.getByRole('dialog', { name: 'synced · Tag remote status' });
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes('Last successful check:'));
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    // Name selection must preserve the current Commit, history scope, and details.
    const currentCommit = page.locator('.commit-row[data-oid]').first();
    await currentCommit.click();
    await page
      .getByTestId('diff-preview')
      .getByText('after Tag selection', { exact: true })
      .waitFor();
    const viewState = () =>
      page.evaluate(() => ({
        view: window.__tagFixture.session?.views.tags,
        history: window.__tagFixture.historyRequests,
        details: window.__tagFixture.detailsRequests,
        selected: document
          .querySelector('.commit-row.selected[data-oid]')
          ?.getAttribute('data-oid'),
        scroll: document.querySelector('.history-viewport')?.scrollTop,
        diff: document.querySelector('[data-testid="diff-preview"]')?.textContent,
      }));
    const local = rows.filter({ has: page.locator('.tag-name', { hasText: /^local$/ }) });
    const synced = rows.filter({ has: page.locator('.tag-name', { hasText: /^synced$/ }) });
    const different = rows.filter({ has: page.locator('.tag-name', { hasText: /^different$/ }) });
    const before = await viewState();
    await local.locator('.tag-name').click();
    assert.equal(await local.getAttribute('aria-selected'), 'true');
    assert.deepEqual(await viewState(), before);
    await synced.locator('.tag-name').click({ modifiers: ['Control'] });
    assert.equal(await rows.locator('.tag-name').count(), 4);
    assert.equal(await page.locator('.tag-row.action-selected').count(), 2);
    await synced.locator('.tag-status').click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.locator('.tag-row.action-selected').count(), 2);
    assert.deepEqual(await viewState(), before);
    await synced.locator('.tag-name').press('Shift+F10');
    await page
      .getByTestId('context-menu')
      .getByRole('menuitem', { name: 'Push 2 Tags…', exact: true })
      .waitFor();
    assert.equal(await page.locator('.tag-row.action-selected').count(), 2);
    await page.keyboard.press('Escape');
    await different.locator('.tag-name').click({ modifiers: ['Shift'] });
    assert.equal(await page.locator('.tag-row.action-selected').count(), 3);
    await local.locator('.tag-name').press('Control+a');
    assert.equal(await page.locator('.tag-row.action-selected').count(), 3);
    await local.locator('.tag-name').press('Escape');
    assert.equal(await page.locator('.tag-row.action-selected').count(), 0);
    await local.locator('.tag-name').press('Space');
    assert.equal(await local.getAttribute('aria-selected'), 'true');
    assert.deepEqual(await viewState(), before);
    await different.locator('.tag-name').click({ button: 'right' });
    assert.equal(await page.locator('.tag-row.action-selected').count(), 1);
    await page.keyboard.press('Escape');
    const remoteOnly = rows.filter({
      has: page.locator('.tag-name', { hasText: /^remote-only$/ }),
    });
    await remoteOnly.locator('.tag-name').dblclick();
    await remoteOnly.locator('.tag-name').press('Enter');
    assert.equal(await remoteOnly.getAttribute('aria-selected'), 'true');
    assert.deepEqual(await viewState(), before);
    await page.evaluate(() => window.__tagFixture.nonCommit(true));
    const blob = rows.filter({ has: page.locator('.tag-name', { hasText: /^blob$/ }) });
    await blob.locator('.tag-name').dblclick();
    await blob.locator('.tag-name').press('Enter');
    assert.equal(await blob.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByTestId('context-menu').count(), 0);
    assert.deepEqual(await viewState(), before);
    await blob.locator('.tag-name').click({ button: 'right' });
    assert.equal(
      await page
        .getByTestId('context-menu')
        .getByRole('menuitem', { name: 'Locate Tag Commit in Graph', exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__tagFixture.nonCommit(false));
    await local.locator('.tag-name').dblclick();
    await page.waitForFunction(
      () =>
        document.querySelector('.commit-row.selected[data-oid]')?.getAttribute('data-oid') ===
        'b'.repeat(40),
    );
    assert.deepEqual((await viewState()).view.checkedRefs, ['refs/tags/local']);
    assert.deepEqual(
      await page.evaluate(() => window.__tagFixture.actions),
      [],
      'Tag activation must never Checkout',
    );
    // Enter locates a different Tag and uses the same history navigation path.
    await synced.locator('.tag-name').press('Enter');
    await page.waitForFunction(
      () =>
        document.querySelector('.commit-row.selected[data-oid]')?.getAttribute('data-oid') ===
        'a'.repeat(40),
    );
    assert.deepEqual((await viewState()).view.checkedRefs, ['refs/tags/synced']);
    assert.deepEqual(await page.evaluate(() => window.__tagFixture.actions), []);
    await page.getByRole('button', { name: 'Back to previous history view', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.commit-row.selected[data-oid]')?.getAttribute('data-oid') ===
        'b'.repeat(40),
    );
    await page.getByRole('button', { name: 'Back to previous history view', exact: true }).click();
    await page.waitForFunction(
      () => window.__tagFixture.session?.views.tags.checkedRefs.length === 3,
    );
    await page
      .getByRole('combobox', { name: 'Remote to compare local Tags against' })
      .selectOption('publish');
    await page.waitForFunction(() => document.querySelectorAll('.tag-row-remote').length === 1);
    await page.locator('.tag-row-remote').click({ button: 'right' });
    await page
      .getByTestId('context-menu')
      .getByRole('menuitem', { name: 'Delete Remote Tag…', exact: true })
      .click();
    const remoteDelete = page.getByRole('dialog', { name: 'Delete Tag', exact: true });
    await remoteDelete.waitFor();
    assert.ok(
      (await remoteDelete.innerText()).includes(
        'This deletes the Tag from the shared remote repository publish.',
      ),
    );
    assert.equal(
      await remoteDelete
        .getByRole('button', { name: 'Delete Remote Tag', exact: true })
        .isEnabled(),
      true,
    );
    await page.evaluate(() => window.__tagFixture.changePublishAddress());
    await page.waitForFunction(() =>
      document
        .querySelector('[role="dialog"] .form-error')
        ?.textContent?.includes('Refresh and reopen the Tag deletion dialog.'),
    );
    assert.equal(
      await remoteDelete
        .getByRole('button', { name: 'Delete Remote Tag', exact: true })
        .isDisabled(),
      true,
    );
    // A direct submit bypasses the disabled button and must still fail closed.
    await remoteDelete
      .locator('form')
      .evaluate((form) =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
    assert.deepEqual(await page.evaluate(() => window.__tagFixture.actions), []);
    await remoteDelete.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.tag-row-remote').waitFor();
    await page.locator('.tag-row-remote').click({ button: 'right' });
    await page
      .getByTestId('context-menu')
      .getByRole('menuitem', { name: 'Delete Remote Tag…', exact: true })
      .click();
    await remoteDelete.waitFor();
    assert.equal(
      await remoteDelete
        .getByRole('button', { name: 'Delete Remote Tag', exact: true })
        .isEnabled(),
      true,
    );
    await remoteDelete.getByRole('button', { name: 'Delete Remote Tag', exact: true }).click();
    await page.waitForFunction(() => window.__tagFixture.actions.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__tagFixture.actions), [
      {
        type: 'tag.delete',
        name: 'publish-only',
        remote: 'publish',
        expectedRemoteOid: 'd'.repeat(40),
        expectedDestination: 'e'.repeat(64),
      },
    ]);
    await remoteDelete.waitFor({ state: 'hidden' });
    await page
      .getByRole('combobox', { name: 'Remote to compare local Tags against' })
      .selectOption('upstream');
    await page.waitForFunction(
      () => document.querySelectorAll('.tag-row .tag-status-local').length === 3,
    );
    assert.equal(
      await page.locator('.tag-row.action-selected').count(),
      0,
      'Changing remotes must clear remote-only selection',
    );
    await page.evaluate(() => {
      window.__tagFixture.fail = true;
    });
    await page
      .locator('.tag-remote-controls')
      .getByRole('button', { name: 'Check remote Tag status' })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector('.tag-row .tag-status')
        ?.getAttribute('title')
        ?.includes('Status check failed: offline'),
    );
    assert.equal(await page.locator('.tag-row .tag-status-local').count(), 3);
    assert.ok(
      (await rows.locator('.tag-status').first().getAttribute('title')).includes(
        'Status check failed: offline',
      ),
    );
    await page.evaluate(() => {
      window.__tagFixture.fail = false;
    });
    await page
      .locator('.tag-remote-controls')
      .getByRole('button', { name: 'Check remote Tag status' })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll('.tag-row .tag-status-local').length === 3,
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(
      'Tag UI diagnostics:',
      errors,
      (await page.locator('body').innerText()).slice(0, 2500),
    );
    throw error;
  } finally {
    await page.close();
  }
}
