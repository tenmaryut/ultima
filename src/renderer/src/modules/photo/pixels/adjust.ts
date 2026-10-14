/**
 * Color adjustments as pure functions on RGBA pixel buffers (non-premultiplied, the layout of
 * ImageData). They modify `data` in place and never touch the alpha channel.
 */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function identityLut(): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  return lut;
}

export function lutFromFn(fn: (v: number) => number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(clamp255(fn(i)));
  return lut;
}

/** lut2(lut1(v)) */
export function composeLuts(first: Uint8Array, second: Uint8Array): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = second[first[i]];
  return lut;
}

export function applyLuts(data: Uint8ClampedArray, lr: Uint8Array, lg: Uint8Array = lr, lb: Uint8Array = lr): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lr[data[i]];
    data[i + 1] = lg[data[i + 1]];
    data[i + 2] = lb[data[i + 2]];
  }
}

/* ------------------------------- HSL helpers ------------------------------- */

const hslTmp = [0, 0, 0];

/** r,g,b 0..1 → [h 0..360, s 0..1, l 0..1] written into `out`. */
export function rgbToHsl(r: number, g: number, b: number, out: number[] = hslTmp): number[] {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d > 1e-9) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  out[0] = h;
  out[1] = s;
  out[2] = l;
  return out;
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** h 0..360, s/l 0..1 → [r, g, b] 0..1 */
export function hslToRgb(h: number, s: number, l: number, out: number[] = [0, 0, 0]): number[] {
  if (s <= 0) {
    out[0] = out[1] = out[2] = l;
    return out;
  }
  const hh = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[0] = hue2rgb(p, q, hh + 1 / 3);
  out[1] = hue2rgb(p, q, hh);
  out[2] = hue2rgb(p, q, hh - 1 / 3);
  return out;
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  let v = m[1];
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* --------------------------- Brightness / Contrast --------------------------- */

export interface BrightnessContrastParams {
  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;
}

export function brightnessContrastLut(p: BrightnessContrastParams): Uint8Array {
  const b = clamp(p.brightness, -100, 100) / 100;
  const c = clamp(p.contrast, -100, 100) * 1.28;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  return lutFromFn((v) => {
    const n = v / 255;
    let o = b >= 0 ? v + b * 102 * (1 - n * n) : v + b * 102 * (1 - (1 - n) * (1 - n));
    o = f * (o - 128) + 128;
    return o;
  });
}

export function brightnessContrast(data: Uint8ClampedArray, p: BrightnessContrastParams): void {
  applyLuts(data, brightnessContrastLut(p));
}

/* ---------------------------------- Levels ---------------------------------- */

export interface LevelsChannel {
  inBlack: number;
  inWhite: number;
  /** 0.1..9.99, > 1 brightens the midtones */
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export interface LevelsParams {
  rgb: LevelsChannel;
  r: LevelsChannel;
  g: LevelsChannel;
  b: LevelsChannel;
}

export const DEFAULT_LEVELS_CHANNEL: LevelsChannel = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

export function defaultLevels(): LevelsParams {
  return { rgb: { ...DEFAULT_LEVELS_CHANNEL }, r: { ...DEFAULT_LEVELS_CHANNEL }, g: { ...DEFAULT_LEVELS_CHANNEL }, b: { ...DEFAULT_LEVELS_CHANNEL } };
}

export function levelsLut(ch: LevelsChannel): Uint8Array {
  const inB = clamp(ch.inBlack, 0, 254);
  const inW = Math.max(inB + 1, clamp(ch.inWhite, 1, 255));
  const gamma = clamp(ch.gamma, 0.1, 9.99);
  const outB = clamp(ch.outBlack, 0, 255);
  const outW = clamp(ch.outWhite, 0, 255);
  return lutFromFn((v) => {
    const x = clamp01((v - inB) / (inW - inB));
    return outB + Math.pow(x, 1 / gamma) * (outW - outB);
  });
}

export function levels(data: Uint8ClampedArray, p: LevelsParams): void {
  const rgb = levelsLut(p.rgb);
  applyLuts(data, composeLuts(levelsLut(p.r), rgb), composeLuts(levelsLut(p.g), rgb), composeLuts(levelsLut(p.b), rgb));
}

/* ---------------------------------- Curves ---------------------------------- */

export type CurvePoint = [number, number];

export interface CurvesParams {
  rgb: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
}

export function defaultCurves(): CurvesParams {
  const line = (): CurvePoint[] => [
    [0, 0],
    [255, 255],
  ];
  return { rgb: line(), r: line(), g: line(), b: line() };
}

/** Monotone cubic (Fritsch–Carlson) interpolation through the points → 256 entry LUT. */
export function curveLut(points: CurvePoint[]): Uint8Array {
  const pts = [...points]
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p): CurvePoint => [clamp(p[0], 0, 255), clamp(p[1], 0, 255)])
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0]);
  if (pts.length === 0) return identityLut();
  if (pts.length === 1) return lutFromFn(() => pts[0][1]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    slope.push((ys[i + 1] - ys[i]) / dx[i]);
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  return lutFromFn((v) => {
    if (v <= xs[0]) return ys[0];
    if (v >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && v > xs[i + 1]) i++;
    const h = dx[i];
    const t = (v - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  });
}

export function curves(data: Uint8ClampedArray, p: CurvesParams): void {
  const rgb = curveLut(p.rgb);
  applyLuts(data, composeLuts(curveLut(p.r), rgb), composeLuts(curveLut(p.g), rgb), composeLuts(curveLut(p.b), rgb));
}

/* ----------------------------- Hue / Saturation ----------------------------- */

export interface HueSatParams {
  /** -180..180 (colorize: 0..360) */
  hue: number;
  /** -100..100 (colorize: 0..100) */
  saturation: number;
  /** -100..100 */
  lightness: number;
  colorize: boolean;
}

export function hueSaturation(data: Uint8ClampedArray, p: HueSatParams): void {
  const L = clamp(p.lightness, -100, 100) / 100;
  const rgb = [0, 0, 0];
  const hsl = [0, 0, 0];
  if (p.colorize) {
    const hue = clamp(p.hue, -360, 360);
    const sat = clamp(Math.abs(p.saturation), 0, 100) / 100;
    for (let i = 0; i < data.length; i += 4) {
      const l = luma(data[i], data[i + 1], data[i + 2]) / 255;
      hslToRgb(hue, sat, l, rgb);
      writeLight(data, i, rgb, L);
    }
    return;
  }
  const dh = clamp(p.hue, -180, 180);
  const S = clamp(p.saturation, -100, 100) / 100;
  if (!dh && !S && !L) return;
  for (let i = 0; i < data.length; i += 4) {
    rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, hsl);
    let s = hsl[1];
    s = S < 0 ? s * (1 + S) : Math.min(1, s * (1 + S * 1.5));
    hslToRgb(hsl[0] + dh, s, hsl[2], rgb);
    writeLight(data, i, rgb, L);
  }
}

function writeLight(data: Uint8ClampedArray, i: number, rgb: number[], L: number): void {
  for (let c = 0; c < 3; c++) {
    let v = rgb[c];
    if (L > 0) v = v + (1 - v) * L;
    else if (L < 0) v = v * (1 + L);
    data[i + c] = Math.round(v * 255);
  }
}

/* ------------------------------- Color balance ------------------------------- */

/** Each triple: [cyan↔red, magenta↔green, yellow↔blue], -100..100. */
export interface ColorBalanceParams {
  shadows: [number, number, number];
  midtones: [number, number, number];
  highlights: [number, number, number];
  preserveLuminosity: boolean;
}

function cbMap(value: number, l: number, sh: number, mid: number, hi: number): number {
  const a = 0.25;
  const b = 0.333;
  const scale = 0.7;
  const s = sh * clamp01((l - b) / -a + 0.5) * scale;
  const m = mid * clamp01((l - b) / a + 0.5) * clamp01((l + b - 1) / -a + 0.5) * scale;
  const h = hi * clamp01((l + b - 1) / a + 0.5) * scale;
  return clamp01(value + s + m + h);
}

export function colorBalance(data: Uint8ClampedArray, p: ColorBalanceParams): void {
  const sh = p.shadows.map((v) => clamp(v, -100, 100) / 100);
  const mi = p.midtones.map((v) => clamp(v, -100, 100) / 100);
  const hi = p.highlights.map((v) => clamp(v, -100, 100) / 100);
  if ([...sh, ...mi, ...hi].every((v) => v === 0)) return;
  const hsl = [0, 0, 0];
  const rgb = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const l = rgbToHsl(r, g, b, hsl)[2];
    let rn = cbMap(r, l, sh[0], mi[0], hi[0]);
    let gn = cbMap(g, l, sh[1], mi[1], hi[1]);
    let bn = cbMap(b, l, sh[2], mi[2], hi[2]);
    if (p.preserveLuminosity) {
      rgbToHsl(rn, gn, bn, hsl);
      hslToRgb(hsl[0], hsl[1], l, rgb);
      rn = rgb[0];
      gn = rgb[1];
      bn = rgb[2];
    }
    data[i] = Math.round(rn * 255);
    data[i + 1] = Math.round(gn * 255);
    data[i + 2] = Math.round(bn * 255);
  }
}

/* --------------------------------- Vibrance --------------------------------- */

export interface VibranceParams {
  /** -100..100: boosts muted colors more than already saturated ones */
  vibrance: number;
  /** -100..100 */
  saturation: number;
}

export function vibrance(data: Uint8ClampedArray, p: VibranceParams): void {
  const V = clamp(p.vibrance, -100, 100) / 100;
  const S = clamp(p.saturation, -100, 100) / 100;
  if (!V && !S) return;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    const k = 1 + S + V * (1 - sat) * (V > 0 ? 1.2 : 1);
    const l = luma(r, g, b);
    data[i] = l + (r - l) * k;
    data[i + 1] = l + (g - l) * k;
    data[i + 2] = l + (b - l) * k;
  }
}

/* --------------------------------- Exposure --------------------------------- */

export interface ExposureParams {
  /** stops, -5..5 */
  exposure: number;
  /** -0.5..0.5 (linear) */
  offset: number;
  /** 0.1..9.99 */
  gamma: number;
}

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function exposureLut(p: ExposureParams): Uint8Array {
  const gain = Math.pow(2, clamp(p.exposure, -10, 10));
  const offset = clamp(p.offset, -1, 1);
  const gamma = clamp(p.gamma, 0.1, 9.99);
  return lutFromFn((v) => {
    let lin = srgbToLinear(v / 255) * gain + offset;
    lin = Math.max(0, lin);
    lin = Math.pow(lin, 1 / gamma);
    return linearToSrgb(Math.min(1, lin)) * 255;
  });
}

export function exposure(data: Uint8ClampedArray, p: ExposureParams): void {
  applyLuts(data, exposureLut(p));
}

/* ------------------------------ Black & White ------------------------------ */

export interface BlackWhiteParams {
  /** Percent weights (-200..300). Photoshop defaults: 40, 60, 40, 60, 20, 80 */
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
  tint: boolean;
  tintHue: number;
  tintSaturation: number;
}

export const DEFAULT_BLACK_WHITE: BlackWhiteParams = {
  reds: 40,
  yellows: 60,
  greens: 40,
  cyans: 60,
  blues: 20,
  magentas: 80,
  tint: false,
  tintHue: 35,
  tintSaturation: 25,
};

/** Gray value of one pixel with the Photoshop-style hue weighted mixer. */
export function blackWhiteGray(r: number, g: number, b: number, p: BlackWhiteParams): number {
  const W = [p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas].map((v) => clamp(v, -200, 300) / 100);
  let max: number;
  let mid: number;
  let min: number;
  let primary: number; // 0 R, 2 G, 4 B
  let secondary: number; // 1 Y, 3 C, 5 M
  if (r >= g && r >= b) {
    primary = 0;
    max = r;
    if (g >= b) {
      mid = g;
      min = b;
      secondary = 1;
    } else {
      mid = b;
      min = g;
      secondary = 5;
    }
  } else if (g >= r && g >= b) {
    primary = 2;
    max = g;
    if (r >= b) {
      mid = r;
      min = b;
      secondary = 1;
    } else {
      mid = b;
      min = r;
      secondary = 3;
    }
  } else {
    primary = 4;
    max = b;
    if (g >= r) {
      mid = g;
      min = r;
      secondary = 3;
    } else {
      mid = r;
      min = g;
      secondary = 5;
    }
  }
  return clamp255(min + (max - mid) * W[primary] + (mid - min) * W[secondary]);
}

export function blackWhite(data: Uint8ClampedArray, p: BlackWhiteParams): void {
  const rgb = [0, 0, 0];
  const sat = clamp(p.tintSaturation, 0, 100) / 100;
  for (let i = 0; i < data.length; i += 4) {
    const gray = blackWhiteGray(data[i], data[i + 1], data[i + 2], p);
    if (p.tint && sat > 0) {
      hslToRgb(p.tintHue, sat, gray / 255, rgb);
      data[i] = Math.round(rgb[0] * 255);
      data[i + 1] = Math.round(rgb[1] * 255);
      data[i + 2] = Math.round(rgb[2] * 255);
    } else {
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
  }
}

/* ------------------------------- Photo filter ------------------------------- */

export interface PhotoFilterParams {
  color: string;
  /** 0..100 */
  density: number;
  preserveLuminosity: boolean;
}

export const PHOTO_FILTER_PRESETS: { id: string; label: string; color: string }[] = [
  { id: 'warm85', label: 'Warming Filter (85)', color: '#ec8a00' },
  { id: 'warmLBA', label: 'Warming Filter (LBA)', color: '#fa9600' },
  { id: 'warm81', label: 'Warming Filter (81)', color: '#ebb113' },
  { id: 'cool80', label: 'Cooling Filter (80)', color: '#006dff' },
  { id: 'coolLBB', label: 'Cooling Filter (LBB)', color: '#005dff' },
  { id: 'cool82', label: 'Cooling Filter (82)', color: '#00b5ff' },
  { id: 'sepia', label: 'Sepia', color: '#ac7a33' },
  { id: 'green', label: 'Green', color: '#19c919' },
];

export function photoFilter(data: Uint8ClampedArray, p: PhotoFilterParams): void {
  const [fr, fg, fb] = parseHex(p.color);
  const d = clamp(p.density, 0, 100) / 100;
  if (!d) return;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let tr = (r * fr) / 255;
    let tg = (g * fg) / 255;
    let tb = (b * fb) / 255;
    if (p.preserveLuminosity) {
      const l0 = luma(r, g, b);
      const l1 = luma(tr, tg, tb);
      if (l1 > 0.5) {
        const k = l0 / l1;
        tr *= k;
        tg *= k;
        tb *= k;
      } else {
        tr = tg = tb = l0;
      }
    }
    data[i] = r + (tr - r) * d;
    data[i + 1] = g + (tg - g) * d;
    data[i + 2] = b + (tb - b) * d;
  }
}

/* ------------------------------ Simple ones ------------------------------ */

export function invert(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

export function desaturate(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const l = luma(data[i], data[i + 1], data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = l;
  }
}

/** Pixels with luminance >= level become white, the rest black. */
export function threshold(data: Uint8ClampedArray, level: number): void {
  const t = clamp(level, 1, 255);
  for (let i = 0; i < data.length; i += 4) {
    const v = luma(data[i], data[i + 1], data[i + 2]) >= t ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

export function posterizeLut(levelsCount: number): Uint8Array {
  const n = Math.round(clamp(levelsCount, 2, 255));
  return lutFromFn((v) => (Math.round((v / 255) * (n - 1)) * 255) / (n - 1));
}

export function posterize(data: Uint8ClampedArray, levelsCount: number): void {
  applyLuts(data, posterizeLut(levelsCount));
}

export function sepia(data: Uint8ClampedArray, amount = 1): void {
  const a = clamp01(amount);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = r + (Math.min(255, r * 0.393 + g * 0.769 + b * 0.189) - r) * a;
    data[i + 1] = g + (Math.min(255, r * 0.349 + g * 0.686 + b * 0.168) - g) * a;
    data[i + 2] = b + (Math.min(255, r * 0.272 + g * 0.534 + b * 0.131) - b) * a;
  }
}

/* ------------------------- Combined "basic" adjust (AI) ------------------------- */

export interface BasicAdjustParams {
  /** -100..100 */
  brightness?: number;
  /** -100..100 */
  contrast?: number;
  /** -100..100 */
  saturation?: number;
  /** stops -3..3 */
  exposure?: number;
  /** -100 (cool/blue) .. 100 (warm/yellow) */
  temperature?: number;
  /** -100 (green) .. 100 (magenta) */
  tint?: number;
  /** -100..100 */
  vibrance?: number;
  /** degrees -180..180 */
  hue?: number;
}

export function basicAdjust(data: Uint8ClampedArray, p: BasicAdjustParams): void {
  const ex = clamp(p.exposure ?? 0, -5, 5);
  const temp = clamp(p.temperature ?? 0, -100, 100) / 100;
  const tint = clamp(p.tint ?? 0, -100, 100) / 100;
  let lr = ex ? exposureLut({ exposure: ex, offset: 0, gamma: 1 }) : identityLut();
  if (p.brightness || p.contrast) lr = composeLuts(lr, brightnessContrastLut({ brightness: p.brightness ?? 0, contrast: p.contrast ?? 0 }));
  if (temp || tint) {
    const rShift = temp * 28 + tint * 10;
    const gShift = -tint * 22;
    const bShift = -temp * 28 + tint * 10;
    applyLuts(
      data,
      composeLuts(lr, lutFromFn((v) => v + rShift * (1 - Math.abs(v / 127.5 - 1) * 0.5))),
      composeLuts(lr, lutFromFn((v) => v + gShift * (1 - Math.abs(v / 127.5 - 1) * 0.5))),
      composeLuts(lr, lutFromFn((v) => v + bShift * (1 - Math.abs(v / 127.5 - 1) * 0.5))),
    );
  } else if (ex || p.brightness || p.contrast) applyLuts(data, lr);
  if (p.hue || p.saturation) hueSaturation(data, { hue: p.hue ?? 0, saturation: p.saturation ?? 0, lightness: 0, colorize: false });
  if (p.vibrance) vibrance(data, { vibrance: p.vibrance, saturation: 0 });
}

export function clamp(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
}
