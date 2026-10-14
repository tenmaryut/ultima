import type { Pt, Rect } from './matrix';

/** Cubic bézier as flat numbers: x0 y0 x1 y1 x2 y2 x3 y3. */
export type Cubic = [number, number, number, number, number, number, number, number];

export function cubicAt(c: Cubic, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return { x: a * c[0] + b * c[2] + d * c[4] + e * c[6], y: a * c[1] + b * c[3] + d * c[5] + e * c[7] };
}

export function cubicDerivAt(c: Cubic, t: number): Pt {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const d = 3 * t * t;
  return {
    x: a * (c[2] - c[0]) + b * (c[4] - c[2]) + d * (c[6] - c[4]),
    y: a * (c[3] - c[1]) + b * (c[5] - c[3]) + d * (c[7] - c[5]),
  };
}

export function cubicSecondDerivAt(c: Cubic, t: number): Pt {
  const mt = 1 - t;
  return {
    x: 6 * mt * (c[4] - 2 * c[2] + c[0]) + 6 * t * (c[6] - 2 * c[4] + c[2]),
    y: 6 * mt * (c[5] - 2 * c[3] + c[1]) + 6 * t * (c[7] - 2 * c[5] + c[3]),
  };
}

/** de Casteljau split at t. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const x01 = x0 + (x1 - x0) * t;
  const y01 = y0 + (y1 - y0) * t;
  const x12 = x1 + (x2 - x1) * t;
  const y12 = y1 + (y2 - y1) * t;
  const x23 = x2 + (x3 - x2) * t;
  const y23 = y2 + (y3 - y2) * t;
  const x012 = x01 + (x12 - x01) * t;
  const y012 = y01 + (y12 - y01) * t;
  const x123 = x12 + (x23 - x12) * t;
  const y123 = y12 + (y23 - y12) * t;
  const x = x012 + (x123 - x012) * t;
  const y = y012 + (y123 - y012) * t;
  return [
    [x0, y0, x01, y01, x012, y012, x, y],
    [x, y, x123, y123, x23, y23, x3, y3],
  ];
}

/** True when the control points lie on the chord (the curve is a straight line). */
export function isStraight(c: Cubic, eps = 1e-9): boolean {
  const dx = c[6] - c[0];
  const dy = c[7] - c[1];
  const len = Math.hypot(dx, dy);
  if (len < eps) return Math.hypot(c[2] - c[0], c[3] - c[1]) < eps && Math.hypot(c[4] - c[6], c[5] - c[7]) < eps;
  const d1 = Math.abs((c[2] - c[0]) * dy - (c[3] - c[1]) * dx) / len;
  const d2 = Math.abs((c[4] - c[0]) * dy - (c[5] - c[1]) * dx) / len;
  return d1 < eps && d2 < eps;
}

/** Real roots of a·t² + b·t + c in (0, 1). */
function quadRoots(a: number, b: number, c: number): number[] {
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** Tight axis-aligned bounds of a cubic (uses the derivative's roots). */
export function cubicBounds(c: Cubic): Rect {
  let x0 = Math.min(c[0], c[6]);
  let x1 = Math.max(c[0], c[6]);
  let y0 = Math.min(c[1], c[7]);
  let y1 = Math.max(c[1], c[7]);
  const extend = (i: 0 | 1) => {
    const p0 = c[i];
    const p1 = c[i + 2];
    const p2 = c[i + 4];
    const p3 = c[i + 6];
    const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
    const b = 6 * (p0 - 2 * p1 + p2);
    const cc = 3 * (p1 - p0);
    for (const t of quadRoots(a, b, cc)) {
      const mt = 1 - t;
      const v = mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
      if (i === 0) {
        x0 = Math.min(x0, v);
        x1 = Math.max(x1, v);
      } else {
        y0 = Math.min(y0, v);
        y1 = Math.max(y1, v);
      }
    }
  };
  extend(0);
  extend(1);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Number of line segments needed so the flattening error stays below `tolerance` (Wang's formula). */
export function segmentsFor(c: Cubic, tolerance: number): number {
  const ddx = Math.max(Math.abs(c[0] - 2 * c[2] + c[4]), Math.abs(c[2] - 2 * c[4] + c[6]));
  const ddy = Math.max(Math.abs(c[1] - 2 * c[3] + c[5]), Math.abs(c[3] - 2 * c[5] + c[7]));
  const m = Math.hypot(ddx, ddy);
  if (m < 1e-12) return 1;
  return Math.max(1, Math.min(512, Math.ceil(Math.sqrt((0.75 * m) / Math.max(1e-6, tolerance)))));
}

/** Appends the flattened points of `c` (excluding its start point) to `out` as x,y pairs. */
export function flattenCubic(c: Cubic, tolerance: number, out: number[]): void {
  if (isStraight(c, 1e-9)) {
    out.push(c[6], c[7]);
    return;
  }
  const n = segmentsFor(c, tolerance);
  for (let i = 1; i <= n; i++) {
    const p = cubicAt(c, i / n);
    out.push(p.x, p.y);
  }
}

/** Closest point on the curve to `p`. */
export function nearestOnCubic(c: Cubic, p: Pt): { t: number; dist: number; point: Pt } {
  const samples = 24;
  let bestT = 0;
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const q = cubicAt(c, t);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  // refine with a shrinking bracket search (robust, no derivative blow-ups)
  let step = 1 / samples;
  let t = bestT;
  for (let iter = 0; iter < 30 && step > 1e-7; iter++) {
    const tl = Math.max(0, t - step);
    const tr = Math.min(1, t + step);
    const ql = cubicAt(c, tl);
    const qr = cubicAt(c, tr);
    const dl = (ql.x - p.x) ** 2 + (ql.y - p.y) ** 2;
    const dr = (qr.x - p.x) ** 2 + (qr.y - p.y) ** 2;
    if (dl < best) {
      best = dl;
      t = tl;
    } else if (dr < best) {
      best = dr;
      t = tr;
    } else step /= 2;
  }
  const point = cubicAt(c, t);
  return { t, dist: Math.sqrt(best), point };
}

/** Approximate arc length (flattened). */
export function cubicLength(c: Cubic): number {
  const pts: number[] = [c[0], c[1]];
  flattenCubic(c, 0.05, pts);
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
}

/** Cubic equivalent of a quadratic bézier. */
export function quadToCubic(x0: number, y0: number, qx: number, qy: number, x1: number, y1: number): Cubic {
  return [x0, y0, x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x1 + (2 / 3) * (qx - x1), y1 + (2 / 3) * (qy - y1), x1, y1];
}

export function lineCubic(x0: number, y0: number, x1: number, y1: number): Cubic {
  return [x0, y0, x0, y0, x1, y1, x1, y1];
}

/** Kappa for approximating a quarter circle with one cubic. */
export const KAPPA = 0.5522847498307936;

/**
 * Converts an SVG elliptical arc (endpoint parameterization) into cubic béziers.
 * Implements the conversion from the SVG 1.1 implementation notes (F.6.5).
 */
export function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Cubic[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry) return [lineCubic(x1, y1, x2, y2)];
  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9));
  const delta = dtheta / segments;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: Cubic[] = [];
  let a1 = theta1;
  let px = x1;
  let py = y1;
  for (let i = 0; i < segments; i++) {
    const a2 = a1 + delta;
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2);
    const sin2 = Math.sin(a2);
    // unit circle control points, then scale/rotate/translate
    const map = (ux: number, uy: number): [number, number] => {
      const ex = ux * rx;
      const ey = uy * ry;
      return [cosPhi * ex - sinPhi * ey + cx, sinPhi * ex + cosPhi * ey + cy];
    };
    const c1 = map(cos1 - t * sin1, sin1 + t * cos1);
    const c2 = map(cos2 + t * sin2, sin2 - t * cos2);
    const end = i === segments - 1 ? [x2, y2] : map(cos2, sin2);
    out.push([px, py, c1[0], c1[1], c2[0], c2[1], end[0], end[1]]);
    px = end[0];
    py = end[1];
    a1 = a2;
  }
  return out;
}
