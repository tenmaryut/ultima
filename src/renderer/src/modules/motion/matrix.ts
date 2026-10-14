/**
 * 2D affine matrices in canvas order [a, b, c, d, e, f]:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m1 · m2 (apply m2 first, then m1). */
export function multiply(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function scaling(sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotation(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return [...IDENTITY];
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Applies only the linear part (for direction vectors / deltas). */
export function applyVector(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

/**
 * Layer transform like After Effects: T(position) · R(rotation) · S(scale) · T(-anchor).
 * Scale is in percent.
 */
export function layerMatrix(position: [number, number], anchor: [number, number], scale: [number, number], rotationDeg: number): Mat {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const sx = scale[0] / 100;
  const sy = scale[1] / 100;
  const a = c * sx;
  const b = s * sx;
  const cc = -s * sy;
  const d = c * sy;
  return [a, b, cc, d, position[0] - (a * anchor[0] + cc * anchor[1]), position[1] - (b * anchor[0] + d * anchor[1])];
}

/** Decomposes a matrix without skew into translation, rotation (deg) and scale (percent). */
export function decompose(m: Mat): { x: number; y: number; rotation: number; scaleX: number; scaleY: number } {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const rot = Math.atan2(m[1], m[0]);
  const sy = sx ? det / sx : Math.hypot(m[2], m[3]);
  return { x: m[4], y: m[5], rotation: (rot * 180) / Math.PI, scaleX: sx * 100, scaleY: sy * 100 };
}

/** Axis-aligned bounds of a transformed rectangle. */
export function transformRect(m: Mat, x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const pts = [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}
