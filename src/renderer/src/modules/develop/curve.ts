/**
 * Tone curve interpolation (monotone cubic Hermite / Fritsch–Carlson: smooth, no
 * overshoot) and the lookup table uploaded to the GPU.
 */
import type { CurvePoint, DevelopSettings } from './params';
import { curveIsIdentity } from './params';

export const LUT_SIZE = 1024;

export type CurveFn = (x: number) => number;

/** Builds an evaluator for sorted control points (x ascending, 0..1). */
export function buildCurve(points: CurvePoint[]): CurveFn {
  const pts = points.filter((p, i) => i === 0 || p[0] > points[i - 1][0]);
  const n = pts.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => pts[0][1];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[k] = tau * a * d[k];
      m[k + 1] = tau * b * d[k];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  };
}

export function sampleCurve(points: CurvePoint[], count: number): Float32Array {
  const fn = buildCurve(points);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = fn(i / (count - 1));
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

export function curvesActive(s: DevelopSettings): boolean {
  return !(curveIsIdentity(s.curveRgb) && curveIsIdentity(s.curveRed) && curveIsIdentity(s.curveGreen) && curveIsIdentity(s.curveBlue));
}

/** RGBA float LUT: r, g, b channel curves + master (rgb) curve in alpha. */
export function buildCurveLut(s: DevelopSettings): Float32Array {
  const r = sampleCurve(s.curveRed, LUT_SIZE);
  const g = sampleCurve(s.curveGreen, LUT_SIZE);
  const b = sampleCurve(s.curveBlue, LUT_SIZE);
  const m = sampleCurve(s.curveRgb, LUT_SIZE);
  const out = new Float32Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    out[i * 4] = r[i];
    out[i * 4 + 1] = g[i];
    out[i * 4 + 2] = b[i];
    out[i * 4 + 3] = m[i];
  }
  return out;
}

/** Linear interpolation into the LUT (same as the shader's lutSample). */
export function lutSample(lut: Float32Array, channel: number, x: number): number {
  const fx = (x < 0 ? 0 : x > 1 ? 1 : x) * (LUT_SIZE - 1);
  const i0 = Math.floor(fx);
  const i1 = Math.min(i0 + 1, LUT_SIZE - 1);
  const t = fx - i0;
  const a = lut[i0 * 4 + channel];
  return a + (lut[i1 * 4 + channel] - a) * t;
}
