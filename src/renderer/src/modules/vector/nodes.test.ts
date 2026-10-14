import { describe, expect, it } from 'vitest';
import { cubicAt } from './bezier';
import { deleteNodes, insertNode, moveNodes, nearestSegment, setHandle, toggleSmooth } from './nodes';
import { parsePathData, segmentCubic } from './path';

describe('node editing', () => {
  const curve = parsePathData('M0 0 C0 50 100 50 100 0');

  it('inserts a node without changing the shape', () => {
    const before = segmentCubic(curve.subpaths[0].nodes[0], curve.subpaths[0].nodes[1]);
    const { geom, index } = insertNode(curve, 0, 0, 0.5);
    expect(index).toBe(1);
    const nodes = geom.subpaths[0].nodes;
    expect(nodes).toHaveLength(3);
    const mid = cubicAt(before, 0.5);
    expect(nodes[1].x).toBeCloseTo(mid.x, 9);
    expect(nodes[1].y).toBeCloseTo(mid.y, 9);
    const left = segmentCubic(nodes[0], nodes[1]);
    const p = cubicAt(left, 0.5);
    const q = cubicAt(before, 0.25);
    expect(p.x).toBeCloseTo(q.x, 9);
    expect(p.y).toBeCloseTo(q.y, 9);
  });

  it('inserts on the closing segment of a closed path', () => {
    const sq = parsePathData('M0 0H10V10H0Z');
    const { geom, index } = insertNode(sq, 0, 3, 0.5);
    expect(index).toBe(4);
    expect(geom.subpaths[0].nodes[4]).toEqual({ x: 0, y: 5 });
  });

  it('finds the nearest segment', () => {
    const sq = parsePathData('M0 0H10V10H0Z');
    const r = nearestSegment(sq, { x: 11, y: 5 });
    expect(r?.seg).toBe(1);
    expect(r?.dist).toBeCloseTo(1, 6);
  });

  it('moves nodes with their handles', () => {
    const moved = moveNodes(curve, [{ sub: 0, idx: 1 }], 10, 5);
    const n = moved.subpaths[0].nodes[1];
    expect(n).toMatchObject({ x: 110, y: 5, in: { x: 110, y: 55 } });
  });

  it('keeps smooth handles collinear', () => {
    const s = parsePathData('M0 0 C0 10 10 10 20 10 C30 10 40 10 40 0');
    const n = s.subpaths[0].nodes[1];
    expect(n.smooth).toBe(true);
    const edited = setHandle(s, { sub: 0, idx: 1 }, 'out', { x: 20, y: 20 });
    const e = edited.subpaths[0].nodes[1];
    expect(e.in?.x).toBeCloseTo(20, 9);
    expect(e.in?.y).toBeCloseTo(0, 9);
    const broken = setHandle(s, { sub: 0, idx: 1 }, 'out', { x: 20, y: 20 }, true);
    expect(broken.subpaths[0].nodes[1].in).toEqual({ x: 10, y: 10 });
  });

  it('converts corner ↔ smooth and deletes nodes', () => {
    const sq = parsePathData('M0 0H10V10H0Z');
    const smooth = toggleSmooth(sq, { sub: 0, idx: 1 });
    expect(smooth.subpaths[0].nodes[1].in).toBeDefined();
    expect(smooth.subpaths[0].nodes[1].smooth).toBe(true);
    const corner = toggleSmooth(smooth, { sub: 0, idx: 1 });
    expect(corner.subpaths[0].nodes[1]).toEqual({ x: 10, y: 0 });
    const del = deleteNodes(sq, [{ sub: 0, idx: 1 }]);
    expect(del.subpaths[0].nodes).toHaveLength(3);
    const gone = deleteNodes(sq, [{ sub: 0, idx: 0 }, { sub: 0, idx: 1 }, { sub: 0, idx: 2 }]);
    expect(gone.subpaths).toHaveLength(0);
  });
});
