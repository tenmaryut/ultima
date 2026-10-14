import { describe, expect, it } from 'vitest';
import { deletePages, duplicatePages, insertPages, movePages, rangeBetween, reversePages, rotatePages } from './organize';
import type { DocState, PageEntry } from './types';
import { EMPTY_META } from './types';

const pages: PageEntry[] = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, src: 's', index, rotate: 0 }));
const ids = (list: PageEntry[]) => list.map((p) => p.id).join('');

describe('movePages', () => {
  it('moves one page forward and backward', () => {
    expect(ids(movePages(pages, ['a'], 3))).toBe('bcade');
    expect(ids(movePages(pages, ['d'], 0))).toBe('dabce');
    expect(ids(movePages(pages, ['b'], 5))).toBe('acdeb');
  });
  it('moves several pages keeping their order', () => {
    expect(ids(movePages(pages, ['e', 'a'], 2))).toBe('baecd');
  });
  it('returns the same array when nothing changes', () => {
    expect(movePages(pages, ['b'], 1)).toBe(pages);
    expect(movePages(pages, [], 3)).toBe(pages);
  });
});

describe('page operations', () => {
  const doc: DocState = {
    pages,
    annots: [{ id: 'x', page: 'b', type: 'redact', rect: { x: 0, y: 0, w: 1, h: 1 } }],
    fields: {},
    meta: EMPTY_META,
  };
  it('rotates pages', () => {
    const r = rotatePages(pages, ['a'], -90);
    expect(r[0].rotate).toBe(270);
    expect(rotatePages(r, ['a'], 180)[0].rotate).toBe(90);
  });
  it('deletes pages with their annotations', () => {
    const d = deletePages(doc, ['b']);
    expect(ids(d.pages)).toBe('acde');
    expect(d.annots).toHaveLength(0);
  });
  it('duplicates pages after themselves with copied annotations', () => {
    const { doc: d, newIds } = duplicatePages(doc, ['b']);
    expect(d.pages.map((p) => p.index)).toEqual([0, 1, 1, 2, 3, 4]);
    expect(newIds).toHaveLength(1);
    expect(d.annots).toHaveLength(2);
    expect(d.annots[1].page).toBe(newIds[0]);
    expect(d.annots[1].id).not.toBe('x');
  });
  it('inserts pages at a position', () => {
    const extra: PageEntry = { id: 'z', src: 't', index: 0, rotate: 0 };
    expect(ids(insertPages(doc, [extra], 2).pages)).toBe('abzcde');
    expect(ids(insertPages(doc, [extra], 99).pages)).toBe('abcdez');
  });
  it('reverses a selection in place and computes ranges', () => {
    expect(ids(reversePages(pages, ['b', 'c', 'e']))).toBe('aecdb');
    expect(rangeBetween(pages, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });
});
