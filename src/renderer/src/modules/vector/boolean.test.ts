import { describe, expect, it } from 'vitest';
import { booleanOp, multiPolygonArea, unionAll, type MultiPolygon, type Ring } from './boolean';

const square = (x: number, y: number, s: number): Ring => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

const circle = (cx: number, cy: number, r: number, n = 64): Ring =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });

const mp = (...rings: Ring[]): MultiPolygon => rings.map((r) => [r]);

describe('booleanOp', () => {
  const a = mp(square(0, 0, 10));
  const b = mp(square(5, 5, 10));

  it('unites overlapping squares', () => {
    const r = booleanOp(a, b, 'union');
    expect(r.length).toBe(1);
    expect(multiPolygonArea(r)).toBeCloseTo(175, 6);
  });

  it('intersects overlapping squares', () => {
    const r = booleanOp(a, b, 'intersection');
    expect(multiPolygonArea(r)).toBeCloseTo(25, 6);
  });

  it('subtracts the front square', () => {
    const r = booleanOp(a, b, 'difference');
    expect(multiPolygonArea(r)).toBeCloseTo(75, 6);
  });

  it('excludes the overlap', () => {
    const r = booleanOp(a, b, 'xor');
    expect(multiPolygonArea(r)).toBeCloseTo(150, 6);
  });

  it('merges squares that share an edge into one outline', () => {
    const r = booleanOp(mp(square(0, 0, 10)), mp(square(10, 0, 10)), 'union');
    expect(r.length).toBe(1);
    expect(multiPolygonArea(r)).toBeCloseTo(200, 6);
  });

  it('handles identical polygons', () => {
    expect(multiPolygonArea(booleanOp(a, a, 'union'))).toBeCloseTo(100, 6);
    expect(multiPolygonArea(booleanOp(a, a, 'intersection'))).toBeCloseTo(100, 6);
    expect(multiPolygonArea(booleanOp(a, a, 'difference'))).toBeCloseTo(0, 6);
  });

  it('creates a hole when subtracting an inner shape', () => {
    const r = booleanOp(mp(square(0, 0, 30)), mp(square(10, 10, 10)), 'difference');
    expect(r.length).toBe(1);
    expect(r[0].length).toBe(2); // outer + hole
    expect(multiPolygonArea(r)).toBeCloseTo(800, 6);
  });

  it('returns trivial results for disjoint inputs', () => {
    const far = mp(square(100, 100, 5));
    expect(booleanOp(a, far, 'intersection')).toEqual([]);
    expect(multiPolygonArea(booleanOp(a, far, 'union'))).toBeCloseTo(125, 6);
    expect(multiPolygonArea(booleanOp(a, far, 'difference'))).toBeCloseTo(100, 6);
  });

  it('works with curved (flattened) shapes', () => {
    const c1 = mp(circle(0, 0, 10, 128));
    const c2 = mp(circle(10, 0, 10, 128));
    const area1 = multiPolygonArea(c1);
    const inter = multiPolygonArea(booleanOp(c1, c2, 'intersection'));
    // lens area of two r=10 circles at distance 10: 2r²acos(d/2r) - d/2·sqrt(4r²-d²)
    const lens = 2 * 100 * Math.acos(0.5) - 5 * Math.sqrt(400 - 100);
    expect(inter).toBeCloseTo(lens, 0);
    expect(multiPolygonArea(booleanOp(c1, c2, 'union'))).toBeCloseTo(area1 * 2 - inter, 1);
  });

  it('touching at a single vertex keeps both shapes', () => {
    const r = booleanOp(mp(square(0, 0, 10)), mp(square(10, 10, 10)), 'union');
    expect(multiPolygonArea(r)).toBeCloseTo(200, 6);
  });

  it('unions many shapes', () => {
    const parts = Array.from({ length: 9 }, (_, i) => mp(square(i * 5, 0, 10)));
    const r = unionAll(parts);
    expect(r.length).toBe(1);
    expect(multiPolygonArea(r)).toBeCloseTo(50 * 10, 6);
  });

  it('handles a self-overlapping operand with the even-odd rule', () => {
    // two rings in the subject overlapping each other → even-odd leaves the overlap empty
    const subject: MultiPolygon = [[square(0, 0, 10)], [square(5, 0, 10)]];
    const clip = mp(square(-5, -5, 30));
    const r = booleanOp(subject, clip, 'intersection');
    expect(multiPolygonArea(r)).toBeCloseTo(100, 6);
  });

  it('subtracts with a shared edge', () => {
    const r = booleanOp(mp(square(0, 0, 10)), mp([[5, 0], [10, 0], [10, 10], [5, 10]]), 'difference');
    expect(multiPolygonArea(r)).toBeCloseTo(50, 6);
  });
});
