import { describe, expect, it } from 'vitest';
import { flowPair, flowsAt, interpolateAt, interpolateFrames, opticalFlow } from './flow';
import type { Gray } from './tracker';

/** A smooth random texture (like a real picture), drawn moved by (dx, dy). */
function texture(seed: number) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const waves = Array.from({ length: 24 }, () => ({ fx: 0.02 + rnd() * 0.12, fy: 0.02 + rnd() * 0.12, p: rnd() * 6.28, a: 6 + rnd() * 10 }));
  return (x: number, y: number) => 128 + waves.reduce((acc, q) => acc + q.a * Math.sin(q.fx * x + q.fy * y + q.p) * Math.cos(q.fy * x - q.fx * y), 0);
}
const gray = (w: number, h: number, f: (x: number, y: number) => number): Gray => {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { w, h, data };
};
const rgba = (g: Gray) => {
  const d = new Uint8ClampedArray(g.w * g.h * 4);
  g.data.forEach((v, i) => d.set([v, v * 0.8, 255 - v, 255], i * 4));
  return d;
};
/** Median of the flow inside the picture (away from the edges). */
function medianFlow(f: { w: number; h: number; u: Float32Array; v: Float32Array }, margin: number) {
  const us: number[] = [];
  const vs: number[] = [];
  for (let y = margin; y < f.h - margin; y++) for (let x = margin; x < f.w - margin; x++) {
    us.push(f.u[y * f.w + x]);
    vs.push(f.v[y * f.w + x]);
  }
  const mid = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return { u: mid(us), v: mid(vs) };
}

describe('optical flow', () => {
  it('measures a sub-pixel move', () => {
    const tex = texture(5);
    const a = gray(160, 120, tex);
    const b = gray(160, 120, (x, y) => tex(x - 3.4, y + 2.2));
    const m = medianFlow(opticalFlow(a, b), 16);
    expect(m.u).toBeCloseTo(3.4, 1);
    expect(m.v).toBeCloseTo(-2.2, 1);
  });

  it('measures a big move through the pyramid', () => {
    const tex = texture(9);
    const a = gray(256, 160, tex);
    const b = gray(256, 160, (x, y) => tex(x - 19, y - 7));
    const m = medianFlow(opticalFlow(a, b), 40);
    expect(Math.abs(m.u - 19)).toBeLessThan(0.3);
    expect(Math.abs(m.v - 7)).toBeLessThan(0.3);
  });

  it('follows a small fast object over a slower background', () => {
    const tex = texture(13);
    const W = 320;
    const H = 180;
    /** A 16 px bright square with a dark middle at (x0, 80), over the background moved by `bg`. */
    const scene = (x0: number, bg: number) => (x: number, y: number) => {
      const dx = x - x0;
      const dy = y - 80;
      if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) return Math.abs(dx) <= 4 && Math.abs(dy) <= 4 ? 30 : 235;
      return tex(x - bg, y);
    };
    const a = gray(W, H, scene(120, 0));
    const b = gray(W, H, scene(134, 2));
    const f = opticalFlow(a, b);
    const at = (x: number, y: number) => ({ u: f.u[y * W + x], v: f.v[y * W + x] });
    // the object moved 14 px, the background 2 px
    expect(Math.abs(at(120, 80).u - 14)).toBeLessThan(1);
    expect(Math.abs(at(60, 140).u - 2)).toBeLessThan(0.5);
  });

  it('keeps the edges of a fast object clean where it covers and uncovers the background', () => {
    const tex = texture(13);
    const W = 320;
    const H = 180;
    /** A 33 px bright square with a dark middle, at (x0, 80), over the background moved by `bg`. */
    const scene = (x0: number, bg: number) => (x: number, y: number) => {
      const dx = x - x0;
      const dy = y - 80;
      if (Math.abs(dx) <= 16 && Math.abs(dy) <= 16) return Math.abs(dx) <= 8 && Math.abs(dy) <= 8 ? 30 : 235;
      return tex(x - bg, y);
    };
    const a = gray(W, H, scene(120, 0));
    const b = gray(W, H, scene(144, 2));
    const truth = gray(W, H, scene(132, 1));
    const ab = opticalFlow(a, b);
    const ba = opticalFlow(b, a);
    const mid = interpolateFrames(rgba(a), rgba(b), W, H, ab, ba, 0.5);
    // the plain approximation without projection, for comparison
    const plain = interpolateAt(rgba(a), rgba(b), W, H, {
      w: W,
      h: H,
      u0: ab.u.map((v, i) => -0.25 * v + 0.25 * ba.u[i]),
      v0: ab.v.map((v, i) => -0.25 * v + 0.25 * ba.v[i]),
      u1: ab.u.map((v, i) => 0.25 * v - 0.25 * ba.u[i]),
      v1: ab.v.map((v, i) => 0.25 * v - 0.25 * ba.v[i]),
      vis0: new Float32Array(W * H).fill(1),
      vis1: new Float32Array(W * H).fill(1),
    }, 0.5);
    // around the object (where it was, is and will be), how far off is the new frame?
    const err = (img: Uint8ClampedArray) => {
      let sum = 0;
      let n = 0;
      for (let y = 58; y <= 102; y++) for (let x = 96; x <= 168; x++) {
        sum += Math.abs(img[(y * W + x) * 4] - truth.data[y * W + x]);
        n++;
      }
      return sum / n;
    };
    // a fast object over a moving background: what it covers and uncovers is hard, but clearly better than without
    // projecting the motion (about 15 against 23 grey levels; a cross-fade is off by about 45)
    expect(err(mid)).toBeLessThan(18);
    expect(err(mid)).toBeLessThan(0.8 * err(plain));
  });

  it('makes the frame in between by moving pixels, not by cross-fading', () => {
    const tex = texture(3);
    const W = 160;
    const H = 120;
    const a = gray(W, H, tex);
    const b = gray(W, H, (x, y) => tex(x - 8, y - 4));
    const truth = gray(W, H, (x, y) => tex(x - 4, y - 2));
    const ab = opticalFlow(a, b);
    const ba = opticalFlow(b, a);
    const mid = interpolateFrames(rgba(a), rgba(b), W, H, ab, ba, 0.5);
    const fade = interpolateFrames(rgba(a), rgba(b), W, H, { ...ab, u: new Float32Array(ab.u.length), v: new Float32Array(ab.v.length) }, { ...ba, u: new Float32Array(ba.u.length), v: new Float32Array(ba.v.length) }, 0.5);
    const err = (img: Uint8ClampedArray) => {
      let sum = 0;
      let n = 0;
      for (let y = 12; y < H - 12; y++) for (let x = 12; x < W - 12; x++) {
        sum += Math.abs(img[(y * W + x) * 4] - truth.data[y * W + x]);
        n++;
      }
      return sum / n;
    };
    expect(err(mid)).toBeLessThan(1.5);
    expect(err(fade)).toBeGreaterThan(4 * err(mid));
  });

  it('works on a big frame in reasonable time', () => {
    const tex = texture(1);
    const a = gray(480, 270, tex);
    const b = gray(480, 270, (x, y) => tex(x - 5, y - 1));
    const t0 = performance.now();
    const ab = opticalFlow(a, b);
    const ba = opticalFlow(b, a);
    const t1 = performance.now();
    const big = new Uint8ClampedArray(1920 * 1080 * 4).fill(128);
    const pair = flowPair(ab, ba);
    const t2 = performance.now();
    for (const t of [0.25, 0.5, 0.75]) interpolateAt(big, big, 1920, 1080, flowsAt(pair, t), t);
    const t3 = performance.now();
    // not a hard limit: shows the cost per source pair and per new frame
    process.stderr.write(`flow 480×270 both ways: ${(t1 - t0).toFixed(0)} ms; pair: ${(t2 - t1).toFixed(0)} ms; per new 1920×1080 frame: ${((t3 - t2) / 3).toFixed(0)} ms\n`);
    expect(t3 - t0).toBeLessThan(20000);
  });
});
