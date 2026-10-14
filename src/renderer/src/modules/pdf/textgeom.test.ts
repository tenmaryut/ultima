import { describe, expect, it } from 'vitest';
import { buildPageText, findInText, itemRangeRect, matchRects, mergeLineRects, separatorBetween, type TextItemLike } from './textgeom';

const item = (str: string, x: number, y: number, width: number, size = 10, hasEOL = false): TextItemLike => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
  hasEOL,
});

describe('page text assembly', () => {
  it('joins items on a line and breaks lines', () => {
    const items = [item('Hello', 10, 700, 25), item('world', 40, 700, 25), item('Next line', 10, 685, 45)];
    const idx = buildPageText(items);
    expect(idx.text).toBe('Hello world\nNext line');
    expect(idx.itemOf[0]).toBe(0);
    expect(idx.itemOf[5]).toBe(-1);
    expect(idx.itemOf[6]).toBe(1);
    expect(idx.offsetOf[7]).toBe(1);
  });
  it('does not add spaces inside words split into items', () => {
    expect(separatorBetween(item('Hel', 10, 700, 15), item('lo', 25, 700, 10))).toBe('');
    expect(separatorBetween(item('end.', 10, 700, 20, 10, true), item('Start', 10, 690, 25))).toBe('\n');
  });
});

describe('find', () => {
  it('is case-insensitive by default and matches across whitespace', () => {
    const text = 'Total Amount due\nTOTAL amount';
    expect(findInText(text, 'total amount')).toEqual([
      { start: 0, end: 12 },
      { start: 17, end: 29 },
    ]);
    expect(findInText(text, 'amount due')).toEqual([{ start: 6, end: 16 }]);
    expect(findInText('amount\ndue', 'amount due')).toEqual([{ start: 0, end: 10 }]);
  });
  it('honours case sensitivity and whole words', () => {
    expect(findInText('Cat cat', 'cat', { caseSensitive: true })).toEqual([{ start: 4, end: 7 }]);
    expect(findInText('category cat', 'cat', { wholeWord: true })).toEqual([{ start: 9, end: 12 }]);
  });
  it('escapes regular expression characters', () => {
    expect(findInText('price (USD) $5.00', '(usd) $5.00')).toEqual([{ start: 6, end: 17 }]);
  });
  it('returns nothing for empty queries', () => {
    expect(findInText('abc', '  ')).toEqual([]);
  });
});

describe('match rectangles', () => {
  it('computes a rect for part of an item', () => {
    const r = itemRangeRect(item('abcdefghij', 100, 500, 50), 2, 4);
    expect(r.x).toBeCloseTo(110);
    expect(r.w).toBeCloseTo(10);
    expect(r.y).toBeCloseTo(500 - 2.2);
    expect(r.h).toBeCloseTo(10.7);
  });
  it('covers a match spanning two items on one line with one merged rect', () => {
    const items = [item('Hello', 10, 700, 25), item('world', 40, 700, 25)];
    const idx = buildPageText(items);
    const [m] = findInText(idx.text, 'hello world');
    const rects = matchRects(idx, items, m.start, m.end);
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBeCloseTo(10);
    expect(rects[0].x + rects[0].w).toBeCloseTo(65);
  });
  it('keeps separate rects for separate lines', () => {
    const rects = mergeLineRects([
      { x: 10, y: 700, w: 20, h: 10 },
      { x: 10, y: 680, w: 20, h: 10 },
    ]);
    expect(rects).toHaveLength(2);
  });
});
