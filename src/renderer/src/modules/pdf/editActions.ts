/**
 * Commands on selected annotation objects (delete, duplicate, nudge, restyle, z-order).
 */
import type { HistoryState } from '../../core/history';
import { duplicateAnnot, moveAnnot, relayoutText } from './annots';
import { pageRegistry } from './context';
import { applyLinear, invertMatrix } from './geometry';
import { usePdfUi } from './store';
import type { Annot, DocState } from './types';

type History = HistoryState<DocState>;

export function deleteSelection(history: History): boolean {
  const ids = new Set(usePdfUi.getState().selection);
  if (!ids.size) return false;
  history.set((d) => ({ ...d, annots: d.annots.filter((a) => !ids.has(a.id)) }), { label: 'Delete' });
  usePdfUi.getState().set({ selection: [], editing: null });
  return true;
}

export function duplicateSelection(history: History): boolean {
  const ids = new Set(usePdfUi.getState().selection);
  if (!ids.size) return false;
  const copies: Annot[] = history.present.annots.filter((a) => ids.has(a.id)).map((a) => duplicateAnnot(a, a.page));
  history.set((d) => ({ ...d, annots: [...d.annots, ...copies] }), { label: 'Duplicate' });
  usePdfUi.getState().set({ selection: copies.map((a) => a.id) });
  return true;
}

export function selectAllOnPage(history: History): void {
  const ui = usePdfUi.getState();
  const page = history.present.pages[ui.currentPage];
  if (!page) return;
  ui.set({ selection: history.present.annots.filter((a) => a.page === page.id).map((a) => a.id), tool: 'select' });
}

/** Moves the selection by screen pixels (arrow keys), converted to each page's PDF space. */
export function nudgeSelection(history: History, dx: number, dy: number): boolean {
  const ids = new Set(usePdfUi.getState().selection);
  if (!ids.size) return false;
  history.set(
    (d) => ({
      ...d,
      annots: d.annots.map((a) => {
        if (!ids.has(a.id)) return a;
        const page = pageRegistry.get(a.page);
        if (!page) return a;
        const inv = invertMatrix(page.m);
        const s = Math.hypot(page.m[0], page.m[1]) || 1;
        const delta = applyLinear(inv, dx * s, dy * s);
        return moveAnnot(a, delta.x, delta.y);
      }),
    }),
    { label: 'Move' },
  );
  return true;
}

/** Applies a property patch to every selected object that has those properties. */
export function updateSelected(history: History, patch: Record<string, unknown>, label = 'Change style', record = true): void {
  const ids = new Set(usePdfUi.getState().selection);
  if (!ids.size) return;
  history.set(
    (d) => ({
      ...d,
      annots: d.annots.map((a) => {
        if (!ids.has(a.id)) return a;
        const next = { ...a } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) if (k in next) next[k] = v;
        const out = next as unknown as Annot;
        return out.type === 'text' ? relayoutText(out) : out;
      }),
    }),
    { label, record },
  );
}

export function bringToFront(history: History, front: boolean): void {
  const ids = new Set(usePdfUi.getState().selection);
  if (!ids.size) return;
  history.set(
    (d) => {
      const sel = d.annots.filter((a) => ids.has(a.id));
      const rest = d.annots.filter((a) => !ids.has(a.id));
      return { ...d, annots: front ? [...rest, ...sel] : [...sel, ...rest] };
    },
    { label: front ? 'Bring to front' : 'Send to back' },
  );
}
