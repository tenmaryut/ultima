import { toast } from '../../components/ui';
import { t } from '../../core/i18n';
import { normalizeColor } from './colors';
import { parseNodeKey, type EditorCore } from './editor';
import { selectionBounds, worldMatrix } from './geometry';
import { applyVec, invert, rectCenter, type Rect } from './matrix';
import { createArtboard, newId, walkObjects, type Artboard, type Paint, type VObject } from './model';
import { deleteNodes, moveNodes, toggleSmooth, type NodeRef } from './nodes';
import {
  alignByIds,
  applyStyle,
  arrangeByIds,
  attachTextToPath,
  convertToPathsByIds,
  distributeByIds,
  duplicateByIds,
  findById,
  flipByIds,
  groupByIds,
  mapTree,
  moveByIds,
  outlineStrokeByIds,
  pathfinderByIds,
  releaseTextFromPath,
  removeByIds,
  rotateByIds,
  topLevelSelection,
  toPathObject,
  ungroupByIds,
  updateById,
  type AlignMode,
  type ArrangeMode,
} from './ops';
import type { PathfinderOp } from './pathfinder';
import { scopeInfo } from './tools/select';

function nodesByObject(keys: string[]): Map<string, NodeRef[]> {
  const map = new Map<string, NodeRef[]>();
  for (const k of keys) {
    const r = parseNodeKey(k);
    if (r) map.set(r.id, [...(map.get(r.id) ?? []), { sub: r.sub, idx: r.idx }]);
  }
  return map;
}

export function editActions(get: () => EditorCore) {
  const sel = () => {
    const c = get();
    return topLevelSelection(c.doc.objects, c.selection);
  };
  const needSelection = (min = 1): string[] | null => {
    const ids = sel();
    if (ids.length < min) {
      toast.info(min > 1 ? t('Select at least {count} objects', { count: min }) : t('Select an object first'));
      return null;
    }
    return ids;
  };
  const artboardRect = (): Rect => {
    const ab = get().activeArtboard;
    return { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
  };

  const actions = {
    selectAll() {
      const c = get();
      if (c.tool === 'direct' && c.selection.length) {
        const keys: string[] = [];
        for (const id of c.selection) {
          const o = findById(c.doc.objects, id);
          const p = o ? toPathObject(o) : null;
          p?.geom.subpaths.forEach((s, si) => s.nodes.forEach((_, ni) => keys.push(`${id}:${si}:${ni}`)));
        }
        c.setNodeSel(keys);
        return;
      }
      const { list } = scopeInfo(c.doc.objects, c.scope);
      c.setSelection(list.filter((o) => o.visible && !o.locked).map((o) => o.id));
    },
    deselect() {
      const c = get();
      c.setSelection([]);
      c.setNodeSel([]);
    },
    deleteSelection() {
      const c = get();
      if (c.tool === 'direct' && c.nodeSel.length) {
        const groups = nodesByObject(c.nodeSel);
        c.update((d) => {
          let objects = d.objects;
          for (const [id, refs] of groups) {
            const o = findById(objects, id);
            const p = o ? toPathObject(o) : null;
            if (!p) continue;
            const geom = deleteNodes(p.geom, refs);
            objects = geom.subpaths.length ? updateById(objects, id, () => ({ ...p, geom })) : removeByIds(objects, [id]);
          }
          return { ...d, objects };
        }, 'Delete points');
        c.setNodeSel([]);
        return;
      }
      const ids = sel();
      if (!ids.length) return;
      c.update((d) => ({ ...d, objects: removeByIds(d.objects, ids) }), 'Delete');
      c.setSelection([]);
    },
    duplicate() {
      const ids = needSelection();
      if (!ids) return;
      const c = get();
      const r = duplicateByIds(c.doc.objects, ids, 10, 10);
      c.update((d) => ({ ...d, objects: r.objects }), 'Duplicate');
      c.setSelection(r.ids);
    },
    nudge(dx: number, dy: number) {
      const c = get();
      if (c.tool === 'direct' && c.nodeSel.length) {
        const groups = nodesByObject(c.nodeSel);
        c.update((d) => {
          let objects = d.objects;
          for (const [id, refs] of groups) {
            const o = findById(objects, id);
            const p = o ? toPathObject(o) : null;
            const wm = worldMatrix(objects, id);
            if (!p || !wm) continue;
            const dl = applyVec(invert(wm), { x: dx, y: dy });
            objects = updateById(objects, id, () => ({ ...p, geom: moveNodes(p.geom, refs, dl.x, dl.y) }));
          }
          return { ...d, objects };
        }, 'Nudge points');
        return;
      }
      const ids = sel();
      if (!ids.length) return;
      c.update((d) => ({ ...d, objects: moveByIds(d.objects, ids, dx, dy) }), 'Nudge');
    },
    convertPoints(smooth: boolean) {
      const c = get();
      const groups = nodesByObject(c.nodeSel);
      if (!groups.size) return toast.info(t('Select points with the Direct Selection tool first'));
      c.update((d) => {
        let objects = d.objects;
        for (const [id, refs] of groups) {
          const o = findById(objects, id);
          const p = o ? toPathObject(o) : null;
          if (!p) continue;
          let geom = p.geom;
          for (const r of refs) geom = toggleSmooth(geom, r, smooth);
          objects = updateById(objects, id, () => ({ ...p, geom }));
        }
        return { ...d, objects };
      }, smooth ? 'Smooth points' : 'Corner points');
    },
    group() {
      const ids = needSelection();
      if (!ids) return;
      const c = get();
      const r = groupByIds(c.doc.objects, ids);
      if (!r) return;
      c.update((d) => ({ ...d, objects: r.objects }), 'Group');
      c.setSelection([r.groupId]);
    },
    ungroup() {
      const c = get();
      const ids = sel().filter((id) => findById(c.doc.objects, id)?.type === 'group');
      if (!ids.length) return toast.info(t('Select a group first'));
      const r = ungroupByIds(c.doc.objects, ids);
      c.update((d) => ({ ...d, objects: r.objects }), 'Ungroup');
      c.setSelection(r.ids);
      if (c.scope && ids.includes(c.scope)) c.setScope(null);
    },
    arrange(mode: ArrangeMode) {
      const ids = needSelection();
      if (!ids) return;
      get().update((d) => ({ ...d, objects: arrangeByIds(d.objects, ids, mode) }), 'Arrange');
    },
    align(mode: AlignMode, to?: 'selection' | 'artboard') {
      const ids = needSelection();
      if (!ids) return;
      const c = get();
      const target = (to ?? c.viewOpts.alignTo) === 'artboard' || ids.length === 1 ? artboardRect() : null;
      c.update((d) => ({ ...d, objects: alignByIds(d.objects, ids, mode, target) }), 'Align');
    },
    distribute(axis: 'h' | 'v') {
      const ids = needSelection(3);
      if (!ids) return;
      get().update((d) => ({ ...d, objects: distributeByIds(d.objects, ids, axis) }), 'Distribute');
    },
    flip(axis: 'h' | 'v') {
      const ids = needSelection();
      if (!ids) return;
      get().update((d) => ({ ...d, objects: flipByIds(d.objects, ids, axis) }), axis === 'h' ? 'Flip horizontal' : 'Flip vertical');
    },
    rotate(deg: number) {
      const ids = needSelection();
      if (!ids) return;
      get().update((d) => ({ ...d, objects: rotateByIds(d.objects, ids, deg) }), 'Rotate');
    },
    setLocked(locked: boolean) {
      const ids = needSelection();
      if (!ids) return;
      const set = new Set(ids);
      get().update((d) => ({ ...d, objects: mapTree(d.objects, (o) => (set.has(o.id) ? { ...o, locked } : o)) }), locked ? 'Lock' : 'Unlock');
      if (locked) get().setSelection([]);
    },
    unlockAll() {
      get().update((d) => ({ ...d, objects: mapTree(d.objects, (o) => (o.locked ? { ...o, locked: false } : o)) }), 'Unlock all');
    },
    hide() {
      const ids = needSelection();
      if (!ids) return;
      const set = new Set(ids);
      get().update((d) => ({ ...d, objects: mapTree(d.objects, (o) => (set.has(o.id) ? { ...o, visible: false } : o)) }), 'Hide');
      get().setSelection([]);
    },
    showAll() {
      get().update((d) => ({ ...d, objects: mapTree(d.objects, (o) => (o.visible ? o : { ...o, visible: true })) }), 'Show all');
    },
    pathfinder(op: PathfinderOp) {
      const ids = needSelection(op === 'unite' ? 1 : 2);
      if (!ids) return;
      const c = get();
      try {
        const r = pathfinderByIds(c.doc.objects, ids, op);
        if (!r) return;
        c.update((d) => ({ ...d, objects: r.objects }), 'Pathfinder');
        c.setSelection(r.id ? [r.id] : []);
        if (!r.id) toast.info(t('The result is empty'));
      } catch (error) {
        toast.error(t('Pathfinder failed'), error instanceof Error ? error.message : String(error));
      }
    },
    outlineStroke() {
      const ids = needSelection();
      if (!ids) return;
      const c = get();
      try {
        const r = outlineStrokeByIds(c.doc.objects, ids);
        if (!r.ids.length) return toast.info(t('Nothing to outline: the selection has no strokes'));
        c.update((d) => ({ ...d, objects: r.objects }), 'Outline stroke');
        c.setSelection(r.ids);
      } catch (error) {
        toast.error(t('Outline stroke failed'), error instanceof Error ? error.message : String(error));
      }
    },
    convertToPath() {
      const ids = needSelection();
      if (!ids) return;
      get().update((d) => ({ ...d, objects: convertToPathsByIds(d.objects, ids) }), 'Convert to path');
    },
    textOnPath() {
      const c = get();
      const ids = sel();
      const text = ids.map((id) => findById(c.doc.objects, id)).find((o) => o?.type === 'text');
      const path = ids.map((id) => findById(c.doc.objects, id)).find((o) => o && o.type !== 'text' && o.type !== 'group' && o.type !== 'image' && o.type !== 'raw');
      if (!text || !path) return toast.info(t('Select one text and one path'));
      c.update((d) => ({ ...d, objects: attachTextToPath(d.objects, text.id, path.id) }), 'Text on path');
      c.setSelection([text.id]);
    },
    releaseTextPath() {
      const c = get();
      const text = sel()
        .map((id) => findById(c.doc.objects, id))
        .find((o) => o?.type === 'text' && o.onPath);
      if (!text) return toast.info(t('Select a text on a path'));
      const r = releaseTextFromPath(c.doc.objects, text.id);
      c.update((d) => ({ ...d, objects: r.objects }), 'Release text from path');
    },
    applyPaint(paint: Paint, target?: 'fill' | 'stroke') {
      const c = get();
      const which = target ?? c.paintTarget;
      const nextStyle = which === 'fill' ? { ...c.style, fill: paint } : { ...c.style, stroke: { ...c.style.stroke, paint, width: c.style.stroke.width || 1 } };
      c.setStyle(nextStyle);
      const ids = sel();
      if (!ids.length) return;
      c.update(
        (d) => ({ ...d, objects: applyStyle(d.objects, ids, which === 'fill' ? { fill: paint } : { stroke: { paint } }) }),
        which === 'fill' ? 'Fill' : 'Stroke',
      );
    },
    addSwatches(colors: string[]) {
      const valid = colors.map((c) => normalizeColor(c)).filter((c): c is string => Boolean(c));
      if (!valid.length) return 0;
      let added = 0;
      get().update((d) => {
        const set = new Set(d.swatches);
        const next = [...d.swatches];
        for (const c of valid) {
          if (!set.has(c)) {
            set.add(c);
            next.push(c);
            added++;
          }
        }
        return added ? { ...d, swatches: next } : d;
      }, 'Add swatches');
      return added;
    },
    removeSwatch(color: string) {
      get().update((d) => ({ ...d, swatches: d.swatches.filter((c) => c !== color) }), 'Remove swatch');
    },
    /** Adds every color used in the document to the swatches. */
    collectDocumentColors(colors: string[]) {
      return actions.addSwatches(colors);
    },
    /* ------------------------------- Artboards ------------------------------- */
    setActiveArtboard(id: string, zoom = true) {
      const c = get();
      const ab = c.doc.artboards.find((a) => a.id === id);
      if (!ab) return;
      if (c.doc.activeArtboard !== id) c.updateLive((d) => ({ ...d, activeArtboard: id }));
      if (zoom) c.viewport.fitRect({ x: ab.x, y: ab.y, width: ab.width, height: ab.height });
    },
    addArtboard(width?: number, height?: number) {
      const c = get();
      const last = c.doc.artboards.reduce((a, b) => (b.x + b.width > a.x + a.width ? b : a), c.doc.artboards[0]);
      const w = width ?? c.activeArtboard.width;
      const h = height ?? c.activeArtboard.height;
      const ab = createArtboard(t('Artboard {n}', { n: c.doc.artboards.length + 1 }), last.x + last.width + 80, last.y, w, h, c.activeArtboard.background);
      c.update((d) => ({ ...d, artboards: [...d.artboards, ab], activeArtboard: ab.id }), 'Add artboard');
      c.viewport.fitRect({ x: ab.x, y: ab.y, width: ab.width, height: ab.height });
    },
    duplicateArtboard(id: string) {
      const c = get();
      const src = c.doc.artboards.find((a) => a.id === id);
      if (!src) return;
      const last = c.doc.artboards.reduce((a, b) => (b.x + b.width > a.x + a.width ? b : a), c.doc.artboards[0]);
      const ab: Artboard = { ...src, id: newId('ab'), name: `${src.name} ${t('copy')}`, x: last.x + last.width + 80, y: src.y };
      const dx = ab.x - src.x;
      const dy = ab.y - src.y;
      // copy the objects that sit on the source artboard
      const area = { x: src.x, y: src.y, width: src.width, height: src.height };
      const inside = c.doc.objects.filter((o) => {
        const b = selectionBounds(c.doc.objects, [o.id]);
        if (!b) return false;
        const cpt = rectCenter(b);
        return cpt.x >= area.x && cpt.x <= area.x + area.width && cpt.y >= area.y && cpt.y <= area.y + area.height;
      });
      c.update((d) => {
        let objects = d.objects;
        if (inside.length) {
          const r = duplicateByIds(objects, inside.map((o) => o.id), dx, dy);
          objects = r.objects;
        }
        return { ...d, artboards: [...d.artboards, ab], activeArtboard: ab.id, objects };
      }, 'Duplicate artboard');
      c.viewport.fitRect({ x: ab.x, y: ab.y, width: ab.width, height: ab.height });
    },
    deleteArtboard(id: string) {
      const c = get();
      if (c.doc.artboards.length <= 1) return toast.info(t('A document needs at least one artboard'));
      c.update((d) => {
        const artboards = d.artboards.filter((a) => a.id !== id);
        return { ...d, artboards, activeArtboard: d.activeArtboard === id ? artboards[0].id : d.activeArtboard };
      }, 'Delete artboard');
    },
    updateArtboard(id: string, patch: Partial<Artboard>, label = 'Artboard') {
      get().update((d) => ({ ...d, artboards: d.artboards.map((a) => (a.id === id ? { ...a, ...patch } : a)) }), label);
    },
    /** Every leaf object (for AI recolor / naming etc.). */
    leaves(): VObject[] {
      const out: VObject[] = [];
      walkObjects(get().doc.objects, (o) => {
        if (o.type !== 'group') out.push(o);
      });
      return out;
    },
  };
  return actions;
}

export type EditActions = ReturnType<typeof editActions>;
