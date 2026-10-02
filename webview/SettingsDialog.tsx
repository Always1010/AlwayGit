import { useEffect, useState } from 'react';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import type { Language } from './i18n';
import { defaultBadgeColor, diffRowHeight, effectiveRowHeight, fileRowHeight, isLightTheme, presetColors, textColorForBackground, type ResolvedTheme, type ThemePreference } from './appearance';
import { graphPalettes, type GraphPaletteId } from './graph/palettes';
import { Button, Icon, Modal } from './ui';

type SettingsPage = 'language' | 'theme' | 'density' | 'status' | 'colors' | 'advanced';
type ColorTheme = 'light' | 'dark';
const defaultMainColors = { light: '#283447', dark: '#EDF3FF' } as const;
const themes: { id: ThemePreference; label: string; labelZh: string; colors: readonly [string, string, string] }[] = [
  { id: 'system', label: 'Follow VS Code', labelZh: '跟随 VS Code', colors: ['#F4F6FA', '#2463C5', '#1B222D'] },
  { id: 'light', label: 'Clear Light', labelZh: '清透亮色', colors: ['#FFFFFF', '#2463C5', '#DBEAFE'] },
  { id: 'paper', label: 'Warm Paper', labelZh: '暖纸', colors: ['#FFF9ED', '#B45309', '#F5E6C8'] },
  { id: 'mist', label: 'Mist Blue', labelZh: '雾蓝', colors: ['#F3F8FC', '#176B87', '#D7EAF3'] },
  { id: 'dark', label: 'Deep Night', labelZh: '深夜', colors: ['#1B222D', '#83B8FF', '#244E78'] },
  { id: 'midnight', label: 'Midnight Blue', labelZh: '午夜蓝', colors: ['#0D1B2A', '#4CC9F0', '#173B57'] },
  { id: 'graphite', label: 'Graphite', labelZh: '石墨', colors: ['#202124', '#E8A838', '#3A3B40'] },
  { id: 'forest', label: 'Forest', labelZh: '森林', colors: ['#14251E', '#65D48B', '#244B38'] },
  { id: 'berry', label: 'Berry Purple', labelZh: '莓紫', colors: ['#27172F', '#E879F9', '#57306B'] },
  { id: 'contrast', label: 'High Contrast', labelZh: '高对比', colors: ['#0C1016', '#FFE875', '#153F6B'] },
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
  return <label>{t('Diff line height', 'Diff 行高')}<select aria-label={t('Diff line height', 'Diff 行高')} value={custom ? 'custom' : value} onChange={event => {
    const isCustom = event.target.value === 'custom'; setCustom(isCustom);
    if (!isCustom) onChange(Number(event.target.value));
  }}>{presets.map(size => <option key={size} value={size}>{size}px{size === 18 ? t(' · Default', ' · 默认') : ''}</option>)}<option value="custom">{t('Custom', '自定义')}</option></select>
    {custom && <input type="number" aria-label={t('Custom Diff line height', '自定义 Diff 行高')} min={16} max={36} step={1} value={draft} onChange={event => {
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
  const names = [t('Dense', '密集'), t('Compact · Default', '紧凑 · 默认'), t('Balanced', '适中'), t('Comfortable', '宽松')];
  return <label className="settings-full-width">{t('File list spacing', '文件列表间距')}<select aria-label={t('File list spacing', '文件列表间距')} value={custom ? 'custom' : value} onChange={event => {
    const isCustom = event.target.value === 'custom'; setCustom(isCustom);
    if (!isCustom) onChange(Number(event.target.value));
  }}>{presets.map((size, i) => <option key={size} value={size}>{names[i]} · {size}px</option>)}<option value="custom">{t('Custom', '自定义')}</option></select>
    {custom && <input type="number" aria-label={t('Custom file list spacing', '自定义文件列表间距')} min={0} max={8} step={1} value={draft} onChange={event => {
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
    <input type="color" aria-label={`${label} picker`} value={value} onChange={event => onChange(event.target.value.toUpperCase())}/>
    <input className="color-hex" aria-label={label} value={draft} maxLength={7} spellCheck={false} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
    {removable && <Button className="icon-only color-remove" icon="trash" title={t('Remove color', '删除颜色')} aria-label={`${t('Remove', '删除')} ${label}`} onClick={onRemove}/>}
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
    <svg viewBox="0 0 520 132" role="img" aria-label={t('Preview of concurrent, branching and merging commit paths', '并行、分叉与合并提交路径预览')}>
      <path d="M32 8V124" stroke={main}/>
      <path d="M32 18C32 30 76 30 76 42V90C76 102 32 102 32 114" stroke={color(0)}/>
      <path d="M32 42C32 52 120 54 120 66V90" stroke={color(1)}/>
      <path d="M76 42C76 53 164 54 164 66V114" stroke={color(2)}/>
      <path d="M120 66C120 78 208 78 208 90V114" stroke={color(3)}/>
      <path d="M164 66C164 77 252 79 252 90V114" stroke={color(4)}/>
      <path d="M208 90C208 102 296 102 296 114" stroke={color(5)}/>
      {rows.map((y, index) => <circle key={y} cx={32} cy={y} r={index === 0 ? 5 : 4} fill={main}/>)}
      {[[76,42,0],[120,66,1],[164,66,2],[208,90,3],[252,90,4],[296,114,5]].map(([x,y,index]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill={color(index)}/>)}
      <text x="326" y="24">HEAD · main</text><text x="326" y="48">feature/search</text><text x="326" y="72">fix/sidebar</text><text x="326" y="96">release/next</text><text x="326" y="120">merged paths</text>
    </svg>
  </div>;
}

export function SettingsDialog({ theme }: { theme: ResolvedTheme }) {
  const state = useWorkbench(), t = useTranslation(), { appearance, layout } = state;
  const [page, setPage] = useState<SettingsPage>('theme');
  const [colorTheme, setColorTheme] = useState<ColorTheme>(isLightTheme(theme) ? 'light' : 'dark');
  const [allowDetachedHead, setAllowDetachedHead] = useState(state.operationSettings.allowDetachedHead), [advancedDirty, setAdvancedDirty] = useState(false), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState<string>();
  useEffect(() => { if (!advancedDirty) setAllowDetachedHead(state.operationSettings.allowDetachedHead); }, [advancedDirty, state.operationSettings.allowDetachedHead]);
  const close = () => { if (!saving) state.finishSettings(false); };
  const apply = async () => {
    setSaving(true); setSaveError(undefined);
    try { if (advancedDirty) await state.saveOperationSettings(allowDetachedHead); state.finishSettings(true); }
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
  const pageLabel = page === 'advanced' ? t('Git operations', 'Git 操作') : page === 'language' ? t('Language', '语言') : page === 'theme' ? t('Theme', '主题') : page === 'density' ? t('Text & density', '字号与密度') : page === 'status' ? t('Status indicators', '状态提醒') : t('Graph colors', '提交图配色');
  const navItem = (id: SettingsPage, icon: string, en: string, zh: string) => <button type="button" className={`settings-nav-item ${page === id ? 'is-active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon name={icon}/><span>{t(en, zh)}</span></button>;

  return <Modal title={t('Settings', '设置')} busy={saving} onClose={close} footer={
    <><span className="settings-save-hint"><Icon name="check"/>{page === 'advanced' && state.operationSettings.scope === 'user' ? t('Git options are saved in user settings', 'Git 选项保存在用户设置') : t('Applies to this workspace', '保存在当前工作区')}</span><Button className="settings-cancel" disabled={saving} onClick={close}>{t('Cancel', '取消')}</Button><Button className="primary" disabled={saving} onClick={()=>void apply()}>{saving?t('Saving…','保存中…'):t('Apply', '应用')}</Button></>
  }>
    <div className="interface-settings" data-testid="interface-settings">
      <nav className="settings-nav" aria-label={t('Settings categories', '设置分类')}>
        <div className="settings-nav-group"><strong>{t('General', '常规')}</strong>{navItem('language', 'globe', 'Language', '语言')}</div>
        <div className="settings-nav-group"><strong>{t('Interface', '界面')}</strong>{navItem('theme', 'color-mode', 'Theme', '主题')}{navItem('density', 'text-size', 'Text & density', '字号与密度')}{navItem('status', 'bell-dot', 'Status indicators', '状态提醒')}</div>
        <div className="settings-nav-group"><strong>{t('Commit graph', '提交图')}</strong>{navItem('colors', 'git-merge', 'Colors', '配色')}</div>
        <div className="settings-nav-group">{navItem('advanced', 'tools', 'Advanced', '高级')}</div>
      </nav>
      <main className="settings-content">
        <header className="settings-page-heading"><span>{page === 'advanced' ? t('Advanced', '高级') : page === 'language' ? t('General', '常规') : page === 'colors' ? t('Commit graph', '提交图') : t('Interface', '界面')} › {pageLabel}</span><small>{page === 'advanced' ? t('Git options take effect only after Apply.', 'Git 操作选项在应用后生效。') : t('Changes preview immediately. Apply to save.', '调整会立即预览，应用后保存。')}</small></header>

        {saveError&&<p role="alert" className="form-error">{saveError}</p>}
        {page === 'advanced' && <section className="settings-page" aria-labelledby="advanced-heading">
          <h3 id="advanced-heading">{t('Git operations','Git 操作')}</h3>
          <label className="form-checkbox"><input type="checkbox" aria-label={t('Allow direct Detached HEAD Checkout','允许直接进入 Detached HEAD')} checked={allowDetachedHead} disabled={saving} onChange={event=>{setAdvancedDirty(true);setAllowDetachedHead(event.target.checked);}}/>{t('Allow direct Detached HEAD Checkout','允许直接进入 Detached HEAD')}</label>
          <p className="settings-page-copy">{t('Disabled by default. Create and switch to a local branch when checking out a historical Commit or Tag. Enabling this option allows direct Checkout; new commits will not automatically belong to a branch.','默认关闭。切换到历史 Commit 或 Tag 时，请创建并切换到本地分支。开启后允许直接 Checkout；新提交不会自动归属于任何分支。')}</p>
          <p className="settings-note">{t('This also controls Detached Worktrees. Internal Rebase steps and existing Detached HEAD repositories remain usable.','此选项同时控制 Detached Worktree；不影响 Rebase 内部步骤或已经处于 Detached HEAD 的仓库。')}</p>
        </section>}
        {page === 'language' && <section className="settings-page" aria-labelledby="language-heading">
          <h3 id="language-heading">{t('Language', '语言')}</h3>
          <p className="settings-page-copy">{t('Choose the language used throughout the workbench.', '选择工作台界面使用的语言。')}</p>
          <label className="settings-control">{t('Display language', '显示语言')}<select aria-label="Language" value={state.language} onChange={event => state.previewSettings({ language: event.target.value as Language })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
        </section>}

        {page === 'theme' && <section className="settings-page" aria-labelledby="theme-heading">
          <h3 id="theme-heading">{t('Theme', '主题')}</h3>
          <p className="settings-page-copy">{t('Use the VS Code theme or choose a fixed workbench appearance.', '跟随 VS Code，或为工作台选择固定外观。')}</p>
          <div className="theme-gallery" role="radiogroup" aria-label={t('Color theme', '颜色主题')}>
            {themes.map(item => <button key={item.id} type="button" role="radio" aria-checked={appearance.theme === item.id} className={`theme-card ${appearance.theme === item.id ? 'is-chosen' : ''}`} onClick={() => updateAppearance({ ...appearance, theme: item.id })}>
              <span className="theme-preview" style={{ '--theme-preview-bg': item.colors[0], '--theme-preview-accent': item.colors[1], '--theme-preview-selected': item.colors[2] } as React.CSSProperties}><i/><i/><i/></span>
              <span>{t(item.label, item.labelZh)}</span>
            </button>)}
          </div>
        </section>}

        {page === 'density' && <section className="settings-page" aria-labelledby="density-heading">
          <h3 id="density-heading">{t('Text & density', '字号与密度')}</h3>
          <div className="settings-grid">
            <label>{t('Interface font', '界面字号')}<select aria-label={t('Interface font', '界面字号')} value={layout.font} onChange={event => state.previewSettings({ font: Number(event.target.value) })}>{[12,13,14,15,16].map(size => <option key={size} value={size}>{size}px{size === 13 ? t(' · Default', ' · 默认') : ''}</option>)}</select></label>
            <label>{t('Diff font', 'Diff 字号')}<select aria-label={t('Diff font', 'Diff 字号')} value={appearance.codeFont} onChange={event => updateAppearance({ ...appearance, codeFont: Number(event.target.value) })}>{[11,12,13,14,15,16,17,18].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
            <label>{t('List density', '列表密度')}<select aria-label={t('List density', '列表密度')} value={layout.row} onChange={event => state.previewSettings({ row: Number(event.target.value) })}>{densityOptions.map(size => <option key={size} value={size}>{size === 22 ? t('Dense', '密集') : size === 24 ? t('Compact · Default', '紧凑 · 默认') : size === 28 ? t('Comfortable', '舒适') : t('Custom', '自定义')} · {size}px</option>)}</select></label>
            <DiffHeightField value={appearance.codeRowHeight} onChange={codeRowHeight => updateAppearance({ ...appearance, codeRowHeight })}/>
            <FileSpacingField value={appearance.fileSpacing} onChange={fileSpacing => updateAppearance({ ...appearance, fileSpacing })}/>
          </div>
          <div className="settings-row-preview" style={{ minHeight: effectiveRowHeight(layout) }}><Icon name="git-commit"/><span className="ref-badge local" aria-current="true">main</span><span className="truncate">feat: {t('Refine the workbench', '优化工作台体验')}</span><span className="muted">{effectiveRowHeight(layout)}px</span></div>
          <div className="file-item settings-file-preview"><span className="file-status status-M" title={t('Modified', '已修改')} role="img" aria-label={t('Modified', '已修改')}><Icon name="file-code"/><span className="file-status-badge" aria-hidden="true">M</span></span><span className="file-label"><span className="file-basename">App.tsx</span><span className="file-parent-path">./webview</span></span><span className="muted">{fileRowHeight(layout.font, appearance.fileSpacing)}px</span></div>
          <p className="settings-note">{t('File spacing sets the padding above and below each file in Commit Details, comparisons and Working Tree. The filename and path remain on two lines; long paths expand as needed.', '文件间距控制 Commit 详情、比较和 Working Tree 文件行的上下留白。保留文件名与路径两行，长路径自动增高。')}</p>
          <p className="settings-note">{t('Row height grows with larger text to keep every line readable.', '大字号会自动增加最小行高，避免文字被裁切。')}</p>
          <p className="settings-note">{t('Diff line height', 'Diff 行高')}: {diffRowHeight(appearance.codeFont, appearance.codeRowHeight)}px · {t('Custom range: 16–36px; at least font size + 4px.', '自定义范围 16–36px；实际行高至少为字号 + 4px。')}</p>
        </section>}

        {page === 'status' && <section className="settings-page" aria-labelledby="status-heading">
          <div className="settings-title-row"><div><h3 id="status-heading">{t('Status indicators', '状态提醒')}</h3><p className="settings-page-copy">{t('Choose the color used for unpushed Commit counts.', '选择未推送 Commit 数量提醒的颜色。')}</p></div><Button className="icon-only" icon="discard" title={t('Restore default', '恢复默认')} aria-label={t('Restore default badge color', '恢复默认提醒颜色')} onClick={() => updateAppearance({ ...appearance, badgeColor: defaultBadgeColor })}/></div>
          <div className="badge-preview-row"><span>{t('Preview', '预览')}</span><span className="notification-badge settings-badge-preview" style={{ background: appearance.badgeColor, color: textColorForBackground(appearance.badgeColor) }}>24</span><span className="notification-badge settings-badge-preview" style={{ background: appearance.badgeColor, color: textColorForBackground(appearance.badgeColor) }}>69</span></div>
          <div className="badge-presets" role="radiogroup" aria-label={t('Badge color presets', '提醒颜色预设')}>
            {badgeColors.map(color => <button key={color} type="button" role="radio" aria-checked={appearance.badgeColor === color} aria-label={color} className={appearance.badgeColor === color ? 'is-chosen' : ''} style={{ background: color }} onClick={() => updateAppearance({ ...appearance, badgeColor: color })}/>)}
          </div>
          <label className="status-color-field"><span>{t('Custom color', '自定义颜色')}</span><ColorField value={appearance.badgeColor} label={t('Notification badge color', '通知角标颜色')} onChange={value => updateAppearance({ ...appearance, badgeColor: value })}/></label>
          <p className="settings-note">{t('Text switches between black and white automatically for contrast.', '文字会根据背景自动切换黑色或白色，保持清晰。')}</p>
        </section>}

        {page === 'colors' && <section className="settings-page graph-colors-page" aria-labelledby="colors-heading">
          <div className="settings-title-row"><div><h3 id="colors-heading">{t('Graph colors', '提交图配色')}</h3><p className="settings-page-copy">{t('Start from a preset, then tune every color for your display.', '从预设开始，再按你的显示效果逐色调整。')}</p></div><Button className="icon-only" icon="discard" title={t('Restore preset', '恢复预设')} aria-label={t('Restore preset', '恢复预设')} onClick={() => choosePreset(appearance.palette)}/></div>
          <div className="palette-presets" role="radiogroup" aria-label={t('Color preset', '配色预设')}>
            {graphPalettes.map(item => <button key={item.id} type="button" role="radio" aria-checked={appearance.palette === item.id} className={`palette-preset ${appearance.palette === item.id ? 'is-chosen' : ''}`} onClick={() => choosePreset(item.id)}><span>{t(item.label, item.labelZh)}</span><span className="palette-strip">{item[colorTheme].slice(0, 8).map(color => <i key={color} style={{ background: color }}/>)}</span></button>)}
          </div>
          <div className="color-mode-row"><div className="settings-tabs" role="tablist" aria-label={t('Preview theme', '预览主题')}><button type="button" role="tab" aria-selected={colorTheme === 'light'} className={colorTheme === 'light' ? 'is-active' : ''} onClick={() => setColorTheme('light')}>{t('Light', '浅色')}</button><button type="button" role="tab" aria-selected={colorTheme === 'dark'} className={colorTheme === 'dark' ? 'is-active' : ''} onClick={() => setColorTheme('dark')}>{t('Dark', '深色')}</button></div><span className="palette-status">{appearance.colors.light.length} {t('colors', '色')}{customized ? t(' · Customized', ' · 已修改') : ''}</span></div>
          <GraphPreview colors={appearance.colors[colorTheme]} main={appearance.mainColors[colorTheme]} mode={colorTheme}/>
          <div className="color-editor-heading"><strong>{t('Path colors', '路径颜色')}</strong><Button className="icon-only" icon="add" title={t('Add color', '添加颜色')} aria-label={t('Add color', '添加颜色')} disabled={appearance.colors.light.length >= 16} onClick={addColor}/></div>
          <div className="color-editor-grid">{appearance.colors[colorTheme].map((color, index) => <div className="color-editor-item" key={`${colorTheme}-${index}`}><span className={`contrast-dot ${contrastRatio(color, colorTheme === 'light' ? '#FFFFFF' : '#1B222D') >= 3 ? 'is-good' : 'is-low'}`} title={t('Background contrast indicator', '背景对比度提示')}/><ColorField value={color} label={`${t('Path color', '路径颜色')} ${index + 1}`} removable={appearance.colors.light.length > 4} onChange={value => setColor(index, value)} onRemove={() => removeColor(index)}/></div>)}</div>
          <div className="main-color-row"><div><strong>{t('Main line', '主线')}</strong><small>{t('Kept separate from branch colors.', '与其他分支颜色独立。')}</small></div><ColorField value={appearance.mainColors[colorTheme]} label={t('Main line color', '主线颜色')} onChange={value => updateAppearance({ ...appearance, mainColors: { ...appearance.mainColors, [colorTheme]: value } })}/><Button className="icon-only" icon="discard" title={t('Restore main line color', '恢复主线颜色')} aria-label={t('Restore main line color', '恢复主线颜色')} onClick={() => updateAppearance({ ...appearance, mainColors: { ...appearance.mainColors, [colorTheme]: defaultMainColors[colorTheme] } })}/></div>
          <p className="settings-note"><span className="contrast-dot is-good"/> {t('At least 3:1 against the preview background', '与预览背景至少 3:1')} <span className="contrast-dot is-low"/> {t('Low contrast; consider a stronger color', '对比偏低，建议调整')}. {t('New paths prefer unused colors that differ from nearby lines.', '新路径会优先选择未使用且与邻线差异较大的颜色。')}</p>
        </section>}
      </main>
    </div>
  </Modal>;
}
