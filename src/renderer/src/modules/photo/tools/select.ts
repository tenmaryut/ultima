/**
 * Selection tools: Rectangular/Elliptical Marquee, Lasso / Polygonal Lasso and Magic Wand.
 * Shift = add, Alt = subtract, Shift+Alt = intersect (at the start of the gesture).
 */
import { pixelsInArea } from '../canvas';
import { setSelection } from '../doc';
import type { PhotoEngine } from '../engine';
import { antialiasMask, floodMask } from '../pixels/flood';
import { layerContent } from '../render';
import {
  combineMasks,
  ellipseMask,
  featherMask,
  normalizeRect,
  polygonMask,
  rectMask,
  selectionFromMask,
  selectionValue,
  translateMask,
} from '../selection';
import type { PhotoDoc, Point, Rect, SelectionMode } from '../types';
import { constrainRect } from './brushMath';
import type { ToolEvent, ToolHandler } from './types';

export function modeFromEvent(e: { shift: boolean; alt: boolean }, base: SelectionMode): SelectionMode {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return base;
}

const LABELS: Record<SelectionMode, string> = { new: '', add: ' (add)', subtract: ' (subtract)', intersect: ' (intersect)' };

/** Combines a new shape mask with the document's selection and records the step. */
export function applySelectionMask(engine: PhotoEngine, mask: Uint8Array, mode: SelectionMode, feather: number, label: string): void {
  const doc = engine.doc;
  if (!doc) return;
  const shaped = feather > 0 ? featherMask(mask, doc.width, doc.height, feather) : mask;
  const combined = combineMasks(doc.selection?.mask ?? null, shaped, mode);
  const sel = selectionFromMask(combined, doc.width, doc.height);
  engine.commit(setSelection(doc, sel), sel ? label + LABELS[mode] : 'Deselect');
}

function screenRect(engine: PhotoEngine, r: Rect): Rect {
  const a = engine.docToScreen(r.x, r.y);
  const b = engine.docToScreen(r.x + r.w, r.y + r.h);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

function dashed(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#000000';
  draw();
  ctx.stroke();
  ctx.lineDashOffset = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------- Marquee --------------------------------- */

interface MarqueeDrag {
  start: Point;
  cur: Point;
  mode: SelectionMode;
  modifiersAtStart: { shift: boolean; alt: boolean };
  shift: boolean;
  alt: boolean;
  moving: boolean;
}

let marquee: MarqueeDrag | null = null;

function marqueeRect(engine: PhotoEngine, d: MarqueeDrag): Rect {
  const o = engine.store.opts.marquee;
  if (o.style === 'size') return { x: Math.round(d.cur.x), y: Math.round(d.cur.y), w: Math.max(1, o.fixedW), h: Math.max(1, o.fixedH) };
  let end = d.cur;
  const square = d.shift && !d.modifiersAtStart.shift;
  if (o.style === 'ratio') end = constrainRect(d.start, d.cur, Math.max(0.01, o.ratioW) / Math.max(0.01, o.ratioH));
  else if (square) end = constrainRect(d.start, d.cur, 1);
  const fromCenter = d.alt && !d.modifiersAtStart.alt;
  let r = fromCenter
    ? { x: d.start.x - Math.abs(end.x - d.start.x), y: d.start.y - Math.abs(end.y - d.start.y), w: Math.abs(end.x - d.start.x) * 2, h: Math.abs(end.y - d.start.y) * 2 }
    : normalizeRect(d.start, end);
  r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  return r;
}

export const marqueeTool: ToolHandler = {
  cursor: () => 'crosshair',
  down(engine, e) {
    const doc = engine.doc!;
    const mode = modeFromEvent(e, engine.store.opts.selMode);
    const inside = doc.selection && selectionValue(doc.selection, e.x, e.y) >= 128;
    marquee = {
      start: { x: e.x, y: e.y },
      cur: { x: e.x, y: e.y },
      mode,
      modifiersAtStart: { shift: e.shift, alt: e.alt },
      shift: e.shift,
      alt: e.alt,
      moving: Boolean(inside && mode === 'new' && engine.store.opts.marquee.style !== 'size'),
    };
  },
  move(engine, e) {
    if (!marquee) return;
    marquee.cur = { x: e.x, y: e.y };
    marquee.shift = e.shift;
    marquee.alt = e.alt;
    if (marquee.moving) engine.antsShift = { x: Math.round(e.x - marquee.start.x), y: Math.round(e.y - marquee.start.y) };
  },
  up(engine, e) {
    const d = marquee;
    marquee = null;
    if (!d) return;
    d.cur = { x: e.x, y: e.y };
    const doc = engine.doc!;
    if (d.moving) {
      engine.antsShift = null;
      const dx = Math.round(d.cur.x - d.start.x);
      const dy = Math.round(d.cur.y - d.start.y);
      if ((dx || dy) && doc.selection) {
        const moved = translateMask(doc.selection.mask, doc.width, doc.height, dx, dy);
        engine.commit(setSelection(doc, selectionFromMask(moved, doc.width, doc.height)), 'Move Selection');
      }
      return;
    }
    const o = engine.store.opts.marquee;
    const r = marqueeRect(engine, d);
    if (o.style !== 'size' && (r.w < 1 || r.h < 1)) {
      if (d.mode === 'new' && doc.selection) engine.commit(setSelection(doc, null), 'Deselect');
      return;
    }
    const mask = o.shape === 'ellipse' ? ellipseMask(doc.width, doc.height, r) : rectMask(doc.width, doc.height, r);
    applySelectionMask(engine, mask, d.mode, o.feather, o.shape === 'ellipse' ? 'Elliptical Marquee' : 'Rectangular Marquee');
  },
  key(engine, e) {
    if (e.key === 'Escape' && marquee) {
      marquee = null;
      engine.antsShift = null;
      engine.requestOverlay();
      return true;
    }
    return false;
  },
  overlay(engine, ctx) {
    if (!marquee || marquee.moving) return;
    const r = screenRect(engine, marqueeRect(engine, marquee));
    dashed(ctx, () => {
      ctx.beginPath();
      if (engine.store.opts.marquee.shape === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
      else ctx.rect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    });
  },
  deactivate(engine) {
    marquee = null;
    engine.antsShift = null;
  },
};

/* ---------------------------------- Lasso ---------------------------------- */

interface LassoState {
  points: Point[];
  mode: SelectionMode;
  polygon: boolean;
  hover: Point | null;
}

let lasso: LassoState | null = null;

function finishLasso(engine: PhotoEngine): void {
  const l = lasso;
  lasso = null;
  engine.requestOverlay();
  const doc = engine.doc;
  if (!l || !doc) return;
  if (l.points.length < 3) {
    if (l.mode === 'new' && doc.selection && !l.polygon) engine.commit(setSelection(doc, null), 'Deselect');
    return;
  }
  const mask = polygonMask(doc.width, doc.height, l.points);
  applySelectionMask(engine, mask, l.mode, engine.store.opts.lasso.feather, l.polygon ? 'Polygonal Lasso' : 'Lasso');
}

export const lassoTool: ToolHandler = {
  cursor: () => 'crosshair',
  down(engine, e) {
    const polygon = engine.store.opts.lasso.kind === 'polygon';
    const p = { x: e.x, y: e.y };
    if (polygon && lasso?.polygon) {
      const first = engine.docToScreen(lasso.points[0].x, lasso.points[0].y);
      if (lasso.points.length >= 3 && Math.hypot(first.x - e.sx, first.y - e.sy) < 8) {
        finishLasso(engine);
        return;
      }
      lasso.points.push(p);
      return;
    }
    lasso = { points: [p], mode: modeFromEvent(e, engine.store.opts.selMode), polygon, hover: null };
  },
  move(engine, e) {
    if (!lasso) return;
    if (lasso.polygon) {
      lasso.hover = { x: e.x, y: e.y };
      return;
    }
    const last = lasso.points[lasso.points.length - 1];
    if (Math.hypot(last.x - e.x, last.y - e.y) * engine.zoom >= 1.5) lasso.points.push({ x: e.x, y: e.y });
  },
  hover(_engine, e) {
    if (lasso?.polygon) lasso.hover = { x: e.x, y: e.y };
  },
  up(engine) {
    if (lasso && !lasso.polygon) finishLasso(engine);
  },
  dblclick(engine) {
    if (lasso?.polygon) {
      // the double click added the same point twice
      lasso.points.pop();
      finishLasso(engine);
    }
  },
  key(engine, e) {
    if (!lasso) return false;
    if (e.key === 'Escape') {
      lasso = null;
      engine.requestOverlay();
      return true;
    }
    if (e.key === 'Enter') {
      finishLasso(engine);
      return true;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && lasso.polygon) {
      lasso.points.pop();
      if (!lasso.points.length) lasso = null;
      engine.requestOverlay();
      return true;
    }
    return false;
  },
  overlay(engine, ctx) {
    if (!lasso || !lasso.points.length) return;
    const pts = lasso.points.map((p) => engine.docToScreen(p.x, p.y));
    dashed(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      if (lasso?.polygon && lasso.hover) {
        const h = engine.docToScreen(lasso.hover.x, lasso.hover.y);
        ctx.lineTo(h.x, h.y);
      }
    });
    if (lasso.polygon) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  },
  deactivate(engine) {
    if (lasso?.polygon && lasso.points.length >= 3) finishLasso(engine);
    lasso = null;
  },
};

/* -------------------------------- Magic wand -------------------------------- */

let layerPixelCache: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; data: Uint8ClampedArray } | null = null;

/** Pixels of the active layer's content in document space (cached). */
export function activeLayerDocPixels(engine: PhotoEngine): Uint8ClampedArray | null {
  const doc = engine.doc;
  const layer = engine.activeLayer();
  if (!doc || !layer) return null;
  const c = layerContent(layer);
  if (!c) return new Uint8ClampedArray(doc.width * doc.height * 4);
  const hit = layerPixelCache;
  if (hit && hit.canvas === c.canvas && hit.x === c.x && hit.y === c.y && hit.w === doc.width && hit.h === doc.height) return hit.data;
  const data = pixelsInArea(c.canvas, c.x, c.y, { x: 0, y: 0, w: doc.width, h: doc.height });
  layerPixelCache = { canvas: c.canvas, x: c.x, y: c.y, w: doc.width, h: doc.height, data };
  return data;
}

export function sourcePixels(engine: PhotoEngine, sampleAll: boolean): Uint8ClampedArray | null {
  return sampleAll ? (engine.compositePixels()?.data ?? null) : activeLayerDocPixels(engine);
}

export function wandMask(engine: PhotoEngine, doc: PhotoDoc, e: ToolEvent, o: { tolerance: number; contiguous: boolean; sampleAll: boolean; antiAlias: boolean }): Uint8Array | null {
  const data = sourcePixels(engine, o.sampleAll);
  if (!data) return null;
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  const mask = floodMask(data, doc.width, doc.height, x, y, o.tolerance, o.contiguous);
  return o.antiAlias ? antialiasMask(mask, doc.width, doc.height) : mask;
}

export const wandTool: ToolHandler = {
  cursor: () => 'crosshair',
  down(engine, e) {
    const doc = engine.doc!;
    const o = engine.store.opts.wand;
    const mask = wandMask(engine, doc, e, o);
    const mode = modeFromEvent(e, engine.store.opts.selMode);
    if (!mask) {
      if (mode === 'new' && doc.selection) engine.commit(setSelection(doc, null), 'Deselect');
      return;
    }
    applySelectionMask(engine, mask, mode, 0, 'Magic Wand');
  },
};
