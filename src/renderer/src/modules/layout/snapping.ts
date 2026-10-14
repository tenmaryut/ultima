import type { Margins, Rect } from './types';

/**
 * Snapping with smart guides. All coordinates are page px. Targets are lines (x = v or
 * y = v) with an optional extent used to draw the guide between the moving box and the
 * object it aligned to.
 */

export type SnapKind = 'page' | 'center' | 'margin' | 'column' | 'guide' | 'frame' | 'bleed';

export interface SnapTarget {
  axis: 'x' | 'y';
  value: number;
  kind: SnapKind;
  /** Extent along the other axis (for drawing). */
  from: number;
  to: number;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
  kind: SnapKind;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface PageGeometry {
  width: number;
  height: number;
  margins: Margins;
  columns: number;
  gutter: number;
  guides: { x: number[]; y: number[] };
}

/** Column boundaries between the margins: [[x0, x1], ...]. */
export function columnRanges(page: PageGeometry): [number, number][] {
  const cols = Math.max(1, Math.round(page.columns));
  const left = page.margins.left;
  const right = page.width - page.margins.right;
  const inner = right - left;
  const gutter = cols > 1 ? Math.min(page.gutter, inner / (cols - 1)) : 0;
  const colW = (inner - gutter * (cols - 1)) / cols;
  const out: [number, number][] = [];
  for (let i = 0; i < cols; i++) {
    const x0 = left + i * (colW + gutter);
    out.push([x0, x0 + colW]);
  }
  return out;
}

export function buildPageTargets(page: PageGeometry, bleed = 0): SnapTarget[] {
  const { width: w, height: h, margins: m } = page;
  const t: SnapTarget[] = [];
  const vx = (value: number, kind: SnapKind) => t.push({ axis: 'x', value, kind, from: 0, to: h });
  const hy = (value: number, kind: SnapKind) => t.push({ axis: 'y', value, kind, from: 0, to: w });
  vx(0, 'page');
  vx(w, 'page');
  hy(0, 'page');
  hy(h, 'page');
  vx(w / 2, 'center');
  hy(h / 2, 'center');
  vx(m.left, 'margin');
  vx(w - m.right, 'margin');
  hy(m.top, 'margin');
  hy(h - m.bottom, 'margin');
  if (page.columns > 1) {
    const ranges = columnRanges(page);
    ranges.forEach(([x0, x1], i) => {
      if (i > 0) vx(x0, 'column');
      if (i < ranges.length - 1) vx(x1, 'column');
    });
  }
  if (bleed > 0) {
    vx(-bleed, 'bleed');
    vx(w + bleed, 'bleed');
    hy(-bleed, 'bleed');
    hy(h + bleed, 'bleed');
  }
  page.guides.x.forEach((x) => vx(x, 'guide'));
  page.guides.y.forEach((y) => hy(y, 'guide'));
  return t;
}

/** Edges and centers of other objects (their axis-aligned bounding boxes). */
export function buildObjectTargets(boxes: Rect[]): SnapTarget[] {
  const t: SnapTarget[] = [];
  for (const b of boxes) {
    for (const x of [b.x, b.x + b.w / 2, b.x + b.w]) t.push({ axis: 'x', value: x, kind: 'frame', from: b.y, to: b.y + b.h });
    for (const y of [b.y, b.y + b.h / 2, b.y + b.h]) t.push({ axis: 'y', value: y, kind: 'frame', from: b.x, to: b.x + b.w });
  }
  return t;
}

const PRIORITY: Record<SnapKind, number> = { guide: 0, margin: 1, column: 1, page: 2, center: 2, bleed: 3, frame: 4 };

function bestSnap(edges: number[], targets: SnapTarget[], axis: 'x' | 'y', threshold: number): number | null {
  let best: { d: number; score: number } | null = null;
  for (const target of targets) {
    if (target.axis !== axis) continue;
    for (const e of edges) {
      const d = target.value - e;
      const ad = Math.abs(d);
      if (ad > threshold) continue;
      const score = ad + PRIORITY[target.kind] * 0.001;
      if (!best || score < best.score) best = { d, score };
    }
  }
  return best ? best.d : null;
}

function guidesFor(box: Rect, targets: SnapTarget[], edgesX: number[], edgesY: number[]): SnapGuide[] {
  const out: SnapGuide[] = [];
  const seen = new Set<string>();
  const eps = 0.01;
  for (const target of targets) {
    const edges = target.axis === 'x' ? edgesX : edgesY;
    if (!edges.some((e) => Math.abs(e - target.value) < eps)) continue;
    const key = `${target.axis}:${target.value.toFixed(2)}:${target.kind === 'frame' ? 'f' : 'p'}`;
    const lo = target.axis === 'x' ? box.y : box.x;
    const hi = target.axis === 'x' ? box.y + box.h : box.x + box.w;
    const from = target.kind === 'frame' ? Math.min(lo, target.from) : target.from;
    const to = target.kind === 'frame' ? Math.max(hi, target.to) : target.to;
    if (seen.has(key)) {
      const g = out.find((x) => `${x.axis}:${x.value.toFixed(2)}:${x.kind === 'frame' ? 'f' : 'p'}` === key);
      if (g) {
        g.from = Math.min(g.from, from);
        g.to = Math.max(g.to, to);
      }
      continue;
    }
    seen.add(key);
    out.push({ axis: target.axis, value: target.value, from, to, kind: target.kind });
  }
  return out;
}

/**
 * Snaps a moving box (left/center/right and top/middle/bottom) to the targets.
 * Returns the correction to add to the box position and the guides to draw.
 */
export function snapMove(box: Rect, targets: SnapTarget[], threshold: number): SnapResult {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  const dx = bestSnap(xs, targets, 'x', threshold) ?? 0;
  const dy = bestSnap(ys, targets, 'y', threshold) ?? 0;
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides = guidesFor(
    moved,
    targets,
    [moved.x, moved.x + moved.w / 2, moved.x + moved.w],
    [moved.y, moved.y + moved.h / 2, moved.y + moved.h],
  );
  return { dx, dy, guides };
}

/** Snaps a single coordinate (e.g. a dragged edge or a new frame corner). */
export function snapValue(value: number, axis: 'x' | 'y', targets: SnapTarget[], threshold: number): number {
  const d = bestSnap([value], targets, axis, threshold);
  return d === null ? value : value + d;
}

/** Guides for a resized/created box whose snapped edges are listed. */
export function guidesForEdges(box: Rect, targets: SnapTarget[], edgesX: number[], edgesY: number[]): SnapGuide[] {
  return guidesFor(box, targets, edgesX, edgesY);
}
