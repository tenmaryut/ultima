import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  constrainCropMove,
  cropAfterStraighten,
  cropForAspect,
  cropInsideImage,
  fitCropToImage,
  flipCropRect,
  geometry,
  maxCenteredCrop,
  rotateCropRect,
  straightenFromLine,
} from './geometry';
import { defaultSettings, mergeSettings } from './params';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('geometry', () => {
  it('maps output to source 1:1 for default settings', () => {
    const g = geometry(defaultSettings(), 400, 300);
    expect(g.outW).toBe(400);
    const p = applyAffine(g.outToSrc, 12, 34);
    near(p.x, 12);
    near(p.y, 34);
  });
  it('rotates a quarter turn clockwise', () => {
    const s = mergeSettings(defaultSettings(), { rotate: 1 });
    const g = geometry(s, 400, 300);
    expect([g.outW, g.outH]).toEqual([300, 400]);
    // output top-left shows source bottom-left
    const tl = applyAffine(g.outToSrc, 0, 0);
    near(tl.x, 0);
    near(tl.y, 300);
    // output top-right shows source top-left
    const tr = applyAffine(g.outToSrc, 300, 0);
    near(tr.x, 0);
    near(tr.y, 0);
  });
  it('flips horizontally', () => {
    const g = geometry(mergeSettings(defaultSettings(), { flipH: true }), 400, 300);
    const p = applyAffine(g.outToSrc, 0, 10);
    near(p.x, 400);
    near(p.y, 10);
  });
  it('crops', () => {
    const g = geometry(mergeSettings(defaultSettings(), { cropX: 0.25, cropY: 0.5, cropW: 0.5, cropH: 0.5 }), 400, 300);
    expect([g.outW, g.outH]).toEqual([200, 150]);
    const p = applyAffine(g.outToSrc, 0, 0);
    near(p.x, 100);
    near(p.y, 150);
  });
  it('keeps the center fixed when straightening', () => {
    const g = geometry(mergeSettings(defaultSettings(), { straighten: 10 }), 400, 300);
    const c = applyAffine(g.outToSrc, 200, 150);
    near(c.x, 200);
    near(c.y, 150);
  });
});

describe('crop rectangles', () => {
  it('rotate/flip transforms are invertible', () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const back = rotateCropRect(rotateCropRect(r, 1), -1);
    near(back.x, r.x);
    near(back.y, r.y);
    near(back.w, r.w);
    near(back.h, r.h);
    expect(flipCropRect(flipCropRect(r, 'h'), 'h').x).toBeCloseTo(r.x, 9);
  });
  it('max centered crop fits inside the rotated image', () => {
    for (const angle of [0, 5, -12, 30, 45]) {
      const r = maxCenteredCrop(600, 400, angle, 1.5);
      expect(cropInsideImage(r, 600, 400, angle, 0.01)).toBe(true);
      near(r.w / r.h, 1.5, 1e-9);
    }
    const full = maxCenteredCrop(600, 400, 0, 1.5);
    near(full.w, 600, 1e-6);
  });
  it('fitCropToImage shrinks an invalid crop', () => {
    const r = fitCropToImage({ x: 0, y: 0, w: 600, h: 400 }, 600, 400, 8);
    expect(cropInsideImage(r, 600, 400, 8, 0.01)).toBe(true);
    expect(r.w).toBeLessThan(600);
  });
  it('constrainCropMove stops at the image edge', () => {
    const from = { x: 100, y: 100, w: 200, h: 100 };
    const r = constrainCropMove(from, { ...from, x: 900 }, 600, 400, 0);
    near(r.x + r.w, 600, 0.6);
  });
  it('aspect presets and straighten keep the crop valid', () => {
    const s = mergeSettings(defaultSettings(), {});
    const sq = cropForAspect(s, '1:1', 600, 400);
    near((sq.cropW * 600) / (sq.cropH * 400), 1, 1e-6);
    const st = { ...s, ...cropAfterStraighten(s, 6, 600, 400), straighten: 6 };
    expect(cropInsideImage({ x: st.cropX * 600, y: st.cropY * 400, w: st.cropW * 600, h: st.cropH * 400 }, 600, 400, 6, 0.05)).toBe(true);
    // back to 0 grows back to the full frame
    const back = cropAfterStraighten(st, 0, 600, 400);
    near(back.cropW, 1, 1e-3);
  });
  it('straightenFromLine levels a tilted horizon', () => {
    near(straightenFromLine(0, 0, 100, 10), -((Math.atan2(10, 100) * 180) / Math.PI), 1e-9);
    near(straightenFromLine(0, 0, 3, 100), (Math.atan2(3, 100) * 180) / Math.PI, 1e-9);
  });
});
