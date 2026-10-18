import assert from 'node:assert/strict';

/** Exercise the real browser/store/RPC path; Git patch application is covered by real-Git tests. */
export async function verifyPartialStaging(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'hunks', root: '/hunks', commonDir: '/hunks/.git', name: 'Hunk fixture' };
      const head = 'a'.repeat(40), topic = 'b'.repeat(40), parent = 'c'.repeat(40);
      const commit = oid => ({ oid, parents: [parent], author: 'Fixture', email: 'fixture@example.com', timestamp: 1700000000, subject: 'Immutable commit' });
      const original = Array.from({ length: 180 }, (_, index) => `context ${index + 1}`).join('\n') + '\n';
      const replace = (text, line, value) => { const lines = text.split('\n'); lines[line - 1] = value; return lines.join('\n'); };
      const first = replace(original, 42, 'first hunk change'), working = replace(replace(first, 46, 'nearby independent change'), 130, 'second hunk change');
      const hunk = (id, start) => ({ id, header: `@@ -${start} +${start} @@`, beforeStart: start, beforeCount: 1, afterStart: start, afterCount: 1 });
      const firstId = '11111111-1111-4111-8111-111111111111', secondId = '22222222-2222-4222-8222-222222222222';
      const token = state => `00000000-0000-4000-8000-00000000000${state}`;
      const fixture = window.__hunkFixture = { calls: [], staged: false, discarded: false, version: 1, pendingPreviews: [], blockPreview: false, pendingAction: undefined, session: { version: 2, language: 'en', repoId: repo.id, drafts: { [repo.id]: 'Keep hunk draft' }, views: { [repo.id]: { tab: 'changes', selectedFile: 'file.txt' } } } };
      const snapshot = () => ({ repository: repo, branch: 'main', head, ahead: 0, behind: 0, remotes: [], changes: [{ path: 'file.txt', indexStatus: fixture.staged ? 'M' : ' ', worktreeStatus: 'M', conflict: false, untracked: false }, { path: 'other.txt', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false }], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: head }, { name: 'topic', fullName: 'refs/heads/topic', kind: 'local', oid: topic }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: fixture.version });
      const metadata = area => area === 'staged' ? { token: token(3), hunks: [hunk(firstId, 42)] } : { token: token(fixture.discarded ? 4 : fixture.staged ? 2 : 1), hunks: fixture.staged || fixture.discarded ? [hunk('33333333-3333-4333-8333-333333333333', 46), hunk(secondId, 130)] : [hunk(firstId, 42), hunk('33333333-3333-4333-8333-333333333333', 46), hunk(secondId, 130)] };
      fixture.releaseAction = () => { fixture.staged = fixture.pendingAction.type === 'stage-hunk'; if(fixture.pendingAction.type==='discard-hunk')fixture.discarded=true; fixture.version++; fixture.blockPreview = true; fixture.pendingAction.reply(); fixture.pendingAction = undefined; };
      fixture.releasePreviews = () => { fixture.blockPreview = false; fixture.pendingPreviews.splice(0).forEach(reply => reply()); };
      window.acquireVsCodeApi = () => ({ getState: () => fixture.session, setState: state => { fixture.session = state; }, postMessage(request) {
        fixture.calls.push(structuredClone(request));
        let result;
        const reply = () => setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 0);
        if (request.method === 'repositories') result = [repo];
        if (['repositoryCollections', 'repositoryStatuses'].includes(request.method)) result = [];
        if (request.method === 'repositoryOrder') result = { root: [], collections: {} };
        if (request.method === 'interfaceSettings') result = { language: 'en' };
        if (request.method === 'operationSettings') result = { scope: 'user' };
        if (request.method === 'snapshot') result = snapshot();
        if (request.method === 'history') result = { commits: [commit(head)], tips: [head], nextOffset: 1, hasMore: false };
        if (['details', 'inspectDetails'].includes(request.method)) result = { commit: commit(request.payload.oid), body: 'Read-only commit body', parent, files: [{ path: 'file.txt', status: 'M' }] };
        if (request.method === 'branchComparison') result = { baseRef: 'refs/heads/main', targetRef: 'refs/heads/topic', baseOid: head, targetOid: topic, mode: 'review', mergeBases: [parent], mergeBase: parent, diffBase: parent, files: [{ path: 'file.txt', status: 'M' }], base: { commits: [commit(head)], total: 1, nextOffset: 1, hasMore: false }, target: { commits: [commit(topic)], total: 1, nextOffset: 1, hasMore: false } };
        if (['diffPreview', 'isolatedDiffPreview'].includes(request.method)) {
          const target = request.payload, staged = target.kind === 'change' && target.area === 'staged', immutable = target.kind !== 'change';
          result = { kind: 'text', path: target.path, leftLabel: immutable ? 'Immutable before' : staged ? 'HEAD' : 'Index', rightLabel: immutable ? 'Immutable after' : staged ? 'Index' : 'Working Tree', left: immutable || staged || !fixture.staged ? original : first, right: immutable || staged ? first : fixture.discarded ? working.replace('first hunk change','context 42') : working,
            // Deliberately include metadata for immutable responses to verify the UI boundary too.
            patchHunks: metadata(staged ? 'staged' : 'unstaged') };
          if (fixture.blockPreview && !immutable) { fixture.pendingPreviews.push(reply); return; }
        }
        if (request.method === 'action') { fixture.pendingAction = { type: request.payload.type, reply }; return; }
        reply();
      } });
    });
    await page.goto(url.replace('?demo=1', ''));
    const diff = page.getByTestId('bottom-dock').getByTestId('diff-preview'), viewport = diff.locator('.diff-viewport');
    const firstStage = diff.locator('[data-hunk-id="11111111-1111-4111-8111-111111111111"]').getByRole('button', { name: 'Stage block', exact: true });
    await firstStage.waitFor();
    const anchor = async () => { await viewport.evaluate(element => { element.scrollTop = 36 * 18; element.dispatchEvent(new Event('scroll')); }); await firstStage.waitFor(); return viewport.evaluate(element => element.scrollTop); };
    const initialScroll = await anchor();
    assert.ok(initialScroll > 0, 'The fixture exercises a distant hunk and nonzero reading position');
    const geometry=await firstStage.evaluate(element=>{const line=element.closest('.diff-line'),gutter=element.parentElement;return {gutter:gutter.getBoundingClientRect().width,number:line.querySelector('.line-number').getBoundingClientRect().width};});
    assert.equal(geometry.gutter,32,'The center action gutter stays 32px wide');
    assert.ok(geometry.number<32,'Line numbers no longer reserve a wide action column');
    assert.equal(await firstStage.getAttribute('title'),'Stage block','Stage tooltip contains only the action name');
    assert.equal(await firstStage.innerText(),'«','Staging points from Working Tree to Index');
    await firstStage.hover();
    assert.ok(await diff.locator('.active-change .diff-side').evaluateAll(cells=>cells.every(cell=>getComputedStyle(cell).outlineStyle==='none')),'Hover adds no outlines over red and green changes');
    await firstStage.focus();
    await page.mouse.move(10,10);
    assert.ok(await diff.locator('.active-change').evaluateAll(rows=>rows.every(row=>getComputedStyle(row,'::after').borderTopWidth==='0px'&&getComputedStyle(row,'::after').borderBottomWidth==='0px')),'Keyboard block navigation adds no blue frame');
    await diff.screenshot({path:'artifacts/partial-staging-unstaged.png'});
    await firstStage.click();
    await page.waitForFunction(() => !!window.__hunkFixture.pendingAction);
    const stageRequest = await page.evaluate(() => window.__hunkFixture.calls.filter(call => call.method === 'action').at(-1));
    assert.equal(stageRequest.repoId, 'hunks');
    assert.deepEqual(stageRequest.payload, { type: 'stage-hunk', token: '00000000-0000-4000-8000-000000000001', hunkId: '11111111-1111-4111-8111-111111111111' }, 'The UI sends only host IDs, never displayed rows, a path, or reconstructed patch text');
    assert.equal(await firstStage.isDisabled(), true, 'In-flight writes disable hunk actions');
    await page.evaluate(() => window.__hunkFixture.releaseAction());
    await page.waitForFunction(() => window.__hunkFixture.pendingPreviews.length > 0);
    assert.equal(await firstStage.isDisabled(), true, 'The retained old preview cannot be reused while its replacement loads');
    const refreshed = await page.evaluate(() => { const calls = window.__hunkFixture.calls, action = calls.findIndex(call => call.method === 'action'); return calls.slice(action + 1).map(call => call.method); });
    assert.ok(refreshed.includes('snapshot') && refreshed.includes('diffPreview'), 'Action completion refreshes both repository status and the text comparison');
    await page.evaluate(() => window.__hunkFixture.releasePreviews());
    await diff.getByTestId('diff-change-count').getByText('1/2', { exact: true }).waitFor();
    assert.equal(await firstStage.count(), 0, 'The staged hunk disappears from the refreshed Unstaged comparison');
    assert.ok(Math.abs(await viewport.evaluate(element => element.scrollTop) - initialScroll) < 2, 'Same-area staging retains the reading position');
    assert.equal(await page.locator('#change-files-unstaged .preview-current .file-name').getAttribute('aria-label'), 'file.txt', 'Refresh keeps the selected file');
    await page.locator('#change-files-staged').getByRole('button', { name: 'file.txt', exact: true }).click();
    const unstage = diff.locator('[data-hunk-id="11111111-1111-4111-8111-111111111111"]').getByRole('button', { name: 'Unstage block', exact: true });
    await unstage.waitFor();
    await viewport.evaluate(element => { element.scrollTop = 36 * 18; element.dispatchEvent(new Event('scroll')); });
    const stagedScroll = await viewport.evaluate(element => element.scrollTop);
    assert.equal(await unstage.getAttribute('title'),'Unstage block','Unstage tooltip contains only the action name');
    assert.equal(await unstage.innerText(),'»','Unstaging points from HEAD to Index');
    await diff.screenshot({path:'artifacts/partial-staging-staged.png'});
    await unstage.click();
    await page.waitForFunction(() => !!window.__hunkFixture.pendingAction);
    assert.deepEqual(await page.evaluate(() => window.__hunkFixture.calls.filter(call => call.method === 'action').at(-1).payload), { type: 'unstage-hunk', token: '00000000-0000-4000-8000-000000000003', hunkId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(await unstage.isDisabled(), true);
    await page.evaluate(() => window.__hunkFixture.releaseAction());
    await page.waitForFunction(() => window.__hunkFixture.pendingPreviews.length > 0);
    await page.evaluate(() => window.__hunkFixture.releasePreviews());
    await firstStage.waitFor();
    await diff.locator('.diff-labels').getByText('Working Tree', { exact: true }).waitFor();
    assert.equal(await page.locator('#change-files-staged .file-name').count(), 0, 'Unstage removes the final staged block from the status list');
    assert.equal(await page.locator('#change-files-unstaged .preview-current .file-name').getAttribute('aria-label'), 'file.txt');
    assert.ok(Math.abs(await viewport.evaluate(element => element.scrollTop) - stagedScroll) < 2, 'Automatic Staged-to-Unstaged fallback preserves the same-file reading position');

    await page.getByTestId('history').locator('[data-oid]').first().click();
    await diff.locator('.diff-labels').getByText('Immutable after', { exact: true }).waitFor();
    assert.equal(await diff.locator('.diff-hunk-action').count(), 0, 'A historical Commit never exposes staging even with unexpected metadata');
    await page.getByTestId('history').locator('[data-working-tree]').click();
    await firstStage.waitFor();
    await page.getByTestId('sidebar').getByRole('button', { name: 'Branch topic', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Compare with Current Branch', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare branches', exact: true });
    await dialog.getByTestId('diff-preview').locator('.diff-labels').getByText('Immutable after', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.diff-hunk-action').count(), 0, 'An isolated branch comparison remains read-only while the main tab is Working Tree');
    // Simulate another pane changing the main selection while the inspector remains mounted.
    await page.getByTestId('history').locator('[data-oid]').first().dispatchEvent('click');
    await diff.locator('.diff-labels').getByText('Immutable after', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.diff-hunk-action').count(), 0, 'Main History selection cannot enable isolated hunk actions');
    await page.getByTestId('history').locator('[data-working-tree]').dispatchEvent('click');
    await firstStage.waitFor();
    assert.equal(await dialog.locator('.diff-hunk-action').count(), 0, 'Returning the main tab to Working Tree cannot leak its actions into the inspector');
    await dialog.locator('.comparison-commit-list button').first().click();
    await dialog.getByText('Read-only commit body', { exact: true }).waitFor();
    await dialog.getByTestId('diff-preview').locator('.diff-labels').getByText('Immutable after', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.diff-hunk-action').count(), 0, 'An isolated Commit inspector remains read-only');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await firstStage.waitFor();
    const discard=diff.locator('[data-hunk-id="11111111-1111-4111-8111-111111111111"]').getByRole('button',{name:'Discard block',exact:true});
    await discard.click();
    const confirmation=page.getByRole('dialog',{name:'Discard this change block?',exact:true});
    await confirmation.waitFor();
    assert.ok((await confirmation.innerText()).includes('file.txt')&&(await confirmation.innerText()).includes('@@ -42 +42 @@'),'Confirmation binds the file and exact block');
    assert.equal(await page.evaluate(()=>window.__hunkFixture.calls.filter(call=>call.method==='action').length),2,'Opening discard never writes');
    assert.equal(await confirmation.evaluate(element=>getComputedStyle(element).getPropertyValue('--panel')),await diff.evaluate(element=>getComputedStyle(element).getPropertyValue('--panel')),'The anchored confirmation inherits the current workbench theme');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel','Destructive confirmation defaults to Cancel');
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    await firstStage.waitFor();
    await discard.click();
    await confirmation.waitFor();
    await page.locator('#change-files-unstaged').getByRole('button',{name:'other.txt',exact:true}).dispatchEvent('click');
    await confirmation.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.__hunkFixture.calls.filter(call=>call.method==='action').length),2,'Changing the comparison invalidates an open discard confirmation');
    await page.locator('#change-files-unstaged').getByRole('button',{name:'file.txt',exact:true}).dispatchEvent('click');
    await firstStage.waitFor();
    await discard.click();
    await confirmation.waitFor();
    await confirmation.screenshot({path:'artifacts/partial-staging-discard-confirm.png'});
    await confirmation.getByRole('button',{name:'Discard block',exact:true}).click();
    await page.waitForFunction(()=>window.__hunkFixture.pendingAction?.type==='discard-hunk');
    assert.deepEqual(await page.evaluate(()=>window.__hunkFixture.calls.filter(call=>call.method==='action').at(-1).payload),{type:'discard-hunk',token:'00000000-0000-4000-8000-000000000001',hunkId:'11111111-1111-4111-8111-111111111111'});
    assert.equal(await discard.isDisabled(),true);
    await page.evaluate(()=>window.__hunkFixture.releaseAction());
    await page.waitForFunction(()=>window.__hunkFixture.pendingPreviews.length>0);
    await page.evaluate(()=>window.__hunkFixture.releasePreviews());
    await diff.getByTestId('diff-change-count').getByText('1/2',{exact:true}).waitFor();
    assert.equal(await firstStage.count(),0,'Only the discarded block disappears');
    await diff.locator('[data-hunk-id="33333333-3333-4333-8333-333333333333"]').getByRole('button',{name:'Stage block',exact:true}).waitFor();
    const final = await page.evaluate(() => ({ writes: window.__hunkFixture.calls.filter(call => call.method === 'action').map(call => call.payload.type), draft: window.__hunkFixture.session.drafts.hunks, isolated: window.__hunkFixture.calls.filter(call => call.method === 'isolatedDiffPreview').map(call => call.payload.kind) }));
    assert.deepEqual(final.writes, ['stage-hunk', 'unstage-hunk', 'discard-hunk'], 'Inspection and canceled confirmations create no writes');
    assert.equal(final.draft, 'Keep hunk draft');
    assert.ok(final.isolated.includes('comparison') && final.isolated.includes('commit'));
    assert.deepEqual(errors, [], 'The hunk flow must not throw browser runtime errors');
    console.log('ALWAYGIT_PARTIAL_STAGING_UI_PASSED: Stage/Unstage/Discard opaque payloads, scoped confirmation/cancel, pending/refresh guards, snapshots, selection/scroll, immutable Commit and isolated comparisons');
  } catch (error) { console.error((await page.locator('body').innerText()).slice(-5000)); throw error; }
  finally { await page.close(); }
}
