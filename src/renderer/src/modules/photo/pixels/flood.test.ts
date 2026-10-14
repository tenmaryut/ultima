import { describe, expect, it } from 'vitest';
import { antialiasMask, borderColor, clearByMask, floodMask, uniformBackgroundMask } from './flood';
import { healPatch, pushPullFill } from './heal';

function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4);
  return d;
}

const count = (m: Uint8Array) => m.reduce((a, v) => a + (v ? 1 : 0), 0);

describe('flood fill', () => {
  // left half white, right half black, plus a separate white island on the right
  const img = image(10, 10, (x, y) => (x < 5 || (x === 8 && y === 8) ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  it('contiguous fill stops at color boundaries', () => {
    const m = floodMask(img, 10, 10, 1, 1, 10, true);
    expect(count(m)).toBe(50);
    expect(m[8 * 10 + 8]).toBe(0);
  });
  it('non contiguous fill selects all matching pixels', () => {
    const m = floodMask(img, 10, 10, 1, 1, 10, false);
    expect(count(m)).toBe(51);
  });
  it('tolerance includes similar colors', () => {
    const grad = image(10, 1, (x) => [x * 10, x * 10, x * 10, 255]);
    expect(count(floodMask(grad, 10, 1, 0, 0, 25, true))).toBe(3);
    expect(count(floodMask(grad, 10, 1, 0, 0, 255, true))).toBe(10);
  });
  it('out of bounds returns an empty mask', () => {
    expect(count(floodMask(img, 10, 10, -1, 3, 10, true))).toBe(0);
  });
  it('anti-aliasing softens only the edge', () => {
    const m = floodMask(img, 10, 10, 1, 1, 10, true);
    const aa = antialiasMask(m, 10, 10);
    expect(aa[5 * 10 + 2]).toBe(255);
    expect(aa[5 * 10 + 5]).toBeGreaterThan(0);
    expect(aa[5 * 10 + 7]).toBe(0);
  });
});

describe('uniform background removal', () => {
  const img = image(12, 12, (x, y) => (x >= 4 && x < 8 && y >= 4 && y < 8 ? [200, 30, 30, 255] : [250, 250, 250, 255]));
  it('detects the border color', () => {
    expect(borderColor(img, 12, 12)).toEqual([250, 250, 250, 255]);
  });
  it('masks the background but not the subject', () => {
    const m = uniformBackgroundMask(img, 12, 12, 20);
    expect(count(m)).toBe(144 - 16);
    const copy = img.slice();
    clearByMask(copy, 12, 12, m);
    expect(copy[3]).toBe(0);
    expect(copy[(6 * 12 + 6) * 4 + 3]).toBe(255);
  });
});

describe('healing', () => {
  it('push-pull fills gaps smoothly between known values', () => {
    const v = new Float32Array([0, 0, 0, 100]);
    const w = new Float32Array([1, 0, 0, 1]);
    const out = pushPullFill(v, w, 4, 1, 1);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(100);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[2]).toBeLessThan(100);
  });
  it('removes a spot from a flat background', () => {
    const w = 40;
    const h = 40;
    const img = image(w, h, (x, y) => (Math.hypot(x - 20, y - 20) < 4 ? [20, 20, 20, 255] : [180, 170, 160, 255]));
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 20, y - 20) < 6) mask[y * w + x] = 255;
    const out = healPatch(img, w, h, mask);
    const c = (20 * w + 20) * 4;
    expect(Math.abs(out[c] - 180)).toBeLessThan(6);
    expect(Math.abs(out[c + 2] - 160)).toBeLessThan(6);
    // pixels outside the mask are untouched
    expect(out[0]).toBe(180);
  });
});
