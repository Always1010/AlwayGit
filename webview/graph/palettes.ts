export type GraphPaletteId = 'vivid' | 'distinct' | 'extended';

export interface GraphPalette {
  id: GraphPaletteId;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
  light: readonly string[];
  dark: readonly string[];
}

/** Matching positions keep each lineage's hue consistent across themes. */
export const graphPalettes: readonly GraphPalette[] = [
  {
    id: 'vivid', label: 'Vivid · 12 colors', labelZh: '鲜明 · 12 色',
    description: 'Balanced colors for everyday branch history.', descriptionZh: '适合日常分支历史的均衡配色。',
    light: ['#2563b8', '#b85b0b', '#8554bc', '#087e76', '#b5377c', '#c04444', '#88720b', '#087ca5', '#537b17', '#ac4f66', '#5865b9', '#916335'],
    dark: ['#70acff', '#ffa45e', '#c69aff', '#52cbbb', '#f081ba', '#ff8585', '#dbc25b', '#64c7e7', '#a4cc65', '#e99baa', '#a0acff', '#cfa574'],
  },
  {
    id: 'distinct', label: 'Distinct · 8 colors', labelZh: '高区分 · 8 色',
    description: 'A smaller set with stronger hue separation.', descriptionZh: '较少颜色，优先提高相邻路径的区分度。',
    light: ['#1767a8', '#b95600', '#8253a6', '#008274', '#b33476', '#a66c00', '#536d19', '#74604c'],
    dark: ['#70b6f2', '#ffa65d', '#c3a0e8', '#51c7b4', '#ef8bbc', '#e9c261', '#adcb6c', '#cbb49a'],
  },
  {
    id: 'extended', label: 'Extended · 16 colors', labelZh: '扩展 · 16 色',
    description: 'More colors for histories with many concurrent paths.', descriptionZh: '更多颜色，适合同时存在较多路径的历史。',
    light: ['#2563b8', '#b85b0b', '#8554bc', '#087e76', '#b5377c', '#c04444', '#88720b', '#087ca5', '#537b17', '#ac4f66', '#5865b9', '#916335', '#637b2d', '#9c439e', '#33749a', '#9c552f'],
    dark: ['#70acff', '#ffa45e', '#c69aff', '#52cbbb', '#f081ba', '#ff8585', '#dbc25b', '#64c7e7', '#a4cc65', '#e99baa', '#a0acff', '#cfa574', '#b4c885', '#dfa1e3', '#86bada', '#e6a482'],
  },
];

export function getGraphPalette(id: GraphPaletteId = 'vivid'): GraphPalette {
  return graphPalettes.find(palette => palette.id === id) ?? graphPalettes[0];
}

function oklab(hex: string): readonly number[] {
  const rgb = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const [r, g, b] = rgb;
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}

// Compute once: allocation scores must remain independent of the active theme.
const distances = new Map(graphPalettes.map(palette => {
  const themes = [palette.light.map(oklab), palette.dark.map(oklab)];
  return [palette.id, palette.light.map((_, a) => palette.light.map((__, b) =>
    Math.min(...themes.map(colors => Math.hypot(...colors[a].map((value, index) => value - colors[b][index]))))))] as const;
}));

export function paletteColorDistance(id: GraphPaletteId, a: number, b: number): number {
  return distances.get(id)![a][b];
}
