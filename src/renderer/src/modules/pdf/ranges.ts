/**
 * Page range parsing for PDF Studio (pure, unit tested).
 *
 * Syntax (1-based page numbers, spaces ignored, items separated by commas or semicolons):
 *   "5"        a single page
 *   "1-3"      pages 1, 2, 3            "5-3" counts down: 5, 4, 3
 *   "7-"       page 7 to the last page   "-3"  pages 1 to 3
 *   "last", "end"   the last page (also usable inside ranges: "3-last")
 *   "all", "odd", "even"
 */

export interface RangeResult {
  /** Pages (1-based) in the order given. */
  pages: number[];
  error?: string;
}

export interface GroupResult {
  /** One group of pages per comma separated item (for "split by ranges"). */
  groups: number[][];
  error?: string;
}

function parseBound(token: string, total: number): number | null {
  const t = token.trim().toLowerCase();
  if (t === 'last' || t === 'end' || t === 'n') return total;
  if (t === 'first') return 1;
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/** Pages of one item ("3-5", "odd", ...) or an error message. */
export function parseItem(item: string, total: number): number[] | string {
  const raw = item.replace(/\s+/g, '').toLowerCase();
  if (!raw) return [];
  if (raw === 'all' || raw === '*') return range(1, total);
  if (raw === 'odd') return range(1, total).filter((p) => p % 2 === 1);
  if (raw === 'even') return range(1, total).filter((p) => p % 2 === 0);
  const dash = raw.search(/[-–—]/);
  if (dash < 0) {
    const p = parseBound(raw, total);
    if (p === null) return `"${item.trim()}" is not a page number`;
    if (p < 1 || p > total) return `Page ${p} does not exist (1-${total})`;
    return [p];
  }
  const left = raw.slice(0, dash);
  const right = raw.slice(dash + 1);
  const from = left === '' ? 1 : parseBound(left, total);
  const to = right === '' ? total : parseBound(right, total);
  if (from === null || to === null) return `"${item.trim()}" is not a valid range`;
  if (from < 1 || from > total) return `Page ${from} does not exist (1-${total})`;
  if (to < 1 || to > total) return `Page ${to} does not exist (1-${total})`;
  return from <= to ? range(from, to) : range(to, from).reverse();
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p);
  return out;
}

function splitItems(input: string): string[] {
  return input
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses a page list such as "1-3, 5, 8-". Duplicates are kept in the given order. */
export function parsePageRanges(input: string, total: number): RangeResult {
  if (total < 1) return { pages: [], error: 'The document has no pages' };
  const items = splitItems(input);
  if (!items.length) return { pages: [], error: 'Enter page numbers, e.g. 1-3, 5' };
  const pages: number[] = [];
  for (const item of items) {
    const result = parseItem(item, total);
    if (typeof result === 'string') return { pages: [], error: result };
    pages.push(...result);
  }
  return { pages };
}

/** Like parsePageRanges but de-duplicated and sorted ascending. */
export function parsePageSet(input: string, total: number): RangeResult {
  const r = parsePageRanges(input, total);
  if (r.error) return r;
  return { pages: [...new Set(r.pages)].sort((a, b) => a - b) };
}

/** "1-3,4-6" → [[1,2,3],[4,5,6]]: one output file per item. */
export function parseRangeGroups(input: string, total: number): GroupResult {
  if (total < 1) return { groups: [], error: 'The document has no pages' };
  const items = splitItems(input);
  if (!items.length) return { groups: [], error: 'Enter page ranges, e.g. 1-3, 4-6' };
  const groups: number[][] = [];
  for (const item of items) {
    const result = parseItem(item, total);
    if (typeof result === 'string') return { groups: [], error: result };
    if (result.length) groups.push(result);
  }
  return { groups };
}

/** Splits 1..total into chunks of `n` pages. */
export function splitEvery(total: number, n: number): number[][] {
  const size = Math.max(1, Math.floor(n));
  const groups: number[][] = [];
  for (let start = 1; start <= total; start += size) groups.push(range(start, Math.min(total, start + size - 1)));
  return groups;
}

/** [1,2,3,5,7,8] → "1-3, 5, 7-8" */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

/** Label for a group of pages used in file names: [4,5,6] → "4-6", [2] → "2". */
export function groupLabel(group: number[]): string {
  if (!group.length) return '';
  const contiguous = group.every((p, i) => i === 0 || p === group[i - 1] + 1);
  if (contiguous) return group.length > 1 ? `${group[0]}-${group[group.length - 1]}` : String(group[0]);
  return formatPageList(group).replace(/,\s*/g, '_');
}
