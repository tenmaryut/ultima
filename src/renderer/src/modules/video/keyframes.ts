import type { Clip, Easing, Keyframe, KeyProp, VisualProps } from './types';
import { DEFAULT_AUDIO_FX, DEFAULT_VISUAL, MAX_SPEED, MIN_SPEED } from './presets';

/*
 * Keyframes, speed ramps, reverse and freeze frames (pure, unit tested). Keyframe times are
 * seconds from the clip start on the timeline; the value holds before the first and after the
 * last keyframe, and `ease` shapes the curve towards the next one.
 */

export const KEY_PROPS: readonly KeyProp[] = [
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'blur',
  'brightness',
  'contrast',
  'saturation',
  'hue',
  'temperature',
  'shake',
  'glow',
  'rgbSplit',
  'motionBlur',
  'zoomBlur',
  'vignette',
  'sharpen',
  'grain',
  'letterbox',
  'volume',
  'lowPass',
];
/** Properties of the sound (the others belong to the picture). */
export const AUDIO_KEY_PROPS: readonly KeyProp[] = ['volume', 'lowPass'];
export const VISUAL_KEY_PROPS = KEY_PROPS.filter((k) => !AUDIO_KEY_PROPS.includes(k)) as Exclude<KeyProp, 'volume' | 'lowPass'>[];
export const EASINGS: readonly Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];

/** Valid range of each animatable property (volume in dB). */
export const KEY_RANGES: Record<KeyProp, [number, number]> = {
  x: [-100000, 100000],
  y: [-100000, 100000],
  scale: [0.05, 10],
  rotation: [-3600, 3600],
  opacity: [0, 1],
  blur: [0, 50],
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  hue: [-180, 180],
  temperature: [-100, 100],
  shake: [0, 400],
  glow: [0, 1],
  rgbSplit: [0, 200],
  motionBlur: [0, 600],
  zoomBlur: [0, 1],
  vignette: [0, 1],
  sharpen: [0, 1],
  grain: [0, 1],
  letterbox: [0, 0.3],
  volume: [-60, 12],
  lowPass: [20, 22000],
};

/** A low-pass at this frequency (Hz) or higher lets everything through. */
export const OPEN_LOW_PASS = 22000;

export function ease(kind: Easing, p: number): number {
  const x = Math.min(1, Math.max(0, p));
  switch (kind) {
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'hold':
      return 0;
    default:
      return x;
  }
}

/** Value of a keyframe track at `local` seconds (or `fallback` without keyframes). */
export function keyValue(keys: Keyframe[] | undefined, local: number, fallback: number): number {
  if (!keys?.length) return fallback;
  if (local <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (local >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (local <= b.t) {
      const span = b.t - a.t;
      const p = span > 1e-9 ? (local - a.t) / span : 1;
      return a.v + (b.v - a.v) * ease(a.ease, p);
    }
  }
  return last.v;
}

/** Adds or replaces the keyframe at `t` (within `tolerance` seconds); returns a new sorted list. */
export function upsertKey(keys: Keyframe[] | undefined, t: number, v: number, easing?: Easing, tolerance = 1 / 120): Keyframe[] {
  const list = (keys ?? []).filter((k) => Math.abs(k.t - t) > tolerance);
  const old = keys?.find((k) => Math.abs(k.t - t) <= tolerance);
  list.push({ t: Math.max(0, t), v, ease: easing ?? old?.ease ?? 'easeInOut' });
  return list.sort((a, b) => a.t - b.t);
}

export function removeKeyAt(keys: Keyframe[] | undefined, t: number, tolerance = 1 / 120): Keyframe[] {
  return (keys ?? []).filter((k) => Math.abs(k.t - t) > tolerance);
}

/**
 * Keyframes after the clip's content moved by `dt` seconds (trimming the start by d moves them
 * by −d) and the clip got `duration` long. Keys that fall outside are dropped, but the values at
 * the new edges are kept with a keyframe there.
 */
export function shiftKeys(keys: Keyframe[] | undefined, dt: number, duration: number, fine = false): Keyframe[] | undefined {
  if (!keys?.length) return keys;
  const at0 = keyValue(keys, -dt, keys[0].v);
  const atEnd = keyValue(keys, duration - dt, keys[keys.length - 1].v);
  const easeAt = (t: number) => [...keys].reverse().find((k) => k.t <= t)?.ease ?? keys[0].ease;
  const inside = keys.map((k) => ({ ...k, t: k.t + dt })).filter((k) => k.t > 1e-6 && k.t < duration - 1e-6);
  const out: Keyframe[] = [];
  if (keys.some((k) => k.t + dt <= 1e-6) || inside.length === 0) out.push({ t: 0, v: at0, ease: easeAt(-dt) });
  out.push(...inside);
  if (keys.some((k) => k.t + dt >= duration - 1e-6)) out.push({ t: duration, v: atEnd, ease: 'linear' });
  return keepShape(dedupe(out), (t) => keyValue(keys, t - dt, keys[0].v), fine);
}

/**
 * A curve cut inside an eased segment no longer has the same shape with the same easing over the
 * shorter span: such segments become short linear pieces of the original curve, so the motion
 * stays the same after a split or trim. `fine` (speed ramps) uses more pieces, so the source a
 * ramp plays stays within milliseconds and cuts don't jump.
 */
function keepShape(keys: Keyframe[], original: (t: number) => number, fine: boolean): Keyframe[] {
  const out: Keyframe[] = [];
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (!b || a.ease === 'linear' || a.ease === 'hold') {
      out.push(a);
      continue;
    }
    const same = [0.25, 0.5, 0.75].every((f) => {
      const t = a.t + (b.t - a.t) * f;
      const want = original(t);
      return Math.abs(keyValue(keys, t, want) - want) <= 1e-6 * (1 + Math.abs(want));
    });
    if (same) {
      out.push(a);
      continue;
    }
    const pieces = fine ? Math.max(4, Math.min(16, Math.ceil((b.t - a.t) * 8))) : Math.max(3, Math.min(6, Math.ceil((b.t - a.t) * 4)));
    out.push({ ...a, ease: 'linear' });
    for (let j = 1; j < pieces; j++) {
      const t = a.t + ((b.t - a.t) * j) / pieces;
      out.push({ t, v: original(t), ease: 'linear' });
    }
  }
  return out;
}

function dedupe(keys: Keyframe[]): Keyframe[] {
  const out: Keyframe[] = [];
  for (const k of keys.sort((a, b) => a.t - b.t)) {
    if (out.length && Math.abs(out[out.length - 1].t - k.t) < 1e-6) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

/** Keyframe times stretched by `factor` (the clip got `factor` times longer). */
export function scaleKeys(keys: Keyframe[] | undefined, factor: number): Keyframe[] | undefined {
  return keys?.map((k) => ({ ...k, t: k.t * factor }));
}

/** All keyframe tracks of a clip shifted / clipped like `shiftKeys`. */
export function shiftClipKeys(c: Clip, dt: number, duration: number): Pick<Clip, 'keys' | 'speedKeys'> {
  let keys: Clip['keys'];
  if (c.keys) {
    keys = {};
    for (const [k, list] of Object.entries(c.keys) as [KeyProp, Keyframe[]][]) {
      const next = shiftKeys(list, dt, duration);
      if (next?.length) keys[k] = next;
    }
    if (!Object.keys(keys).length) keys = undefined;
  }
  return { keys, speedKeys: c.speedKeys?.length ? shiftKeys(c.speedKeys, dt, duration, true) : undefined };
}

export const hasKeys = (c: Clip) => Boolean(c.keys && Object.values(c.keys).some((l) => l?.length));

/** The visual properties of a clip at `local` seconds, keyframes applied. */
export function animatedVisual(c: Clip, local: number): VisualProps {
  const v = c.visual ?? DEFAULT_VISUAL;
  if (!c.keys) return v;
  let out: VisualProps | null = null;
  for (const k of VISUAL_KEY_PROPS) {
    const list = c.keys[k];
    if (!list?.length) continue;
    if (!out) out = { ...v };
    out[k] = keyValue(list, local, v[k]);
  }
  return out ?? v;
}

/** Volume (dB) of a clip at `local` seconds. */
export function animatedVolume(c: Clip, local: number): number {
  return keyValue(c.keys?.volume, local, c.volume);
}

/** Low-pass frequency (Hz) of a clip at `local` seconds (OPEN_LOW_PASS = off). */
export function animatedLowPass(c: Clip, local: number): number {
  return keyValue(c.keys?.lowPass, local, c.audioFx?.lowPass || OPEN_LOW_PASS);
}

/* ------------------------------ Editing helpers ------------------------------ */

/** Two keyframes closer than this (seconds) are the same keyframe. */
export const KEY_TOLERANCE = 1 / 120;

const localIn = (c: Clip, local: number) => Math.min(Math.max(0, local), c.duration);

/** The plain (not animated) value of a property. */
export function baseValue(c: Clip, prop: KeyProp): number {
  if (prop === 'volume') return c.volume;
  if (prop === 'lowPass') return c.audioFx?.lowPass || OPEN_LOW_PASS;
  return (c.visual ?? DEFAULT_VISUAL)[prop];
}

/** Value of a property at `local` seconds into the clip. */
export function valueAt(c: Clip, prop: KeyProp, local: number): number {
  return keyValue(c.keys?.[prop], local, baseValue(c, prop));
}

/** Sets a property at `local` seconds: an animated property gets a keyframe there, a plain one a new value. */
export function setValueAt(c: Clip, prop: KeyProp, local: number, v: number): Clip {
  const keys = c.keys?.[prop];
  if (keys?.length) return { ...c, keys: { ...c.keys, [prop]: upsertKey(keys, localIn(c, local), v) } };
  if (prop === 'volume') return { ...c, volume: v };
  if (prop === 'lowPass') return { ...c, audioFx: { ...(c.audioFx ?? DEFAULT_AUDIO_FX), lowPass: v >= OPEN_LOW_PASS ? 0 : v } };
  return { ...c, visual: { ...(c.visual ?? DEFAULT_VISUAL), [prop]: v } };
}

/** Removes the keyframes of one property (or of all), keeping the plain values. */
export function withoutKeys(c: Clip, prop?: KeyProp): Clip {
  if (!c.keys) return c;
  if (!prop) return { ...c, keys: undefined };
  if (!c.keys[prop]) return c;
  const keys = { ...c.keys };
  delete keys[prop];
  return { ...c, keys: Object.keys(keys).length ? keys : undefined };
}

/** Adds a keyframe at `local` with the value shown there, or removes the keyframe that is there. */
export function toggleKeyAt(c: Clip, prop: KeyProp, local: number): Clip {
  const t = localIn(c, local);
  const keys = c.keys?.[prop];
  const here = keys?.find((k) => Math.abs(k.t - t) <= KEY_TOLERANCE);
  if (!here) return { ...c, keys: { ...c.keys, [prop]: upsertKey(keys, t, valueAt(c, prop, t)) } };
  const rest = removeKeyAt(keys, t);
  if (rest.length) return { ...c, keys: { ...c.keys, [prop]: rest } };
  // the last keyframe goes: its value stays as the plain value, so nothing jumps
  return setValueAt(withoutKeys(c, prop), prop, t, here.v);
}

/** Sets the easing of every keyframe at `local` (towards the next keyframe). */
export function setEaseAt(c: Clip, local: number, easing: Easing): Clip {
  if (!c.keys) return c;
  const keys: Clip['keys'] = {};
  for (const [prop, list] of Object.entries(c.keys) as [KeyProp, Keyframe[]][]) keys[prop] = list.map((k) => (Math.abs(k.t - local) <= KEY_TOLERANCE ? { ...k, ease: easing } : k));
  return { ...c, keys };
}

/** Sorted keyframe times (clip seconds) of all properties of a clip. */
export function keyTimes(c: Clip): number[] {
  const out: number[] = [];
  for (const list of Object.values(c.keys ?? {})) for (const k of list ?? []) if (!out.some((t) => Math.abs(t - k.t) <= KEY_TOLERANCE)) out.push(k.t);
  return out.sort((a, b) => a - b);
}

/* ------------------------------- Time mapping ------------------------------- */

const RAMP_STEP = 1 / 240;
const rampCache = new WeakMap<Keyframe[], Float64Array>();

const clampSpeed = (s: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, s));

/** Speed of a clip at `local` seconds (its ramp, or its constant speed). */
export function speedAt(c: Clip, local: number): number {
  if (c.freeze) return 0;
  return c.speedKeys?.length ? clampSpeed(keyValue(c.speedKeys, local, c.speed)) : c.speed;
}

/** Seconds of source played from the clip start to `local` (the integral of the speed). */
export function sourceOffset(c: Clip, local: number): number {
  if (c.freeze) return 0;
  const keys = c.speedKeys;
  if (!keys?.length) return Math.max(0, local) * c.speed;
  let table = rampCache.get(keys);
  const needed = Math.ceil(Math.max(local, keys[keys.length - 1].t) / RAMP_STEP) + 2;
  if (!table || table.length < needed) {
    const n = Math.max(needed, table ? table.length * 2 : 0);
    table = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const t0 = (i - 1) * RAMP_STEP;
      const s0 = clampSpeed(keyValue(keys, t0, c.speed));
      const s1 = clampSpeed(keyValue(keys, t0 + RAMP_STEP, c.speed));
      table[i] = table[i - 1] + 0.5 * (s0 + s1) * RAMP_STEP;
    }
    rampCache.set(keys, table);
  }
  const x = Math.max(0, local) / RAMP_STEP;
  const i = Math.floor(x);
  if (i >= table.length - 1) return table[table.length - 1];
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

/** Seconds of source the whole clip uses. */
export function sourceSpan(c: Clip): number {
  return sourceOffset(c, c.duration);
}

/** Source time of a clip at `local` seconds into it (reverse and freeze included). */
export function sourceAt(c: Clip, local: number): number {
  if (c.freeze) return c.in;
  const off = sourceOffset(c, Math.min(Math.max(0, local), c.duration));
  return c.reverse ? c.in + sourceSpan(c) - off : c.in + off;
}

/** Timeline seconds at which a clip shows `source` seconds of its media, or null when it doesn't. */
export function timeOfSource(c: Clip, source: number): number | null {
  if (c.freeze) return null;
  const span = sourceSpan(c);
  const off = c.reverse ? c.in + span - source : source - c.in;
  if (off < -1e-6 || off > span + 1e-6) return null;
  let local: number;
  if (!c.speedKeys?.length) local = off / c.speed;
  else {
    // the source offset only grows with time, so a bisection finds the moment
    let lo = 0;
    let hi = c.duration;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (sourceOffset(c, mid) < off) lo = mid;
      else hi = mid;
    }
    local = (lo + hi) / 2;
  }
  return c.start + Math.min(Math.max(0, local), c.duration);
}

/** True when the clip's time runs differently from a plain constant-speed clip. */
export const isRemapped = (c: Clip) => Boolean(c.freeze || c.reverse || c.speedKeys?.length);

/* ------------------------------ Speed ramp presets ------------------------------ */

export type RampPreset = 'slowFastSlow' | 'fastSlowFast' | 'slowToFast' | 'fastToSlow' | 'hit';

export const RAMP_PRESETS: { id: RampPreset; label: string }[] = [
  { id: 'hit', label: 'Montage hit (fast → slow-mo → fast)' },
  { id: 'fastSlowFast', label: 'Slow-mo in the middle' },
  { id: 'slowFastSlow', label: 'Speed up in the middle' },
  { id: 'slowToFast', label: 'Slow to fast' },
  { id: 'fastToSlow', label: 'Fast to slow' },
];

/** Speed keyframes of a preset for a clip of `duration` seconds, with `fast` and `slow` speeds. */
export function rampPreset(id: RampPreset, duration: number, fast = 2, slow = 0.35): Keyframe[] {
  const d = Math.max(0.1, duration);
  switch (id) {
    case 'hit':
      return [
        { t: 0, v: fast, ease: 'easeInOut' },
        { t: d * 0.35, v: slow, ease: 'linear' },
        { t: d * 0.65, v: slow, ease: 'easeInOut' },
        { t: d, v: fast, ease: 'linear' },
      ];
    case 'fastSlowFast':
      return [
        { t: 0, v: 1, ease: 'easeInOut' },
        { t: d * 0.4, v: slow, ease: 'linear' },
        { t: d * 0.6, v: slow, ease: 'easeInOut' },
        { t: d, v: 1, ease: 'linear' },
      ];
    case 'slowFastSlow':
      return [
        { t: 0, v: 1, ease: 'easeInOut' },
        { t: d * 0.5, v: fast, ease: 'easeInOut' },
        { t: d, v: 1, ease: 'linear' },
      ];
    case 'slowToFast':
      return [
        { t: 0, v: slow, ease: 'easeIn' },
        { t: d, v: fast, ease: 'linear' },
      ];
    case 'fastToSlow':
      return [
        { t: 0, v: fast, ease: 'easeOut' },
        { t: d, v: slow, ease: 'linear' },
      ];
  }
}
