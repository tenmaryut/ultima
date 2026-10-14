import { useRef, useState, type RefObject } from 'react';
import type { ViewportApi } from '../../../core/viewport';
import {
  boundingBox,
  handlePosition,
  mapRect,
  panFocal,
  imagePlacement,
  pointInRect,
  rectCenter,
  rectFromPoints,
  rectsIntersect,
  resizeRect,
  rotatePoint,
  rotationFromPointer,
  normalizeAngle,
  HANDLES,
  type Handle,
} from '../geometry';
import { createImageFrame, createShapeFrame, createTableFrame, createTextFrame } from '../model';
import { addFrames, duplicateFrames, frameBox, getFrames, moveFramesToPage, pageGeometry, selectionBounds, updateFrames, updatePage } from '../ops';
import { buildObjectTargets, buildPageTargets, guidesForEdges, snapMove, snapValue, type SnapGuide, type SnapTarget } from '../snapping';
import { resolveTextStyle } from '../styles';
import { MASTER_ID, type Frame, type ImageFrame, type LayoutDoc, type Point, type Rect } from '../types';
import type { LayoutEditor, Tool } from '../useLayoutEditor';
import { isLeftPage, mirrorFrame } from '../vnode';
import { slotAt, nearestSlot, type PageSlot, type WorldLayout } from './world';

export const RULER = 20;
const HANDLE_HIT = 7;
const ROTATE_OFFSET = 24;

type Session =
  | { kind: 'move'; slot: PageSlot; ids: string[]; start: Point; origin: LayoutDoc; startBox: Rect; targets: SnapTarget[]; dup: boolean; started: boolean }
  | { kind: 'resize'; slot: PageSlot; ids: string[]; handle: Handle; origin: LayoutDoc; startBox: Rect; single: Frame | null; targets: SnapTarget[] }
  | { kind: 'rotate'; slot: PageSlot; ids: string[]; origin: LayoutDoc; center: Point; startAngle: number }
  | { kind: 'marquee'; slot: PageSlot; start: Point; current: Point; base: string[] }
  | { kind: 'create'; tool: Tool; slot: PageSlot; start: Point; current: Point; targets: SnapTarget[] }
  | { kind: 'guide'; slot: PageSlot; axis: 'x' | 'y'; index: number; origin: LayoutDoc }
  | { kind: 'content'; slot: PageSlot; id: string; start: Point; origin: LayoutDoc };

export interface Transient {
  guides: SnapGuide[];
  marquee: Rect | null;
  create: { rect: Rect; tool: Tool; line?: { a: Point; b: Point } } | null;
  hover: string | null;
  guideDrag: { axis: 'x' | 'y'; value: number } | null;
}

const EMPTY: Transient = { guides: [], marquee: null, create: null, hover: null, guideDrag: null };

export interface InteractionDeps {
  ed: LayoutEditor;
  vp: ViewportApi;
  world: WorldLayout;
  containerRef: RefObject<HTMLDivElement | null>;
  onPickImage: (frameId: string) => void;
}

/** Frames as drawn on a page (master items mirrored on left pages are not hit-testable). */
export function hitTest(frames: Frame[], p: Point, zoom: number): Frame | null {
  const tol = 3 / zoom;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f.hidden || f.locked) continue;
    if (pointInRect(p, f, f.rotation, tol)) return f;
  }
  return null;
}

export function useCanvasInteraction({ ed, vp, world, containerRef, onPickImage }: InteractionDeps) {
  const session = useRef<Session | null>(null);
  const [t, setT] = useState<Transient>(EMPTY);
  const patchT = (p: Partial<Transient>) => setT((prev) => ({ ...prev, ...p }));

  const zoom = vp.zoom;
  const containerPoint = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const toWorld = (e: { clientX: number; clientY: number }) => vp.screenToDoc(e.clientX, e.clientY);
  const local = (w: Point, slot: PageSlot) => ({ x: w.x - slot.x, y: w.y - slot.y });
  const toScreen = (slot: PageSlot, p: Point) => vp.docToScreen(slot.x + p.x, slot.y + p.y);
  const currentSlot = () => world.slots.find((s) => s.id === ed.pageId) ?? world.slots[0];

  const snapTargets = (doc: LayoutDoc, slot: PageSlot, exclude: string[]): SnapTarget[] => {
    if (!ed.view.snap) return [];
    const page = pageGeometry(doc, slot.id);
    const others = getFrames(doc, slot.id).filter((f) => !exclude.includes(f.id) && !f.hidden);
    const master =
      slot.id !== MASTER_ID && page.applyMaster
        ? doc.master.frames.map((f) => (doc.mirrorMaster && isLeftPage(doc, slot.index) ? mirrorFrame(f, page.width) : f))
        : [];
    return [...buildPageTargets(page, ed.view.bleed ? doc.bleed : 0), ...buildObjectTargets([...others, ...master].map(frameBox))];
  };

  /** Selection handle under the pointer (screen space). */
  const handleAt = (sp: Point): { handle: Handle | 'rotate'; ids: string[] } | null => {
    const slot = currentSlot();
    const sel = ed.selected.filter((f) => !f.locked && !f.hidden);
    if (!slot || !sel.length || ed.editing) return null;
    const single = sel.length === 1 ? sel[0] : null;
    const box = single ?? selectionBounds(sel, sel.map((f) => f.id));
    if (!box) return null;
    const rot = single ? single.rotation : 0;
    const center = toScreen(slot, rectCenter(box));
    const top = toScreen(slot, handlePosition(box, rot, 'n'));
    const len = Math.hypot(top.x - center.x, top.y - center.y) || 1;
    const knob = { x: top.x + ((top.x - center.x) / len) * ROTATE_OFFSET, y: top.y + ((top.y - center.y) / len) * ROTATE_OFFSET };
    const ids = sel.map((f) => f.id);
    if (Math.hypot(sp.x - knob.x, sp.y - knob.y) <= HANDLE_HIT + 1) return { handle: 'rotate', ids };
    for (const h of HANDLES) {
      const hp = toScreen(slot, handlePosition(box, rot, h));
      if (Math.hypot(sp.x - hp.x, sp.y - hp.y) <= HANDLE_HIT) return { handle: h, ids };
    }
    return null;
  };

  /** Ruler guide under the pointer on the current page. */
  const guideAt = (sp: Point): { axis: 'x' | 'y'; index: number } | null => {
    if (!ed.view.guides) return null;
    const slot = currentSlot();
    if (!slot || slot.id === MASTER_ID) return null;
    const page = ed.page;
    for (let i = 0; i < page.guides.x.length; i++) {
      const s = toScreen(slot, { x: page.guides.x[i], y: 0 });
      if (Math.abs(sp.x - s.x) <= 3) return { axis: 'x', index: i };
    }
    for (let i = 0; i < page.guides.y.length; i++) {
      const s = toScreen(slot, { x: 0, y: page.guides.y[i] });
      if (Math.abs(sp.y - s.y) <= 3) return { axis: 'y', index: i };
    }
    return null;
  };

  const framesOf = (slotId: string) => getFrames(ed.doc, slotId);

  /* -------------------------------- pointer down -------------------------------- */

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    if (vp.spaceHeld || ed.tool === 'hand') {
      vp.startPan(e);
      return;
    }
    const sp = containerPoint(e);
    // rulers create guides
    if (ed.view.rulers && (sp.x < RULER || sp.y < RULER) && ed.pageId !== MASTER_ID) {
      const axis = sp.y < RULER && sp.x >= RULER ? 'y' : sp.x < RULER && sp.y >= RULER ? 'x' : null;
      if (!axis) return;
      const slot = currentSlot();
      const doc = ed.current();
      const page = doc.pages.find((p) => p.id === slot.id);
      if (!page) return;
      const guides = { ...page.guides, [axis]: [...page.guides[axis], -99999] };
      ed.live(updatePage(doc, page.id, (p) => ({ ...p, guides })));
      session.current = { kind: 'guide', slot, axis, index: guides[axis].length - 1, origin: doc };
      el.setPointerCapture(e.pointerId);
      return;
    }
    if (ed.editing) ed.endEdit();
    const w = toWorld(e);
    el.setPointerCapture(e.pointerId);

    if (ed.tool !== 'select') {
      const slot = slotAt(world, w, 2000) ?? nearestSlot(world, w) ?? currentSlot();
      if (slot.id !== ed.pageId) ed.goToPage(slot.id);
      const doc = ed.current();
      const targets = snapTargets(doc, slot, []);
      const p = local(w, slot);
      const start = { x: snapValue(p.x, 'x', targets, 6 / zoom), y: snapValue(p.y, 'y', targets, 6 / zoom) };
      session.current = { kind: 'create', tool: ed.tool, slot, start, current: start, targets };
      return;
    }

    // linking text frames: next click on a text frame completes the link
    if (ed.linking) {
      const slot = slotAt(world, w) ?? currentSlot();
      const hit = hitTest(framesOf(slot.id), local(w, slot), zoom);
      if (hit && hit.type === 'text') {
        ed.linkTo(hit.id);
        if (slot.id !== ed.pageId) ed.goToPage(slot.id);
        ed.select([hit.id]);
      } else ed.setLinking(null);
      return;
    }

    const handle = handleAt(sp);
    if (handle) {
      const slot = currentSlot();
      const doc = ed.current();
      const sel = getFrames(doc, slot.id).filter((f) => handle.ids.includes(f.id));
      const single = sel.length === 1 ? sel[0] : null;
      const startBox = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : selectionBounds(sel, handle.ids)!;
      if (handle.handle === 'rotate') {
        const center = rectCenter(single ?? startBox);
        session.current = { kind: 'rotate', slot, ids: handle.ids, origin: doc, center, startAngle: rotationFromPointer(center, local(w, slot)) };
      } else {
        session.current = { kind: 'resize', slot, ids: handle.ids, handle: handle.handle, origin: doc, startBox, single, targets: snapTargets(doc, slot, handle.ids) };
      }
      return;
    }

    // image content panning mode
    if (ed.contentId) {
      const slot = currentSlot();
      const f = framesOf(slot.id).find((x) => x.id === ed.contentId);
      if (f && pointInRect(local(w, slot), f, f.rotation)) {
        session.current = { kind: 'content', slot, id: f.id, start: local(w, slot), origin: ed.current() };
        return;
      }
      ed.setContentId(null);
    }

    const slot = slotAt(world, w);
    if (slot) {
      const hit = hitTest(framesOf(slot.id), local(w, slot), zoom);
      if (hit) {
        if (slot.id !== ed.pageId) ed.goToPage(slot.id);
        const already = ed.selection.includes(hit.id) && slot.id === ed.pageId;
        if (e.shiftKey) {
          ed.select([hit.id], 'toggle');
          return;
        }
        let ids = already ? ed.selection : [hit.id];
        if (!already) {
          ed.select([hit.id]);
          ids = expandIds(ed.current(), slot.id, [hit.id]);
        }
        const doc = ed.current();
        const moving = getFrames(doc, slot.id).filter((f) => ids.includes(f.id) && !f.locked);
        if (!moving.length) return;
        const startBox = selectionBounds(moving, moving.map((f) => f.id))!;
        session.current = {
          kind: 'move',
          slot,
          ids: moving.map((f) => f.id),
          start: w,
          origin: doc,
          startBox,
          targets: snapTargets(doc, slot, moving.map((f) => f.id)),
          dup: e.altKey,
          started: false,
        };
        return;
      }
    }
    const guide = guideAt(sp);
    if (guide) {
      const s = currentSlot();
      session.current = { kind: 'guide', slot: s, axis: guide.axis, index: guide.index, origin: ed.current() };
      return;
    }
    // marquee on the page under the pointer (or the current page)
    const mslot = slot ?? currentSlot();
    if (mslot.id !== ed.pageId) ed.goToPage(mslot.id);
    const base = e.shiftKey && mslot.id === ed.pageId ? ed.selection : [];
    if (!e.shiftKey) ed.setSelection([]);
    const p = local(w, mslot);
    session.current = { kind: 'marquee', slot: mslot, start: p, current: p, base };
  };

  /* -------------------------------- pointer move -------------------------------- */

  const onPointerMove = (e: React.PointerEvent) => {
    const s = session.current;
    const w = toWorld(e);
    if (!s) {
      // hover feedback
      if (ed.tool === 'select' && !vp.spaceHeld) {
        const slot = slotAt(world, w);
        const hit = slot ? hitTest(framesOf(slot.id), local(w, slot), zoom) : null;
        const id = hit?.id ?? null;
        if (id !== t.hover) patchT({ hover: id });
      }
      return;
    }
    const noSnap = e.ctrlKey || e.metaKey;
    const thr = noSnap ? 0 : 6 / zoom;
    switch (s.kind) {
      case 'move': {
        let dx = w.x - s.start.x;
        let dy = w.y - s.start.y;
        if (!s.started) {
          if (Math.hypot(dx, dy) * zoom < 3) return;
          s.started = true;
          if (s.dup) {
            const r = duplicateFrames(s.origin, s.slot.id, s.ids, 0, 0, (id) => ed.flows.get(id)?.text);
            s.origin = r.doc;
            s.ids = r.ids;
            ed.setSelection(r.ids);
          }
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const box = { ...s.startBox, x: s.startBox.x + dx, y: s.startBox.y + dy };
        const snap = thr ? snapMove(box, s.targets, thr) : { dx: 0, dy: 0, guides: [] };
        if (e.shiftKey) {
          if (dy === 0) snap.dy = 0;
          if (dx === 0) snap.dx = 0;
        }
        const fx = dx + snap.dx;
        const fy = dy + snap.dy;
        ed.live(updateFrames(s.origin, s.slot.id, s.ids, (f) => ({ ...f, x: f.x + fx, y: f.y + fy })));
        patchT({ guides: snap.guides });
        break;
      }
      case 'resize': {
        const p = local(w, s.slot);
        const rotated = s.single?.rotation ?? 0;
        const corner = s.handle.length === 2;
        const keep = s.single ? e.shiftKey !== (s.single.type === 'image' && corner) : e.shiftKey;
        let pointer = p;
        const movesX = s.handle.includes('e') || s.handle.includes('w');
        const movesY = s.handle.includes('n') || s.handle.includes('s');
        if (!rotated && thr) {
          pointer = { x: movesX ? snapValue(p.x, 'x', s.targets, thr) : p.x, y: movesY ? snapValue(p.y, 'y', s.targets, thr) : p.y };
        }
        const box = resizeRect(s.startBox, rotated, s.handle, pointer, { keepAspect: keep, fromCenter: e.altKey, minSize: 2 / zoom });
        ed.live(
          updateFrames(s.origin, s.slot.id, s.ids, (f) => {
            if (s.single) return { ...f, ...box };
            const r = mapRect(f, s.startBox, box);
            return { ...f, ...r };
          }),
        );
        if (!rotated && thr) {
          const ex = movesX ? [s.handle.includes('e') ? box.x + box.w : box.x] : [];
          const ey = movesY ? [s.handle.includes('s') ? box.y + box.h : box.y] : [];
          patchT({ guides: guidesForEdges(box, s.targets, ex, ey) });
        }
        break;
      }
      case 'rotate': {
        const p = local(w, s.slot);
        const angle = rotationFromPointer(s.center, p);
        let delta = normalizeAngle(angle - s.startAngle);
        const startFrames = getFrames(s.origin, s.slot.id).filter((f) => s.ids.includes(f.id));
        if (e.shiftKey && startFrames.length === 1) delta = normalizeAngle(Math.round((startFrames[0].rotation + delta) / 15) * 15 - startFrames[0].rotation);
        else if (e.shiftKey) delta = Math.round(delta / 15) * 15;
        ed.live(
          updateFrames(s.origin, s.slot.id, s.ids, (f) => {
            const c = rotatePoint(rectCenter(f), s.center, delta);
            return { ...f, x: c.x - f.w / 2, y: c.y - f.h / 2, rotation: normalizeAngle(f.rotation + delta) };
          }),
        );
        break;
      }
      case 'marquee': {
        s.current = local(w, s.slot);
        const r = rectFromPoints(s.start, s.current);
        const hits = getFrames(ed.current(), s.slot.id)
          .filter((f) => !f.locked && !f.hidden && rectsIntersect(r, boundingBox(f, f.rotation)))
          .map((f) => f.id);
        ed.select([...new Set([...s.base, ...hits])], 'replace');
        patchT({ marquee: r });
        break;
      }
      case 'create': {
        const p = local(w, s.slot);
        let cur = { x: snapValue(p.x, 'x', s.targets, thr), y: snapValue(p.y, 'y', s.targets, thr) };
        if (s.tool === 'line') {
          if (e.shiftKey) {
            const a = Math.round(Math.atan2(cur.y - s.start.y, cur.x - s.start.x) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(cur.x - s.start.x, cur.y - s.start.y);
            cur = { x: s.start.x + Math.cos(a) * len, y: s.start.y + Math.sin(a) * len };
          }
          s.current = cur;
          patchT({ create: { rect: rectFromPoints(s.start, cur), tool: s.tool, line: { a: s.start, b: cur } } });
          break;
        }
        if (e.shiftKey) {
          const size = Math.max(Math.abs(cur.x - s.start.x), Math.abs(cur.y - s.start.y));
          cur = { x: s.start.x + Math.sign(cur.x - s.start.x || 1) * size, y: s.start.y + Math.sign(cur.y - s.start.y || 1) * size };
        }
        s.current = cur;
        patchT({ create: { rect: rectFromPoints(s.start, cur), tool: s.tool } });
        break;
      }
      case 'guide': {
        const p = local(w, s.slot);
        const value = s.axis === 'x' ? p.x : p.y;
        const snapped = thr ? snapValue(value, s.axis, snapTargets(s.origin, s.slot, []).filter((g) => g.kind !== 'guide'), thr) : value;
        ed.live(
          updatePage(s.origin, s.slot.id, (pg) => {
            const list = [...pg.guides[s.axis]];
            if (s.index >= list.length) list.push(snapped);
            else list[s.index] = snapped;
            return { ...pg, guides: { ...pg.guides, [s.axis]: list } };
          }),
        );
        patchT({ guideDrag: { axis: s.axis, value: snapped } });
        break;
      }
      case 'content': {
        const p = local(w, s.slot);
        const f = getFrames(s.origin, s.slot.id).find((x): x is ImageFrame => x.id === s.id && x.type === 'image');
        const asset = f?.assetId ? s.origin.assets[f.assetId] : undefined;
        if (!f || !asset) break;
        const d = rotatePoint({ x: p.x - s.start.x, y: p.y - s.start.y }, { x: 0, y: 0 }, -f.rotation);
        const place = imagePlacement(f.w, f.h, asset.width, asset.height, f.fit, f.focalX, f.focalY, f.zoom);
        const next = panFocal(place, f.w, f.h, f.focalX, f.focalY, f.flipX ? -d.x : d.x, d.y);
        ed.live(updateFrames(s.origin, s.slot.id, [f.id], (x) => ({ ...x, ...next })));
        break;
      }
    }
  };

  /* --------------------------------- pointer up --------------------------------- */

  const onPointerUp = (e: React.PointerEvent) => {
    const s = session.current;
    session.current = null;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    if (!s) return;
    setT((prev) => ({ ...EMPTY, hover: prev.hover }));
    switch (s.kind) {
      case 'move': {
        if (!s.started) {
          // plain click on a group member with Alt: select it alone
          return;
        }
        // dropped onto another page (continuous view)?
        const doc = ed.current();
        const moved = getFrames(doc, s.slot.id).filter((f) => s.ids.includes(f.id));
        const box = selectionBounds(moved, s.ids);
        if (box && s.slot.id !== MASTER_ID) {
          const c = rectCenter(box);
          const target = slotAt(world, { x: s.slot.x + c.x, y: s.slot.y + c.y });
          if (target && target.id !== s.slot.id && target.id !== MASTER_ID) {
            ed.live(moveFramesToPage(doc, s.slot.id, target.id, s.ids, s.slot.x - target.x, s.slot.y - target.y));
            ed.commit(s.dup ? 'Duplicate' : 'Move');
            ed.goToPage(target.id);
            ed.setSelection(s.ids);
            return;
          }
        }
        ed.commit(s.dup ? 'Duplicate' : 'Move');
        break;
      }
      case 'resize':
        ed.commit('Resize');
        break;
      case 'rotate':
        ed.commit('Rotate');
        break;
      case 'content':
        ed.commit('Move image');
        break;
      case 'guide': {
        const sp = containerPoint(e);
        const doc = ed.current();
        const outside = (s.axis === 'y' && sp.y < RULER) || (s.axis === 'x' && sp.x < RULER);
        if (outside) {
          ed.live(
            updatePage(doc, s.slot.id, (pg) => ({ ...pg, guides: { ...pg.guides, [s.axis]: pg.guides[s.axis].filter((_, i) => i !== s.index) } })),
          );
        }
        ed.commit(outside ? 'Remove guide' : 'Guide');
        break;
      }
      case 'marquee':
        break;
      case 'create':
        finishCreate(s);
        break;
    }
  };

  const finishCreate = (s: Extract<Session, { kind: 'create' }>) => {
    const doc = ed.current();
    const page = pageGeometry(doc, s.slot.id);
    const r = rectFromPoints(s.start, s.current);
    const tiny = Math.max(r.w, r.h) * zoom < 4;
    const short = Math.min(page.width, page.height);
    ed.setTool('select');
    if (s.tool === 'line') {
      const len = Math.hypot(s.current.x - s.start.x, s.current.y - s.start.y);
      const L = tiny ? short * 0.3 : len;
      const angle = tiny ? 0 : (Math.atan2(s.current.y - s.start.y, s.current.x - s.start.x) * 180) / Math.PI;
      const c = tiny ? { x: s.start.x + L / 2, y: s.start.y } : { x: (s.start.x + s.current.x) / 2, y: (s.start.y + s.current.y) / 2 };
      const h = Math.max(8, short * 0.01);
      const f = createShapeFrame({ shape: 'line', x: c.x - L / 2, y: c.y - h / 2, w: Math.max(1, L), h, stroke: '$0', strokeWidth: Math.max(1, short * 0.004), fill: '', rotation: angle, name: 'Line' });
      ed.insertFrames([f], s.slot.id, 'Add line');
      return;
    }
    const def = (w: number, h: number): Rect => (tiny ? { x: s.start.x, y: s.start.y, w, h } : r);
    switch (s.tool) {
      case 'text': {
        const body = resolveTextStyle({ styleId: 'body', overrides: {} }, doc.styles);
        const rect = def(Math.min(page.width * 0.5, body.fontSize * 24), body.fontSize * body.lineHeight * 2.2);
        const f = createTextFrame({ ...rect, text: '', styleId: 'body', name: 'Text' });
        ed.live(addFrames(doc, s.slot.id, [f]));
        ed.beginEdit(f.id, undefined, true, doc);
        return;
      }
      case 'rect':
      case 'ellipse': {
        const rect = def(short * 0.2, short * 0.2);
        const f = createShapeFrame({ ...rect, shape: s.tool, fill: s.tool === 'rect' ? '$2' : '$3', name: s.tool === 'rect' ? 'Rectangle' : 'Ellipse' });
        ed.insertFrames([f], s.slot.id, 'Add shape');
        return;
      }
      case 'image': {
        const rect = def(page.width * 0.4, page.height * 0.25);
        const f = createImageFrame({ ...rect, name: 'Image' });
        ed.insertFrames([f], s.slot.id, 'Add image frame');
        onPickImage(f.id);
        return;
      }
      case 'table': {
        const rect = def(page.width * 0.6, Math.max(120, short * 0.2));
        const body = resolveTextStyle({ styleId: 'body', overrides: {} }, doc.styles);
        const f = createTableFrame({ ...rect, fontSize: body.fontSize, name: 'Table' });
        ed.insertFrames([f], s.slot.id, 'Add table');
        return;
      }
    }
  };

  /* -------------------------------- double click -------------------------------- */

  const onDoubleClick = (e: React.MouseEvent) => {
    if (ed.tool !== 'select') return;
    const w = toWorld(e);
    const slot = slotAt(world, w);
    if (!slot) return;
    const p = local(w, slot);
    const hit = hitTest(framesOf(slot.id), p, zoom);
    if (!hit) return;
    if (hit.type === 'text') ed.beginEdit(hit.id);
    else if (hit.type === 'table') {
      const lp = rotatePoint(p, rectCenter(hit), -hit.rotation);
      const c = Math.max(0, Math.min(hit.cols - 1, Math.floor(((lp.x - hit.x) / hit.w) * hit.cols)));
      const r = Math.max(0, Math.min(hit.rows - 1, Math.floor(((lp.y - hit.y) / hit.h) * hit.rows)));
      ed.beginEdit(hit.id, [r, c]);
    } else if (hit.type === 'image') {
      if (!hit.assetId) onPickImage(hit.id);
      else ed.setContentId(ed.contentId === hit.id ? null : hit.id);
    }
  };

  const cursorFor = (e: { clientX: number; clientY: number } | null): string => {
    if (vp.spaceHeld || ed.tool === 'hand') return 'grab';
    if (ed.tool === 'text') return 'text';
    if (ed.tool !== 'select') return 'crosshair';
    if (ed.linking) return 'alias';
    if (!e) return 'default';
    const sp = containerPoint(e);
    if (ed.view.rulers && (sp.x < RULER || sp.y < RULER)) return sp.x < RULER ? 'ew-resize' : 'ns-resize';
    const h = handleAt(sp);
    if (h) {
      if (h.handle === 'rotate') return 'crosshair';
      const single = ed.selected.length === 1 ? ed.selected[0] : null;
      return cursorForHandle(h.handle, single?.rotation ?? 0);
    }
    if (ed.contentId && t.hover === ed.contentId) return 'move';
    if (t.hover) return 'move';
    const g = guideAt(sp);
    if (g) return g.axis === 'x' ? 'ew-resize' : 'ns-resize';
    return 'default';
  };

  return { transient: t, onPointerDown, onPointerMove, onPointerUp, onDoubleClick, cursorFor, toScreen, currentSlot };
}

function cursorForHandle(h: Handle, rotation: number): string {
  const order = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const steps = Math.round(normalizeAngle(rotation) / 45);
  const rotated = order[(((order.indexOf(h) + steps) % 8) + 8) % 8];
  return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[rotated]!;
}

function expandIds(doc: LayoutDoc, pageId: string, ids: string[]): string[] {
  const frames = getFrames(doc, pageId);
  const groups = new Set(frames.filter((f) => ids.includes(f.id) && f.groupId).map((f) => f.groupId));
  return frames.filter((f) => ids.includes(f.id) || (f.groupId && groups.has(f.groupId))).map((f) => f.id);
}

