/**
 * 2D affine matrices in SVG order: [a, b, c, d, e, f] maps (x, y) to
 * (a·x + c·y + e, b·x + d·y + f). `multiply(m1, m2)` applies m2 first.
 */

export type Matrix = [number, number, number, number, number, number];

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Multiplies several matrices left to right (the last one is applied first). */
export function chain(...ms: Matrix[]): Matrix {
  return ms.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

export function determinant(m: Matrix): number {
  return m[0] * m[3] - m[1] * m[2];
}

export function invert(m: Matrix): Matrix {
  const det = determinant(m);
  if (!det || !Number.isFinite(det)) return [1, 0, 0, 1, -m[4], -m[5]];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function apply(m: Matrix, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function applyXY(m: Matrix, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Applies only the linear part (for vectors/offsets). */
export function applyVec(m: Matrix, v: Pt): Pt {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

export function translate(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotate(deg: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // snap tiny float noise so 90° rotations stay exact
  const c = Math.abs(cos) < 1e-12 ? 0 : cos;
  const s = Math.abs(sin) < 1e-12 ? 0 : sin;
  return [c, s, -s, c, 0, 0];
}

export function rotateAbout(deg: number, cx: number, cy: number): Matrix {
  return chain(translate(cx, cy), rotate(deg), translate(-cx, -cy));
}

export function scaleAbout(sx: number, sy: number, cx: number, cy: number): Matrix {
  return chain(translate(cx, cy), scale(sx, sy), translate(-cx, -cy));
}

export function skewX(deg: number): Matrix {
  return [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0];
}

export function skewY(deg: number): Matrix {
  return [1, Math.tan((deg * Math.PI) / 180), 0, 1, 0, 0];
}

export function isIdentity(m: Matrix, eps = 1e-9): boolean {
  return (
    Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < eps && Math.abs(m[5]) < eps
  );
}

export function isTranslation(m: Matrix, eps = 1e-9): boolean {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps;
}

export function equalsMatrix(m1: Matrix, m2: Matrix, eps = 1e-9): boolean {
  for (let i = 0; i < 6; i++) if (Math.abs(m1[i] - m2[i]) > eps) return false;
  return true;
}

/** Average linear scale factor (for converting screen tolerances into local units). */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(determinant(m))) || 1;
}

export interface Decomposed {
  /** Translation (the image of the local origin). */
  tx: number;
  ty: number;
  /** Rotation in degrees (-180, 180]. */
  rotation: number;
  /** Positive scale factors. */
  sx: number;
  sy: number;
  /** Shear factor (x += k·y before scaling is undone). 0 for plain rotate/scale matrices. */
  skew: number;
  flipX: boolean;
}

/**
 * Splits a matrix into rotation · shear · scale · flip:
 * L = R(rotation) · [[1, skew], [0, 1]] · diag(sx, sy) · diag(flipX ? -1 : 1, 1)
 */
export function decompose(m: Matrix): Decomposed {
  let [a, b] = [m[0], m[1]];
  const [c, d] = [m[2], m[3]];
  const flipX = determinant(m) < 0;
  if (flipX) {
    a = -a;
    b = -b;
  }
  const sx = Math.hypot(a, b) || 1e-12;
  const rad = Math.atan2(b, a);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const c2 = cos * c + sin * d;
  const d2 = -sin * c + cos * d;
  const sy = Math.abs(d2) || 1e-12;
  const skew = d2 ? c2 / d2 : 0;
  let rotation = (rad * 180) / Math.PI;
  if (rotation <= -180) rotation += 360;
  return { tx: m[4], ty: m[5], rotation: cleanAngle(rotation), sx, sy, skew: Math.abs(skew) < 1e-10 ? 0 : skew, flipX };
}

export function compose(p: Decomposed): Matrix {
  const shear: Matrix = [1, 0, p.skew, 1, 0, 0];
  const lin = chain(rotate(p.rotation), shear, scale(p.sx, p.sy), scale(p.flipX ? -1 : 1, 1));
  return [lin[0], lin[1], lin[2], lin[3], p.tx, p.ty];
}

function cleanAngle(deg: number): number {
  const r = Math.round(deg * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

/** Rotation angle of the matrix' x axis (degrees). */
export function matrixRotation(m: Matrix): number {
  return decompose(m).rotation;
}

export function rectCorners(r: Rect): Pt[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

export function boundsOfPoints(points: Pt[]): Rect | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Axis-aligned bounds of a transformed rectangle. */
export function transformRect(m: Matrix, r: Rect): Rect {
  return boundsOfPoints(rectCorners(r).map((p) => apply(m, p))) as Rect;
}

export function unionRects(rects: (Rect | null | undefined)[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (!r) continue;
    if (!out) {
      out = { ...r };
      continue;
    }
    const x0 = Math.min(out.x, r.x);
    const y0 = Math.min(out.y, r.y);
    const x1 = Math.max(out.x + out.width, r.x + r.width);
    const y1 = Math.max(out.y + out.height, r.y + r.height);
    out = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  return out;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function rectContainsPoint(r: Rect, p: Pt, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

export function rectCenter(r: Rect): Pt {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/* ------------------------------ SVG transforms ------------------------------ */

/** Formats a number for SVG output: up to `digits` decimals, no trailing zeros. */
export function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '0';
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  if (Object.is(r, -0) || r === 0) return '0';
  return String(r);
}

export function matrixToSvg(m: Matrix): string | undefined {
  if (isIdentity(m, 1e-7)) return undefined;
  if (isTranslation(m, 1e-7)) return `translate(${fmt(m[4])} ${fmt(m[5])})`;
  return `matrix(${fmt(m[0], 6)} ${fmt(m[1], 6)} ${fmt(m[2], 6)} ${fmt(m[3], 6)} ${fmt(m[4])} ${fmt(m[5])})`;
}

/** Parses an SVG `transform` attribute (matrix, translate, scale, rotate, skewX, skewY). */
export function parseTransform(input: string | null | undefined): Matrix {
  if (!input) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    const name = match[1].toLowerCase();
    const args = (match[2].match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let t: Matrix = IDENTITY;
    switch (name) {
      case 'matrix':
        if (args.length >= 6) t = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      case 'translate':
        t = translate(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale':
        t = scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
        break;
      case 'rotate':
        t = args.length >= 3 ? rotateAbout(args[0], args[1], args[2]) : rotate(args[0] ?? 0);
        break;
      case 'skewx':
        t = skewX(args[0] ?? 0);
        break;
      case 'skewy':
        t = skewY(args[0] ?? 0);
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
