import { useEffect, useState } from 'react';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import type { Language } from './i18n';
import { effectiveRowHeight, isLightTheme, presetColors, type ResolvedTheme, type ThemePreference } from './appearance';
import { graphPalettes, type GraphPaletteId } from './graph/palettes';
import { Button, Icon, Modal } from './ui';

type SettingsPage = 'language' | 'theme' | 'density' | 'colors';
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
  const close = () => state.finishSettings(false);
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
  const pageLabel = page === 'language' ? t('Language', '语言') : page === 'theme' ? t('Theme', '主题') : page === 'density' ? t('Text & density', '字号与密度') : t('Graph colors', '提交图配色');
  const navItem = (id: SettingsPage, icon: string, en: string, zh: string) => <button type="button" className={`settings-nav-item ${page === id ? 'is-active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon name={icon}/><span>{t(en, zh)}</span></button>;

  return <Modal title={t('Interface Settings', '界面设置')} onClose={close} footer={
    <><span className="settings-save-hint"><Icon name="check"/>{t('Applies to this workspace', '保存在当前工作区')}</span><Button className="settings-cancel" onClick={close}>{t('Cancel', '取消')}</Button><Button className="primary" onClick={() => state.finishSettings(true)}>{t('Apply', '应用')}</Button></>
  }>
    <div className="interface-settings" data-testid="interface-settings">
      <nav className="settings-nav" aria-label={t('Settings categories', '设置分类')}>
        <div className="settings-nav-group"><strong>{t('General', '常规')}</strong>{navItem('language', 'globe', 'Language', '语言')}</div>
        <div className="settings-nav-group"><strong>{t('Interface', '界面')}</strong>{navItem('theme', 'color-mode', 'Theme', '主题')}{navItem('density', 'text-size', 'Text & density', '字号与密度')}</div>
        <div className="settings-nav-group"><strong>{t('Commit graph', '提交图')}</strong>{navItem('colors', 'git-merge', 'Colors', '配色')}</div>
      </nav>
      <main className="settings-content">
        <header className="settings-page-heading"><span>{page === 'language' ? t('General', '常规') : page === 'colors' ? t('Commit graph', '提交图') : t('Interface', '界面')} › {pageLabel}</span><small>{t('Changes preview immediately. Apply to save.', '调整会立即预览，应用后保存。')}</small></header>

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
            <label className="settings-full-width">{t('List density', '列表密度')}<select aria-label={t('List density', '列表密度')} value={layout.row} onChange={event => state.previewSettings({ row: Number(event.target.value) })}>{densityOptions.map(size => <option key={size} value={size}>{size === 22 ? t('Dense', '密集') : size === 24 ? t('Compact · Default', '紧凑 · 默认') : size === 28 ? t('Comfortable', '舒适') : t('Custom', '自定义')} · {size}px</option>)}</select></label>
          </div>
          <div className="settings-row-preview" style={{ minHeight: effectiveRowHeight(layout) }}><Icon name="git-commit"/><span className="ref-badge current">HEAD · main</span><span className="truncate">feat: {t('Refine the workbench', '优化工作台体验')}</span><span className="muted">{effectiveRowHeight(layout)}px</span></div>
          <p className="settings-note">{t('Row height grows with larger text to keep every line readable.', '大字号会自动增加最小行高，避免文字被裁切。')}</p>
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
