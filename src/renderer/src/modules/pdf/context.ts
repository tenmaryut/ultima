/**
 * Shared plumbing: the undoable document (React context) and a registry of the
 * rendered pages (DOM element + viewport matrix) used to convert DOM selections and
 * pointer positions into PDF coordinates.
 */
import { createContext, useContext } from 'react';
import type { HistoryState } from '../../core/history';
import { mergeLineRects } from './textgeom';
import { screenRectToPdf, type Matrix, type Rect } from './geometry';
import type { Annot, DocState } from './types';

export const DocContext = createContext<HistoryState<DocState> | null>(null);

export function useDoc(): HistoryState<DocState> {
  const value = useContext(DocContext);
  if (!value) throw new Error('PDF document context missing');
  return value;
}

/** Applies a change to the annotation list as one undo step (or a live update). */
export function editAnnots(history: HistoryState<DocState>, fn: (annots: Annot[]) => Annot[], label: string, record = true): void {
  history.set((d) => ({ ...d, annots: fn(d.annots) }), { record, label });
}

export interface RenderedPage {
  el: HTMLElement;
  m: Matrix;
  index: number;
}

/** Pages currently in the DOM, by PageEntry id. */
export const pageRegistry = new Map<string, RenderedPage>();

/** Converts the current DOM text selection into rectangles (user space) per page. */
export function selectionRects(): { pageId: string; rects: Rect[]; text: string }[] {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const all = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
  if (!all.length) return [];
  const heights = all.map((r) => r.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const rects = all.filter((r) => r.height <= median * 2.5);
  const out: { pageId: string; rects: Rect[]; text: string }[] = [];
  for (const [pageId, page] of pageRegistry) {
    const box = page.el.getBoundingClientRect();
    const local = rects
      .filter((r) => r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom)
      .map((r) => {
        const left = Math.max(r.left, box.left) - box.left;
        const top = Math.max(r.top, box.top) - box.top;
        const right = Math.min(r.right, box.right) - box.left;
        const bottom = Math.min(r.bottom, box.bottom) - box.top;
        return screenRectToPdf(page.m, { left, top, width: right - left, height: bottom - top });
      });
    if (local.length) out.push({ pageId, rects: mergeLineRects(local), text: '' });
  }
  if (out.length) out[0].text = sel.toString();
  return out;
}

/** True when the DOM selection lies inside a page's text layer. */
export function selectionInTextLayer(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el?.closest('.pd-textlayer');
}
