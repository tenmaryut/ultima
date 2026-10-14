import { boxCorners, contentBox, strokeMargin, transformedBounds, type Box } from './bounds';
import { isLayerActive, type EvaluatedLayer } from './evaluate';
import { distanceToPolylines, flatten, pointInPolylines } from './geometry';
import { apply, invert, multiply, type Mat } from './matrix';
import type { Asset, Layer, MotionDoc } from './types';

/** Stage geometry helpers: handles and hit testing (no React). */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot' | 'anchor';

export interface Handle {
  id: HandleId;
  /** Screen position (CSS px relative to the stage). */
  x: number;
  y: number;
  /** Content-space point the handle represents. */
  lx: number;
  ly: number;
}

export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  rot: 'grab',
  anchor: 'move',
};

/** Which content axes a handle scales. */
export const HANDLE_AXES: Record<HandleId, [boolean, boolean]> = {
  nw: [true, true],
  ne: [true, true],
  se: [true, true],
  sw: [true, true],
  n: [false, true],
  s: [false, true],
  e: [true, false],
  w: [true, false],
  rot: [false, false],
  anchor: [false, false],
};

/** Handles of a single selected layer. `view` maps composition px → screen px. */
export function layerHandles(ev: EvaluatedLayer, box: Box, view: Mat): Handle[] {
  const m = multiply(view, ev.world);
  const { x, y, w, h } = box;
  const pts: [HandleId, number, number][] = [
    ['nw', x, y],
    ['n', x + w / 2, y],
    ['ne', x + w, y],
    ['e', x + w, y + h / 2],
    ['se', x + w, y + h],
    ['s', x + w / 2, y + h],
    ['sw', x, y + h],
    ['w', x, y + h / 2],
  ];
  const out: Handle[] = [];
  const degenerateX = Math.abs(w) < 1e-6;
  const degenerateY = Math.abs(h) < 1e-6;
  for (const [id, lx, ly] of pts) {
    // Lines (no height) only get the end handles; zero-width boxes only top/bottom.
    if (degenerateY && id !== 'e' && id !== 'w') continue;
    if (degenerateX && id !== 'n' && id !== 's') continue;
    const [sx, sy] = apply(m, lx, ly);
    out.push({ id, x: sx, y: sy, lx, ly });
  }
  // Rotation handle: 26 px above the top edge's middle, along the box's "up" direction.
  const top = apply(m, x + w / 2, y);
  const bottom = apply(m, x + w / 2, y + Math.max(h, 1));
  let ux = top[0] - bottom[0];
  let uy = top[1] - bottom[1];
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  out.push({ id: 'rot', x: top[0] + ux * 26, y: top[1] + uy * 26, lx: x + w / 2, ly: y });
  const a = apply(m, ev.anchor[0], ev.anchor[1]);
  out.push({ id: 'anchor', x: a[0], y: a[1], lx: ev.anchor[0], ly: ev.anchor[1] });
  return out;
}

export function hitHandle(handles: Handle[], x: number, y: number, radius = 7): Handle | null {
  // Anchor last: corner handles win when they overlap it.
  let best: Handle | null = null;
  let bestD = radius;
  for (const h of handles) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d <= bestD && (best === null || h.id !== 'anchor')) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** Screen-space quad of a layer (for selection outlines). */
export function layerQuad(ev: EvaluatedLayer, box: Box, view: Mat): [number, number][] {
  return boxCorners(multiply(view, ev.world), box);
}

const flatCache = new WeakMap<object, ReturnType<typeof flatten>>();

/**
 * Top-most layer under a composition-space point. `tolerance` is in composition px
 * (thin lines / small layers stay clickable). Locked and hidden layers are skipped.
 */
export function hitTestLayers(doc: MotionDoc, evaluated: Map<string, EvaluatedLayer>, x: number, y: number, t: number, tolerance: number): string | null {
  const anySolo = doc.layers.some((l) => l.solo && l.type !== 'null');
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked || !isLayerActive(layer, t)) continue;
    if (anySolo && !layer.solo && layer.type !== 'null') continue;
    const ev = evaluated.get(layer.id);
    if (!ev) continue;
    if (layer.type === 'null') {
      const p = apply(ev.world, ev.anchor[0], ev.anchor[1]);
      if (Math.hypot(p[0] - x, p[1] - y) <= tolerance * 1.6) return layer.id;
      continue;
    }
    if (ev.opacity <= 0) continue;
    if (hitLayer(layer, ev, doc.assets, x, y, tolerance)) return layer.id;
  }
  return null;
}

function hitLayer(layer: Layer, ev: EvaluatedLayer, assets: Record<string, Asset>, x: number, y: number, tolerance: number): boolean {
  const inv = invert(ev.world);
  const [lx, ly] = apply(inv, x, y);
  // Tolerance in layer units (approximate for non-uniform scale).
  const det = Math.abs(ev.world[0] * ev.world[3] - ev.world[1] * ev.world[2]);
  const tol = tolerance / Math.sqrt(det || 1);
  const box = contentBox(layer, ev, assets);
  const margin = strokeMargin(layer, ev) / 2 + tol;
  if (lx < box.x - margin || lx > box.x + box.w + margin || ly < box.y - margin || ly > box.y + box.h + margin) return false;
  if (layer.type === 'shape' && layer.shape) {
    const kind = layer.shape.kind;
    // Exact test for paths and lines; boxes are fine for the solid primitives.
    if (kind === 'path' || kind === 'line' || (!layer.shape.fillEnabled && layer.shape.strokeEnabled)) {
      const geomKey = kind === 'path' ? (layer.shape.path ?? []) : null;
      let polys = geomKey ? flatCache.get(geomKey) : undefined;
      if (!polys) {
        polys = flatten(
          kind === 'path'
            ? (layer.shape.path ?? [])
            : kind === 'line'
              ? [{ closed: false, nodes: [{ x: -ev.size[0] / 2, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 }, { x: ev.size[0] / 2, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 }] }]
              : [],
          1,
        );
        if (geomKey) flatCache.set(geomKey, polys);
      }
      if (!polys.length) return true;
      if (layer.shape.fillEnabled && kind !== 'line' && pointInPolylines(polys, lx, ly)) return true;
      return distanceToPolylines(polys, lx, ly) <= ev.strokeWidth / 2 + tol * 1.5;
    }
  }
  return true;
}

/** Layers whose composition-space bounds intersect a rectangle (marquee selection). */
export function layersInRect(doc: MotionDoc, evaluated: Map<string, EvaluatedLayer>, r: Box, t: number): string[] {
  const out: string[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked || !isLayerActive(layer, t)) continue;
    const ev = evaluated.get(layer.id);
    if (!ev) continue;
    const b = layer.type === 'null' ? (() => {
      const p = apply(ev.world, ev.anchor[0], ev.anchor[1]);
      return { x: p[0], y: p[1], w: 0, h: 0 };
    })() : transformedBounds(ev.world, contentBox(layer, ev, doc.assets));
    if (b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y) out.push(layer.id);
  }
  return out;
}

/** Normalized rectangle from two corners. */
export function rectFrom(x0: number, y0: number, x1: number, y1: number): Box {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}
