/**
 * Page text assembly and text geometry (pure, unit tested): builds a searchable string
 * from pdf.js text items (keeping a map back to item/character positions) and turns
 * matches into rectangles in PDF user space (for Find highlights and AI highlights).
 */
import type { Rect } from './geometry';

/** The subset of pdf.js' TextItem we use. */
export interface TextItemLike {
  str: string;
  /** Text rendering matrix in user space [a, b, c, d, e, f]; (e, f) is the baseline start. */
  transform: number[];
  /** Advance width in user space. */
  width: number;
  height: number;
  hasEOL?: boolean;
  fontName?: string;
}

export interface PageTextIndex {
  /** Page text with separators between items ('' / ' ' / '\n'). */
  text: string;
  /** Item index of every character in `text` (-1 for inserted separators). */
  itemOf: number[];
  /** Character offset inside the item for every character in `text`. */
  offsetOf: number[];
}

function itemFontSize(item: TextItemLike): number {
  const [, , c, d] = item.transform;
  return Math.hypot(c ?? 0, d ?? 0) || item.height || 10;
}

function baselineDir(item: TextItemLike): { x: number; y: number } {
  const [a, b] = item.transform;
  const len = Math.hypot(a ?? 0, b ?? 0);
  return len ? { x: a / len, y: b / len } : { x: 1, y: 0 };
}

/** Separator to put between two consecutive items. */
export function separatorBetween(prev: TextItemLike, next: TextItemLike): string {
  if (prev.hasEOL) return '\n';
  if (!prev.str || !next.str) return '';
  const size = Math.max(itemFontSize(prev), itemFontSize(next));
  const dir = baselineDir(prev);
  const px = prev.transform[4] ?? 0;
  const py = prev.transform[5] ?? 0;
  const nx = next.transform[4] ?? 0;
  const ny = next.transform[5] ?? 0;
  // offset of the next item relative to the previous one, along / across the baseline
  const dx = nx - px;
  const dy = ny - py;
  const along = dx * dir.x + dy * dir.y;
  const across = -dx * dir.y + dy * dir.x;
  if (Math.abs(across) > size * 0.6) return '\n';
  const gap = along - prev.width;
  if (gap < -size * 0.5) return '\n'; // jumped back: new line / column
  if (/\s$/.test(prev.str) || /^\s/.test(next.str)) return '';
  return gap > size * 0.15 ? ' ' : '';
}

export function buildPageText(items: TextItemLike[]): PageTextIndex {
  let text = '';
  const itemOf: number[] = [];
  const offsetOf: number[] = [];
  items.forEach((item, i) => {
    if (i > 0) {
      const sep = separatorBetween(items[i - 1], item);
      for (const ch of sep) {
        text += ch;
        itemOf.push(-1);
        offsetOf.push(0);
      }
    }
    for (let k = 0; k < item.str.length; k++) {
      text += item.str[k];
      itemOf.push(i);
      offsetOf.push(k);
    }
  });
  return { text, itemOf, offsetOf };
}

/** Plain page text (for AI / text export). */
export function pageTextFromItems(items: TextItemLike[]): string {
  return buildPageText(items).text;
}

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface TextMatch {
  start: number;
  end: number;
}

/** Folds case without changing string length (so offsets stay aligned). */
function fold(text: string, caseSensitive: boolean): string {
  let out = '';
  for (const ch of text) {
    let c = ch === '\n' || ch === '\t' || ch === ' ' ? ' ' : ch;
    if (!caseSensitive) {
      const lower = c.toLowerCase();
      if (lower.length === c.length) c = lower;
    }
    // keep UTF-16 length identical (surrogate pairs are 2 units in both)
    out += c;
  }
  return out;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}_]/u.test(ch);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All (non-overlapping) occurrences of `query` in `text`. Whitespace in the query matches any whitespace run. */
export function findInText(text: string, query: string, options: FindOptions = {}, limit = 10000): TextMatch[] {
  const q = fold(query.trim().replace(/\s+/g, ' '), !!options.caseSensitive);
  if (!q) return [];
  const hay = fold(text, !!options.caseSensitive);
  const re = new RegExp(q.split(' ').map(escapeRegExp).join(' +'), 'g');
  const out: TextMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) && out.length < limit) {
    const start = m.index;
    const end = start + m[0].length;
    if (!options.wholeWord || (!isWordChar(hay[start - 1]) && !isWordChar(hay[end]))) {
      out.push({ start, end });
    } else {
      re.lastIndex = start + 1;
    }
  }
  return out;
}

/** Returns [startFraction, endFraction] of characters [s, e) along the item's advance width. */
export type MeasureFn = (item: TextItemLike, s: number, e: number) => [number, number];

/** Proportional-by-character measure (exact for monospace fonts, close enough otherwise). */
export const charMeasure: MeasureFn = (item, s, e) => {
  const n = Math.max(1, item.str.length);
  return [s / n, e / n];
};

/** Rect (user space) covering characters [s, e) of a text item. */
export function itemRangeRect(item: TextItemLike, s: number, e: number, measure: MeasureFn = charMeasure, ascent = 0.85, descent = -0.22): Rect {
  const [fs, fe] = measure(item, s, e);
  const dir = baselineDir(item);
  const size = itemFontSize(item);
  const [, , c, d] = item.transform;
  const nLen = Math.hypot(c ?? 0, d ?? 0);
  const up = nLen ? { x: c / nLen, y: d / nLen } : { x: -dir.y, y: dir.x };
  const ox = item.transform[4] ?? 0;
  const oy = item.transform[5] ?? 0;
  const startX = ox + dir.x * item.width * fs;
  const startY = oy + dir.y * item.width * fs;
  const endX = ox + dir.x * item.width * fe;
  const endY = oy + dir.y * item.width * fe;
  const pts = [
    { x: startX + up.x * descent * size, y: startY + up.y * descent * size },
    { x: endX + up.x * descent * size, y: endY + up.y * descent * size },
    { x: endX + up.x * ascent * size, y: endY + up.y * ascent * size },
    { x: startX + up.x * ascent * size, y: startY + up.y * ascent * size },
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** Rects covering text[start, end) (one per text item touched). */
export function matchRects(index: PageTextIndex, items: TextItemLike[], start: number, end: number, measure: MeasureFn = charMeasure): Rect[] {
  const spans = new Map<number, { s: number; e: number }>();
  for (let i = start; i < end && i < index.itemOf.length; i++) {
    const item = index.itemOf[i];
    if (item < 0) continue;
    const off = index.offsetOf[i];
    const span = spans.get(item);
    if (span) span.e = Math.max(span.e, off + 1);
    else spans.set(item, { s: off, e: off + 1 });
  }
  const rects: Rect[] = [];
  for (const [i, span] of spans) {
    const item = items[i];
    if (!item || item.width <= 0) continue;
    rects.push(itemRangeRect(item, span.s, span.e, measure));
  }
  return mergeLineRects(rects);
}

/** Merges rects that sit on the same line and touch/overlap horizontally. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => b.y - a.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 &&
      Math.abs(last.h - r.h) < Math.max(last.h, r.h) * 0.5 &&
      r.x <= last.x + last.w + Math.min(last.h, r.h) * 0.6
    ) {
      const x0 = Math.min(last.x, r.x);
      const y0 = Math.min(last.y, r.y);
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      out[out.length - 1] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else {
      out.push({ ...r });
    }
  }
  return out;
}
