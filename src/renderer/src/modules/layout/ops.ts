import { uid } from '../../core/utils/id';
import { boundingBox, mapRect, unionRects } from './geometry';
import { createPage } from './model';
import { pruneOverrides, resolveTextStyle } from './styles';
import { MASTER_ID, type Frame, type LayoutDoc, type Page, type ParagraphStyle, type Rect, type TextFrame, type TextStyle } from './types';

/**
 * Immutable document operations. Every function returns a new document (or the same
 * object when nothing changed) so they plug straight into the undo history.
 */

export type IdSet = ReadonlySet<string> | readonly string[];
const has = (ids: IdSet, id: string) => (Array.isArray(ids) ? (ids as readonly string[]).includes(id) : (ids as ReadonlySet<string>).has(id));

export function getPage(doc: LayoutDoc, pageId: string): Page | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export function pageIndexOf(doc: LayoutDoc, pageId: string): number {
  return doc.pages.findIndex((p) => p.id === pageId);
}

export function getFrames(doc: LayoutDoc, pageId: string): Frame[] {
  if (pageId === MASTER_ID) return doc.master.frames;
  return getPage(doc, pageId)?.frames ?? [];
}

/** Page-like geometry for a page id (the master uses the first page's size). */
export function pageGeometry(doc: LayoutDoc, pageId: string): Page {
  if (pageId === MASTER_ID) {
    const first = doc.pages[0];
    return { ...first, id: MASTER_ID, frames: doc.master.frames, applyMaster: false };
  }
  return getPage(doc, pageId) ?? doc.pages[0];
}

export function updatePageFrames(doc: LayoutDoc, pageId: string, fn: (frames: Frame[]) => Frame[]): LayoutDoc {
  if (pageId === MASTER_ID) {
    const frames = fn(doc.master.frames);
    return frames === doc.master.frames ? doc : { ...doc, master: { ...doc.master, frames } };
  }
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (p.id !== pageId) return p;
    const frames = fn(p.frames);
    if (frames === p.frames) return p;
    changed = true;
    return { ...p, frames };
  });
  return changed ? { ...doc, pages } : doc;
}

export function updatePage(doc: LayoutDoc, pageId: string, fn: (page: Page) => Page): LayoutDoc {
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (p.id !== pageId) return p;
    const next = fn(p);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...doc, pages } : doc;
}

/** Copies only keys the frame already has (never id/type). */
export function applyPatch<F extends Frame>(frame: F, patch: Record<string, unknown>): F {
  let changed = false;
  const next = { ...frame } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id' || key === 'type' || !(key in frame) || value === undefined) continue;
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  return changed ? (next as F) : frame;
}

export function updateFrames(doc: LayoutDoc, pageId: string, ids: IdSet, fn: (f: Frame) => Frame): LayoutDoc {
  return updatePageFrames(doc, pageId, (frames) => {
    let changed = false;
    const out = frames.map((f) => {
      if (!has(ids, f.id)) return f;
      const n = fn(f);
      if (n !== f) changed = true;
      return n;
    });
    return changed ? out : frames;
  });
}

export function patchFrames(doc: LayoutDoc, pageId: string, ids: IdSet, patch: Record<string, unknown>): LayoutDoc {
  return updateFrames(doc, pageId, ids, (f) => applyPatch(f, patch));
}

export function addFrames(doc: LayoutDoc, pageId: string, frames: Frame[]): LayoutDoc {
  if (!frames.length) return doc;
  return updatePageFrames(doc, pageId, (list) => [...list, ...frames]);
}

/** Where a frame lives. */
export function locateFrame(doc: LayoutDoc, id: string): { pageId: string; frame: Frame } | null {
  const m = doc.master.frames.find((f) => f.id === id);
  if (m) return { pageId: MASTER_ID, frame: m };
  for (const p of doc.pages) {
    const f = p.frames.find((x) => x.id === id);
    if (f) return { pageId: p.id, frame: f };
  }
  return null;
}

/* --------------------------------- Threads --------------------------------- */

function textFrameMap(doc: LayoutDoc): Map<string, TextFrame> {
  const map = new Map<string, TextFrame>();
  for (const p of doc.pages) for (const f of p.frames) if (f.type === 'text') map.set(f.id, f);
  return map;
}

export function predecessorMap(doc: LayoutDoc): Map<string, string> {
  const pred = new Map<string, string>();
  for (const p of doc.pages) for (const f of p.frames) if (f.type === 'text' && f.nextId) pred.set(f.nextId, f.id);
  return pred;
}

/** Ids of the whole thread containing `id`, head first. */
export function threadOf(doc: LayoutDoc, id: string): string[] {
  const map = textFrameMap(doc);
  if (!map.has(id)) return [id];
  const pred = predecessorMap(doc);
  let head = id;
  const guard = new Set<string>([head]);
  while (pred.has(head)) {
    const p = pred.get(head)!;
    if (guard.has(p)) break;
    guard.add(p);
    head = p;
  }
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = head;
  while (cur && map.has(cur) && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    cur = map.get(cur)!.nextId;
  }
  return chain;
}

export function storyHead(doc: LayoutDoc, id: string): string {
  return threadOf(doc, id)[0] ?? id;
}

/** Expands ids so every thread is complete (style edits apply to the whole story). */
export function expandThreads(doc: LayoutDoc, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) for (const t of threadOf(doc, id)) out.add(t);
  return [...out];
}

/** Links `fromId` → `toId`. The target's text is appended to the story. */
export function linkFrames(doc: LayoutDoc, fromId: string, toId: string): LayoutDoc {
  if (fromId === toId) return doc;
  const map = textFrameMap(doc);
  const from = map.get(fromId);
  const to = map.get(toId);
  if (!from || !to) return doc;
  if (threadOf(doc, fromId).includes(toId)) return doc; // would create a cycle
  const pred = predecessorMap(doc);
  const head = storyHead(doc, fromId);
  const headFrame = map.get(head)!;
  const extra = to.text.trim() && !pred.has(toId) ? to.text : '';
  let next = doc;
  const oldPred = pred.get(toId);
  const oldNext = from.nextId;
  const setFrame = (d: LayoutDoc, id: string, fn: (f: TextFrame) => TextFrame) => {
    const loc = locateFrame(d, id);
    if (!loc) return d;
    return updateFrames(d, loc.pageId, [id], (f) => (f.type === 'text' ? fn(f) : f));
  };
  if (oldPred) next = setFrame(next, oldPred, (f) => ({ ...f, nextId: null }));
  // splice: from → to → (end of to's chain) → old next of from
  let tail = toId;
  const toChain = threadOf(next, toId);
  if (toChain.length) tail = toChain[toChain.length - 1];
  next = setFrame(next, fromId, (f) => ({ ...f, nextId: toId }));
  if (oldNext && oldNext !== toId) next = setFrame(next, tail, (f) => ({ ...f, nextId: oldNext }));
  next = setFrame(next, toId, (f) => ({ ...f, text: '', styleId: headFrame.styleId, overrides: { ...headFrame.overrides } }));
  if (extra) next = setFrame(next, head, (f) => ({ ...f, text: f.text ? `${f.text}\n${extra}` : extra }));
  return next;
}

/** Breaks the link after `id` (the following frames keep no text of this story). */
export function unlinkAfter(doc: LayoutDoc, id: string): LayoutDoc {
  const loc = locateFrame(doc, id);
  if (!loc || loc.frame.type !== 'text' || !loc.frame.nextId) return doc;
  return updateFrames(doc, loc.pageId, [id], (f) => (f.type === 'text' ? { ...f, nextId: null } : f));
}

/** Story text lives in the head frame. */
export function setStoryText(doc: LayoutDoc, frameId: string, text: string): LayoutDoc {
  const head = storyHead(doc, frameId);
  const loc = locateFrame(doc, head);
  if (!loc) return doc;
  return updateFrames(doc, loc.pageId, [head], (f) => (f.type === 'text' && f.text !== text ? { ...f, text } : f));
}

export function storyText(doc: LayoutDoc, frameId: string): string {
  const loc = locateFrame(doc, storyHead(doc, frameId));
  return loc && loc.frame.type === 'text' ? loc.frame.text : '';
}

/* ----------------------------- Frame operations ----------------------------- */

/** Deletes frames; threads are re-linked around deleted frames and stories move to the new head. */
export function deleteFrames(doc: LayoutDoc, pageId: string, ids: IdSet): LayoutDoc {
  const del = new Set(Array.isArray(ids) ? ids : [...(ids as ReadonlySet<string>)]);
  if (!del.size) return doc;
  const map = textFrameMap(doc);
  const pred = predecessorMap(doc);
  const relink = new Map<string, string | null>();
  const moveText = new Map<string, string>();
  for (const id of del) {
    const f = map.get(id);
    if (!f) continue;
    let guard = 0;
    let after = f.nextId;
    while (after && del.has(after) && guard++ < 10_000) after = map.get(after)?.nextId ?? null;
    let before = pred.get(id) ?? null;
    while (before && del.has(before) && guard++ < 20_000) before = pred.get(before) ?? null;
    if (after && del.has(after)) after = null;
    if (before && del.has(before)) before = null;
    if (before) relink.set(before, after);
    else if (after) {
      const headFrame = map.get(storyHead(doc, id));
      if (headFrame) moveText.set(after, headFrame.text);
    }
  }
  const next = updatePageFrames(doc, pageId, (frames) => {
    const out = frames.filter((f) => !del.has(f.id));
    return out.length === frames.length ? frames : out;
  });
  const fix = (f: Frame): Frame => {
    if (f.type !== 'text') return f;
    let n = f;
    if (relink.has(f.id)) n = { ...n, nextId: relink.get(f.id) ?? null };
    else if (n.nextId && del.has(n.nextId)) n = { ...n, nextId: null };
    if (moveText.has(f.id)) n = { ...n, text: moveText.get(f.id)! };
    return n;
  };
  return {
    ...next,
    pages: next.pages.map((p) => {
      const frames = p.frames.map(fix);
      return frames.some((f, i) => f !== p.frames[i]) ? { ...p, frames } : p;
    }),
  };
}

/** Deep copies frames with fresh ids; group ids and threads inside the set are remapped. */
export function cloneFrames(frames: Frame[]): { frames: Frame[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  frames.forEach((f) => idMap.set(f.id, uid('f')));
  const out = frames.map((f) => {
    const copy = structuredClone(f) as Frame;
    copy.id = idMap.get(f.id)!;
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, uid('g'));
      copy.groupId = groupMap.get(copy.groupId)!;
    }
    if (copy.type === 'text') copy.nextId = copy.nextId ? (idMap.get(copy.nextId) ?? null) : null;
    return copy;
  });
  return { frames: out, idMap };
}

/**
 * Duplicates frames (offset by dx/dy). A copied continuation frame whose predecessor is not
 * copied becomes a new story holding `visibleText(id)` (the text it currently shows).
 */
export function duplicateFrames(
  doc: LayoutDoc,
  pageId: string,
  ids: readonly string[],
  dx = 16,
  dy = 16,
  visibleText?: (id: string) => string | undefined,
): { doc: LayoutDoc; ids: string[] } {
  const source = getFrames(doc, pageId).filter((f) => ids.includes(f.id));
  if (!source.length) return { doc, ids: [] };
  const { frames } = cloneFrames(source);
  const pred = pageId === MASTER_ID ? new Map<string, string>() : predecessorMap(doc);
  const out = frames.map((f, i) => {
    const moved = { ...f, x: f.x + dx, y: f.y + dy };
    if (moved.type !== 'text') return moved;
    const p = pred.get(source[i].id);
    if (p && !ids.includes(p)) return { ...moved, text: visibleText?.(source[i].id) ?? '' };
    return moved;
  });
  return { doc: addFrames(doc, pageId, out), ids: out.map((f) => f.id) };
}

export type ZOrderOp = 'front' | 'forward' | 'backward' | 'back';

export function reorderFrames(doc: LayoutDoc, pageId: string, ids: readonly string[], op: ZOrderOp): LayoutDoc {
  return updatePageFrames(doc, pageId, (frames) => reorderList(frames, ids, op));
}

export function reorderList<T extends { id: string }>(list: T[], ids: readonly string[], op: ZOrderOp): T[] {
  const sel = list.filter((f) => ids.includes(f.id));
  if (!sel.length) return list;
  const rest = list.filter((f) => !ids.includes(f.id));
  if (op === 'front') return [...rest, ...sel];
  if (op === 'back') return [...sel, ...rest];
  const out = [...list];
  if (op === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) {
      if (ids.includes(out[i].id) && !ids.includes(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (ids.includes(out[i].id) && !ids.includes(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out.every((f, i) => f === list[i]) ? list : out;
}

/** Moves frames (by id) to a given index in the z-order list. */
export function moveFrameToIndex(doc: LayoutDoc, pageId: string, id: string, index: number): LayoutDoc {
  return updatePageFrames(doc, pageId, (frames) => {
    const from = frames.findIndex((f) => f.id === id);
    if (from < 0) return frames;
    const out = frames.filter((f) => f.id !== id);
    const to = Math.max(0, Math.min(out.length, index));
    out.splice(to, 0, frames[from]);
    return out.every((f, i) => f === frames[i]) ? frames : out;
  });
}

export function moveFramesToPage(doc: LayoutDoc, fromId: string, toId: string, ids: readonly string[], dx: number, dy: number): LayoutDoc {
  if (fromId === toId || fromId === MASTER_ID || toId === MASTER_ID) return doc;
  const moving = getFrames(doc, fromId).filter((f) => ids.includes(f.id));
  if (!moving.length) return doc;
  let next = updatePageFrames(doc, fromId, (frames) => frames.filter((f) => !ids.includes(f.id)));
  next = addFrames(next, toId, moving.map((f) => ({ ...f, x: f.x + dx, y: f.y + dy })));
  return next;
}

export function groupFrames(doc: LayoutDoc, pageId: string, ids: readonly string[]): LayoutDoc {
  if (ids.length < 2) return doc;
  const gid = uid('g');
  return updateFrames(doc, pageId, ids, (f) => ({ ...f, groupId: gid }));
}

export function ungroupFrames(doc: LayoutDoc, pageId: string, ids: readonly string[]): LayoutDoc {
  return updateFrames(doc, pageId, ids, (f) => (f.groupId ? { ...f, groupId: null } : f));
}

/** Ids selected when clicking `id`: the whole group. */
export function expandGroups(frames: Frame[], ids: readonly string[]): string[] {
  const groups = new Set(frames.filter((f) => ids.includes(f.id) && f.groupId).map((f) => f.groupId));
  if (!groups.size) return [...ids];
  return frames.filter((f) => ids.includes(f.id) || (f.groupId && groups.has(f.groupId))).map((f) => f.id);
}

export function frameBox(f: Frame): Rect {
  return boundingBox(f, f.rotation);
}

export function selectionBounds(frames: Frame[], ids: readonly string[]): Rect | null {
  return unionRects(frames.filter((f) => ids.includes(f.id)).map(frameBox));
}

/* ---------------------------------- Pages ---------------------------------- */

export function addPage(doc: LayoutDoc, index: number, page?: Page): LayoutDoc {
  const ref = doc.pages[Math.max(0, Math.min(doc.pages.length - 1, index - 1))] ?? doc.pages[0];
  const p =
    page ??
    createPage(ref.width, ref.height, ref.preset, {
      margins: { ...ref.margins },
      columns: ref.columns,
      gutter: ref.gutter,
      background: ref.background,
      gradient: ref.gradient,
      applyMaster: ref.applyMaster,
    });
  const pages = [...doc.pages];
  pages.splice(Math.max(0, Math.min(pages.length, index)), 0, p);
  return { ...doc, pages };
}

export function duplicatePage(
  doc: LayoutDoc,
  pageId: string,
  visibleText?: (id: string) => string | undefined,
): { doc: LayoutDoc; pageId: string } {
  const index = pageIndexOf(doc, pageId);
  if (index < 0) return { doc, pageId };
  const src = doc.pages[index];
  const { frames } = cloneFrames(src.frames);
  const pred = predecessorMap(doc);
  // threads leaving the page are cut by cloneFrames; continuation frames whose story starts
  // on another page become new stories with the text they currently show
  const fixed = frames.map((f, i) => {
    if (f.type !== 'text') return f;
    const p = pred.get(src.frames[i].id);
    if (p && !src.frames.some((x) => x.id === p)) return { ...f, text: visibleText?.(src.frames[i].id) ?? '' };
    return f;
  });
  const page: Page = { ...src, id: uid('p'), frames: fixed, margins: { ...src.margins }, guides: { x: [...src.guides.x], y: [...src.guides.y] } };
  const pages = [...doc.pages];
  pages.splice(index + 1, 0, page);
  return { doc: { ...doc, pages }, pageId: page.id };
}

export function deletePage(doc: LayoutDoc, pageId: string): LayoutDoc {
  if (doc.pages.length <= 1) return doc;
  const page = getPage(doc, pageId);
  if (!page) return doc;
  const cleared = deleteFrames(doc, pageId, page.frames.map((f) => f.id));
  return { ...cleared, pages: cleared.pages.filter((p) => p.id !== pageId) };
}

export function movePage(doc: LayoutDoc, from: number, to: number): LayoutDoc {
  if (from === to || from < 0 || from >= doc.pages.length) return doc;
  const pages = [...doc.pages];
  const [p] = pages.splice(from, 1);
  pages.splice(Math.max(0, Math.min(pages.length, to)), 0, p);
  return { ...doc, pages };
}

/** Scales frames proportionally when a page is resized ("magic resize"). */
export function scaleFramesForResize(frames: Frame[], styles: ParagraphStyle[], oldW: number, oldH: number, newW: number, newH: number): Frame[] {
  const s = Math.min(newW / oldW, newH / oldH);
  const offX = (newW - oldW * s) / 2;
  const offY = (newH - oldH * s) / 2;
  const from: Rect = { x: 0, y: 0, w: oldW, h: oldH };
  const to: Rect = { x: offX, y: offY, w: oldW * s, h: oldH * s };
  return frames.map((f) => {
    const r = mapRect(f, from, to);
    const moved = { ...f, x: r.x, y: r.y, w: r.w, h: r.h };
    if (moved.type === 'text') {
      const eff = resolveTextStyle(moved, styles);
      return {
        ...moved,
        padding: moved.padding * s,
        columnGap: moved.columnGap * s,
        strokeWidth: moved.strokeWidth * s,
        radius: moved.radius * s,
        overrides: { ...moved.overrides, fontSize: Math.round(eff.fontSize * s * 10) / 10, spaceAfter: eff.spaceAfter * s },
      };
    }
    if (moved.type === 'table') return { ...moved, fontSize: moved.fontSize * s, cellPadding: moved.cellPadding * s };
    if (moved.type === 'shape' || moved.type === 'image') return { ...moved, strokeWidth: moved.strokeWidth * s, radius: moved.radius * s };
    return moved;
  });
}

export function setPageSize(
  doc: LayoutDoc,
  pageIds: readonly string[] | 'all',
  width: number,
  height: number,
  preset: string,
  scaleContent = false,
): LayoutDoc {
  const w = Math.max(10, Math.min(50_000, width));
  const h = Math.max(10, Math.min(50_000, height));
  const targets = pageIds === 'all' ? doc.pages.map((p) => p.id) : pageIds;
  const pages = doc.pages.map((p) => {
    if (!targets.includes(p.id)) return p;
    if (Math.abs(p.width - w) < 0.01 && Math.abs(p.height - h) < 0.01 && p.preset === preset) return p;
    const frames = scaleContent ? scaleFramesForResize(p.frames, doc.styles, p.width, p.height, w, h) : p.frames;
    const sx = w / p.width;
    const sy = h / p.height;
    return {
      ...p,
      width: w,
      height: h,
      preset,
      frames,
      guides: { x: p.guides.x.map((x) => x * sx), y: p.guides.y.map((y) => y * sy) },
      margins: {
        top: Math.min(p.margins.top, h / 2 - 1),
        bottom: Math.min(p.margins.bottom, h / 2 - 1),
        left: Math.min(p.margins.left, w / 2 - 1),
        right: Math.min(p.margins.right, w / 2 - 1),
      },
    };
  });
  let next: LayoutDoc = { ...doc, pages };
  // keep master items in proportion when the first page (master size) changes with scaling
  if (scaleContent && targets.includes(doc.pages[0].id)) {
    const p0 = doc.pages[0];
    next = { ...next, master: { frames: scaleFramesForResize(doc.master.frames, doc.styles, p0.width, p0.height, w, h) } };
  }
  return next;
}

/* --------------------------------- Styles ---------------------------------- */

export function applyParagraphStyle(doc: LayoutDoc, pageId: string, ids: readonly string[], styleId: string | null): LayoutDoc {
  const all = pageId === MASTER_ID ? ids : expandThreads(doc, ids);
  let next = doc;
  for (const id of all) {
    const loc = locateFrame(next, id);
    if (!loc) continue;
    next = updateFrames(next, loc.pageId, [id], (f) => (f.type === 'text' ? { ...f, styleId, overrides: {} } : f));
  }
  return next;
}

/** Sets text style properties on frames (as local overrides), across whole threads. */
export function setTextOverrides(doc: LayoutDoc, pageId: string, ids: readonly string[], patch: Partial<TextStyle>): LayoutDoc {
  const all = pageId === MASTER_ID ? ids : expandThreads(doc, ids);
  let next = doc;
  for (const id of all) {
    const loc = locateFrame(next, id);
    if (!loc) continue;
    next = updateFrames(next, loc.pageId, [id], (f) => {
      if (f.type !== 'text') return f;
      const baseStyle = resolveTextStyle({ styleId: f.styleId, overrides: {} }, doc.styles);
      return { ...f, overrides: pruneOverrides({ ...f.overrides, ...patch }, baseStyle) };
    });
  }
  return next;
}

export function updateParagraphStyle(doc: LayoutDoc, styleId: string, patch: Partial<TextStyle> & { name?: string }): LayoutDoc {
  const { name, ...stylePatch } = patch;
  return {
    ...doc,
    styles: doc.styles.map((s) => (s.id === styleId ? { ...s, name: name ?? s.name, style: { ...s.style, ...stylePatch } } : s)),
  };
}

export function addParagraphStyle(doc: LayoutDoc, name: string, style: TextStyle): { doc: LayoutDoc; id: string } {
  const id = uid('s');
  return { doc: { ...doc, styles: [...doc.styles, { id, name, style: { ...style } }] }, id };
}

/** Deleting a style keeps the look of frames using it (its values become overrides). */
export function deleteParagraphStyle(doc: LayoutDoc, styleId: string): LayoutDoc {
  const st = doc.styles.find((s) => s.id === styleId);
  if (!st) return doc;
  const bake = (f: Frame): Frame =>
    f.type === 'text' && f.styleId === styleId ? { ...f, styleId: null, overrides: { ...st.style, ...f.overrides } } : f;
  return {
    ...doc,
    styles: doc.styles.filter((s) => s.id !== styleId),
    master: { frames: doc.master.frames.map(bake) },
    pages: doc.pages.map((p) => (p.frames.some((f) => f.type === 'text' && f.styleId === styleId) ? { ...p, frames: p.frames.map(bake) } : p)),
  };
}

/** Counts frames using each paragraph style. */
export function styleUsage(doc: LayoutDoc): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of [...doc.master.frames, ...doc.pages.flatMap((p) => p.frames)]) {
    if (f.type === 'text' && f.styleId) out.set(f.styleId, (out.get(f.styleId) ?? 0) + 1);
  }
  return out;
}

/** Remove assets no frame references (keeps project files small). */
export function pruneAssets(doc: LayoutDoc): LayoutDoc {
  const used = new Set<string>();
  for (const f of [...doc.master.frames, ...doc.pages.flatMap((p) => p.frames)]) if (f.type === 'image' && f.assetId) used.add(f.assetId);
  const keys = Object.keys(doc.assets);
  if (keys.every((k) => used.has(k))) return doc;
  const assets: LayoutDoc['assets'] = {};
  for (const k of keys) if (used.has(k)) assets[k] = doc.assets[k];
  return { ...doc, assets };
}
