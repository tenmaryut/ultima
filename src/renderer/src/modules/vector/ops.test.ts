import { describe, expect, it } from 'vitest';
import { multiPolygonArea } from './boolean';
import { boundsUnder, selectionBounds, worldMatrix } from './geometry';
import { rotate, translate } from './matrix';
import { createEllipse, createGroup, createLine, createRect, defaultStroke, solid, type VObject } from './model';
import {
  alignByIds,
  arrangeByIds,
  distributeByIds,
  duplicateByIds,
  findById,
  flipByIds,
  getFrame,
  groupByIds,
  moveObjectTo,
  outlineStrokeByIds,
  pathfinderByIds,
  setFrame,
  toPathObject,
  topLevelSelection,
  ungroupByIds,
} from './ops';
import { objectToMultiPolygon } from './pathfinder';

const rect = (x: number, y: number, w = 10, h = 10) => createRect(x, y, w, h, { fill: solid('#000') });
const bounds = (objects: VObject[], id: string) => selectionBounds(objects, [id]);

describe('arrange', () => {
  it('moves objects forward, backward, to front and back', () => {
    const [a, b, c] = [rect(0, 0), rect(0, 0), rect(0, 0)];
    const objs = [a, b, c];
    expect(arrangeByIds(objs, [a.id], 'forward').map((o) => o.id)).toEqual([b.id, a.id, c.id]);
    expect(arrangeByIds(objs, [c.id], 'backward').map((o) => o.id)).toEqual([a.id, c.id, b.id]);
    expect(arrangeByIds(objs, [a.id], 'front').map((o) => o.id)).toEqual([b.id, c.id, a.id]);
    expect(arrangeByIds(objs, [c.id], 'back').map((o) => o.id)).toEqual([c.id, a.id, b.id]);
    expect(arrangeByIds(objs, [c.id], 'forward')).toEqual(objs);
  });
});

describe('group / ungroup', () => {
  it('keeps world positions', () => {
    const a = rect(10, 10);
    const b = rect(50, 20);
    b.m = [...translate(50, 20)] as typeof b.m;
    const g = groupByIds([a, b], [a.id, b.id]);
    expect(g).not.toBeNull();
    const grouped = g!.objects;
    expect(grouped).toHaveLength(1);
    expect(bounds(grouped, g!.groupId)).toEqual({ x: 10, y: 10, width: 50, height: 20 });
    // rotate the group, then ungroup: children keep their rotated placement
    const rotated = grouped.map((o) => ({ ...o, m: rotate(90) }) as VObject);
    const before = bounds(rotated, a.id);
    const un = ungroupByIds(rotated, [g!.groupId]);
    expect(un.objects).toHaveLength(2);
    const after = bounds(un.objects, a.id);
    expect(after?.x).toBeCloseTo(before!.x, 9);
    expect(after?.y).toBeCloseTo(before!.y, 9);
  });

  it('drops nested ids covered by a selected group', () => {
    const a = rect(0, 0);
    const g = createGroup([a]);
    expect(topLevelSelection([g], [a.id, g.id])).toEqual([g.id]);
  });

  it('moves objects between layers keeping their placement', () => {
    const a = rect(100, 100);
    const g = createGroup([rect(0, 0)]);
    g.m = translate(40, 40);
    const moved = moveObjectTo([a, g], a.id, g.id, 1);
    const inGroup = findById(moved, a.id);
    expect(inGroup).not.toBeNull();
    expect(worldMatrix(moved, a.id)?.[4]).toBeCloseTo(100, 9);
    expect(moved).toHaveLength(1);
  });
});

describe('align & distribute', () => {
  it('aligns to the selection and to a target rect', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(30, 40, 20, 20);
    const left = alignByIds([a, b], [a.id, b.id], 'left');
    expect(bounds(left, b.id)?.x).toBe(0);
    const bottom = alignByIds([a, b], [a.id, b.id], 'bottom');
    expect(bounds(bottom, a.id)?.y).toBe(50);
    const centered = alignByIds([a], [a.id], 'hcenter', { x: 0, y: 0, width: 100, height: 100 });
    expect(bounds(centered, a.id)?.x).toBe(45);
  });

  it('distributes equal gaps', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(15, 0, 30, 10);
    const c = rect(90, 0, 10, 10);
    const d = distributeByIds([a, b, c], [a.id, b.id, c.id], 'h');
    expect(bounds(d, b.id)?.x).toBeCloseTo(35, 9); // gaps of 25
  });
});

describe('transform helpers', () => {
  it('duplicates with an offset above the original', () => {
    const a = rect(0, 0);
    const r = duplicateByIds([a], [a.id], 10, 5);
    expect(r.objects).toHaveLength(2);
    expect(bounds(r.objects, r.ids[0])).toMatchObject({ x: 10, y: 5 });
    expect(r.objects[1].id).toBe(r.ids[0]);
  });

  it('reads and writes frames (size about the top-left, rotation about the center)', () => {
    const a = rect(10, 20, 100, 50);
    let objs: VObject[] = [a];
    expect(getFrame(objs, a.id)).toMatchObject({ x: 10, y: 20, w: 100, h: 50, rotation: 0 });
    objs = setFrame(objs, a.id, { w: 200 });
    expect(getFrame(objs, a.id)).toMatchObject({ x: 10, y: 20, w: 200, h: 50 });
    objs = setFrame(objs, a.id, { rotation: 45 });
    const f = getFrame(objs, a.id)!;
    expect(f.rotation).toBeCloseTo(45, 6);
    expect(f.x).toBeCloseTo(10, 6);
    expect(f.w).toBeCloseTo(200, 6);
  });

  it('flips about the selection center', () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(90, 0, 10, 10);
    const flipped = flipByIds([a, b], [a.id, b.id], 'h');
    expect(bounds(flipped, a.id)?.x).toBeCloseTo(90, 9);
  });

  it('converts shapes into paths', () => {
    const e = createEllipse(0, 0, 20, 10);
    const p = toPathObject(e);
    expect(p?.type).toBe('path');
    expect(p && boundsUnder(p, p.m)).toMatchObject({ x: 0, y: 0, width: 20, height: 10 });
  });
});

describe('pathfinder', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);
  b.fill = solid('#f00');

  it('unites into one compound path with the top style', () => {
    const r = pathfinderByIds([a, b], [a.id, b.id], 'unite')!;
    expect(r.objects).toHaveLength(1);
    const p = r.objects[0];
    expect(p.type).toBe('path');
    expect(p.fill).toEqual(solid('#f00'));
    expect(multiPolygonArea(objectToMultiPolygon(p, p.m))).toBeCloseTo(17500, 0);
    expect(p.type === 'path' && p.geom.subpaths[0].nodes.length).toBe(8);
  });

  it('minus front keeps the back style', () => {
    const r = pathfinderByIds([a, b], [a.id, b.id], 'minus-front')!;
    const p = r.objects[0];
    expect(p.fill).toEqual(solid('#000'));
    expect(multiPolygonArea(objectToMultiPolygon(p, p.m))).toBeCloseTo(7500, 0);
  });

  it('intersects and excludes', () => {
    const i = pathfinderByIds([a, b], [a.id, b.id], 'intersect')!.objects[0];
    expect(multiPolygonArea(objectToMultiPolygon(i, i.m))).toBeCloseTo(2500, 0);
    const x = pathfinderByIds([a, b], [a.id, b.id], 'exclude')!.objects[0];
    expect(multiPolygonArea(objectToMultiPolygon(x, x.m))).toBeCloseTo(15000, 0);
  });

  it('refits curves when uniting circles', () => {
    const c1 = createEllipse(0, 0, 100, 100, { fill: solid('#000') });
    const c2 = createEllipse(50, 0, 100, 100, { fill: solid('#000') });
    const r = pathfinderByIds([c1, c2], [c1.id, c2.id], 'unite')!;
    const p = r.objects[0];
    expect(p.type === 'path' && p.geom.subpaths[0].nodes.length).toBeLessThan(24);
    const area = multiPolygonArea(objectToMultiPolygon(p, p.m));
    const lens = 2 * 2500 * Math.acos(0.5) - 25 * Math.sqrt(10000 - 2500);
    const expected = 2 * Math.PI * 2500 - lens;
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.002);
  });

  it('keeps node counts low for curved results', () => {
    const sq = createRect(0, 0, 255, 145, { fill: solid('#000') });
    const c = createEllipse(160, 107, 224, 224, { fill: solid('#000') });
    const r = pathfinderByIds([sq, c], [sq.id, c.id], 'unite')!;
    const p = r.objects[0];
    const nodes = p.type === 'path' ? p.geom.subpaths[0].nodes.length : 0;
    expect(nodes).toBeGreaterThanOrEqual(6);
    expect(nodes).toBeLessThanOrEqual(9);
  });

  it('outlines strokes', () => {
    const line = createLine(0, 0, 100, 0, { stroke: defaultStroke(solid('#000'), 10) });
    const r = outlineStrokeByIds([line], [line.id]);
    const p = r.objects[0];
    expect(p.type).toBe('path');
    expect(p.fill).toEqual(solid('#000'));
    expect(multiPolygonArea(objectToMultiPolygon(p, p.m))).toBeCloseTo(1000, 0);
  });
});
