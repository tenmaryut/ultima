/**
 * Palette extraction from image pixels: k-means (k-means++ seeding) in CIE Lab space on a
 * downsampled copy, then a mood-biased, diversity-aware pick of the final colors.
 * Pure functions (no DOM) — the caller hands in RGBA pixels.
 */
import { deltaE, labChroma, labToRgb, linearRgbToLab, toHex, type LAB } from './colormath';

export type Mood = 'balanced' | 'colorful' | 'bright' | 'muted' | 'deep' | 'dark';
export const MOODS: { id: Mood; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'colorful', label: 'Colorful' },
  { id: 'bright', label: 'Bright' },
  { id: 'muted', label: 'Muted' },
  { id: 'deep', label: 'Deep' },
  { id: 'dark', label: 'Dark' },
];

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && MOODS.some((m) => m.id === value);
}

/** Small deterministic PRNG (mulberry32) so extraction results are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LIN = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return lut;
})();

export interface LabSamples {
  /** Lab triplets. */
  lab: Float64Array;
  /** Pixel coordinates (x, y) of every sample in the source image. */
  xy: Uint32Array;
  count: number;
}

/**
 * Converts RGBA pixels to Lab samples. Transparent pixels are skipped; `maxSamples`
 * bounds the work by sampling on a regular grid.
 */
export function pixelsToLab(data: Uint8ClampedArray | Uint8Array, width: number, height: number, maxSamples = 40_000): LabSamples {
  const total = width * height;
  const step = Math.max(1, Math.sqrt(total / Math.max(1, maxSamples)));
  const cols = Math.max(1, Math.floor(width / step));
  const rows = Math.max(1, Math.floor(height / step));
  const lab = new Float64Array(cols * rows * 3);
  const xy = new Uint32Array(cols * rows * 2);
  let n = 0;
  for (let gy = 0; gy < rows; gy++) {
    const y = Math.min(height - 1, Math.floor((gy + 0.5) * step));
    for (let gx = 0; gx < cols; gx++) {
      const x = Math.min(width - 1, Math.floor((gx + 0.5) * step));
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const c = linearRgbToLab(LIN[data[i]], LIN[data[i + 1]], LIN[data[i + 2]]);
      lab[n * 3] = c.l;
      lab[n * 3 + 1] = c.a;
      lab[n * 3 + 2] = c.b;
      xy[n * 2] = x;
      xy[n * 2 + 1] = y;
      n++;
    }
  }
  return { lab: lab.subarray(0, n * 3), xy: xy.subarray(0, n * 2), count: n };
}

function dist2(points: Float64Array, i: number, c: Float64Array, j: number): number {
  const dl = points[i * 3] - c[j * 3];
  const da = points[i * 3 + 1] - c[j * 3 + 1];
  const db = points[i * 3 + 2] - c[j * 3 + 2];
  return dl * dl + da * da + db * db;
}

/** k-means++ seeding: first center at random, next ones proportional to squared distance. */
export function kmeansPlusPlus(points: Float64Array, count: number, k: number, rng: () => number): Float64Array {
  const centers = new Float64Array(k * 3);
  if (!count) return centers;
  const first = Math.floor(rng() * count);
  centers.set(points.subarray(first * 3, first * 3 + 3), 0);
  const d = new Float64Array(count).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const dd = dist2(points, i, centers, c - 1);
      if (dd < d[i]) d[i] = dd;
      sum += d[i];
    }
    let pick = 0;
    if (sum > 0) {
      let r = rng() * sum;
      for (let i = 0; i < count; i++) {
        r -= d[i];
        if (r <= 0) {
          pick = i;
          break;
        }
        pick = i;
      }
    } else {
      pick = Math.floor(rng() * count);
    }
    centers.set(points.subarray(pick * 3, pick * 3 + 3), c * 3);
  }
  return centers;
}

export interface KMeansResult {
  centers: LAB[];
  counts: number[];
  assignments: Int32Array;
  iterations: number;
}

/** Lloyd's k-means on Lab points (Float64Array of triplets). */
export function kmeans(points: Float64Array, k: number, options: { seed?: number; maxIterations?: number; tolerance?: number } = {}): KMeansResult {
  const count = Math.floor(points.length / 3);
  const kk = Math.max(1, Math.min(k, count || 1));
  const rng = mulberry32(options.seed ?? 1);
  const centers = kmeansPlusPlus(points, count, kk, rng);
  const assignments = new Int32Array(count);
  const sums = new Float64Array(kk * 3);
  const counts = new Float64Array(kk);
  const maxIterations = options.maxIterations ?? 40;
  const tolerance = options.tolerance ?? 0.01;
  let iterations = 0;
  for (; iterations < maxIterations && count; iterations++) {
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const dd = dist2(points, i, centers, c);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      assignments[i] = best;
      counts[best]++;
      sums[best * 3] += points[i * 3];
      sums[best * 3 + 1] += points[i * 3 + 1];
      sums[best * 3 + 2] += points[i * 3 + 2];
    }
    let moved = 0;
    for (let c = 0; c < kk; c++) {
      if (!counts[c]) {
        // empty cluster: re-seed on a random point
        const p = Math.floor(rng() * count);
        centers.set(points.subarray(p * 3, p * 3 + 3), c * 3);
        moved = Infinity;
        continue;
      }
      const nl = sums[c * 3] / counts[c];
      const na = sums[c * 3 + 1] / counts[c];
      const nb = sums[c * 3 + 2] / counts[c];
      moved = Math.max(moved, Math.hypot(nl - centers[c * 3], na - centers[c * 3 + 1], nb - centers[c * 3 + 2]));
      centers[c * 3] = nl;
      centers[c * 3 + 1] = na;
      centers[c * 3 + 2] = nb;
    }
    if (moved < tolerance) {
      iterations++;
      break;
    }
  }
  const out: LAB[] = [];
  for (let c = 0; c < kk; c++) out.push({ l: centers[c * 3], a: centers[c * 3 + 1], b: centers[c * 3 + 2] });
  return { centers: out, counts: Array.from(counts), assignments, iterations };
}

/* ---------------------------------- Moods ---------------------------------- */

/** How well a color fits a mood, roughly 0–1. */
export function moodScore(lab: LAB, mood: Mood): number {
  const L = lab.l / 100;
  const C = Math.min(1, labChroma(lab) / 100);
  switch (mood) {
    case 'colorful':
      return C * 0.85 + (1 - Math.abs(L - 0.6)) * 0.15;
    case 'bright':
      return L * 0.55 + C * 0.45;
    case 'muted':
      return (1 - Math.min(1, C / 0.45)) * 0.55 + (1 - Math.abs(L - 0.62) / 0.62) * 0.45;
    case 'deep':
      return C * 0.55 + (1 - Math.abs(L - 0.35) / 0.65) * 0.45;
    case 'dark':
      return 1 - L;
    default:
      return 0;
  }
}

export interface ExtractedColor {
  hex: string;
  lab: LAB;
  /** Pixel position of the representative pixel in the source image. */
  x: number;
  y: number;
  /** Share of the image covered by its cluster (0–1). */
  share: number;
}

export interface ExtractOptions {
  count: number;
  mood?: Mood;
  seed?: number;
  maxSamples?: number;
}

/** Picks `n` clusters favouring the mood and population while keeping them distinct. */
export function selectClusters(centers: LAB[], counts: number[], n: number, mood: Mood): number[] {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const candidates = centers
    .map((lab, i) => {
      const share = counts[i] / total;
      const pop = Math.sqrt(share);
      const score = mood === 'balanced' ? pop : moodScore(lab, mood) * 0.72 + pop * 0.28;
      return { i, lab, score, share };
    })
    .filter((c) => c.share > 0);
  const chosen: typeof candidates = [];
  while (chosen.length < Math.min(n, candidates.length)) {
    let best: (typeof candidates)[number] | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (chosen.includes(c)) continue;
      const nearest = chosen.length ? Math.min(...chosen.map((x) => deltaE(x.lab, c.lab))) : Infinity;
      const diversity = nearest === Infinity ? 1 : Math.min(1, nearest / 18);
      const s = c.score * (0.1 + 0.9 * diversity);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map((c) => c.i);
}

/**
 * Extracts a palette from RGBA pixels. Each color is a real pixel of the image (the one
 * of its cluster that best fits the mood while staying close to the cluster center),
 * so it can be shown as a draggable picker point.
 */
export function extractPalette(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: ExtractOptions,
): ExtractedColor[] {
  const n = Math.max(1, Math.min(12, Math.round(options.count)));
  const mood = options.mood ?? 'balanced';
  const samples = pixelsToLab(data, width, height, options.maxSamples ?? 24_000);
  if (!samples.count) return [];
  const k = mood === 'balanced' ? Math.max(n, Math.min(16, n + 3)) : Math.max(n, Math.min(18, n * 3));
  const result = kmeans(samples.lab, k, { seed: options.seed ?? 7 });
  const picked = selectClusters(result.centers, result.counts, n, mood);
  const total = samples.count;
  const out: ExtractedColor[] = [];
  const diag = Math.hypot(width, height) || 1;
  for (const c of picked) {
    const center = result.centers[c];
    // spatial center of the cluster, so the picker lands inside the region rather than at its edge
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < samples.count; i++) {
      if (result.assignments[i] !== c) continue;
      sx += samples.xy[i * 2];
      sy += samples.xy[i * 2 + 1];
      n++;
    }
    sx /= n || 1;
    sy /= n || 1;
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < samples.count; i++) {
      if (result.assignments[i] !== c) continue;
      const lab = { l: samples.lab[i * 3], a: samples.lab[i * 3 + 1], b: samples.lab[i * 3 + 2] };
      const closeness = -deltaE(lab, center) / 25;
      const spatial = -Math.hypot(samples.xy[i * 2] - sx, samples.xy[i * 2 + 1] - sy) / diag;
      const s = (mood === 'balanced' ? closeness : closeness + moodScore(lab, mood) * 0.6) + spatial * 0.5;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) continue;
    const lab = { l: samples.lab[best * 3], a: samples.lab[best * 3 + 1], b: samples.lab[best * 3 + 2] };
    out.push({
      hex: toHex(labToRgb(lab)),
      lab,
      x: samples.xy[best * 2],
      y: samples.xy[best * 2 + 1],
      share: result.counts[c] / total,
    });
  }
  return out;
}

/** Average color of a (2r+1)² neighbourhood around (x, y). */
export function sampleAverage(data: Uint8ClampedArray | Uint8Array, width: number, height: number, x: number, y: number, radius = 1): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let yy = Math.max(0, cy - radius); yy <= Math.min(height - 1, cy + radius); yy++) {
    for (let xx = Math.max(0, cx - radius); xx <= Math.min(width - 1, cx + radius); xx++) {
      const i = (yy * width + xx) * 4;
      if (data[i + 3] < 8) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  if (!n) return '#000000';
  return toHex({ r: r / n, g: g / n, b: b / n });
}
