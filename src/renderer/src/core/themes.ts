/**
 * Color gradients for the look of the app: the logo, the thin line along the top of the window,
 * the Home banner and a tint on the tool rail. Each gradient also brings an accent color per
 * light/dark mode. It is used on Home, in Settings and in dialogs, and inside the tools too when
 * the user turns on "use the gradient's color in every tool"; otherwise each tool keeps its own
 * color. Accents keep white button text at WCAG AA (4.5:1) and stand out 3:1 from the panels.
 */
export type GradientId = 'ultima' | 'ocean' | 'sunset' | 'forest' | 'aurora' | 'rose' | 'graphite';

/** Where accent colors come from inside the tools: each tool's own color, or the gradient. */
export type AccentMode = 'tools' | 'gradient';

export type ColorMode = 'dark' | 'light';

export interface GradientTheme {
  id: GradientId;
  /** English name; the UI translates it. */
  name: string;
  /** Three stops, from the top-left corner to the bottom-right one. */
  stops: readonly [string, string, string];
  accent: Record<ColorMode, string>;
  hover: Record<ColorMode, string>;
}

export const GRADIENTS: readonly GradientTheme[] = [
  {
    id: 'ultima',
    name: 'Ultima',
    stops: ['#8b5cf6', '#ec4899', '#f59e0b'],
    accent: { dark: '#7556ff', light: '#6d4aff' },
    hover: { dark: '#9178ff', light: '#5a36f0' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    stops: ['#2563eb', '#06b6d4', '#2dd4bf'],
    accent: { dark: '#2563eb', light: '#1d4ed8' },
    hover: { dark: '#3b82f6', light: '#1e40af' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    stops: ['#f59e0b', '#f97316', '#e11d48'],
    accent: { dark: '#c2410c', light: '#c2410c' },
    hover: { dark: '#ea580c', light: '#9a3412' },
  },
  {
    id: 'forest',
    name: 'Forest',
    stops: ['#84cc16', '#16a34a', '#0f766e'],
    accent: { dark: '#15803d', light: '#15803d' },
    hover: { dark: '#16a34a', light: '#166534' },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    stops: ['#10b981', '#06b6d4', '#8b5cf6'],
    accent: { dark: '#0f7c99', light: '#0e7490' },
    hover: { dark: '#0891b2', light: '#155e75' },
  },
  {
    id: 'rose',
    name: 'Rose',
    stops: ['#f9a8d4', '#ec4899', '#be185d'],
    accent: { dark: '#db2777', light: '#be185d' },
    hover: { dark: '#ec4899', light: '#9d174d' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    stops: ['#cbd5e1', '#64748b', '#1e293b'],
    accent: { dark: '#64748b', light: '#475569' },
    hover: { dark: '#7c8aa0', light: '#334155' },
  },
];

/** The gradient with this id; unknown ids (an older or edited settings file) get the default. */
export function gradientTheme(id: string | null | undefined): GradientTheme {
  return GRADIENTS.find((g) => g.id === id) ?? GRADIENTS[0];
}

/** CSS background for a preview of the gradient. */
export function gradientCss(theme: GradientTheme, angle = 135): string {
  return `linear-gradient(${angle}deg, ${theme.stops.join(', ')})`;
}

/** Dark or light, following the system when the setting says so. */
export function resolveColorMode(setting: ColorMode | 'system'): ColorMode {
  if (setting !== 'system') return setting;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface Appearance {
  mode: ColorMode;
  theme: GradientTheme;
  accentMode: AccentMode;
  /** The active tool's own color when tools keep their colors (dialogs and menus render outside the tool). */
  toolColor: string | null;
}

/** Applies the appearance to the root element; canvases watch the data attributes to redraw. */
export function applyAppearance(root: HTMLElement, { mode, theme, accentMode, toolColor }: Appearance): void {
  root.dataset.theme = mode;
  root.dataset.gradient = theme.id;
  root.dataset.accent = accentMode;
  theme.stops.forEach((color, i) => root.style.setProperty(`--grad-${i + 1}`, color));
  root.style.setProperty('--accent', toolColor ?? theme.accent[mode]);
  root.style.setProperty('--accent-hover', toolColor ?? theme.hover[mode]);
}
