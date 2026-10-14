/**
 * Color harmony rules on an artistic (RYB) or scientific (RGB) color wheel.
 * Pure functions — unit tested in harmony.test.ts.
 *
 * A palette has one *base* color; every other swatch occupies a "slot" described by a
 * SlotSpec: its hue offset on the wheel (`fixed + mult * spread` degrees) and its
 * saturation/brightness deltas relative to the base.
 */
import { clamp01, normHue, type HSV } from './colormath';

export type HarmonyRule =
  | 'analogous'
  | 'monochromatic'
  | 'triad'
  | 'complementary'
  | 'split-complementary'
  | 'square'
  | 'compound'
  | 'shades'
  | 'custom';

export type WheelMode = 'ryb' | 'rgb';

export interface SpreadInfo {
  kind: 'angle' | 'amount';
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface RuleInfo {
  id: HarmonyRule;
  label: string;
  spread: SpreadInfo | null;
}

export const HARMONY_RULES: RuleInfo[] = [
  { id: 'analogous', label: 'Analogous', spread: { kind: 'angle', default: 30, min: 4, max: 60, step: 1 } },
  { id: 'monochromatic', label: 'Monochromatic', spread: { kind: 'amount', default: 0.25, min: 0.05, max: 0.45, step: 0.01 } },
  { id: 'triad', label: 'Triad', spread: null },
  { id: 'complementary', label: 'Complementary', spread: null },
  { id: 'split-complementary', label: 'Split Complementary', spread: { kind: 'angle', default: 30, min: 4, max: 85, step: 1 } },
  { id: 'square', label: 'Square', spread: null },
  { id: 'compound', label: 'Compound', spread: { kind: 'angle', default: 30, min: 4, max: 85, step: 1 } },
  { id: 'shades', label: 'Shades', spread: { kind: 'amount', default: 0.18, min: 0.04, max: 0.24, step: 0.01 } },
  { id: 'custom', label: 'Custom', spread: null },
];

export const RULE_IDS = HARMONY_RULES.map((r) => r.id);

export function ruleInfo(rule: HarmonyRule): RuleInfo {
  return HARMONY_RULES.find((r) => r.id === rule) ?? HARMONY_RULES[HARMONY_RULES.length - 1];
}

export function isRule(value: unknown): value is HarmonyRule {
  return typeof value === 'string' && (RULE_IDS as string[]).includes(value);
}

export function clampSpread(rule: HarmonyRule, value: number | undefined): number {
  const info = ruleInfo(rule).spread;
  if (!info) return 0;
  if (value === undefined || !Number.isFinite(value)) return info.default;
  return Math.min(info.max, Math.max(info.min, value));
}

/* ------------------------------ Wheel mapping ------------------------------ */

/**
 * Artistic (RYB) wheel → RGB hue. Red, yellow and blue are 120° apart so that the
 * painter's complements line up: red↔green, yellow↔violet, blue↔orange.
 */
const RYB_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [60, 30],
  [120, 60],
  [180, 120],
  [240, 225],
  [300, 280],
  [360, 360],
];

function piecewise(x: number, from: 0 | 1): number {
  const to = from === 0 ? 1 : 0;
  const h = normHue(x);
  for (let i = 1; i < RYB_STOPS.length; i++) {
    const a = RYB_STOPS[i - 1];
    const b = RYB_STOPS[i];
    if (h <= b[from]) {
      const t = (h - a[from]) / (b[from] - a[from] || 1);
      return normHue(a[to] + t * (b[to] - a[to]));
    }
  }
  return h;
}

/** RGB hue → angle on the chosen wheel. */
export function rgbHueToWheel(h: number, mode: WheelMode): number {
  return mode === 'rgb' ? normHue(h) : piecewise(h, 1);
}

/** Angle on the chosen wheel → RGB hue. */
export function wheelHueToRgb(angle: number, mode: WheelMode): number {
  return mode === 'rgb' ? normHue(angle) : piecewise(angle, 0);
}

/* ---------------------------------- Slots ---------------------------------- */

export interface SlotSpec {
  /** Fixed hue offset on the wheel (degrees). */
  fixed: number;
  /** Multiplier of the rule's spread angle (0 = not spread based). */
  mult: number;
  /** Saturation / brightness deltas (absolute, reflected when out of range). */
  ds: number;
  dv: number;
  /** Display order around the base (negative = before, positive = after). */
  order: number;
}

/** Saturation/brightness steps of the "variant" slots of hue based rules (A = muted dark, B = light tint). */
export const VARIANT = 0.3;
const A_S = -0.3;
const A_V = -0.2;
const B_S = -0.45;
const B_V = 0.12;

const spec = (fixed: number, mult: number, ds: number, dv: number, order: number): SlotSpec => ({ fixed, mult, ds, dv, order });

function canonicalSpecs(rule: HarmonyRule, amount: number): SlotSpec[] {
  const a = amount;
  switch (rule) {
    case 'monochromatic':
      return [spec(0, 0, 0, -a, -1), spec(0, 0, -a, 0, 1), spec(0, 0, 0, -2 * a, -2), spec(0, 0, -2 * a, a, 2)];
    case 'triad':
      return [spec(120, 0, 0, 0, -1), spec(240, 0, 0, 0, 1), spec(120, 0, A_S, A_V, -2), spec(240, 0, A_S, A_V, 2)];
    case 'complementary':
      return [spec(180, 0, 0, 0, 1), spec(0, 0, A_S, A_V, -1), spec(180, 0, A_S, A_V, 2), spec(0, 0, B_S, B_V, -2)];
    case 'split-complementary':
      return [spec(180, -1, 0, 0, -1), spec(180, 1, 0, 0, 1), spec(180, -1, A_S, A_V, -2), spec(180, 1, A_S, A_V, 2)];
    case 'square':
      return [spec(90, 0, 0, 0, -2), spec(180, 0, 0, 0, -1), spec(270, 0, 0, 0, 1), spec(0, 0, A_S, A_V, 2)];
    case 'compound':
      return [spec(0, 1, 0, 0, -1), spec(180, 0, 0, 0, 1), spec(180, -1, 0, 0, 2), spec(0, 1, A_S, A_V, -2)];
    default:
      return [];
  }
}

/** Shades ladder: brightness steps of `amount` that stay inside [0.04, 1]. */
function shadeSpecs(count: number, base: HSV, amount: number): SlotSpec[] {
  let a = Math.max(0.01, amount);
  for (let attempt = 0; attempt < 12; attempt++) {
    const out: SlotSpec[] = [];
    for (let k = 1; k <= 24 && out.length < count; k++) {
      for (const m of [-k, k]) {
        const v = base.v + m * a;
        if (v >= 0.04 - 1e-9 && v <= 1 + 1e-9 && out.length < count) out.push(spec(0, 0, 0, m * a, m));
      }
    }
    if (out.length >= count) return out;
    a *= 0.75;
  }
  return Array.from({ length: count }, (_, i) => spec(0, 0, 0, 0, i + 1));
}

/**
 * Slot specs for the `count` non-base swatches, most important first. Rules with only
 * four canonical slots get extra, progressively darker variants for larger palettes.
 */
export function ruleSpecs(rule: HarmonyRule, count: number, spread: number, base: HSV): SlotSpec[] {
  if (count <= 0 || rule === 'custom') return [];
  if (rule === 'shades' || (rule === 'monochromatic' && base.s < 0.05)) {
    return shadeSpecs(count, base, rule === 'shades' ? spread : spread * 0.7);
  }
  if (rule === 'analogous') {
    return Array.from({ length: count }, (_, j) => {
      const k = Math.floor(j / 2) + 1;
      const sign = j % 2 === 0 ? -1 : 1;
      return spec(0, sign * k, 0, 0, sign * k);
    });
  }
  const canon = canonicalSpecs(rule, spread);
  const out: SlotSpec[] = [];
  for (let j = 0; j < count; j++) {
    const c = canon[j % canon.length];
    const level = Math.floor(j / canon.length);
    if (!level) out.push(c);
    else out.push({ ...c, dv: c.dv - 0.15 * level, ds: c.ds - 0.1 * level, order: c.order + Math.sign(c.order || 1) * 10 * level });
  }
  return out;
}

/** Adds `d` to x; if that leaves [min, 1] the delta is applied the other way. */
export function vary(x: number, d: number, min = 0.05): number {
  if (!d) return clamp01(x);
  const y = x + d;
  if (y >= min && y <= 1) return y;
  return clamp01(x - d);
}

export function slotHsv(base: HSV, slot: SlotSpec, spread: number, mode: WheelMode): HSV {
  const wheel = rgbHueToWheel(base.h, mode) + slot.fixed + slot.mult * spread;
  return {
    h: slot.fixed || slot.mult ? wheelHueToRgb(wheel, mode) : base.h,
    s: vary(base.s, slot.ds),
    v: vary(base.v, slot.dv, 0.04),
  };
}

export interface HarmonyResult {
  colors: HSV[];
  /** Spec of each slot (null for the base). */
  specs: (SlotSpec | null)[];
}

/**
 * Generates `n` colors for `rule` around `base`, placing the base at `baseIndex` and the
 * other slots (sorted by their display order) in the remaining positions.
 */
export function generateHarmony(
  base: HSV,
  rule: HarmonyRule,
  n: number,
  baseIndex: number,
  spread: number,
  mode: WheelMode,
): HarmonyResult {
  const count = Math.max(1, Math.round(n));
  const bi = Math.min(count - 1, Math.max(0, Math.round(baseIndex)));
  const sp = clampSpread(rule, spread);
  const slots = ruleSpecs(rule, count - 1, sp, base)
    .map((s, importance) => ({ s, importance }))
    .sort((a, b) => a.s.order - b.s.order || a.importance - b.importance)
    .map((x) => x.s);
  const colors: HSV[] = [];
  const specs: (SlotSpec | null)[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    if (i === bi) {
      colors.push({ ...base });
      specs.push(null);
      continue;
    }
    const slot = slots[k++];
    if (!slot) {
      colors.push({ ...base });
      specs.push(null);
      continue;
    }
    colors.push(slotHsv(base, slot, sp, mode));
    specs.push(slot);
  }
  return { colors, specs };
}

/* ------------------------------ Drag helpers ------------------------------ */

/** Signed smallest angle a-b in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = normHue(a - b);
  return d > 180 ? d - 360 : d;
}

/**
 * A secondary marker of a spread based slot was dragged to `markerWheel`: returns the new
 * spread, or null when the slot is not spread based (the whole set rotates instead).
 */
export function spreadFromMarker(slot: SlotSpec, baseWheel: number, markerWheel: number, rule: HarmonyRule): number | null {
  if (!slot.mult || !ruleInfo(rule).spread || ruleInfo(rule).spread?.kind !== 'angle') return null;
  const diff = angleDiff(markerWheel, baseWheel + slot.fixed);
  return clampSpread(rule, diff / slot.mult);
}

/** New base wheel angle when a fixed-offset marker is dragged to `markerWheel`. */
export function baseWheelFromMarker(slot: SlotSpec, markerWheel: number, spread: number): number {
  return normHue(markerWheel - slot.fixed - slot.mult * spread);
}
