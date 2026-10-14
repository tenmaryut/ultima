import { describe, expect, it } from 'vitest';
import {
  centerSubpaths,
  distanceToPolylines,
  ellipsePath,
  flatten,
  pathBounds,
  pointInPolylines,
  polylineLength,
  rectPath,
  shapeSubpaths,
  starPath,
  tracePath,
  trimPolylines,
} from './geometry';
import { apply, decompose, invert, layerMatrix, multiply, rotation, translate } from './matrix';
import { arcToCubics, parsePathData, parseTransformAttr, toPathData, transformSubpaths } from './svgpath';

describe('svg path parser', () => {
  it('parses absolute and relative lines', () => {
    const sp = parsePathData('M10 10 L20 10 l0 10 H5 v-5 z');
    expect(sp).toHaveLength(1);
    expect(sp[0].closed).toBe(true);
    expect(sp[0].nodes.map((n) => [n.x, n.y])).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
      [5, 20],
      [5, 15],
    ]);
  });

  it('treats extra pairs after M as lineto and handles packed numbers', () => {
    const sp = parsePathData('M0,0 10,0 10-10.5.5.5');
    expect(sp[0].nodes.map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, -10.5],
      [0.5, 0.5],
    ]);
    expect(() => parsePathData('M0 0 L10')).toThrow();
  });

  it('converts cubic, smooth and quadratic curves to handles', () => {
    const sp = parsePathData('M0 0 C10 0 20 10 20 20 S30 40 40 40 Q50 40 50 50 T60 60');
    const n = sp[0].nodes;
    expect(n).toHaveLength(5);
    expect([n[0].outX, n[0].outY]).toEqual([10, 0]);
    expect([n[1].inX, n[1].inY]).toEqual([0, -10]);
    // S reflects the previous control point: (2*20-20, 2*20-10) = (20, 30)
    expect([n[1].outX, n[1].outY]).toEqual([0, 10]);
    // quadratic Q50 40 → cubic control 1 = p0 + 2/3 (q - p0)
    expect(n[2].outX).toBeCloseTo((2 / 3) * 10);
    expect(n[2].outY).toBeCloseTo(0);
  });

  it('parses arcs including packed flags', () => {
    const sp = parsePathData('M0 0 a10 10 0 011 1');
    const last = sp[0].nodes[sp[0].nodes.length - 1];
    expect(last.x).toBeCloseTo(1);
    expect(last.y).toBeCloseTo(1);
    const circle = parsePathData('M-50 0 A50 50 0 1 1 50 0 A50 50 0 1 1 -50 0 Z');
    const len = flatten(circle, 0.05)[0].length;
    expect(len).toBeCloseTo(2 * Math.PI * 50, 0);
  });

  it('arcToCubics ends exactly on the end point', () => {
    const segs = arcToCubics(0, 0, 30, 20, 30, 1, 0, 40, 10);
    const end = segs[segs.length - 1];
    expect(end[4]).toBe(40);
    expect(end[5]).toBe(10);
  });

  it('merges a closing node that repeats the first point', () => {
    const sp = parsePathData('M0 0 L10 0 L10 10 L0 0 Z');
    expect(sp[0].nodes).toHaveLength(3);
  });

  it('round trips through toPathData', () => {
    const d = 'M0 0 C10 0 20 10 20 20 L0 20 Z M30 30 L40 40';
    const a = parsePathData(d);
    const b = parsePathData(toPathData(a));
    expect(b).toEqual(a);
  });

  it('rejects garbage', () => {
    expect(() => parsePathData('hello')).toThrow();
    expect(() => parsePathData('10 10')).toThrow();
  });

  it('parses transform attributes', () => {
    const m = parseTransformAttr('translate(10 20) scale(2)');
    expect(apply(m, 1, 1)).toEqual([12, 22]);
    const r = parseTransformAttr('rotate(90 10 10)');
    const p = apply(r, 20, 10);
    expect(p[0]).toBeCloseTo(10);
    expect(p[1]).toBeCloseTo(20);
    const moved = transformSubpaths(parsePathData('M0 0 L1 0'), translate(5, 5));
    expect(moved[0].nodes[1]).toMatchObject({ x: 6, y: 5 });
  });
});

describe('shape geometry', () => {
  it('builds closed primitives centered on the origin', () => {
    const r = rectPath(100, 50, 0);
    expect(pathBounds([r])).toEqual({ x: -50, y: -25, w: 100, h: 50 });
    const e = ellipsePath(100, 100);
    const len = flatten([e], 0.05)[0].length;
    expect(len).toBeCloseTo(Math.PI * 100, 0);
    const s = starPath(5, 100, 100, 50);
    expect(s.nodes).toHaveLength(10);
    expect(shapeSubpaths({ kind: 'line', width: 80, height: 0, radius: 0, points: 0, innerRadius: 0 })[0].closed).toBe(false);
  });

  it('rounded rectangles clamp the radius', () => {
    const r = rectPath(100, 40, 999);
    const b = pathBounds([r]);
    expect(b.w).toBeCloseTo(100, 0);
    expect(b.h).toBeCloseTo(40, 0);
    // perimeter with full radius 20: 2*(60) + 2π·20
    expect(flatten([r], 0.05)[0].length).toBeCloseTo(120 + 2 * Math.PI * 20, 0);
  });

  it('trims paths by percentage', () => {
    const polys = flatten(parsePathData('M0 0 L100 0'));
    const half = trimPolylines(polys, 0, 50);
    expect(polylineLength(half[0].points)).toBeCloseTo(50);
    const mid = trimPolylines(polys, 25, 75);
    expect(mid[0].points.slice(0, 2)).toEqual([25, 0]);
    expect(polylineLength(mid[0].points)).toBeCloseTo(50);
    expect(trimPolylines(polys, 50, 50)).toEqual([]);
    expect(trimPolylines(polys, 0, 100)[0].points).toEqual(polys[0].points);
    // reversed start/end are swapped
    expect(polylineLength(trimPolylines(polys, 80, 20)[0].points)).toBeCloseTo(60);
  });

  it('trims closed shapes into open polylines', () => {
    const polys = flatten([rectPath(100, 100, 0)]);
    const quarter = trimPolylines(polys, 0, 25);
    expect(quarter[0].closed).toBe(false);
    expect(polylineLength(quarter[0].points)).toBeCloseTo(100);
  });

  it('hit tests', () => {
    const polys = flatten([rectPath(100, 100, 0)]);
    expect(pointInPolylines(polys, 0, 0)).toBe(true);
    expect(pointInPolylines(polys, 60, 0)).toBe(false);
    expect(distanceToPolylines(polys, 60, 0)).toBeCloseTo(10);
  });

  it('centers sub-paths', () => {
    const { subpaths, cx, cy } = centerSubpaths(parsePathData('M100 100 L200 100 L200 150 Z'));
    expect([cx, cy]).toEqual([150, 125]);
    expect(pathBounds(subpaths)).toEqual({ x: -50, y: -25, w: 100, h: 50 });
  });

  it('traces into any path sink', () => {
    const calls: string[] = [];
    tracePath(
      {
        moveTo: () => calls.push('M'),
        lineTo: () => calls.push('L'),
        bezierCurveTo: () => calls.push('C'),
        closePath: () => calls.push('Z'),
      },
      [ellipsePath(10, 10)],
    );
    expect(calls).toEqual(['M', 'C', 'C', 'C', 'C', 'Z']);
  });
});

describe('matrix', () => {
  it('layer matrix maps the anchor point onto the position', () => {
    const m = layerMatrix([300, 200], [10, 20], [200, 50], 30);
    const p = apply(m, 10, 20);
    expect(p[0]).toBeCloseTo(300);
    expect(p[1]).toBeCloseTo(200);
  });

  it('inverts and decomposes', () => {
    const m = multiply(translate(10, 5), rotation(45));
    const back = apply(invert(m), ...apply(m, 3, 4));
    expect(back[0]).toBeCloseTo(3);
    expect(back[1]).toBeCloseTo(4);
    const d = decompose(layerMatrix([5, 6], [0, 0], [150, 80], -20));
    expect(d.rotation).toBeCloseTo(-20);
    expect(d.scaleX).toBeCloseTo(150);
    expect(d.scaleY).toBeCloseTo(80);
    expect([d.x, d.y]).toEqual([5, 6]);
  });
});
