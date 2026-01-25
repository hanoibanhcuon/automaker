import './themes/dark.css';
import './themes/light.css';

const loadedThemes = new Set<string>(['dark', 'light']);

const themeLoaders: Record<string, () => Promise<unknown>> = {
  retro: () => import('./themes/retro.css'),
  dracula: () => import('./themes/dracula.css'),
  nord: () => import('./themes/nord.css'),
  monokai: () => import('./themes/monokai.css'),
  tokyonight: () => import('./themes/tokyonight.css'),
  solarized: () => import('./themes/solarized.css'),
  gruvbox: () => import('./themes/gruvbox.css'),
  catppuccin: () => import('./themes/catppuccin.css'),
  onedark: () => import('./themes/onedark.css'),
  synthwave: () => import('./themes/synthwave.css'),
  red: () => import('./themes/red.css'),
  sunset: () => import('./themes/sunset.css'),
  gray: () => import('./themes/gray.css'),
  forest: () => import('./themes/forest.css'),
  ocean: () => import('./themes/ocean.css'),
  ember: () => import('./themes/ember.css'),
  'ayu-dark': () => import('./themes/ayu-dark.css'),
  'ayu-mirage': () => import('./themes/ayu-mirage.css'),
  matcha: () => import('./themes/matcha.css'),
  cream: () => import('./themes/cream.css'),
  solarizedlight: () => import('./themes/solarizedlight.css'),
  github: () => import('./themes/github.css'),
  paper: () => import('./themes/paper.css'),
  rose: () => import('./themes/rose.css'),
  mint: () => import('./themes/mint.css'),
  lavender: () => import('./themes/lavender.css'),
  sand: () => import('./themes/sand.css'),
  sky: () => import('./themes/sky.css'),
  peach: () => import('./themes/peach.css'),
  snow: () => import('./themes/snow.css'),
  sepia: () => import('./themes/sepia.css'),
  gruvboxlight: () => import('./themes/gruvboxlight.css'),
  nordlight: () => import('./themes/nordlight.css'),
  blossom: () => import('./themes/blossom.css'),
  'ayu-light': () => import('./themes/ayu-light.css'),
  onelight: () => import('./themes/onelight.css'),
  bluloco: () => import('./themes/bluloco.css'),
  feather: () => import('./themes/feather.css'),
};

export async function loadThemeCss(theme: string | null | undefined): Promise<void> {
  if (!theme || theme === 'system') {
    return;
  }

  if (loadedThemes.has(theme)) {
    return;
  }

  const loader = themeLoaders[theme];
  if (!loader) {
    return;
  }

  loadedThemes.add(theme);
  try {
    await loader();
  } catch {
    loadedThemes.delete(theme);
  }
}
