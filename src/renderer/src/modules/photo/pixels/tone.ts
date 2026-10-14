/**
 * Histograms, automatic levels (Auto Tone / Contrast / Color) and the toning brushes
 * (dodge / burn / sponge). Pure functions on RGBA buffers.
 */
import { clamp, clamp01, defaultLevels, luma, type LevelsChannel, type LevelsParams } from './adjust';

/* ------------------------------ Histogram / auto ------------------------------ */

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** luminance */
  l: Uint32Array;
  count: number;
}

/** Histogram of the visible (alpha > 0) pixels. */
export function histogram(data: Uint8ClampedArray): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    l[Math.round(luma(data[i], data[i + 1], data[i + 2]))]++;
    count++;
  }
  return { r, g, b, l, count };
}

/** Low/high values after clipping `clip` (fraction) of the pixels on each side. */
export function clipPoints(hist: Uint32Array, count: number, clip: number): [number, number] {
  if (!count) return [0, 255];
  const limit = count * clip;
  let lo = 0;
  let acc = 0;
  for (; lo < 255; lo++) {
    acc += hist[lo];
    if (acc > limit) break;
  }
  let hi = 255;
  acc = 0;
  for (; hi > 0; hi--) {
    acc += hist[hi];
    if (acc > limit) break;
  }
  if (hi <= lo) return [Math.max(0, lo - 1), Math.min(255, lo + 1)];
  return [lo, hi];
}

const levelsFor = (lo: number, hi: number, gamma = 1): LevelsChannel => ({ inBlack: lo, inWhite: hi, gamma, outBlack: 0, outWhite: 255 });

/** "Enhance per channel contrast". */
export function autoToneParams(h: Histogram, clip = 0.001): LevelsParams {
  const p = defaultLevels();
  p.r = levelsFor(...clipPoints(h.r, h.count, clip));
  p.g = levelsFor(...clipPoints(h.g, h.count, clip));
  p.b = levelsFor(...clipPoints(h.b, h.count, clip));
  return p;
}

/** "Enhance monochromatic contrast": the same black/white points for all channels. */
export function autoContrastParams(h: Histogram, clip = 0.001): LevelsParams {
  const all = new Uint32Array(256);
  for (let i = 0; i < 256; i++) all[i] = h.r[i] + h.g[i] + h.b[i];
  const p = defaultLevels();
  p.rgb = levelsFor(...clipPoints(all, h.count * 3, clip));
  return p;
}

function meanAfter(hist: Uint32Array, count: number, lo: number, hi: number): number {
  if (!count) return 0.5;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += hist[v] * clamp01((v - lo) / Math.max(1, hi - lo));
  return clamp(sum / count, 0.02, 0.98);
}

/** "Find dark & light colors" + "snap neutral midtones". */
export function autoColorParams(h: Histogram, clip = 0.001): LevelsParams {
  const p = autoToneParams(h, clip);
  const mr = meanAfter(h.r, h.count, p.r.inBlack, p.r.inWhite);
  const mg = meanAfter(h.g, h.count, p.g.inBlack, p.g.inWhite);
  const mb = meanAfter(h.b, h.count, p.b.inBlack, p.b.inWhite);
  const target = (mr + mg + mb) / 3;
  const gammaFor = (m: number) => clamp(Math.log(m) / Math.log(target), 0.6, 1.6);
  p.r.gamma = gammaFor(mr);
  p.g.gamma = gammaFor(mg);
  p.b.gamma = gammaFor(mb);
  return p;
}

/* ------------------------------ Toning brushes ------------------------------ */

export type ToneRange = 'shadows' | 'midtones' | 'highlights';

/** Weight of a luminance (0..1) inside a tonal range. */
export function toneWeight(range: ToneRange, l: number): number {
  if (range === 'shadows') return (1 - l) * (1 - l);
  if (range === 'highlights') return l * l;
  return 1 - (2 * l - 1) * (2 * l - 1);
}

/** Full-strength result of the dodge / burn / sponge brush (exposure 0..1). Modifies `data`. */
export function toneBrush(
  data: Uint8ClampedArray,
  mode: 'dodge' | 'burn' | 'sponge',
  range: ToneRange,
  exposureAmount: number,
  sponge: 'saturate' | 'desaturate' = 'desaturate',
): void {
  const e = clamp(exposureAmount, 0, 1);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = luma(r, g, b);
    if (mode === 'sponge') {
      const k = sponge === 'saturate' ? 1 + e * 0.8 : 1 - e * 0.8;
      data[i] = l + (r - l) * k;
      data[i + 1] = l + (g - l) * k;
      data[i + 2] = l + (b - l) * k;
      continue;
    }
    const w = toneWeight(range, l / 255) * e * 0.75;
    if (mode === 'dodge') {
      data[i] = r + (255 - r) * w;
      data[i + 1] = g + (255 - g) * w;
      data[i + 2] = b + (255 - b) * w;
    } else {
      data[i] = r - r * w;
      data[i + 1] = g - g * w;
      data[i + 2] = b - b * w;
    }
  }
}
