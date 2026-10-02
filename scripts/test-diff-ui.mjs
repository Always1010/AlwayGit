import assert from 'node:assert/strict';

export async function verifyDiffNavigation(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await addDiffFixture(page, 'file');
    await page.goto(url);
    await page.getByRole('option', { name: 'Diff fixture' }).dblclick();
    const diff = page.getByTestId('diff-preview'), count = diff.getByTestId('diff-change-count'), summary = diff.getByTestId('diff-change-summary'), viewport = diff.locator('.diff-viewport');
    const assertRevealed = async () => {
      await page.waitForFunction(() => {
        const block = document.querySelector('.active-change-start'), viewport = document.querySelector('.diff-viewport');
        if (!block || !viewport) return false;
        const a = block.getBoundingClientRect(), b = viewport.getBoundingClientRect();
        return a.y >= b.y - 1 && a.bottom <= b.bottom + 1;
      });
    };
    await count.getByText('1/3', { exact: true }).waitFor();
    await assertRevealed();
    assert.ok(await viewport.evaluate(element => element.scrollTop > 0), 'The first distant change is revealed automatically');
    assert.equal(await summary.locator('.diff-change-added').innerText(), '+0');
    assert.equal(await summary.locator('.diff-change-modified').innerText(), '~3');
    assert.equal(await summary.locator('.diff-change-removed').innerText(), '−0');
    assert.equal(await count.evaluate(element => getComputedStyle(element).borderTopWidth), '0px', 'Current/total count is flat text, not an input-like badge');
    const resize = page.getByRole('separator', { name: 'Resize Diff panel' });
    await resize.press('End');
    assert.ok((await diff.boundingBox()).height > 450, 'Diff panel maximum follows the available workbench height');
    const expandedHeight = (await diff.boundingBox()).height;
    await diff.getByRole('button', { name: 'Minimize Diff panel' }).click();
    assert.ok((await diff.boundingBox()).height <= 27, 'Minimized Diff keeps only its heading');
    assert.equal(await diff.locator('.diff-viewport').count(), 0);
    await diff.getByRole('button', { name: 'Expand Diff panel' }).click();
    assert.ok(Math.abs((await diff.boundingBox()).height - expandedHeight) < 2, 'Expanded Diff restores its previous height');
    assert.equal(await diff.getByRole('button', { name: 'Previous change' }).isEnabled(), true);
    await diff.getByRole('button', { name: 'Previous change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('1/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('2/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    assert.equal(await diff.getByRole('button', { name: 'Next change' }).isEnabled(), true);
    const block = diff.locator('.active-change-start');
    const blockBox = await block.boundingBox(), viewportBox = await viewport.boundingBox();
    assert.ok(blockBox.y >= viewportBox.y && blockBox.y < viewportBox.y + viewportBox.height, 'Jump must reveal the current block');
    const borders = await diff.locator('.active-change').evaluateAll(rows => rows.map(row => { const style = getComputedStyle(row, '::after'); return { top: style.borderTopWidth, bottom: style.borderBottomWidth, outline: getComputedStyle(row).outlineStyle }; }));
    assert.equal(borders.filter(border => border.top === '1px').length, 1);
    assert.equal(borders.filter(border => border.bottom === '1px').length, 1);
    assert.ok(borders.every(border => border.outline === 'none'), 'No outline on individual changed lines');
    await viewport.evaluate(element => { element.scrollLeft = 220; element.dispatchEvent(new Event('scroll')); });
    const halves = await diff.locator('.active-change-start').evaluate(row => [...row.children].map(cell => cell.getBoundingClientRect().width));
    assert.ok(halves.every(width => width > 300 && width < 700), 'Both columns retain half viewport width for long lines');
    assert.equal(await count.innerText(), '3/3', 'Horizontal scroll must not change current block');
    assert.ok(await viewport.evaluate(element => element.scrollWidth > element.clientWidth));
    await page.setViewportSize({ width: 960, height: 700 });
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.diff-viewport'), row = document.querySelector('.diff-line');
      return Math.abs(row.getBoundingClientRect().width - viewport.clientWidth) < 1;
    });
    const resizedHalves = await diff.locator('.active-change-start').evaluate(row => [...row.children].map(cell => cell.getBoundingClientRect().width));
    assert.ok(resizedHalves.every(width => width < 400), 'Resize recomputes both comparison columns');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.diff-line').getBoundingClientRect().width - document.querySelector('.diff-viewport').clientWidth) < 1);
    await viewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await count.getByText('1/3', { exact: true }).waitFor();
    await page.getByTestId('details').getByRole('button', { name: 'same.txt', exact: true }).click();
    await count.getByText('0/0', { exact: true }).waitFor();
    assert.equal(await diff.getByRole('button', { name: 'Previous change' }).isDisabled(), true);
    assert.equal(await diff.getByRole('button', { name: 'Next change' }).isDisabled(), true);
    assert.equal(await viewport.evaluate(element => element.scrollLeft), 0);
    await diff.getByRole('button', { name: 'Minimize Diff panel' }).click();
    await page.getByTestId('details').getByRole('button', { name: 'single.txt', exact: true }).click();
    await count.getByText('1/1', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Expand Diff panel' }).click();
    await assertRevealed();
    for (const direction of ['Previous change', 'Next change']) {
      assert.equal(await diff.getByRole('button', { name: direction }).isEnabled(), true);
      await viewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
      await diff.getByRole('button', { name: direction }).click();
      await assertRevealed();
      assert.equal(await count.innerText(), '1/1', 'Repeated single-change navigation retains the only block');
    }
    const singleScroll = await viewport.evaluate(element => element.scrollTop);
    await diff.getByRole('button', { name: 'Minimize Diff panel' }).click();
    await diff.getByRole('button', { name: 'Expand Diff panel' }).click();
    await assertRevealed();
    assert.ok(Math.abs(await viewport.evaluate(element => element.scrollTop) - singleScroll) < 2, 'Collapse/expand preserves the reading position');
    await page.getByTestId('details').getByRole('button', { name: 'large.txt', exact: true }).click();
    await count.getByText('1/1', { exact: true }).waitFor();
    // Both files have one block; wait for the tall block rather than the old count.
    await page.waitForFunction(() => document.querySelectorAll('.diff-line.active-change').length > 1);
    await assertRevealed();
    const largeStart = await diff.locator('.active-change-start').boundingBox(), largeViewport = await viewport.boundingBox();
    assert.ok(Math.abs(largeStart.y - largeViewport.y) < 2, `A block taller than the viewport is revealed from its beginning (block ${largeStart.y}, viewport ${largeViewport.y}, height ${largeViewport.height})`);
    const topRow = await viewport.evaluate(element => element.scrollTop / document.querySelector('.diff-line').getBoundingClientRect().height);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('interface-settings'), dialog = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Diff', exact: true }).click();
    await settings.getByLabel('Diff line height', { exact: true }).selectOption('24');
    await page.waitForFunction(() => document.querySelector('.diff-line')?.getBoundingClientRect().height === 24);
    const resizedTopRow = await viewport.evaluate(element => element.scrollTop / 24);
    assert.ok(Math.abs(resizedTopRow - topRow) < .1, `Height preview retains the top reading row (${topRow} → ${resizedTopRow})`);
    await settings.getByLabel('Diff font', { exact: true }).selectOption('18');
    await settings.getByLabel('Diff line height', { exact: true }).selectOption('18');
    await page.waitForFunction(() => document.querySelector('.diff-line')?.getBoundingClientRect().height === 22);
    assert.equal(await diff.locator('.diff-line').first().evaluate(element => getComputedStyle(element).lineHeight), '22px', 'CSS and virtual rows agree on the safe minimum for large text');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.diff-line')?.getBoundingClientRect().height === 18);
    await viewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await diff.getByRole('button', { name: 'Next change' }).click();
    await assertRevealed();
    await page.getByTestId('history').locator('[data-working-tree]').click();
    await count.getByText('1/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    const scroll = await viewport.evaluate(element => element.scrollTop);
    await page.evaluate(() => { const fixture = window.__diffFixture, left = fixture.left.split('\n'), right = fixture.right.split('\n'); for (const i of [26, 27, 28]) right[i] = left[i]; fixture.right = right.join('\n'); fixture.emit(); });
    await count.getByText('2/2', { exact: true }).waitFor();
    assert.ok(Math.abs(await viewport.evaluate(element => element.scrollTop) - scroll) < 2, 'Same-file refresh retains scroll');
    await page.evaluate(() => { window.__diffFixture.truncated = true; window.__diffFixture.emit(); });
    await count.getByText('2/2 (preview)', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_DIFF_UI_TESTS_PASSED: initial reveal, cyclic/single-change navigation, tall blocks, collapse/restore, type summary, scrolling, refresh remap and truncation');
  } finally { await page.close(); }
  await verifyCommitNavigation(browser, url);
  await verifyImagePreview(browser, url);
}

async function verifyImagePreview(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo={id:'images',root:'/images',commonDir:'/images/.git',name:'Image fixture'},commit={oid:'1'.repeat(40),parents:[],author:'Fixture',email:'fixture@example.com',timestamp:0,subject:'Images'};
      const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const snapshot={repository:repo,branch:'main',head:commit.oid,ahead:0,behind:0,changes:[{path:'image.png',indexStatus:' ',worktreeStatus:'M',conflict:false,untracked:false},{path:'binary.bin',indexStatus:' ',worktreeStatus:'M',conflict:false,untracked:false}],refs:[{name:'main',fullName:'refs/heads/main',kind:'local',oid:commit.oid}],stashes:[],worktrees:[],operation:{conflicts:0,canContinue:false,canAbort:false,canSkip:false},version:1};
      window.acquireVsCodeApi=()=>({getState:()=>null,setState(){},postMessage(request){let result;
        if(request.method==='repositories')result=[repo];
        if(request.method==='repositoryCollections')result=[];
        if(request.method==='repositoryOrder')result={root:[],collections:{}};
        if(request.method==='repositoryStatuses')result=[];
        if(request.method==='operationSettings')result={allowDetachedHead:false,scope:'workspace'};
        if(request.method==='snapshot')result=snapshot;
        if(request.method==='history')result={commits:[commit],tips:[commit.oid],nextOffset:1,hasMore:false};
        if(request.method==='details')result={commit,body:'',files:[]};
        if(request.method==='diffPreview')result=request.payload.path==='image.png'?{kind:'image',path:'image.png',leftLabel:'Before',rightLabel:'After',left:{mimeType:'image/png',data:image,byteLength:68,width:1,height:1},right:{mimeType:'image/png',data:image,byteLength:68,width:1,height:1}}:{kind:'binary',reason:'unsupported',path:'binary.bin',leftLabel:'Before',rightLabel:'After'};
        setTimeout(()=>window.postMessage({type:'response',id:request.id,result},'*'),0);
      }});
    });
    await page.goto(url);
    await page.getByRole('option',{name:'Image fixture'}).dblclick();
    await page.getByTestId('history').locator('[data-working-tree]').click();
    const diff=page.getByTestId('diff-preview');
    await diff.locator('.image-diff img').first().waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.image-diff img')].every(image=>image.complete&&image.naturalWidth===1));
    assert.equal(await diff.locator('.image-diff img').count(),2);
    assert.equal(await diff.getByTestId('diff-change-summary').locator('.diff-change-modified').innerText(),'~1');
    assert.equal(await diff.getByTestId('diff-change-count').innerText(),'1/1');
    assert.equal(await diff.getByRole('button',{name:'Open Diff'}).isDisabled(),true);
    assert.equal(await diff.getByRole('button',{name:'Edit in VS Code'}).isDisabled(),true);
    await diff.getByRole('button',{name:'Show images at actual size'}).click();
    assert.equal(await diff.getByRole('button',{name:'Show images at actual size'}).getAttribute('aria-pressed'),'true');
    await diff.getByRole('button',{name:'Maximize image preview'}).click();
    assert.ok(await diff.evaluate(element=>element.classList.contains('diff-preview-maximized')));
    await diff.getByRole('button',{name:'Restore image preview'}).click();
    await page.getByTestId('details').getByRole('button',{name:'binary.bin',exact:true}).click();
    await diff.getByText('Binary file: text preview unavailable',{exact:true}).waitFor();
    assert.equal(await diff.getByRole('button',{name:'Open Diff'}).isDisabled(),true);
    assert.equal(await diff.getByRole('button',{name:'Edit in VS Code'}).isDisabled(),true);
    assert.deepEqual(errors,[]);
    console.log('ALWAYGIT_IMAGE_DIFF_UI_TESTS_PASSED: side-by-side image preview, metadata, zoom, maximize and disabled native actions');
  } finally { await page.close(); }
}

async function addDiffFixture(page, diffNavigationScope) {
    await page.addInitScript(scope => {
      const repo = { id: 'diff', root: '/diff', commonDir: '/diff/.git', name: 'Diff fixture' };
      const commit = { oid: 'a'.repeat(40), parents: ['b'.repeat(40), 'c'.repeat(40)], author: 'Fixture', email: 'test@example.com', timestamp: 0, subject: 'Diff navigation' };
      const lines = Array.from({ length: 130 }, (_, i) => `context line ${i}`);
      lines[81] = 'left long ' + '0123456789'.repeat(120);
      const right = lines.map((line, i) => [26, 27, 28, 40, 41, 42, 80, 81, 82].includes(i) ? i === 81 ? 'right long ' + 'abcdefghij'.repeat(120) : `changed line ${i}` : line);
      const fixture = window.__diffFixture = { commit, calls: [], previews: [], failPath: null, holdPath: null, held: [], emptyFiles: false, left: lines.join('\n'), right: right.join('\n'), truncated: false,
        snapshot: { repository: repo, branch: 'main', head: commit.oid, ahead: 0, behind: 0, changes: [{ path: 'diff.txt', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false }], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 0 },
        emit() { window.postMessage({ type: 'changed', repoId: repo.id, changes: { paths: ['diff.txt'] } }, '*'); },
      };
      window.acquireVsCodeApi = () => ({ getState: () => JSON.parse(localStorage.getItem('alwaygit.diff-fixture-session') || 'null') ?? { diffNavigationScope: scope }, setState: state => localStorage.setItem('alwaygit.diff-fixture-session', JSON.stringify(state)), postMessage(request) {
        if (request.method === 'saveSession') { setTimeout(() => window.postMessage({ type: 'response', id: request.id, result: null }, '*'), 0); return; }
        fixture.calls.push(request.method);
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = structuredClone({ ...fixture.snapshot, version: ++fixture.snapshot.version });
        if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
        if (request.method === 'details') result = { commit, parent: request.payload.parent ?? commit.parents[0], body: '', files: ['diff.txt', 'same.txt', 'binary.bin', 'single.txt', 'large.txt', 'tail.txt'].map(path => ({ path, status: path === 'single.txt' ? 'R' : 'M', previousPath: path === 'single.txt' ? 'old-single.txt' : undefined })) };
        if (request.method === 'diffPreview') {
          const path = request.payload.path;
          fixture.previews.push(structuredClone(request.payload));
          if (fixture.failPath === path) { setTimeout(() => window.postMessage({ type: 'response', id: request.id, error: { message: 'Read failed' } }, '*'), 10); return; }
          const right = fixture.emptyFiles || path === 'same.txt' ? fixture.left : path === 'tail.txt' ? fixture.left.split('\n').map((line, i) => [30, 95].includes(i) ? `tail changed ${i}` : line).join('\n') : path === 'single.txt' || path === 'large.txt' ? fixture.left.split('\n').map((line, i) => i === 80 || path === 'large.txt' && i > 80 && i <= 125 ? `changed line ${i}` : line).join('\n') : fixture.right;
          result = path === 'binary.bin' ? { kind: 'binary', reason: 'unsupported', path, leftLabel: 'Before', rightLabel: 'After' } : { kind: 'text', path, leftLabel: 'Before', rightLabel: 'After', left: fixture.left, right, truncated: fixture.truncated };
          if (fixture.holdPath === path) { fixture.held.push(() => window.postMessage({ type: 'response', id: request.id, result }, '*')); return; }
        }
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 10);
      } });
    }, diffNavigationScope);
}

async function verifyCommitNavigation(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await addDiffFixture(page);
    await page.goto(url);
    await page.getByRole('option', { name: 'Diff fixture' }).dblclick();
    const diff = page.getByTestId('diff-preview'), count = diff.getByTestId('diff-change-count'), details = page.getByTestId('details');
    const expectCount = async text => { await count.getByText(text, { exact: true }).waitFor(); };
    const step = async (direction, text) => { await diff.getByRole('button', { name: direction === -1 ? 'Previous change' : 'Next change' }).click(); await expectCount(text); };
    const settings = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByTestId('interface-settings').getByRole('button', { name: 'Diff', exact: true }).click();
      return page.getByRole('dialog', { name: 'Settings' });
    };
    await expectCount('File 1/6 · Change 1/3');
    await step(-1, 'File 6/6 · Change 2/2');
    await page.waitForFunction(() => {
      const block = document.querySelector('.active-change-start'), viewport = document.querySelector('.diff-viewport');
      if (!block) return false;
      return block.querySelector('.line-number').textContent === '96' && block.getBoundingClientRect().y >= viewport.getBoundingClientRect().y && block.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom;
    });
    await step(1, 'File 1/6 · Change 1/3');
    await step(1, 'File 1/6 · Change 2/3');
    await step(1, 'File 1/6 · Change 3/3');
    const filter = details.getByLabel('Filter changed file paths');
    await filter.fill('diff');
    await step(1, 'File 4/6 · Change 1/1');
    assert.equal(await filter.inputValue(), 'diff');
    await details.getByText('Current Diff is outside the path filter: single.txt', { exact: true }).waitFor();
    const renamed = await page.evaluate(() => window.__diffFixture.previews.find(target => target.path === 'single.txt'));
    assert.equal(renamed.previousPath, 'old-single.txt');
    assert.equal(renamed.parent, 'b'.repeat(40));
    await filter.fill('');
    assert.ok(await details.locator('.file-item.selected').getByRole('button', { name: 'single.txt', exact: true }).count());
    await step(-1, 'File 1/6 · Change 3/3');
    await step(1, 'File 4/6 · Change 1/1');
    await step(1, 'File 5/6 · Change 1/1');
    await step(1, 'File 6/6 · Change 1/2');
    await step(1, 'File 6/6 · Change 2/2');
    await step(1, 'File 1/6 · Change 1/3');
    await details.getByRole('button', { name: 'binary.bin', exact: true }).click();
    await expectCount('File 3/6 · Change 0/0');
    await step(1, 'File 4/6 · Change 1/1');
    await step(-1, 'File 1/6 · Change 3/3');
    await page.evaluate(() => { window.__diffFixture.failPath = 'same.txt'; });
    await diff.getByRole('button', { name: 'Next change' }).click();
    await diff.getByRole('alert').getByText('same.txt: Read failed', { exact: true }).waitFor();
    assert.equal(await count.innerText(), 'File 1/6 · Change 3/3', 'A failed file read must not skip to a later file');
    await page.evaluate(() => { window.__diffFixture.failPath = null; });
    await step(1, 'File 4/6 · Change 1/1');
    await details.getByRole('button', { name: 'tail.txt', exact: true }).click();
    await expectCount('File 6/6 · Change 1/2');
    await step(1, 'File 6/6 · Change 2/2');
    // A parent switch cancels a pending cross-file read, preserving the new comparison.
    await page.evaluate(() => { window.__diffFixture.holdPath = 'diff.txt'; });
    await diff.getByRole('button', { name: 'Next change' }).click();
    await page.waitForFunction(() => window.__diffFixture.held.length === 1);
    await details.getByLabel('Compare parent').selectOption('c'.repeat(40));
    await expectCount('File 6/6 · Change 1/2');
    await page.evaluate(() => { const fixture = window.__diffFixture; fixture.holdPath = null; fixture.held.splice(0).forEach(reply => reply()); });
    await step(-1, 'File 5/6 · Change 1/1');
    assert.equal(await page.evaluate(() => window.__diffFixture.previews.at(-1).parent), 'c'.repeat(40));
    // Cancelling settings restores the default; applying persists across reload.
    let dialog = await settings();
    await dialog.getByLabel('Diff navigation scope').selectOption('file');
    await expectCount('1/1');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expectCount('File 5/6 · Change 1/1');
    dialog = await settings();
    await dialog.getByLabel('Diff navigation scope').selectOption('file');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.reload();
    await expectCount('1/1');
    await step(1, '1/1');
    assert.ok(await details.locator('.file-item.selected').getByRole('button', { name: 'large.txt', exact: true }).count());
    dialog = await settings();
    assert.equal(await dialog.getByLabel('Diff navigation scope').inputValue(), 'file');
    await dialog.getByLabel('Diff navigation scope').selectOption('commit');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    // Empty previews terminate a full scan and disable both arrows.
    await page.evaluate(() => { window.__diffFixture.emptyFiles = true; });
    await details.getByRole('button', { name: 'same.txt', exact: true }).click();
    await expectCount('File 2/6 · Change 0/0');
    await diff.getByRole('button', { name: 'Next change' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.diff-preview button')].filter(button => ['Previous change', 'Next change'].includes(button.getAttribute('aria-label'))).every(button => button.disabled) && !document.querySelector('.diff-viewport [role="status"]'));
    assert.equal(await count.innerText(), 'File 2/6 · Change 0/0');
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_COMMIT_DIFF_UI_TESTS_PASSED: cross-file wrap, reverse landing, rename/parent, filtering, binary/empty files, read failures, cancellation and saved scope');
  } finally { await page.close(); }
}
