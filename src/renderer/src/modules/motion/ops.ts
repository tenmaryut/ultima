import {
  evaluateProp,
  findKeyAt,
  keyIndexAt,
  newKeyId,
  isAnimated,
  moveKeyframes,
  removeKeyframes,
  setEasing,
  setKeyframe,
  setValueAt,
  toggleStopwatch,
} from './keyframes';
import { getProp, layerById, setLayerProp, updateLayer } from './model';
import type { AnimProp, Bezier, EasingType, Keyframe, KeyRef, Layer, MotionDoc, PropKey, PropValue } from './types';

/** Document operations used by the UI (pure; the UI wraps them in undo steps). */

export interface CopiedKeyframe {
  layerId: string;
  prop: PropKey;
  time: number;
  value: PropValue;
  easing: EasingType;
  bezier?: Bezier;
}

function withProp(layer: Layer, key: PropKey, prop: AnimProp): Layer {
  return setLayerProp(layer, key, prop as never);
}

/** Sets a property at time t (creates/updates a keyframe when its stopwatch is on). */
export function setPropAt(doc: MotionDoc, layerId: string, key: PropKey, value: PropValue, t: number): MotionDoc {
  return updateLayer(doc, layerId, (l) => withProp(l, key, setValueAt(getProp(l, key) as AnimProp<PropValue>, t, value)));
}

export function toggleStopwatchOp(doc: MotionDoc, layerId: string, key: PropKey, t: number): MotionDoc {
  return updateLayer(doc, layerId, (l) => withProp(l, key, toggleStopwatch(getProp(l, key) as AnimProp<PropValue>, t)));
}

/** Keyframe navigator diamond: removes the key at t, or adds one with the current value. */
export function toggleKeyAt(doc: MotionDoc, layerId: string, key: PropKey, t: number): MotionDoc {
  return updateLayer(doc, layerId, (l) => {
    const prop = getProp(l, key) as AnimProp<PropValue>;
    const existing = findKeyAt(prop, t);
    if (existing) return withProp(l, key, removeKeyframes(prop, new Set([existing.id]), t));
    return withProp(l, key, setKeyframe(prop, t, evaluateProp(prop, t)));
  });
}

function groupByProp(ids: Iterable<string>, index: Map<string, KeyRef>): Map<string, Map<PropKey, Set<string>>> {
  const out = new Map<string, Map<PropKey, Set<string>>>();
  for (const id of ids) {
    const ref = index.get(id);
    if (!ref) continue;
    let props = out.get(ref.layerId);
    if (!props) out.set(ref.layerId, (props = new Map()));
    let set = props.get(ref.prop);
    if (!set) props.set(ref.prop, (set = new Set()));
    set.add(id);
  }
  return out;
}

export function deleteKeys(doc: MotionDoc, ids: Iterable<string>, index: Map<string, KeyRef>, t: number): MotionDoc {
  let next = doc;
  for (const [layerId, props] of groupByProp(ids, index)) {
    next = updateLayer(next, layerId, (l) => {
      let layer = l;
      for (const [key, set] of props) layer = withProp(layer, key, removeKeyframes(getProp(layer, key), set, t));
      return layer;
    });
  }
  return next;
}

export function moveKeys(doc: MotionDoc, ids: Iterable<string>, index: Map<string, KeyRef>, delta: number): MotionDoc {
  let next = doc;
  const bounds = { min: 0, max: doc.comp.duration };
  for (const [layerId, props] of groupByProp(ids, index)) {
    next = updateLayer(next, layerId, (l) => {
      let layer = l;
      for (const [key, set] of props) layer = withProp(layer, key, moveKeyframes(getProp(layer, key), set, delta, bounds));
      return layer;
    });
  }
  return next;
}

export function setKeysEasing(doc: MotionDoc, ids: Iterable<string>, index: Map<string, KeyRef>, easing: EasingType, bezier?: Bezier): MotionDoc {
  let next = doc;
  for (const [layerId, props] of groupByProp(ids, index)) {
    next = updateLayer(next, layerId, (l) => {
      let layer = l;
      for (const [key, set] of props) layer = withProp(layer, key, setEasing(getProp(layer, key), set, easing, bezier));
      return layer;
    });
  }
  return next;
}

export function findKey(doc: MotionDoc, ref: KeyRef | undefined): Keyframe | undefined {
  if (!ref) return undefined;
  const layer = layerById(doc, ref.layerId);
  return layer ? getProp(layer, ref.prop).keyframes.find((k) => k.id === ref.keyId) : undefined;
}

export function copyKeys(doc: MotionDoc, ids: Iterable<string>, index: Map<string, KeyRef>): CopiedKeyframe[] {
  const out: CopiedKeyframe[] = [];
  for (const id of ids) {
    const ref = index.get(id);
    const key = findKey(doc, ref);
    if (!ref || !key) continue;
    out.push({ layerId: ref.layerId, prop: ref.prop, time: key.time, value: key.value, easing: key.easing, bezier: key.bezier });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Pastes keyframes so the earliest one lands at time t. With one target layer every key
 * goes there; otherwise each key goes back to its original layer.
 */
export function pasteKeys(doc: MotionDoc, keys: CopiedKeyframe[], targets: string[], t: number): { doc: MotionDoc; count: number } {
  if (!keys.length) return { doc, count: 0 };
  const offset = t - keys[0].time;
  let next = doc;
  let count = 0;
  for (const k of keys) {
    const layerId = targets.length === 1 ? targets[0] : k.layerId;
    const time = Math.max(0, Math.min(doc.comp.duration, k.time + offset));
    const before = next;
    next = updateLayer(next, layerId, (l) => {
      const prop = getProp(l, k.prop) as AnimProp<PropValue>;
      // Values must match the property kind (e.g. no color into position).
      if (typeof prop.value !== typeof k.value || Array.isArray(prop.value) !== Array.isArray(k.value)) return l;
      return withProp(l, k.prop, setKeyframe(prop, time, k.value, { easing: k.easing, bezier: k.bezier }));
    });
    if (next !== before) count++;
  }
  return { doc: next, count };
}

/** Every keyframe time of the given layers (or all), for J/K navigation and snapping. */
export function allKeyTimes(doc: MotionDoc, layerIds?: string[]): number[] {
  const set = new Set<number>();
  for (const l of doc.layers) {
    if (layerIds && layerIds.length && !layerIds.includes(l.id)) continue;
    for (const anim of Object.values(l.props) as AnimProp[]) for (const k of anim.keyframes) set.add(k.time);
  }
  return [...set].sort((a, b) => a - b);
}

/** Adds layers above the top-most selected layer (or on top). */
export function insertLayers(doc: MotionDoc, layers: Layer[], selected: string[]): MotionDoc {
  const idx = doc.layers.findIndex((l) => selected.includes(l.id));
  const at = idx >= 0 ? idx : 0;
  return { ...doc, layers: [...doc.layers.slice(0, at), ...layers, ...doc.layers.slice(at)] };
}

/** "Easy ease": ease-in-out on keys (F9). */
export function easyEase(doc: MotionDoc, ids: Iterable<string>, index: Map<string, KeyRef>): MotionDoc {
  return setKeysEasing(doc, ids, index, 'easeInOut');
}

/** Bakes the layer's animated properties into static values at time t (stopwatch off on all). */
export function removeAllAnimation(doc: MotionDoc, layerIds: string[], t: number): MotionDoc {
  let next = doc;
  for (const id of layerIds) {
    next = updateLayer(next, id, (l) => {
      let layer: Layer = { ...l, wiggles: [] };
      for (const [key, prop] of Object.entries(l.props) as [PropKey, AnimProp][]) {
        if (isAnimated(prop)) layer = withProp(layer, key, { value: evaluateProp(prop, t), keyframes: [] });
      }
      return layer;
    });
  }
  return next;
}

/**
 * Shortens the composition to its work area: everything moves back by the work-area start,
 * animated properties get a keyframe at 0 holding the value they had at the old start.
 */
export function trimToWorkArea(doc: MotionDoc): MotionDoc {
  const { workStart: s, workEnd: e } = doc.comp;
  if (s <= 1e-6 && e >= doc.comp.duration - 1e-6) return doc;
  const len = Math.max(1 / doc.comp.fps, e - s);
  const layers = doc.layers.map((l) => {
    const props = { ...l.props } as Record<PropKey, AnimProp>;
    for (const [k, p] of Object.entries(l.props) as [PropKey, AnimProp][]) {
      if (!p.keyframes.length || s <= 0) continue;
      const kept = p.keyframes.filter((kf) => kf.time >= s - 1e-6).map((kf) => ({ ...kf, time: Math.max(0, kf.time - s) }));
      if (!kept.length || kept[0].time > 1e-6) {
        const before = p.keyframes[Math.max(0, keyIndexAt(p.keyframes, s))];
        kept.unshift({ id: newKeyId(), time: 0, value: evaluateProp(p, s), easing: before.easing, ...(before.bezier ? { bezier: before.bezier } : {}) });
      }
      props[k] = { ...p, keyframes: kept };
    }
    return {
      ...l,
      props: props as unknown as Layer['props'],
      inPoint: Math.max(0, l.inPoint - s),
      outPoint: Math.max(1 / doc.comp.fps, l.outPoint - s),
      wiggles: l.wiggles.map((w) => ({ ...w, start: Math.max(0, w.start - s), end: Math.max(0, w.end - s) })),
    };
  });
  return { ...doc, layers, comp: { ...doc.comp, duration: len, workStart: 0, workEnd: len } };
}
