import { hitTest, objectsInRect, selectionBounds, worldMatrix } from '../geometry';
import { IDENTITY, apply, chain, invert, normalizeRect, rotateAbout, scaleAbout, type Pt } from '../matrix';
import type { VObject } from '../model';
import { duplicateByIds, findById, moveByIds, topLevelSelection, transformByIds } from '../ops';
import { constrainAxis, snapPoint, snapRect } from '../snap';
import {
  dragged,
  handleFactors,
  handleLocal,
  selectionFrame,
  snapTargetsFor,
  type Gesture,
  type HandleId,
  type PointerInfo,
  type ToolCtx,
} from './common';

/** Objects that clicks can pick in the current scope (top level, or the entered group's children). */
export function scopeInfo(objects: VObject[], scope: string | null): { list: VObject[]; m: [number, number, number, number, number, number] } {
  if (scope) {
    const g = findById(objects, scope);
    const wm = worldMatrix(objects, scope);
    if (g && g.type === 'group' && wm) return { list: g.children, m: wm };
  }
  return { list: objects, m: IDENTITY };
}

/** Which object a click at `p` selects (respecting scope; `deep` picks the leaf). */
export function pickObject(ctx: ToolCtx, p: Pt, deep: boolean): string | null {
  const core = ctx.core();
  const tol = 4 * ctx.px();
  const { list, m } = scopeInfo(core.doc.objects, core.scope);
  const hit = hitTest(list, p, tol, m);
  if (hit) return deep ? hit[hit.length - 1].id : hit[0].id;
  if (core.scope) {
    // clicking outside the entered group leaves it
    const top = hitTest(core.doc.objects, p, tol);
    core.setScope(null);
    if (top) return deep ? top[top.length - 1].id : top[0].id;
  }
  return null;
}

export function moveGesture(ctx: ToolCtx, start: PointerInfo, ids: string[], duplicateOnAlt = true): Gesture {
  const core0 = ctx.core();
  const startDoc = core0.doc;
  let baseObjects = startDoc.objects;
  let movingIds = topLevelSelection(startDoc.objects, ids);
  const startBounds = selectionBounds(startDoc.objects, movingIds);
  const targets = snapTargetsFor(core0, new Set(movingIds));
  let moved = false;
  let duplicated = false;
  return {
    move(p) {
      if (!moved && !dragged(start, p)) return;
      const core = ctx.core();
      if (!moved && p.alt && duplicateOnAlt && !duplicated) {
        const dup = duplicateByIds(startDoc.objects, movingIds, 0, 0);
        baseObjects = dup.objects;
        movingIds = dup.ids;
        duplicated = true;
        core.setSelection(dup.ids);
      }
      moved = true;
      let dx = p.world.x - start.world.x;
      let dy = p.world.y - start.world.y;
      if (p.shift) ({ dx, dy } = constrainAxis(dx, dy));
      let guides: ReturnType<typeof snapRect>['guides'] = [];
      if (startBounds && (core.viewOpts.smartGuides || core.viewOpts.snapToGrid)) {
        const snapped = snapRect({ ...startBounds, x: startBounds.x + dx, y: startBounds.y + dy }, targets, 5 * ctx.px());
        const snapX = !p.shift || dy === 0;
        const snapY = !p.shift || dx === 0;
        if (snapX) dx += snapped.dx;
        if (snapY) dy += snapped.dy;
        guides = snapped.guides.filter((g) => (g.axis === 'x' ? snapX : snapY));
      }
      ctx.setOverlay({ guides });
      core.updateLive((d) => ({ ...d, objects: moveByIds(baseObjects, movingIds, dx, dy) }));
    },
    up() {
      ctx.setOverlay({ guides: [] });
      if (moved) ctx.core().commit(duplicated ? 'Duplicate' : 'Move');
    },
  };
}

export function resizeGesture(ctx: ToolCtx, start: PointerInfo, handle: HandleId): Gesture | null {
  const core0 = ctx.core();
  const frame = selectionFrame(core0.doc.objects, core0.selection);
  if (!frame) return null;
  const startDoc = core0.doc;
  const inv = invert(frame.m);
  const { fx, fy } = handleFactors(handle);
  const affectsX = fx !== 0.5;
  const affectsY = fy !== 0.5;
  const box = frame.box;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const h0 = handleLocal(box, handle);
  const axisAligned = Math.abs(frame.m[1]) < 1e-9 && Math.abs(frame.m[2]) < 1e-9;
  const targets = snapTargetsFor(core0, new Set(frame.ids));
  let moved = false;
  return {
    move(p) {
      if (!moved && !dragged(start, p)) return;
      moved = true;
      const core = ctx.core();
      let pw = p.world;
      let guides: ReturnType<typeof snapPoint>['guides'] = [];
      if (axisAligned && (core.viewOpts.smartGuides || core.viewOpts.snapToGrid)) {
        const s = snapPoint(pw, targets, 5 * ctx.px());
        pw = { x: affectsX ? s.x : pw.x, y: affectsY ? s.y : pw.y };
        guides = s.guides.filter((g) => (g.axis === 'x' ? affectsX : affectsY));
      }
      const local = apply(inv, pw);
      const anchor = p.alt ? center : { x: box.x + (1 - fx) * box.width, y: box.y + (1 - fy) * box.height };
      const dxBox = h0.x - anchor.x;
      const dyBox = h0.y - anchor.y;
      let sx = affectsX && Math.abs(dxBox) > 1e-9 ? (local.x - anchor.x) / dxBox : 1;
      let sy = affectsY && Math.abs(dyBox) > 1e-9 ? (local.y - anchor.y) / dyBox : 1;
      let ax = anchor.x;
      let ay = anchor.y;
      if (p.shift) {
        if (affectsX && affectsY) {
          const s = Math.max(Math.abs(sx), Math.abs(sy));
          sx = Math.sign(sx || 1) * s;
          sy = Math.sign(sy || 1) * s;
        } else if (affectsX) {
          sy = Math.abs(sx);
          ay = center.y;
        } else {
          sx = Math.abs(sy);
          ax = center.x;
        }
      }
      const clampS = (v: number) => (Math.abs(v) < 1e-3 ? (v < 0 ? -1e-3 : 1e-3) : v);
      const a = chain(frame.m, scaleAbout(clampS(sx), clampS(sy), ax, ay), inv);
      ctx.setOverlay({ guides });
      core.updateLive((d) => ({ ...d, objects: transformByIds(startDoc.objects, frame.ids, a) }));
    },
    up() {
      ctx.setOverlay({ guides: [] });
      if (moved) ctx.core().commit('Resize');
    },
  };
}

export function rotateGesture(ctx: ToolCtx, start: PointerInfo): Gesture | null {
  const core0 = ctx.core();
  const frame = selectionFrame(core0.doc.objects, core0.selection);
  if (!frame) return null;
  const startDoc = core0.doc;
  const c = apply(frame.m, { x: frame.box.x + frame.box.width / 2, y: frame.box.y + frame.box.height / 2 });
  const a0 = Math.atan2(start.world.y - c.y, start.world.x - c.x);
  let moved = false;
  return {
    move(p) {
      if (!moved && !dragged(start, p)) return;
      moved = true;
      let deg = ((Math.atan2(p.world.y - c.y, p.world.x - c.x) - a0) * 180) / Math.PI;
      if (p.shift) deg = Math.round(deg / 15) * 15;
      const a = rotateAbout(deg, c.x, c.y);
      ctx.core().updateLive((d) => ({ ...d, objects: transformByIds(startDoc.objects, frame.ids, a) }));
    },
    up() {
      if (moved) ctx.core().commit('Rotate');
    },
  };
}

export function marqueeGesture(ctx: ToolCtx, start: PointerInfo, onDone: (rect: { x: number; y: number; width: number; height: number }, p: PointerInfo) => void, onClick?: (p: PointerInfo) => void): Gesture {
  let active = false;
  return {
    move(p) {
      if (!active && !dragged(start, p)) return;
      active = true;
      ctx.setOverlay({ marquee: normalizeRect(start.world.x, start.world.y, p.world.x, p.world.y) });
    },
    up(p) {
      ctx.setOverlay({ marquee: null });
      if (active) onDone(normalizeRect(start.world.x, start.world.y, p.world.x, p.world.y), p);
      else onClick?.(p);
    },
    cancel() {
      ctx.setOverlay({ marquee: null });
    },
  };
}

/** Pointer down with the selection tool (handles are resolved by the caller). */
export function selectDown(ctx: ToolCtx, p: PointerInfo): Gesture | null {
  const core = ctx.core();
  const id = pickObject(ctx, p.world, p.mod);
  if (id) {
    const already = core.selection.includes(id);
    let ids: string[];
    if (p.shift) {
      ids = already ? core.selection.filter((s) => s !== id) : [...core.selection, id];
      core.setSelection(ids);
      if (already) return null;
    } else {
      ids = already ? core.selection : [id];
      if (!already) core.setSelection(ids);
    }
    const g = moveGesture(ctx, p, ids);
    return {
      move: g.move,
      up(e) {
        const wasDrag = dragged(p, e);
        g.up(e);
        // a plain click on an already selected object picks just that one
        if (!wasDrag && already && !p.shift && ctx.core().selection.length > 1) ctx.core().setSelection([id]);
      },
    };
  }
  if (!p.shift) core.setSelection([]);
  const base = p.shift ? core.selection : [];
  return marqueeGesture(
    ctx,
    p,
    (rect) => {
      const c = ctx.core();
      const { list, m } = scopeInfo(c.doc.objects, c.scope);
      const found = objectsInRect(list, rect, m);
      c.setSelection([...new Set([...base, ...found])]);
    },
    (e) => {
      // click on empty canvas: activate the artboard under the cursor
      const c = ctx.core();
      const ab = c.doc.artboards.find((a) => e.world.x >= a.x && e.world.x <= a.x + a.width && e.world.y >= a.y && e.world.y <= a.y + a.height);
      if (ab && ab.id !== c.doc.activeArtboard) c.updateLive((d) => ({ ...d, activeArtboard: ab.id }));
    },
  );
}
