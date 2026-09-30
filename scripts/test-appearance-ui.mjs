import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const sessionKey = 'alwaygit.demo-session';

async function readSession(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), sessionKey);
}

async function requiredBox(locator, label) {
  const box = await locator.boundingBox();
  assert.ok(box, `${label} must have a visible bounding box`);
  return box;
}

function centerY(box) {
  return box.y + box.height / 2;
}

async function assertCentered(locator, expected, label, tolerance = 1.5) {
  const box = await requiredBox(locator, label);
  assert.ok(Math.abs(centerY(box) - expected) <= tolerance, `${label} must align with the graph node center`);
}

async function assertCurrentIndicator(locator, color, label) {
  const shape = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.borderLeftColor, width: style.borderLeftWidth, top: style.borderTopWidth, bottom: style.borderBottomWidth };
  });
  assert.deepEqual(shape, { color, width: '9px', top: '6px', bottom: '6px' }, `${label} uses a large solid high-contrast triangle`);
}

export async function verifyAppearance(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const runtimeErrors = [], consoleErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await mkdir('artifacts', { recursive: true });
  try {
    const legacySession = {
      version: 1,
      language: 'en',
      repoId: 'demo-alwaygit',
      layout: { preset: 'editor', sidebar: 248, details: 330, diff: 250, author: 112, date: 130, font: 13, row: 26 },
      drafts: { 'demo-alwaygit': 'Legacy draft survives migration' },
      views: { 'demo-alwaygit': { search: '', tab: 'history' } },
    };
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
      document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.add('vscode-light');
        document.body.dataset.vscodeThemeKind = 'vscode-light';
        for (const name of ['editor-background', 'sideBar-background', 'foreground', 'descriptionForeground', 'panel-border', 'focusBorder']) {
          document.body.style.setProperty(`--vscode-${name}`, '#777777');
        }
      });
    }, { key: sessionKey, value: legacySession });
    await page.goto(url);

    const workbench = page.getByTestId('workbench'), history = page.getByTestId('history'), details = page.getByTestId('details');
    await Promise.all([workbench.waitFor(), history.locator('[data-oid]').first().waitFor(), details.waitFor()]);
    assert.equal(await workbench.getAttribute('data-theme'), 'light', 'System appearance follows the simulated light VS Code host');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)', 'Workbench light theme overrides gray host surface tokens');
    const currentIndicator = workbench.locator('[data-repository-group][aria-current="true"] .current-indicator-glyph');
    await assertCurrentIndicator(currentIndicator, 'rgb(0, 0, 0)', 'Light theme current marker');
    assert.equal(await page.getByLabel('Layout', { exact: true }).count(), 0, 'Removed Layout control must not remain in the workbench');
    assert.equal(await page.getByLabel('Language').count(), 0, 'Language control belongs only in Interface Settings');
    const top = page.locator('.app-chrome, .branch-bar, .toolbar');
    assert.equal(await top.getByRole('button', { name: /^(Stage|Unstage|Discard)/ }).count(), 0, 'Stage and Discard actions must not return to the top bars');

    const restore = page.getByRole('button', { name: 'Restore Layout', exact: true });
    assert.equal((await restore.innerText()).trim(), '', 'Restore Layout remains an icon-only command');
    assert.equal(await restore.locator('.codicon').count(), 1, 'Restore Layout exposes its icon');
    const separators = {
      sidebar: page.getByRole('separator', { name: 'Resize repository sidebar' }),
      details: page.getByRole('separator', { name: 'Resize details panel' }),
      diff: page.getByRole('separator', { name: 'Resize Diff panel' }),
      graph: page.getByRole('separator', { name: 'Resize graph column' }),
      author: page.getByRole('separator', { name: 'Resize author column' }),
      date: page.getByRole('separator', { name: 'Resize date column' }),
    };
    assert.equal(Number(await separators.sidebar.getAttribute('aria-valuenow')), 248);
    assert.equal(Number(await separators.details.getAttribute('aria-valuenow')), 330);
    assert.equal(Number(await separators.diff.getAttribute('aria-valuenow')), 250);
    assert.equal(Number(await separators.graph.getAttribute('aria-valuenow')), 64);
    assert.equal(Number(await separators.author.getAttribute('aria-valuenow')), 112);
    assert.equal(Number(await separators.date.getAttribute('aria-valuenow')), 130);
    const graphHeaderBox = await requiredBox(history.locator('.history-columns [role="columnheader"]').first(), 'Graph header');
    const graphHandleBox = await requiredBox(separators.graph, 'Graph separator');
    assert.ok(Math.abs(graphHandleBox.x + graphHandleBox.width - graphHeaderBox.x - graphHeaderBox.width) <= 1, 'Graph separator stays on the column right boundary');
    await page.mouse.move(graphHandleBox.x + graphHandleBox.width / 2, graphHandleBox.y + graphHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(graphHandleBox.x + graphHandleBox.width / 2 + 20, graphHandleBox.y + graphHandleBox.height / 2);
    await page.mouse.up();
    assert.equal(Number(await separators.graph.getAttribute('aria-valuenow')), 84, 'Graph widens when its right boundary moves right');
    const movedGraphHandleBox = await requiredBox(separators.graph, 'Moved Graph separator');
    assert.ok(Math.abs(movedGraphHandleBox.x - graphHandleBox.x - 20) <= 1, 'Graph separator follows the pointer direction');
    for (const [key, selector, label] of [['author', '.history-columns [role="columnheader"]:nth-child(3)', 'Author'], ['date', '.history-columns [role="columnheader"]:nth-child(4)', 'Date']]) {
      const cellBox = await requiredBox(history.locator(selector), `${label} header`);
      const handleBox = await requiredBox(separators[key], `${label} separator`);
      assert.ok(Math.abs(handleBox.x - cellBox.x) <= 1, `${label} separator stays on the column's left boundary`);
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2 + 20, handleBox.y + handleBox.height / 2);
      await page.mouse.up();
      assert.equal(Number(await separators[key].getAttribute('aria-valuenow')), key === 'author' ? 92 : 110, `${label} narrows when its left boundary moves right`);
      const movedBox = await requiredBox(separators[key], `${label} moved separator`);
      assert.ok(Math.abs(movedBox.x - handleBox.x - 20) <= 1, `${label} separator follows the pointer direction`);
    }

    await history.locator('[data-working-tree]').click();
    assert.equal(await details.getByRole('textbox', { name: 'Commit message' }).inputValue(), 'Legacy draft survives migration', 'Legacy drafts survive appearance migration');
    await history.locator('.head-row').click();
    const migrated = await readSession(page);
    assert.equal(migrated.layout.preset, 'workbench');
    assert.equal(migrated.layout.row, 24, 'Legacy default row 26 migrates to compact row 24');
    assert.equal(migrated.layout.graph, 84, 'Legacy sessions gain a persisted Graph width after adjustment');
    assert.equal(migrated.layout.sidebar, 248, 'Migration retains custom panel widths');
    assert.equal(migrated.layout.details, 330, 'Migration retains the custom details width');
    assert.equal(migrated.drafts['demo-alwaygit'], 'Legacy draft survives migration');

    const headRow = history.locator('.head-row').first();
    assert.equal(Math.round((await requiredBox(headRow, 'Default commit row')).height), 24, 'Default effective history row is 24px');
    const node = await requiredBox(headRow.locator('.git-graph-node'), 'HEAD graph node'), nodeCenter = centerY(node);
    await assertCentered(headRow.locator('.commit-message-button'), nodeCenter, 'Commit message');
    await assertCentered(headRow.locator('.ref-badge').first(), nodeCenter, 'Reference badge');
    await assertCentered(headRow.locator('.history-author'), nodeCenter, 'Commit author');
    await assertCentered(headRow.locator('.history-date'), nodeCenter, 'Commit date');
    await page.screenshot({ path: 'artifacts/appearance-light.png' });

    const initialLane = await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--graph-lane-0').trim());
    await page.evaluate(() => {
      document.body.classList.remove('vscode-light');
      document.body.classList.add('vscode-high-contrast');
      document.body.dataset.vscodeThemeKind = 'vscode-high-contrast';
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="workbench"]')?.getAttribute('data-theme') === 'hc-dark');
    await page.getByRole('button', { name: 'Interface Settings', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Interface Settings' }), settings = page.getByTestId('interface-settings');
    await settings.getByRole('radio', { name: 'Clear Light', exact: true }).click();
    assert.equal(await workbench.getAttribute('data-theme'), 'light', 'Manual light theme overrides a high-contrast host');
    await settings.getByRole('radio', { name: 'Warm Paper', exact: true }).click();
    assert.equal(await workbench.getAttribute('data-theme'), 'paper', 'Additional themes preview live');
    await settings.getByRole('radio', { name: 'Deep Night', exact: true }).click();
    await settings.getByRole('button', { name: 'Text & density', exact: true }).click();
    await settings.getByLabel('Interface font', { exact: true }).selectOption('15');
    await settings.getByRole('button', { name: 'Colors', exact: true }).click();
    await settings.getByRole('radio', { name: /Distinct/ }).click();
    assert.equal(await workbench.getAttribute('data-theme'), 'dark', 'Theme previews live');
    await assertCurrentIndicator(currentIndicator, 'rgb(255, 255, 255)', 'Dark theme current marker');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--workbench-font').trim()), '15px', 'Interface font previews live');
    assert.notEqual(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--graph-lane-0').trim()), initialLane, 'Graph palette previews live');
    const previewSession = await readSession(page);
    assert.equal(previewSession.appearance.theme, 'system', 'Theme preview is not persisted before Apply');
    assert.equal(previewSession.appearance.palette, 'vivid', 'Palette preview is not persisted before Apply');
    assert.equal(previewSession.layout.font, 13, 'Font preview is not persisted before Apply');
    await page.screenshot({ path: 'artifacts/appearance-settings.png' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await workbench.getAttribute('data-theme'), 'hc-dark', 'Cancel restores the host-resolved high-contrast theme');
    await assertCurrentIndicator(currentIndicator, 'rgb(255, 255, 255)', 'High-contrast dark current marker');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--workbench-font').trim()), '13px', 'Cancel restores interface font');
    await page.evaluate(() => {
      document.body.classList.remove('vscode-high-contrast');
      document.body.classList.add('vscode-light');
      document.body.dataset.vscodeThemeKind = 'vscode-light';
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="workbench"]')?.getAttribute('data-theme') === 'light');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--graph-lane-0').trim()), initialLane, 'Cancel restores graph palette');

    await page.getByRole('button', { name: 'Interface Settings', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Interface Settings' }); settings = page.getByTestId('interface-settings');
    await settings.getByRole('radio', { name: 'Berry Purple', exact: true }).click();
    await settings.getByRole('button', { name: 'Text & density', exact: true }).click();
    await settings.getByLabel('Interface font', { exact: true }).selectOption('16');
    await settings.getByLabel('Diff font', { exact: true }).selectOption('15');
    await settings.getByLabel('List density', { exact: true }).selectOption('22');
    await settings.getByRole('button', { name: 'Status indicators', exact: true }).click();
    await settings.getByRole('radio', { name: '#006BFF', exact: true }).click();
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--notification-badge').trim()), '#006BFF', 'Badge color previews live');
    await settings.getByRole('button', { name: 'Colors', exact: true }).click();
    await settings.getByRole('radio', { name: /Extended/ }).click();
    await settings.getByRole('textbox', { name: 'Path color 1', exact: true }).fill('#0066DD');
    await settings.getByRole('textbox', { name: 'Path color 1', exact: true }).press('Enter');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    let applied = await readSession(page);
    assert.equal(applied.appearance.theme, 'berry');
    assert.equal(applied.appearance.badgeColor, '#006BFF');
    assert.equal(applied.appearance.palette, 'extended');
    assert.equal(applied.appearance.codeFont, 15);
    assert.equal(applied.appearance.colors.light[0], '#0066DD');
    assert.equal(applied.appearance.colors.light.length, 16);
    assert.equal(applied.appearance.colors.dark.length, 16);
    assert.equal(applied.layout.font, 16);
    assert.equal(applied.layout.row, 22);
    await page.screenshot({ path: 'artifacts/appearance-dark.png' });

    await page.reload();
    await Promise.all([workbench.waitFor(), history.locator('[data-oid]').first().waitFor()]);
    assert.equal(await workbench.getAttribute('data-theme'), 'berry', 'Applied theme survives reload despite the light host');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(39, 23, 47)', 'Explicit berry theme overrides gray VS Code tokens');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--notification-badge').trim()), '#006BFF', 'Applied badge color survives reload');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--graph-lane-0').trim()), '#4DA3FF', 'The paired dark color survives reload alongside the edited light color');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--workbench-font').trim()), '16px');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--row-height').trim()), '28px', '16px interface font raises effective row height to 28px');
    assert.equal(await details.getByRole('textbox', { name: 'Commit message' }).count(), 0, 'Reload restores the saved history view');

    await restore.click();
    assert.equal(Number(await separators.sidebar.getAttribute('aria-valuenow')), 210);
    assert.equal(Number(await separators.details.getAttribute('aria-valuenow')), 300);
    assert.equal(Number(await separators.diff.getAttribute('aria-valuenow')), 220);
    assert.equal(Number(await separators.graph.getAttribute('aria-valuenow')), 64);
    assert.equal(await workbench.getAttribute('data-theme'), 'berry', 'Restore Layout does not reset theme');
    assert.equal(await workbench.evaluate(element => getComputedStyle(element).getPropertyValue('--workbench-font').trim()), '16px', 'Restore Layout does not reset interface font');
    applied = await readSession(page);
    assert.equal(applied.appearance.theme, 'berry');
    assert.equal(applied.layout.font, 16);

    const largeRow = history.locator('[data-oid]').first(), largeRowBox = await requiredBox(largeRow, '16px commit row');
    assert.equal(Math.round(largeRowBox.height), 28);
    for (const [selector, label] of [['.commit-subject', 'Commit subject'], ['.history-author', 'Author'], ['.history-date', 'Date']]) {
      const box = await requiredBox(largeRow.locator(selector), label);
      assert.ok(box.y >= largeRowBox.y - .5 && box.y + box.height <= largeRowBox.y + largeRowBox.height + .5, `${label} must not overlap a 28px row`);
    }

    await history.locator('[data-working-tree]').click();
    await separators.details.focus();
    await separators.details.press('Home');
    assert.equal(Number(await separators.details.getAttribute('aria-valuenow')), 230);
    const detailsBox = await requiredBox(details, 'Narrow details panel');
    assert.ok(Math.abs(detailsBox.width - 230) <= 1, 'Details panel honors its 230px minimum');
    const unstaged = details.locator('.change-heading-unstaged'), staged = details.locator('.change-heading-staged');
    await unstaged.getByRole('button', { name: 'Stage All', exact: true }).waitFor();
    await staged.getByRole('button', { name: 'Unstage All', exact: true }).waitFor();
    const discard = unstaged.getByRole('button', { name: 'Discard selected files…', exact: true });
    assert.equal((await discard.innerText()).trim(), '', 'Discard remains icon-only');
    assert.equal(await discard.locator('.codicon').count(), 1);
    for (const [heading, label] of [[unstaged, 'Unstaged'], [staged, 'Staged']]) {
      const headingBox = await requiredBox(heading, `${label} heading`);
      for (const button of await heading.getByRole('button').all()) {
        const buttonBox = await requiredBox(button, `${label} action`);
        assert.ok(buttonBox.x >= headingBox.x - .5 && buttonBox.x + buttonBox.width <= headingBox.x + headingBox.width + .5, `${label} actions must not overflow a 230px panel`);
      }
    }

    assert.deepEqual(runtimeErrors, [], 'Appearance flow must not throw page errors');
    assert.deepEqual(consoleErrors, [], 'Appearance flow must not log console errors');
    console.log('ALWAYGIT_APPEARANCE_UI_TESTS_PASSED: migration, compact alignment, preview/cancel/apply persistence, theme gallery, badge colors, adaptive font rows and 230px details actions');
  } catch (error) {
    await page.screenshot({ path: 'artifacts/appearance-failure.png' }).catch(() => {});
    throw error;
  } finally {
    await page.close();
  }
}
