import type { Pt } from '../matrix';
import { createPath, type PathNode, type PathObject } from '../model';
import { deleteNodes } from '../nodes';
import { removeByIds, toPathObject, findById, updateById } from '../ops';
import { constrain45, snapPoint } from '../snap';
import { addPointAt, anchorAt } from './direct';
import { dragged, insertObjects, snapTargetsFor, type Gesture, type PointerInfo, type ToolCtx } from './common';

export interface PenController {
  down: (p: PointerInfo) => Gesture | null;
  hover: (p: PointerInfo) => void;
  /** Finishes the path being drawn (Enter/Esc or tool change). */
  finish: (close?: boolean) => void;
  isDrawing: () => boolean;
}

const copy = (n: PathNode): PathNode => ({ ...n, in: n.in ? { ...n.in } : undefined, out: n.out ? { ...n.out } : undefined });

export function createPen(ctx: ToolCtx): PenController {
  let nodes: PathNode[] = [];
  let cursor: Pt | null = null;

  const sync = (dragging = false) => ctx.setOverlay({ pen: nodes.length ? { nodes: nodes.map(copy), cursor, dragging } : null });

  const place = (p: PointerInfo): Pt => {
    const core = ctx.core();
    let pt = p.world;
    const last = nodes[nodes.length - 1];
    if (p.shift && last) {
      const c = constrain45(pt.x - last.x, pt.y - last.y);
      return { x: last.x + c.dx, y: last.y + c.dy };
    }
    if (core.viewOpts.smartGuides || core.viewOpts.snapToGrid) {
      const s = snapPoint(pt, snapTargetsFor(core, new Set()), 5 * ctx.px());
      pt = { x: s.x, y: s.y };
    }
    return pt;
  };

  const finish = (close = false) => {
    const core = ctx.core();
    if (nodes.length >= 2) {
      const clean = nodes.map((n) => {
        const out: PathNode = { x: n.x, y: n.y };
        if (n.in && Math.hypot(n.in.x - n.x, n.in.y - n.y) > 0.01) out.in = n.in;
        if (n.out && Math.hypot(n.out.x - n.x, n.out.y - n.y) > 0.01) out.out = n.out;
        if (n.smooth && out.in && out.out) out.smooth = true;
        return out;
      });
      if (!close) {
        // an open path's ends have no outer handles
        delete clean[0].in;
        delete clean[clean.length - 1].out;
      }
      const path = createPath({ subpaths: [{ nodes: clean, closed: close }] }, core.style, 'Path');
      core.update((d) => insertObjects(d, [path], core.scope), 'Pen');
      core.setSelection([path.id]);
    }
    nodes = [];
    cursor = null;
    sync();
  };

  const down = (p: PointerInfo): Gesture | null => {
    const core = ctx.core();
    const tol = 6 * ctx.px();
    if (!nodes.length) {
      // with a path selected the pen adds points on segments and removes clicked anchors
      const a = anchorAt(core, p.world, tol);
      if (a) {
        core.update((d) => {
          const o = findById(d.objects, a.id);
          const path = o ? (toPathObject(o) as PathObject | null) : null;
          if (!path) return d;
          const geom = deleteNodes(path.geom, [{ sub: a.sub, idx: a.idx }]);
          if (!geom.subpaths.length) return { ...d, objects: removeByIds(d.objects, [a.id]) };
          return { ...d, objects: updateById(d.objects, a.id, () => ({ ...path, geom })) };
        }, 'Delete point');
        core.setNodeSel([]);
        return null;
      }
      if (addPointAt(core, p.world, tol)) return null;
      core.setSelection([]);
    }
    if (nodes.length >= 2 && Math.hypot(nodes[0].x - p.world.x, nodes[0].y - p.world.y) <= tol) {
      const start = p;
      return {
        move(q) {
          if (!dragged(start, q)) return;
          const f = nodes[0];
          f.in = { x: 2 * f.x - q.world.x, y: 2 * f.y - q.world.y };
          f.out = { x: q.world.x, y: q.world.y };
          f.smooth = true;
          sync(true);
        },
        up() {
          finish(true);
        },
      };
    }
    const pt = place(p);
    const node: PathNode = { x: pt.x, y: pt.y };
    nodes.push(node);
    cursor = pt;
    sync();
    const start = p;
    return {
      move(q) {
        if (!dragged(start, q)) return;
        node.out = { x: q.world.x, y: q.world.y };
        node.in = q.alt && node.in ? node.in : { x: 2 * node.x - q.world.x, y: 2 * node.y - q.world.y };
        node.smooth = !q.alt;
        cursor = q.world;
        sync(true);
      },
      up(q) {
        cursor = q.world;
        sync(false);
      },
    };
  };

  return {
    down,
    hover(p) {
      if (!nodes.length) return;
      cursor = place(p);
      sync();
    },
    finish,
    isDrawing: () => nodes.length > 0,
  };
}
