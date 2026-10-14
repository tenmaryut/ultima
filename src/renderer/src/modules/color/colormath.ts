/**
 * Color math for Color Studio. Pure functions, no DOM.
 *
 * Conventions: RGB channels are 0–255 (floats allowed internally, rounded when formatted),
 * hue 0–360, saturation/value/lightness 0–1, CMYK 0–1, CIE Lab with a D50 white point
 * (the same Lab that Photoshop and CSS `lab()` use; sRGB D65 is adapted with Bradford).
 */
import { parseColor } from '../../core/utils/color';

export interface RGB {
  r: number;
  g: number;
  b: number;
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
export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}
export interface LAB {
  l: number;
  a: number;
  b: number;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp255 = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : x);

export function normHue(h: number): number {
  if (!Number.isFinite(h)) return 0;
  const r = h % 360;
  return r < 0 ? r + 360 : r;
}

/* ---------------------------------- Hex ---------------------------------- */

export function parseHex(input: string): RGB | null {
  const m = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(input);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex(rgb: RGB): string {
  return '#' + [rgb.r, rgb.g, rgb.b].map((v) => Math.round(clamp255(v)).toString(16).padStart(2, '0')).join('');
}

/** Any CSS-ish color (#rgb, #rrggbb, rgb(), hsl(), bare hex) → '#rrggbb' or null. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const direct = parseHex(input);
  if (direct) return toHex(direct);
  const parsed = parseColor(input);
  return parsed ? toHex(parsed) : null;
}

export function hexToRgb(hex: string): RGB {
  return parseHex(hex) ?? { r: 0, g: 0, b: 0 };
}

/* ------------------------------- HSV / HSL ------------------------------- */

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = clamp255(r) / 255;
  const gn = clamp255(g) / 255;
  const bn = clamp255(b) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-12) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = normHue(h * 60);
  }
  return { h, s: max > 0 ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const ss = clamp01(s);
  const vv = clamp01(v);
  const c = vv * ss;
  const hh = normHue(h) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let rgb: [number, number, number];
  if (hh < 1) rgb = [c, x, 0];
  else if (hh < 2) rgb = [x, c, 0];
  else if (hh < 3) rgb = [0, c, x];
  else if (hh < 4) rgb = [0, x, c];
  else if (hh < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = vv - c;
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

export function rgbToHsl(rgb: RGB): HSL {
  const { h, v } = rgbToHsv(rgb);
  const min = Math.min(clamp255(rgb.r), clamp255(rgb.g), clamp255(rgb.b)) / 255;
  const l = (v + min) / 2;
  const d = v - min;
  const s = d < 1e-12 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: clamp01(s), l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const ll = clamp01(l);
  const c = (1 - Math.abs(2 * ll - 1)) * clamp01(s);
  const v = ll + c / 2;
  return hsvToRgb({ h, s: v > 0 ? c / v : 0, v });
}

/* ---------------------------------- CMYK --------------------------------- */

/** Naive (device independent, uncalibrated) RGB → CMYK, like most web color tools. */
export function rgbToCmyk({ r, g, b }: RGB): CMYK {
  const rn = clamp255(r) / 255;
  const gn = clamp255(g) / 255;
  const bn = clamp255(b) / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1 - 1e-12) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (1 - rn - k) / (1 - k), m: (1 - gn - k) / (1 - k), y: (1 - bn - k) / (1 - k), k };
}

export function cmykToRgb({ c, m, y, k }: CMYK): RGB {
  const kk = clamp01(k);
  return { r: 255 * (1 - clamp01(c)) * (1 - kk), g: 255 * (1 - clamp01(m)) * (1 - kk), b: 255 * (1 - clamp01(y)) * (1 - kk) };
}

/* ----------------------------------- Lab ---------------------------------- */

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(c: number): number {
  const sign = c < 0 ? -1 : 1;
  const a = Math.abs(c);
  return a <= 0.0031308 ? c * 12.92 : sign * (1.055 * a ** (1 / 2.4) - 0.055);
}

type M3 = readonly [number, number, number, number, number, number, number, number, number];

/** Exact inverse of a 3×3 matrix (so conversions round-trip without drift). */
function invert(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

const RGB_TO_XYZ: M3 = [
  0.41239079926595934, 0.357584339383878, 0.1804807884018343,
  0.21263900587151027, 0.715168678767756, 0.07219231536073371,
  0.01933081871559182, 0.11919477979462598, 0.9505321522496607,
];
const XYZ_TO_RGB: M3 = invert(RGB_TO_XYZ);
const D65_TO_D50: M3 = [
  1.0479298208405488, 0.022946793341019088, -0.05019222954313557,
  0.029627815688159344, 0.990434484573249, -0.01707382502938514,
  -0.009243058152591178, 0.015055144896577895, 0.7518742899580008,
];
const D50_TO_D65: M3 = invert(D65_TO_D50);
const D50_WHITE = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585] as const;
const LAB_E = 216 / 24389;
const LAB_K = 24389 / 27;

function mul(m: M3, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** Combined linear sRGB → XYZ(D50) matrix, used by the fast per-pixel path. */
const RGB_TO_XYZ50: M3 = (() => {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += D65_TO_D50[row * 3 + k] * RGB_TO_XYZ[k * 3 + col];
      out.push(sum);
    }
  }
  return out as unknown as M3;
})();

const labF = (t: number) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116);

export function linearRgbToLab(r: number, g: number, b: number): LAB {
  const [x, y, z] = mul(RGB_TO_XYZ50, r, g, b);
  const fx = labF(x / D50_WHITE[0]);
  const fy = labF(y / D50_WHITE[1]);
  const fz = labF(z / D50_WHITE[2]);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function rgbToLab({ r, g, b }: RGB): LAB {
  return linearRgbToLab(srgbToLinear(clamp255(r) / 255), srgbToLinear(clamp255(g) / 255), srgbToLinear(clamp255(b) / 255));
}

/** Lab (D50) → sRGB 0–255, unclamped (check `inGamut`). */
export function labToRgbUnclamped({ l, a, b }: LAB): RGB {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = (fx ** 3 > LAB_E ? fx ** 3 : (116 * fx - 16) / LAB_K) * D50_WHITE[0];
  const y = (l > LAB_K * LAB_E ? fy ** 3 : l / LAB_K) * D50_WHITE[1];
  const z = (fz ** 3 > LAB_E ? fz ** 3 : (116 * fz - 16) / LAB_K) * D50_WHITE[2];
  const [x65, y65, z65] = mul(D50_TO_D65, x, y, z);
  const [lr, lg, lb] = mul(XYZ_TO_RGB, x65, y65, z65);
  return { r: linearToSrgb(lr) * 255, g: linearToSrgb(lg) * 255, b: linearToSrgb(lb) * 255 };
}

export function labToRgb(lab: LAB): RGB {
  const c = labToRgbUnclamped(lab);
  return { r: clamp255(c.r), g: clamp255(c.g), b: clamp255(c.b) };
}

export function inGamut(rgb: RGB, tolerance = 0.5): boolean {
  return [rgb.r, rgb.g, rgb.b].every((v) => v >= -tolerance && v <= 255 + tolerance);
}

export function labChroma(lab: LAB): number {
  return Math.hypot(lab.a, lab.b);
}

export function labHue(lab: LAB): number {
  return normHue((Math.atan2(lab.b, lab.a) * 180) / Math.PI);
}

/** CIE76 color difference. */
export function deltaE(a: LAB, b: LAB): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

export function hexToLab(hex: string): LAB {
  return rgbToLab(hexToRgb(hex));
}

/* -------------------------------- Formatting -------------------------------- */

export type ColorFormat = 'hex' | 'rgb' | 'hsb' | 'hsl' | 'cmyk' | 'lab';

export const COLOR_FORMATS: { id: ColorFormat; label: string }[] = [
  { id: 'hex', label: 'HEX' },
  { id: 'rgb', label: 'RGB' },
  { id: 'hsb', label: 'HSB' },
  { id: 'hsl', label: 'HSL' },
  { id: 'cmyk', label: 'CMYK' },
  { id: 'lab', label: 'LAB' },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const deg = (x: number) => `${Math.round(normHue(x)) % 360}°`;
const fixed = (x: number, d = 2) => {
  const v = Number(x.toFixed(d));
  return String(Object.is(v, -0) ? 0 : v);
};

/** Human readable value, as shown in the swatch value fields. */
export function formatColor(hex: string, format: ColorFormat): string {
  const rgb = hexToRgb(hex);
  switch (format) {
    case 'hex':
      return toHex(rgb).toUpperCase();
    case 'rgb':
      return `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`;
    case 'hsb': {
      const c = rgbToHsv(rgb);
      return `${deg(c.h)}, ${pct(c.s)}, ${pct(c.v)}`;
    }
    case 'hsl': {
      const c = rgbToHsl(rgb);
      return `${deg(c.h)}, ${pct(c.s)}, ${pct(c.l)}`;
    }
    case 'cmyk': {
      const c = rgbToCmyk(rgb);
      return `${pct(c.c)}, ${pct(c.m)}, ${pct(c.y)}, ${pct(c.k)}`;
    }
    case 'lab': {
      const c = rgbToLab(rgb);
      return `${fixed(c.l)}, ${fixed(c.a)}, ${fixed(c.b)}`;
    }
  }
}

/** CSS syntax of a color in the given model (used for "copy as CSS"). */
export function formatCss(hex: string, format: ColorFormat): string {
  const rgb = hexToRgb(hex);
  switch (format) {
    case 'hex':
      return toHex(rgb);
    case 'rgb':
      return `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)})`;
    case 'hsl': {
      const c = rgbToHsl(rgb);
      return `hsl(${Math.round(c.h) % 360} ${Math.round(c.s * 100)}% ${Math.round(c.l * 100)}%)`;
    }
    case 'lab': {
      const c = rgbToLab(rgb);
      return `lab(${fixed(c.l)}% ${fixed(c.a)} ${fixed(c.b)})`;
    }
    default:
      return formatColor(hex, format);
  }
}

/** Parses a value typed into one of the format fields. Returns null when invalid. */
export function parseColorValue(text: string, format: ColorFormat): RGB | null {
  if (format === 'hex') {
    const hex = normalizeHex(text);
    return hex ? hexToRgb(hex) : null;
  }
  const nums = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  switch (format) {
    case 'rgb':
      if (nums.length < 3 || !nums.slice(0, 3).every((v) => inRange(v, 0, 255))) return null;
      return { r: nums[0], g: nums[1], b: nums[2] };
    case 'hsb':
      if (nums.length < 3 || !inRange(nums[0], 0, 360) || !inRange(nums[1], 0, 100) || !inRange(nums[2], 0, 100)) return null;
      return hsvToRgb({ h: nums[0], s: nums[1] / 100, v: nums[2] / 100 });
    case 'hsl':
      if (nums.length < 3 || !inRange(nums[0], 0, 360) || !inRange(nums[1], 0, 100) || !inRange(nums[2], 0, 100)) return null;
      return hslToRgb({ h: nums[0], s: nums[1] / 100, l: nums[2] / 100 });
    case 'cmyk':
      if (nums.length < 4 || !nums.slice(0, 4).every((v) => inRange(v, 0, 100))) return null;
      return cmykToRgb({ c: nums[0] / 100, m: nums[1] / 100, y: nums[2] / 100, k: nums[3] / 100 });
    case 'lab':
      if (nums.length < 3 || !inRange(nums[0], 0, 100) || !inRange(nums[1], -160, 160) || !inRange(nums[2], -160, 160)) return null;
      return labToRgb({ l: nums[0], a: nums[1], b: nums[2] });
  }
}

/** Perceived lightness (Lab L, 0–100) of a hex color. */
export function lightness(hex: string): number {
  return hexToLab(hex).l;
}

/** Black or white text, whichever has the higher WCAG contrast on `hex`. */
export function textOn(hex: string): '#000000' | '#ffffff' {
  const { r, g, b } = hexToRgb(hex);
  const lum = 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#000000' : '#ffffff';
}
