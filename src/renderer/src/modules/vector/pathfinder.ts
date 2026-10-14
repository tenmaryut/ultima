import { booleanOp, ringArea, unionAll, type MultiPolygon, type P, type Ring } from './boolean';
import { polylineToSubpath } from './fit';
import { objectGeom } from './geometry';
import { applyXY, matrixScale, multiply, type Matrix, type Pt } from './matrix';
import type { FillRule, LineCap, LineJoin, PathGeom, SubPath, VObject } from './model';
import { flattenGeom, type Polyline } from './path';

export type PathfinderOp = 'unite' | 'minus-front' | 'intersect' | 'exclude';

/** World-space rings of an object's fill area (curves flattened with `tol` world units). */
export function objectToMultiPolygon(o: VObject, m: Matrix, tol = 0.02): MultiPolygon {
  if (!o.visible) return [];
  if (o.type === 'group') return unionAll(o.children.map((c) => objectToMultiPolygon(c, multiply(m, c.m), tol)));
  const geom = objectGeom(o);
  if (!geom) return [];
  const polys = flattenGeom(geom, tol / matrixScale(m));
  const rings: Ring[] = polys
    .map((p) => toRing(p, m))
    .filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 1e-9);
  if (!rings.length) return [];
  const rule: FillRule = o.type === 'path' ? (o.geom.fillRule ?? 'nonzero') : 'nonzero';
  if (rule === 'evenodd' || rings.length === 1) return rings.map((r) => [r]);
  // nonzero: rings wound like the largest ring add area, the others cut holes
  const largest = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
  const sign = Math.sign(ringArea(largest));
  const plus = rings.filter((r) => Math.sign(ringArea(r)) === sign).map((r) => [[r]] as MultiPolygon);
  const minus = rings.filter((r) => Math.sign(ringArea(r)) !== sign).map((r) => [[r]] as MultiPolygon);
  const added = unionAll(plus);
  return minus.length ? booleanOp(added, unionAll(minus), 'difference') : added;
}

function toRing(poly: Polyline, m: Matrix): Ring {
  const out: Ring = [];
  for (let i = 0; i < poly.pts.length; i += 2) {
    const p = applyXY(m, poly.pts[i], poly.pts[i + 1]);
    out.push([p.x, p.y]);
  }
  return out;
}

/** Runs a pathfinder operation over operands given bottom → top. */
export function runPathfinder(operands: MultiPolygon[], op: PathfinderOp): MultiPolygon {
  const list = operands.filter((o) => o.length);
  if (!list.length) return [];
  switch (op) {
    case 'unite':
      return unionAll(list);
    case 'minus-front':
      return list.length > 1 ? booleanOp(list[0], unionAll(list.slice(1)), 'difference') : list[0];
    case 'intersect':
      return list.slice(1).reduce((acc, cur) => (acc.length ? booleanOp(acc, cur, 'intersection') : acc), list[0]);
    case 'exclude':
      return list.slice(1).reduce((acc, cur) => booleanOp(acc, cur, 'xor'), list[0]);
  }
}

/** Turns boolean output into an editable path, refitting curves through the flattened outline. */
export function polygonsToGeom(mp: MultiPolygon, error = 0.12, straight = false): PathGeom {
  const subpaths: SubPath[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      const sub = polylineToSubpath(
        ring.map(([x, y]) => ({ x, y })),
        true,
        { error, cornerAngle: (32 * Math.PI) / 180, straight },
      );
      if (sub) subpaths.push(sub);
    }
  }
  return { subpaths, fillRule: 'evenodd' };
}

/* ------------------------------ Outline stroke ----------------------------- */

const circlePoly = (c: Pt, r: number, n: number): MultiPolygon => [
  [
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [c.x + Math.cos(a) * r, c.y + Math.sin(a) * r] as P;
    }),
  ],
];

/** Splits a polyline into dashes. */
export function dashPolyline(pts: Pt[], closed: boolean, dash: number[]): Pt[][] {
  const pattern = dash.filter((d) => d > 0);
  if (!pattern.length || pattern.reduce((a, b) => a + b, 0) <= 0) return [closed ? [...pts, pts[0]] : pts];
  const full = pattern.length % 2 ? [...pattern, ...pattern] : pattern;
  const path = closed ? [...pts, pts[0]] : pts;
  const out: Pt[][] = [];
  let idx = 0;
  let remaining = full[0];
  let on = true;
  let current: Pt[] = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    let a = path[i];
    const b = path[i + 1];
    let segLen = Math.hypot(b.x - a.x, b.y - a.y);
    while (segLen > remaining) {
      const t = remaining / segLen;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) {
        current.push(p);
        if (current.length > 1) out.push(current);
      }
      current = [p];
      segLen -= remaining;
      a = p;
      on = !on;
      idx = (idx + 1) % full.length;
      remaining = full[idx];
    }
    remaining -= segLen;
    if (on) current.push(b);
  }
  if (on && current.length > 1) out.push(current);
  return out;
}

interface StrokeSpec {
  width: number;
  cap: LineCap;
  join: LineJoin;
  miterLimit: number;
}

/** Polygons covering the stroke of one polyline. */
function strokePolyline(pts: Pt[], closed: boolean, s: StrokeSpec): MultiPolygon[] {
  const r = s.width / 2;
  const parts: MultiPolygon[] = [];
  const n = pts.length;
  if (n < 2) return parts;
  const segs = closed ? n : n - 1;
  const capN = Math.max(12, Math.min(48, Math.round(r * 2)));
  const normals: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * r;
    const ny = ((b.x - a.x) / len) * r;
    normals.push({ x: nx, y: ny });
    let a2 = a;
    let b2 = b;
    if (!closed && s.cap === 'square') {
      const ux = ((b.x - a.x) / len) * r;
      const uy = ((b.y - a.y) / len) * r;
      if (i === 0) a2 = { x: a.x - ux, y: a.y - uy };
      if (i === segs - 1) b2 = { x: b.x + ux, y: b.y + uy };
    }
    parts.push([
      [
        [
          [a2.x + nx, a2.y + ny],
          [b2.x + nx, b2.y + ny],
          [b2.x - nx, b2.y - ny],
          [a2.x - nx, a2.y - ny],
        ],
      ],
    ]);
  }
  // joins
  const joinCount = closed ? n : n - 2;
  for (let k = 0; k < joinCount; k++) {
    const i = closed ? k : k + 1;
    const p = pts[i % n];
    const n1 = normals[(i - 1 + segs) % segs];
    const n2 = normals[i % segs];
    const cross = n1.x * n2.y - n1.y * n2.x;
    if (Math.abs(cross) < 1e-12 && n1.x * n2.x + n1.y * n2.y > 0) continue;
    if (s.join === 'round') {
      parts.push(circlePoly(p, r, capN));
      continue;
    }
    const side = cross > 0 ? -1 : 1; // outer side of the turn
    const o1 = { x: p.x + n1.x * side, y: p.y + n1.y * side };
    const o2 = { x: p.x + n2.x * side, y: p.y + n2.y * side };
    if (s.join === 'miter') {
      const bis = { x: n1.x + n2.x, y: n1.y + n2.y };
      const bl = Math.hypot(bis.x, bis.y);
      const cosHalf = bl / (2 * r);
      if (cosHalf > 1e-6 && 1 / cosHalf <= s.miterLimit) {
        const ml = r / cosHalf;
        const tip = { x: p.x + (bis.x / bl) * ml * side, y: p.y + (bis.y / bl) * ml * side };
        parts.push([[[[p.x, p.y], [o1.x, o1.y], [tip.x, tip.y], [o2.x, o2.y]]]]);
        continue;
      }
    }
    parts.push([[[[p.x, p.y], [o1.x, o1.y], [o2.x, o2.y]]]]);
  }
  if (!closed && s.cap === 'round') {
    parts.push(circlePoly(pts[0], r, capN));
    parts.push(circlePoly(pts[n - 1], r, capN));
  }
  return parts;
}

/**
 * Converts the stroke of a shape into a filled outline (world coordinates). Respects width,
 * caps, joins, dashes and the stroke position (inside/outside for closed shapes).
 */
export function outlineStrokeGeom(o: VObject, m: Matrix): PathGeom | null {
  if (o.type === 'group' || o.type === 'image' || o.type === 'raw' || o.type === 'text') return null;
  if (o.stroke.paint.type === 'none' || o.stroke.width <= 0) return null;
  const geom = objectGeom(o);
  if (!geom) return null;
  const scale = matrixScale(m);
  const align = o.stroke.align;
  const width = o.stroke.width * scale * (align === 'center' ? 1 : 2);
  const spec: StrokeSpec = { width, cap: o.stroke.cap, join: o.stroke.join, miterLimit: o.stroke.miterLimit };
  const parts: MultiPolygon[] = [];
  for (const poly of flattenGeom(geom, 0.05 / scale)) {
    const pts: Pt[] = [];
    for (let i = 0; i < poly.pts.length; i += 2) pts.push(applyXY(m, poly.pts[i], poly.pts[i + 1]));
    const dashes = o.stroke.dash.length ? dashPolyline(pts, poly.closed, o.stroke.dash.map((d) => d * scale)) : null;
    if (dashes) for (const d of dashes) parts.push(...strokePolyline(d, false, spec));
    else parts.push(...strokePolyline(pts, poly.closed, spec));
  }
  let area = unionAll(parts);
  if (align !== 'center') {
    const fillArea = objectToMultiPolygon({ ...o, visible: true } as VObject, m, 0.05);
    area = booleanOp(area, fillArea, align === 'inside' ? 'intersection' : 'difference');
  }
  if (!area.length) return null;
  return polygonsToGeom(area, 0.08);
}
