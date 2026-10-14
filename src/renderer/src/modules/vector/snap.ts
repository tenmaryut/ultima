import type { Pt, Rect } from './matrix';

/** A candidate line to snap to (x = value for vertical lines, y = value for horizontal). */
export interface SnapLine {
  value: number;
  /** Extent of the source along the other axis (for drawing the guide). */
  from: number;
  to: number;
}

export interface SnapTargets {
  xs: SnapLine[];
  ys: SnapLine[];
  /** Grid spacing in px (0 = no grid snapping) and its origin. */
  grid?: { size: number; ox: number; oy: number };
}

export interface Guide {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
}

/** Edges and centers of the given rectangles become snap lines. */
export function buildSnapTargets(rects: Rect[], grid?: SnapTargets['grid']): SnapTargets {
  const xs: SnapLine[] = [];
  const ys: SnapLine[] = [];
  for (const r of rects) {
    const y0 = r.y;
    const y1 = r.y + r.height;
    const x0 = r.x;
    const x1 = r.x + r.width;
    for (const v of [x0, (x0 + x1) / 2, x1]) xs.push({ value: v, from: y0, to: y1 });
    for (const v of [y0, (y0 + y1) / 2, y1]) ys.push({ value: v, from: x0, to: x1 });
  }
  return { xs, ys, grid };
}

function bestSnap(values: number[], lines: SnapLine[], threshold: number): { delta: number; line: SnapLine | null } {
  let best = threshold;
  let delta = 0;
  let line: SnapLine | null = null;
  for (const l of lines) {
    for (const v of values) {
      const d = l.value - v;
      if (Math.abs(d) < Math.abs(best) || (Math.abs(d) === Math.abs(best) && !line)) {
        if (Math.abs(d) <= threshold) {
          best = d;
          delta = d;
          line = l;
        }
      }
    }
  }
  return { delta, line };
}

function gridSnap(values: number[], size: number, origin: number, threshold: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    const g = origin + Math.round((v - origin) / size) * size;
    const d = g - v;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/** Snaps a moving rectangle (edges + center) and returns the offset and the guides to show. */
export function snapRect(r: Rect, targets: SnapTargets, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const xVals = [r.x, r.x + r.width / 2, r.x + r.width];
  const yVals = [r.y, r.y + r.height / 2, r.y + r.height];
  const sx = bestSnap(xVals, targets.xs, threshold);
  const sy = bestSnap(yVals, targets.ys, threshold);
  let dx = sx.delta;
  let dy = sy.delta;
  if (!sx.line && targets.grid?.size) dx = gridSnap([r.x, r.x + r.width], targets.grid.size, targets.grid.ox, threshold) ?? 0;
  if (!sy.line && targets.grid?.size) dy = gridSnap([r.y, r.y + r.height], targets.grid.size, targets.grid.oy, threshold) ?? 0;
  const guides: Guide[] = [];
  if (sx.line) {
    const y0 = Math.min(sx.line.from, r.y + dy);
    const y1 = Math.max(sx.line.to, r.y + r.height + dy);
    guides.push({ axis: 'x', value: sx.line.value, from: y0, to: y1 });
  }
  if (sy.line) {
    const x0 = Math.min(sy.line.from, r.x + dx);
    const x1 = Math.max(sy.line.to, r.x + r.width + dx);
    guides.push({ axis: 'y', value: sy.line.value, from: x0, to: x1 });
  }
  return { dx, dy, guides };
}

/** Snaps a single point (drawing tools, resize handles). */
export function snapPoint(p: Pt, targets: SnapTargets, threshold: number): { x: number; y: number; guides: Guide[] } {
  const sx = bestSnap([p.x], targets.xs, threshold);
  const sy = bestSnap([p.y], targets.ys, threshold);
  let x = p.x + sx.delta;
  let y = p.y + sy.delta;
  if (!sx.line && targets.grid?.size) x = p.x + (gridSnap([p.x], targets.grid.size, targets.grid.ox, threshold) ?? 0);
  if (!sy.line && targets.grid?.size) y = p.y + (gridSnap([p.y], targets.grid.size, targets.grid.oy, threshold) ?? 0);
  const guides: Guide[] = [];
  if (sx.line) guides.push({ axis: 'x', value: sx.line.value, from: Math.min(sx.line.from, y), to: Math.max(sx.line.to, y) });
  if (sy.line) guides.push({ axis: 'y', value: sy.line.value, from: Math.min(sy.line.from, x), to: Math.max(sy.line.to, x) });
  return { x, y, guides };
}

/** Constrains a vector to multiples of 45° (Shift while drawing lines / moving). */
export function constrain45(dx: number, dy: number): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy);
  if (!len) return { dx, dy };
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { dx: Math.cos(a) * len, dy: Math.sin(a) * len };
}

/** Constrains a move to the dominant axis (Shift while dragging objects). */
export function constrainAxis(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}
