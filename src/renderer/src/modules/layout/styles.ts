import { contrastRatio, luminance, parseColor, rgbToHsl, toHex } from '../../core/utils/color';
import type { Gradient, LayoutDoc, ParagraphStyle, TextFrame, TextStyle } from './types';

/* ---------------------------------- Fonts --------------------------------- */

export const FONT_STACKS = {
  sans: "Inter, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  display: "'Arial Black', 'Helvetica Neue', Inter, Arial, sans-serif",
  elegant: "'Playfair Display', Didot, 'Bodoni 72', Georgia, 'Times New Roman', serif",
  mono: "'Courier New', 'DejaVu Sans Mono', monospace",
  condensed: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif",
} as const;

const GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];

/** First family of a CSS font-family list, unquoted ("'Arial Black', x" → "Arial Black"). */
export function primaryFont(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '') || 'sans-serif';
}

/** Quotes a family name for CSS when needed. */
export function quoteFont(name: string): string {
  const clean = name.replace(/["'\\;{}<>]/g, '').trim();
  if (!clean) return 'sans-serif';
  if (GENERIC.includes(clean.toLowerCase())) return clean.toLowerCase();
  return /^[a-zA-Z-]+$/.test(clean) ? clean : `'${clean}'`;
}

/**
 * Turns a font name chosen by the user (or the AI) into a safe CSS stack with a sensible
 * fallback, so a missing font never falls back to the browser default.
 */
export function fontStackFor(name: string): string {
  const family = primaryFont(name);
  const lower = family.toLowerCase();
  if (GENERIC.includes(lower)) return lower;
  const serifish = /(serif|georgia|times|garamond|playfair|didot|bodoni|baskerville|merriweather|lora|caslon|cambria|palatino|book)/.test(lower) && !/sans/.test(lower);
  const mono = /(mono|courier|code|consol)/.test(lower);
  const fallback = mono ? FONT_STACKS.mono : serifish ? FONT_STACKS.serif : FONT_STACKS.sans;
  return `${quoteFont(family)}, ${fallback}`;
}

/** Sanitizes a font-family list (no CSS injection). */
export function sanitizeFontStack(value: string): string {
  const parts = value
    .split(',')
    .map((p) => p.trim().replace(/^['"]|['"]$/g, '').replace(/["'\\;{}<>()]/g, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!parts.length) return FONT_STACKS.sans;
  return parts.map(quoteFont).join(', ');
}

/* --------------------------------- Colors --------------------------------- */

export const THEME_ROLES = ['Text', 'Background', 'Primary', 'Secondary', 'Neutral', 'Highlight'];

export const DEFAULT_SWATCHES = ['#1d1d2c', '#ffffff', '#ff3d71', '#5b5bd6', '#8a8fa3', '#ffc53d'];

export const THEME_PRESETS: { name: string; colors: string[] }[] = [
  { name: 'Ultima', colors: DEFAULT_SWATCHES },
  { name: 'Ocean', colors: ['#0b2545', '#f4f9fc', '#1b98e0', '#13315c', '#8da9c4', '#5ce1e6'] },
  { name: 'Sunset', colors: ['#2b1d2f', '#fff7ef', '#ff6b35', '#c81d6a', '#a38a92', '#ffc857'] },
  { name: 'Forest', colors: ['#1b2d24', '#f6f4ec', '#2f855a', '#7b5e3b', '#9aa58f', '#e3b23c'] },
  { name: 'Coffee', colors: ['#2e1f18', '#fbf5ee', '#b5651d', '#6f4e37', '#a89585', '#e8c39e'] },
  { name: 'Royal', colors: ['#1a1440', '#faf8ff', '#6d28d9', '#c9a227', '#8e88a8', '#f0d98c'] },
  { name: 'Candy', colors: ['#3b1c32', '#fff5fa', '#ff4f9a', '#7b61ff', '#b39bb1', '#ffd23f'] },
  { name: 'Citrus', colors: ['#1f2a1a', '#fffdf2', '#f59e0b', '#16a34a', '#9ca38a', '#fde047'] },
  { name: 'Midnight', colors: ['#f1f5f9', '#0f172a', '#38bdf8', '#a78bfa', '#64748b', '#f472b6'] },
  { name: 'Mono', colors: ['#111111', '#ffffff', '#333333', '#777777', '#aaaaaa', '#e5e5e5'] },
];

const REF = /^\$(\d)$/;

export function isThemeRef(value: string): boolean {
  return REF.test(value.trim());
}

/** Resolves "$n" theme references; '' stays '' (no paint). Invalid colors → fallback. */
export function resolveColor(value: string | undefined | null, swatches: string[], fallback = 'transparent'): string {
  if (!value) return fallback;
  const m = REF.exec(value.trim());
  if (m) return swatches[Number(m[1])] ?? fallback;
  return value;
}

/** Validates a color value from untrusted input ("$n" refs allowed). */
export function cleanColor(value: unknown, fallback: string, allowEmpty = false): string {
  if (typeof value !== 'string') return fallback;
  const s = value.trim();
  if (!s) return allowEmpty ? '' : fallback;
  if (REF.test(s)) return s;
  if (s.toLowerCase() === 'transparent' || s.toLowerCase() === 'none') return allowEmpty ? '' : fallback;
  const c = parseColor(s);
  if (!c) return fallback;
  return c.a >= 1 ? toHex(c) : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}

export function gradientCss(g: Gradient, swatches: string[]): string {
  const stops = [...g.stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${resolveColor(s.color, swatches, '#000000')} ${Math.round(s.pos * 1000) / 10}%`)
    .join(', ');
  return g.kind === 'radial' ? `radial-gradient(circle at 50% 50%, ${stops})` : `linear-gradient(${Math.round(g.angle * 10) / 10}deg, ${stops})`;
}

/**
 * Maps an arbitrary palette (e.g. from Color Studio) to theme roles: darkest → text,
 * lightest → background, the most colorful remaining colors → accents.
 */
export function paletteToTheme(colors: string[], current: string[] = DEFAULT_SWATCHES): string[] {
  const parsed = colors
    .map((c) => parseColor(c))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ hex: toHex(c), lum: luminance(c), sat: rgbToHsl(c).s }));
  const unique = parsed.filter((c, i) => parsed.findIndex((o) => o.hex === c.hex) === i);
  if (!unique.length) return [...current];
  const byLum = [...unique].sort((a, b) => a.lum - b.lum);
  let dark = byLum[0];
  let light = byLum[byLum.length - 1];
  const rest = unique.filter((c) => c !== dark && c !== light).sort((a, b) => b.sat - a.sat);
  let darkHex = dark.hex;
  let lightHex = light.hex;
  // make sure text on background stays readable
  const parse = (h: string) => parseColor(h)!;
  if (unique.length === 1 || contrastRatio(parse(darkHex), parse(lightHex)) < 4.5) {
    if (luminance(parse(darkHex)) > 0.18) darkHex = '#111111';
    if (luminance(parse(lightHex)) < 0.6) lightHex = '#ffffff';
    if (contrastRatio(parse(darkHex), parse(lightHex)) < 4.5) {
      darkHex = '#111111';
      lightHex = '#ffffff';
    }
  }
  dark = { ...dark, hex: darkHex };
  light = { ...light, hex: lightHex };
  const accents = rest.map((c) => c.hex);
  const fallbackAccents = unique.map((c) => c.hex);
  const out = [dark.hex, light.hex];
  for (let i = 2; i < Math.max(6, current.length); i++) {
    out.push(accents[i - 2] ?? fallbackAccents[(i - 2) % fallbackAccents.length] ?? current[i] ?? '#888888');
  }
  return out;
}

/* ------------------------------- Text styles ------------------------------- */

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: FONT_STACKS.sans,
  fontSize: 16,
  fontWeight: 400,
  italic: false,
  underline: false,
  uppercase: false,
  color: '$0',
  align: 'left',
  lineHeight: 1.35,
  letterSpacing: 0,
  spaceAfter: 0,
};

const style = (patch: Partial<TextStyle>): TextStyle => ({ ...DEFAULT_TEXT_STYLE, ...patch });

/** Built-in paragraph styles. `scale` adapts sizes to the page (2 for social posts…). */
export function defaultParagraphStyles(scale = 1): ParagraphStyle[] {
  const s = (n: number) => Math.round(n * scale * 10) / 10;
  return [
    { id: 'title', name: 'Title', style: style({ fontSize: s(48), fontWeight: 800, lineHeight: 1.08, letterSpacing: -10 }) },
    { id: 'subtitle', name: 'Subtitle', style: style({ fontSize: s(22), fontWeight: 400, lineHeight: 1.3, color: '$4' }) },
    { id: 'h1', name: 'Heading 1', style: style({ fontSize: s(32), fontWeight: 700, lineHeight: 1.15, spaceAfter: s(8) }) },
    { id: 'h2', name: 'Heading 2', style: style({ fontSize: s(22), fontWeight: 600, lineHeight: 1.25, spaceAfter: s(6) }) },
    { id: 'body', name: 'Body', style: style({ fontSize: s(15), lineHeight: 1.5, spaceAfter: s(8) }) },
    { id: 'caption', name: 'Caption', style: style({ fontSize: s(12), italic: true, lineHeight: 1.35, color: '$4' }) },
    { id: 'quote', name: 'Quote', style: style({ fontFamily: FONT_STACKS.serif, fontSize: s(22), italic: true, lineHeight: 1.4, color: '$2' }) },
    { id: 'label', name: 'Label', style: style({ fontSize: s(12), fontWeight: 700, uppercase: true, letterSpacing: 120, color: '$2' }) },
  ];
}

/** Effective style of a text frame: defaults ← paragraph style ← local overrides. */
export function resolveTextStyle(frame: Pick<TextFrame, 'styleId' | 'overrides'>, styles: ParagraphStyle[]): TextStyle {
  const base = frame.styleId ? styles.find((s) => s.id === frame.styleId)?.style : undefined;
  return { ...DEFAULT_TEXT_STYLE, ...(base ?? {}), ...frame.overrides };
}

export function styleName(doc: LayoutDoc, styleId: string | null): string {
  if (!styleId) return '';
  return doc.styles.find((s) => s.id === styleId)?.name ?? '';
}

/** Keys of TextStyle (for validation / diffing). */
export const TEXT_STYLE_KEYS: (keyof TextStyle)[] = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
  'underline',
  'uppercase',
  'color',
  'align',
  'lineHeight',
  'letterSpacing',
  'spaceAfter',
];

/** Removes overrides that equal the paragraph style value. */
export function pruneOverrides(overrides: Partial<TextStyle>, base: TextStyle): Partial<TextStyle> {
  const out: Partial<TextStyle> = {};
  for (const key of TEXT_STYLE_KEYS) {
    const v = overrides[key];
    if (v !== undefined && v !== base[key]) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** Replaces {page} and {pages} tokens. */
export function substituteTokens(text: string, page: string, pages: string): string {
  if (!text.includes('{')) return text;
  return text.replace(/\{page\}/gi, page).replace(/\{pages\}/gi, pages);
}
