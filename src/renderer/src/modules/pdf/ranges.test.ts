import { describe, expect, it } from 'vitest';
import { formatPageList, groupLabel, parsePageRanges, parsePageSet, parseRangeGroups, splitEvery } from './ranges';

describe('parsePageRanges', () => {
  it('parses singles, ranges and open ranges', () => {
    expect(parsePageRanges('1-3, 5, 8-', 10).pages).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(parsePageRanges('-3', 10).pages).toEqual([1, 2, 3]);
    expect(parsePageRanges(' 2 ;4 ', 5).pages).toEqual([2, 4]);
  });
  it('supports keywords', () => {
    expect(parsePageRanges('all', 3).pages).toEqual([1, 2, 3]);
    expect(parsePageRanges('odd', 5).pages).toEqual([1, 3, 5]);
    expect(parsePageRanges('even', 5).pages).toEqual([2, 4]);
    expect(parsePageRanges('last', 7).pages).toEqual([7]);
    expect(parsePageRanges('3-end', 5).pages).toEqual([3, 4, 5]);
  });
  it('counts down for reversed ranges and accepts en dashes', () => {
    expect(parsePageRanges('5-3', 6).pages).toEqual([5, 4, 3]);
    expect(parsePageRanges('2–4', 6).pages).toEqual([2, 3, 4]);
  });
  it('reports errors', () => {
    expect(parsePageRanges('', 5).error).toBeTruthy();
    expect(parsePageRanges('0', 5).error).toBeTruthy();
    expect(parsePageRanges('6', 5).error).toBeTruthy();
    expect(parsePageRanges('2-9', 5).error).toBeTruthy();
    expect(parsePageRanges('abc', 5).error).toBeTruthy();
    expect(parsePageRanges('1-2-3', 5).error).toBeTruthy();
    expect(parsePageRanges('1', 0).error).toBeTruthy();
  });
  it('de-duplicates and sorts with parsePageSet', () => {
    expect(parsePageSet('5,1-3,2', 6).pages).toEqual([1, 2, 3, 5]);
  });
});

describe('split helpers', () => {
  it('groups by item', () => {
    expect(parseRangeGroups('1-3,4-6', 6).groups).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(parseRangeGroups('1, 2-3', 3).groups).toEqual([[1], [2, 3]]);
    expect(parseRangeGroups('1-3,7', 6).error).toBeTruthy();
  });
  it('splits every N pages', () => {
    expect(splitEvery(7, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(splitEvery(2, 0)).toEqual([[1], [2]]);
    expect(splitEvery(0, 3)).toEqual([]);
  });
  it('formats page lists and labels', () => {
    expect(formatPageList([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8');
    expect(formatPageList([3, 1, 2, 2])).toBe('1-3');
    expect(groupLabel([4, 5, 6])).toBe('4-6');
    expect(groupLabel([2])).toBe('2');
    expect(groupLabel([1, 3])).toBe('1_3');
  });
});
