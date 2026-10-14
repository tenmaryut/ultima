import {
  boundsUnder,
  localBounds,
  normalizeObject,
  objectGeom,
  parentMatrix,
  selectionBounds,
  transformObject,
  worldMatrix,
} from './geometry';
import {
  IDENTITY,
  apply,
  chain,
  decompose,
  invert,
  multiply,
  rectCenter,
  rotate,
  rotateAbout,
  scale,
  scaleAbout,
  translate,
  type Matrix,
  type Pt,
  type Rect,
} from './matrix';
import {
  cloneWithNewIds,
  createGroup,
  createPath,
  defaultStroke,
  NONE,
  type GroupObject,
  type Paint,
  type PathObject,
  type Stroke,
  type TextObject,
  type VObject,
} from './model';
import { transformGeom } from './path';
import { objectToMultiPolygon, outlineStrokeGeom, polygonsToGeom, runPathfinder, type PathfinderOp } from './pathfinder';

/* ------------------------------- Tree updates ------------------------------ */

/** Maps a list, returning the same array when nothing changed (keeps memoization working). */
function mapList(list: VObject[], fn: (o: VObject) => VObject | null): VObject[] {
  let changed = false;
  const out: VObject[] = [];
  for (const o of list) {
    const next = fn(o);
    if (next !== o) changed = true;
    if (next) out.push(next);
  }
  return changed ? out : list;
}

/** Deep map over the tree; `fn` returns the replacement (or null to remove). */
export function mapTree(objects: VObject[], fn: (o: VObject) => VObject | null): VObject[] {
  return mapList(objects, (o) => {
    let cur: VObject = o;
    if (cur.type === 'group') {
      const children = mapTree(cur.children, fn);
      if (children !== cur.children) cur = { ...cur, children };
    }
    return fn(cur);
  });
}

export function updateById(objects: VObject[], id: string, fn: (o: VObject) => VObject): VObject[] {
  return mapTree(objects, (o) => (o.id === id ? fn(o) : o));
}

export function updateByIds(objects: VObject[], ids: Iterable<string>, fn: (o: VObject) => VObject): VObject[] {
  const set = new Set(ids);
  return mapTree(objects, (o) => (set.has(o.id) ? fn(o) : o));
}

export function removeByIds(objects: VObject[], ids: Iterable<string>): VObject[] {
  const set = new Set(ids);
  return mapTree(objects, (o) => {
    if (set.has(o.id)) return null;
    if (o.type === 'group' && o.children.length === 0) return null;
    return o;
  });
}

export interface Location {
  parentId: string | null;
  index: number;
  list: VObject[];
}

export function locate(objects: VObject[], id: string, parentId: string | null = null): Location | null {
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.id === id) return { parentId, index: i, list: objects };
    if (o.type === 'group') {
      const found = locate(o.children, id, o.id);
      if (found) return found;
    }
  }
  return null;
}

export function insertAt(objects: VObject[], parentId: string | null, index: number, items: VObject[]): VObject[] {
  if (parentId === null) {
    const out = objects.slice();
    out.splice(Math.max(0, Math.min(index, out.length)), 0, ...items);
    return out;
  }
  return updateById(objects, parentId, (g) => {
    if (g.type !== 'group') return g;
    const children = g.children.slice();
    children.splice(Math.max(0, Math.min(index, children.length)), 0, ...items);
    return { ...g, children };
  });
}

/** Ids in painting order (bottom → top, depth first). */
export function paintOrder(objects: VObject[], ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  const walk = (list: VObject[]) => {
    for (const o of list) {
      if (set.has(o.id)) out.push(o.id);
      if (o.type === 'group') walk(o.children);
    }
  };
  walk(objects);
  return out;
}

/** Drops ids that have a selected ancestor (and ids that no longer exist). */
export function topLevelSelection(objects: VObject[], ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  const walk = (list: VObject[], covered: boolean) => {
    for (const o of list) {
      const sel = set.has(o.id);
      if (sel && !covered) out.push(o.id);
      if (o.type === 'group') walk(o.children, covered || sel);
    }
  };
  walk(objects, false);
  return out;
}

export function findById(objects: VObject[], id: string): VObject | null {
  const loc = locate(objects, id);
  return loc ? loc.list[loc.index] : null;
}

/* -------------------------------- Transforms ------------------------------- */

/** Applies a world-space affine transform to the selected objects (nested ones included). */
export function transformByIds(objects: VObject[], ids: Iterable<string>, a: Matrix): VObject[] {
  const set = new Set(topLevelSelection(objects, ids));
  const rec = (list: VObject[], parentWorld: Matrix): VObject[] =>
    mapList(list, (o) => {
      if (set.has(o.id)) {
        const local = chain(invert(parentWorld), a, parentWorld);
        return transformObject(o, local);
      }
      if (o.type === 'group') {
        const children = rec(o.children, multiply(parentWorld, o.m));
        return children === o.children ? o : { ...o, children };
      }
      return o;
    });
  return rec(objects, IDENTITY);
}

export function moveByIds(objects: VObject[], ids: Iterable<string>, dx: number, dy: number): VObject[] {
  return transformByIds(objects, ids, translate(dx, dy));
}

export function flipByIds(objects: VObject[], ids: string[], axis: 'h' | 'v'): VObject[] {
  const b = selectionBounds(objects, ids);
  if (!b) return objects;
  const c = rectCenter(b);
  return transformByIds(objects, ids, axis === 'h' ? scaleAbout(-1, 1, c.x, c.y) : scaleAbout(1, -1, c.x, c.y));
}

export function rotateByIds(objects: VObject[], ids: string[], deg: number): VObject[] {
  const b = selectionBounds(objects, ids);
  if (!b) return objects;
  const c = rectCenter(b);
  return transformByIds(objects, ids, rotateAbout(deg, c.x, c.y));
}

/** Visual frame of an object: unrotated box (about its center) in world units + rotation. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export function getFrame(objects: VObject[], id: string): Frame | null {
  const o = findById(objects, id);
  const wm = worldMatrix(objects, id);
  if (!o || !wm) return null;
  const lb = localBounds(o);
  const d = decompose(wm);
  const w = lb.width * d.sx;
  const h = lb.height * d.sy;
  const c = apply(wm, { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 });
  return { x: c.x - w / 2, y: c.y - h / 2, w, h, rotation: d.rotation };
}

/** Moves/resizes/rotates one object so its frame matches `next` (fields left out stay). */
export function setFrame(objects: VObject[], id: string, next: Partial<Frame>): VObject[] {
  const f = getFrame(objects, id);
  if (!f) return objects;
  const t: Frame = { ...f, ...next };
  const c0: Pt = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  // keep the top-left of the unrotated box fixed when only the size changes
  const c1: Pt = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  const sx = f.w > 1e-9 ? Math.max(1e-6, t.w) / f.w : 1;
  const sy = f.h > 1e-9 ? Math.max(1e-6, t.h) / f.h : 1;
  const a = chain(translate(c1.x, c1.y), rotate(t.rotation), scale(sx, sy), rotate(-f.rotation), translate(-c0.x, -c0.y));
  return transformByIds(objects, [id], a);
}

/** Moves/scales several objects as one block so their union bounds become `next`. */
export function setSelectionBox(objects: VObject[], ids: string[], next: Partial<Rect>): VObject[] {
  const b = selectionBounds(objects, ids);
  if (!b) return objects;
  const t = { ...b, ...next };
  const sx = b.width > 1e-9 ? Math.max(1e-6, t.width) / b.width : 1;
  const sy = b.height > 1e-9 ? Math.max(1e-6, t.height) / b.height : 1;
  const a = chain(translate(t.x, t.y), scale(sx, sy), translate(-b.x, -b.y));
  return transformByIds(objects, ids, a);
}

/* --------------------------------- Arrange --------------------------------- */

export type ArrangeMode = 'forward' | 'backward' | 'front' | 'back';

function arrangeList(list: VObject[], set: Set<string>, mode: ArrangeMode): VObject[] {
  if (!list.some((o) => set.has(o.id))) return list;
  const out = list.slice();
  switch (mode) {
    case 'front':
      return [...out.filter((o) => !set.has(o.id)), ...out.filter((o) => set.has(o.id))];
    case 'back':
      return [...out.filter((o) => set.has(o.id)), ...out.filter((o) => !set.has(o.id))];
    case 'forward':
      for (let i = out.length - 2; i >= 0; i--) {
        if (set.has(out[i].id) && !set.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
      }
      return out;
    case 'backward':
      for (let i = 1; i < out.length; i++) {
        if (set.has(out[i].id) && !set.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
      }
      return out;
  }
}

export function arrangeByIds(objects: VObject[], ids: Iterable<string>, mode: ArrangeMode): VObject[] {
  const set = new Set(ids);
  const rec = (list: VObject[]): VObject[] => {
    const arranged = arrangeList(list, set, mode);
    return mapList(arranged, (o) => {
      if (o.type !== 'group') return o;
      const children = rec(o.children);
      return children === o.children ? o : { ...o, children };
    });
  };
  return rec(objects);
}

/** Moves an object to another parent/position keeping its world placement (layers drag & drop). */
export function moveObjectTo(objects: VObject[], id: string, targetParentId: string | null, index: number): VObject[] {
  const loc = locate(objects, id);
  if (!loc) return objects;
  const o = loc.list[loc.index];
  if (targetParentId === id) return objects;
  if (targetParentId && o.type === 'group' && findById(o.children, targetParentId)) return objects; // no cycles
  const wm = worldMatrix(objects, id) ?? o.m;
  let removed = removeByIds(objects, [id]);
  let idx = index;
  if (loc.parentId === targetParentId && loc.index < index) idx -= 1;
  const targetWorld = targetParentId ? worldMatrix(removed, targetParentId) : IDENTITY;
  if (targetParentId && !targetWorld) return objects;
  const moved = normalizeObject({ ...o, m: multiply(invert(targetWorld ?? IDENTITY), wm) });
  removed = insertAt(removed, targetParentId, idx, [moved]);
  return removed;
}

/* ---------------------------------- Groups --------------------------------- */

export function groupByIds(objects: VObject[], ids: string[], name = 'Group'): { objects: VObject[]; groupId: string } | null {
  const sel = paintOrder(objects, topLevelSelection(objects, ids));
  if (!sel.length) return null;
  const topId = sel[sel.length - 1];
  const topLoc = locate(objects, topId);
  if (!topLoc) return null;
  const targetParent = topLoc.parentId;
  const targetWorld = targetParent ? (worldMatrix(objects, targetParent) ?? IDENTITY) : IDENTITY;
  const inv = invert(targetWorld);
  const children: VObject[] = [];
  for (const id of sel) {
    const o = findById(objects, id);
    const wm = worldMatrix(objects, id);
    if (o && wm) children.push(normalizeObject({ ...o, m: multiply(inv, wm) }));
  }
  // index of the topmost object after the others were removed
  const others = new Set(sel);
  const listAfter = topLoc.list.slice(0, topLoc.index).filter((o) => !others.has(o.id));
  const group = createGroup(children, name);
  let next = removeByIds(objects, sel);
  if (targetParent && !findById(next, targetParent)) {
    next = insertAt(next, null, next.length, [{ ...group, m: targetWorld }]);
    return { objects: next, groupId: group.id };
  }
  next = insertAt(next, targetParent, listAfter.length, [group]);
  return { objects: next, groupId: group.id };
}

export function ungroupByIds(objects: VObject[], ids: string[]): { objects: VObject[]; ids: string[] } {
  const groups = new Set(ids.filter((id) => findById(objects, id)?.type === 'group'));
  const released: string[] = [];
  const rec = (list: VObject[]): VObject[] => {
    let changed = false;
    const out: VObject[] = [];
    for (const o of list) {
      if (o.type === 'group' && groups.has(o.id)) {
        changed = true;
        for (const c of o.children) {
          const child = normalizeObject({
            ...c,
            m: multiply(o.m, c.m),
            opacity: c.opacity * o.opacity,
            visible: c.visible && o.visible,
            locked: c.locked || o.locked,
          } as VObject);
          released.push(child.id);
          out.push(child);
        }
        continue;
      }
      if (o.type === 'group') {
        const children = rec(o.children);
        if (children !== o.children) {
          changed = true;
          out.push({ ...o, children });
          continue;
        }
      }
      out.push(o);
    }
    return changed ? out : list;
  };
  return { objects: rec(objects), ids: released };
}

/* ------------------------------ Duplicate/paste ---------------------------- */

export function duplicateByIds(objects: VObject[], ids: string[], dx = 10, dy = 10): { objects: VObject[]; ids: string[] } {
  const sel = paintOrder(objects, topLevelSelection(objects, ids));
  let next = objects;
  const newIds: string[] = [];
  for (const id of sel) {
    const loc = locate(next, id);
    if (!loc) continue;
    const o = loc.list[loc.index];
    const pm = parentMatrix(next, id) ?? IDENTITY;
    const local = chain(invert(pm), translate(dx, dy), pm);
    const copy = transformObject(cloneWithNewIds(o), local);
    newIds.push(copy.id);
    next = insertAt(next, loc.parentId, loc.index + 1, [copy]);
  }
  return { objects: next, ids: newIds };
}

/** World-space copies of objects (for the clipboard): matrices include their ancestors. */
export function extractWorldCopies(objects: VObject[], ids: string[]): VObject[] {
  return paintOrder(objects, topLevelSelection(objects, ids))
    .map((id) => {
      const o = findById(objects, id);
      const wm = worldMatrix(objects, id);
      return o && wm ? normalizeObject({ ...o, m: wm }) : null;
    })
    .filter((o): o is VObject => Boolean(o));
}

/* ----------------------------- Align/distribute ---------------------------- */

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignByIds(objects: VObject[], ids: string[], mode: AlignMode, target?: Rect | null): VObject[] {
  const sel = topLevelSelection(objects, ids);
  const to = target ?? selectionBounds(objects, sel);
  if (!to) return objects;
  let next = objects;
  for (const id of sel) {
    const b = selectionBounds(next, [id]);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = to.x - b.x;
    else if (mode === 'hcenter') dx = to.x + to.width / 2 - (b.x + b.width / 2);
    else if (mode === 'right') dx = to.x + to.width - (b.x + b.width);
    else if (mode === 'top') dy = to.y - b.y;
    else if (mode === 'vcenter') dy = to.y + to.height / 2 - (b.y + b.height / 2);
    else dy = to.y + to.height - (b.y + b.height);
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) next = moveByIds(next, [id], dx, dy);
  }
  return next;
}

/** Distributes objects so the gaps between them are equal (needs 3+ objects). */
export function distributeByIds(objects: VObject[], ids: string[], axis: 'h' | 'v'): VObject[] {
  const sel = topLevelSelection(objects, ids);
  const items = sel.map((id) => ({ id, b: selectionBounds(objects, [id]) })).filter((i): i is { id: string; b: Rect } => Boolean(i.b));
  if (items.length < 3) return objects;
  const pos = (r: Rect) => (axis === 'h' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'h' ? r.width : r.height);
  items.sort((a, b) => pos(a.b) + size(a.b) / 2 - (pos(b.b) + size(b.b) / 2));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const span = pos(last) + size(last) - pos(first);
  const total = items.reduce((s, i) => s + size(i.b), 0);
  const gap = (span - total) / (items.length - 1);
  let cursor = pos(first);
  let next = objects;
  for (const item of items) {
    const delta = cursor - pos(item.b);
    if (Math.abs(delta) > 1e-9) next = moveByIds(next, [item.id], axis === 'h' ? delta : 0, axis === 'v' ? delta : 0);
    cursor += size(item.b) + gap;
  }
  return next;
}

/* ---------------------------------- Style ---------------------------------- */

export interface StylePatch {
  fill?: Paint;
  stroke?: Partial<Stroke>;
}

/** Applies fill/stroke to the objects (groups pass it on to their children). */
export function applyStyle(objects: VObject[], ids: Iterable<string>, patch: StylePatch): VObject[] {
  const set = new Set(ids);
  const style = (o: VObject): VObject => {
    if (o.type === 'group') return { ...o, children: o.children.map(style) };
    if (o.type === 'image' || o.type === 'raw') return o;
    const next = { ...o } as VObject;
    if (patch.fill && o.type !== 'line') next.fill = patch.fill;
    if (patch.stroke) {
      next.stroke = { ...o.stroke, ...patch.stroke };
      // a color applied to a stroke without width gets a visible width
      if (patch.stroke.paint && patch.stroke.paint.type !== 'none' && next.stroke.width <= 0 && patch.stroke.width === undefined) next.stroke.width = 1;
    }
    return next;
  };
  return mapTree(objects, (o) => (set.has(o.id) ? style(o) : o));
}

/* ----------------------------- Path conversion ----------------------------- */

/** Converts a shape (rect, ellipse, polygon, star, line) into an editable path. */
export function toPathObject(o: VObject): PathObject | null {
  if (o.type === 'path') return o;
  if (o.type === 'text' || o.type === 'group' || o.type === 'image' || o.type === 'raw') return null;
  const geom = objectGeom(o);
  if (!geom) return null;
  const { id, name, m, visible, locked, opacity, blend, fill, stroke, effects } = o;
  return { id, name, m, visible, locked, opacity, blend, fill, stroke, effects, type: 'path', geom };
}

export function convertToPathsByIds(objects: VObject[], ids: Iterable<string>): VObject[] {
  const set = new Set(ids);
  return mapTree(objects, (o) => (set.has(o.id) ? (toPathObject(o) ?? o) : o));
}

/* ------------------------------- Pathfinder -------------------------------- */

function styleSource(o: VObject): VObject {
  if (o.type !== 'group') return o;
  for (let i = o.children.length - 1; i >= 0; i--) {
    const s = styleSource(o.children[i]);
    if (s.type !== 'group') return s;
  }
  return o;
}

/** Runs a pathfinder operation on the selection; the result replaces the operands. */
export function pathfinderByIds(objects: VObject[], ids: string[], op: PathfinderOp): { objects: VObject[]; id: string } | null {
  const sel = paintOrder(objects, topLevelSelection(objects, ids));
  if (sel.length < (op === 'unite' ? 1 : 2)) return null;
  const operands = sel.map((id) => {
    const o = findById(objects, id) as VObject;
    return objectToMultiPolygon(o, worldMatrix(objects, id) ?? IDENTITY);
  });
  const result = runPathfinder(operands, op);
  const sourceId = op === 'minus-front' ? sel[0] : sel[sel.length - 1];
  const source = styleSource(findById(objects, sourceId) as VObject);
  const topId = sel[sel.length - 1];
  const topLoc = locate(objects, topId);
  if (!topLoc) return null;
  const parentWorld = topLoc.parentId ? (worldMatrix(objects, topLoc.parentId) ?? IDENTITY) : IDENTITY;
  const removed = removeByIds(objects, sel);
  if (!result.length) return { objects: removed, id: '' };
  const geom = transformGeom(polygonsToGeom(result), invert(parentWorld));
  const path = createPath(geom, { fill: source.type === 'text' || source.type === 'group' ? source.fill : source.fill, stroke: source.stroke }, 'Compound path');
  path.opacity = source.opacity;
  path.blend = source.blend;
  path.effects = source.effects;
  if (source.type === 'image' || source.type === 'raw' || source.type === 'group') {
    path.fill = { type: 'solid', color: '#808080' };
    path.stroke = defaultStroke();
  }
  const others = new Set(sel);
  const index = topLoc.list.slice(0, topLoc.index).filter((o) => !others.has(o.id)).length;
  const parentAlive = topLoc.parentId === null || Boolean(findById(removed, topLoc.parentId));
  return {
    objects: parentAlive ? insertAt(removed, topLoc.parentId, index, [path]) : insertAt(removed, null, removed.length, [transformObject(path, parentWorld)]),
    id: path.id,
  };
}

/** Replaces strokes with filled outlines (keeps fills as a separate object in a group). */
export function outlineStrokeByIds(objects: VObject[], ids: string[]): { objects: VObject[]; ids: string[] } {
  let next = objects;
  const outIds: string[] = [];
  for (const id of topLevelSelection(objects, ids)) {
    const o = findById(next, id);
    if (!o) continue;
    const geom = outlineStrokeGeom(o, IDENTITY);
    if (!geom) continue;
    const outline = createPath(transformGeom(geom, o.m), { fill: o.stroke.paint, stroke: defaultStroke(NONE) }, `${o.name} outline`);
    outline.opacity = o.opacity;
    outline.blend = o.blend;
    let replacement: VObject = outline;
    if (o.fill.type !== 'none' && o.type !== 'line') {
      const fillOnly = { ...o, stroke: { ...o.stroke, paint: NONE } } as VObject;
      replacement = createGroup([fillOnly, outline], o.name);
    }
    outIds.push(replacement.id);
    next = mapTree(next, (x) => (x.id === id ? replacement : x));
  }
  return { objects: next, ids: outIds };
}

/* ------------------------------- Text on path ------------------------------ */

/** Puts a text object on a path (the path's geometry moves into the text). */
export function attachTextToPath(objects: VObject[], textId: string, pathId: string): VObject[] {
  const text = findById(objects, textId);
  const path = findById(objects, pathId);
  if (!text || text.type !== 'text' || !path) return objects;
  const geom = objectGeom(path);
  const tw = worldMatrix(objects, textId);
  const pw = worldMatrix(objects, pathId);
  if (!geom || !tw || !pw || path.type === 'text') return objects;
  const local = transformGeom(geom, multiply(invert(tw), pw));
  const next = updateById(objects, textId, (o) => ({ ...(o as TextObject), onPath: { geom: local, offset: 0 }, align: 'left' }) as VObject);
  return removeByIds(next, [pathId]);
}

/** Moves the path out of a text-on-path object again. */
export function releaseTextFromPath(objects: VObject[], textId: string): { objects: VObject[]; pathId: string | null } {
  const loc = locate(objects, textId);
  const text = loc ? loc.list[loc.index] : null;
  if (!loc || !text || text.type !== 'text' || !text.onPath) return { objects, pathId: null };
  const path = createPath(text.onPath.geom, { fill: NONE, stroke: defaultStroke({ type: 'solid', color: '#000000' }, 1) });
  path.m = text.m;
  const { onPath: _drop, ...rest } = text;
  void _drop;
  let next = updateById(objects, textId, () => rest as VObject);
  next = insertAt(next, loc.parentId, loc.index, [path]);
  return { objects: next, pathId: path.id };
}

/* --------------------------------- Misc ------------------------------------ */

/** Bounds of the objects intersecting an artboard (all visible objects). */
export function contentBounds(objects: VObject[]): Rect | null {
  return selectionBounds(
    objects,
    objects.filter((o) => o.visible).map((o) => o.id),
  );
}

export function isGroup(o: VObject | null | undefined): o is GroupObject {
  return Boolean(o && o.type === 'group');
}

/** World-space geometry bounds of a single object. */
export function objectWorldBounds(objects: VObject[], id: string): Rect | null {
  const o = findById(objects, id);
  const pm = parentMatrix(objects, id);
  return o && pm ? boundsUnder(o, multiply(pm, o.m)) : null;
}
