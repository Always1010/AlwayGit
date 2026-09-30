import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import type { Language } from './i18n';
import { effectiveRowHeight, type ResolvedTheme, type ThemePreference } from './appearance';
import { graphPalettes } from './graph/palettes';
import { Button, Icon, Modal } from './ui';

function PalettePreview({ colors }: { colors: readonly string[] }) {
  return <svg className="palette-preview" viewBox="0 0 160 54" aria-hidden="true">
    {colors.map((color, i) => {
      const x = 7 + i * 146 / colors.length, bend = i % 2 ? -5 : 5;
      return <g key={i} stroke={color} strokeWidth="2.5" fill="none"><path d={`M${x} 2 V16 C${x} 24 ${x + bend} 27 ${x + bend} 34 V52`}/><circle cx={x} cy={12 + i % 2 * 5} r="2.5" fill={color} stroke="none"/></g>;
    })}
  </svg>;
}

export function SettingsDialog({ theme }: { theme: ResolvedTheme }) {
  const state = useWorkbench(), t = useTranslation(), { appearance, layout } = state;
  const close = () => state.finishSettings(false), light = theme.includes('light');
  const densityOptions = [22, 24, 28];
  if (!densityOptions.includes(layout.row)) densityOptions.push(layout.row);
  return <Modal title={t('Interface Settings', '界面设置')} onClose={close} footer={
    <><span className="settings-save-hint"><Icon name="check"/>{t('Applies to this workspace', '保存在当前工作区')}</span><Button className="settings-cancel" onClick={close}>{t('Cancel', '取消')}</Button><Button className="primary" onClick={() => state.finishSettings(true)}>{t('Apply', '应用')}</Button></>
  }>
    <div className="interface-settings" data-testid="interface-settings">
      <p className="settings-intro">{t('Preview changes here. Apply to save, or cancel to restore.', '调整后实时预览；应用后保存，取消则恢复原设置。')}</p>
      <section className="settings-section" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading"><Icon name="color-mode"/>{t('Appearance', '外观')}</h3>
        <div className="settings-grid">
          <label>{t('Theme', '主题')}<select aria-label={t('Theme', '主题')} value={appearance.theme} onChange={e => state.previewSettings({ appearance: { ...appearance, theme: e.target.value as ThemePreference } })}>
            <option value="system">{t('Follow VS Code', '跟随 VS Code')}</option><option value="light">{t('Light', '浅色')}</option><option value="dark">{t('Dark', '深色')}</option><option value="contrast">{t('High contrast', '高对比')}</option>
          </select></label>
          <label>{t('Language', '语言')}<select aria-label="Language" value={state.language} onChange={e => state.previewSettings({ language: e.target.value as Language })}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="density-heading">
        <h3 id="density-heading"><Icon name="text-size"/>{t('Text & density', '字号与密度')}</h3>
        <div className="settings-grid">
          <label>{t('Interface font', '界面字号')}<select aria-label={t('Interface font', '界面字号')} value={layout.font} onChange={e => state.previewSettings({ font: Number(e.target.value) })}>{[12,13,14,15,16].map(size => <option key={size} value={size}>{size}px{size === 13 ? t(' · Default', ' · 默认') : ''}</option>)}</select></label>
          <label>{t('Diff font', 'Diff 字号')}<select aria-label={t('Diff font', 'Diff 字号')} value={appearance.codeFont} onChange={e => state.previewSettings({ appearance: { ...appearance, codeFont: Number(e.target.value) } })}>{[11,12,13,14,15,16,17,18].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
          <label className="settings-full-width">{t('List density', '列表密度')}<select aria-label={t('List density', '列表密度')} value={layout.row} onChange={e => state.previewSettings({ row: Number(e.target.value) })}>{densityOptions.map(size => <option key={size} value={size}>{size === 22 ? t('Dense', '密集') : size === 24 ? t('Compact · Default', '紧凑 · 默认') : size === 28 ? t('Comfortable', '舒适') : t('Custom', '自定义')} · {size}px</option>)}</select></label>
        </div>
        <div className="settings-row-preview" style={{ minHeight: effectiveRowHeight(layout) }}><Icon name="git-commit"/><span className="ref-badge current">HEAD · main</span><span className="truncate">feat: {t('Refine the workbench', '优化工作台体验')}</span><span className="muted">{effectiveRowHeight(layout)}px</span></div>
        <p className="settings-note">{t('Row height grows with larger text to keep every line readable.', '大字号会自动增加最小行高，避免文字被裁切。')}</p>
      </section>
      <section className="settings-section" aria-labelledby="palette-heading">
        <h3 id="palette-heading"><Icon name="git-merge"/>{t('Graph colors', 'Graph 线条配色')}</h3>
        <div className="palette-options" role="radiogroup" aria-labelledby="palette-heading">
          {graphPalettes.map(palette => <label key={palette.id} className={`palette-option ${appearance.palette === palette.id ? 'is-chosen' : ''}`}>
            <input type="radio" name="graph-palette" value={palette.id} checked={appearance.palette === palette.id} onChange={() => state.previewSettings({ appearance: { ...appearance, palette: palette.id } })}/>
            <span className="palette-copy"><strong>{t(palette.label, palette.labelZh)}</strong><small>{t(palette.description, palette.descriptionZh)}</small></span>
            <PalettePreview colors={light ? palette.light : palette.dark}/>
          </label>)}
        </div>
        <p className="settings-note">{t('Paths keep their colors. New paths favor unused colors that differ from nearby lines; colors are reused when needed. The main line stays distinct.', '同一路径延续原色，新路径优先使用空闲且与邻线差异较大的颜色；色位用尽后复用，主线单独突出。')}</p>
      </section>
    </div>
  </Modal>;
}
