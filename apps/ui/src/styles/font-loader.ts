import { DEFAULT_FONT_VALUE } from '@/config/ui-font-options';

const loadedFonts = new Set<string>();

function normalizeFontName(fontValue: string): string {
  const trimmed = fontValue.trim();
  if (!trimmed) return '';
  const primary = trimmed.split(',')[0]?.trim() ?? '';
  return primary.replace(/^['"]|['"]$/g, '');
}

async function loadOnce(key: string, loader: () => Promise<unknown>): Promise<void> {
  if (loadedFonts.has(key)) {
    return;
  }
  loadedFonts.add(key);
  try {
    await loader();
  } catch {
    loadedFonts.delete(key);
  }
}

function loadFontWeights(loaders: Array<() => Promise<unknown>>): Promise<void> {
  return Promise.all(loaders.map((loader) => loader())).then(() => undefined);
}

export async function loadFontFamily(fontValue: string | null | undefined): Promise<void> {
  if (!fontValue || fontValue === DEFAULT_FONT_VALUE) {
    return;
  }

  const fontName = normalizeFontName(fontValue);
  if (!fontName) {
    return;
  }

  switch (fontName) {
    case 'Inter':
      await loadOnce('Inter', () =>
        loadFontWeights([
          () => import('@fontsource/inter/400.css'),
          () => import('@fontsource/inter/500.css'),
          () => import('@fontsource/inter/600.css'),
          () => import('@fontsource/inter/700.css'),
        ])
      );
      break;
    case 'Roboto':
      await loadOnce('Roboto', () =>
        loadFontWeights([
          () => import('@fontsource/roboto/400.css'),
          () => import('@fontsource/roboto/500.css'),
          () => import('@fontsource/roboto/700.css'),
        ])
      );
      break;
    case 'Open Sans':
      await loadOnce('Open Sans', () =>
        loadFontWeights([
          () => import('@fontsource/open-sans/400.css'),
          () => import('@fontsource/open-sans/500.css'),
          () => import('@fontsource/open-sans/600.css'),
          () => import('@fontsource/open-sans/700.css'),
        ])
      );
      break;
    case 'Montserrat':
      await loadOnce('Montserrat', () =>
        loadFontWeights([
          () => import('@fontsource/montserrat/400.css'),
          () => import('@fontsource/montserrat/500.css'),
          () => import('@fontsource/montserrat/600.css'),
          () => import('@fontsource/montserrat/700.css'),
        ])
      );
      break;
    case 'Lato':
      await loadOnce('Lato', () =>
        loadFontWeights([
          () => import('@fontsource/lato/400.css'),
          () => import('@fontsource/lato/700.css'),
        ])
      );
      break;
    case 'Poppins':
      await loadOnce('Poppins', () =>
        loadFontWeights([
          () => import('@fontsource/poppins/400.css'),
          () => import('@fontsource/poppins/500.css'),
          () => import('@fontsource/poppins/600.css'),
          () => import('@fontsource/poppins/700.css'),
        ])
      );
      break;
    case 'Raleway':
      await loadOnce('Raleway', () =>
        loadFontWeights([
          () => import('@fontsource/raleway/400.css'),
          () => import('@fontsource/raleway/500.css'),
          () => import('@fontsource/raleway/600.css'),
          () => import('@fontsource/raleway/700.css'),
        ])
      );
      break;
    case 'Work Sans':
      await loadOnce('Work Sans', () =>
        loadFontWeights([
          () => import('@fontsource/work-sans/400.css'),
          () => import('@fontsource/work-sans/500.css'),
          () => import('@fontsource/work-sans/600.css'),
          () => import('@fontsource/work-sans/700.css'),
        ])
      );
      break;
    case 'Source Sans 3':
      await loadOnce('Source Sans 3', () =>
        loadFontWeights([
          () => import('@fontsource/source-sans-3/400.css'),
          () => import('@fontsource/source-sans-3/500.css'),
          () => import('@fontsource/source-sans-3/600.css'),
          () => import('@fontsource/source-sans-3/700.css'),
        ])
      );
      break;
    case 'Fira Code':
      await loadOnce('Fira Code', () =>
        loadFontWeights([
          () => import('@fontsource/fira-code/400.css'),
          () => import('@fontsource/fira-code/500.css'),
          () => import('@fontsource/fira-code/600.css'),
          () => import('@fontsource/fira-code/700.css'),
        ])
      );
      break;
    case 'JetBrains Mono':
      await loadOnce('JetBrains Mono', () =>
        loadFontWeights([
          () => import('@fontsource/jetbrains-mono/400.css'),
          () => import('@fontsource/jetbrains-mono/500.css'),
          () => import('@fontsource/jetbrains-mono/600.css'),
          () => import('@fontsource/jetbrains-mono/700.css'),
        ])
      );
      break;
    case 'Cascadia Code':
      await loadOnce('Cascadia Code', () =>
        loadFontWeights([
          () => import('@fontsource/cascadia-code/400.css'),
          () => import('@fontsource/cascadia-code/600.css'),
          () => import('@fontsource/cascadia-code/700.css'),
        ])
      );
      break;
    case 'Iosevka':
      await loadOnce('Iosevka', () =>
        loadFontWeights([
          () => import('@fontsource/iosevka/400.css'),
          () => import('@fontsource/iosevka/500.css'),
          () => import('@fontsource/iosevka/600.css'),
          () => import('@fontsource/iosevka/700.css'),
        ])
      );
      break;
    case 'Inconsolata':
      await loadOnce('Inconsolata', () =>
        loadFontWeights([
          () => import('@fontsource/inconsolata/400.css'),
          () => import('@fontsource/inconsolata/500.css'),
          () => import('@fontsource/inconsolata/600.css'),
          () => import('@fontsource/inconsolata/700.css'),
        ])
      );
      break;
    case 'Source Code Pro':
      await loadOnce('Source Code Pro', () =>
        loadFontWeights([
          () => import('@fontsource/source-code-pro/400.css'),
          () => import('@fontsource/source-code-pro/500.css'),
          () => import('@fontsource/source-code-pro/600.css'),
          () => import('@fontsource/source-code-pro/700.css'),
        ])
      );
      break;
    case 'IBM Plex Mono':
      await loadOnce('IBM Plex Mono', () =>
        loadFontWeights([
          () => import('@fontsource/ibm-plex-mono/400.css'),
          () => import('@fontsource/ibm-plex-mono/500.css'),
          () => import('@fontsource/ibm-plex-mono/600.css'),
          () => import('@fontsource/ibm-plex-mono/700.css'),
        ])
      );
      break;
    case 'Zed Sans':
    case 'Zed Mono':
      await loadOnce('Zed Fonts', () => import('@/assets/fonts/zed/zed-fonts.css'));
      break;
    default:
      break;
  }
}
