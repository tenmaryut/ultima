import type { PathNode, ShapeKind, SubPath } from './types';

/** Shape geometry (pure): primitives → bézier sub-paths, flattening, trim paths, bounds. */

const KAPPA = 0.5522847498307936;

function n(x: number, y: number, inX = 0, inY = 0, outX = 0, outY = 0): PathNode {
  return { x, y, inX, inY, outX, outY };
}

/** Rounded rectangle centered on the origin. */
export function rectPath(w: number, h: number, radius: number): SubPath {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.max(0, Math.min(radius, Math.abs(hw), Math.abs(hh)));
  if (r <= 0.0001) {
    return { closed: true, nodes: [n(-hw, -hh), n(hw, -hh), n(hw, hh), n(-hw, hh)] };
  }
  const k = r * KAPPA;
  return {
    closed: true,
    nodes: [
      n(-hw + r, -hh, -k, 0, 0, 0),
      n(hw - r, -hh, 0, 0, k, 0),
      n(hw, -hh + r, 0, -k, 0, 0),
      n(hw, hh - r, 0, 0, 0, k),
      n(hw - r, hh, k, 0, 0, 0),
      n(-hw + r, hh, 0, 0, -k, 0),
      n(-hw, hh - r, 0, k, 0, 0),
      n(-hw, -hh + r, 0, 0, 0, -k),
    ],
  };
}

/** Ellipse centered on the origin, starting at the top and running clockwise. */
export function ellipsePath(w: number, h: number): SubPath {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    nodes: [n(0, -ry, -kx, 0, kx, 0), n(rx, 0, 0, -ky, 0, ky), n(0, ry, kx, 0, -kx, 0), n(-rx, 0, 0, ky, 0, -ky)],
  };
}

export function polygonPath(sides: number, w: number, h: number): SubPath {
  const count = Math.max(3, Math.round(sides));
  const nodes: PathNode[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    nodes.push(n((Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2));
  }
  return { closed: true, nodes };
}

export function starPath(points: number, w: number, h: number, innerPercent: number): SubPath {
  const count = Math.max(3, Math.round(points));
  const inner = Math.max(0.01, Math.min(1, innerPercent / 100));
  const nodes: PathNode[] = [];
  for (let i = 0; i < count * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / count;
    const r = i % 2 === 0 ? 1 : inner;
    nodes.push(n((Math.cos(a) * w * r) / 2, (Math.sin(a) * h * r) / 2));
  }
  return { closed: true, nodes };
}

export function linePath(length: number): SubPath {
  return { closed: false, nodes: [n(-length / 2, 0), n(length / 2, 0)] };
}

export interface ShapeGeometryInput {
  kind: ShapeKind;
  width: number;
  height: number;
  radius: number;
  points: number;
  innerRadius: number;
  path?: SubPath[];
}

export function shapeSubpaths(s: ShapeGeometryInput): SubPath[] {
  switch (s.kind) {
    case 'rect':
      return [rectPath(s.width, s.height, s.radius)];
    case 'ellipse':
      return [ellipsePath(s.width, s.height)];
    case 'polygon':
      return [polygonPath(s.points, s.width, s.height)];
    case 'star':
      return [starPath(s.points, s.width, s.height, s.innerRadius)];
    case 'line':
      return [linePath(s.width)];
    case 'path':
      return s.path ?? [];
  }
}

/** Anything with canvas path methods (CanvasRenderingContext2D, Path2D, test doubles). */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
}

export function tracePath(sink: PathSink, subpaths: SubPath[]): void {
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    const first = sp.nodes[0];
    sink.moveTo(first.x, first.y);
    const count = sp.closed ? sp.nodes.length : sp.nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % sp.nodes.length];
      if (!a.outX && !a.outY && !b.inX && !b.inY) sink.lineTo(b.x, b.y);
      else sink.bezierCurveTo(a.x + a.outX, a.y + a.outY, b.x + b.inX, b.y + b.inY, b.x, b.y);
    }
    if (sp.closed) sink.closePath();
  }
}

/* ------------------------------- Flattening ------------------------------ */

export interface Polyline {
  /** Flat x,y pairs. */
  points: number[];
  closed: boolean;
  /** Cumulative length at each point (same count as points/2). */
  cumulative: number[];
  length: number;
}

function cubicPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/**
 * Converts sub-paths into polylines. `tolerance` is the max chord error in path units
 * (smaller = more segments).
 */
export function flatten(subpaths: SubPath[], tolerance = 0.5): Polyline[] {
  const out: Polyline[] = [];
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    const pts: number[] = [sp.nodes[0].x, sp.nodes[0].y];
    const count = sp.closed ? sp.nodes.length : sp.nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % sp.nodes.length];
      if (!a.outX && !a.outY && !b.inX && !b.inY) {
        pts.push(b.x, b.y);
        continue;
      }
      const c1x = a.x + a.outX;
      const c1y = a.y + a.outY;
      const c2x = b.x + b.inX;
      const c2y = b.y + b.inY;
      // Segment count from the control polygon length (a safe upper bound of the curve length).
      const poly = Math.hypot(c1x - a.x, c1y - a.y) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(b.x - c2x, b.y - c2y);
      const steps = Math.max(2, Math.min(256, Math.ceil(Math.sqrt(poly / Math.max(0.05, tolerance)) * 1.5)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        pts.push(cubicPoint(a.x, c1x, c2x, b.x, t), cubicPoint(a.y, c1y, c2y, b.y, t));
      }
    }
    if (sp.closed) pts.push(sp.nodes[0].x, sp.nodes[0].y);
    const cumulative = [0];
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) {
      len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      cumulative.push(len);
    }
    out.push({ points: pts, closed: sp.closed, cumulative, length: len });
  }
  return out;
}

function pointAtLength(poly: Polyline, d: number): [number, number, number] {
  // returns x, y and the index of the segment end point
  const c = poly.cumulative;
  if (d <= 0) return [poly.points[0], poly.points[1], 1];
  if (d >= poly.length) {
    const last = c.length - 1;
    return [poly.points[last * 2], poly.points[last * 2 + 1], last];
  }
  let lo = 1;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const seg = c[lo] - c[lo - 1];
  const t = seg > 0 ? (d - c[lo - 1]) / seg : 0;
  const x = poly.points[(lo - 1) * 2] + (poly.points[lo * 2] - poly.points[(lo - 1) * 2]) * t;
  const y = poly.points[(lo - 1) * 2 + 1] + (poly.points[lo * 2 + 1] - poly.points[(lo - 1) * 2 + 1]) * t;
  return [x, y, lo];
}

/** Portion of one polyline between distances [from, to] (from < to). */
function slice(poly: Polyline, from: number, to: number): number[] {
  const [sx, sy, si] = pointAtLength(poly, from);
  const [ex, ey, ei] = pointAtLength(poly, to);
  const pts = [sx, sy];
  for (let i = si; i < ei; i++) pts.push(poly.points[i * 2], poly.points[i * 2 + 1]);
  pts.push(ex, ey);
  return pts;
}

/**
 * Trim paths: keeps the part of every polyline between start% and end% of its length
 * (each sub-path trimmed simultaneously, like After Effects' default). Returns open point
 * lists; untrimmed closed polylines stay closed.
 */
export function trimPolylines(polys: Polyline[], startPct: number, endPct: number): { points: number[]; closed: boolean }[] {
  let s = Math.max(0, Math.min(100, startPct)) / 100;
  let e = Math.max(0, Math.min(100, endPct)) / 100;
  if (s > e) [s, e] = [e, s];
  if (e - s <= 1e-6) return [];
  const out: { points: number[]; closed: boolean }[] = [];
  for (const poly of polys) {
    if (s <= 1e-6 && e >= 1 - 1e-6) {
      out.push({ points: poly.points, closed: poly.closed });
      continue;
    }
    if (poly.length <= 0) continue;
    out.push({ points: slice(poly, s * poly.length, e * poly.length), closed: false });
  }
  return out;
}

export function polylineLength(points: number[]): number {
  let len = 0;
  for (let i = 2; i < points.length; i += 2) len += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return len;
}

/** Bounding box of sub-paths (exact for lines, sampled for curves). */
export function pathBounds(subpaths: SubPath[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of flatten(subpaths, 1)) {
    for (let i = 0; i < poly.points.length; i += 2) {
      const x = poly.points[i];
      const y = poly.points[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Moves the geometry so that its bounding box is centered on the origin. Returns the old center. */
export function centerSubpaths(subpaths: SubPath[]): { subpaths: SubPath[]; cx: number; cy: number } {
  const b = pathBounds(subpaths);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return {
    cx,
    cy,
    subpaths: subpaths.map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((nd) => ({ ...nd, x: nd.x - cx, y: nd.y - cy })) })),
  };
}

/** Point-in-polygon test (even-odd) over flattened sub-paths. */
export function pointInPolylines(polys: Polyline[], x: number, y: number): boolean {
  let inside = false;
  for (const poly of polys) {
    const p = poly.points;
    const count = p.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const xi = p[i * 2];
      const yi = p[i * 2 + 1];
      const xj = p[j * 2];
      const yj = p[j * 2 + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to the nearest polyline segment. */
export function distanceToPolylines(polys: Polyline[], x: number, y: number): number {
  let best = Infinity;
  for (const poly of polys) {
    const p = poly.points;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2];
      const ay = p[i - 1];
      const bx = p[i];
      const by = p[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
  }
  return best;
}
