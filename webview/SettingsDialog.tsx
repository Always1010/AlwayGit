import { ShortcutSettings } from './ShortcutSettings';
import { BranchIcon, Button, Icon, Modal } from './ui';

import { RepositoryIcon } from './RepositoryIcon';
import { uiText } from './text';
import { useEffect, useState } from 'react';
import { useWorkbench } from './store';
import { rpc } from './rpc';
import type { OperationSettings } from '../src/protocol/types';
import { useTranslation } from './i18n';
import type { Language, StaticMessageKey } from './i18n';
import type { DiffNavigationScope } from '../src/protocol/session';
import { defaultBadgeColor, defaultCurrentBranchColor, defaultCurrentRepositoryColor, diffRowHeight, effectiveRowHeight, fileRowHeight, isLightTheme, presetColors, textColorForBackground, type ResolvedTheme, type ThemePreference } from './appearance';
import { graphPalettes, type GraphPaletteId } from './graph/palettes';



type SettingsPage = 'files' | 'language' | 'keyboard' | 'theme' | 'density' | 'diff' | 'status' | 'colors' | 'advanced';
type ColorTheme = 'light' | 'dark';
const defaultMainColors = { light: '#283447', dark: '#EDF3FF' } as const;
const themes: { id: ThemePreference; labelKey: StaticMessageKey; colors: readonly [string, string, string] }[] = [
  { id: 'system', labelKey: "settings.followVSCode", colors: ['#F4F6FA', '#2463C5', '#1B222D'] },
  { id: 'light', labelKey: "settings.clearLight", colors: ['#FFFFFF', '#2463C5', '#DBEAFE'] },
  { id: 'paper', labelKey: "settings.warmPaper", colors: ['#FFF9ED', '#B45309', '#F5E6C8'] },
  { id: 'mist', labelKey: "settings.mistBlue", colors: ['#F3F8FC', '#176B87', '#D7EAF3'] },
  { id: 'dark', labelKey: "settings.deepNight", colors: ['#1B222D', '#83B8FF', '#244E78'] },
  { id: 'midnight', labelKey: "settings.midnightBlue", colors: ['#0D1B2A', '#4CC9F0', '#173B57'] },
  { id: 'graphite', labelKey: "settings.graphite", colors: ['#202124', '#E8A838', '#3A3B40'] },
  { id: 'forest', labelKey: "settings.forest", colors: ['#14251E', '#65D48B', '#244B38'] },
  { id: 'berry', labelKey: "settings.berryPurple", colors: ['#27172F', '#E879F9', '#57306B'] },
  { id: 'contrast', labelKey: "settings.highContrast", colors: ['#0C1016', '#FFE875', '#153F6B'] },
];
const badgeColors = ['#D61F3C', '#FF5A00', '#006BFF', '#B900E6', '#008F5D', '#FFD400'] as const;

function DiffHeightField({ value, onChange }: { value: number; onChange(value: number): void }) {
  const t = useTranslation(), presets = [18, 20, 22, 24];
  const [custom, setCustom] = useState(!presets.includes(value)), [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = draft.trim() ? Math.round(Math.max(16, Math.min(36, Number(draft)))) : value;
    const valid = Number.isFinite(next) ? next : value;
    setDraft(String(valid)); onChange(valid);
  };
  return <label>{t("settings.lineHeight")}<select aria-label={t("settings.diffLineHeight")} value={custom ? 'custom' : value} onChange={event => {
    const isCustom = event.target.value === 'custom'; setCustom(isCustom);
    if (!isCustom) onChange(Number(event.target.value));
  }}>{presets.map(size => <option key={size} value={size}>{size}px{size === 18 ? t("settings.default") : ''}</option>)}<option value="custom">{t("settings.custom")}</option></select>
    {custom && <input type="number" aria-label={t("settings.customDiffLineHeight")} min={16} max={36} step={1} value={draft} onChange={event => {
      setDraft(event.target.value);
      const next = Number(event.target.value);
      if (event.target.value && Number.isInteger(next) && next >= 16 && next <= 36) onChange(next);
    }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>}</label>;
}

function FileSpacingField({ value, onChange }: { value: number; onChange(value: number): void }) {
  const t = useTranslation(), presets = [0, 1, 3, 5];
  const [custom, setCustom] = useState(!presets.includes(value)), [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = draft.trim() ? Math.round(Math.max(0, Math.min(8, Number(draft)))) : value;
    const valid = Number.isFinite(next) ? next : value;
    setDraft(String(valid)); onChange(valid);
  };
  const names = [t("settings.dense"), t("settings.compactDefault"), t("settings.balanced"), t("settings.comfortable")];
  return <label className="settings-full-width">{t("settings.fileListSpacing")}<select aria-label={t("settings.fileListSpacing")} value={custom ? 'custom' : value} onChange={event => {
    const isCustom = event.target.value === 'custom'; setCustom(isCustom);
    if (!isCustom) onChange(Number(event.target.value));
  }}>{presets.map((size, i) => <option key={size} value={size}>{names[i]} · {size}px</option>)}<option value="custom">{t("settings.custom")}</option></select>
    {custom && <input type="number" aria-label={t("settings.customFileListSpacing")} min={0} max={8} step={1} value={draft} onChange={event => {
      setDraft(event.target.value);
      const next = Number(event.target.value);
      if (event.target.value && Number.isInteger(next) && next >= 0 && next <= 8) onChange(next);
    }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>}</label>;
}

function ColorField({ value, label, removable, onChange, onRemove }: { value: string; label: string; removable?: boolean; onChange(value: string): void; onRemove?(): void }) {
  const t = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (/^#[0-9a-f]{6}$/i.test(draft)) onChange(draft.toUpperCase());
    else setDraft(value);
  };
  return <div className="color-field">
    <input type="color" aria-label={uiText("settings.picker", { label: (label) })} value={value} onChange={event => onChange(event.target.value.toUpperCase())}/>
    <input className="color-hex" aria-label={label} value={draft} maxLength={7} spellCheck={false} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
    {removable && <Button className="icon-only color-remove" icon="trash" title={t("settings.removeColor")} aria-label={`${t("settings.remove")} ${label}`} onClick={onRemove}/>}
  </div>;
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

function GraphPreview({ colors, main, mode }: { colors: readonly string[]; main: string; mode: ColorTheme }) {
  const t = useTranslation();
  const color = (index: number) => colors[index % colors.length];
  const rows = [18, 42, 66, 90, 114];
  return <div className="graph-color-preview" data-preview-theme={mode}>
    <svg viewBox="0 0 520 132" role="img" aria-label={t("settings.previewOfConcurrentBranchingAndMergingCommitPaths")}>
      <path d="M32 8V124" stroke={main}/>
      <path d="M32 18C32 30 76 30 76 42V90C76 102 32 102 32 114" stroke={color(0)}/>
      <path d="M32 42C32 52 120 54 120 66V90" stroke={color(1)}/>
      <path d="M76 42C76 53 164 54 164 66V114" stroke={color(2)}/>
      <path d="M120 66C120 78 208 78 208 90V114" stroke={color(3)}/>
      <path d="M164 66C164 77 252 79 252 90V114" stroke={color(4)}/>
      <path d="M208 90C208 102 296 102 296 114" stroke={color(5)}/>
      {rows.map((y, index) => <circle key={y} cx={32} cy={y} r={index === 0 ? 5 : 4} fill={main}/>)}
      {[[76,42,0],[120,66,1],[164,66,2],[208,90,3],[252,90,4],[296,114,5]].map(([x,y,index]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill={color(index)}/>)}
      <text x="326" y="24">{uiText("settings.hEADMain")}</text><text x="326" y="48">{uiText("settings.featureSearch")}</text><text x="326" y="72">{uiText("settings.fixSidebar")}</text><text x="326" y="96">{uiText("settings.releaseNext")}</text><text x="326" y="120">{uiText("settings.mergedPaths")}</text>
    </svg>
  </div>;
}

export function SettingsDialog({ theme }: { theme: ResolvedTheme }) {
  const state = useWorkbench(), t = useTranslation(), { appearance, layout } = state;
  const [page, setPage] = useState<SettingsPage>('theme');
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(isLightTheme(theme) ? 'light' : 'dark');
  const [allowDetachedHead, setAllowDetachedHead] = useState(state.operationSettings.allowDetachedHead),[pushFollowTags,setPushFollowTags]=useState(state.operationSettings.pushFollowTags),[pushTagAfterCreate,setPushTagAfterCreate]=useState(state.operationSettings.pushTagAfterCreate),[defaultResetMode,setDefaultResetMode]=useState(state.operationSettings.defaultResetMode), [advancedDirty, setAdvancedDirty] = useState(false), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState<string>();
  const [operationScope, setOperationScope] = useState<OperationSettings['scope']>('user');
  const [scopeSettings, setScopeSettings] = useState<OperationSettings>(), [scopeLoading, setScopeLoading] = useState(true);
  useEffect(() => {
    if (advancedDirty) return;
    let cancelled = false; setScopeLoading(true); setScopeSettings(undefined); setSaveError(undefined);
    void rpc<OperationSettings>('operationSettings', undefined, { scope: operationScope }).then(settings => {
      if (cancelled) return;
      setScopeSettings(settings); setAllowDetachedHead(settings.allowDetachedHead); setPushFollowTags(settings.pushFollowTags);
      setPushTagAfterCreate(settings.pushTagAfterCreate); setDefaultResetMode(settings.defaultResetMode); setSaveError(undefined);
    }).catch(error => { if (!cancelled) setSaveError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setScopeLoading(false); });
    return () => { cancelled = true; };
  }, [operationScope, advancedDirty, state.operationSettings]);
  const close = () => { if (!saving) state.finishSettings(false); };
  const apply = async () => {
    if (recordingShortcut) return;
    setSaving(true); setSaveError(undefined);
    try { if (advancedDirty) await state.saveOperationSettings({allowDetachedHead,pushFollowTags,pushTagAfterCreate,defaultResetMode}, operationScope); await state.finishSettings(true); }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const densityOptions = [22, 24, 28];
  if (!densityOptions.includes(layout.row)) densityOptions.push(layout.row);
  const updateAppearance = (next: typeof appearance) => state.previewSettings({ appearance: next });
  const choosePreset = (palette: GraphPaletteId) => updateAppearance({ ...appearance, palette, colors: presetColors(palette) });
  const setColor = (index: number, value: string) => updateAppearance({ ...appearance, colors: { ...appearance.colors, [colorTheme]: appearance.colors[colorTheme].map((color, position) => position === index ? value : color) } });
  const removeColor = (index: number) => updateAppearance({ ...appearance, colors: { light: appearance.colors.light.filter((_, position) => position !== index), dark: appearance.colors.dark.filter((_, position) => position !== index) } });
  const addColor = () => {
    const expanded = graphPalettes.find(palette => palette.id === 'extended')!;
    const candidate = expanded.light.findIndex((light, index) => !appearance.colors.light.some((color, position) => color === light && appearance.colors.dark[position] === expanded.dark[index]));
    const index = candidate < 0 ? appearance.colors.light.length % expanded.light.length : candidate;
    updateAppearance({ ...appearance, colors: { light: [...appearance.colors.light, expanded.light[index]], dark: [...appearance.colors.dark, expanded.dark[index]] } });
  };
  const presetBase = presetColors(appearance.palette);
  const customized = appearance.colors.light.some((color, index) => color !== presetBase.light[index]) || appearance.colors.dark.some((color, index) => color !== presetBase.dark[index]) || appearance.colors.light.length !== presetBase.light.length;
  const pageLabel = page === 'files' ? t('changes.fileList') : page === 'advanced' ? t("settings.gitOperations") : page === 'keyboard' ? t("settings.keyboardShortcuts") : page === 'language' ? t("common.language") : page === 'theme' ? t("settings.theme") : page === 'density' ? t("settings.textDensity") : page === 'diff' ? uiText("settings.diff") : page === 'status' ? t("settings.statusIndicators") : t("settings.graphColors");
  const navItem = (id: SettingsPage, icon: string, label: string) => <button type="button" className={`settings-nav-item ${page === id ? 'is-active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon name={icon}/><span>{label}</span></button>;

  return <Modal title={t("common.settings")} busy={saving} onClose={close} footer={
    <><span className="settings-save-hint"><Icon name="check"/>{page === 'advanced' ? operationScope === 'user' ? t("settings.gitOptionsAreSavedInUserSettings") : t("settings.appliesToThisWorkspace") : t('settings.sharedUserPreferences')}</span><Button className="settings-cancel" disabled={saving} onClick={close}>{t("common.cancel")}</Button><Button className="primary" disabled={saving || recordingShortcut || advancedDirty && scopeLoading} onClick={()=>void apply()}>{saving?t("settings.saving"):t("common.apply")}</Button></>
  }>
    <div className="interface-settings" data-testid="interface-settings">
      <nav className="settings-nav" aria-label={t("settings.settingsCategories")}>
        <div className="settings-nav-group"><strong>{t("settings.general")}</strong>{navItem('language', 'globe', t("common.language"))}{navItem('keyboard', 'keyboard', t("settings.keyboardShortcuts"))}</div>
        <div className="settings-nav-group"><strong>{t("settings.interface")}</strong>{navItem('theme', 'color-mode', t("settings.theme"))}{navItem('density', 'text-size', t("settings.textDensity"))}{navItem('files', 'list-tree', t('changes.fileList'))}{navItem('diff', 'diff', t("settings.diff"))}{navItem('status', 'bell-dot', t("settings.statusIndicators"))}</div>
        <div className="settings-nav-group"><strong>{t("settings.commitGraph")}</strong>{navItem('colors', 'git-merge', t("settings.colors"))}</div>
        <div className="settings-nav-group"><strong>{t("settings.advanced")}</strong>{navItem('advanced', 'tools', t("settings.gitOperations"))}</div>
      </nav>
      <main className="settings-content">
        <header className="settings-page-heading"><span>{page === 'advanced' ? t("settings.advanced") : page === 'language' || page === 'keyboard' ? t("settings.general") : page === 'colors' ? t("settings.commitGraph") : t("settings.interface")} › {pageLabel}</span><small>{page === 'advanced' ? t("settings.gitOptionsTakeEffectOnlyAfterApply") : page === 'keyboard' ? t('settings.shortcutApplyHint') : t("settings.changesPreviewImmediatelyApplyToSave")}</small></header>

        {saveError&&<p role="alert" className="form-error">{saveError}</p>}
        {page === 'files' && <section className="settings-page" aria-label={t('changes.fileList')}>
          <section className="settings-section" aria-labelledby="file-list-display-heading">
            <h3 id="file-list-display-heading">{t('changes.displayMode')}</h3>
            {(['split','unified'] as const).map(mode => <label key={mode} className="change-list-mode-option"><input type="radio" name="change-list-mode" checked={state.changeListMode === mode} onChange={() => state.previewSettings({changeListMode:mode})}/><span><strong>{t(mode === 'split' ? 'changes.split' : 'changes.unified')}</strong><small>{t(mode === 'split' ? 'changes.splitDescription' : 'changes.unifiedDescription')}</small></span></label>)}
          </section>
          <section className="settings-section" aria-labelledby="file-list-spacing-heading">
            <h3 id="file-list-spacing-heading">{t('settings.fileListSpacing')}</h3>
            <div className="settings-grid"><FileSpacingField value={appearance.fileSpacing} onChange={fileSpacing => updateAppearance({ ...appearance, fileSpacing })}/></div>
            <figure className="settings-preview">
              <figcaption>{t("settings.preview")}</figcaption>
              <div className="file-item settings-file-preview"><span className="file-status status-M" title={t("settings.modified")} role="img" aria-label={t("settings.modified")}><Icon name="file-code"/><span className="file-status-badge" aria-hidden="true">{uiText("settings.m")}</span></span><span className="file-label"><span className="file-basename">{uiText("settings.appTsx")}</span><span className="file-parent-path">{uiText("settings.webview")}</span></span><span className="muted">{fileRowHeight(layout.font, appearance.fileSpacing)}{uiText("settings.px")}</span></div>
            </figure>
            <p className="settings-note">{t("settings.fileSpacingSetsThePaddingAboveAndBelowEach")}</p>
            <p className="settings-note">{t("settings.rowHeightGrowsWithLargerTextToKeepEvery")}</p>
          </section>
        </section>}
        {page === 'keyboard' && <ShortcutSettings onRecordingChange={setRecordingShortcut}/>}
        {page === 'diff' && <section className="settings-page settings-diff-page" aria-label={uiText("settings.diff")}>
          <section className="settings-section" aria-labelledby="diff-display-heading">
            <h3 id="diff-display-heading">{t("settings.display")}</h3>
            <div className="settings-grid">
              <label>{t("settings.fontSize")}<select aria-label={t("settings.diffFont")} value={appearance.codeFont} onChange={event => updateAppearance({ ...appearance, codeFont: Number(event.target.value) })}>{[11,12,13,14,15,16,17,18].map(size => <option key={size} value={size}>{size}px{size === 12 ? t("settings.default") : ''}</option>)}</select></label>
              <DiffHeightField value={appearance.codeRowHeight} onChange={codeRowHeight => updateAppearance({ ...appearance, codeRowHeight })}/>
            </div>
            <figure className="settings-preview">
              <figcaption><span>{t("settings.preview")}</span><span>{t("settings.renderedLineHeight")} · {diffRowHeight(appearance.codeFont, appearance.codeRowHeight)}{uiText("settings.px")}</span></figcaption>
              <div className="diff-content settings-diff-preview" role="region" aria-label={t("settings.diffTextPreview")}>
                <div className="settings-diff-preview-line"><span className="line-number">12</span><span className="diff-marker"> </span><code>{uiText("settings.constTitleAlwayGit")}</code></div>
                <div className="settings-diff-preview-line removed"><span className="line-number">13</span><span className="diff-marker">−</span><code>{uiText("settings.constCount1")}</code></div>
                <div className="settings-diff-preview-line added"><span className="line-number">13</span><span className="diff-marker">+</span><code>{uiText("settings.constCount2")}</code></div>
              </div>
            </figure>
          </section>
          <section className="settings-section" aria-labelledby="diff-navigation-heading">
            <h3 id="diff-navigation-heading">{t("settings.navigation")}</h3>
            <label className="settings-control">{t("settings.navigationScope")}<select aria-label={t("settings.diffNavigationScope")} value={state.diffNavigationScope} onChange={event=>state.previewSettings({ diffNavigationScope: event.target.value as DiffNavigationScope })}><option value="commit">{t("settings.entireCommitDefault")}</option><option value="file">{t("settings.currentFile")}</option></select></label>
            <p className="settings-note">{state.diffNavigationScope === 'commit' ? t("settings.navigateChangesAcrossAllFilesInTheCommitWrapping") : t("settings.navigateChangesWithinTheCurrentFileWrappingAtEither")}</p>
            <details className="settings-rules">
              <summary>{t("settings.detailedRules")}</summary>
              <p className="settings-note">{t("settings.entireCommitFollowsTheChangedFileOrderNextMoves")}</p>
              <p className="settings-note">{t("settings.navigatesAllFilesInTheCurrentCommitAndSelected")}</p>
            </details>
          </section>
        </section>}
        {page === 'advanced' && <section className="settings-page" aria-labelledby="advanced-heading">
          <h3 id="advanced-heading">{t("settings.gitOperations")}</h3>
          <label className="settings-control">{t('settings.saveScope')}<select aria-label={t('settings.saveScope')} value={operationScope} disabled={saving || advancedDirty} onChange={event => { setOperationScope(event.target.value as OperationSettings['scope']); setAdvancedDirty(false); }}><option value="user">{t('settings.userScope')}</option><option value="workspace" disabled={!scopeSettings?.workspaceAvailable}>{t('settings.workspaceScope')}</option></select></label>
          <p className="settings-note">{operationScope === 'user' ? scopeSettings?.overridden ? t('settings.workspaceOverrideActive') : t('settings.userScopeDescription') : t('settings.workspaceScopeDescription')}</p>
          <label className="form-checkbox"><input type="checkbox" aria-label={t("settings.allowDirectDetachedHEADCheckout")} checked={allowDetachedHead} disabled={saving || scopeLoading || !scopeSettings} onChange={event=>{setAdvancedDirty(true);setAllowDetachedHead(event.target.checked);}}/>{t("settings.allowDirectDetachedHEADCheckout")}</label>
          <p className="settings-page-copy">{t("settings.disabledByDefaultCreateAndSwitchToALocal")}</p>
          <p className="settings-note">{t("settings.thisAlsoControlsDetachedWorktreesInternalRebaseStepsAnd")}</p>
          <label className="form-checkbox"><input type="checkbox" aria-label={t("settings.pushRelatedAnnotatedTagsByDefault")} checked={pushFollowTags} disabled={saving || scopeLoading || !scopeSettings} onChange={event=>{setAdvancedDirty(true);setPushFollowTags(event.target.checked);}}/>{t("settings.pushRelatedAnnotatedTagsByDefault")}</label>
          <p className="settings-page-copy">{t("settings.branchPushUsesFollowTagsWhenEnabled")}</p>
          <label className="form-checkbox"><input type="checkbox" aria-label={t("settings.pushNewTagsAfterCreationByDefault")} checked={pushTagAfterCreate} disabled={saving || scopeLoading || !scopeSettings} onChange={event=>{setAdvancedDirty(true);setPushTagAfterCreate(event.target.checked);}}/>{t("settings.pushNewTagsAfterCreationByDefault")}</label>
          <p className="settings-page-copy">{t("settings.tagCreationOffersTheSelectedRemoteAndKeepsThe")}</p>
          <label className="settings-control">{t("settings.defaultResetMode")}<select aria-label={t("settings.defaultResetMode")} value={defaultResetMode} disabled={saving || scopeLoading || !scopeSettings} onChange={event=>{setAdvancedDirty(true);setDefaultResetMode(event.target.value as typeof defaultResetMode);}}><option value="soft">{uiText("actions.soft")}</option><option value="mixed">{uiText("actions.mixed")}</option><option value="hard">{uiText("actions.hard")}</option></select></label>
          <p className="settings-page-copy">{t("settings.resetDialogStartsWithThisModeHardStillRequires")}</p>
        </section>}
        {page === 'language' && <section className="settings-page" aria-labelledby="language-heading">
          <h3 id="language-heading">{t("common.language")}</h3>
          <p className="settings-page-copy">{t("settings.chooseTheLanguageUsedThroughoutTheWorkbench")}</p>
          <label className="settings-control">{t("settings.displayLanguage")}<select aria-label={uiText("common.languageVariant2")} value={state.language} onChange={event => state.previewSettings({ language: event.target.value as Language })}><option value="en">{uiText("settings.english")}</option><option value="zh-CN">{uiText("settings.text")}</option></select></label>
        </section>}

        {page === 'theme' && <section className="settings-page" aria-labelledby="theme-heading">
          <h3 id="theme-heading">{t("settings.theme")}</h3>
          <p className="settings-page-copy">{t("settings.useTheVSCodeThemeOrChooseAFixed")}</p>
          <div className="theme-gallery" role="radiogroup" aria-label={t("settings.colorTheme")}>
            {themes.map(item => <button key={item.id} type="button" role="radio" aria-checked={appearance.theme === item.id} className={`theme-card ${appearance.theme === item.id ? 'is-chosen' : ''}`} onClick={() => updateAppearance({ ...appearance, theme: item.id })}>
              <span className="theme-preview" style={{ '--theme-preview-bg': item.colors[0], '--theme-preview-accent': item.colors[1], '--theme-preview-selected': item.colors[2] } as React.CSSProperties}><i/><i/><i/></span>
              <span>{t(item.labelKey)}</span>
            </button>)}
          </div>
        </section>}

        {page === 'density' && <section className="settings-page" aria-label={t("settings.textDensity")}>
          <div className="settings-grid">
            <label>{t("settings.interfaceFont")}<select aria-label={t("settings.interfaceFont")} value={layout.font} onChange={event => state.previewSettings({ font: Number(event.target.value) })}>{[12,13,14,15,16].map(size => <option key={size} value={size}>{size}px{size === 13 ? t("settings.default") : ''}</option>)}</select></label>
            <label>{t("settings.commitListDensity")}<select aria-label={t("settings.commitListDensity")} value={layout.row} onChange={event => state.previewSettings({ row: Number(event.target.value) })}>{densityOptions.map(size => <option key={size} value={size}>{size === 22 ? t("settings.dense") : size === 24 ? t("settings.compactDefault") : size === 28 ? t("settings.comfortableVariant2") : t("settings.custom")} · {size}px</option>)}</select></label>
          </div>
          <figure className="settings-preview">
            <figcaption>{t("settings.preview")}</figcaption>
            <div className="settings-row-preview" style={{ minHeight: effectiveRowHeight(layout) }}><Icon name="git-commit"/><span className="ref-badge local" aria-current="true">{uiText("settings.main")}</span><span className="truncate">{uiText("settings.feat")}{t("settings.refineTheWorkbench")}</span><span className="muted">{effectiveRowHeight(layout)}{uiText("settings.px")}</span></div>
          </figure>
        </section>}

        {page === 'status' && <section className="settings-page" aria-labelledby="status-heading">
          <div className="settings-title-row"><div><h3 id="status-heading">{t("settings.statusIndicators")}</h3><p className="settings-page-copy">{t("settings.setSeparateColorsForCommitCountsTheCurrentBranch")}</p></div><Button className="icon-only" icon="discard" title={t("settings.restoreDefault")} aria-label={t("settings.restoreDefaultBadgeColor")} onClick={() => updateAppearance({ ...appearance, badgeColor: defaultBadgeColor })}/></div>
          <div className="badge-preview-row"><span>{t("settings.preview")}</span><span className="notification-badge settings-badge-preview" style={{ background: appearance.badgeColor, color: textColorForBackground(appearance.badgeColor) }}>24</span><span className="notification-badge settings-badge-preview" style={{ background: appearance.badgeColor, color: textColorForBackground(appearance.badgeColor) }}>69</span></div>
          <div className="badge-presets" role="radiogroup" aria-label={t("settings.badgeColorPresets")}>
            {badgeColors.map(color => <button key={color} type="button" role="radio" aria-checked={appearance.badgeColor === color} aria-label={color} className={appearance.badgeColor === color ? 'is-chosen' : ''} style={{ background: color }} onClick={() => updateAppearance({ ...appearance, badgeColor: color })}/>)}
          </div>
          <label className="status-color-field"><span>{t("settings.customColor")}</span><ColorField value={appearance.badgeColor} label={t("settings.notificationBadgeColor")} onChange={value => updateAppearance({ ...appearance, badgeColor: value })}/></label>
          <p className="settings-note">{t("settings.textSwitchesBetweenBlackAndWhiteAutomaticallyForContrast")}</p>
          <div className="current-color-setting">
            <div className="current-color-label"><strong>{t("settings.currentBranchMarker")}</strong><small>{t("settings.circleBehindTheCurrentBranchIcon")}</small></div>
            <span className="ref-item settings-current-preview" aria-current="true" style={{'--current-branch-color':appearance.currentBranchColor,'--current-branch-fg':textColorForBackground(appearance.currentBranchColor)} as React.CSSProperties}><BranchIcon/></span>
            <ColorField value={appearance.currentBranchColor} label={t("settings.currentBranchMarkerColor")} onChange={currentBranchColor=>updateAppearance({...appearance,currentBranchColor})}/>
            <Button className="icon-only" icon="discard" title={t("settings.restoreDefaultBlue")} aria-label={t("settings.restoreCurrentBranchMarkerColor")} onClick={()=>updateAppearance({...appearance,currentBranchColor:defaultCurrentBranchColor})}/>
          </div>
          <div className="current-color-setting">
            <div className="current-color-label"><strong>{t("settings.currentRepositoryIcon")}</strong><small>{t("settings.filledBoxWithACheckInTheRepositoryList")}</small></div>
            <span className="repository-item settings-current-preview" aria-current="true" style={{'--current-repository-color':appearance.currentRepositoryColor} as React.CSSProperties}><RepositoryIcon current/></span>
            <ColorField value={appearance.currentRepositoryColor} label={t("settings.currentRepositoryIconColor")} onChange={currentRepositoryColor=>updateAppearance({...appearance,currentRepositoryColor})}/>
            <Button className="icon-only" icon="discard" title={t("settings.restoreDefaultBlue")} aria-label={t("settings.restoreCurrentRepositoryIconColor")} onClick={()=>updateAppearance({...appearance,currentRepositoryColor:defaultCurrentRepositoryColor})}/>
          </div>
        </section>}

        {page === 'colors' && <section className="settings-page graph-colors-page" aria-labelledby="colors-heading">
          <div className="settings-title-row"><div><h3 id="colors-heading">{t("settings.graphColors")}</h3><p className="settings-page-copy">{t("settings.startFromAPresetThenTuneEveryColorFor")}</p></div><Button className="icon-only" icon="discard" title={t("settings.restorePreset")} aria-label={t("settings.restorePreset")} onClick={() => choosePreset(appearance.palette)}/></div>
          <div className="palette-presets" role="radiogroup" aria-label={t("settings.colorPreset")}>
            {graphPalettes.map(item => <button key={item.id} type="button" role="radio" aria-checked={appearance.palette === item.id} className={`palette-preset ${appearance.palette === item.id ? 'is-chosen' : ''}`} onClick={() => choosePreset(item.id)}><span>{t(item.labelKey)}</span><span className="palette-strip">{item[colorTheme].slice(0, 8).map(color => <i key={color} style={{ background: color }}/>)}</span></button>)}
          </div>
          <div className="color-mode-row"><div className="settings-tabs" role="tablist" aria-label={t("settings.previewTheme")}><button type="button" role="tab" aria-selected={colorTheme === 'light'} className={colorTheme === 'light' ? 'is-active' : ''} onClick={() => setColorTheme('light')}>{t("settings.light")}</button><button type="button" role="tab" aria-selected={colorTheme === 'dark'} className={colorTheme === 'dark' ? 'is-active' : ''} onClick={() => setColorTheme('dark')}>{t("settings.dark")}</button></div><span className="palette-status">{appearance.colors.light.length} {t("settings.colorsVariant2")}{customized ? t("settings.customized") : ''}</span></div>
          <GraphPreview colors={appearance.colors[colorTheme]} main={appearance.mainColors[colorTheme]} mode={colorTheme}/>
          <div className="color-editor-heading"><strong>{t("settings.pathColors")}</strong><Button className="icon-only" icon="add" title={t("settings.addColor")} aria-label={t("settings.addColor")} disabled={appearance.colors.light.length >= 16} onClick={addColor}/></div>
          <div className="color-editor-grid">{appearance.colors[colorTheme].map((color, index) => <div className="color-editor-item" key={`${colorTheme}-${index}`}><span className={`contrast-dot ${contrastRatio(color, colorTheme === 'light' ? '#FFFFFF' : '#1B222D') >= 3 ? 'is-good' : 'is-low'}`} title={t("settings.backgroundContrastIndicator")}/><ColorField value={color} label={`${t("settings.pathColor")} ${index + 1}`} removable={appearance.colors.light.length > 4} onChange={value => setColor(index, value)} onRemove={() => removeColor(index)}/></div>)}</div>
          <div className="main-color-row"><div><strong>{t("settings.mainLine")}</strong><small>{t("settings.keptSeparateFromBranchColors")}</small></div><ColorField value={appearance.mainColors[colorTheme]} label={t("settings.mainLineColor")} onChange={value => updateAppearance({ ...appearance, mainColors: { ...appearance.mainColors, [colorTheme]: value } })}/><Button className="icon-only" icon="discard" title={t("settings.restoreMainLineColor")} aria-label={t("settings.restoreMainLineColor")} onClick={() => updateAppearance({ ...appearance, mainColors: { ...appearance.mainColors, [colorTheme]: defaultMainColors[colorTheme] } })}/></div>
          <p className="settings-note"><span className="contrast-dot is-good"/> {t("settings.atLeast31AgainstThePreviewBackground")} <span className="contrast-dot is-low"/> {t("settings.lowContrastConsiderAStrongerColor")}. {t("settings.newPathsPreferUnusedColorsThatDifferFromNearby")}</p>
        </section>}
      </main>
    </div>
  </Modal>;
}
