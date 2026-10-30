import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

/** Browser-side host fixture: exercise shipped React, store, RPC cancellation and session persistence. */
function installFixture(mode) {
  const repo = {
    id: 'workflow',
    root: '/workflow',
    commonDir: '/workflow/.git',
    name: 'Workflow fixture',
  };
  const head = 'a'.repeat(40),
    parent = 'b'.repeat(40),
    incoming = 'c'.repeat(40);
  const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  const commit = (oid = head, subject = 'Workflow commit') => ({
    oid,
    parents: [parent],
    author: 'Fixture',
    email: 'fixture@example.com',
    timestamp: 1700000000,
    subject,
  });
  const original =
    Array.from({ length: 14 }, (_, index) => `context ${index + 1}`).join('\n') + '\n';
  const working = original.replace(
    'context 2\ncontext 3\ncontext 4',
    'changed 2\nchanged 3\nchanged 4',
  );
  const fixture = (window.__workflowFixture = {
    calls: [],
    mode,
    version: 1,
    staged: false,
    resolved: false,
    finished: false,
    chosen: false,
    pendingHistory: [],
    session: JSON.parse(localStorage.getItem('workflow-ui-session') || 'null') ?? {
      version: 2,
      language: 'en',
      repoId: repo.id,
      drafts: { [repo.id]: 'Preserve workflow draft' },
      views: { [repo.id]: { tab: 'changes', search: '', selectedFile: 'file.txt' } },
    },
  });
  const conflict = () => mode === 'conflict' && !fixture.resolved;
  const snapshot = () => ({
    repository: repo,
    branch: 'main',
    head,
    ahead: 0,
    behind: 0,
    refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: head }],
    remotes: [],
    stashes: [],
    worktrees: [],
    version: fixture.version,
    changes: fixture.finished
      ? []
      : [
          {
            path: 'file.txt',
            indexStatus: conflict() ? 'U' : fixture.staged || fixture.resolved ? 'M' : ' ',
            worktreeStatus: conflict() ? 'U' : fixture.resolved ? ' ' : 'M',
            conflict: conflict(),
            untracked: false,
          },
        ],
    operation:
      mode === 'conflict' && !fixture.finished
        ? {
            kind: 'merge',
            conflicts: conflict() ? 1 : 0,
            canContinue: !conflict(),
            canAbort: true,
            canSkip: false,
          }
        : { conflicts: 0, canContinue: false, canAbort: false, canSkip: false },
  });
  const metadata = () => ({
    token: uuid(fixture.staged ? 2 : 1),
    hunks: [
      {
        id: uuid(10),
        header: '@@ -2,3 +2,3 @@',
        beforeStart: 2,
        beforeCount: 3,
        afterStart: 2,
        afterCount: 3,
      },
    ],
  });
  const entry = (name, treePath, type = 'blob') => ({
    name,
    path: treePath,
    type,
    mode: type === 'tree' ? '040000' : '100644',
    oid: 'e'.repeat(40),
    ...(type === 'tree' ? {} : { size: 17 }),
  });
  window.acquireVsCodeApi = () => ({
    getState: () => fixture.session,
    setState: (state) => {
      fixture.session = state;
      localStorage.setItem('workflow-ui-session', JSON.stringify(state));
    },
    postMessage(request) {
      fixture.calls.push(structuredClone(request));
      let result;
      const reply = () =>
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 0);
      if (request.method === 'repositories') result = [repo];
      if (['repositoryCollections', 'repositoryStatuses'].includes(request.method)) result = [];
      if (request.method === 'repositoryOrder') result = { root: [], collections: {} };
      if (request.method === 'interfaceSettings') result = { language: 'en' };
      if (request.method === 'operationSettings') result = { scope: 'user' };
      if (request.method === 'snapshot') result = snapshot();
      if (request.method === 'history') {
        result = { commits: [commit()], tips: [head], nextOffset: 1, hasMore: false };
        if (request.payload.filters?.author === 'Bob') {
          fixture.pendingHistory.push(() => {
            result = {
              commits: [commit('d'.repeat(40), 'Stale history response')],
              tips: [head],
              nextOffset: 1,
              hasMore: false,
            };
            reply();
          });
          return;
        }
      }
      if (['details', 'inspectDetails'].includes(request.method))
        result = {
          commit: commit(request.payload.oid),
          parent,
          body: 'Immutable workflow details',
          files: [{ path: 'file.txt', status: 'M' }],
        };
      if (request.method === 'revisionTree')
        result = {
          revision: request.payload.revision,
          path: request.payload.path ?? '',
          entries:
            request.payload.path === 'src'
              ? [entry('loaded.txt', 'src/loaded.txt')]
              : [
                  entry('src', 'src', 'tree'),
                  entry('deep', 'deep', 'tree'),
                  entry('README.md', 'README.md'),
                ],
        };
      if (request.method === 'revisionTreeSearch')
        result = {
          revision: request.payload.revision,
          query: request.payload.query,
          entries: [entry('unloaded.txt', 'deep/unloaded.txt')],
          truncated: false,
        };
      if (['diffPreview', 'isolatedDiffPreview'].includes(request.method)) {
        const target = request.payload,
          historical = target.kind !== 'change';
        result = {
          kind: 'text',
          path: target.path,
          leftLabel: historical
            ? 'Historical source'
            : target.area === 'conflict'
              ? 'Ours'
              : 'Index',
          rightLabel: historical
            ? 'Current working file'
            : target.area === 'conflict'
              ? 'Theirs'
              : 'Working Tree',
          left: original,
          right: working,
          // Historical metadata is deliberately injected to test the UI write boundary.
          patchHunks: historical || !fixture.staged ? metadata() : { hunks: [] },
        };
      }
      if (request.method === 'conflictDetails')
        result = {
          token: uuid(fixture.chosen ? 51 : 50),
          path: 'file.txt',
          status: 'UU',
          operation: 'merge',
          head,
          incoming,
          base: { oid: parent, mode: '100644', size: 5 },
          ours: { oid: head, mode: '100644', size: 5 },
          theirs: { oid: incoming, mode: '100644', size: 9 },
          canMerge: true,
          canChoose: true,
          canEdit: true,
        };
      if (request.method === 'openMergeEditor') result = { mode: 'text' };
      if (request.method === 'operationReview')
        result = { kind: 'merge', token: uuid(60), files: [{ path: 'file.txt', lines: [] }] };
      if (request.method === 'action') {
        const action = request.payload;
        if (action.type === 'conflict.choose') fixture.chosen = true;
        if (action.type === 'resolve-and-stage') fixture.resolved = true;
        if (action.type === 'operation.continue') fixture.finished = true;
        fixture.version++;
        result = { snapshot: snapshot() };
      }
      reply();
    },
  });
}

async function openFixture(browser, url, mode) {
  const page = await browser.newPage({ viewport: { width: 1520, height: 1080 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installFixture, mode);
  await page.goto(url.replace('?demo=1', ''));
  await page.getByTestId('history').locator('[data-oid]').first().waitFor();
  return { page, errors };
}

async function verifySearchAndTree(browser, url) {
  const { page, errors } = await openFixture(browser, url, 'ordinary');
  try {
    const diff = page.getByTestId('bottom-dock').getByTestId('diff-preview');
    await diff.locator('.diff-hunk-action').first().waitFor();
    assert.equal(
      await diff.locator('.diff-select-line,.diff-line-selection').count(),
      0,
      'Only block actions remain available in the working Diff',
    );
    await page.getByTestId('history').locator('[data-oid]').first().click();
    await page
      .getByTestId('details')
      .getByRole('button', { name: 'Full Tree', exact: true })
      .click();
    const tree = page.getByRole('tree', { name: 'Full repository tree', exact: true });
    await tree.getByRole('button', { name: 'src', exact: true }).click();
    await tree.getByRole('button', { name: 'loaded.txt', exact: true }).waitFor();
    assert.ok(
      (await page.evaluate(() => window.__workflowFixture.calls)).some(
        (call) => call.method === 'revisionTree' && call.payload.path === 'src',
      ),
      'Expanding a directory loads its own children',
    );
    assert.ok(
      !(await page.evaluate(() => window.__workflowFixture.calls)).some(
        (call) => call.method === 'revisionTree' && call.payload.path === 'deep',
      ),
      'The deep directory is still unloaded',
    );
    await page
      .getByRole('searchbox', { name: 'Search all paths in this Commit', exact: true })
      .fill('unloaded');
    await tree.getByRole('button', { name: 'unloaded.txt', exact: true }).click();
    await diff.locator('.diff-labels').getByText('Historical source', { exact: true }).waitFor();
    assert.equal(
      await diff.locator('.diff-hunk-action').count(),
      0,
      'An arbitrary historical file remains read-only even if the host includes writable metadata',
    );
    const target = await page.evaluate(
      () =>
        window.__workflowFixture.calls.filter((call) => call.method === 'diffPreview').at(-1)
          .payload,
    );
    assert.deepEqual(target, {
      kind: 'revision',
      revision: 'a'.repeat(40),
      path: 'deep/unloaded.txt',
      paged: true,
    });
    await page.getByTestId('details').screenshot({ path: 'artifacts/workflow-tree-search.png' });
    await diff
      .getByRole('button', { name: 'Open Historical File in VS Code', exact: true })
      .click();
    await page.waitForFunction(() =>
      window.__workflowFixture.calls.some(
        (call) => call.method === 'openRevision' && call.payload.path === 'deep/unloaded.txt',
      ),
    );
    await tree
      .getByRole('button', { name: 'unloaded.txt', exact: true })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Compare with Working Tree', exact: true }).click();
    await page.waitForFunction(() =>
      window.__workflowFixture.calls.some(
        (call) =>
          call.method === 'diff' &&
          call.payload.kind === 'revision' &&
          call.payload.path === 'deep/unloaded.txt',
      ),
    );
    assert.equal(
      await page.evaluate(
        () => window.__workflowFixture.calls.filter((call) => call.method === 'action').length,
      ),
      0,
      'Browsing and comparing an unloaded historical file performs no write',
    );

    const history = page.getByTestId('history');
    await history.getByRole('button', { name: 'Advanced history search', exact: true }).click();
    const author = history.getByRole('textbox', {
      name: 'Author name or email (literal)',
      exact: true,
    });
    await author.fill('Alice');
    await history
      .getByRole('textbox', {
        name: 'File or directory (literal, repository relative)',
        exact: true,
      })
      .fill('src/[literal]');
    await history.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.waitForFunction(
      () => window.__workflowFixture.session.views.workflow.historyFilters?.author === 'Alice',
    );
    const filtered = await page.evaluate(() =>
      window.__workflowFixture.calls.filter((call) => call.method === 'history').at(-1),
    );
    assert.deepEqual(filtered.payload.filters, { author: 'Alice', path: 'src/[literal]' });
    await author.fill('Bob');
    await history.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.waitForFunction(() => window.__workflowFixture.pendingHistory.length === 1);
    assert.equal(
      await history.locator('[data-oid]').count(),
      0,
      'Applying new conditions clears rows before the new query finishes',
    );
    await history.getByRole('button', { name: 'Cancel history query', exact: true }).click();
    await page.waitForFunction(() =>
      window.__workflowFixture.calls.some((call) => call.method === 'cancelQuery'),
    );
    await page.evaluate(() =>
      window.__workflowFixture.pendingHistory.splice(0).forEach((reply) => reply()),
    );
    assert.equal(await history.getByText('Stale history response', { exact: true }).count(), 0);
    await page.waitForFunction(
      () => window.__workflowFixture.session.views.workflow.historyFilters?.author === 'Bob',
    );
    await page.reload();
    await page
      .getByTestId('history')
      .getByRole('textbox', { name: 'Author name or email (literal)', exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByTestId('history')
        .getByRole('textbox', { name: 'Author name or email (literal)', exact: true })
        .inputValue(),
      'Bob',
      'Applied filters survive a real page reload',
    );
    assert.equal(
      await page.evaluate(() => window.__workflowFixture.session.drafts.workflow),
      'Preserve workflow draft',
    );
    await page
      .getByTestId('history')
      .getByRole('button', { name: 'Cancel history query', exact: true })
      .click();
    assert.deepEqual(errors, [], 'Workflow additions must not produce runtime errors');
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(-6000));
    throw error;
  } finally {
    await page.close();
  }
}

async function verifyConflictWorkflow(browser, url) {
  const { page, errors } = await openFixture(browser, url, 'conflict');
  try {
    await page
      .getByTestId('operation-notice')
      .getByRole('button', { name: 'Resolve conflicts', exact: true })
      .click();
    const workflow = page.getByRole('dialog', { name: 'Resolve conflicts', exact: true });
    await workflow.getByRole('button', { name: 'Open merge editor', exact: true }).click();
    await workflow
      .getByRole('status')
      .filter({ hasText: 'The native merge editor is unavailable' })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__workflowFixture.calls.filter((call) => call.method === 'openMergeEditor').at(-1)
            .payload,
      ),
      { path: 'file.txt' },
    );
    const choose = workflow.getByRole('button', {
      name: 'Use Index stage 3 (incoming)',
      exact: true,
    });
    await choose.click();
    const confirmation = workflow.locator('.conflict-choice');
    await workflow.screenshot({ path: 'artifacts/workflow-conflict-confirm.png' });
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => window.__workflowFixture.calls.filter((call) => call.method === 'action').length,
      ),
      0,
      'Canceling a whole-side choice performs no write',
    );
    await choose.click();
    await confirmation.getByRole('button', { name: 'Proceed', exact: true }).click();
    await page.waitForFunction(() => window.__workflowFixture.chosen);
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__workflowFixture.calls.filter((call) => call.method === 'action').at(-1).payload,
      ),
      { type: 'conflict.choose', token: '00000000-0000-4000-8000-000000000050', side: 'theirs' },
    );
    await workflow.getByText('Remaining unmerged files: 1', { exact: true }).waitFor();
    await workflow.getByRole('button', { name: 'Saved: mark and stage', exact: true }).click();
    await workflow.getByText('Remaining unmerged files: 0', { exact: true }).waitFor();
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__workflowFixture.calls.filter((call) => call.method === 'action').at(-1).payload,
      ),
      { type: 'resolve-and-stage', paths: ['file.txt'] },
    );
    await workflow.getByRole('button', { name: 'Review Staged Result', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Inspect Staged Result', exact: true });
    await review.waitFor();
    assert.equal(
      await page.evaluate(
        () => window.__workflowFixture.calls.filter((call) => call.method === 'action').length,
      ),
      2,
      'Opening staged review does not continue Git',
    );
    await review.getByRole('button', { name: 'Confirm & Continue', exact: true }).click();
    await page.waitForFunction(() => window.__workflowFixture.finished);
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__workflowFixture.calls.filter((call) => call.method === 'action').at(-1).payload,
      ),
      {
        type: 'operation.continue',
        kind: 'merge',
        reviewToken: '00000000-0000-4000-8000-000000000060',
      },
    );
    await page.getByTestId('operation-notice').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, [], 'Conflict workflow must not produce runtime errors');
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(-6000));
    throw error;
  } finally {
    await page.close();
  }
}

export async function verifyWorkflowAdditions(browser, url) {
  await mkdir('artifacts', { recursive: true });
  await verifySearchAndTree(browser, url);
  await verifyConflictWorkflow(browser, url);
  console.log(
    'ALWAYGIT_WORKFLOW_ADDITIONS_UI_PASSED: lazy historical tree/read-only comparisons, advanced apply/cancel/persistence, conflict fallback/confirmation/stage/review',
  );
}
