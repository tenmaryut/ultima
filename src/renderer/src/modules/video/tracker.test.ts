import { describe, expect, it } from 'vitest';
import { PointTracker, toGray, type Gray } from './tracker';

/** Repeatable noise, so every frame has the same "world". */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A textured world, smooth at 4 px (like a real picture), sampled with bilinear filtering. */
function world(w: number, h: number, seed = 7): (x: number, y: number) => number {
  const rnd = noise(seed);
  const gw = Math.ceil(w / 4) + 4;
  const gh = Math.ceil(h / 4) + 4;
  const grid = Float32Array.from({ length: gw * gh }, () => 40 + 120 * rnd());
  return (x, y) => {
    const fx = Math.min(Math.max(x / 4, 0), gw - 1.001);
    const fy = Math.min(Math.max(y / 4, 0), gh - 1.001);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const ax = fx - ix;
    const ay = fy - iy;
    const g = (i: number, j: number) => grid[j * gw + i];
    return (1 - ay) * ((1 - ax) * g(ix, iy) + ax * g(ix + 1, iy)) + ay * ((1 - ax) * g(ix, iy + 1) + ax * g(ix + 1, iy + 1));
  };
}

/** A bright ring with a dark centre (an "enemy"), radius 9 px, at a sub-pixel position. */
const target = (dx: number, dy: number) => {
  const d = Math.hypot(dx, dy);
  if (d > 10) return null;
  return d < 4 ? 20 : d < 8 ? 240 : 240 - (d - 8) * 110;
};

function frame(w: number, h: number, bg: (x: number, y: number) => number, cam: { x: number; y: number }, at: { x: number; y: number } | null): Gray {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at ? target(x - at.x, y - at.y) : null;
      data[y * w + x] = t ?? bg(x + cam.x, y + cam.y);
    }
  }
  return { w, h, data };
}

describe('point tracker', () => {
  it('follows a target over a moving background, also fast moves, to a fraction of a pixel', () => {
    const W = 240;
    const H = 160;
    const bg = world(W + 200, H + 200);
    const path = Array.from({ length: 40 }, (_, i) => ({
      // a slow walk, then a quick strafe (12 px a frame)
      x: i < 20 ? 60 + i * 1.3 : 86 + (i - 20) * 6,
      y: 70 + Math.sin(i / 5) * 12,
    }));
    const cam = (i: number) => ({ x: 50 + i * 2.5, y: 40 - i * 0.7 });
    const tracker = new PointTracker(frame(W, H, bg, cam(0), path[0]), path[0].x, path[0].y, { radius: 12 });
    expect(tracker.ok).toBe(true);
    let worst = 0;
    for (let i = 1; i < path.length; i++) {
      const step = tracker.next(frame(W, H, bg, cam(i), path[i]));
      expect(step.lost).toBe(false);
      worst = Math.max(worst, Math.hypot(step.x - path[i].x, step.y - path[i].y));
    }
    expect(worst).toBeLessThan(0.6);
  });

  it('does not lose a small target in a big box over a panning background', () => {
    const W = 260;
    const H = 180;
    const bg = world(W + 300, H + 100, 11);
    const at = (i: number) => ({ x: 60 + i * 4, y: 90 + Math.sin(i / 6) * 20 });
    const cam = (i: number) => ({ x: i * 3, y: i * 0.5 });
    // the box is three times the size of the target
    const tracker = new PointTracker(frame(W, H, bg, cam(0), at(0)), 60, 90, { radius: 30 });
    let lost = 0;
    let worst = 0;
    for (let i = 1; i < 30; i++) {
      const step = tracker.next(frame(W, H, bg, cam(i), at(i)));
      if (step.lost) lost++;
      worst = Math.max(worst, Math.hypot(step.x - at(i).x, step.y - at(i).y));
    }
    expect(lost).toBe(0);
    expect(worst).toBeLessThan(1.5);
  });

  it('keeps a guess while the target is covered, then finds it again', () => {
    const W = 200;
    const H = 140;
    const bg = world(W, H, 3);
    const at = (i: number) => ({ x: 50 + i * 3, y: 60 + i });
    const tracker = new PointTracker(frame(W, H, bg, { x: 0, y: 0 }, at(0)), 50, 60, { radius: 12 });
    for (let i = 1; i <= 5; i++) tracker.next(frame(W, H, bg, { x: 0, y: 0 }, at(i)));
    // covered for three frames
    const hidden = [6, 7, 8].map(() => tracker.next(frame(W, H, bg, { x: 0, y: 0 }, null)));
    expect(hidden.every((s) => s.lost)).toBe(true);
    let back = tracker.next(frame(W, H, bg, { x: 0, y: 0 }, at(9)));
    if (back.lost) back = tracker.next(frame(W, H, bg, { x: 0, y: 0 }, at(10)));
    const want = back.lost ? at(10) : at(back.x > at(9).x + 1.5 ? 10 : 9);
    expect(back.lost).toBe(false);
    expect(Math.hypot(back.x - want.x, back.y - want.y)).toBeLessThan(1);
  });

  it('refuses a flat patch and reads RGBA as luma', () => {
    const flat = { w: 64, h: 64, data: new Float32Array(64 * 64).fill(128) };
    expect(new PointTracker(flat, 32, 32, { radius: 8 }).ok).toBe(false);
    const g = toGray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255], 2, 2);
    expect([...g.data].map((v) => Math.round(v))).toEqual([76, 150, 29, 255]);
  });
});
