import type { Bezier, EasingType } from './types';

/**
 * Easing curves. Every function maps progress u ∈ [0,1] to eased progress (0 → 0, 1 → 1;
 * back / elastic / custom béziers may overshoot in between).
 */

const NEWTON_ITERATIONS = 8;
const EPSILON = 1e-7;

/** CSS-compatible cubic-bézier timing function (same algorithm as browsers' UnitBezier). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const ax1 = Math.min(1, Math.max(0, x1));
  const ax2 = Math.min(1, Math.max(0, x2));
  const cx = 3 * ax1;
  const bx = 3 * (ax2 - ax1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveX = (x: number): number => {
    // Newton-Raphson first (fast, usually converges).
    let t = x;
    for (let i = 0; i < NEWTON_ITERATIONS; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < EPSILON) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Fall back to bisection (always converges since x(t) is monotonic for x1,x2 in [0,1]).
    let lo = 0;
    let hi = 1;
    t = x;
    if (t < lo) return lo;
    if (t > hi) return hi;
    for (let i = 0; i < 60 && lo < hi; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < EPSILON) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  if (ax1 === y1 && ax2 === y2) return (u) => clamp01(u); // linear
  return (u: number) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    return sampleY(solveX(u));
  };
}

function clamp01(u: number): number {
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

export const BEZIER_PRESETS: Record<'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back', Bezier> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  back: [0.34, 1.56, 0.64, 1],
};

const easeIn = cubicBezier(...BEZIER_PRESETS.easeIn);
const easeOut = cubicBezier(...BEZIER_PRESETS.easeOut);
const easeInOut = cubicBezier(...BEZIER_PRESETS.easeInOut);

/** easeOutBack: overshoots the target by ~10% and settles. */
export function backOut(u: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = u - 1;
  return 1 + c3 * v * v * v + c1 * v * v;
}

/** easeOutElastic: springy oscillation that settles on the target. */
export function elasticOut(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * c4) + 1;
}

/** easeOutBounce: drops onto the target and bounces a few times. */
export function bounceOut(u: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (u < 1 / d1) return n1 * u * u;
  if (u < 2 / d1) {
    const v = u - 1.5 / d1;
    return n1 * v * v + 0.75;
  }
  if (u < 2.5 / d1) {
    const v = u - 2.25 / d1;
    return n1 * v * v + 0.9375;
  }
  const v = u - 2.625 / d1;
  return n1 * v * v + 0.984375;
}

const bezierCache = new Map<string, (u: number) => number>();
function cachedBezier(b: Bezier): (u: number) => number {
  const key = b.join(',');
  let fn = bezierCache.get(key);
  if (!fn) {
    fn = cubicBezier(b[0], b[1], b[2], b[3]);
    if (bezierCache.size > 500) bezierCache.clear();
    bezierCache.set(key, fn);
  }
  return fn;
}

/** Applies an easing to progress u (0..1). `hold` returns 0 until the next keyframe. */
export function ease(type: EasingType, u: number, bezier?: Bezier): number {
  const p = clamp01(u);
  switch (type) {
    case 'linear':
      return p;
    case 'easeIn':
      return easeIn(p);
    case 'easeOut':
      return easeOut(p);
    case 'easeInOut':
      return easeInOut(p);
    case 'hold':
      return p >= 1 ? 1 : 0;
    case 'back':
      return p >= 1 ? 1 : backOut(p);
    case 'elastic':
      return elasticOut(p);
    case 'bounce':
      return p >= 1 ? 1 : bounceOut(p);
    case 'bezier':
      return bezier ? cachedBezier(bezier)(p) : p;
    default:
      return p;
  }
}

export const EASING_TYPES: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In-Out' },
  { value: 'hold', label: 'Hold' },
  { value: 'back', label: 'Back (overshoot)' },
  { value: 'elastic', label: 'Elastic' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'bezier', label: 'Custom curve' },
];

/** Starting control points when the user begins editing a curve in the graph editor. */
export function bezierFor(type: EasingType, current?: Bezier): Bezier {
  if (type === 'bezier' && current) return [...current] as Bezier;
  if (type in BEZIER_PRESETS) return [...BEZIER_PRESETS[type as keyof typeof BEZIER_PRESETS]] as Bezier;
  return [...BEZIER_PRESETS.easeOut] as Bezier;
}

export function sanitizeBezier(b: unknown): Bezier | null {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const n = b.map((v) => (typeof v === 'number' ? v : parseFloat(String(v))));
  if (n.some((v) => !Number.isFinite(v))) return null;
  return [clamp01(n[0]), Math.max(-2, Math.min(3, n[1])), clamp01(n[2]), Math.max(-2, Math.min(3, n[3]))];
}

const EASING_ALIASES: Record<string, EasingType> = {
  linear: 'linear',
  none: 'linear',
  easein: 'easeIn',
  in: 'easeIn',
  accelerate: 'easeIn',
  easeout: 'easeOut',
  out: 'easeOut',
  decelerate: 'easeOut',
  ease: 'easeInOut',
  easeinout: 'easeInOut',
  inout: 'easeInOut',
  easyease: 'easeInOut',
  smooth: 'easeInOut',
  hold: 'hold',
  step: 'hold',
  steps: 'hold',
  back: 'back',
  backout: 'back',
  easeoutback: 'back',
  overshoot: 'back',
  elastic: 'elastic',
  elasticout: 'elastic',
  easeoutelastic: 'elastic',
  spring: 'elastic',
  bounce: 'bounce',
  bounceout: 'bounce',
  easeoutbounce: 'bounce',
  bezier: 'bezier',
  custom: 'bezier',
};

/**
 * Parses an easing from loosely formatted input (AI answers, pasted text):
 * "easeOut", "ease-out", "cubic-bezier(.2,.8,.2,1)", [x1,y1,x2,y2], {type, bezier}.
 */
export function parseEasing(input: unknown): { easing: EasingType; bezier?: Bezier } | null {
  if (input == null) return null;
  if (Array.isArray(input)) {
    const b = sanitizeBezier(input);
    return b ? { easing: 'bezier', bezier: b } : null;
  }
  if (typeof input === 'object') {
    const o = input as { type?: unknown; easing?: unknown; bezier?: unknown };
    const b = sanitizeBezier(o.bezier);
    if (b) return { easing: 'bezier', bezier: b };
    return parseEasing(o.type ?? o.easing);
  }
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  const m = /^cubic-bezier\s*\(([^)]*)\)$/i.exec(raw);
  if (m) {
    const b = sanitizeBezier(m[1].split(/[\s,]+/).filter(Boolean));
    return b ? { easing: 'bezier', bezier: b } : null;
  }
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  const easing = EASING_ALIASES[key];
  return easing && easing !== 'bezier' ? { easing } : null;
}
