import type { Clip, Keyframe, KeyProp, Project } from './types';
import type { MediaAnalysis } from './analysisStore';
import { clipEnd, findTopVideoTrack, getClip, getMedia, insertClips, makeClip, timelineDuration, updateClip } from './model';
import { KEY_RANGES, keyValue, timeOfSource, valueAt } from './keyframes';

/*
 * Beat-synced effects: a shake, zoom punch, flash, RGB split… on every beat, bar, hit or loud moment, written as
 * keyframe pulses (rise into the beat, peak on it, decay after it) on an adjustment layer — so everything below
 * reacts to the music — or on chosen clips. The times come from the audio analysis of the clips on the timeline.
 */

export type BeatEffect = 'impact' | 'shake' | 'zoom' | 'flash' | 'rgbSplit' | 'glow' | 'zoomBlur';
export type BeatSource = 'beats' | 'bars' | 'hits' | 'loud';

interface Pulse {
  prop: KeyProp;
  rest: number;
  /** Value at the beat for amount 1. */
  peak: number;
  /** Seconds from rest to the peak, and from the peak back to rest. */
  attack: number;
  decay: number;
}

const PULSES: Record<BeatEffect, Pulse[]> = {
  shake: [{ prop: 'shake', rest: 0, peak: 70, attack: 0.02, decay: 0.28 }],
  zoom: [{ prop: 'scale', rest: 1, peak: 1.16, attack: 0.04, decay: 0.32 }],
  flash: [{ prop: 'brightness', rest: 0, peak: 70, attack: 0.01, decay: 0.2 }],
  rgbSplit: [{ prop: 'rgbSplit', rest: 0, peak: 26, attack: 0.01, decay: 0.24 }],
  glow: [{ prop: 'glow', rest: 0, peak: 0.85, attack: 0.03, decay: 0.34 }],
  zoomBlur: [{ prop: 'zoomBlur', rest: 0, peak: 0.45, attack: 0.02, decay: 0.22 }],
  // the montage hit: punch in, shake, flash and a little RGB split together
  impact: [
    { prop: 'scale', rest: 1, peak: 1.12, attack: 0.03, decay: 0.3 },
    { prop: 'shake', rest: 0, peak: 45, attack: 0.02, decay: 0.26 },
    { prop: 'brightness', rest: 0, peak: 35, attack: 0.01, decay: 0.16 },
    { prop: 'rgbSplit', rest: 0, peak: 14, attack: 0.01, decay: 0.2 },
  ],
};

export const BEAT_EFFECTS: { id: BeatEffect; label: string }[] = [
  { id: 'impact', label: 'Impact (zoom, shake, flash)' },
  { id: 'shake', label: 'Shake' },
  { id: 'zoom', label: 'Zoom punch' },
  { id: 'flash', label: 'Flash' },
  { id: 'rgbSplit', label: 'RGB split' },
  { id: 'glow', label: 'Glow pulse' },
  { id: 'zoomBlur', label: 'Zoom blur' },
];

export const BEAT_SOURCES: { id: BeatSource; label: string }[] = [
  { id: 'beats', label: 'Every beat' },
  { id: 'bars', label: 'Every bar (first beat)' },
  { id: 'hits', label: 'Strongest hits' },
  { id: 'loud', label: 'Loud moments (shots, kills)' },
];

export const isBeatEffect = (v: unknown): v is BeatEffect => typeof v === 'string' && v in PULSES;
export const isBeatSource = (v: unknown): v is BeatSource => v === 'beats' || v === 'bars' || v === 'hits' || v === 'loud';

export type AnalysisOf = (mediaId: string) => MediaAnalysis | 'pending' | null | undefined;

export interface BeatSyncOptions {
  effect: BeatEffect;
  on: BeatSource;
  /** Every n-th beat (1 = all). */
  every?: number;
  /** 0-2, 1 = the preset's strength. */
  amount?: number;
  /** Timeline range (default: the whole timeline). */
  from?: number;
  to?: number;
  /** The clip whose sound gives the times (default: the steadiest music for beats/bars, every clip with sound for hits/loud). */
  sourceClipId?: string;
  /** Clips to animate; default: a new adjustment layer over the range. */
  targetClipIds?: string[];
}

/** Times from one clip's analysis, on the timeline. */
function clipTimes(c: Clip, a: MediaAnalysis, on: BeatSource): number[] {
  const au = a.audio;
  if (!au) return [];
  const source = on === 'beats' ? au.beats?.beats : on === 'bars' ? au.beats?.downbeats : on === 'hits' ? au.hits : au.loud.map((m) => m.time);
  // timeOfSource answers in timeline seconds already
  return (source ?? []).map((t) => timeOfSource(c, t)).filter((t): t is number => t !== null).map((t) => +t.toFixed(4));
}

/** Clips with sound and an analysis, with their beat steadiness. */
function soundClips(p: Project, analysis: AnalysisOf): { clip: Clip; a: MediaAnalysis }[] {
  const out: { clip: Clip; a: MediaAnalysis }[] = [];
  for (const c of p.clips) {
    if ((c.kind !== 'audio' && c.kind !== 'video') || !c.mediaId) continue;
    // a video's sound is analysed with the video; skip its linked audio clip so it isn't counted twice
    if (c.kind === 'audio' && c.linkId && p.clips.some((o) => o.linkId === c.linkId && o.kind === 'video')) continue;
    if (c.kind === 'video' && !getMedia(p, c.mediaId)?.hasAudio) continue;
    const a = analysis(c.mediaId);
    if (a && a !== 'pending' && a.audio) out.push({ clip: c, a });
  }
  return out;
}

/** The music to follow for beats and bars: the steadiest beat, preferring audio clips, that covers the range most. */
function musicClip(list: { clip: Clip; a: MediaAnalysis }[], from: number, to: number) {
  const score = (x: { clip: Clip; a: MediaAnalysis }) => {
    const overlap = Math.max(0, Math.min(to, clipEnd(x.clip)) - Math.max(from, x.clip.start));
    return (x.a.audio?.beats?.confidence ?? 0) * overlap * (x.clip.kind === 'audio' ? 1.5 : 1);
  };
  return [...list].filter((x) => x.a.audio?.beats?.beats.length).sort((x, y) => score(y) - score(x))[0];
}

/** Why nothing was found: the chosen clip has no analysed sound, nothing has a steady beat, nothing with sound is analysed, or the range is empty. */
export type BeatProblem = 'source' | 'noBeat' | 'noSound' | 'none';

/** The timeline times the effect lands on, in order. */
export function beatTimes(p: Project, analysis: AnalysisOf, o: BeatSyncOptions): { times: number[]; sourceClipIds: string[]; problem?: string; reason?: BeatProblem } {
  const from = Math.max(0, o.from ?? 0);
  const to = Math.min(timelineDuration(p), o.to ?? Infinity);
  const sound = soundClips(p, analysis);
  let used: { clip: Clip; a: MediaAnalysis }[];
  if (o.sourceClipId) {
    const c = getClip(p, o.sourceClipId);
    // a linked audio clip stands for its video's sound
    const owner = c?.kind === 'audio' && c.linkId ? p.clips.find((x) => x.linkId === c.linkId && x.kind === 'video') : undefined;
    used = sound.filter((x) => x.clip.id === o.sourceClipId || x.clip.id === owner?.id);
    if (!used.length) return { times: [], sourceClipIds: [], problem: `clip ${o.sourceClipId} has no analysed sound (yet)`, reason: 'source' };
  } else if (o.on === 'beats' || o.on === 'bars') {
    const m = musicClip(sound, from, to);
    used = m ? [m] : [];
    if (!used.length) return sound.length ? { times: [], sourceClipIds: [], problem: 'no clip on the timeline has a steady beat', reason: 'noBeat' } : { times: [], sourceClipIds: [], problem: 'no clip with analysed sound on the timeline (yet)', reason: 'noSound' };
  } else {
    used = sound;
    if (!used.length) return { times: [], sourceClipIds: [], problem: 'no clip with analysed sound on the timeline (yet)', reason: 'noSound' };
  }
  const all = used.flatMap((x) => clipTimes(x.clip, x.a, o.on)).filter((t) => t >= from - 1e-6 && t <= to + 1e-6).sort((a, b) => a - b);
  // hits of several clips can fall together: keep moments at least 0.12 s apart
  const merged: number[] = [];
  for (const t of all) if (!merged.length || t - merged[merged.length - 1] >= 0.12) merged.push(t);
  const every = Math.max(1, Math.round(o.every ?? 1));
  const times = merged.filter((_, i) => i % every === 0);
  if (!times.length) return { times, sourceClipIds: used.map((x) => x.clip.id), problem: `no ${o.on} found in ${from.toFixed(2)}–${Number.isFinite(to) ? to.toFixed(2) : 'end'} s`, reason: 'none' };
  return { times, sourceClipIds: used.map((x) => x.clip.id) };
}

/** The value at the beat: the scale grows by a factor, the other properties by an amount. */
function peakOf(pulse: Pulse, base: number, amount: number): number {
  const [lo, hi] = KEY_RANGES[pulse.prop];
  const v = pulse.prop === 'scale' ? base * (1 + (pulse.peak / pulse.rest - 1) * amount) : base + (pulse.peak - pulse.rest) * amount;
  return Math.min(hi, Math.max(lo, v));
}

interface Pulses {
  keys: Keyframe[];
  /** Where each pulse is, start to end. */
  windows: [number, number][];
  /** Keys that start a rise or a decay (their segment belongs to the pulse). */
  rising: Set<Keyframe>;
}

/**
 * Keyframe pulses of one property at local times (seconds from the clip start), never overlapping: a beat too close
 * to the one before gets no pulse. `base` is the value without the pulses (the clip's own value or animation), so
 * a pulse rides on top of it.
 */
function pulsesOf(pulse: Pulse, locals: number[], amount: number, length: number, base: (t: number) => number): Pulses {
  const out: Pulses = { keys: [], windows: [], rising: new Set() };
  const list: number[] = [];
  for (const t of locals.filter((t) => t >= 0 && t <= length).sort((a, b) => a - b)) if (!list.length || t - list[list.length - 1] >= pulse.attack + 0.03) list.push(t);
  list.forEach((t, i) => {
    const next = list[i + 1];
    const end = +Math.min(t + pulse.decay, next !== undefined ? next - pulse.attack - 0.004 : Infinity, length).toFixed(4);
    const at = +t.toFixed(4);
    if (end <= at + 0.01) return; // the clip ends right after this beat
    const start = +Math.max(t - pulse.attack, 0).toFixed(4);
    const peak: Keyframe = { t: at, v: peakOf(pulse, base(at), amount), ease: 'easeOut' };
    // a beat right at the clip start has no room to rise into: it starts at the peak
    if (start < at) {
      const rise: Keyframe = { t: start, v: base(start), ease: 'easeIn' };
      out.keys.push(rise);
      out.rising.add(rise);
    }
    out.keys.push(peak, { t: end, v: base(end), ease: 'linear' });
    out.rising.add(peak);
    out.windows.push([Math.min(start, at), end]);
  });
  return out;
}

/** The keyframes of `pulsesOf` (rest → peak on each beat → rest). */
export function pulseKeys(pulse: Pulse, locals: number[], amount: number, length: number, base: (t: number) => number = () => pulse.rest): Keyframe[] {
  return pulsesOf(pulse, locals, amount, length, base).keys;
}

/**
 * The clip's keyframes of a property with the pulses added: keys inside a pulse are replaced by it, and between
 * pulses the clip's own animation keeps its shape (eased stretches cut by a pulse become short linear pieces).
 */
function mergePulses(own: Keyframe[] | undefined, pulses: Pulses): Keyframe[] {
  if (!own?.length) return pulses.keys;
  const inPulse = (t: number) => pulses.windows.some(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6);
  const keys = [...own.filter((k) => !inPulse(k.t)), ...pulses.keys].sort((a, b) => a.t - b.t);
  const original = (t: number) => keyValue(own, t, own[0].v);
  const out: Keyframe[] = [];
  keys.forEach((a, i) => {
    const b = keys[i + 1];
    if (!b || pulses.rising.has(a) || a.ease === 'hold') return void out.push(a);
    const same = [0.25, 0.5, 0.75].every((f) => {
      const t = a.t + (b.t - a.t) * f;
      return Math.abs(keyValue(keys, t, 0) - original(t)) <= 1e-6 * (1 + Math.abs(original(t)));
    });
    if (same) return void out.push(a);
    out.push({ ...a, ease: 'linear' });
    const pieces = Math.max(2, Math.min(8, Math.ceil((b.t - a.t) * 4)));
    for (let j = 1; j < pieces; j++) {
      const t = +(a.t + ((b.t - a.t) * j) / pieces).toFixed(4);
      out.push({ t, v: original(t), ease: 'linear' });
    }
  });
  return out;
}

/** Adds the effect: returns the new project, the animated clip ids and how many beats got a pulse. */
export function applyBeatSync(p: Project, analysis: AnalysisOf, o: BeatSyncOptions): { project: Project; clipIds: string[]; count: number; sourceClipIds: string[]; problem?: string } {
  const found = beatTimes(p, analysis, o);
  if (!found.times.length) return { project: p, clipIds: [], count: 0, sourceClipIds: found.sourceClipIds, problem: found.problem };
  const amount = Math.min(2, Math.max(0.05, o.amount ?? 1));
  const pulses = PULSES[o.effect];
  let project = p;
  let clips: Clip[];
  if (o.targetClipIds?.length) {
    clips = o.targetClipIds.map((id) => getClip(p, id)).filter((c): c is Clip => Boolean(c?.visual));
    if (!clips.length) return { project: p, clipIds: [], count: 0, sourceClipIds: found.sourceClipIds, problem: 'none of the target clips has a picture' };
  } else {
    // an adjustment layer from a little before the first beat to a little after the last, above every picture
    const start = Math.max(0, Math.min(o.from ?? found.times[0], found.times[0] - 0.1));
    const end = Math.max(start + 0.3, Math.min(timelineDuration(p) || Infinity, Math.max(o.to ?? 0, found.times[found.times.length - 1] + 0.5)));
    const r = findTopVideoTrack(project, start, end);
    project = r.project;
    const label = BEAT_EFFECTS.find((e) => e.id === o.effect)?.label.split(' (')[0] ?? o.effect;
    const layer = makeClip('adjustment', r.trackId, start, end - start, { name: `Beat FX: ${label}` });
    project = insertClips(project, [layer]);
    clips = [layer];
  }
  let count = 0;
  for (const c of clips) {
    const locals = found.times.map((t) => t - c.start);
    project = updateClip(project, c.id, (x) => {
      const keys = { ...(x.keys ?? {}) };
      for (const pulse of pulses) {
        // the pulse rides on the clip's own value (a zoomed-in clip punches in from its zoom, not from 100%)
        const made = pulsesOf(pulse, locals, amount, x.duration, (t) => valueAt(x, pulse.prop, t));
        count = Math.max(count, made.windows.length);
        if (made.keys.length) keys[pulse.prop] = mergePulses(x.keys?.[pulse.prop], made);
      }
      return { ...x, keys };
    });
  }
  return { project, clipIds: clips.map((c) => c.id), count, sourceClipIds: found.sourceClipIds };
}
