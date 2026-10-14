/**
 * Document-wide text search (Find, AI "highlight") and text extraction helpers.
 */
import { engine } from './engine';
import { findInText, matchRects, type FindOptions } from './textgeom';
import type { FindMatch } from './store';
import type { PageEntry } from './types';

export async function searchDocument(
  pages: PageEntry[],
  query: string,
  options: FindOptions,
  onProgress?: (done: number, total: number, matches: FindMatch[]) => void,
  signal?: { cancelled: boolean },
  limit = 5000,
): Promise<FindMatch[]> {
  const out: FindMatch[] = [];
  if (!query.trim()) return out;
  for (let i = 0; i < pages.length; i++) {
    if (signal?.cancelled) return out;
    const entry = pages[i];
    let text;
    try {
      text = await engine.text(entry.src, entry.index);
    } catch {
      continue;
    }
    const found = findInText(text.index.text, query, options, limit - out.length);
    if (found.length) {
      const measure = engine.measureFor(text.styles);
      for (const m of found) out.push({ ...m, page: entry.id, rects: matchRects(text.index, text.items, m.start, m.end, measure) });
    }
    if (onProgress && (i % 10 === 9 || i === pages.length - 1)) onProgress(i + 1, pages.length, out.slice());
    if (out.length >= limit) break;
  }
  return out;
}

/** Text of every page in document order (1-based page numbers). */
export async function documentText(pages: PageEntry[], onProgress?: (done: number, total: number) => void, signal?: { cancelled: boolean }): Promise<{ page: number; text: string }[]> {
  const out: { page: number; text: string }[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (signal?.cancelled) break;
    out.push({ page: i + 1, text: await engine.pageText(pages[i].src, pages[i].index) });
    if (onProgress && (i % 5 === 4 || i === pages.length - 1)) onProgress(i + 1, pages.length);
  }
  return out;
}
