import { clearKeysBetween, evaluateProp, setKeyframe } from './keyframes';
import type { AnimProp, EasingType, Layer, PropValue, Vec2 } from './types';

/** Animation presets: generate keyframes on a layer starting at the playhead (pure). */

export type PresetId =
  | 'fadeIn'
  | 'fadeOut'
  | 'slideInLeft'
  | 'slideInRight'
  | 'slideInTop'
  | 'slideInBottom'
  | 'popIn'
  | 'bounceIn'
  | 'spinIn'
  | 'typewriter'
  | 'wordReveal'
  | 'wiggle'
  | 'pulse'
  | 'float'
  | 'drawOn'
  | 'shake';

export interface PresetInfo {
  id: PresetId;
  label: string;
  description: string;
  /** Default duration in seconds. */
  duration: number;
  /** Layer types the preset works with (undefined = all visual layers). */
  only?: Layer['type'][];
}

export const PRESETS: PresetInfo[] = [
  { id: 'fadeIn', label: 'Fade In', description: 'Opacity from 0 to the current value.', duration: 0.6 },
  { id: 'fadeOut', label: 'Fade Out', description: 'Opacity from the current value to 0.', duration: 0.6 },
  { id: 'slideInLeft', label: 'Slide In Left', description: 'Enters from outside the left edge.', duration: 0.8 },
  { id: 'slideInRight', label: 'Slide In Right', description: 'Enters from outside the right edge.', duration: 0.8 },
  { id: 'slideInTop', label: 'Slide In Top', description: 'Enters from above the frame.', duration: 0.8 },
  { id: 'slideInBottom', label: 'Slide In Bottom', description: 'Enters from below the frame.', duration: 0.8 },
  { id: 'popIn', label: 'Pop In', description: 'Scales up from 0 with a small overshoot.', duration: 0.5 },
  { id: 'bounceIn', label: 'Bounce In', description: 'Drops in from above and bounces.', duration: 1.2 },
  { id: 'spinIn', label: 'Spin In', description: 'Spins a full turn while scaling up.', duration: 0.9 },
  { id: 'typewriter', label: 'Typewriter', description: 'Reveals the text one character at a time.', duration: 1.5, only: ['text'] },
  { id: 'wordReveal', label: 'Word by Word', description: 'Each word fades and rises into place.', duration: 1.5, only: ['text'] },
  { id: 'wiggle', label: 'Wiggle', description: 'Random smooth movement (frequency / amplitude).', duration: 2 },
  { id: 'pulse', label: 'Pulse', description: 'Rhythmic scale up and down.', duration: 1.2 },
  { id: 'float', label: 'Float', description: 'Gentle up-and-down hovering.', duration: 4 },
  { id: 'drawOn', label: 'Draw On', description: 'Draws the outline with Trim Paths.', duration: 1.2, only: ['shape'] },
  { id: 'shake', label: 'Shake', description: 'Quick decaying horizontal shake.', duration: 0.6 },
];

export function presetInfo(id: PresetId): PresetInfo {
  return PRESETS.find((p) => p.id === id)!;
}

/** Accepts "fade-in", "Fade In", "slide_in_left", "pop" … and returns a preset id. */
export function normalizePresetId(input: unknown): PresetId | null {
  if (typeof input !== 'string') return null;
  const key = input.toLowerCase().replace(/[^a-z]/g, '');
  const direct = PRESETS.find((p) => p.id.toLowerCase() === key || p.label.toLowerCase().replace(/[^a-z]/g, '') === key);
  if (direct) return direct.id;
  const aliases: Record<string, PresetId> = {
    fade: 'fadeIn',
    slidein: 'slideInLeft',
    slideleft: 'slideInLeft',
    slideright: 'slideInRight',
    slidetop: 'slideInTop',
    slidebottom: 'slideInBottom',
    slideup: 'slideInBottom',
    slidedown: 'slideInTop',
    pop: 'popIn',
    scalein: 'popIn',
    popscalein: 'popIn',
    bounce: 'bounceIn',
    spin: 'spinIn',
    type: 'typewriter',
    wordbyword: 'wordReveal',
    wordbywordreveal: 'wordReveal',
    words: 'wordReveal',
    drawon: 'drawOn',
    draw: 'drawOn',
    trimpath: 'drawOn',
    trimpaths: 'drawOn',
    heartbeat: 'pulse',
    hover: 'float',
    jitter: 'shake',
  };
  return aliases[key] ?? null;
}

export interface PresetContext {
  time: number;
  duration: number;
  comp: { width: number; height: number };
  /** Composition-space bounding box of the layer (at the end of the preset). */
  bounds: { x: number; y: number; w: number; h: number };
  /** Converts a composition-space offset into the layer's parent space (parented layers). */
  toParentDelta?: (dx: number, dy: number) => [number, number];
  /** Wiggle: wiggles per second / amplitude (px). */
  frequency?: number;
  amplitude?: number;
  seed?: number;
}

export interface PresetResult {
  layer: Layer;
  ok: boolean;
  /** Why the preset could not be applied (English, translated by the UI). */
  reason?: string;
}

type Key<V extends PropValue> = { t: number; v: V; e: EasingType };

/** Replaces the keyframes inside [from, to] of a property with `keys`. */
function writeKeys<V extends PropValue>(prop: AnimProp<V>, from: number, to: number, keys: Key<V>[]): AnimProp<V> {
  let next = clearKeysBetween(prop, from, to);
  for (const k of keys) next = setKeyframe(next, k.t, k.v, { easing: k.e });
  return next;
}

function withProp<K extends keyof Layer['props']>(layer: Layer, key: K, prop: Layer['props'][K]): Layer {
  return { ...layer, props: { ...layer.props, [key]: prop } };
}

const MARGIN = 40;

export function applyPreset(layer: Layer, id: PresetId, ctx: PresetContext): PresetResult {
  const info = PRESETS.find((p) => p.id === id);
  if (!info) return { layer, ok: false, reason: 'Unknown preset' };
  // Null layers are invisible and children don't inherit opacity: fades would do nothing.
  if (layer.type === 'null' && (id === 'fadeIn' || id === 'fadeOut')) {
    return { layer, ok: false, reason: 'Null layers are invisible; fade their child layers instead' };
  }
  if (info.only && !info.only.includes(layer.type)) {
    return {
      layer,
      ok: false,
      reason: id === 'drawOn' ? 'Draw On works on shape layers' : 'This preset works on text layers',
    };
  }
  const t0 = Math.max(0, ctx.time);
  const d = Math.max(1 / 60, ctx.duration);
  const t1 = t0 + d;
  const p = layer.props;
  const delta = (dx: number, dy: number): [number, number] => (ctx.toParentDelta ? ctx.toParentDelta(dx, dy) : [dx, dy]);
  const posEnd = evaluateProp(p.position, t1);
  const scaleEnd = evaluateProp(p.scale, t1);
  const b = ctx.bounds;

  switch (id) {
    case 'fadeIn': {
      const end = evaluateProp(p.opacity, t1) || 100;
      return ok(withProp(layer, 'opacity', writeKeys(p.opacity, t0, t1, [{ t: t0, v: 0, e: 'easeOut' }, { t: t1, v: end, e: 'easeOut' }])));
    }
    case 'fadeOut': {
      const start = evaluateProp(p.opacity, t0);
      return ok(withProp(layer, 'opacity', writeKeys(p.opacity, t0, t1, [{ t: t0, v: start, e: 'easeIn' }, { t: t1, v: 0, e: 'easeIn' }])));
    }
    case 'slideInLeft':
    case 'slideInRight':
    case 'slideInTop':
    case 'slideInBottom': {
      let dx = 0;
      let dy = 0;
      if (id === 'slideInLeft') dx = -(b.x + b.w + MARGIN);
      if (id === 'slideInRight') dx = ctx.comp.width - b.x + MARGIN;
      if (id === 'slideInTop') dy = -(b.y + b.h + MARGIN);
      if (id === 'slideInBottom') dy = ctx.comp.height - b.y + MARGIN;
      const [px, py] = delta(dx, dy);
      const start: Vec2 = [posEnd[0] + px, posEnd[1] + py];
      return ok(withProp(layer, 'position', writeKeys(p.position, t0, t1, [{ t: t0, v: start, e: 'easeOut' }, { t: t1, v: posEnd, e: 'easeOut' }])));
    }
    case 'popIn':
      return ok(withProp(layer, 'scale', writeKeys<Vec2>(p.scale, t0, t1, [{ t: t0, v: [0, 0], e: 'back' }, { t: t1, v: scaleEnd, e: 'back' }])));
    case 'bounceIn': {
      const [px, py] = delta(0, -(b.y + b.h + MARGIN));
      const start: Vec2 = [posEnd[0] + px, posEnd[1] + py];
      return ok(withProp(layer, 'position', writeKeys(p.position, t0, t1, [{ t: t0, v: start, e: 'bounce' }, { t: t1, v: posEnd, e: 'bounce' }])));
    }
    case 'spinIn': {
      const rotEnd = evaluateProp(p.rotation, t1);
      let next = withProp(layer, 'rotation', writeKeys(p.rotation, t0, t1, [{ t: t0, v: rotEnd - 360, e: 'easeOut' }, { t: t1, v: rotEnd, e: 'easeOut' }]));
      next = withProp(next, 'scale', writeKeys<Vec2>(next.props.scale, t0, t1, [{ t: t0, v: [0, 0], e: 'easeOut' }, { t: t1, v: scaleEnd, e: 'easeOut' }]));
      return ok(next);
    }
    case 'typewriter':
    case 'wordReveal': {
      const next = withProp(layer, 'reveal', writeKeys(p.reveal, t0, t1, [{ t: t0, v: 0, e: 'linear' }, { t: t1, v: 100, e: 'linear' }]));
      return ok({
        ...next,
        text: next.text
          ? { ...next.text, revealMode: id === 'typewriter' ? 'chars' : 'words', revealStyle: id === 'typewriter' ? 'instant' : 'rise' }
          : next.text,
      });
    }
    case 'wiggle': {
      const seed = ctx.seed ?? Math.floor(Math.abs(hashString(layer.id + layer.wiggles.length)) % 100000);
      return ok({
        ...layer,
        wiggles: [
          ...layer.wiggles,
          {
            id: `w${seed}${layer.wiggles.length}`,
            property: 'position',
            frequency: ctx.frequency ?? 2,
            amplitude: ctx.amplitude ?? Math.round(Math.min(ctx.comp.width, ctx.comp.height) * 0.02),
            seed,
            start: t0,
            end: t1,
          },
        ],
      });
    }
    case 'pulse': {
      const count = Math.max(1, Math.round(d / 0.6));
      const period = d / count;
      const keys: Key<Vec2>[] = [];
      for (let i = 0; i < count; i++) {
        const s = t0 + i * period;
        keys.push({ t: s, v: scaleEnd, e: 'easeInOut' });
        keys.push({ t: s + period / 2, v: [scaleEnd[0] * 1.12, scaleEnd[1] * 1.12], e: 'easeInOut' });
      }
      keys.push({ t: t1, v: scaleEnd, e: 'easeInOut' });
      return ok(withProp(layer, 'scale', writeKeys(p.scale, t0, t1, keys)));
    }
    case 'float': {
      const count = Math.max(1, Math.round(d / 2));
      const period = d / count;
      const amp = Math.max(4, Math.round(Math.min(ctx.comp.width, ctx.comp.height) * 0.015));
      const [ax, ay] = delta(0, -amp);
      const base = evaluateProp(p.position, t0);
      const keys: Key<Vec2>[] = [];
      for (let i = 0; i < count; i++) {
        const s = t0 + i * period;
        keys.push({ t: s, v: base, e: 'easeInOut' });
        keys.push({ t: s + period / 2, v: [base[0] + ax, base[1] + ay], e: 'easeInOut' });
      }
      keys.push({ t: t1, v: base, e: 'easeInOut' });
      return ok(withProp(layer, 'position', writeKeys(p.position, t0, t1, keys)));
    }
    case 'drawOn': {
      let next = withProp(layer, 'trimEnd', writeKeys(p.trimEnd, t0, t1, [{ t: t0, v: 0, e: 'easeInOut' }, { t: t1, v: 100, e: 'easeInOut' }]));
      if (!next.props.trimStart.keyframes.length) next = withProp(next, 'trimStart', { value: 0, keyframes: [] });
      // Make sure there is a visible outline to draw.
      const width = evaluateProp(next.props.strokeWidth, t1);
      if (!next.shape?.strokeEnabled || width <= 0) {
        next = {
          ...next,
          shape: next.shape ? { ...next.shape, strokeEnabled: true } : next.shape,
          props: {
            ...next.props,
            strokeWidth: width > 0 ? next.props.strokeWidth : { value: Math.max(2, Math.round(Math.min(ctx.comp.width, ctx.comp.height) / 200)), keyframes: [] },
          },
        };
      }
      return ok(next);
    }
    case 'shake': {
      const steps = Math.max(4, Math.round(d * 20));
      const amp = Math.max(4, Math.round(Math.min(ctx.comp.width, ctx.comp.height) * 0.012));
      const base = evaluateProp(p.position, t0);
      const keys: Key<Vec2>[] = [{ t: t0, v: base, e: 'linear' }];
      for (let i = 1; i < steps; i++) {
        const falloff = 1 - i / steps;
        const dir = i % 2 ? 1 : -1;
        const [ox, oy] = delta(dir * amp * falloff, (i % 3 === 0 ? 0.3 : -0.2) * amp * falloff);
        keys.push({ t: t0 + (i * d) / steps, v: [base[0] + ox, base[1] + oy], e: 'linear' });
      }
      keys.push({ t: t1, v: base, e: 'linear' });
      return ok(withProp(layer, 'position', writeKeys(p.position, t0, t1, keys)));
    }
  }
  return { layer, ok: false, reason: 'Unknown preset' };
}

function ok(layer: Layer): PresetResult {
  return { layer, ok: true };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}
