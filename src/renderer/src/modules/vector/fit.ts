import { cubicAt, cubicDerivAt, cubicSecondDerivAt, type Cubic } from './bezier';
import type { Pt } from './matrix';
import type { PathNode, SubPath } from './model';

/*
 * Curve fitting after Philip J. Schneider, "An Algorithm for Automatically Fitting
 * Digitized Curves" (Graphics Gems, 1990). Used by the pencil tool and to turn the
 * polygons produced by boolean operations back into smooth bézier paths.
 */

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

function toCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Cubic {
  return [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y];
}

function chordLengthParameterize(pts: Pt[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generateBezier(pts: Pt[], first: number, last: number, u: number[], t1: Pt, t2: Pt): Cubic {
  const p0 = pts[first];
  const p3 = pts[last];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a0 = mul(t1, b1);
    const a1 = mul(t2, b2);
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const tmp = sub(pts[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const alphaL = det ? (x0 * c11 - x1 * c01) / det : 0;
  const alphaR = det ? (c00 * x1 - c01 * x0) / det : 0;
  const segLength = len(sub(p3, p0));
  const eps = 1e-6 * segLength;
  if (alphaL < eps || alphaR < eps || alphaL > segLength * 4 || alphaR > segLength * 4) {
    const d = segLength / 3;
    return toCubic(p0, add(p0, mul(t1, d)), add(p3, mul(t2, d)), p3);
  }
  return toCubic(p0, add(p0, mul(t1, alphaL)), add(p3, mul(t2, alphaR)), p3);
}

function computeMaxError(pts: Pt[], first: number, last: number, bez: Cubic, u: number[]): { max: number; split: number } {
  let max = 0;
  let split = Math.floor((last - first + 1) / 2) + first;
  for (let i = first + 1; i < last; i++) {
    const p = cubicAt(bez, u[i - first]);
    const d = (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2;
    if (d >= max) {
      max = d;
      split = i;
    }
  }
  return { max, split };
}

function reparameterize(pts: Pt[], first: number, u: number[], bez: Cubic): number[] {
  return u.map((t, i) => {
    const p = pts[first + i];
    const q = cubicAt(bez, t);
    const q1 = cubicDerivAt(bez, t);
    const q2 = cubicSecondDerivAt(bez, t);
    const d = sub(q, p);
    const numerator = dot(d, q1);
    const denominator = dot(q1, q1) + dot(d, q2);
    if (!denominator) return t;
    return Math.max(0, Math.min(1, t - numerator / denominator));
  });
}

function centerTangent(pts: Pt[], center: number): Pt {
  const v1 = sub(pts[center - 1], pts[center]);
  const v2 = sub(pts[center], pts[center + 1]);
  const t = norm({ x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 });
  return t.x || t.y ? t : norm(sub(pts[center - 1], pts[center + 1]));
}

function fitCubic(pts: Pt[], first: number, last: number, t1: Pt, t2: Pt, errSq: number, out: Cubic[], depth: number): void {
  const n = last - first + 1;
  if (n === 2 || depth > 40) {
    const d = len(sub(pts[last], pts[first])) / 3;
    out.push(toCubic(pts[first], add(pts[first], mul(t1, d)), add(pts[last], mul(t2, d)), pts[last]));
    return;
  }
  let u = chordLengthParameterize(pts, first, last);
  let bez = generateBezier(pts, first, last, u, t1, t2);
  let { max, split } = computeMaxError(pts, first, last, bez, u);
  if (max < errSq) {
    out.push(bez);
    return;
  }
  // reparameterizing converges well even from several times the target error
  if (max < errSq * 64) {
    for (let i = 0; i < 24; i++) {
      const uPrime = reparameterize(pts, first, u, bez);
      bez = generateBezier(pts, first, last, uPrime, t1, t2);
      ({ max, split } = computeMaxError(pts, first, last, bez, uPrime));
      if (max < errSq) {
        out.push(bez);
        return;
      }
      u = uPrime;
    }
  }
  // split at the worst point, but keep the halves balanced (smooth curves fit in fewer pieces)
  const span = last - first;
  if (span >= 8 && (split - first < span * 0.3 || last - split < span * 0.3)) split = first + Math.round(span / 2);
  const tc = centerTangent(pts, split);
  fitCubic(pts, first, split, t1, tc, errSq, out, depth + 1);
  fitCubic(pts, split, last, mul(tc, -1), t2, errSq, out, depth + 1);
}

/** Removes consecutive duplicates (closer than `minDist`). */
export function dedupe(points: Pt[], minDist = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > minDist) out.push(p);
  }
  return out;
}

/**
 * Tangent at an end of the polyline, from the parabola through the first three points
 * (second-order accurate; the first chord alone is too crude for tight tolerances).
 * `step` = 1 for the start (pointing forward), -1 for the end (pointing backward).
 */
function endTangent(pts: Pt[], step: 1 | -1): Pt {
  const n = pts.length;
  const i0 = step === 1 ? 0 : n - 1;
  const p0 = pts[i0];
  const p1 = pts[i0 + step];
  if (n < 3) return norm(sub(p1, p0));
  const p2 = pts[i0 + 2 * step];
  const h1 = len(sub(p1, p0));
  const h2 = len(sub(p2, p1));
  if (h1 < 1e-9 || h2 < 1e-9 || h2 > h1 * 8 || h1 > h2 * 8) return norm(sub(p1, p0));
  const a = -(2 * h1 + h2) / (h1 * (h1 + h2));
  const b = (h1 + h2) / (h1 * h2);
  const c = -h1 / (h2 * (h1 + h2));
  const t = norm({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y });
  // keep it pointing into the curve
  return dot(t, sub(p1, p0)) > 0 ? t : norm(sub(p1, p0));
}

/** Fits an open polyline with cubic béziers so no point is farther than `error`. */
export function fitCurve(points: Pt[], error: number): Cubic[] {
  const pts = dedupe(points);
  if (pts.length < 2) return [];
  const t1 = endTangent(pts, 1);
  const t2 = endTangent(pts, -1);
  const out: Cubic[] = [];
  fitCubic(pts, 0, pts.length - 1, t1, t2, error * error, out, 0);
  return out;
}

/** Fits a closed loop (no corners) keeping the tangent continuous at the start point. */
export function fitClosedCurve(points: Pt[], error: number): Cubic[] {
  const pts = dedupe(points);
  if (pts.length < 3) return [];
  const loop = [...pts, pts[0]];
  const t = norm(sub(pts[1], pts[pts.length - 1]));
  const out: Cubic[] = [];
  fitCubic(loop, 0, loop.length - 1, t, mul(t, -1), error * error, out, 0);
  return out;
}

/** Ramer–Douglas–Peucker simplification. */
export function simplifyRDP(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tolSq = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const pa = points[a];
    const pb = points[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const l2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      let d: number;
      if (!l2) d = (p.x - pa.x) ** 2 + (p.y - pa.y) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / l2));
        d = (p.x - pa.x - t * dx) ** 2 + (p.y - pa.y - t * dy) ** 2;
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolSq && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Light moving-average smoothing that keeps the end points. */
export function smoothPoints(points: Pt[], passes = 1): Pt[] {
  let pts = points;
  for (let k = 0; k < passes; k++) {
    if (pts.length < 3) return pts;
    const next: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      next.push({ x: (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) / 4, y: (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4 });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function isStraightRun(pts: Pt[], tolerance: number): boolean {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return pts.every((p) => Math.hypot(p.x - a.x, p.y - a.y) <= tolerance);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / l;
    if (d > tolerance) return false;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (l * l);
    if (t < -0.01 || t > 1.01) return false;
  }
  return true;
}

function turnAngle(prev: Pt, p: Pt, next: Pt): number {
  const a = norm(sub(p, prev));
  const b = norm(sub(next, p));
  if ((!a.x && !a.y) || (!b.x && !b.y)) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

export interface PolylineFitOptions {
  /** Max distance between the polyline and the fitted curve. */
  error: number;
  /** Turning angle (radians) above which a vertex is kept as a sharp corner. */
  cornerAngle?: number;
  /** Treat every run as straight lines (no curve fitting). */
  straight?: boolean;
}

/**
 * Converts a polyline into a sub path: sharp corners stay corners, everything in between
 * is fitted with smooth béziers, straight runs become straight segments.
 */
export function polylineToSubpath(points: Pt[], closed: boolean, opts: PolylineFitOptions): SubPath | null {
  let pts = dedupe(points, Math.max(1e-6, opts.error * 0.01));
  if (closed && pts.length > 2) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) pts = pts.slice(0, -1);
  }
  if (pts.length < 2) return null;
  const cornerAngle = opts.cornerAngle ?? (35 * Math.PI) / 180;
  const n = pts.length;
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      corners.push(i);
      continue;
    }
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    if (opts.straight || turnAngle(prev, pts[i], next) > cornerAngle) corners.push(i);
  }

  const nodes: PathNode[] = [];
  const emitRun = (run: Pt[]) => {
    // run includes both end points; appends nodes for run[0] .. run[last-1]
    if (run.length < 2) return;
    let cubics: Cubic[];
    if (run.length === 2 || opts.straight || isStraightRun(run, opts.error * 0.5)) {
      cubics = [[run[0].x, run[0].y, run[0].x, run[0].y, run[run.length - 1].x, run[run.length - 1].y, run[run.length - 1].x, run[run.length - 1].y]];
    } else cubics = fitCurve(run, opts.error);
    cubics.forEach((c, k) => {
      const straight = c[0] === c[2] && c[1] === c[3] && c[4] === c[6] && c[5] === c[7];
      let node = k === 0 ? nodes[nodes.length - 1] : undefined;
      if (k === 0 && (!node || node.x !== c[0] || node.y !== c[1])) {
        node = { x: c[0], y: c[1] };
        nodes.push(node);
      }
      if (k > 0) {
        node = nodes[nodes.length - 1];
        node.smooth = !straight || node.smooth;
      }
      if (!straight && node) node.out = { x: c[2], y: c[3] };
      const end: PathNode = { x: c[6], y: c[7] };
      if (!straight) end.in = { x: c[4], y: c[5] };
      nodes.push(end);
    });
  };

  if (closed && corners.length === 0) {
    const cubics = fitClosedCurve(pts, opts.error);
    if (!cubics.length) return null;
    cubics.forEach((c, k) => {
      const node: PathNode = k === 0 ? { x: c[0], y: c[1], smooth: true } : nodes[nodes.length - 1];
      if (k === 0) nodes.push(node);
      node.out = { x: c[2], y: c[3] };
      node.smooth = true;
      nodes.push({ x: c[6], y: c[7], in: { x: c[4], y: c[5] }, smooth: true });
    });
    // last node duplicates the first: move its in-handle over
    const last = nodes.pop() as PathNode;
    nodes[0].in = last.in;
    return { nodes, closed: true };
  }

  if (!closed) {
    for (let k = 0; k < corners.length - 1; k++) emitRun(pts.slice(corners[k], corners[k + 1] + 1));
    return nodes.length >= 2 ? { nodes, closed: false } : null;
  }

  // closed with corners: walk from the first corner around the loop
  const order = [...corners, corners[0] + n];
  for (let k = 0; k < order.length - 1; k++) {
    const run: Pt[] = [];
    for (let i = order[k]; i <= order[k + 1]; i++) run.push(pts[i % n]);
    emitRun(run);
  }
  // the final node equals the first corner: merge handles
  if (nodes.length > 1) {
    const last = nodes.pop() as PathNode;
    if (last.in) nodes[0].in = last.in;
  }
  for (const node of nodes) if (node.smooth && (!node.in || !node.out)) node.smooth = false;
  return nodes.length >= 2 ? { nodes, closed: true } : null;
}
