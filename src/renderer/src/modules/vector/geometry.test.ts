import { describe, expect, it } from 'vitest';
import { cubicAt, cubicBounds, cubicLength, flattenCubic, nearestOnCubic, splitCubic, arcToCubics, type Cubic } from './bezier';
import { fitCurve, polylineToSubpath, simplifyRDP } from './fit';
import {
  boundsUnder,
  hitTest,
  localBounds,
  normalizeObject,
  objectsInRect,
  pointInPolylines,
  transformObject,
  worldMatrix,
} from './geometry';
import { IDENTITY, apply, compose, decompose, invert, multiply, parseTransform, rotate, rotateAbout, scale, translate } from './matrix';
import { createEllipse, createGroup, createLine, createPath, createRect, createText, defaultStroke, NONE, solid } from './model';
import { flattenGeom, geomBounds, parsePathData, serializePath } from './path';
import { buildSnapTargets, snapPoint, snapRect } from './snap';

describe('matrix', () => {
  it('multiplies and inverts', () => {
    const m = multiply(translate(10, 5), multiply(rotate(30), scale(2, 3)));
    const p = apply(m, { x: 3, y: -4 });
    const back = apply(invert(m), p);
    expect(back.x).toBeCloseTo(3, 9);
    expect(back.y).toBeCloseTo(-4, 9);
  });

  it('decomposes and recomposes (with flip and skew)', () => {
    for (const m of [
      multiply(translate(4, 7), multiply(rotate(35), scale(2, 0.5))),
      multiply(rotate(-120), scale(-1, 1)),
      [1, 0, 0.5, 1, 3, 4] as [number, number, number, number, number, number],
    ]) {
      const d = decompose(m);
      const r = compose(d);
      for (let i = 0; i < 6; i++) expect(r[i]).toBeCloseTo(m[i], 9);
    }
  });

  it('parses SVG transform lists', () => {
    const m = parseTransform('translate(10,20) rotate(90) scale(2)');
    const p = apply(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(22, 9);
    const r = parseTransform('rotate(180 5 5)');
    const q = apply(r, { x: 0, y: 0 });
    expect(q.x).toBeCloseTo(10, 9);
    expect(q.y).toBeCloseTo(10, 9);
  });
});

describe('bezier', () => {
  const c: Cubic = [0, 0, 0, 100, 100, 100, 100, 0];

  it('evaluates end points and midpoint', () => {
    expect(cubicAt(c, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicAt(c, 1)).toEqual({ x: 100, y: 0 });
    expect(cubicAt(c, 0.5)).toEqual({ x: 50, y: 75 });
  });

  it('splits continuously', () => {
    const [a, b] = splitCubic(c, 0.3);
    const p = cubicAt(c, 0.3);
    expect(a[6]).toBeCloseTo(p.x, 9);
    expect(b[1]).toBeCloseTo(p.y, 9);
    const q = cubicAt(b, 0.5);
    const r = cubicAt(c, 0.3 + 0.7 * 0.5);
    expect(q.x).toBeCloseTo(r.x, 9);
    expect(q.y).toBeCloseTo(r.y, 9);
  });

  it('computes tight bounds', () => {
    const b = cubicBounds(c);
    expect(b.x).toBe(0);
    expect(b.width).toBe(100);
    expect(b.height).toBeCloseTo(75, 9);
  });

  it('flattens within tolerance', () => {
    const pts: number[] = [0, 0];
    flattenCubic(c, 0.1, pts);
    for (let t = 0; t <= 1; t += 0.01) {
      const p = cubicAt(c, t);
      let best = Infinity;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const [x0, y0, x1, y1] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const l2 = dx * dx + dy * dy;
        const u = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / l2));
        best = Math.min(best, Math.hypot(p.x - x0 - u * dx, p.y - y0 - u * dy));
      }
      expect(best).toBeLessThan(0.15);
    }
  });

  it('finds the nearest point', () => {
    const r = nearestOnCubic(c, { x: 50, y: 90 });
    expect(r.t).toBeCloseTo(0.5, 3);
    expect(r.dist).toBeCloseTo(15, 3);
  });

  it('converts a half-circle arc', () => {
    const cubics = arcToCubics(0, 0, 50, 50, 0, false, true, 100, 0);
    expect(cubics.length).toBe(2);
    const mid = cubicAt(cubics[0], 1);
    expect(Math.hypot(mid.x - 50, mid.y)).toBeCloseTo(50, 3);
    const len = cubics.reduce((s, k) => s + cubicLength(k), 0);
    expect(len).toBeCloseTo(Math.PI * 50, 0);
  });
});

describe('path data', () => {
  it('parses absolute and relative commands with implicit repeats', () => {
    const g = parsePathData('M10 10 l10 0 0 10 h-10 z m30 0 L50 10 50 20z');
    expect(g.subpaths.length).toBe(2);
    expect(g.subpaths[0].nodes.map((n) => [n.x, n.y])).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ]);
    expect(g.subpaths[0].closed).toBe(true);
    expect(g.subpaths[1].nodes[0]).toMatchObject({ x: 40, y: 10 });
  });

  it('parses compact number syntax and arc flags', () => {
    const g = parsePathData('M0,0L.5.5-1-1M0 0a10 10 0 01 20 0');
    expect(g.subpaths[0].nodes[1]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(g.subpaths[0].nodes[2]).toMatchObject({ x: -1, y: -1 });
    const b = geomBounds({ subpaths: [g.subpaths[1]] });
    expect(b?.width).toBeCloseTo(20, 6);
    expect(b?.height).toBeCloseTo(10, 3);
  });

  it('handles smooth curves (S/T) and quadratics', () => {
    const g = parsePathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0 Q 25 10 30 0 T 40 0');
    const nodes = g.subpaths[0].nodes;
    expect(nodes.length).toBe(5);
    expect(nodes[1].out).toEqual({ x: 10, y: -10 }); // reflected control point
    expect(nodes[1].smooth).toBe(true);
  });

  it('round-trips through serialization', () => {
    const d = 'M0 0H100V50C100 80 50 100 0 50Z';
    const g = parsePathData(d);
    const out = serializePath(g);
    expect(out).toBe(d);
    expect(serializePath(parsePathData(out))).toBe(out);
  });

  it('merges a closing node that repeats the start point', () => {
    const g = parsePathData('M0 0 C10 0 10 10 0 10 C-10 10 -10 0 0 0 Z');
    expect(g.subpaths[0].nodes.length).toBe(2);
    expect(g.subpaths[0].nodes[0].in).toEqual({ x: -10, y: 0 });
  });

  it('ignores garbage after a valid prefix', () => {
    const g = parsePathData('M0 0 L10 10 L oops');
    expect(g.subpaths[0].nodes.length).toBe(2);
  });
});

describe('curve fitting', () => {
  it('fits a circle with few curves', () => {
    const pts = Array.from({ length: 100 }, (_, i) => {
      const a = (i / 99) * Math.PI;
      return { x: 100 + Math.cos(a) * 50, y: 100 + Math.sin(a) * 50 };
    });
    const cubics = fitCurve(pts, 0.5);
    expect(cubics.length).toBeLessThanOrEqual(4);
    for (const c of cubics) {
      for (let t = 0; t <= 1; t += 0.1) {
        const p = cubicAt(c, t);
        expect(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 50)).toBeLessThan(1);
      }
    }
  });

  it('keeps corners of a square outline and makes straight segments', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const sub = polylineToSubpath(square, true, { error: 0.1 });
    expect(sub?.nodes.length).toBe(4);
    expect(sub?.nodes.every((n) => !n.in && !n.out)).toBe(true);
  });

  it('simplifies collinear points away', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyRDP(pts, 0.1)).toHaveLength(2);
  });
});

describe('objects', () => {
  it('computes bounds of rotated objects', () => {
    const r = createRect(0, 0, 100, 50);
    r.m = multiply(translate(200, 100), rotate(90));
    const b = boundsUnder(r, r.m);
    expect(b?.x).toBeCloseTo(150, 6);
    expect(b?.y).toBeCloseTo(100, 6);
    expect(b?.width).toBeCloseTo(50, 6);
    expect(b?.height).toBeCloseTo(100, 6);
  });

  it('folds scale into geometry so strokes keep their width', () => {
    const r = createRect(10, 10, 100, 50);
    const t = transformObject(r, multiply(scale(2, 3), IDENTITY));
    expect(t.type === 'rect' && t.width).toBeCloseTo(200, 9);
    expect(t.type === 'rect' && t.height).toBeCloseTo(150, 9);
    expect(decompose(t.m).sx).toBeCloseTo(1, 9);
    const b = boundsUnder(t, t.m);
    expect(b?.x).toBeCloseTo(20, 9);
    expect(b?.y).toBeCloseTo(30, 9);
  });

  it('normalizes groups by scaling children', () => {
    const a = createRect(0, 0, 10, 10);
    const g = createGroup([a]);
    const scaled = normalizeObject({ ...g, m: scale(3, 3) });
    expect(decompose(scaled.m).sx).toBeCloseTo(1, 9);
    const child = scaled.type === 'group' ? scaled.children[0] : null;
    expect(child?.type === 'rect' && child.width).toBeCloseTo(30, 9);
  });

  it('scales text uniformly into the font size', () => {
    const t = createText(0, 0, 'Hi', { fontSize: 20 });
    const s = normalizeObject({ ...t, m: scale(2, 2) });
    expect(s.type === 'text' && s.fontSize).toBeCloseTo(40, 9);
  });

  it('measures local bounds of text and groups', () => {
    const t = createText(0, 0, 'Hello\nWorld', { fontSize: 20, lineHeight: 1.5 });
    const b = localBounds(t);
    expect(b.height).toBeGreaterThan(30);
    const g = createGroup([createRect(10, 10, 5, 5), createEllipse(30, 0, 10, 10)]);
    const gb = localBounds(g);
    expect(gb).toEqual({ x: 10, y: 0, width: 30, height: 15 });
  });
});

describe('hit testing', () => {
  const filled = createRect(0, 0, 100, 100, { fill: solid('#f00'), stroke: defaultStroke() });
  const outlineOnly = createEllipse(200, 0, 100, 100, { fill: NONE, stroke: defaultStroke(solid('#000'), 4) });
  const line = createLine(0, 200, 100, 200, { stroke: defaultStroke(solid('#000'), 2) });
  const objects = [filled, outlineOnly, line];

  it('hits fills, strokes and lines', () => {
    expect(hitTest(objects, { x: 50, y: 50 }, 1)?.[0].id).toBe(filled.id);
    expect(hitTest(objects, { x: 250, y: 50 }, 1)).toBeNull(); // inside an unfilled ellipse
    expect(hitTest(objects, { x: 250, y: 1 }, 2)?.[0].id).toBe(outlineOnly.id);
    expect(hitTest(objects, { x: 50, y: 202 }, 2)?.[0].id).toBe(line.id);
    expect(hitTest(objects, { x: 50, y: 210 }, 2)).toBeNull();
  });

  it('respects rotation, locks and visibility', () => {
    const r = createRect(0, 0, 100, 10, { fill: solid('#000') });
    r.m = rotateAbout(90, 50, 5);
    expect(hitTest([r], { x: 50, y: 40 }, 0)?.[0].id).toBe(r.id);
    expect(hitTest([r], { x: 90, y: 5 }, 0)).toBeNull();
    expect(hitTest([{ ...r, locked: true }], { x: 50, y: 40 }, 0)).toBeNull();
    expect(hitTest([{ ...r, visible: false }], { x: 50, y: 40 }, 0)).toBeNull();
  });

  it('returns the group chain for nested objects', () => {
    const inner = createRect(0, 0, 10, 10, { fill: solid('#000') });
    const g = createGroup([inner]);
    g.m = translate(100, 100);
    const hit = hitTest([g], { x: 105, y: 105 }, 0);
    expect(hit?.map((o) => o.id)).toEqual([g.id, inner.id]);
    expect(worldMatrix([g], inner.id)?.[4]).toBe(100);
  });

  it('applies even-odd fill rules', () => {
    const path = createPath(parsePathData('M0 0H100V100H0Z M25 25H75V75H25Z'), { fill: solid('#000') });
    const polys = flattenGeom(path.geom);
    expect(pointInPolylines(polys, { x: 50, y: 50 }, 'nonzero')).toBe(true);
    expect(pointInPolylines(polys, { x: 50, y: 50 }, 'evenodd')).toBe(false);
    expect(pointInPolylines(polys, { x: 10, y: 10 }, 'evenodd')).toBe(true);
  });

  it('selects objects touched by a marquee', () => {
    expect(objectsInRect(objects, { x: 90, y: 90, width: 20, height: 20 })).toEqual([filled.id]);
    expect(objectsInRect(objects, { x: 230, y: 30, width: 10, height: 10 })).toEqual([]);
    expect(objectsInRect(objects, { x: -10, y: 190, width: 30, height: 30 })).toEqual([line.id]);
  });
});

describe('snapping', () => {
  const targets = buildSnapTargets([{ x: 0, y: 0, width: 100, height: 100 }]);
  it('snaps edges and centers', () => {
    const r = snapRect({ x: 47, y: 203, width: 10, height: 10 }, targets, 5);
    expect(r.dx).toBe(-2); // center 52 → 50
    expect(r.guides[0].axis).toBe('x');
    const p = snapPoint({ x: 98, y: 52 }, targets, 3);
    expect(p).toMatchObject({ x: 100, y: 50 });
  });
  it('snaps to the grid when no guide is close', () => {
    const p = snapPoint({ x: 312, y: 418 }, { ...buildSnapTargets([]), grid: { size: 10, ox: 0, oy: 0 } }, 3);
    expect(p).toMatchObject({ x: 310, y: 420 });
  });
});
