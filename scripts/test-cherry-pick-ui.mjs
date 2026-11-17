import assert from 'node:assert/strict';

async function verifyConfirmationFooter(dialog, action, style) {
  const footer = dialog.locator('.modal-footer');
  const cancel = footer.getByRole('button', { name: 'Cancel', exact: true });
  const confirm = footer.getByRole('button', { name: action, exact: true });
  assert.equal(await footer.getByRole('button').count(), 2);
  assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).count(), 1);
  assert.equal(
    await confirm.evaluate((button, name) => button.classList.contains(name), style),
    true,
  );
  const [left, right] = await Promise.all([cancel.boundingBox(), confirm.boundingBox()]);
  assert.ok(left && right && Math.abs(left.y - right.y) < 1 && left.x + left.width <= right.x);
}

export async function verifyCherryPick(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const oid = (value) => value.toString(16).padStart(40, '0');
      const repo = {
        id: 'cherry',
        root: '/fixture',
        commonDir: '/fixture/.git',
        name: 'Cherry fixture',
      };
      const otherRepo = {
        ...repo,
        id: 'other',
        name: 'Other fixture',
        root: '/other-fixture',
        commonDir: '/other-fixture/.git',
      };
      const commits = [
        { oid: oid(1), parents: [oid(4)], subject: 'Current HEAD' },
        { oid: oid(4), parents: [oid(2), oid(5)], subject: 'Historical merge' },
        { oid: oid(3), parents: [oid(2)], subject: 'Topic commit' },
        { oid: oid(5), parents: [oid(2)], subject: 'Merged topic' },
        { oid: oid(2), parents: [], subject: 'Historical commit' },
      ].map((commit) => ({
        ...commit,
        author: 'Fixture',
        email: 'fixture@example.com',
        timestamp: 0,
      }));
      const snapshot = {
        repository: repo,
        branch: 'main',
        head: oid(1),
        ahead: 0,
        behind: 0,
        changes: [],
        refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: oid(1) }],
        stashes: [],
        worktrees: [],
        operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false },
        version: 1,
      };
      const fixture = (window.__cherryFixture = {
        actions: [],
        checks: [],
        pending: [],
        fail: false,
      });
      fixture.flush = () => {
        for (const response of fixture.pending.splice(0)) window.postMessage(response, '*');
      };
      fixture.changeBranch = (branch) => {
        snapshot.branch = branch;
        snapshot.version++;
        window.postMessage({ type: 'changed', repoId: repo.id, snapshot }, '*');
      };
      fixture.changeHead = (head) => {
        snapshot.head = head;
        snapshot.version++;
        window.postMessage({ type: 'changed', repoId: repo.id, snapshot }, '*');
      };
      fixture.pause = () => {
        snapshot.operation = {
          kind: 'cherry-pick',
          conflicts: 1,
          canContinue: false,
          canAbort: true,
          canSkip: true,
          skipToken: 'a'.repeat(64),
          quitToken: 'a'.repeat(64),
        };
        snapshot.changes = [
          { path: 'conflict.txt', indexStatus: 'U', worktreeStatus: 'U', conflict: true },
          { path: 'staged.txt', indexStatus: 'A', worktreeStatus: ' ', conflict: false },
        ];
        snapshot.version++;
        window.postMessage({ type: 'changed', repoId: repo.id, snapshot }, '*');
      };
      window.acquireVsCodeApi = () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage(request) {
          let result;
          if (request.method === 'repositories') result = [repo, otherRepo];
          if (request.method === 'snapshot')
            result = {
              ...snapshot,
              repository: request.repoId === 'other' ? otherRepo : repo,
            };
          if (request.method === 'history')
            result = {
              commits,
              tips: [oid(1), oid(3)],
              nextOffset: commits.length,
              hasMore: false,
            };
          if (request.method === 'details') {
            const commit = commits.find((commit) => commit.oid === request.payload.oid);
            result = { commit, body: commit?.subject, files: [] };
          }
          if (request.method === 'cherryPickCheck') {
            fixture.checks.push(request.payload);
            fixture.pending.push({
              type: 'response',
              id: request.id,
              ...(fixture.fail
                ? { error: { message: 'Fixture ancestry failure', code: 'GIT_ERROR' } }
                : {
                    result: {
                      head: snapshot.head,
                      branch: snapshot.branch,
                      included: request.payload.commits.filter(
                        (oid) => oid === commits[4].oid || oid === commits[1].oid,
                      ),
                    },
                  }),
            });
            return;
          }
          if (request.method === 'action') {
            fixture.actions.push(request.payload);
            if (request.payload.type === 'operation.quit') {
              snapshot.operation = {
                conflicts: 1,
                canContinue: false,
                canAbort: false,
                canSkip: false,
              };
              snapshot.version++;
              result = { snapshot };
            }
            if (['operation.skip', 'operation.abort'].includes(request.payload.type)) {
              snapshot.operation = {
                conflicts: 0,
                canContinue: false,
                canAbort: false,
                canSkip: false,
              };
              snapshot.changes = [];
              snapshot.version++;
              result = { snapshot };
            }
          }
          queueMicrotask(() =>
            window.postMessage({ type: 'response', id: request.id, result }, '*'),
          );
        },
      });
    });
    await page.goto(url);
    await page.getByRole('option', { name: /^Cherry fixture(?: ·|$)/ }).dblclick();
    const rows = page.getByTestId('history').locator('[data-oid]'),
      menu = page.getByTestId('context-menu');
    const cherry = () => menu.getByRole('menuitem', { name: 'Cherry-pick to main…', exact: true });
    const flush = () => page.evaluate(() => window.__cherryFixture.flush());
    const actionCount = () => page.evaluate(() => window.__cherryFixture.actions.length);
    const checkCount = () => page.evaluate(() => window.__cherryFixture.checks.length);
    const open = async (index) => {
      await rows.nth(index).click();
      await rows.nth(index).click({ button: 'right' });
      await menu.waitFor();
    };
    const dialog = page.getByRole('dialog');
    const apply = () => dialog.getByRole('button', { name: 'Apply Commits', exact: true });
    const reapply = () => dialog.getByRole('button', { name: 'Reapply Commits', exact: true });
    const begin = async (index) => {
      const before = await checkCount();
      await open(index);
      assert.equal(await checkCount(), before, 'Opening a menu must not query ancestry');
      assert.equal(await cherry().isEnabled(), true);
      assert.equal(await menu.getByRole('menuitem', { name: /Reapply/ }).count(), 0);
      await cherry().click();
      await dialog.waitFor();
      await page.waitForFunction(
        (before) => window.__cherryFixture.checks.length === before + 1,
        before,
      );
      return dialog;
    };
    const forceSubmit = () =>
      dialog
        .locator('form')
        .evaluate((form) =>
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
    await open(0);
    assert.equal(await cherry().isDisabled(), true);
    assert.equal(await cherry().getAttribute('title'), 'This commit is the current branch HEAD.');
    await page.keyboard.press('Escape');
    for (let repeat = 0; repeat < 2; repeat++) {
      await open(4);
      assert.equal(await cherry().isEnabled(), true);
      await page.keyboard.press('Escape');
    }
    assert.equal(await checkCount(), 0);

    await begin(4);
    await dialog.getByText('Checking commit ancestry…', { exact: true }).waitFor();
    assert.equal(await apply().isDisabled(), true);
    await forceSubmit();
    assert.equal(await actionCount(), 0);
    await flush();
    await reapply().waitFor();
    await dialog.getByText('Historical commit', { exact: true }).waitFor();
    await dialog.getByText('Already in branch history', { exact: true }).waitFor();
    assert.equal(await reapply().isDisabled(), true);
    await forceSubmit();
    assert.equal(await actionCount(), 0);
    await dialog.getByRole('checkbox').check();
    await reapply().click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__cherryFixture.actions[0]), {
      type: 'cherry-pick',
      commits: ['2'.padStart(40, '0')],
      mainline: undefined,
      expectedHead: '1'.padStart(40, '0'),
      expectedBranch: 'main',
      allowIncluded: true,
    });

    // Cancel one pending query and deliver its late response while another dialog is open.
    await begin(4);
    await page.keyboard.press('Escape');
    await begin(2);
    await flush();
    await apply().waitFor();
    assert.equal(await apply().isEnabled(), true);
    assert.equal(await dialog.getByRole('checkbox').count(), 0);
    assert.equal(await actionCount(), 1, 'A successful check must still wait for confirmation');
    await apply().click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__cherryFixture.actions.at(-1)), {
      type: 'cherry-pick',
      commits: ['3'.padStart(40, '0')],
      mainline: undefined,
      expectedHead: '1'.padStart(40, '0'),
      expectedBranch: 'main',
    });

    await page.evaluate(() => {
      window.__cherryFixture.fail = true;
    });
    await begin(4);
    await flush();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await apply().isDisabled(), true);
    await forceSubmit();
    assert.equal(await actionCount(), 2);
    await page.evaluate(() => {
      window.__cherryFixture.fail = false;
    });
    await dialog.getByRole('button', { name: 'Retry ancestry check', exact: true }).click();
    await page.waitForFunction(() => window.__cherryFixture.pending.length > 0);
    assert.equal(await apply().isDisabled(), true);
    await flush();
    await reapply().waitFor();
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
    await page.keyboard.press('Escape');

    // Merge parent choice and explicit reapplication stay in this same dialog.
    await begin(1);
    await flush();
    await reapply().waitFor();
    const mainline = dialog.getByLabel('Mainline Parent (Merge Commits only)', { exact: true });
    await dialog.getByRole('checkbox').check();
    assert.equal(await reapply().isDisabled(), true);
    await mainline.selectOption('1');
    assert.equal(await dialog.getByRole('checkbox').isChecked(), false);
    await dialog.getByRole('checkbox').check();
    await reapply().click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__cherryFixture.actions.at(-1).mainline), 1);

    // Mixed selections are all listed and applied, with no silent filtering of existing history.
    await rows.nth(4).click();
    await rows.nth(2).click({ modifiers: ['Control'] });
    await rows.nth(4).click({ button: 'right' });
    await menu
      .getByRole('menuitem', { name: 'Cherry-pick 2 Commits to main…', exact: true })
      .click();
    await page.waitForFunction(() => window.__cherryFixture.pending.length > 0);
    await flush();
    await reapply().waitFor();
    await dialog.getByText('Topic commit', { exact: true }).waitFor();
    await dialog.getByText('Historical commit', { exact: true }).waitFor();
    assert.equal(await dialog.getByText('Already in branch history', { exact: true }).count(), 1);
    await dialog.getByRole('checkbox').check();
    await reapply().click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__cherryFixture.actions.at(-1).commits), [
      '2'.padStart(40, '0'),
      '3'.padStart(40, '0'),
    ]);

    const beforeStale = await actionCount();
    await begin(4);
    await flush();
    await reapply().waitFor();
    await dialog.getByRole('checkbox').check();
    await page.evaluate(() => window.__cherryFixture.changeBranch('other'));
    await dialog.getByRole('alert').waitFor();
    await forceSubmit();
    assert.equal(await actionCount(), beforeStale);
    await page.evaluate(() => window.__cherryFixture.changeBranch('main'));
    await page.getByTestId('current-branch').getByText('main', { exact: true }).waitFor();
    assert.equal(
      await apply().isDisabled(),
      true,
      'Returning to the old branch must not restore confirmation',
    );
    await page.keyboard.press('Escape');

    await begin(4);
    await page.evaluate(() => window.__cherryFixture.changeHead('5'.padStart(40, '0')));
    await dialog.getByRole('alert').waitFor();
    await flush();
    assert.equal(await apply().isDisabled(), true);
    await forceSubmit();
    assert.equal(await actionCount(), beforeStale);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__cherryFixture.changeHead('1'.padStart(40, '0')));

    // Switching away and back cannot reuse a pending query or reopen its confirmation.
    await begin(4);
    // Dispatch the repository activation event to simulate a host-driven switch behind the modal.
    await page
      .getByRole('option', { name: /^Other fixture(?: ·|$)/ })
      .locator('.repository-item')
      .dispatchEvent('dblclick');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('option', { name: /^Cherry fixture(?: ·|$)/ }).dblclick();
    await flush();
    assert.equal(await dialog.count(), 0);
    assert.equal(await actionCount(), beforeStale);
    const recoveryStart = beforeStale;
    await page.evaluate(() => window.__cherryFixture.pause());
    const notice = page.getByTestId('operation-notice');
    const skip = notice.getByRole('button', { name: 'Skip', exact: true });
    await skip.click();
    const skipDialog = page.getByRole('dialog', {
      name: 'Skip current Cherry-pick commit?',
      exact: true,
    });
    await skipDialog.getByText(/Already applied commits remain/).waitFor();
    await verifyConfirmationFooter(skipDialog, 'Confirm Skip', 'danger');
    assert.equal(
      await skipDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    );
    assert.equal(await page.evaluate(() => window.__cherryFixture.actions.length), recoveryStart);
    await page.keyboard.press('Enter');
    await skipDialog.waitFor({ state: 'hidden' });
    await skip.click();
    await page.keyboard.press('Escape');
    await skipDialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__cherryFixture.actions.length), recoveryStart);
    await skip.click();
    await skipDialog.getByRole('button', { name: 'Confirm Skip', exact: true }).click();
    await notice.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__cherryFixture.actions.at(-1)), {
      type: 'operation.skip',
      kind: 'cherry-pick',
      skipToken: 'a'.repeat(64),
    });
    await page.evaluate(() => window.__cherryFixture.pause());
    const abort = notice.getByRole('button', { name: 'Abort Cherry-pick…', exact: true });
    await abort.click();
    const abortDialog = page.getByRole('dialog', { name: 'Abort', exact: true });
    await abortDialog.getByText(/entire Cherry-pick sequence/).waitFor();
    await abortDialog.getByText(/To exit and keep your files/).waitFor();
    assert.equal(
      await abortDialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    );
    await page.keyboard.press('Enter');
    await abortDialog.waitFor({ state: 'hidden' });
    assert.equal(
      await page.evaluate(() => window.__cherryFixture.actions.length),
      recoveryStart + 1,
    );
    await abort.click();
    await abortDialog.getByRole('button', { name: 'Confirm Abort', exact: true }).click();
    await notice.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__cherryFixture.actions.at(-1)), {
      type: 'operation.abort',
      kind: 'cherry-pick',
    });
    await page.evaluate(() => window.__cherryFixture.pause());
    const quit = notice.getByRole('button', {
      name: 'Quit Cherry-pick & Keep Files…',
      exact: true,
    });
    await quit.click();
    const quitDialog = page.getByRole('dialog', {
      name: 'Quit Cherry-pick & Keep Files…',
      exact: true,
    });
    await quitDialog.getByText(/including unresolved conflicts/).waitFor();
    await verifyConfirmationFooter(quitDialog, 'Quit & Keep Files', 'primary');
    await quitDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.__cherryFixture.actions.length),
      recoveryStart + 2,
    );
    await quit.click();
    await quitDialog.getByRole('button', { name: 'Quit & Keep Files', exact: true }).click();
    await notice.getByText('Unresolved conflicts', { exact: true }).waitFor();
    assert.equal(await quit.count(), 0);
    assert.equal(await notice.getByRole('button', { name: 'Continue', exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__cherryFixture.actions.at(-1)), {
      type: 'operation.quit',
      kind: 'cherry-pick',
      quitToken: 'a'.repeat(64),
    });
    await page.locator('[data-working-tree]').click();
    await page
      .getByTestId('details')
      .getByRole('button', { name: 'conflict.txt', exact: true })
      .waitFor();
    await page
      .getByTestId('details')
      .getByRole('button', { name: 'staged.txt', exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: 'artifacts/cherry-pick-failure.png' });
    console.error('CHERRY_PICK_DIAGNOSTICS', errors, await page.locator('body').innerText());
    throw error;
  } finally {
    await page.close();
  }
}
