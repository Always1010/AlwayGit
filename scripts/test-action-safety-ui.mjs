import assert from 'node:assert/strict';

/** Keep settings saves pending while exercising real dialog cancellation and reuse. */
export async function verifyActionSafety(browser, url) {
  for (const mode of ['normal', 'cancel', 'switch', 'switch-back', 'save-failure']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        const repositories = ['A', 'B'].map((name) => ({
          id: name,
          name: `Safety ${name}`,
          root: `/${name}`,
          commonDir: `/${name}/.git`,
        }));
        const commit = {
          oid: 'a'.repeat(40),
          parents: [],
          author: 'Fixture',
          email: 'fixture@example.com',
          timestamp: 0,
          subject: 'Safety commit',
        };
        const settings = {
          allowDetachedHead: false,
          pushFollowTags: false,
          pushTagAfterCreate: false,
          defaultResetMode: 'mixed',
          scope: 'workspace',
        };
        const snapshot = (id) => ({
          repository: repositories.find((repo) => repo.id === id),
          branch: 'main',
          head: commit.oid,
          ahead: 1,
          behind: 0,
          changes: [],
          refs: [
            {
              name: 'main',
              fullName: 'refs/heads/main',
              kind: 'local',
              oid: commit.oid,
              upstream: 'origin/main',
            },
          ],
          remotes: ['origin'],
          stashes: [],
          worktrees: [],
          operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false },
          version: 1,
        });
        const reply = (request, result) =>
          window.postMessage({ type: 'response', id: request.id, result }, '*');
        const fixture = (window.__actionSafety = {
          calls: [],
          pending: undefined,
          settled: false,
          release(fail) {
            const request = fixture.pending;
            fixture.pending = undefined;
            if (fail)
              window.postMessage(
                { type: 'response', id: request.id, error: { message: 'Save failed' } },
                '*',
              );
            else reply(request, { ...settings, ...request.payload });
            // Drain promise continuations and React effects without timing-based assertions.
            setTimeout(() => {
              fixture.settled = true;
            }, 100);
          },
        });
        window.acquireVsCodeApi = () => ({
          getState: () => ({}),
          setState: () => {},
          postMessage(request) {
            fixture.calls.push(request);
            if (request.method === 'saveOperationSettings') {
              fixture.pending = request;
              return;
            }
            let result;
            if (request.method === 'repositories') result = repositories;
            if (request.method === 'snapshot') result = snapshot(request.repoId);
            if (request.method === 'history')
              result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
            if (request.method === 'details') result = { commit, body: commit.subject, files: [] };
            if (request.method === 'operationSettings') result = settings;
            if (request.method === 'action') result = snapshot(request.repoId);
            setTimeout(() => reply(request, result), 0);
          },
        });
      });
      await page.goto(url);
      await page.getByRole('option', { name: /^Safety A/ }).dblclick();
      await page.getByRole('button', { name: /^Push/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Push', exact: true });
      await dialog.getByText('Advanced Options', { exact: true }).click();
      await dialog
        .getByText('Remember this Tag choice as the Push default', { exact: true })
        .click();
      await dialog.getByRole('button', { name: 'Push', exact: true }).click();
      await page.waitForFunction(() => !!window.__actionSafety.pending);
      assert.equal(
        await dialog.getByRole('button', { name: 'Push', exact: true }).isDisabled(),
        true,
      );
      assert.equal(await dialog.locator('input[type=checkbox]').first().isDisabled(), true);
      // Even direct duplicate form submissions may not enqueue another settings save.
      await dialog
        .locator('form')
        .evaluate((form) =>
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        );
      assert.equal(
        await page.evaluate(
          () =>
            window.__actionSafety.calls.filter((call) => call.method === 'saveOperationSettings')
              .length,
        ),
        1,
      );
      if (mode !== 'normal' && mode !== 'save-failure') {
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        if (mode === 'switch' || mode === 'switch-back') {
          await page.getByRole('option', { name: /^Safety B/ }).dblclick();
          if (mode === 'switch-back')
            await page.getByRole('option', { name: /^Safety A/ }).dblclick();
        }
        // A late save must not dismiss a newly opened dialog either.
        await page.getByRole('button', { name: /^Push/ }).click();
      }
      await page.evaluate((fail) => window.__actionSafety.release(fail), mode === 'save-failure');
      await page.waitForFunction(() => window.__actionSafety.settled);
      const actions = await page.evaluate(() =>
        window.__actionSafety.calls.filter((call) => call.method === 'action'),
      );
      if (mode === 'normal') {
        assert.equal(actions.length, 1);
        assert.equal(actions[0].repoId, 'A');
        assert.equal(actions[0].payload.type, 'push');
        await dialog.waitFor({ state: 'hidden' });
      } else {
        assert.equal(actions.length, 0, `${mode}: old Push must not run`);
        assert.equal(await dialog.count(), 1, `${mode}: current dialog stays open`);
        assert.equal(
          await dialog.getByRole('button', { name: 'Push', exact: true }).isEnabled(),
          true,
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  console.log(
    'ALWAYGIT_ACTION_SAFETY_UI_TESTS_PASSED: pending save, duplicates, cancellation, repository switch/ABA, normal submit and save failure',
  );
}

/** Exercise deletion defaults and the post-confirmation save with mocked Git responses. */
export async function verifyDeletionDefaults(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
    errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repository = {
        id: 'deletion',
        name: 'Deletion fixture',
        root: '/main',
        commonDir: '/main/.git',
      };
      const commit = {
        oid: 'a'.repeat(40),
        parents: [],
        author: 'Fixture',
        email: 'fixture@example.com',
        timestamp: 0,
        subject: 'Deletion fixture',
      };
      const settings = {
        allowDetachedHead: false,
        pushFollowTags: false,
        pushTagAfterCreate: false,
        defaultResetMode: 'mixed',
        forceDeleteUnmergedBranches: true,
        forceRemoveDirtyWorktrees: false,
        deletionDefaultScopes: { branch: 'user', worktree: 'workspace' },
        scope: 'workspace',
        workspaceAvailable: true,
      };
      let refs = ['main', 'topic', 'savefail'].map((name) => ({
        name,
        fullName: 'refs/heads/' + name,
        kind: 'local',
        oid: commit.oid,
      }));
      let worktrees = ['/main', '/one', '/two'].map((path, index) => ({
        path,
        branch: ['main', 'one', 'two'][index],
        head: commit.oid,
        bare: false,
        detached: false,
      }));
      const snapshot = () => ({
        repository,
        branch: 'main',
        head: commit.oid,
        ahead: 0,
        behind: 0,
        changes: [],
        refs,
        remotes: [],
        stashes: [],
        worktrees,
        operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false },
        version: Date.now(),
      });
      const fixture = (window.__deletionFixture = {
        calls: [],
        cancelAction: false,
        partial: false,
        failSave: false,
      });
      window.acquireVsCodeApi = () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage(request) {
          fixture.calls.push(request);
          let result, error;
          if (request.method === 'repositories') result = [repository];
          if (request.method === 'snapshot') result = snapshot();
          if (request.method === 'history')
            result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
          if (request.method === 'details') result = { commit, body: commit.subject, files: [] };
          if (request.method === 'operationSettings')
            result = { ...settings, scope: request.payload?.scope ?? 'workspace' };
          if (request.method === 'saveOperationSettings') {
            if (fixture.failSave) error = { message: 'Preference write failed' };
            else {
              Object.assign(settings, request.payload);
              result = { ...settings };
            }
          }
          if (request.method === 'action') {
            if (fixture.cancelAction) error = { message: 'Operation cancelled' };
            else {
              const action = request.payload,
                targets = action.names ?? action.paths ?? [action.path];
              const succeeded = fixture.partial ? targets.slice(0, 1) : targets;
              const failures = fixture.partial
                ? targets.slice(1).map((target) => ({ target, message: 'uncommitted changes' }))
                : [];
              if (action.type === 'branch.delete')
                refs = refs.filter((ref) => !succeeded.includes(ref.name));
              else worktrees = worktrees.filter((tree) => !succeeded.includes(tree.path));
              const deletion = {
                kind: 'deletion',
                target: action.type === 'branch.delete' ? 'branch' : 'worktree',
                succeeded,
                failures,
              };
              if (failures.length)
                error = { message: '1 removed; 1 failed', deletionResult: deletion };
              else result = { snapshot: snapshot(), result: deletion };
            }
          }
          setTimeout(
            () => window.postMessage({ type: 'response', id: request.id, result, error }, '*'),
            0,
          );
        },
      });
    });
    await page.goto(url);
    await page.getByRole('option', { name: /^Deletion fixture/ }).dblclick();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settingsDialog.getByRole('button', { name: 'Git operations', exact: true }).click();
    assert.equal(
      await settingsDialog
        .getByRole('checkbox', {
          name: 'Select force deletion of unmerged branches by default',
          exact: true,
        })
        .isChecked(),
      true,
    );
    assert.equal(
      await settingsDialog
        .getByRole('checkbox', {
          name: 'Select forced removal of Worktrees with uncommitted changes by default',
          exact: true,
        })
        .isChecked(),
      false,
    );
    await settingsDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const openBranch = async (name) => {
      await page
        .getByRole('button', { name: 'Branch ' + name, exact: true })
        .click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete Branch…', exact: true }).click();
      return page.getByRole('dialog', { name: 'Delete Branch', exact: true });
    };
    const remember = (dialog) =>
      dialog.getByRole('checkbox', { name: 'Remember this selection as the default', exact: true });
    let dialog = await openBranch('topic');
    assert.equal(
      await dialog
        .getByRole('checkbox', { name: 'Force deletion of unmerged branches', exact: true })
        .isChecked(),
      true,
    );
    assert.equal(await remember(dialog).isChecked(), false);
    await remember(dialog).check();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          window.__deletionFixture.calls.filter((call) => call.method === 'saveOperationSettings')
            .length,
      ),
      0,
    );
    dialog = await openBranch('topic');
    await remember(dialog).check();
    await page.evaluate(() => {
      window.__deletionFixture.cancelAction = true;
    });
    await dialog.getByRole('button', { name: 'Delete Branch', exact: true }).click();
    await dialog.getByText('Operation cancelled', { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__deletionFixture.calls.filter((call) => call.method === 'saveOperationSettings')
            .length,
      ),
      0,
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => {
      window.__deletionFixture.cancelAction = false;
    });
    dialog = await openBranch('topic');
    await dialog
      .getByRole('checkbox', { name: 'Force deletion of unmerged branches', exact: true })
      .uncheck();
    await remember(dialog).check();
    await dialog
      .getByText('Saved to user defaults after at least one target is removed.', { exact: true })
      .waitFor();
    await dialog.getByRole('button', { name: 'Delete Branch', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__deletionFixture.calls.find((call) => call.method === 'saveOperationSettings')
            .payload,
      ),
      { forceDeleteUnmergedBranches: false, scope: 'user' },
    );
    const one = page.locator('[data-worktree-path="/one"]'),
      two = page.locator('[data-worktree-path="/two"]');
    await one.click();
    await two.click({ modifiers: ['Control'] });
    await one.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove 2 Worktrees…', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Remove 2 Worktrees', exact: true });
    await dialog.getByText('/one', { exact: true }).waitFor();
    await dialog.getByText('/two', { exact: true }).waitFor();
    const force = dialog.getByRole('checkbox', {
      name: 'Remove even with uncommitted changes',
      exact: true,
    });
    assert.equal(await force.isChecked(), false);
    await force.check();
    await remember(dialog).check();
    await page.evaluate(() => {
      window.__deletionFixture.partial = true;
    });
    await dialog.getByRole('button', { name: 'Remove 2 Worktrees', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__deletionFixture.calls.filter((call) => call.method === 'saveOperationSettings')
          .length === 2,
    );
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__deletionFixture.calls.filter(
            (call) => call.method === 'saveOperationSettings',
          )[1].payload,
      ),
      { forceRemoveDirtyWorktrees: true, scope: 'workspace' },
    );
    await page.getByText('Removed 1; 1 failed', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await two.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove Worktree…', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Remove Worktree', exact: true });
    assert.equal(
      await dialog
        .getByRole('checkbox', { name: 'Remove even with uncommitted changes', exact: true })
        .isChecked(),
      true,
    );
    assert.equal(await remember(dialog).isChecked(), false);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => {
      window.__deletionFixture.partial = false;
      window.__deletionFixture.failSave = true;
    });
    dialog = await openBranch('savefail');
    await remember(dialog).check();
    await dialog.getByRole('button', { name: 'Delete Branch', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page
      .getByTestId('action-feedback')
      .getByText(
        'Deletion completed, but the default could not be saved: Preference write failed',
        { exact: false },
      )
      .waitFor();
    const calls = await page.evaluate(() => window.__deletionFixture.calls);
    assert.equal(
      calls.filter((call) => call.method === 'action' && call.payload.names?.includes('savefail'))
        .length,
      1,
    );
    assert.deepEqual(errors, []);
    const demo = await browser.newPage();
    try {
      await demo.addInitScript(() => {
        localStorage.setItem(
          'alwaygit.demo-userOperationSettings',
          JSON.stringify({
            allowDetachedHead: true,
            pushFollowTags: true,
            pushTagAfterCreate: false,
            defaultResetMode: 'soft',
            forceDeleteUnmergedBranches: false,
            forceRemoveDirtyWorktrees: false,
            scope: 'user',
          }),
        );
        localStorage.setItem('alwaygit.demo-forceRemoveDirtyWorktrees', 'true');
      });
      await demo.goto(url);
      await demo.getByRole('button', { name: 'Settings', exact: true }).click();
      const demoSettings = demo.getByRole('dialog', { name: 'Settings', exact: true });
      await demoSettings.getByRole('button', { name: 'Git operations', exact: true }).click();
      await demoSettings
        .getByRole('combobox', { name: 'Save scope', exact: true })
        .selectOption('workspace');
      await demo.waitForFunction(
        () =>
          document.querySelector(
            'input[aria-label="Select forced removal of Worktrees with uncommitted changes by default"]',
          )?.checked === true,
      );
      assert.equal(
        await demoSettings
          .getByRole('checkbox', { name: /Allow direct.*Detached HEAD/ })
          .isChecked(),
        true,
      );
      assert.equal(
        await demoSettings
          .getByRole('checkbox', {
            name: 'Select force deletion of unmerged branches by default',
            exact: true,
          })
          .isChecked(),
        false,
      );
    } finally {
      await demo.close();
    }
    console.log(
      'ALWAYGIT_DELETION_UI_TESTS_PASSED: independent defaults, cancellation, remembered on/off, exact batch paths, partial success and preference failure',
    );
  } finally {
    await page.close();
  }
}
