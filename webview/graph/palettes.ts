import type { StaticMessageKey } from '../../src/i18n';
export type GraphPaletteId = 'vivid' | 'distinct' | 'extended';

export interface GraphPalette {
  id: GraphPaletteId;
  labelKey: StaticMessageKey;
  descriptionKey: StaticMessageKey;
  light: readonly string[];
  dark: readonly string[];
}

export interface GraphPaletteColors {
  light: readonly string[];
  dark: readonly string[];
}

/** Matching positions keep each lineage's hue consistent across themes. */
export const graphPalettes: readonly GraphPalette[] = [
  {
    id: 'vivid', labelKey: "palettes.vivid12Colors", descriptionKey: "palettes.balancedColorsForEverydayBranchHistory", light: ['#005FCC', '#C24100', '#7C3AED', '#00856A', '#D00070', '#D62F2F', '#7A6500', '#007C9E', '#4F7D00', '#B23A67', '#3F51D7', '#9A5700'],
    dark: ['#4DA3FF', '#FF8A3D', '#B983FF', '#24D1B3', '#FF5CAB', '#FF6268', '#E5C84A', '#35C7F0', '#9ADA45', '#FF91B1', '#8897FF', '#EAB05A'],
  },
  {
    id: 'distinct', labelKey: "palettes.distinct8Colors", descriptionKey: "palettes.aSmallerSetWithStrongerHueSeparation", light: ['#005FCC', '#C24100', '#7C3AED', '#00856A', '#D00070', '#D62F2F', '#6D7200', '#007C9E'],
    dark: ['#4DA3FF', '#FF8A3D', '#B983FF', '#24D1B3', '#FF5CAB', '#FF6268', '#C8D94B', '#35C7F0'],
  },
  {
    id: 'extended', labelKey: "palettes.extended16Colors", descriptionKey: "palettes.moreColorsForHistoriesWithManyConcurrentPaths", light: ['#005FCC', '#C24100', '#7C3AED', '#00856A', '#D00070', '#D62F2F', '#7A6500', '#007C9E', '#4F7D00', '#B23A67', '#3F51D7', '#9A5700', '#397300', '#A62AB2', '#006FBA', '#B33D28'],
    dark: ['#4DA3FF', '#FF8A3D', '#B983FF', '#24D1B3', '#FF5CAB', '#FF6268', '#E5C84A', '#35C7F0', '#9ADA45', '#FF91B1', '#8897FF', '#EAB05A', '#75D94A', '#ED79F4', '#5CBFFF', '#FF8067'],
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

export function paletteColorDistance(id: GraphPaletteId, a: number, b: number, colors?: GraphPaletteColors): number {
  if (!colors) return distances.get(id)![a][b];
  const pairs = [colors.light, colors.dark].map(theme => [oklab(theme[a]), oklab(theme[b])]);
  return Math.min(...pairs.map(([first, second]) => Math.hypot(...first.map((value, index) => value - second[index]))));
}
