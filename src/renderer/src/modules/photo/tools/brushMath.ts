/**
 * Pure brush helpers: evenly spaced dabs along a path and input smoothing.
 */
import type { Point } from '../types';

export interface Dab {
  x: number;
  y: number;
  /** 0..1 position between the segment's start and end (for pressure interpolation). */
  t: number;
}

/**
 * Places dabs every `spacing` px along the segment from → to. `carry` is the distance already
 * travelled since the previous dab (from earlier segments). Returns the dabs and the new carry.
 */
export function spacedDabs(from: Point, to: Point, spacing: number, carry: number): { dabs: Dab[]; carry: number } {
  const step = Math.max(0.25, spacing);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const dabs: Dab[] = [];
  if (len === 0) return { dabs, carry };
  let d = step - carry;
  while (d <= len) {
    const t = d / len;
    dabs.push({ x: from.x + dx * t, y: from.y + dy * t, t });
    d += step;
  }
  return { dabs, carry: len - (d - step) };
}

/** Exponential smoothing of pointer positions ("lazy brush"); amount 0..1. */
export class Smoother {
  private last: Point | null = null;
  constructor(private amount: number) {}

  push(p: Point): Point {
    if (!this.last || this.amount <= 0) {
      this.last = { ...p };
      return { ...p };
    }
    const k = 1 - Math.min(0.95, this.amount * 0.92);
    this.last = { x: this.last.x + (p.x - this.last.x) * k, y: this.last.y + (p.y - this.last.y) * k };
    return { ...this.last };
  }

  get current(): Point | null {
    return this.last;
  }
}

/** Brush spacing in px for a dab diameter and hardness. */
export function dabSpacing(size: number, hardness: number): number {
  return Math.max(0.5, size * (hardness > 0.7 ? 0.08 : 0.15));
}

/** Constrains `p` to the nearest 45° direction from `origin` (Shift while drawing lines). */
export function snapAngle(origin: Point, p: Point): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: origin.x + Math.cos(ang) * len, y: origin.y + Math.sin(ang) * len };
}

/** Aspect-constrained rectangle from a drag (square when ratio = 1). */
export function constrainRect(origin: Point, p: Point, ratio: number): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const w = Math.abs(dx);
  const h = Math.abs(dy);
  const r = ratio > 0 ? ratio : 1;
  let nw = w;
  let nh = w / r;
  if (nh < h) {
    nh = h;
    nw = h * r;
  }
  return { x: origin.x + Math.sign(dx || 1) * nw, y: origin.y + Math.sign(dy || 1) * nh };
}
