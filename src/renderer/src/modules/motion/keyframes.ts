import { parseColor, toCss, type RGBA } from '../../core/utils/color';
import { ease } from './easing';
import type { AnimProp, Bezier, EasingType, Keyframe, PropValue, Vec2 } from './types';

/** Two keyframes closer than this (seconds) are considered to be at the same time. */
export const TIME_EPSILON = 1e-4;

let keySeq = 0;
/** Unique keyframe id. */
export function newKeyId(): string {
  keySeq = (keySeq + 1) % 1_000_000;
  return `k${Date.now().toString(36)}${keySeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* -------------------------------- Values -------------------------------- */

export function isVec2(v: unknown): v is Vec2 {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

const colorCache = new Map<string, RGBA>();
function rgba(color: string): RGBA {
  let c = colorCache.get(color);
  if (!c) {
    c = parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };
    if (colorCache.size > 2000) colorCache.clear();
    colorCache.set(color, c);
  }
  return c;
}

export function lerpColor(a: string, b: string, t: number): string {
  const ca = rgba(a);
  const cb = rgba(b);
  return toCss({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
    a: Math.max(0, Math.min(1, ca.a + (cb.a - ca.a) * t)),
  });
}

/** Interpolates numbers, [x,y] vectors and CSS colors. */
export function lerpValue<V extends PropValue>(a: V, b: V, t: number): V {
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * t) as V;
  if (isVec2(a) && isVec2(b)) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as V;
  if (typeof a === 'string' && typeof b === 'string') {
    // Colors don't overshoot (back/elastic easings would produce odd hues).
    if (t <= 0) return a;
    if (t >= 1) return b;
    return lerpColor(a, b, t) as V;
  }
  return (t < 1 ? a : b) as V;
}

export function cloneValue<V extends PropValue>(v: V): V {
  return (isVec2(v) ? [v[0], v[1]] : v) as V;
}

export function valuesEqual(a: PropValue, b: PropValue): boolean {
  if (isVec2(a) && isVec2(b)) return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

/* ------------------------------ Evaluation ------------------------------ */

export function isAnimated(prop: AnimProp): boolean {
  return prop.keyframes.length > 0;
}

/** Index of the last keyframe with time <= t (or -1). Keyframes must be sorted. */
export function keyIndexAt(keys: Keyframe[], t: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].time <= t + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Value of an animatable property at composition time `t` (seconds). */
export function evaluateProp<V extends PropValue>(prop: AnimProp<V>, t: number): V {
  const keys = prop.keyframes;
  if (!keys.length) return prop.value;
  if (keys.length === 1 || t <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (t >= last.time) return last.value;
  const i = keyIndexAt(keys, t);
  const k0 = keys[i];
  const k1 = keys[i + 1];
  if (!k1) return k0.value;
  if (k0.easing === 'hold') return k0.value;
  const span = k1.time - k0.time;
  const u = span > 0 ? (t - k0.time) / span : 1;
  return lerpValue(k0.value, k1.value, ease(k0.easing, u, k0.bezier));
}

/* ---------------------------- Keyframe editing --------------------------- */

function sorted<V extends PropValue>(keys: Keyframe<V>[]): Keyframe<V>[] {
  return [...keys].sort((a, b) => a.time - b.time);
}

export function findKeyAt<V extends PropValue>(prop: AnimProp<V>, t: number): Keyframe<V> | undefined {
  return prop.keyframes.find((k) => Math.abs(k.time - t) < TIME_EPSILON);
}

/**
 * Adds a keyframe at time `t`, or updates the value of the keyframe already there.
 * New keyframes inherit the easing of the previous keyframe (or `options.easing`).
 */
export function setKeyframe<V extends PropValue>(
  prop: AnimProp<V>,
  t: number,
  value: V,
  options: { easing?: EasingType; bezier?: Bezier; id?: string } = {},
): AnimProp<V> {
  const existing = findKeyAt(prop, t);
  if (existing) {
    return {
      ...prop,
      keyframes: prop.keyframes.map((k) =>
        k === existing
          ? {
              ...k,
              value: cloneValue(value),
              ...(options.easing ? { easing: options.easing, bezier: options.easing === 'bezier' ? options.bezier : undefined } : {}),
            }
          : k,
      ),
    };
  }
  const prevIndex = keyIndexAt(prop.keyframes, t);
  const prev = prevIndex >= 0 ? prop.keyframes[prevIndex] : prop.keyframes[0];
  const easing = options.easing ?? prev?.easing ?? 'easeInOut';
  const key: Keyframe<V> = {
    id: options.id ?? newKeyId(),
    time: Math.max(0, t),
    value: cloneValue(value),
    easing,
    ...(easing === 'bezier' ? { bezier: options.bezier ?? prev?.bezier } : {}),
  };
  return { ...prop, keyframes: sorted([...prop.keyframes, key]) };
}

/** Changes a property at time `t`: updates/creates a keyframe when animated, else the static value. */
export function setValueAt<V extends PropValue>(prop: AnimProp<V>, t: number, value: V): AnimProp<V> {
  if (isAnimated(prop)) return setKeyframe(prop, t, value);
  return { ...prop, value: cloneValue(value) };
}

/** Stopwatch: on → one keyframe with the current value; off → keep the current value, drop keys. */
export function toggleStopwatch<V extends PropValue>(prop: AnimProp<V>, t: number): AnimProp<V> {
  if (isAnimated(prop)) return { value: cloneValue(evaluateProp(prop, t)), keyframes: [] };
  return setKeyframe({ ...prop, keyframes: [] }, t, prop.value);
}

/** Removes keyframes by id. When none are left the property becomes static (value at `t`). */
export function removeKeyframes<V extends PropValue>(prop: AnimProp<V>, ids: ReadonlySet<string>, t: number): AnimProp<V> {
  if (!prop.keyframes.some((k) => ids.has(k.id))) return prop;
  const keyframes = prop.keyframes.filter((k) => !ids.has(k.id));
  if (keyframes.length) return { ...prop, keyframes };
  return { value: cloneValue(evaluateProp(prop, t)), keyframes: [] };
}

/**
 * Moves keyframes (by id) by `delta` seconds, clamped to [min, max]. A moved keyframe that
 * lands on an unmoved one replaces it (like After Effects).
 */
export function moveKeyframes<V extends PropValue>(
  prop: AnimProp<V>,
  ids: ReadonlySet<string>,
  delta: number,
  bounds: { min: number; max: number },
): AnimProp<V> {
  if (!prop.keyframes.some((k) => ids.has(k.id))) return prop;
  const moved = prop.keyframes
    .filter((k) => ids.has(k.id))
    .map((k) => ({ ...k, time: Math.min(bounds.max, Math.max(bounds.min, k.time + delta)) }));
  const kept = prop.keyframes.filter((k) => !ids.has(k.id) && !moved.some((m) => Math.abs(m.time - k.time) < TIME_EPSILON));
  // Two moved keys landing on the same time: keep the later one in the list.
  const unique: Keyframe<V>[] = [];
  for (const k of moved) {
    const i = unique.findIndex((u) => Math.abs(u.time - k.time) < TIME_EPSILON);
    if (i >= 0) unique[i] = k;
    else unique.push(k);
  }
  return { ...prop, keyframes: sorted([...kept, ...unique]) };
}

/** Sets the easing of keyframes (by id). */
export function setEasing<V extends PropValue>(
  prop: AnimProp<V>,
  ids: ReadonlySet<string>,
  easing: EasingType,
  bezier?: Bezier,
): AnimProp<V> {
  if (!prop.keyframes.some((k) => ids.has(k.id))) return prop;
  return {
    ...prop,
    keyframes: prop.keyframes.map((k) => {
      if (!ids.has(k.id)) return k;
      const next: Keyframe<V> = { ...k, easing };
      if (easing === 'bezier') next.bezier = bezier ?? k.bezier ?? [0.42, 0, 0.58, 1];
      else delete next.bezier;
      return next;
    }),
  };
}

/** Removes keyframes strictly inside (from, to) — used by presets to make room. */
export function clearKeysBetween<V extends PropValue>(prop: AnimProp<V>, from: number, to: number): AnimProp<V> {
  const keyframes = prop.keyframes.filter((k) => k.time <= from + TIME_EPSILON || k.time >= to - TIME_EPSILON);
  return keyframes.length === prop.keyframes.length ? prop : { ...prop, keyframes };
}

/** Shifts all keyframes by `delta` seconds (moving a layer in time). */
export function shiftKeys<V extends PropValue>(prop: AnimProp<V>, delta: number): AnimProp<V> {
  if (!prop.keyframes.length || !delta) return prop;
  return { ...prop, keyframes: prop.keyframes.map((k) => ({ ...k, time: Math.max(0, k.time + delta) })) };
}

/** Copy of a property with fresh keyframe ids (duplicating layers). */
export function cloneProp<V extends PropValue>(prop: AnimProp<V>): AnimProp<V> {
  return { value: cloneValue(prop.value), keyframes: prop.keyframes.map((k) => ({ ...k, id: newKeyId(), value: cloneValue(k.value) })) };
}

/** Time of the nearest keyframe before/after `t` among `times` (or null). */
export function adjacentTime(times: number[], t: number, direction: -1 | 1): number | null {
  let best: number | null = null;
  for (const time of times) {
    if (direction > 0 && time > t + TIME_EPSILON && (best === null || time < best)) best = time;
    if (direction < 0 && time < t - TIME_EPSILON && (best === null || time > best)) best = time;
  }
  return best;
}
