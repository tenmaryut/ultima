/**
 * Pointer interaction on one page: creating objects with the drawing tools, selecting,
 * moving and resizing objects with the Select tool.
 */
import { useCallback, useRef, useState, type RefObject } from 'react';
import { t } from '../../../core/i18n';
import { annotBounds, keepsAspect, moveAnnot, newAnnotId, resizeAnnot } from '../annots';
import { editAnnots, selectionRects, useDoc } from '../context';
import {
  applyLinear,
  applyMatrix,
  invertMatrix,
  rectToScreen,
  screenRectToPdf,
  type Matrix,
  type Point,
  type Rotation,
  type ScreenRect,
} from '../geometry';
import { usePdfUi } from '../store';
import type { Annot, DocState, PageEntry, PageInfo } from '../types';
import { textCreation } from './TextEditor';
import { useAppStore } from '../../../core/store';
import {
  CLICK_TOOLS,
  constrain,
  createDate,
  createFromDrag,
  createImage,
  createInk,
  createNote,
  createStamp,
  createText,
  DRAG_TOOLS,
  markupFromRects,
  MARKUP_TOOLS,
} from './create';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2';

export type Preview =
  | { kind: 'box'; tool: string; rect: ScreenRect }
  | { kind: 'line'; tool: string; a: Point; b: Point }
  | { kind: 'ink'; points: Point[] }
  | null;

export interface PageGeometry {
  entry: PageEntry;
  info: PageInfo;
  rotation: Rotation;
  m: Matrix;
}

const DRAG_THRESHOLD = 3;

function author(): string {
  try {
    return localStorage.getItem('ultima-pdf-author') || 'Ultima';
  } catch {
    return 'Ultima';
  }
}

/** Creates text markup for the current DOM text selection (highlight / underline / strike / redact). */
export function markupSelection(history: ReturnType<typeof useDoc>, tool: 'highlight' | 'underline' | 'strike' | 'redact'): number {
  const parts = selectionRects();
  if (!parts.length) return 0;
  const style = usePdfUi.getState().style;
  const created: Annot[] = [];
  for (const part of parts) {
    if (tool === 'redact') {
      for (const r of part.rects) created.push({ id: newAnnotId(), page: part.pageId, type: 'redact', rect: r });
    } else created.push(markupFromRects(tool, style, part.pageId, part.rects));
  }
  editAnnots(history, (list) => [...list, ...created], tool === 'redact' ? 'Mark for redaction' : 'Markup text');
  window.getSelection()?.removeAllRanges();
  return created.length;
}

export function usePageInteractions(geom: PageGeometry, pageRef: RefObject<HTMLDivElement | null>) {
  const history = useDoc();
  const [preview, setPreview] = useState<Preview>(null);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const historyRef = useRef(history);
  historyRef.current = history;

  const toLocal = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = pageRef.current?.getBoundingClientRect();
      return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
    },
    [pageRef],
  );
  const toUser = (p: Point) => applyMatrix(invertMatrix(geomRef.current.m), p.x, p.y);

  const addAnnot = (a: Annot, label: string, select = true) => {
    editAnnots(historyRef.current, (list) => [...list, a], label);
    if (select) usePdfUi.getState().set({ selection: [a.id] });
  };

  /** Pointer down anywhere on the page (bubbles up from layers). */
  const onPagePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const ui = usePdfUi.getState();
    const tool = ui.tool;
    const target = e.target as Element;
    if (tool === 'hand') return;
    if (tool === 'select') {
      if (!target.closest('[data-annot-id],[data-handle],.pd-field,.pd-popup,.pd-text-editor') && ui.selection.length) ui.set({ selection: [] });
      return;
    }
    if (MARKUP_TOOLS.includes(tool) && target.closest('.pd-textlayer span')) {
      // Text under the pointer: let the browser select it, then mark the selection up.
      const up = () => {
        window.removeEventListener('pointerup', up);
        setTimeout(() => markupSelection(historyRef.current, tool as 'highlight' | 'underline' | 'strike'), 0);
      };
      window.addEventListener('pointerup', up);
      return;
    }
    e.preventDefault();
    const start = toLocal(e);
    const g = geomRef.current;
    const style = ui.style;
    const pageId = g.entry.id;

    if (tool === 'ink') {
      const points: Point[] = [start];
      setPreview({ kind: 'ink', points: [...points] });
      const move = (ev: PointerEvent) => {
        const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [ev];
        for (const ce of events.length ? events : [ev]) points.push(toLocal(ce));
        setPreview({ kind: 'ink', points: [...points] });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setPreview(null);
        const flat = points.flatMap((p) => {
          const u = toUser(p);
          return [u.x, u.y];
        });
        const a = createInk(style, pageId, flat);
        if (a) addAnnot(a, 'Draw', false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    let moved = false;
    let current = start;
    const isDrag = DRAG_TOOLS.includes(tool) || tool === 'text';
    const move = (ev: PointerEvent) => {
      let p = toLocal(ev);
      if (Math.hypot(p.x - start.x, p.y - start.y) > DRAG_THRESHOLD) moved = true;
      if (!moved || !isDrag) return;
      if (ev.shiftKey && tool !== 'text') p = constrain(tool, start, p);
      current = p;
      if (tool === 'line' || tool === 'arrow') setPreview({ kind: 'line', tool, a: start, b: p });
      else
        setPreview({
          kind: 'box',
          tool,
          rect: { left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) },
        });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreview(null);
      const st = usePdfUi.getState();
      const a = toUser(start);
      if (moved && DRAG_TOOLS.includes(tool)) {
        const obj = createFromDrag(tool, st.style, pageId, a, toUser(current));
        if (obj) addAnnot(obj, tool === 'redact' ? 'Mark for redaction' : 'Add shape', false);
        return;
      }
      if (!CLICK_TOOLS.includes(tool)) return;
      const rot = g.rotation;
      const locale = useAppStore.getState().language === 'id' ? 'id-ID' : undefined;
      if (tool === 'text') {
        let obj;
        if (moved) {
          // dragged box: fixed wrap width, origin at the visual top-left of the drag
          const pxPerPt = Math.hypot(g.m[0], g.m[1]) || 1;
          const width = Math.max(st.style.fontSize * 2, Math.abs(current.x - start.x) / pxPerPt);
          obj = createText(st.style, pageId, toUser({ x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) }), rot, '', width);
        } else obj = createText(st.style, pageId, a, rot, '');
        textCreation.id = obj.id;
        textCreation.base = historyRef.current.present;
        editAnnots(historyRef.current, (list) => [...list, obj], 'Add text', false);
        st.set({ selection: [obj.id], editing: obj.id, tool: 'select' });
        return;
      }
      if (tool === 'note') {
        const obj = createNote(st.style, pageId, a, rot, author());
        addAnnot(obj, 'Add note');
        st.set({ editing: obj.id, tool: 'select' });
        return;
      }
      if (tool === 'date') {
        addAnnot(createDate(st.style, pageId, a, rot, locale), 'Add date');
        st.set({ tool: 'select' });
        return;
      }
      if (tool === 'stamp') {
        addAnnot(createStamp(st.style, pageId, a, rot, t), 'Add stamp');
        st.set({ tool: 'select' });
        return;
      }
      if ((tool === 'image' || tool === 'signature') && st.pending) {
        addAnnot(createImage(pageId, a, rot, g.info.view, { ...st.pending }), st.pending.kind === 'signature' ? 'Add signature' : 'Add image');
        st.set({ tool: 'select', pending: null });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Pointer down on an object with the Select tool: select and move. */
  const onObjectPointerDown = (e: React.PointerEvent, a: Annot) => {
    if (e.button !== 0) return;
    const ui = usePdfUi.getState();
    if (ui.tool !== 'select' || ui.editing === a.id) return;
    e.stopPropagation();
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    let selection = ui.selection;
    if (e.shiftKey) selection = selection.includes(a.id) ? selection.filter((id) => id !== a.id) : [...selection, a.id];
    else if (!selection.includes(a.id)) selection = [a.id];
    ui.set({ selection });
    if (!selection.includes(a.id)) return;
    const h = historyRef.current;
    const startDoc: DocState = h.present;
    const ids = new Set(selection);
    const start = { x: e.clientX, y: e.clientY };
    const inv = invertMatrix(geomRef.current.m);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      const d = applyLinear(inv, dx, dy);
      h.set({ ...startDoc, annots: startDoc.annots.map((x) => (ids.has(x.id) && x.page === a.page ? moveAnnot(x, d.x, d.y) : x)) }, { record: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) historyRef.current.commit('Move');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Resizing with a selection handle (screen space), or moving a line end point. */
  const onHandlePointerDown = (e: React.PointerEvent, a: Annot, handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const h = historyRef.current;
    const startDoc = h.present;
    const m = geomRef.current.m;
    const inv = invertMatrix(m);
    const box = rectToScreen(m, annotBounds(a));
    const start = { x: e.clientX, y: e.clientY };
    const aspect = box.width / Math.max(1, box.height);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 2) return;
      moved = true;
      let next: Annot;
      if ((handle === 'p1' || handle === 'p2') && (a.type === 'line' || a.type === 'arrow')) {
        const d = applyLinear(inv, dx, dy);
        next = handle === 'p1' ? { ...a, x1: a.x1 + d.x, y1: a.y1 + d.y } : { ...a, x2: a.x2 + d.x, y2: a.y2 + d.y };
      } else {
        let left = box.left;
        let top = box.top;
        let right = box.left + box.width;
        let bottom = box.top + box.height;
        if (handle.includes('w')) left += dx;
        if (handle.includes('e')) right += dx;
        if (handle.includes('n')) top += dy;
        if (handle.includes('s')) bottom += dy;
        if (keepsAspect(a) && handle.length === 2 && !ev.shiftKey) {
          const w = Math.max(4, right - left);
          const hgt = w / aspect;
          if (handle.includes('n')) top = bottom - hgt;
          else bottom = top + hgt;
        }
        const rect = screenRectToPdf(m, {
          left: Math.min(left, right),
          top: Math.min(top, bottom),
          width: Math.max(4, Math.abs(right - left)),
          height: Math.max(4, Math.abs(bottom - top)),
        });
        next = resizeAnnot(a, rect);
      }
      h.set({ ...startDoc, annots: startDoc.annots.map((x) => (x.id === a.id ? next : x)) }, { record: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) historyRef.current.commit('Resize');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return { preview, onPagePointerDown, onObjectPointerDown, onHandlePointerDown };
}
