import { describe, expect, it } from 'vitest';
import {
  alphaToMask,
  combineMasks,
  contractMask,
  distanceField,
  ellipseMask,
  expandMask,
  featherMask,
  invertMask,
  maskBounds,
  outlineSegments,
  polygonMask,
  rectMask,
  reframeSelection,
  selectAll,
  selectionFromMask,
  translateMask,
  unionRects,
  intersectRects,
} from './selection';

const sum = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe('rect & bounds', () => {
  it('rasterizes an integer rectangle and finds its bounds', () => {
    const m = rectMask(10, 8, { x: 2, y: 1, w: 3, h: 4 });
    expect(sum(m)).toBe(12 * 255);
    expect(maskBounds(m, 10, 8)).toEqual({ x: 2, y: 1, w: 3, h: 4 });
  });
  it('clips rectangles to the document', () => {
    const m = rectMask(4, 4, { x: -2, y: -2, w: 4, h: 10 });
    expect(maskBounds(m, 4, 4)).toEqual({ x: 0, y: 0, w: 2, h: 4 });
  });
  it('returns null for empty masks', () => {
    expect(maskBounds(new Uint8Array(16), 4, 4)).toBeNull();
    expect(selectionFromMask(new Uint8Array(16), 4, 4)).toBeNull();
  });
  it('select all covers the document', () => {
    const s = selectAll(5, 3);
    expect(s.bounds).toEqual({ x: 0, y: 0, w: 5, h: 3 });
    expect(sum(s.mask)).toBe(15 * 255);
  });
  it('rect helpers', () => {
    expect(unionRects({ x: 0, y: 0, w: 2, h: 2 }, { x: 3, y: 1, w: 1, h: 4 })).toEqual({ x: 0, y: 0, w: 4, h: 5 });
    expect(intersectRects({ x: 0, y: 0, w: 2, h: 2 }, { x: 3, y: 1, w: 1, h: 4 })).toBeNull();
  });
});

describe('polygon & ellipse', () => {
  it('fills a polygon square exactly (axis aligned)', () => {
    const m = polygonMask(10, 10, [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 6 },
      { x: 2, y: 6 },
    ]);
    expect(sum(m)).toBe(16 * 255);
    expect(m[3 * 10 + 3]).toBe(255);
    expect(m[1 * 10 + 1]).toBe(0);
  });
  it('anti-aliases half covered pixels', () => {
    const m = polygonMask(10, 10, [
      { x: 2.5, y: 2 },
      { x: 6, y: 2 },
      { x: 6, y: 6 },
      { x: 2.5, y: 6 },
    ]);
    expect(m[3 * 10 + 2]).toBeGreaterThan(110);
    expect(m[3 * 10 + 2]).toBeLessThan(145);
  });
  it('ellipse area is close to pi*a*b', () => {
    const m = ellipseMask(100, 100, { x: 10, y: 20, w: 60, h: 40 });
    const area = sum(m) / 255;
    expect(Math.abs(area - Math.PI * 30 * 20) / (Math.PI * 30 * 20)).toBeLessThan(0.01);
    expect(m[40 * 100 + 40]).toBe(255);
    expect(m[21 * 100 + 11]).toBe(0);
  });
});

describe('combine / invert / translate', () => {
  const a = rectMask(10, 10, { x: 0, y: 0, w: 5, h: 10 });
  const b = rectMask(10, 10, { x: 3, y: 0, w: 5, h: 10 });
  it('adds, subtracts and intersects', () => {
    expect(sum(combineMasks(a, b, 'add')) / 255).toBe(80);
    expect(sum(combineMasks(a, b, 'subtract')) / 255).toBe(30);
    expect(sum(combineMasks(a, b, 'intersect')) / 255).toBe(20);
    expect(combineMasks(a, b, 'new')).toBe(b);
    expect(combineMasks(null, b, 'add')).toBe(b);
    expect(sum(combineMasks(null, b, 'intersect'))).toBe(0);
  });
  it('inverts', () => {
    expect(sum(invertMask(a)) / 255).toBe(50);
  });
  it('translates and drops pixels outside', () => {
    const t = translateMask(a, 10, 10, 7, 2);
    expect(maskBounds(t, 10, 10)).toEqual({ x: 7, y: 2, w: 3, h: 8 });
  });
});

describe('feather / expand / contract', () => {
  it('feather keeps the total roughly and softens edges', () => {
    const m = rectMask(40, 40, { x: 10, y: 10, w: 20, h: 20 });
    const f = featherMask(m, 40, 40, 4);
    expect(Math.abs(sum(f) - sum(m)) / sum(m)).toBeLessThan(0.05);
    expect(f[20 * 40 + 10]).toBeGreaterThan(60);
    expect(f[20 * 40 + 10]).toBeLessThan(200);
    expect(f[20 * 40 + 20]).toBe(255);
  });
  it('expands a single pixel into a disc', () => {
    const m = new Uint8Array(21 * 21);
    m[10 * 21 + 10] = 255;
    const e = expandMask(m, 21, 21, 5);
    expect(e[10 * 21 + 15]).toBe(255);
    expect(e[10 * 21 + 17]).toBe(0);
    expect(e[15 * 21 + 15]).toBe(0); // diagonal distance ~7.07
  });
  it('contracts a rectangle', () => {
    const m = rectMask(30, 30, { x: 5, y: 5, w: 20, h: 20 });
    const c = contractMask(m, 30, 30, 3);
    expect(maskBounds(c, 30, 30)).toEqual({ x: 8, y: 8, w: 14, h: 14 });
  });
  it('distance field is euclidean', () => {
    const f = new Uint8Array(25);
    f[0] = 1;
    const d = distanceField(f, 5, 5);
    expect(d[0]).toBe(0);
    expect(d[4 * 5 + 3]).toBeCloseTo(5, 5);
  });
});

describe('outline & helpers', () => {
  it('outlines a rectangle with 4 merged segments', () => {
    const m = rectMask(10, 10, { x: 2, y: 3, w: 4, h: 2 });
    const segs = outlineSegments(m, 10, 10);
    expect(segs.length).toBe(16);
    const list = [];
    for (let i = 0; i < segs.length; i += 4) list.push(Array.from(segs.slice(i, i + 4)));
    expect(list).toContainEqual([2, 3, 6, 3]);
    expect(list).toContainEqual([2, 5, 6, 5]);
    expect(list).toContainEqual([2, 3, 2, 5]);
    expect(list).toContainEqual([6, 3, 6, 5]);
  });
  it('builds a mask from layer alpha at an offset', () => {
    const rgba = new Uint8ClampedArray(2 * 2 * 4);
    rgba[3] = 255;
    rgba[15] = 128;
    const m = alphaToMask(rgba, 2, 2, 1, 1, 4, 4);
    expect(m[1 * 4 + 1]).toBe(255);
    expect(m[2 * 4 + 2]).toBe(128);
    expect(sum(m)).toBe(383);
  });
  it('reframes a selection for crops', () => {
    const s = selectionFromMask(rectMask(10, 10, { x: 4, y: 4, w: 2, h: 2 }), 10, 10)!;
    const r = reframeSelection(s, 3, 3, 5, 5)!;
    expect(r.bounds).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(reframeSelection(s, 8, 8, 2, 2)).toBeNull();
  });
});
