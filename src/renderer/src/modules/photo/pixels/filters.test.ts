import { describe, expect, it } from 'vitest';
import {
  addNoise,
  alphaToGray,
  blendBySelection,
  blurredCopy,
  emboss,
  findEdges,
  gaussianBlur,
  grain,
  grayToAlpha,
  median,
  motionBlur,
  oilPaint,
  pixelate,
  premultiplied,
  unpremultiply,
  unsharpMask,
  vignette,
} from './filters';
import { runPixelOp } from './ops';

function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4);
  return d;
}

describe('blurs', () => {
  it('gaussian blur keeps a solid image unchanged', () => {
    const d = solid(16, 16, [100, 150, 200, 255]);
    const out = gaussianBlur(d, 16, 16, { radius: 3 });
    expect(Array.from(out.slice(0, 4))).toEqual([100, 150, 200, 255]);
    expect(Array.from(out.slice(-4))).toEqual([100, 150, 200, 255]);
  });
  it('gaussian blur spreads a dot and conserves energy', () => {
    const d = solid(21, 21, [0, 0, 0, 255]);
    d[(10 * 21 + 10) * 4] = 255;
    const out = gaussianBlur(d, 21, 21, { radius: 2 });
    let total = 0;
    for (let i = 0; i < out.length; i += 4) total += out[i];
    expect(out[(10 * 21 + 10) * 4]).toBeLessThan(255);
    expect(out[(10 * 21 + 12) * 4]).toBeGreaterThan(0);
    expect(Math.abs(total - 255)).toBeLessThan(40);
  });
  it('does not darken transparent edges (premultiplied)', () => {
    const d = new Uint8ClampedArray(8 * 1 * 4);
    for (let x = 0; x < 4; x++) d.set([255, 255, 255, 255], x * 4);
    const out = blurredCopy(d, 8, 1, 1.5);
    // a semi transparent pixel near the edge stays white in color
    expect(out[4 * 4 + 3]).toBeGreaterThan(0);
    expect(out[4 * 4]).toBeGreaterThan(240);
  });
  it('motion blur smears horizontally only for angle 0', () => {
    const d = solid(9, 9, [0, 0, 0, 255]);
    d[(4 * 9 + 4) * 4] = 255;
    const out = motionBlur(d, 9, 9, { angle: 0, distance: 4 });
    expect(out[(4 * 9 + 6) * 4]).toBeGreaterThan(0);
    expect(out[(6 * 9 + 4) * 4]).toBe(0);
  });
  it('premultiply round trip', () => {
    const d = new Uint8ClampedArray([200, 100, 50, 128]);
    const p = premultiplied(d);
    unpremultiply(p);
    expect(Math.abs(p[0] - 200)).toBeLessThanOrEqual(2);
  });
});

describe('sharpen / noise / median', () => {
  it('unsharp mask increases edge contrast', () => {
    const d = new Uint8ClampedArray(10 * 1 * 4);
    for (let x = 0; x < 10; x++) d.set(x < 5 ? [80, 80, 80, 255] : [160, 160, 160, 255], x * 4);
    unsharpMask(d, 10, 1, { amount: 100, radius: 1, threshold: 0 });
    expect(d[4 * 4]).toBeLessThan(80);
    expect(d[5 * 4]).toBeGreaterThan(160);
  });
  it('noise is deterministic for a seed', () => {
    const a = addNoise(solid(4, 4, [128, 128, 128, 255]), 4, 4, { amount: 20, distribution: 'uniform', monochromatic: true, seed: 7 });
    const b = addNoise(solid(4, 4, [128, 128, 128, 255]), 4, 4, { amount: 20, distribution: 'uniform', monochromatic: true, seed: 7 });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[0]).toBe(a[1]);
  });
  it('median removes salt noise', () => {
    const d = solid(7, 7, [50, 50, 50, 255]);
    d[(3 * 7 + 3) * 4] = 255;
    const out = median(d, 7, 7, { radius: 1 });
    expect(out[(3 * 7 + 3) * 4]).toBe(50);
    expect(out[3]).toBe(255);
  });
});

describe('stylize', () => {
  it('pixelate averages blocks', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 0, 0, 0, 255, 100, 100, 100, 255]);
    pixelate(d, 2, 2, { size: 2 });
    expect(d[0]).toBe(50);
    expect(d[12]).toBe(50);
  });
  it('find edges is white on flat areas', () => {
    const out = findEdges(solid(5, 5, [30, 60, 90, 255]), 5, 5);
    expect(out[(2 * 5 + 2) * 4]).toBe(255);
  });
  it('emboss is mid gray on flat areas', () => {
    const out = emboss(solid(5, 5, [30, 60, 90, 255]), 5, 5, { angle: 135, height: 1, amount: 100 });
    expect(out[0]).toBe(128);
  });
  it('vignette darkens corners, not the center', () => {
    const d = solid(41, 41, [200, 200, 200, 255]);
    vignette(d, 41, 41, { amount: 80, size: 40, feather: 50 });
    expect(d[(20 * 41 + 20) * 4]).toBe(200);
    expect(d[0]).toBeLessThan(100);
  });
  it('grain changes pixels but keeps alpha', () => {
    const d = solid(8, 8, [128, 128, 128, 200]);
    grain(d, 8, 8, { amount: 50, size: 1, seed: 3 });
    expect(d[3]).toBe(200);
    expect(Array.from(d).some((v, i) => i % 4 !== 3 && v !== 128)).toBe(true);
  });
  it('oil paint keeps solid images', () => {
    const out = oilPaint(solid(6, 6, [10, 20, 30, 255]), 6, 6, { radius: 2, levels: 16 });
    expect(Array.from(out.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });
});

describe('selection blend & masks', () => {
  it('blends by a document-space selection with layer offset', () => {
    const orig = solid(2, 1, [0, 0, 0, 255]);
    const proc = solid(2, 1, [255, 255, 255, 255]);
    const sel = { width: 4, height: 1, mask: new Uint8Array([0, 255, 128, 0]) };
    blendBySelection(orig, proc, 2, 1, 1, 0, sel);
    expect(orig[0]).toBe(255);
    expect(orig[4]).toBe(128);
  });
  it('gray/alpha conversions round trip', () => {
    const d = new Uint8ClampedArray([255, 255, 255, 90]);
    alphaToGray(d);
    expect(Array.from(d)).toEqual([90, 90, 90, 255]);
    grayToAlpha(d);
    expect(Array.from(d)).toEqual([255, 255, 255, 90]);
  });
  it('dispatcher runs adjustments and filters', () => {
    const d = solid(2, 2, [10, 20, 30, 255]);
    runPixelOp('invert', d, 2, 2, {});
    expect(d[0]).toBe(245);
    expect(() => runPixelOp('nope' as never, d, 2, 2, {})).toThrow();
  });
});
