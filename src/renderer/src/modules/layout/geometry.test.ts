import { describe, expect, it } from 'vitest';
import {
  alignOffsets,
  boundingBox,
  distributeOffsets,
  handleCursor,
  handlePosition,
  imagePlacement,
  mapRect,
  normalizeAngle,
  panFocal,
  pointInRect,
  rectFromPoints,
  resizeRect,
  rotatePoint,
  rotationFromPointer,
  shapePolygon,
  unionRects,
} from './geometry';

const close = (a: { x: number; y: number; w?: number; h?: number }, b: { x: number; y: number; w?: number; h?: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  if (b.w !== undefined) expect(a.w).toBeCloseTo(b.w, 6);
  if (b.h !== undefined) expect(a.h).toBeCloseTo(b.h, 6);
};

describe('basic geometry', () => {
  it('normalizes angles to (-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(180)).toBe(180);
  });

  it('rotates points around a center', () => {
    close(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: 10 });
    close(rotatePoint({ x: 5, y: 5 }, { x: 5, y: 5 }, 45), { x: 5, y: 5 });
  });

  it('computes bounding boxes of rotated rects', () => {
    close(boundingBox({ x: 0, y: 0, w: 100, h: 50 }, 90), { x: 25, y: -25, w: 50, h: 100 });
    const b = boundingBox({ x: 0, y: 0, w: 100, h: 100 }, 45);
    expect(b.w).toBeCloseTo(141.421, 2);
    expect(unionRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 20 }])).toEqual({ x: 0, y: 0, w: 30, h: 25 });
    expect(unionRects([])).toBeNull();
    expect(rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 20 })).toEqual({ x: 0, y: 10, w: 10, h: 10 });
  });

  it('hit-tests rotated rects', () => {
    const r = { x: 0, y: 0, w: 100, h: 20 };
    expect(pointInRect({ x: 50, y: 10 }, r, 0)).toBe(true);
    expect(pointInRect({ x: 95, y: 10 }, r, 90)).toBe(false);
    expect(pointInRect({ x: 50, y: -30 }, r, 90)).toBe(true);
    expect(pointInRect({ x: 101, y: 10 }, r, 0, 2)).toBe(true);
  });

  it('positions handles and cursors', () => {
    close(handlePosition({ x: 0, y: 0, w: 100, h: 50 }, 0, 'se'), { x: 100, y: 50 });
    close(handlePosition({ x: 0, y: 0, w: 100, h: 50 }, 180, 'se'), { x: 0, y: 0 });
    expect(handleCursor('e', 0)).toBe('ew-resize');
    expect(handleCursor('e', 90)).toBe('ns-resize');
  });
});

describe('resizeRect', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };

  it('drags corners and edges of an unrotated rect', () => {
    expect(resizeRect(r, 0, 'se', { x: 400, y: 300 })).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect(resizeRect(r, 0, 'nw', { x: 50, y: 50 })).toEqual({ x: 50, y: 50, w: 250, h: 150 });
    expect(resizeRect(r, 0, 'e', { x: 350, y: 999 })).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resizeRect(r, 0, 'n', { x: 0, y: 150 })).toEqual({ x: 100, y: 150, w: 200, h: 50 });
  });

  it('keeps a minimum size', () => {
    const out = resizeRect(r, 0, 'se', { x: 0, y: 0 }, { minSize: 4 });
    expect(out.w).toBe(4);
    expect(out.h).toBe(4);
  });

  it('keeps the aspect ratio', () => {
    const out = resizeRect(r, 0, 'se', { x: 500, y: 150 }, { keepAspect: true });
    expect(out.w / out.h).toBeCloseTo(2);
    expect(out.w).toBeCloseTo(400);
    const edge = resizeRect(r, 0, 'e', { x: 500, y: 0 }, { keepAspect: true });
    expect(edge.w / edge.h).toBeCloseTo(2);
    expect(edge.y + edge.h / 2).toBeCloseTo(150);
  });

  it('resizes from the center', () => {
    expect(resizeRect(r, 0, 'e', { x: 350, y: 150 }, { fromCenter: true })).toEqual({ x: 50, y: 100, w: 300, h: 100 });
  });

  it('keeps the opposite corner fixed for rotated rects', () => {
    const rot = 30;
    const before = handlePosition(r, rot, 'nw');
    const diag = rotatePoint({ x: 260, y: 140 }, { x: 0, y: 0 }, rot);
    const pointer = { x: before.x + diag.x, y: before.y + diag.y };
    const out = resizeRect(r, rot, 'se', pointer);
    expect(out.w).toBeCloseTo(260, 4);
    expect(out.h).toBeCloseTo(140, 4);
    close(handlePosition(out, rot, 'nw'), before);
  });

  it('computes rotation from the pointer, with snapping', () => {
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(rotationFromPointer({ x: 0, y: 0 }, { x: 10, y: -9 }, true)).toBe(45);
  });

  it('maps rects between boxes (group scaling)', () => {
    expect(mapRect({ x: 10, y: 10, w: 10, h: 10 }, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 200, h: 50 })).toEqual({ x: 20, y: 5, w: 20, h: 5 });
  });
});

describe('align and distribute', () => {
  const items = [
    { id: 'a', box: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'b', box: { x: 50, y: 20, w: 20, h: 20 } },
    { id: 'c', box: { x: 100, y: 5, w: 10, h: 30 } },
  ];
  const target = { x: 0, y: 0, w: 110, h: 40 };

  it('aligns edges and centers', () => {
    expect(alignOffsets(items, 'left', target).get('b')).toEqual({ x: -50, y: 0 });
    expect(alignOffsets(items, 'right', target).get('a')).toEqual({ x: 100, y: 0 });
    expect(alignOffsets(items, 'hcenter', target).get('c')).toEqual({ x: -50, y: 0 });
    expect(alignOffsets(items, 'bottom', target).get('a')).toEqual({ x: 0, y: 30 });
    expect(alignOffsets(items, 'vcenter', target).get('b')).toEqual({ x: 0, y: -10 });
  });

  it('distributes spacing evenly', () => {
    const d = distributeOffsets(items, 'x');
    expect(d.get('a')).toEqual({ x: 0, y: 0 });
    expect(d.get('c')).toEqual({ x: 0, y: 0 });
    // gaps: span 110 - widths 40 = 70 / 2 = 35 → b at 45
    expect(d.get('b')!.x).toBeCloseTo(-5);
    expect(distributeOffsets(items.slice(0, 2), 'y').get('b')).toEqual({ x: 0, y: 0 });
  });
});

describe('image placement', () => {
  it('fills (cover) and centers by default', () => {
    expect(imagePlacement(100, 100, 200, 100, 'fill')).toEqual({ x: -50, y: 0, w: 200, h: 100 });
  });

  it('fits (contain)', () => {
    expect(imagePlacement(100, 100, 200, 100, 'fit')).toEqual({ x: 0, y: 25, w: 100, h: 50 });
  });

  it('stretches and supports original size', () => {
    expect(imagePlacement(100, 50, 200, 100, 'stretch')).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(imagePlacement(100, 100, 40, 20, 'none', 0, 0)).toEqual({ x: 0, y: 0, w: 40, h: 20 });
  });

  it('uses the focal point and zoom', () => {
    expect(imagePlacement(100, 100, 200, 100, 'fill', 0, 0.5)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(imagePlacement(100, 100, 200, 100, 'fill', 1, 0.5).x).toBe(-100);
    expect(imagePlacement(100, 100, 100, 100, 'fill', 0.5, 0.5, 2)).toEqual({ x: -50, y: -50, w: 200, h: 200 });
  });

  it('pans the focal point and clamps it', () => {
    const p = imagePlacement(100, 100, 200, 100, 'fill');
    expect(panFocal(p, 100, 100, 0.5, 0.5, 25, 0).focalX).toBeCloseTo(0.25);
    expect(panFocal(p, 100, 100, 0.5, 0.5, -1000, 0).focalX).toBe(1);
    expect(panFocal(p, 100, 100, 0.5, 0.5, 0, 30).focalY).toBe(0.5);
  });

  it('builds polygons inside the frame', () => {
    for (const kind of ['triangle', 'diamond', 'star'] as const) {
      const pts = shapePolygon(kind, 100, 80, 2);
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(1.99);
        expect(p.x).toBeLessThanOrEqual(98.01);
        expect(p.y).toBeGreaterThanOrEqual(1.99);
        expect(p.y).toBeLessThanOrEqual(78.01);
      }
    }
    expect(shapePolygon('star', 100, 100)).toHaveLength(10);
  });
});
