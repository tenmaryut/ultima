import type { ColorGrade, CurveChannel, CurvePoint, HueRange, LookId, LutAsset } from './types';

/*
 * Color grading (pure, unit tested): built-in looks, tone curves, per-color HSL and imported .cube
 * LUTs. Everything a grade does is baked into one 3D lookup table, which the GPU (or the CPU
 * fallback) applies to every pixel.
 */

type RGB = [number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function saturate([r, g, b]: RGB, amount: number): RGB {
  const y = luma(r, g, b);
  return [y + (r - y) * amount, y + (g - y) * amount, y + (b - y) * amount];
}

/** S-shaped contrast around mid grey (amount 0 = none, 1 = strong). */
function sCurve(x: number, amount: number): number {
  const s = x - 0.5;
  return clamp01(0.5 + s * (1 + amount) - 4 * amount * s * s * s);
}

/** Black and white levels: lifts the blacks to `lo` and pulls the whites to `hi`. */
const levels = (x: number, lo: number, hi: number) => lo + x * (hi - lo);

/** Pushes the shadows towards one color and the highlights towards another. */
function splitTone([r, g, b]: RGB, shadow: RGB, highlight: RGB, amount: number): RGB {
  const y = luma(r, g, b);
  const ws = (1 - smooth(0, 0.55, y)) * amount;
  const wh = smooth(0.45, 1, y) * amount;
  return [r + (shadow[0] - 0.5) * ws + (highlight[0] - 0.5) * wh, g + (shadow[1] - 0.5) * ws + (highlight[1] - 0.5) * wh, b + (shadow[2] - 0.5) * ws + (highlight[2] - 0.5) * wh];
}

const each = (c: RGB, f: (x: number) => number): RGB => [f(c[0]), f(c[1]), f(c[2])];

export const LOOKS: { id: LookId; label: string; apply: (c: RGB) => RGB }[] = [
  { id: 'cinematic', label: 'Cinematic', apply: (c) => saturate(splitTone(each(c, (x) => sCurve(levels(x, 0.03, 0.97), 0.25)), [0.32, 0.5, 0.56], [0.62, 0.53, 0.42], 0.35), 0.9) },
  { id: 'tealOrange', label: 'Teal & orange', apply: (c) => saturate(splitTone(each(c, (x) => sCurve(x, 0.2)), [0.2, 0.52, 0.62], [0.78, 0.55, 0.32], 0.55), 1.1) },
  { id: 'warm', label: 'Warm', apply: ([r, g, b]) => saturate([r * 1.08 + 0.02, g * 1.02 + 0.01, b * 0.88], 1.05) },
  { id: 'cool', label: 'Cool', apply: ([r, g, b]) => [r * 0.9, g * 0.99 + 0.01, b * 1.1 + 0.03] },
  { id: 'vintage', label: 'Vintage', apply: (c) => saturate(splitTone(each(c, (x) => levels(sCurve(x, 0.1), 0.1, 0.9)), [0.45, 0.5, 0.4], [0.62, 0.56, 0.42], 0.4), 0.7) },
  { id: 'faded', label: 'Faded film', apply: (c) => saturate(each(c, (x) => levels(sCurve(x, -0.15), 0.12, 0.92)), 0.82) },
  { id: 'bw', label: 'Black & white', apply: (c) => each(saturate(c, 0), (x) => sCurve(x, 0.15)) },
  { id: 'noir', label: 'Noir', apply: (c) => each(saturate(c, 0), (x) => sCurve(levels(x, -0.06, 1.04), 0.65)) },
  {
    id: 'sepia',
    label: 'Sepia',
    apply: ([r, g, b]) => {
      const y = luma(r, g, b);
      return [y * 1.07 + 0.06, y * 0.95 + 0.02, y * 0.76];
    },
  },
  { id: 'vivid', label: 'Vivid', apply: (c) => saturate(each(c, (x) => sCurve(x, 0.25)), 1.4) },
  { id: 'cyberpunk', label: 'Cyberpunk', apply: (c) => saturate(splitTone(each(c, (x) => sCurve(x, 0.3)), [0.62, 0.34, 0.72], [0.36, 0.72, 0.72], 0.6), 1.25) },
  { id: 'moody', label: 'Moody', apply: (c) => saturate(splitTone(each(c, (x) => levels(sCurve(x, 0.2), 0.02, 0.88)), [0.38, 0.5, 0.52], [0.55, 0.52, 0.48], 0.4), 0.72) },
  { id: 'golden', label: 'Golden hour', apply: (c) => saturate(splitTone(each(c, (x) => sCurve(x, 0.1)), [0.55, 0.45, 0.4], [0.75, 0.58, 0.3], 0.5), 1.1) },
  { id: 'bleach', label: 'Bleach bypass', apply: (c) => saturate(each(c, (x) => sCurve(x, 0.45)), 0.45) },
  { id: 'pastel', label: 'Pastel', apply: (c) => saturate(each(c, (x) => levels(sCurve(x, -0.25), 0.14, 1)), 0.8) },
  { id: 'night', label: 'Day for night', apply: ([r, g, b]) => saturate(each([r * 0.55, g * 0.62, b * 0.85 + 0.03], (x) => sCurve(x, 0.15)), 0.6) },
];

export const LOOK_IDS = LOOKS.map((l) => l.id);

/* ---------------------------------- Curves ---------------------------------- */

export const CURVE_CHANNELS: readonly CurveChannel[] = ['master', 'r', 'g', 'b'];

/** Valid curve points: inside 0-1, sorted, distinct inputs, with the ends added when missing. */
export function cleanCurve(points: unknown): CurvePoint[] | null {
  if (!Array.isArray(points)) return null;
  const big = points.some((p) => Array.isArray(p) && (Number(p[0]) > 1 || Number(p[1]) > 1));
  const list: CurvePoint[] = [];
  for (const p of points.slice(0, 32)) {
    if (!Array.isArray(p) || p.length < 2) continue;
    let x = Number(p[0]);
    let y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // 0-255 values are accepted too
    if (big) {
      x /= 255;
      y /= 255;
    }
    x = clamp01(x);
    y = clamp01(y);
    const same = list.findIndex((q) => Math.abs(q[0] - x) < 1e-3);
    if (same >= 0) list[same] = [x, y];
    else list.push([x, y]);
  }
  if (!list.length) return null;
  list.sort((a, b) => a[0] - b[0]);
  // missing ends stay where an unchanged curve has them
  if (list[0][0] > 0) list.unshift([0, 0]);
  if (list[list.length - 1][0] < 1) list.push([1, 1]);
  return list;
}

/** True for a curve that changes nothing. */
export const isIdentityCurve = (pts: CurvePoint[] | undefined) => !pts || pts.every(([x, y]) => Math.abs(x - y) < 1e-4);

/** 256-entry table of a curve through `points` (monotone cubic, so it never overshoots). */
export function curveTable(points: CurvePoint[]): Float32Array {
  const out = new Float32Array(256);
  const n = points.length;
  if (n < 2) {
    for (let i = 0; i < 256; i++) out[i] = i / 255;
    return out;
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  // Fritsch–Carlson: limit the tangents so each piece stays monotone
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    if (x <= xs[0]) {
      out[i] = ys[0];
      continue;
    }
    if (x >= xs[n - 1]) {
      out[i] = ys[n - 1];
      continue;
    }
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const h = xs[seg + 1] - xs[seg];
    const t = (x - xs[seg]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    out[i] = clamp01((2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * m[seg + 1]);
  }
  return out;
}

function lookup(table: Float32Array, x: number): number {
  const f = clamp01(x) * 255;
  const i = Math.min(254, Math.floor(f));
  return table[i] + (table[i + 1] - table[i]) * (f - i);
}

/* ----------------------------------- HSL ----------------------------------- */

export const HUE_RANGES: { id: HueRange; label: string; hue: number; swatch: string }[] = [
  { id: 'red', label: 'Red', hue: 0, swatch: '#e5484d' },
  { id: 'orange', label: 'Orange', hue: 30, swatch: '#f08c3a' },
  { id: 'yellow', label: 'Yellow', hue: 58, swatch: '#f5d90a' },
  { id: 'green', label: 'Green', hue: 120, swatch: '#46a758' },
  { id: 'aqua', label: 'Aqua', hue: 180, swatch: '#12a594' },
  { id: 'blue', label: 'Blue', hue: 225, swatch: '#3e63dd' },
  { id: 'purple', label: 'Purple', hue: 275, swatch: '#8e4ec6' },
  { id: 'magenta', label: 'Magenta', hue: 320, swatch: '#d6409f' },
];

export const HUE_RANGE_IDS = HUE_RANGES.map((h) => h.id);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s <= 0) return [l, l, l];
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(hue + 1 / 3), f(hue), f(hue - 1 / 3)];
}

/** How much a hue (degrees) belongs to each range: a smooth window reaching the neighbouring ranges. */
function rangeWeights(h: number): number[] {
  const w: number[] = [];
  const n = HUE_RANGES.length;
  for (let i = 0; i < n; i++) {
    const c = HUE_RANGES[i].hue;
    const prev = HUE_RANGES[(i + n - 1) % n].hue;
    const next = HUE_RANGES[(i + 1) % n].hue;
    const span = (((h - c) % 360) + 540) % 360 - 180; // signed distance −180..180
    const width = span >= 0 ? ((((next - c) % 360) + 360) % 360 || 360) : ((((c - prev) % 360) + 360) % 360 || 360);
    const x = Math.abs(span) / width;
    w.push(x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x));
  }
  return w;
}

function applyHsl(c: RGB, hsl: NonNullable<ColorGrade['hsl']>): RGB {
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
  if (s < 1e-4) return c;
  const w = rangeWeights(h);
  let dh = 0;
  let ds = 0;
  let dl = 0;
  HUE_RANGES.forEach((r, i) => {
    const adj = hsl[r.id];
    if (!adj || !w[i]) return;
    dh += w[i] * adj.h;
    ds += w[i] * adj.s;
    dl += w[i] * adj.l;
  });
  if (!dh && !ds && !dl) return c;
  // colorless pixels are barely touched
  const k = smooth(0, 0.25, s);
  const ns = clamp01(s * (1 + (ds / 100) * k));
  const nl = clamp01(l + (dl / 100) * 0.35 * k * (1 - Math.abs(2 * l - 1)));
  return hslToRgb(h + dh * k, ns, nl);
}

/* ------------------------------------ LUT ------------------------------------ */

export interface Lut3D {
  size: number;
  /** size³ × 3 floats 0-1, red changing fastest. */
  data: Float32Array;
}

/** Parses an Adobe/Resolve .cube file (3D LUTs; 1D tables are applied per channel). */
export function parseCube(text: string): Lut3D {
  let size = 0;
  let size1d = 0;
  let min: RGB = [0, 0, 0];
  let max: RGB = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') continue;
    if (key === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
    else if (key === 'LUT_1D_SIZE') size1d = parseInt(parts[1], 10);
    else if (key === 'DOMAIN_MIN') min = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else if (key === 'DOMAIN_MAX') max = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    else if (/^[-+.\d]/.test(parts[0])) {
      if (parts.length < 3) throw new Error('Broken .cube file: a table row needs three numbers.');
      for (let i = 0; i < 3; i++) {
        const v = Number(parts[i]);
        if (!Number.isFinite(v)) throw new Error('Broken .cube file: a table value is not a number.');
        values.push(v);
      }
      if (values.length > 3 * 65 * 65 * 65) throw new Error('This LUT is too large (65 points per side at most).');
    } else if (/^[A-Z_0-9]+$/.test(key)) continue; // unknown keywords (LUT_3D_INPUT_RANGE…)
  }
  const span = (i: number, v: number) => (v - min[i]) / Math.max(1e-6, max[i] - min[i]);
  if (size) {
    if (size < 2 || size > 65) throw new Error('This LUT has an unsupported size (2-65 points per side).');
    if (values.length !== size * size * size * 3) throw new Error(`Broken .cube file: expected ${size ** 3} rows, found ${Math.floor(values.length / 3)}.`);
    return { size, data: Float32Array.from(values, (v) => clamp01(v)) };
  }
  if (size1d) {
    if (values.length !== size1d * 3 || size1d < 2) throw new Error('Broken .cube file: the 1D table has the wrong length.');
    // bake the per-channel table into a 33-point cube
    const n = 33;
    const data = new Float32Array(n * n * n * 3);
    const ch = (c: number, x: number) => {
      const f = clamp01(span(c, x)) * (size1d - 1);
      const i = Math.min(size1d - 2, Math.floor(f));
      return clamp01(values[i * 3 + c] + (values[(i + 1) * 3 + c] - values[i * 3 + c]) * (f - i));
    };
    let o = 0;
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      data[o++] = ch(0, r / (n - 1));
      data[o++] = ch(1, g / (n - 1));
      data[o++] = ch(2, b / (n - 1));
    }
    return { size: n, data };
  }
  throw new Error('This file is not a .cube LUT (no LUT_3D_SIZE).');
}

/** Packs a LUT for the project file. */
export function encodeLut(lut: Lut3D): string {
  const u16 = new Uint16Array(lut.data.length);
  for (let i = 0; i < u16.length; i++) u16[i] = Math.round(clamp01(lut.data[i]) * 65535);
  const bytes = new Uint8Array(u16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const decoded = new Map<string, Lut3D>();

/** Unpacks (and caches) a LUT from the project file; null when it is broken. */
export function decodeLut(asset: LutAsset): Lut3D | null {
  const key = `${asset.id}|${asset.size}|${asset.data.length}`;
  const hit = decoded.get(key);
  if (hit) return hit;
  try {
    const bin = atob(asset.data);
    if (bin.length !== asset.size ** 3 * 6) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const u16 = new Uint16Array(bytes.buffer);
    const lut = { size: asset.size, data: Float32Array.from(u16, (v) => v / 65535) };
    if (decoded.size > 16) decoded.clear();
    decoded.set(key, lut);
    return lut;
  } catch {
    return null;
  }
}

/** Trilinear lookup in a LUT. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number): RGB {
  const n = lut.size;
  const fr = clamp01(r) * (n - 1);
  const fg = clamp01(g) * (n - 1);
  const fb = clamp01(b) * (n - 1);
  const r0 = Math.min(n - 2, Math.floor(fr));
  const g0 = Math.min(n - 2, Math.floor(fg));
  const b0 = Math.min(n - 2, Math.floor(fb));
  const dr = fr - r0;
  const dg = fg - g0;
  const db = fb - b0;
  const d = lut.data;
  const out: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (ri: number, gi: number, bi: number) => d[((bi * n + gi) * n + ri) * 3 + c];
    const c00 = mix(at(r0, g0, b0), at(r0 + 1, g0, b0), dr);
    const c10 = mix(at(r0, g0 + 1, b0), at(r0 + 1, g0 + 1, b0), dr);
    const c01 = mix(at(r0, g0, b0 + 1), at(r0 + 1, g0, b0 + 1), dr);
    const c11 = mix(at(r0, g0 + 1, b0 + 1), at(r0 + 1, g0 + 1, b0 + 1), dr);
    out[c] = mix(mix(c00, c10, dg), mix(c01, c11, dg), db);
  }
  return out;
}

/* ---------------------------------- Grades ---------------------------------- */

/** True when a grade changes the picture. */
export function gradeActive(g: ColorGrade | undefined, luts: LutAsset[] = []): boolean {
  if (!g) return false;
  if (g.look && g.lookAmount > 0 && LOOK_IDS.includes(g.look)) return true;
  if (g.lut && g.lutAmount > 0 && luts.some((l) => l.id === g.lut)) return true;
  if (g.curves && CURVE_CHANNELS.some((c) => !isIdentityCurve(g.curves?.[c]))) return true;
  if (g.hsl && Object.values(g.hsl).some((a) => a && (a.h || a.s || a.l))) return true;
  return false;
}

/** Cache key of the table a grade bakes into. */
export function gradeKey(g: ColorGrade, luts: LutAsset[] = []): string {
  const lut = g.lut ? luts.find((l) => l.id === g.lut) : undefined;
  return JSON.stringify([g.look ?? null, g.lookAmount, lut ? `${lut.id}:${lut.data.length}` : null, g.lutAmount, g.curves ?? null, g.hsl ?? null]);
}

/** The color a grade turns `c` into (curves → HSL → look → LUT). */
export function gradeColor(c: RGB, g: ColorGrade, tables: { master?: Float32Array; r?: Float32Array; g?: Float32Array; b?: Float32Array }, lut: Lut3D | null): RGB {
  let [r, gg, b] = c;
  if (tables.master) {
    r = lookup(tables.master, r);
    gg = lookup(tables.master, gg);
    b = lookup(tables.master, b);
  }
  if (tables.r) r = lookup(tables.r, r);
  if (tables.g) gg = lookup(tables.g, gg);
  if (tables.b) b = lookup(tables.b, b);
  let out: RGB = [r, gg, b];
  if (g.hsl) out = applyHsl(out, g.hsl);
  const look = g.look ? LOOKS.find((l) => l.id === g.look) : undefined;
  if (look && g.lookAmount > 0) {
    const graded = look.apply(out);
    const k = clamp01(g.lookAmount);
    out = [mix(out[0], graded[0], k), mix(out[1], graded[1], k), mix(out[2], graded[2], k)];
  }
  if (lut && g.lutAmount > 0) {
    const graded = sampleLut(lut, out[0], out[1], out[2]);
    const k = clamp01(g.lutAmount);
    out = [mix(out[0], graded[0], k), mix(out[1], graded[1], k), mix(out[2], graded[2], k)];
  }
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}

const baked = new Map<string, Lut3D>();

/** The grade as a lookup table of `size` points per side (cached). */
export function bakeGrade(g: ColorGrade, luts: LutAsset[] = [], size = 33): Lut3D {
  const key = `${size}|${gradeKey(g, luts)}`;
  const hit = baked.get(key);
  if (hit) return hit;
  const tables: { master?: Float32Array; r?: Float32Array; g?: Float32Array; b?: Float32Array } = {};
  for (const ch of CURVE_CHANNELS) {
    const pts = g.curves?.[ch];
    if (pts && !isIdentityCurve(pts)) tables[ch] = curveTable(pts);
  }
  const asset = g.lut ? luts.find((l) => l.id === g.lut) : undefined;
  const lut = asset ? decodeLut(asset) : null;
  const data = new Float32Array(size * size * size * 3);
  let o = 0;
  for (let b = 0; b < size; b++) {
    for (let gg = 0; gg < size; gg++) {
      for (let r = 0; r < size; r++) {
        const c = gradeColor([r / (size - 1), gg / (size - 1), b / (size - 1)], g, tables, lut);
        data[o++] = c[0];
        data[o++] = c[1];
        data[o++] = c[2];
      }
    }
  }
  const out = { size, data };
  if (baked.size > 24) baked.clear();
  baked.set(key, out);
  return out;
}
