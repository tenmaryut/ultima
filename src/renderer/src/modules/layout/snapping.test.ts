import { describe, expect, it } from 'vitest';
import { buildObjectTargets, buildPageTargets, columnRanges, snapMove, snapValue, type PageGeometry } from './snapping';

const page: PageGeometry = {
  width: 800,
  height: 1000,
  margins: { top: 50, right: 40, bottom: 60, left: 40 },
  columns: 3,
  gutter: 20,
  guides: { x: [123], y: [456] },
};

describe('columns', () => {
  it('splits the area between margins into columns with gutters', () => {
    const cols = columnRanges(page);
    expect(cols).toHaveLength(3);
    expect(cols[0][0]).toBe(40);
    expect(cols[2][1]).toBeCloseTo(760);
    const width = cols[0][1] - cols[0][0];
    expect(width).toBeCloseTo((720 - 40) / 3);
    expect(cols[1][0] - cols[0][1]).toBeCloseTo(20);
  });

  it('handles a single column and oversized gutters', () => {
    expect(columnRanges({ ...page, columns: 1 })).toEqual([[40, 760]]);
    const tight = columnRanges({ ...page, columns: 2, gutter: 5000 });
    expect(tight[0][1]).toBeLessThanOrEqual(tight[1][0]);
  });
});

describe('snapMove', () => {
  const targets = buildPageTargets(page, 10);

  it('snaps the left edge to the margin', () => {
    const r = snapMove({ x: 43, y: 300, w: 100, h: 100 }, targets, 6);
    expect(r.dx).toBeCloseTo(-3);
    expect(r.dy).toBe(0);
    expect(r.guides.some((g) => g.axis === 'x' && g.value === 40)).toBe(true);
  });

  it('snaps the center to the page center', () => {
    const r = snapMove({ x: 352, y: 300, w: 100, h: 100 }, targets, 6);
    expect(r.dx).toBeCloseTo(-2);
    expect(r.guides.some((g) => g.kind === 'center')).toBe(true);
  });

  it('does not snap beyond the threshold', () => {
    const r = snapMove({ x: 200, y: 200, w: 30, h: 30 }, targets, 3);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps to ruler guides, bleed and column edges', () => {
    expect(snapValue(121, 'x', targets, 4)).toBe(123);
    expect(snapValue(458, 'y', targets, 4)).toBe(456);
    expect(snapValue(-8, 'x', targets, 4)).toBe(-10);
    const firstColEnd = columnRanges(page)[0][1];
    expect(snapValue(firstColEnd + 2, 'x', targets, 3)).toBeCloseTo(firstColEnd);
  });

  it('snaps to other objects and draws smart guides spanning both', () => {
    const others = buildObjectTargets([{ x: 500, y: 700, w: 100, h: 50 }]);
    const r = snapMove({ x: 502, y: 300, w: 80, h: 40 }, others, 5);
    expect(r.dx).toBeCloseTo(-2);
    const g = r.guides.find((x) => x.axis === 'x' && x.value === 500)!;
    expect(g.from).toBe(300);
    expect(g.to).toBe(750);
  });

  it('prefers the closest target', () => {
    const others = buildObjectTargets([{ x: 0, y: 0, w: 10, h: 10 }]);
    const r = snapMove({ x: 42, y: 300, w: 10, h: 10 }, [...targets, ...others], 6);
    expect(r.dx).toBeCloseTo(-2);
  });
});
