/**
 * Histograms, clipping statistics and Auto Tone. Pure functions over RGBA pixel data.
 */
import type { DevelopSettings } from './params';
import { linearToSrgb, srgbToLinear } from './color';

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Luminance (Rec. 709 weights on encoded values). */
  l: Uint32Array;
  total: number;
  /** Mean of (max - min) / 255 per pixel — a cheap saturation measure. */
  meanSaturation: number;
}

export function emptyHistogram(): Histogram {
  return { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), total: 0, meanSaturation: 0 };
}

/** Builds a histogram from RGBA bytes (transparent pixels are skipped). */
export function computeHistogram(rgba: Uint8Array | Uint8ClampedArray, step = 1): Histogram {
  const h = emptyHistogram();
  let sat = 0;
  const stride = Math.max(1, Math.floor(step)) * 4;
  for (let i = 0; i + 3 < rgba.length; i += stride) {
    if (rgba[i + 3] === 0) continue;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    h.r[r]++;
    h.g[g]++;
    h.b[b]++;
    h.l[Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b))]++;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
    h.total++;
  }
  h.meanSaturation = h.total ? sat / h.total / 255 : 0;
  return h;
}

/** Value (0..255) below which `q` (0..1) of the pixels fall. */
export function percentile(hist: Uint32Array, total: number, q: number): number {
  if (!total) return 0;
  const target = q * total;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

export function histogramMean(hist: Uint32Array, total: number): number {
  if (!total) return 0;
  let s = 0;
  for (let i = 0; i < 256; i++) s += i * hist[i];
  return s / total;
}

export interface ChannelStats {
  mean: number;
  /** Fraction of pixels at 0 / at 255. */
  clipLow: number;
  clipHigh: number;
}

export interface HistogramStats {
  r: ChannelStats;
  g: ChannelStats;
  b: ChannelStats;
  l: ChannelStats;
  /** Any channel clipped (for the clipping indicators). */
  shadowsClipped: boolean;
  highlightsClipped: boolean;
}

export function histogramStats(h: Histogram, threshold = 0.002): HistogramStats {
  const ch = (hist: Uint32Array): ChannelStats => ({
    mean: histogramMean(hist, h.total) / 255,
    clipLow: h.total ? hist[0] / h.total : 0,
    clipHigh: h.total ? hist[255] / h.total : 0,
  });
  const r = ch(h.r);
  const g = ch(h.g);
  const b = ch(h.b);
  const l = ch(h.l);
  return {
    r,
    g,
    b,
    l,
    shadowsClipped: Math.max(r.clipLow, g.clipLow, b.clipLow) > threshold,
    highlightsClipped: Math.max(r.clipHigh, g.clipHigh, b.clipHigh) > threshold,
  };
}

/** One-line summary for the AI context. */
export function describeHistogram(h: Histogram): string {
  if (!h.total) return 'no histogram';
  const s = histogramStats(h);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const ch = (name: string, c: ChannelStats) => `${name} mean ${(c.mean * 255).toFixed(0)}/255 (clipped low ${pct(c.clipLow)}, high ${pct(c.clipHigh)})`;
  const p = (q: number) => percentile(h.l, h.total, q);
  return [
    ch('Luminance', s.l),
    ch('Red', s.r),
    ch('Green', s.g),
    ch('Blue', s.b),
    `luminance percentiles 1%=${p(0.01)} 50%=${p(0.5)} 99%=${p(0.99)}`,
    `mean saturation ${(h.meanSaturation * 100).toFixed(0)}%`,
  ].join('; ');
}

const round = (v: number, d = 0) => {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Auto Tone from the histogram of the unedited photo: exposure brings the median to
 * mid grey, highlights/whites/shadows/blacks place the end points, contrast follows the
 * tonal spread and vibrance the saturation.
 */
export function autoTone(h: Histogram): Partial<DevelopSettings> {
  if (!h.total) return {};
  const q = (v: number) => percentile(h.l, h.total, v) / 255;
  const p005 = q(0.005);
  const p05 = q(0.05);
  const p50 = Math.max(q(0.5), 0.01);
  const p95 = q(0.95);
  const p995 = q(0.995);

  let ev = Math.log2(srgbToLinear(0.45) / Math.max(srgbToLinear(p50), 1e-4)) * 0.85;
  ev = clampN(ev, -2, 2);
  if (Math.abs(ev) < 0.05) ev = 0;
  const gain = Math.pow(2, ev);
  const predict = (v: number) => linearToSrgb(Math.min(srgbToLinear(v) * gain, 4));

  const hi = predict(p995);
  const highlights = hi > 0.92 ? -clampN((hi - 0.85) * 220, 0, 80) : 0;
  const whites = hi < 0.9 ? clampN((0.97 - hi) * 150, 0, 40) : hi > 1 ? -clampN((hi - 1) * 60, 0, 30) : 0;
  const sh = predict(p05);
  const shadows = sh < 0.12 ? clampN((0.12 - sh) * 300, 0, 50) : 0;
  const lo = predict(p005);
  const blacks = lo > 0.04 ? -clampN((lo - 0.03) * 250, 0, 40) : 0;
  const spread = p95 - p05;
  const contrast = spread < 0.55 ? clampN((0.7 - spread) * 80, 0, 30) : spread > 0.85 ? -clampN((spread - 0.85) * 100, 0, 15) : 0;
  const vibrance = h.meanSaturation < 0.15 ? 25 : h.meanSaturation < 0.25 ? 15 : 5;

  return {
    exposure: round(ev, 2),
    contrast: round(contrast),
    highlights: round(highlights),
    shadows: round(shadows),
    whites: round(whites),
    blacks: round(blacks),
    vibrance,
  };
}
