/**
 * Page organisation operations on the document state (pure, unit tested).
 */
import { uid } from '../../core/utils/id';
import { normalizeRotation } from './geometry';
import { duplicateAnnot } from './annots';
import type { DocState, PageEntry } from './types';

export function newPageId(): string {
  return uid('p');
}

export function makePages(src: string, count: number, startIndex = 0): PageEntry[] {
  const out: PageEntry[] = [];
  for (let i = 0; i < count; i++) out.push({ id: newPageId(), src, index: startIndex + i, rotate: 0 });
  return out;
}

/**
 * Moves the pages with `ids` (keeping their relative order) so they are inserted before
 * the page that was at `toIndex` in the original list (`toIndex === pages.length` = end).
 */
export function movePages(pages: PageEntry[], ids: Iterable<string>, toIndex: number): PageEntry[] {
  const set = new Set(ids);
  if (!set.size) return pages;
  const moving = pages.filter((p) => set.has(p.id));
  const before = pages.slice(0, Math.max(0, Math.min(pages.length, toIndex))).filter((p) => !set.has(p.id)).length;
  const rest = pages.filter((p) => !set.has(p.id));
  const next = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  return next.every((p, i) => p === pages[i]) ? pages : next;
}

export function rotatePages(pages: PageEntry[], ids: Iterable<string>, delta: number): PageEntry[] {
  const set = new Set(ids);
  return pages.map((p) => (set.has(p.id) ? { ...p, rotate: normalizeRotation(p.rotate + delta) } : p));
}

export function deletePages(doc: DocState, ids: Iterable<string>): DocState {
  const set = new Set(ids);
  return {
    ...doc,
    pages: doc.pages.filter((p) => !set.has(p.id)),
    annots: doc.annots.filter((a) => !set.has(a.page)),
  };
}

/** Inserts a copy of each page (with its annotations) right after it. Returns the new ids too. */
export function duplicatePages(doc: DocState, ids: Iterable<string>): { doc: DocState; newIds: string[] } {
  const set = new Set(ids);
  const pages: PageEntry[] = [];
  const annots = [...doc.annots];
  const newIds: string[] = [];
  for (const p of doc.pages) {
    pages.push(p);
    if (!set.has(p.id)) continue;
    const copy: PageEntry = { ...p, id: newPageId() };
    pages.push(copy);
    newIds.push(copy.id);
    for (const a of doc.annots) if (a.page === p.id) annots.push(duplicateAnnot(a, copy.id, 0));
  }
  return { doc: { ...doc, pages, annots }, newIds };
}

export function insertPages(doc: DocState, entries: PageEntry[], at: number): DocState {
  const index = Math.max(0, Math.min(doc.pages.length, at));
  return { ...doc, pages: [...doc.pages.slice(0, index), ...entries, ...doc.pages.slice(index)] };
}

export function reversePages(pages: PageEntry[], ids: Iterable<string>): PageEntry[] {
  const set = new Set(ids);
  const positions = pages.map((p, i) => (set.has(p.id) ? i : -1)).filter((i) => i >= 0);
  const reversed = positions.map((i) => pages[i]).reverse();
  const next = [...pages];
  positions.forEach((pos, k) => (next[pos] = reversed[k]));
  return next;
}

/** Ids of the pages between two ids (inclusive), for shift-click range selection. */
export function rangeBetween(pages: PageEntry[], a: string, b: string): string[] {
  const i = pages.findIndex((p) => p.id === a);
  const j = pages.findIndex((p) => p.id === b);
  if (i < 0 || j < 0) return [b];
  const [from, to] = i <= j ? [i, j] : [j, i];
  return pages.slice(from, to + 1).map((p) => p.id);
}
