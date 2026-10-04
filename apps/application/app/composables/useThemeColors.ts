/**
 * The viewer's theme colors — the accent Nuxt UI calls `primary` and the gray
 * scale it calls `neutral` — saved in the `piwi-theme-colors` cookie. The
 * server reads the cookie too, so the first render already carries the saved
 * colors. A saved value outside the offered palettes is ignored.
 */

/** Accent colors: buttons, links, the active navigation item, focus rings. */
export const ACCENT_COLORS: readonly string[] = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

/** Gray scales: backgrounds, borders and text. */
export const GRAY_COLORS: readonly string[] = ['slate', 'gray', 'zinc', 'neutral', 'stone'];

const COOKIE_KEY = 'piwi-theme-colors';
const ONE_YEAR_S = 60 * 60 * 24 * 365;

interface SavedThemeColors {
  primary?: unknown;
  neutral?: unknown;
}

function fromPalette(value: unknown, palette: readonly string[]): string | undefined {
  return typeof value === 'string' && palette.includes(value) ? value : undefined;
}

export function useThemeColors() {
  const appConfig = useAppConfig();
  const saved = useCookie<SavedThemeColors | null>(COOKIE_KEY, {
    default: () => null,
    maxAge: ONE_YEAR_S,
    sameSite: 'lax',
  });

  /** Paints the saved colors, if any. */
  function applySaved(): void {
    const primary = fromPalette(saved.value?.primary, ACCENT_COLORS);
    const neutral = fromPalette(saved.value?.neutral, GRAY_COLORS);
    if (primary) appConfig.ui.colors.primary = primary;
    if (neutral) appConfig.ui.colors.neutral = neutral;
  }

  function setAccent(color: string): void {
    appConfig.ui.colors.primary = color;
    saved.value = { ...saved.value, primary: color };
  }

  function setGray(color: string): void {
    appConfig.ui.colors.neutral = color;
    saved.value = { ...saved.value, neutral: color };
  }

  return {
    accent: computed(() => appConfig.ui.colors.primary),
    gray: computed(() => appConfig.ui.colors.neutral),
    applySaved,
    setAccent,
    setGray,
  };
}
