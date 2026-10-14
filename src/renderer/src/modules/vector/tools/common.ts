import type { EditorCore } from '../editor';
import { boundsUnder, localBounds, selectionBounds, worldMatrix } from '../geometry';
import { IDENTITY, apply, decompose, invert, multiply, type Matrix, type Pt, type Rect } from '../matrix';
import { normalizeObject } from '../geometry';
import type { PathNode, VDoc, VObject } from '../model';
import { findById, insertAt, topLevelSelection } from '../ops';
import { buildSnapTargets, type Guide, type SnapTargets } from '../snap';

export interface PointerInfo {
  world: Pt;
  screen: Pt;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  button: number;
  target: Element | null;
  detail: number;
}

export interface Gesture {
  move: (p: PointerInfo) => void;
  up: (p: PointerInfo) => void;
  cancel?: () => void;
}

export interface PenState {
  /** World coordinates of the path being drawn. */
  nodes: PathNode[];
  cursor: Pt | null;
  /** The node being dragged (setting its handles). */
  dragging: boolean;
}

export interface OverlayState {
  marquee: Rect | null;
  guides: Guide[];
  pencil: Pt[] | null;
  zoomRect: Rect | null;
  hover: string | null;
  pen: PenState | null;
  /** Segment hover for the pen (add point) / direct tool. */
  segmentHint: Pt | null;
}

export const EMPTY_OVERLAY: OverlayState = { marquee: null, guides: [], pencil: null, zoomRect: null, hover: null, pen: null, segmentHint: null };

export interface ToolCtx {
  /** Always the latest editor state. */
  core: () => EditorCore;
  setOverlay: (patch: Partial<OverlayState>) => void;
  /** World units per screen pixel. */
  px: () => number;
}

/** Screen distance threshold for drags vs. clicks. */
export const DRAG_THRESHOLD = 3;

export function dragged(a: PointerInfo, b: PointerInfo): boolean {
  return Math.hypot(a.screen.x - b.screen.x, a.screen.y - b.screen.y) > DRAG_THRESHOLD;
}

/** Snap lines from artboards and visible objects (excluding the moving ones). */
export function snapTargetsFor(core: EditorCore, exclude: Set<string>): SnapTargets {
  const rects: Rect[] = core.doc.artboards.map((a) => ({ x: a.x, y: a.y, width: a.width, height: a.height }));
  if (core.viewOpts.smartGuides) {
    let count = 0;
    for (const o of core.doc.objects) {
      if (!o.visible || exclude.has(o.id) || count > 600) continue;
      const b = boundsUnder(o, o.m);
      if (b) {
        rects.push(b);
        count++;
      }
      if (o.type === 'group' && core.scope === o.id) {
        for (const c of o.children) {
          if (exclude.has(c.id) || !c.visible) continue;
          const cb = boundsUnder(c, multiply(o.m, c.m));
          if (cb) rects.push(cb);
        }
      }
    }
  }
  const ab = core.activeArtboard;
  const grid = core.viewOpts.snapToGrid ? { size: core.viewOpts.gridSize, ox: ab.x, oy: ab.y } : undefined;
  const targets = buildSnapTargets(core.viewOpts.smartGuides ? rects : [], grid);
  return targets;
}

export interface SelFrame {
  /** Frame → world matrix. */
  m: Matrix;
  box: Rect;
  ids: string[];
}

/** The box the transform handles are drawn around (rotated for a single object). */
export function selectionFrame(objects: VObject[], ids: string[]): SelFrame | null {
  const top = topLevelSelection(objects, ids);
  if (!top.length) return null;
  if (top.length === 1) {
    const o = findById(objects, top[0]);
    const wm = worldMatrix(objects, top[0]);
    if (!o || !wm) return null;
    return { m: wm, box: localBounds(o), ids: top };
  }
  const b = selectionBounds(objects, top);
  return b ? { m: IDENTITY, box: b, ids: top } : null;
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handleFactors(h: HandleId): { fx: number; fy: number } {
  return { fx: h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5, fy: h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5 };
}

export function handleLocal(box: Rect, h: HandleId): Pt {
  const { fx, fy } = handleFactors(h);
  return { x: box.x + fx * box.width, y: box.y + fy * box.height };
}

/** CSS resize cursor for a handle, taking the frame rotation into account. */
export function handleCursor(h: HandleId, m: Matrix): string {
  const base: Record<HandleId, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const d = decompose(m);
  let a = (base[h] + d.rotation + (d.flipX ? 180 : 0)) % 180;
  if (a < 0) a += 180;
  const idx = Math.round(a / 45) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][idx];
}

/** Inserts new objects (world coordinates) at the top of the current scope. */
export function insertObjects(doc: VDoc, objs: VObject[], scope: string | null): VDoc {
  if (scope) {
    const g = findById(doc.objects, scope);
    const gw = worldMatrix(doc.objects, scope);
    if (g && g.type === 'group' && gw) {
      const inv = invert(gw);
      const local = objs.map((o) => normalizeObject({ ...o, m: multiply(inv, o.m) }));
      return { ...doc, objects: insertAt(doc.objects, scope, g.children.length, local) };
    }
  }
  return { ...doc, objects: [...doc.objects, ...objs] };
}

export function worldToLocal(objects: VObject[], id: string, p: Pt): Pt {
  const wm = worldMatrix(objects, id) ?? IDENTITY;
  return apply(invert(wm), p);
}
