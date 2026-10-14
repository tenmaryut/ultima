import { nodeKey, parseNodeKey, type EditorCore } from '../editor';
import { hitTest, objectGeom, worldMatrix } from '../geometry';
import { apply, applyVec, invert, matrixScale, rectContainsPoint, type Pt } from '../matrix';
import { walkObjects, type PathObject, type VObject } from '../model';
import { insertNode, moveNodes, nearestSegment, setHandle, toggleSmooth, type NodeRef } from '../nodes';
import { findById, toPathObject, updateById } from '../ops';
import { snapPoint } from '../snap';
import { dragged, snapTargetsFor, type Gesture, type PointerInfo, type ToolCtx } from './common';
import { marqueeGesture, moveGesture } from './select';

export function isNodeEditable(o: VObject | null): boolean {
  return Boolean(o && (o.type === 'path' || o.type === 'rect' || o.type === 'ellipse' || o.type === 'polygon' || o.type === 'star' || o.type === 'line') && !o.locked);
}

/** Replaces shapes with equivalent paths (same id) so their points can be edited. */
function ensurePaths(objects: VObject[], ids: string[]): VObject[] {
  let out = objects;
  for (const id of ids) {
    const o = findById(out, id);
    if (o && o.type !== 'path') {
      const p = toPathObject(o);
      if (p) out = updateById(out, id, () => p);
    }
  }
  return out;
}

function groupRefs(keys: string[]): Map<string, NodeRef[]> {
  const map = new Map<string, NodeRef[]>();
  for (const k of keys) {
    const r = parseNodeKey(k);
    if (!r) continue;
    map.set(r.id, [...(map.get(r.id) ?? []), { sub: r.sub, idx: r.idx }]);
  }
  return map;
}

function nodeWorld(objects: VObject[], key: string): Pt | null {
  const r = parseNodeKey(key);
  if (!r) return null;
  const o = findById(objects, r.id);
  const wm = worldMatrix(objects, r.id);
  const g = o ? objectGeom(o) : null;
  const n = g?.subpaths[r.sub]?.nodes[r.idx];
  return n && wm ? apply(wm, n) : null;
}

function nodeDrag(ctx: ToolCtx, start: PointerInfo, key: string): Gesture {
  const core0 = ctx.core();
  const wasSelected = core0.nodeSel.includes(key);
  let keys = core0.nodeSel;
  if (!wasSelected) keys = start.shift ? [...keys, key] : [key];
  core0.setNodeSel(keys);
  const startDoc = core0.doc;
  const refs = groupRefs(keys);
  const ids = [...refs.keys()];
  if (!ids.every((id) => core0.selection.includes(id))) core0.setSelection([...new Set([...core0.selection, ...ids])]);
  const startNode = nodeWorld(startDoc.objects, key);
  const targets = snapTargetsFor(core0, new Set(ids));
  let base: VObject[] | null = null;
  let moved = false;
  return {
    move(p) {
      if (!moved && !dragged(start, p)) return;
      moved = true;
      const core = ctx.core();
      if (!base) base = ensurePaths(startDoc.objects, ids);
      let dx = p.world.x - start.world.x;
      let dy = p.world.y - start.world.y;
      let guides: ReturnType<typeof snapPoint>['guides'] = [];
      if (startNode && (core.viewOpts.smartGuides || core.viewOpts.snapToGrid)) {
        const s = snapPoint({ x: startNode.x + dx, y: startNode.y + dy }, targets, 5 * ctx.px());
        dx = s.x - startNode.x;
        dy = s.y - startNode.y;
        guides = s.guides;
      }
      let objects = base;
      for (const [id, list] of refs) {
        const wm = worldMatrix(objects, id);
        if (!wm) continue;
        const dl = applyVec(invert(wm), { x: dx, y: dy });
        objects = updateById(objects, id, (o) => (o.type === 'path' ? { ...o, geom: moveNodes(o.geom, list, dl.x, dl.y) } : o));
      }
      ctx.setOverlay({ guides });
      core.updateLive((d) => ({ ...d, objects }));
    },
    up() {
      ctx.setOverlay({ guides: [] });
      const core = ctx.core();
      if (moved) {
        core.commit('Move points');
        return;
      }
      const r = parseNodeKey(key);
      if (start.alt && r) {
        // Alt+click: convert between corner and smooth
        core.update((d) => {
          const objects = ensurePaths(d.objects, [r.id]);
          return { ...d, objects: updateById(objects, r.id, (o) => (o.type === 'path' ? { ...o, geom: toggleSmooth(o.geom, r) } : o)) };
        }, 'Convert point');
      } else if (start.shift && wasSelected) {
        core.setNodeSel(core.nodeSel.filter((k) => k !== key));
      } else if (!start.shift && wasSelected) core.setNodeSel([key]);
    },
  };
}

function handleDrag(ctx: ToolCtx, start: PointerInfo, key: string, kind: 'in' | 'out'): Gesture | null {
  const r = parseNodeKey(key);
  if (!r) return null;
  const startDoc = ctx.core().doc;
  let base: VObject[] | null = null;
  let moved = false;
  return {
    move(p) {
      if (!moved && !dragged(start, p)) return;
      moved = true;
      if (!base) base = ensurePaths(startDoc.objects, [r.id]);
      const wm = worldMatrix(base, r.id);
      if (!wm) return;
      const local = apply(invert(wm), p.world);
      const objects = updateById(base, r.id, (o) => (o.type === 'path' ? { ...o, geom: setHandle(o.geom, r, kind, local, p.alt) } : o));
      ctx.core().updateLive((d) => ({ ...d, objects }));
    },
    up() {
      if (moved) ctx.core().commit('Edit handle');
    },
  };
}

/** All editable leaf objects (visible, unlocked) with their world matrices. */
function editableLeaves(objects: VObject[]): VObject[] {
  const out: VObject[] = [];
  walkObjects(objects, (o, parents) => {
    if (parents.some((p) => !p.visible || p.locked)) return;
    if (o.visible && isNodeEditable(o)) out.push(o);
  });
  return out;
}

export function directDown(ctx: ToolCtx, p: PointerInfo): Gesture | null {
  const core = ctx.core();
  const el = p.target?.closest?.('[data-node]');
  if (el) {
    const key = el.getAttribute('data-node') ?? '';
    const kind = el.getAttribute('data-kind');
    if (kind === 'in' || kind === 'out') return handleDrag(ctx, p, key, kind);
    return nodeDrag(ctx, p, key);
  }
  const hit = hitTest(core.doc.objects, p.world, 4 * ctx.px());
  if (hit) {
    const leaf = hit[hit.length - 1];
    let ids = core.selection;
    if (!core.selection.includes(leaf.id)) {
      ids = p.shift ? [...core.selection, leaf.id] : [leaf.id];
      core.setSelection(ids);
      if (!p.shift) core.setNodeSel([]);
    }
    return moveGesture(ctx, p, ids, false);
  }
  const base = p.shift ? core.nodeSel : [];
  return marqueeGesture(
    ctx,
    p,
    (rect) => {
      const c = ctx.core();
      const keys: string[] = [];
      const ids = new Set<string>();
      for (const o of editableLeaves(c.doc.objects)) {
        const wm = worldMatrix(c.doc.objects, o.id);
        const g = objectGeom(o);
        if (!wm || !g) continue;
        g.subpaths.forEach((s, si) =>
          s.nodes.forEach((n, ni) => {
            if (rectContainsPoint(rect, apply(wm, n))) {
              keys.push(nodeKey(o.id, si, ni));
              ids.add(o.id);
            }
          }),
        );
      }
      c.setNodeSel([...new Set([...base, ...keys])]);
      c.setSelection(p.shift ? [...new Set([...c.selection, ...ids])] : [...ids]);
    },
    () => {
      if (!p.shift) {
        ctx.core().setSelection([]);
        ctx.core().setNodeSel([]);
      }
    },
  );
}

/** Finds a segment of a selected path near `p` (world) → for adding points. */
export function segmentAt(core: EditorCore, p: Pt, tolWorld: number): { id: string; sub: number; seg: number; t: number; point: Pt } | null {
  for (const id of core.selection) {
    const o = findById(core.doc.objects, id);
    if (!o || !isNodeEditable(o)) continue;
    const wm = worldMatrix(core.doc.objects, id);
    const g = objectGeom(o);
    if (!wm || !g) continue;
    const local = apply(invert(wm), p);
    const r = nearestSegment(g, local);
    if (r && r.dist * matrixScale(wm) <= tolWorld) return { id, sub: r.sub, seg: r.seg, t: r.t, point: apply(wm, r.point) };
  }
  return null;
}

/** Adds an anchor on the segment under `p` of a selected path. Returns true when done. */
export function addPointAt(core: EditorCore, p: Pt, tolWorld: number): boolean {
  const s = segmentAt(core, p, tolWorld);
  if (!s) return false;
  let newKey = '';
  core.update((d) => {
    const objects = ensurePaths(d.objects, [s.id]);
    return {
      ...d,
      objects: updateById(objects, s.id, (o) => {
        if (o.type !== 'path') return o;
        const r = insertNode(o.geom, s.sub, s.seg, s.t);
        newKey = nodeKey(o.id, s.sub, r.index);
        return { ...o, geom: r.geom } as PathObject;
      }),
    };
  }, 'Add point');
  if (newKey) core.setNodeSel([newKey]);
  return true;
}

/** Anchor under the cursor of a selected path (world tolerance). */
export function anchorAt(core: EditorCore, p: Pt, tolWorld: number): { id: string; sub: number; idx: number } | null {
  for (const id of core.selection) {
    const o = findById(core.doc.objects, id);
    if (!o || !isNodeEditable(o)) continue;
    const wm = worldMatrix(core.doc.objects, id);
    const g = objectGeom(o);
    if (!wm || !g) continue;
    for (let si = 0; si < g.subpaths.length; si++) {
      const nodes = g.subpaths[si].nodes;
      for (let ni = 0; ni < nodes.length; ni++) {
        const w = apply(wm, nodes[ni]);
        if (Math.hypot(w.x - p.x, w.y - p.y) <= tolWorld) return { id, sub: si, idx: ni };
      }
    }
  }
  return null;
}

