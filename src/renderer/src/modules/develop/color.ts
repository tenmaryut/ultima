/**
 * Develop color math. Every function here has a line-by-line twin in gl/shaders.ts
 * (same names, same constants) so the GPU pipeline can be unit tested through this
 * CPU reference. Values: "lin" = linear sRGB, "enc" = sRGB-encoded 0..1,
 * "p" = perceptual (gamma 2.2) luminance.
 */
import { BAND_CENTERS, BANDS, type DevelopSettings } from './params';

export type Vec3 = [number, number, number];
/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function luma(c: Vec3): number {
  return c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  if (c <= 0) return 0;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function toPerceptual(y: number): number {
  return Math.pow(Math.max(y, 0), 1 / 2.2);
}

export function fromPerceptual(p: number): number {
  return Math.pow(Math.max(p, 0), 2.2);
}

export function mulMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

/* ------------------------------- White balance ------------------------------ */

/** Planckian locus chromaticity for a color temperature (Kim et al. 2002, 1667–25000 K). */
export function cctToXy(kelvin: number): [number, number] {
  const T = Math.max(1667, Math.min(25000, kelvin));
  const t1 = 1e3 / T;
  const t2 = t1 * t1;
  const t3 = t2 * t1;
  const x = T <= 4000 ? -0.2661239 * t3 - 0.234358 * t2 + 0.8776956 * t1 + 0.17991 : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t1 + 0.24039;
  const x2 = x * x;
  const x3 = x2 * x;
  let y: number;
  if (T <= 2222) y = -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683;
  else if (T <= 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  else y = 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

const D65_XY: [number, number] = [0.31271, 0.32902];
const REF_KELVIN = 6504;
const SRGB_TO_XYZ: Mat3 = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const XYZ_TO_SRGB: Mat3 = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV: Mat3 = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];

/** Temp slider (-100 cool … +100 warm) → the illuminant temperature that gets neutralized. */
export function tempToKelvin(temp: number): number {
  return 1e6 / (1e6 / REF_KELVIN - temp);
}

/** Chromaticity of the "assumed scene white" for the temp/tint sliders (0,0 = D65). */
export function sourceWhiteXy(temp: number, tint: number): [number, number] {
  const ref = cctToXy(REF_KELVIN);
  const cur = cctToXy(tempToKelvin(temp));
  const k = tint * 0.00045; // + tint: assume a greener light → output gets more magenta
  return [D65_XY[0] + cur[0] - ref[0] - k * 0.25, D65_XY[1] + cur[1] - ref[1] + k];
}

function xyToXYZ([x, y]: [number, number]): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

/**
 * Linear-sRGB matrix that adapts the assumed scene white (from temp/tint) to D65 with a
 * Bradford transform, normalized so neutral luminance is kept. wbMatrix(0, 0) = identity.
 */
export function wbMatrix(temp: number, tint: number): Mat3 {
  if (temp === 0 && tint === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const src = mulMat3(BRADFORD, xyToXYZ(sourceWhiteXy(temp, tint)));
  const dst = mulMat3(BRADFORD, xyToXYZ(D65_XY));
  const scale: Mat3 = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  const adapt = matMul(BRADFORD_INV, matMul(scale, BRADFORD));
  const m = matMul(XYZ_TO_SRGB, matMul(adapt, SRGB_TO_XYZ));
  const white = mulMat3(m, [1, 1, 1]);
  const y = luma(white);
  return m.map((v) => v / y) as Mat3;
}

/**
 * Finds temp/tint that make the given linear color neutral (white balance picker, auto
 * white balance). Coarse-to-fine grid search over the slider ranges.
 */
export function solveWhiteBalance(colorLin: Vec3): { temp: number; tint: number } {
  const err = (temp: number, tint: number) => {
    const c = mulMat3(wbMatrix(temp, tint), colorLin);
    const s = c[0] + c[1] + c[2] || 1;
    const r = c[0] / s - 1 / 3;
    const g = c[1] / s - 1 / 3;
    const b = c[2] / s - 1 / 3;
    return r * r + g * g + b * b;
  };
  let best = { temp: 0, tint: 0, e: err(0, 0) };
  let span = 100;
  let step = 20;
  for (let iter = 0; iter < 5; iter++) {
    const cx = best.temp;
    const cy = best.tint;
    for (let t = cx - span; t <= cx + span + 1e-9; t += step) {
      for (let n = cy - span; n <= cy + span + 1e-9; n += step) {
        const tt = Math.max(-100, Math.min(100, t));
        const nn = Math.max(-100, Math.min(100, n));
        const e = err(tt, nn);
        if (e < best.e) best = { temp: tt, tint: nn, e };
      }
    }
    span = step;
    step /= 4;
  }
  return { temp: Math.round(best.temp), tint: Math.round(best.tint) };
}

/* ---------------------------------- Dehaze --------------------------------- */

/** Dark-channel-prior dehaze. `darkLin` = blurred min(r,g,b) (linear), `atmos` = airlight (linear). */
export function dehazePixel(lin: Vec3, darkLin: number, amount: number, atmos: Vec3): Vec3 {
  if (amount > 0) {
    const al = Math.max(luma(atmos), 0.05);
    const t = Math.max(1 - 0.95 * amount * (darkLin / al), 0.12);
    return [
      Math.max((lin[0] - atmos[0]) / t + atmos[0], 0),
      Math.max((lin[1] - atmos[1]) / t + atmos[1], 0),
      Math.max((lin[2] - atmos[2]) / t + atmos[2], 0),
    ];
  }
  if (amount < 0) {
    const h = -amount * 0.65;
    return [mix(lin[0], atmos[0], h), mix(lin[1], atmos[1], h), mix(lin[2], atmos[2], h)];
  }
  return lin;
}

/** Airlight estimate: mean color of the 0.1% pixels with the brightest dark channel. */
export function estimateAtmosphere(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Vec3 {
  const n = width * height;
  if (!n) return [1, 1, 1];
  const counts = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    counts[Math.min(rgba[o], rgba[o + 1], rgba[o + 2])]++;
  }
  const want = Math.max(1, Math.round(n * 0.001));
  let threshold = 255;
  let acc = 0;
  for (; threshold > 0; threshold--) {
    acc += counts[threshold];
    if (acc >= want) break;
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (Math.min(rgba[o], rgba[o + 1], rgba[o + 2]) >= threshold) {
      r += rgba[o];
      g += rgba[o + 1];
      b += rgba[o + 2];
      k++;
    }
  }
  const f = (v: number) => Math.max(0.5, Math.min(1, srgbToLinear(v / k / 255)));
  return k ? [f(r), f(g), f(b)] : [1, 1, 1];
}

/* ----------------------------------- Tone ---------------------------------- */

/** Highlights/shadows as a local exposure change (stops) driven by the base luminance. */
export function localToneStops(pBase: number, shadows: number, highlights: number): number {
  const mS = 1 - smoothstep(0.05, 0.6, pBase);
  const mH = smoothstep(0.35, 0.95, pBase);
  return shadows * (shadows > 0 ? 1.4 : 1.0) * mS + highlights * (highlights < 0 ? 1.6 : 0.8) * mH;
}

const CONTRAST_PIVOT = 0.46;

/** S-curve around mid grey (perceptual). c in -1..1. Monotonic for every c. */
export function contrastCurve(x: number, c: number): number {
  if (c === 0) return x;
  const g = Math.pow(2, c * 0.9);
  const m = CONTRAST_PIVOT;
  const xc = clamp01(x);
  const y = xc <= m ? m * Math.pow(xc / m, g) : 1 - (1 - m) * Math.pow((1 - xc) / (1 - m), g);
  return y + Math.max(x - 1, 0);
}

/** Contrast, whites and blacks (all -1..1) on perceptual luminance. */
export function globalTone(p: number, contrast: number, whites: number, blacks: number): number {
  let v = contrastCurve(p, contrast);
  v += 0.22 * whites * smoothstep(0.35, 1.0, v);
  v += 0.12 * blacks * (1 - smoothstep(0.0, 0.45, v));
  return v;
}

/** Clarity / texture detail added to perceptual luminance. */
export function detailBoost(p: number, clarityDetail: number, textureDetail: number, clarity: number, texture: number): number {
  const t = clamp01(Math.abs(2 * p - 1));
  const mid = 1 - t * t;
  const kc = clarity > 0 ? 1.6 * clarity : 0.9 * clarity;
  const kt = texture > 0 ? 2.2 * texture : 0.9 * texture;
  return p + kc * clarityDetail * mid + kt * textureDetail * (0.4 + 0.6 * mid);
}

/** Scales a linear color to a new luminance, keeping its chromaticity. */
export function applyLuminance(c: Vec3, y: number, yNew: number): Vec3 {
  const ratio = yNew / Math.max(y, 1e-5);
  const fill = yNew - y * ratio;
  return [c[0] * ratio + fill, c[1] * ratio + fill, c[2] * ratio + fill];
}

/** Brings out-of-range colors back into 0..1 by reducing chroma (keeps hue + luminance). */
export function fitGamut(c: Vec3): Vec3 {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  if (mx <= 1 && mn >= 0) return c;
  const y = clamp01(luma(c));
  let k = 1;
  if (mx > 1) k = Math.min(k, (1 - y) / Math.max(mx - y, 1e-6));
  if (mn < 0) k = Math.min(k, y / Math.max(y - mn, 1e-6));
  k = clamp01(k);
  return [clamp01(y + (c[0] - y) * k), clamp01(y + (c[1] - y) * k), clamp01(y + (c[2] - y) * k)];
}

/* ------------------------------------ HSL ---------------------------------- */

/** RGB 0..1 → [h (0..360), s, v]. */
export function rgbToHsv(c: Vec3): Vec3 {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === c[0]) h = (c[1] - c[2]) / d;
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx > 1e-6 ? d / mx : 0, mx];
}

export function hsvToRgb(h: number, s: number, v: number): Vec3 {
  const hh = ((((h % 360) + 360) % 360) / 60);
  const f = (n: number) => {
    const k = (n + hh) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/**
 * Finds the two HSL bands around a hue: `i` gets weight `w`, `j` gets `1 - w`
 * (cosine cross-fade between band centers → weights sum to 1, peak at the center).
 */
export function bandSegment(hue: number): { i: number; j: number; w: number } {
  const h = ((hue % 360) + 360) % 360;
  for (let i = 0; i < 8; i++) {
    const c0 = BAND_CENTERS[i];
    const c1 = i === 7 ? 360 : BAND_CENTERS[i + 1];
    if (h >= c0 && h < c1) {
      const t = (h - c0) / (c1 - c0);
      const c = Math.cos((Math.PI * t) / 2);
      return { i, j: (i + 1) % 8, w: c * c };
    }
  }
  return { i: 0, j: 1, w: 1 };
}

/** Weight of each of the 8 bands for a hue (sums to 1). */
export function hslBandWeights(hue: number): number[] {
  const out = new Array(8).fill(0);
  const { i, j, w } = bandSegment(hue);
  out[i] += w;
  out[j] += 1 - w;
  return out;
}

export function bandBlend(hue: number, values: ArrayLike<number>): number {
  const { i, j, w } = bandSegment(hue);
  return values[i] * w + values[j] * (1 - w);
}

export interface HslUniforms {
  hue: number[];
  sat: number[];
  lum: number[];
  active: boolean;
}

export function hslUniforms(s: DevelopSettings): HslUniforms {
  const hue = BANDS.map((b) => s[`hue${b}`] / 100);
  const sat = BANDS.map((b) => s[`sat${b}`] / 100);
  const lum = BANDS.map((b) => s[`lum${b}`] / 100);
  const active = [...hue, ...sat, ...lum].some((v) => v !== 0);
  return { hue, sat, lum, active };
}

/** HSL band adjustments (+ B&W conversion when `bw`). enc in, enc out. */
export function applyHsl(enc: Vec3, u: HslUniforms, bw: boolean): Vec3 {
  let c = enc;
  if (u.active) {
    const hsv = rgbToHsv(c);
    const seg = bandSegment(hsv[0]);
    const pick = (vals: number[]) => vals[seg.i] * seg.w + vals[seg.j] * (1 - seg.w);
    const satW = smoothstep(0.02, 0.2, hsv[1]);
    if (!bw) {
      const h = hsv[0] + pick(u.hue) * 30;
      const sat = clamp01(hsv[1] * (1 + pick(u.sat)));
      c = hsvToRgb(h, sat, hsv[2]);
    }
    const stops = pick(u.lum) * (bw ? 1.6 : 1.2) * satW;
    if (stops !== 0) {
      const g = Math.pow(2, stops);
      c = fitGamut([linearToSrgb(srgbToLinear(c[0]) * g), linearToSrgb(srgbToLinear(c[1]) * g), linearToSrgb(srgbToLinear(c[2]) * g)]);
    }
  }
  if (bw) {
    const g = linearToSrgb(luma([srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]));
    c = [g, g, g];
  }
  return c;
}

/* ----------------------------- Vibrance / saturation ---------------------------- */

export function vibranceSaturation(enc: Vec3, vibrance: number, saturation: number): Vec3 {
  if (vibrance === 0 && saturation === 0) return enc;
  const y = luma(enc);
  const mx = Math.max(enc[0], enc[1], enc[2]);
  const mn = Math.min(enc[0], enc[1], enc[2]);
  const s = mx - mn;
  const hue = rgbToHsv(enc)[0];
  const dist = Math.abs(((hue - 25 + 540) % 360) - 180);
  const skin = 1 - 0.6 * (1 - smoothstep(0, 35, dist));
  const inv = 1 - s;
  const vf = vibrance >= 0 ? 1 + vibrance * inv * inv * skin * 1.2 : 1 + vibrance * (1 - s * 0.5);
  const sf = 1 + saturation;
  const k = vf * sf;
  return fitGamut([y + (enc[0] - y) * k, y + (enc[1] - y) * k, y + (enc[2] - y) * k]);
}

/* -------------------------------- Color grading ------------------------------- */

/** Zero-luminance chroma offset for a hue (used to tint a tonal range). */
export function chromaOffset(hue: number): Vec3 {
  const c = hsvToRgb(hue, 1, 1);
  const y = luma(c);
  return [c[0] - y, c[1] - y, c[2] - y];
}

export interface GradingUniforms {
  /** rgb offset + luminance offset per range. */
  shadow: [number, number, number, number];
  mid: [number, number, number, number];
  high: [number, number, number, number];
  global: [number, number, number, number];
  exponent: number;
  balanceExp: number;
  active: boolean;
}

export function gradingUniforms(s: DevelopSettings): GradingUniforms {
  const range = (hue: number, sat: number, lum: number): [number, number, number, number] => {
    const o = chromaOffset(hue);
    const k = (sat / 100) * 0.3;
    return [o[0] * k, o[1] * k, o[2] * k, (lum / 100) * 0.2];
  };
  const shadow = range(s.gradeShadowHue, s.gradeShadowSat, s.gradeShadowLum);
  const mid = range(s.gradeMidHue, s.gradeMidSat, s.gradeMidLum);
  const high = range(s.gradeHighHue, s.gradeHighSat, s.gradeHighLum);
  const global = range(s.gradeGlobalHue, s.gradeGlobalSat, s.gradeGlobalLum);
  const active = [shadow, mid, high, global].some((r) => r.some((v) => v !== 0));
  return {
    shadow,
    mid,
    high,
    global,
    exponent: mix(4, 1, s.gradeBlending / 100),
    balanceExp: Math.pow(2, -s.gradeBalance / 100),
    active,
  };
}

/** Shadow / midtone / highlight weights for an encoded luminance. */
export function gradeWeights(l: number, exponent: number, balanceExp: number): Vec3 {
  const lb = Math.pow(clamp01(l), balanceExp);
  const ws = Math.pow(1 - lb, exponent);
  const wh = Math.pow(lb, exponent);
  return [ws, Math.max(0, 1 - ws - wh), wh];
}

export function applyGrading(enc: Vec3, g: GradingUniforms): Vec3 {
  if (!g.active) return enc;
  const [ws, wm, wh] = gradeWeights(luma(enc), g.exponent, g.balanceExp);
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = enc[i] + ws * g.shadow[i] + wm * g.mid[i] + wh * g.high[i] + g.global[i];
    out[i] += ws * g.shadow[3] + wm * g.mid[3] + wh * g.high[3] + g.global[3];
  }
  return fitGamut(out);
}

/* ---------------------------------- Vignette --------------------------------- */

/** Post-crop vignette mask (0 center … 1 edge) for normalized output coords nx, ny in 0..1. */
export function vignetteMask(nx: number, ny: number, aspect: number, midpoint: number, roundness: number, feather: number): number {
  const x = nx * 2 - 1;
  const y = ny * 2 - 1;
  const r = Math.max(roundness, 0);
  const qx = mix(1, Math.min(aspect, 1), r);
  const qy = mix(1, Math.min(1 / aspect, 1), r);
  const vx = Math.abs(x * qx);
  const vy = Math.abs(y * qy);
  const n = roundness < 0 ? 2 - roundness * 6 : 2;
  const d = Math.pow(Math.pow(vx, n) + Math.pow(vy, n), 1 / n);
  const rc = mix(0.3, 1.3, midpoint);
  const width = mix(0.05, 1.1, feather);
  return smoothstep(rc - width / 2, rc + width / 2, d);
}

export function applyVignette(enc: Vec3, mask: number, amount: number): Vec3 {
  if (amount < 0) {
    const k = 1 + amount * mask;
    return [enc[0] * k, enc[1] * k, enc[2] * k];
  }
  const k = amount * mask;
  return [enc[0] + (1 - enc[0]) * k, enc[1] + (1 - enc[1]) * k, enc[2] + (1 - enc[2]) * k];
}
