import type { TimeRange } from './types';

/* Pure silence detection on mono PCM samples. */

export interface SilenceOptions {
  /** Windows quieter than this (dBFS RMS) count as silent. */
  thresholdDb: number;
  /** Only silent stretches at least this long (seconds) are reported. */
  minDuration: number;
  /** Seconds of audio kept on each side of a cut so speech isn't clipped. */
  padding: number;
  /** Analysis window (seconds). */
  window?: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { thresholdDb: -40, minDuration: 0.6, padding: 0.12, window: 0.02 };

/** RMS level in dBFS per window. */
export function rmsDb(samples: Float32Array, sampleRate: number, windowSec = 0.02): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * windowSec));
  const count = Math.ceil(samples.length / size);
  const out = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    const from = w * size;
    const to = Math.min(samples.length, from + size);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    out[w] = rms > 0 ? 20 * Math.log10(rms) : -120;
  }
  return out;
}

/**
 * Finds silent ranges. `offset` is added to the returned times (e.g. the start of the
 * analysed timeline range). Ranges touching the start/end are kept (with padding only
 * on the side that borders sound).
 */
export function detectSilences(samples: Float32Array, sampleRate: number, options: Partial<SilenceOptions> = {}, offset = 0): TimeRange[] {
  const o = { ...DEFAULT_SILENCE, ...options };
  const win = o.window ?? 0.02;
  const levels = rmsDb(samples, sampleRate, win);
  const total = samples.length / sampleRate;
  const out: TimeRange[] = [];
  let runStart = -1;
  const flush = (endIndex: number) => {
    if (runStart < 0) return;
    const start = runStart * win;
    const end = Math.min(total, endIndex * win);
    runStart = -1;
    if (end - start < o.minDuration) return;
    const s = start <= 0 ? 0 : start + o.padding;
    const e = end >= total - 1e-9 ? total : end - o.padding;
    if (e - s > 0.01) out.push({ start: s + offset, end: e + offset });
  };
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] < o.thresholdDb) {
      if (runStart < 0) runStart = i;
    } else flush(i);
  }
  flush(levels.length);
  return out;
}

export function totalLength(ranges: TimeRange[]): number {
  return ranges.reduce((n, r) => n + Math.max(0, r.end - r.start), 0);
}

/** Complement of `ranges` inside [0, total]. */
export function invertRanges(ranges: TimeRange[], total: number): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  let t = 0;
  for (const r of sorted) {
    if (r.start > t) out.push({ start: t, end: Math.min(r.start, total) });
    t = Math.max(t, r.end);
  }
  if (t < total) out.push({ start: t, end: total });
  return out.filter((r) => r.end - r.start > 1e-9);
}
