import type { Clip, Keyframe, TimeRange } from './types';
import { animatedVolume, sourceAt } from './keyframes';
import { clipEnd } from './model';

/*
 * Auto ducking (pure, unit tested): find where the trigger sound (voice, game sound) is loud and
 * lower the music there with volume keyframes — a side-chain done once, editable afterwards.
 */

export interface Envelope {
  /** Values per second. */
  rate: number;
  /** RMS level in dB. */
  db: Float32Array;
}

export interface DuckOptions {
  /** dB the music goes down (negative). */
  amount: number;
  /** Seconds the music takes to go down before the sound starts, and to come back after it. */
  attack: number;
  release: number;
}

export const DEFAULT_DUCK: DuckOptions = { amount: -12, attack: 0.15, release: 0.45 };

/** The quiet level of a recording: the 20th percentile of its levels (dB). */
export function noiseFloor(env: Envelope): number {
  const vals = Array.from(env.db).filter((v) => v > -119);
  if (!vals.length) return -120;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.2)];
}

/**
 * Timeline ranges where trigger clips are loud: their level (their own volume included) is above
 * `threshold` dB, or 12 dB above their noise floor when no threshold is given. Gaps shorter than
 * `gap` seconds are bridged and blips shorter than `minLength` are ignored.
 */
export function activeRanges(triggers: { clip: Clip; env: Envelope }[], opts: { threshold?: number; gap?: number; minLength?: number } = {}): TimeRange[] {
  const gap = opts.gap ?? 0.35;
  const minLength = opts.minLength ?? 0.1;
  const raw: TimeRange[] = [];
  for (const { clip, env } of triggers) {
    if (clip.freeze || !env.db.length) continue;
    const thr = opts.threshold ?? Math.max(-50, noiseFloor(env) + 12);
    const step = 1 / env.rate;
    let open: number | null = null;
    for (let t = clip.start; t < clipEnd(clip) + step / 2; t += step) {
      const local = Math.min(clip.duration, t - clip.start);
      const i = Math.round(sourceAt(clip, local) * env.rate);
      const level = i >= 0 && i < env.db.length && t < clipEnd(clip) ? env.db[i] + animatedVolume(clip, local) : -200;
      if (level > thr && open === null) open = t;
      else if (level <= thr && open !== null) {
        raw.push({ start: open, end: t });
        open = null;
      }
    }
    if (open !== null) raw.push({ start: open, end: clipEnd(clip) });
  }
  raw.sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end <= gap) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged.filter((r) => r.end - r.start >= minLength);
}

/** Volume keyframes that lower a clip by `amount` dB during `ranges` (undefined when none fall inside it). */
export function duckKeys(target: Clip, ranges: TimeRange[], opts: DuckOptions = DEFAULT_DUCK): Keyframe[] | undefined {
  const base = target.volume;
  const low = Math.max(-60, Math.min(12, base + opts.amount));
  const d = target.duration;
  const local = ranges
    .map((r) => ({ s: r.start - target.start, e: r.end - target.start }))
    .filter((r) => r.e > 0 && r.s < d)
    .sort((a, b) => a.s - b.s);
  // ranges whose ramps would overlap become one dip
  const dips: { s: number; e: number }[] = [];
  for (const r of local) {
    const last = dips[dips.length - 1];
    if (last && r.s - opts.attack <= last.e + opts.release) last.e = Math.max(last.e, r.e);
    else dips.push({ ...r });
  }
  if (!dips.length) return undefined;
  const keys: Keyframe[] = [];
  const at = (t: number) => Math.min(d, Math.max(0, t));
  for (const { s, e } of dips) {
    if (s - opts.attack > 0) keys.push({ t: at(s - opts.attack), v: base, ease: 'easeInOut' });
    keys.push({ t: at(s), v: low, ease: 'linear' });
    keys.push({ t: at(e), v: low, ease: 'easeInOut' });
    if (e + opts.release < d) keys.push({ t: at(e + opts.release), v: base, ease: 'linear' });
  }
  // keys clamped onto the same time: the later one wins
  const out: Keyframe[] = [];
  for (const k of keys) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - k.t) < 1e-4) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}
