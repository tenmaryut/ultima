import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryState } from '../../core/history';
import { uid } from '../../core/utils/id';
import type { ViewMode } from './canvas/world';
import { alignOffsets, distributeOffsets, rectCenter, rotatePoint, type AlignKind } from './geometry';
import { frameForAsset } from './fileio';
import { clearMeasureCache, domMeasurer } from './measure';
import { createDoc, createTextFrame } from './model';
import {
  addFrames,
  addPage as addPageOp,
  applyParagraphStyle,
  deleteFrames,
  deletePage as deletePageOp,
  duplicateFrames,
  duplicatePage,
  expandGroups,
  frameBox,
  getFrames,
  groupFrames,
  linkFrames,
  locateFrame,
  movePage as movePageOp,
  pageGeometry,
  patchFrames,
  reorderFrames,
  selectionBounds,
  setPageSize,
  setStoryText,
  setTextOverrides,
  storyHead,
  storyText,
  ungroupFrames,
  unlinkAfter,
  updateFrames,
  updatePage,
  type ZOrderOp,
} from './ops';
import { pruneOverrides, resolveTextStyle } from './styles';
import { computeFlows, createFlowCache, masterOverflow } from './textflow';
import { MASTER_ID, type Frame, type ImageAsset, type LayoutDoc, type Page, type Point, type TextFrame, type TextStyle } from './types';

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line' | 'image' | 'table' | 'hand';

export interface ViewOptions {
  mode: ViewMode;
  guides: boolean;
  snap: boolean;
  rulers: boolean;
  bleed: boolean;
  edges: boolean;
}

export interface EditingState {
  id: string;
  pageId: string;
  /** Table cell being edited. */
  cell?: [number, number];
  /** Document before the edit started (restored when a new empty text frame is abandoned). */
  before: LayoutDoc;
  created: boolean;
}

export type SelectMode = 'replace' | 'toggle' | 'add';

export function useLayoutEditor() {
  const history = useHistoryState<LayoutDoc>(() => createDoc({ presetId: 'a4' }));
  const doc = history.present;
  const [pageIdState, setPageIdState] = useState(doc.pages[0].id);
  const [selectionState, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [contentId, setContentId] = useState<string | null>(null);
  const [view, setView] = useState<ViewOptions>({ mode: 'single', guides: true, snap: true, rulers: true, bleed: true, edges: true });
  const [savedPath, setSavedPath] = useState<string | undefined>();
  const [savedDoc, setSavedDoc] = useState<LayoutDoc>(doc);
  const [docKey, setDocKey] = useState(0);
  const [fontsVersion, setFontsVersion] = useState(0);
  const flowCache = useRef(createFlowCache());
  const nudgeTimer = useRef(0);

  // keep the current page valid (undo may remove it)
  const pageId = pageIdState === MASTER_ID || doc.pages.some((p) => p.id === pageIdState) ? pageIdState : doc.pages[0].id;
  const pageIndex = pageId === MASTER_ID ? -1 : doc.pages.findIndex((p) => p.id === pageId);
  const page = pageGeometry(doc, pageId);
  const frames = getFrames(doc, pageId);
  const selection = useMemo(() => selectionState.filter((id) => frames.some((f) => f.id === id)), [selectionState, frames]);
  const selected = useMemo(() => frames.filter((f) => selection.includes(f.id)), [frames, selection]);

  useEffect(() => {
    if (pageId !== pageIdState) setPageIdState(pageId);
  }, [pageId, pageIdState]);

  useEffect(() => {
    if (editing && !locateFrame(doc, editing.id)) setEditing(null);
  }, [doc, editing]);

  // fonts that finish loading change text metrics
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const onDone = () => {
      clearMeasureCache();
      flowCache.current = createFlowCache();
      setFontsVersion((v) => v + 1);
    };
    fonts.addEventListener('loadingdone', onDone);
    return () => fonts.removeEventListener('loadingdone', onDone);
  }, []);

  const deferred = useDeferredValue(doc);
  const flows = useMemo(
    () => computeFlows(deferred, domMeasurer, flowCache.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deferred.pages, deferred.styles, fontsVersion],
  );
  const masterFlows = useMemo(
    () => (pageId === MASTER_ID ? masterOverflow(deferred, domMeasurer) : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageId, deferred.master, deferred.styles, deferred.pages.length, fontsVersion],
  );

  /* -------------------------------- helpers -------------------------------- */

  // latest document, also between a set() and the next render
  const latest = useRef(doc);
  latest.current = doc;
  const set = (next: LayoutDoc, label: string) => {
    latest.current = next;
    history.set(next, { label });
  };
  const live = (next: LayoutDoc) => {
    latest.current = next;
    history.set(next, { record: false });
  };
  const commit = (label: string) => history.commit(label);
  const current = () => latest.current;

  const select = (ids: string[], mode: SelectMode = 'replace') => {
    const all = getFrames(current(), pageId);
    const expanded = expandGroups(all, ids);
    if (mode === 'replace') setSelection(expanded);
    else if (mode === 'add') setSelection((s) => [...new Set([...s, ...expanded])]);
    else {
      setSelection((s) => {
        const on = expanded.every((id) => s.includes(id));
        return on ? s.filter((id) => !expanded.includes(id)) : [...new Set([...s, ...expanded])];
      });
    }
  };

  const goToPage = (target: number | string) => {
    const d = current();
    const id = typeof target === 'number' ? d.pages[Math.max(0, Math.min(d.pages.length - 1, target))]?.id : target;
    if (!id || id === pageId) return;
    setPageIdState(id);
    setSelection([]);
    setEditing(null);
    setLinking(null);
    setContentId(null);
  };

  /* --------------------------------- frames -------------------------------- */

  const insertFrames = (newFrames: Frame[], targetPage = pageId, label = 'Add', assets?: Record<string, ImageAsset>) => {
    if (!newFrames.length) return;
    let d = current();
    if (assets && Object.keys(assets).length) d = { ...d, assets: { ...d.assets, ...assets } };
    set(addFrames(d, targetPage, newFrames), label);
    if (targetPage !== pageId) setPageIdState(targetPage);
    setSelection(newFrames.map((f) => f.id));
  };

  const deletable = () => selected.filter((f) => !f.locked).map((f) => f.id);

  const deleteSelection = () => {
    const ids = deletable();
    if (!ids.length) return;
    set(deleteFrames(current(), pageId, ids), 'Delete');
    setSelection([]);
  };

  const visibleText = (id: string) => flows.get(id)?.text;

  const duplicateSelection = (dx = 16, dy = 16) => {
    if (!selection.length) return;
    const r = duplicateFrames(current(), pageId, selection, dx, dy, visibleText);
    set(r.doc, 'Duplicate');
    setSelection(r.ids);
  };

  const patchSelection = (patch: Record<string, unknown>, label = 'Edit', record = true) => {
    if (!selection.length) return;
    const next = patchFrames(current(), pageId, selection, patch);
    if (record) set(next, label);
    else live(next);
  };

  const patchFrame = (id: string, patch: Record<string, unknown>, label = 'Edit', record = true) => {
    const loc = locateFrame(current(), id);
    if (!loc) return;
    const next = patchFrames(current(), loc.pageId, [id], patch);
    if (record) set(next, label);
    else live(next);
  };

  const nudge = (dx: number, dy: number) => {
    const ids = selected.filter((f) => !f.locked).map((f) => f.id);
    if (!ids.length) return;
    live(updateFrames(current(), pageId, ids, (f) => ({ ...f, x: f.x + dx, y: f.y + dy })));
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => commit('Nudge'), 450);
  };

  const reorder = (op: ZOrderOp) => selection.length && set(reorderFrames(current(), pageId, selection, op), 'Arrange');

  const align = (kind: AlignKind, toPage = false) => {
    const items = selected.filter((f) => !f.locked).map((f) => ({ id: f.id, box: frameBox(f) }));
    if (!items.length) return;
    const target = toPage || items.length === 1 ? { x: 0, y: 0, w: page.width, h: page.height } : selectionBounds(selected, selection)!;
    const offsets = alignOffsets(items, kind, target);
    set(
      updateFrames(current(), pageId, [...offsets.keys()], (f) => {
        const o = offsets.get(f.id)!;
        return o.x || o.y ? { ...f, x: f.x + o.x, y: f.y + o.y } : f;
      }),
      'Align',
    );
  };

  const distribute = (axis: 'x' | 'y') => {
    const items = selected.filter((f) => !f.locked).map((f) => ({ id: f.id, box: frameBox(f) }));
    const offsets = distributeOffsets(items, axis);
    set(
      updateFrames(current(), pageId, [...offsets.keys()], (f) => {
        const o = offsets.get(f.id)!;
        return o.x || o.y ? { ...f, x: f.x + o.x, y: f.y + o.y } : f;
      }),
      'Distribute',
    );
  };

  const rotateSelection = (deg: number) => {
    const box = selectionBounds(selected, selection);
    if (!box) return;
    const c = rectCenter(box);
    set(
      updateFrames(current(), pageId, selection, (f) => {
        const fc = rotatePoint(rectCenter(f), c, deg);
        return { ...f, x: fc.x - f.w / 2, y: fc.y - f.h / 2, rotation: ((f.rotation + deg + 540) % 360) - 180 };
      }),
      'Rotate',
    );
  };

  const group = () => selection.length > 1 && set(groupFrames(current(), pageId, selection), 'Group');
  const ungroup = () => selection.length && set(ungroupFrames(current(), pageId, selection), 'Ungroup');

  const toggleLock = (ids = selection) => {
    if (!ids.length) return;
    const all = getFrames(current(), pageId).filter((f) => ids.includes(f.id));
    const lock = !all.every((f) => f.locked);
    set(patchFrames(current(), pageId, ids, { locked: lock }), lock ? 'Lock' : 'Unlock');
    if (lock) setSelection((s) => s.filter((id) => !ids.includes(id)));
  };

  const toggleHidden = (id: string) => {
    const f = frames.find((x) => x.id === id);
    if (f) set(patchFrames(current(), pageId, [id], { hidden: !f.hidden }), f.hidden ? 'Show' : 'Hide');
  };

  /* ---------------------------------- text --------------------------------- */

  const textIds = () => selected.filter((f) => f.type === 'text').map((f) => f.id);

  const setTextStyle = (patch: Partial<TextStyle>, record = true) => {
    const ids = textIds();
    if (!ids.length) return;
    const next = setTextOverrides(current(), pageId, ids, patch);
    if (record) set(next, 'Text style');
    else live(next);
  };

  const applyStyle = (styleId: string | null) => {
    const ids = textIds();
    if (ids.length) set(applyParagraphStyle(current(), pageId, ids, styleId), 'Paragraph style');
  };

  const redefineStyle = (styleId: string) => {
    const f = selected.find((x): x is TextFrame => x.type === 'text');
    const st = current().styles.find((s) => s.id === styleId);
    if (!f || !st) return;
    const eff = resolveTextStyle(f, current().styles);
    let d: LayoutDoc = { ...current(), styles: current().styles.map((s) => (s.id === styleId ? { ...s, style: eff } : s)) };
    d = applyParagraphStyle(d, pageId, [f.id], styleId);
    set(d, 'Redefine style');
  };

  const clearOverrides = () => {
    const ids = textIds();
    if (ids.length) set(patchFrames(current(), pageId, ids, { overrides: {} }), 'Clear overrides');
  };

  const beginEdit = (id: string, cell?: [number, number], created = false, before?: LayoutDoc) => {
    const loc = locateFrame(current(), id);
    if (!loc || loc.frame.locked) return;
    setSelection([id]);
    setTool('select');
    setEditing({ id, pageId: loc.pageId, cell, before: before ?? current(), created });
  };

  const editText = (text: string) => {
    if (!editing) return;
    const d = current();
    const loc = locateFrame(d, editing.id);
    if (!loc) return;
    if (editing.cell && loc.frame.type === 'table') {
      const [r, c] = editing.cell;
      const cells = loc.frame.cells.map((row, ri) => (ri === r ? row.map((v, ci) => (ci === c ? text : v)) : row));
      live(patchFrames(d, loc.pageId, [editing.id], { cells }));
    } else if (loc.frame.type === 'text') {
      live(loc.pageId === MASTER_ID ? patchFrames(d, MASTER_ID, [editing.id], { text }) : setStoryText(d, editing.id, text));
    }
  };

  const endEdit = () => {
    if (!editing) return;
    const e = editing;
    setEditing(null);
    const loc = locateFrame(current(), e.id);
    if (e.created && loc && loc.frame.type === 'text' && !loc.frame.text.trim()) {
      live(e.before);
      setSelection([]);
      return;
    }
    commit(e.created ? 'Add text' : 'Edit text');
  };

  /** Replaces the text of a frame's story (one undo step). */
  const setText = (id: string, text: string) => {
    const d = current();
    const loc = locateFrame(d, id);
    if (!loc || loc.frame.type !== 'text') return;
    set(loc.pageId === MASTER_ID ? patchFrames(d, MASTER_ID, [id], { text }) : setStoryText(d, id, text), 'Edit text');
  };

  /** Text the inline editor shows for a frame (the whole story for threads). */
  const editableText = (id: string): string => {
    const loc = locateFrame(current(), id);
    if (!loc) return '';
    if (loc.frame.type === 'text') return loc.pageId === MASTER_ID ? loc.frame.text : storyText(current(), id);
    return '';
  };

  const startLink = (id: string) => setLinking(id);
  const linkTo = (targetId: string) => {
    if (!linking) return;
    const from = linking;
    setLinking(null);
    if (from === targetId) return;
    const next = linkFrames(current(), from, targetId);
    if (next === current()) return false;
    set(next, 'Link text frames');
    return true;
  };
  const unlink = (id: string) => set(unlinkAfter(current(), id), 'Unlink');

  /** Creates a frame for the overflow of `id` (next to it, or on the next page) and links it. */
  const addLinkedFrame = (id: string) => {
    const d = current();
    const loc = locateFrame(d, id);
    if (!loc || loc.frame.type !== 'text' || loc.pageId === MASTER_ID) return;
    const f = loc.frame;
    const p = d.pages.find((x) => x.id === loc.pageId)!;
    let target = p.id;
    let x = f.x + f.w + 16;
    let y = f.y;
    let next = d;
    if (x + f.w > p.width) {
      const idx = d.pages.indexOf(p);
      if (idx + 1 >= d.pages.length) next = addPageOp(next, idx + 1);
      target = next.pages[idx + 1].id;
      x = f.x;
      y = next.pages[idx + 1].margins.top;
    }
    const nf = { ...createTextFrame({ x, y, w: f.w, h: f.h, text: '' }), styleId: f.styleId, overrides: { ...f.overrides }, columns: f.columns, columnGap: f.columnGap, padding: f.padding };
    next = addFrames(next, target, [nf]);
    next = linkFrames(next, f.id, nf.id);
    set(next, 'Add linked frame');
    if (target !== pageId) goToPage(target);
    setSelection([nf.id]);
  };

  /* --------------------------------- tables -------------------------------- */

  const resizeTable = (id: string, rows: number, cols: number) => {
    const f = frames.find((x) => x.id === id);
    if (!f || f.type !== 'table') return;
    const r = Math.max(1, Math.min(100, rows));
    const c = Math.max(1, Math.min(30, cols));
    const cells = Array.from({ length: r }, (_, ri) => Array.from({ length: c }, (_, ci) => f.cells[ri]?.[ci] ?? ''));
    set(patchFrames(current(), pageId, [id], { rows: r, cols: c, cells }), 'Table size');
  };

  /* ---------------------------------- pages -------------------------------- */

  const addPage = (duplicate = false, after = pageIndex) => {
    const d = current();
    const at = Math.max(0, Math.min(d.pages.length - 1, after < 0 ? d.pages.length - 1 : after));
    if (duplicate) {
      const r = duplicatePage(d, d.pages[at].id, (id) => flows.get(id)?.text);
      set(r.doc, 'Duplicate page');
      goToPage(r.pageId);
    } else {
      const next = addPageOp(d, at + 1);
      set(next, 'Add page');
      goToPage(next.pages[at + 1].id);
    }
  };

  const deletePage = (index = pageIndex) => {
    const d = current();
    if (d.pages.length <= 1 || index < 0) return;
    const next = deletePageOp(d, d.pages[index].id);
    set(next, 'Delete page');
    goToPage(Math.min(index, next.pages.length - 1));
  };

  const movePage = (from: number, to: number) => {
    const next = movePageOp(current(), from, to);
    if (next !== current()) set(next, 'Move page');
  };

  const setPage = (patch: Partial<Page>, all = false, label = 'Page setup', record = true) => {
    const d = current();
    const ids = all ? d.pages.map((p) => p.id) : pageId === MASTER_ID ? [d.pages[0].id] : [pageId];
    let next = d;
    for (const id of ids) next = updatePage(next, id, (p) => ({ ...p, ...patch, frames: p.frames, id: p.id }));
    if (record) set(next, label);
    else live(next);
  };

  const resizePages = (width: number, height: number, preset: string, all: boolean, scaleContent: boolean) => {
    const d = current();
    const ids = all ? 'all' : [pageId === MASTER_ID ? d.pages[0].id : pageId];
    set(setPageSize(d, ids, width, height, preset, scaleContent), 'Page size');
  };

  const setDoc = (patch: Partial<LayoutDoc>, label = 'Document setup', record = true) => {
    const next = { ...current(), ...patch };
    if (record) set(next, label);
    else live(next);
  };

  /* --------------------------------- styles -------------------------------- */

  const addStyleFromSelection = (name: string) => {
    const f = selected.find((x): x is TextFrame => x.type === 'text');
    const style = f ? resolveTextStyle(f, current().styles) : resolveTextStyle({ styleId: 'body', overrides: {} }, current().styles);
    const id = uid('s');
    let d: LayoutDoc = { ...current(), styles: [...current().styles, { id, name, style }] };
    if (f) d = applyParagraphStyle(d, pageId, [f.id], id);
    set(d, 'New paragraph style');
    return id;
  };

  /* --------------------------------- images -------------------------------- */

  /** Places images: into the selected image frame (one image) or as new frames. */
  const placeAssets = (assets: ImageAsset[], at?: Point) => {
    if (!assets.length) return;
    const d = current();
    const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));
    const target = selected.length === 1 && selected[0].type === 'image' && assets.length === 1 && !selected[0].locked ? selected[0] : null;
    if (target) {
      set(patchFrames({ ...d, assets: { ...d.assets, ...assetMap } }, pageId, [target.id], { assetId: assets[0].id, focalX: 0.5, focalY: 0.5, zoom: 1 }), 'Place image');
      return;
    }
    const newFrames = assets.map((a, i) => {
      const f = frameForAsset(a, page, at);
      return { ...f, x: f.x + i * 24, y: f.y + i * 24 };
    });
    insertFrames(newFrames, pageId, 'Place image', assetMap);
  };

  /* ------------------------------- documents ------------------------------- */

  const resetDocument = (next: LayoutDoc, path?: string) => {
    latest.current = next;
    history.reset(next);
    setSavedDoc(next);
    setSavedPath(path);
    setPageIdState(next.pages[0].id);
    setSelection([]);
    setEditing(null);
    setLinking(null);
    setContentId(null);
    setTool('select');
    setDocKey((k) => k + 1);
    flowCache.current = createFlowCache();
  };

  const markSaved = (path?: string) => {
    setSavedDoc(current());
    if (path) setSavedPath(path);
  };

  const replaceDocument = (next: LayoutDoc, label: string) => {
    set(next, label);
    setPageIdState(next.pages[0].id);
    setSelection([]);
    setEditing(null);
  };

  /** Pending overrides of the first selected text frame vs its paragraph style. */
  const hasOverrides = (() => {
    const f = selected.find((x): x is TextFrame => x.type === 'text');
    if (!f) return false;
    const base = resolveTextStyle({ styleId: f.styleId, overrides: {} }, doc.styles);
    return Object.keys(pruneOverrides(f.overrides, base)).length > 0;
  })();

  return {
    history,
    doc,
    docKey,
    page,
    pageId,
    pageIndex,
    frames,
    selection,
    selected,
    tool,
    setTool,
    editing,
    linking,
    setLinking,
    contentId,
    setContentId,
    view,
    setView,
    flows,
    masterFlows,
    savedPath,
    dirty: doc !== savedDoc,
    hasOverrides,
    // state helpers
    set,
    live,
    commit,
    current,
    select,
    setSelection,
    goToPage,
    // frames
    insertFrames,
    deleteSelection,
    duplicateSelection,
    patchSelection,
    patchFrame,
    nudge,
    reorder,
    align,
    distribute,
    rotateSelection,
    group,
    ungroup,
    toggleLock,
    toggleHidden,
    // text
    setTextStyle,
    applyStyle,
    redefineStyle,
    clearOverrides,
    beginEdit,
    editText,
    endEdit,
    editableText,
    setText,
    startLink,
    linkTo,
    unlink,
    addLinkedFrame,
    storyHeadOf: (id: string) => storyHead(current(), id),
    resizeTable,
    // pages
    addPage,
    deletePage,
    movePage,
    setPage,
    resizePages,
    setDoc,
    addStyleFromSelection,
    placeAssets,
    // documents
    resetDocument,
    replaceDocument,
    markSaved,
  };
}

export type LayoutEditor = ReturnType<typeof useLayoutEditor>;
