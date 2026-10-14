/** Color helpers. All channels: r,g,b 0-255, a 0-1, h 0-360, s/l/v 0-1. */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface HSV {
  h: number;
  s: number;
  v: number;
}
export interface HSL {
  h: number;
  s: number;
  l: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#?([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = parseInt(hex.slice(0, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return null;
    return { r: clamp255(parts[0]), g: clamp255(parts[1]), b: clamp255(parts[2]), a: parts[3] ?? 1 };
  }
  m = /^hsla?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map((p) => parseFloat(p));
    if (parts.length < 3) return null;
    const { r, g, b } = hslToRgb({ h: parts[0], s: parts[1] / 100, l: parts[2] / 100 });
    return { r, g, b, a: parts[3] ?? 1 };
  }
  return null;
}

export function toHex({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

export function toHex8(c: RGBA): string {
  const a = Math.round(Math.max(0, Math.min(1, c.a)) * 255);
  return toHex(c) + (a === 255 ? '' : a.toString(16).padStart(2, '0'));
}

export function toCss(c: RGBA): string {
  return c.a >= 1 ? toHex(c) : `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${+c.a.toFixed(3)})`;
}

export function rgbToHsv({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): { r: number; g: number; b: number } {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let rgb: [number, number, number] = [0, 0, 0];
  if (hh < 1) rgb = [c, x, 0];
  else if (hh < 2) rgb = [x, c, 0];
  else if (hh < 3) rgb = [0, c, x];
  else if (hh < 4) rgb = [0, x, c];
  else if (hh < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = v - c;
  return { r: clamp255((rgb[0] + m) * 255), g: clamp255((rgb[1] + m) * 255), b: clamp255((rgb[2] + m) * 255) };
}

export function rgbToHsl({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const v = l + c / 2;
  return hsvToRgb({ h, s: v ? c / v : 0, v });
}

/** WCAG relative luminance (0-1). */
export function luminance({ r, g, b }: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: Pick<RGBA, 'r' | 'g' | 'b'>, b: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever reads better on top of `bg`. */
export function readableTextColor(bg: string): string {
  const c = parseColor(bg);
  if (!c) return '#ffffff';
  return contrastRatio(c, { r: 0, g: 0, b: 0 }) >= contrastRatio(c, { r: 255, g: 255, b: 255 }) ? '#000000' : '#ffffff';
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return toCss({ ...c, a: alpha });
}

export function mixColors(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  return toCss({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
    a: ca.a + (cb.a - ca.a) * t,
  });
}

export const DEFAULT_SWATCHES = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759',
  '#00c7be', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#7c5cff', '#ec4899', '#0f172a',
];
