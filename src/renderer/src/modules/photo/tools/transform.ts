/**
 * Move tool (layers, selected pixels, nudging), Free Transform (scale / rotate handles) and
 * the Crop tool (aspect presets, straighten angle).
 */
import { toast } from '../../../components/ui';
import { t } from '../../../core/i18n';
import { cachedAlphaBounds, ctx2d, makeCanvas, selectionCanvas } from '../canvas';
import { findLayer, offsetLayer, setActiveLayer, updateLayer } from '../doc';
import { transformLayerFree } from '../docops';
import type { PhotoEngine } from '../engine';
import { hitTestLayer, layerBox, layoutText, shapeBox } from '../render';
import { selectionFromMask, translateMask, unionRects } from '../selection';
import type { Layer, PhotoDoc, Point, Rect } from '../types';
import type { ToolEvent, ToolHandler } from './types';

const rad = (d: number) => (d * Math.PI) / 180;

export function topLayerAt(doc: PhotoDoc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.visible && hitTestLayer(l, x, y)) return l;
  }
  return null;
}

/* ------------------------------ floating pixels ------------------------------ */

interface Floating {
  layerId: string;
  doc: PhotoDoc;
  pixels: HTMLCanvasElement;
  px: number;
  py: number;
  base: HTMLCanvasElement;
  baseX: number;
  baseY: number;
}

function liftSelection(doc: PhotoDoc, layerId: string, copy: boolean): Floating | null {
  const layer = findLayer(doc, layerId);
  const sel = doc.selection;
  if (!layer || layer.type !== 'raster' || !sel) return null;
  const b = sel.bounds;
  const pixels = makeCanvas(b.w, b.h);
  const pc = ctx2d(pixels);
  pc.drawImage(layer.canvas, layer.x - b.x, layer.y - b.y);
  pc.globalCompositeOperation = 'destination-in';
  pc.drawImage(selectionCanvas(sel), 0, 0);
  let base = layer.canvas;
  if (!copy) {
    base = makeCanvas(layer.canvas.width, layer.canvas.height);
    const bc = ctx2d(base);
    bc.drawImage(layer.canvas, 0, 0);
    bc.globalCompositeOperation = 'destination-out';
    bc.drawImage(selectionCanvas(sel), b.x - layer.x, b.y - layer.y);
  }
  return { layerId, doc, pixels, px: b.x, py: b.y, base, baseX: layer.x, baseY: layer.y };
}

function floatingResult(f: Floating, dx: number, dy: number): { canvas: HTMLCanvasElement; x: number; y: number } {
  const docR = { x: 0, y: 0, w: f.doc.width, h: f.doc.height };
  const area = unionRects(unionRects(docR, { x: f.baseX, y: f.baseY, w: f.base.width, h: f.base.height }), { x: f.px + dx, y: f.py + dy, w: f.pixels.width, h: f.pixels.height })!;
  const c = makeCanvas(area.w, area.h);
  const ctx = ctx2d(c);
  ctx.drawImage(f.base, f.baseX - area.x, f.baseY - area.y);
  ctx.drawImage(f.pixels, f.px + dx - area.x, f.py + dy - area.y);
  return { canvas: c, x: area.x, y: area.y };
}

function commitFloating(engine: PhotoEngine, f: Floating, dx: number, dy: number, label: string): void {
  const r = floatingResult(f, dx, dy);
  let next = updateLayer(f.doc, f.layerId, { canvas: r.canvas, x: r.x, y: r.y } as Partial<Layer>);
  const sel = f.doc.selection;
  if (sel) next = { ...next, selection: selectionFromMask(translateMask(sel.mask, sel.width, sel.height, dx, dy), sel.width, sel.height) };
  engine.setContentOverride(f.layerId, null);
  engine.antsShift = null;
  engine.commit(next, label);
}

/* ---------------------------------- Move ---------------------------------- */

interface MoveState {
  start: Point;
  layerId: string;
  docAtStart: PhotoDoc;
  layerAtStart: Layer;
  floating: Floating | null;
  dx: number;
  dy: number;
}

let mv: MoveState | null = null;

function constrained(start: Point, e: ToolEvent): Point {
  let dx = e.x - start.x;
  let dy = e.y - start.y;
  if (e.shift) {
    if (Math.abs(dx) > Math.abs(dy) * 2) dy = 0;
    else if (Math.abs(dy) > Math.abs(dx) * 2) dx = 0;
    else {
      const m = (Math.abs(dx) + Math.abs(dy)) / 2;
      dx = Math.sign(dx) * m;
      dy = Math.sign(dy) * m;
    }
  }
  return { x: Math.round(dx), y: Math.round(dy) };
}

export function nudge(engine: PhotoEngine, dx: number, dy: number): void {
  const doc = engine.doc;
  const layer = engine.activeLayer();
  if (!doc || !engine.canEdit(layer)) return;
  if (doc.selection && layer.type === 'raster' && !engine.store.maskEdit) {
    const f = liftSelection(doc, layer.id, false);
    if (f) commitFloating(engine, f, dx, dy, 'Nudge');
    return;
  }
  engine.commit(updateLayer(doc, layer.id, (l) => offsetLayer(l, dx, dy)), 'Nudge');
}

const moveBase: ToolHandler = {
  cursor: () => 'move',
  down(engine, e) {
    let doc = engine.doc!;
    if (engine.store.opts.move.autoSelect || e.mod) {
      const hit = topLayerAt(doc, e.x, e.y);
      if (hit && hit.id !== doc.activeId) {
        engine.live(setActiveLayer(doc, hit.id));
        doc = engine.doc!;
      }
    }
    const layer = engine.activeLayer();
    if (!engine.canEdit(layer)) return;
    const floating = doc.selection && layer.type === 'raster' && !engine.store.maskEdit ? liftSelection(doc, layer.id, e.alt) : null;
    mv = { start: { x: e.x, y: e.y }, layerId: layer.id, docAtStart: doc, layerAtStart: layer, floating, dx: 0, dy: 0 };
  },
  move(engine, e) {
    if (!mv) return;
    const d = constrained(mv.start, e);
    if (d.x === mv.dx && d.y === mv.dy) return;
    mv.dx = d.x;
    mv.dy = d.y;
    if (mv.floating) {
      engine.setContentOverride(mv.layerId, floatingResult(mv.floating, d.x, d.y));
      engine.antsShift = { x: d.x, y: d.y };
      engine.requestRender();
    } else {
      const base = mv.layerAtStart;
      engine.live(updateLayer(mv.docAtStart, mv.layerId, () => offsetLayer(base, d.x, d.y)));
    }
  },
  up(engine) {
    const s = mv;
    mv = null;
    if (!s) return;
    if (!s.dx && !s.dy) {
      if (s.floating) engine.setContentOverride(s.layerId, null);
      engine.antsShift = null;
      return;
    }
    if (s.floating) commitFloating(engine, s.floating, s.dx, s.dy, 'Move');
    else engine.commitLive('Move');
  },
};

/* ------------------------------ Free transform ------------------------------ */

interface TransformState {
  layerId: string;
  docAtStart: PhotoDoc;
  layer: Layer;
  box: Rect;
  r0: number;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  rot: number;
  drag: null | {
    kind: 'move' | 'scale' | 'rotate';
    hx: number;
    hy: number;
    start: Point;
    p0: { tx: number; ty: number; sx: number; sy: number; rot: number };
  };
  preview: HTMLCanvasElement | null;
  maskPreview: HTMLCanvasElement | null;
}

let tf: TransformState | null = null;

export function isTransforming(): boolean {
  return tf !== null;
}

export function startFreeTransform(engine: PhotoEngine): boolean {
  const doc = engine.doc;
  const layer = engine.activeLayer();
  if (!doc || !engine.canEdit(layer)) return false;
  let box: Rect;
  let r0 = 0;
  if (layer.type === 'raster') {
    const b = cachedAlphaBounds(layer.canvas);
    if (!b) {
      toast.info(t('The layer is empty'));
      return false;
    }
    box = { x: layer.x + b.x, y: layer.y + b.y, w: b.w, h: b.h };
  } else if (layer.type === 'text') {
    box = layoutText(layer).box;
    r0 = layer.rotation;
  } else {
    box = shapeBox(layer);
    r0 = layer.rotation;
    if (box.w < 1) box = { ...box, x: box.x - 0.5, w: 1 };
    if (box.h < 1) box = { ...box, y: box.y - 0.5, h: 1 };
  }
  tf = { layerId: layer.id, docAtStart: doc, layer, box, r0, tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, drag: null, preview: null, maskPreview: null };
  engine.store.setTransforming(true);
  engine.showAnts = false;
  if (engine.store.tool !== 'move') engine.store.setTool('move');
  engine.requestOverlay();
  return true;
}

function tfCenter(s: TransformState): Point {
  return { x: s.box.x + s.box.w / 2 + s.tx, y: s.box.y + s.box.h / 2 + s.ty };
}

function tfToDoc(s: TransformState, lx: number, ly: number): Point {
  const c = tfCenter(s);
  const a = rad(s.r0 + s.rot);
  return { x: c.x + lx * Math.cos(a) - ly * Math.sin(a), y: c.y + lx * Math.sin(a) + ly * Math.cos(a) };
}

function tfToLocal(s: TransformState, p: Point, center = tfCenter(s)): Point {
  const a = rad(-(s.r0 + s.rot));
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

function tfParams(s: TransformState) {
  return { cx: s.box.x + s.box.w / 2, cy: s.box.y + s.box.h / 2, sx: s.sx, sy: s.sy, rotation: s.rot, tx: s.tx, ty: s.ty };
}

function drawTransformed(src: HTMLCanvasElement, sx0: number, sy0: number, s: TransformState, reuse: HTMLCanvasElement | null): { canvas: HTMLCanvasElement; x: number; y: number } {
  const p = tfParams(s);
  const a = rad(p.rotation);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const m = [cos * p.sx, sin * p.sx, -sin * p.sy, cos * p.sy, p.cx + p.tx - (cos * p.sx * p.cx - sin * p.sy * p.cy), p.cy + p.ty - (sin * p.sx * p.cx + cos * p.sy * p.cy)];
  const pts = [
    [sx0, sy0],
    [sx0 + src.width, sy0],
    [sx0, sy0 + src.height],
    [sx0 + src.width, sy0 + src.height],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const bx = Math.floor(Math.min(...pts.map((q) => q[0])));
  const by = Math.floor(Math.min(...pts.map((q) => q[1])));
  const w = Math.max(1, Math.ceil(Math.max(...pts.map((q) => q[0]))) - bx);
  const h = Math.max(1, Math.ceil(Math.max(...pts.map((q) => q[1]))) - by);
  const canvas = reuse && reuse.width >= w && reuse.height >= h && reuse.width * reuse.height < w * h * 4 ? reuse : makeCanvas(w, h);
  const ctx = ctx2d(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - bx, m[5] - by);
  ctx.drawImage(src, sx0, sy0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, x: bx, y: by };
}

function updateTransformPreview(engine: PhotoEngine): void {
  const s = tf;
  if (!s) return;
  if (s.layer.type === 'raster') {
    const r = drawTransformed(s.layer.canvas, s.layer.x, s.layer.y, s, s.preview);
    s.preview = r.canvas;
    engine.setContentOverride(s.layerId, r);
    if (s.layer.mask) {
      const mr = drawTransformed(s.layer.mask.canvas, s.layer.mask.x, s.layer.mask.y, s, s.maskPreview);
      s.maskPreview = mr.canvas;
      engine.setMaskOverride(s.layerId, mr);
    }
    engine.requestRender();
  } else {
    engine.live(transformLayerFree(s.docAtStart, s.layerId, tfParams(s)));
  }
}

export function applyFreeTransform(engine: PhotoEngine): void {
  const s = tf;
  if (!s) return;
  tf = null;
  engine.store.setTransforming(false);
  engine.showAnts = true;
  engine.setContentOverride(s.layerId, null);
  engine.setMaskOverride(s.layerId, null);
  const changed = s.tx || s.ty || s.sx !== 1 || s.sy !== 1 || s.rot;
  if (!changed) {
    engine.history?.discardLive();
    engine.requestRender();
    return;
  }
  try {
    engine.history?.discardLive();
    engine.commit(transformLayerFree(s.docAtStart, s.layerId, tfParams(s)), 'Free Transform');
  } catch (error) {
    engine.reportError(error);
  }
  engine.requestRender();
}

export function cancelFreeTransform(engine: PhotoEngine): void {
  const s = tf;
  if (!s) return;
  tf = null;
  engine.store.setTransforming(false);
  engine.showAnts = true;
  engine.setContentOverride(s.layerId, null);
  engine.setMaskOverride(s.layerId, null);
  engine.history?.discardLive();
  engine.requestRender();
}

function tfHit(engine: PhotoEngine, e: ToolEvent): { kind: 'move' | 'scale' | 'rotate'; hx: number; hy: number } {
  const s = tf!;
  const hw = (s.box.w / 2) * s.sx;
  const hh = (s.box.h / 2) * s.sy;
  for (const hx of [-1, 0, 1]) {
    for (const hy of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      const p = tfToDoc(s, hx * hw, hy * hh);
      const sp = engine.docToScreen(p.x, p.y);
      if (Math.hypot(sp.x - e.sx, sp.y - e.sy) <= 7) return { kind: 'scale', hx, hy };
    }
  }
  const q = tfToLocal(s, e);
  if (Math.abs(q.x) <= Math.abs(hw) && Math.abs(q.y) <= Math.abs(hh)) return { kind: 'move', hx: 0, hy: 0 };
  return { kind: 'rotate', hx: 0, hy: 0 };
}

const transformHandler: ToolHandler = {
  down(engine, e) {
    const s = tf!;
    const hit = tfHit(engine, e);
    s.drag = { ...hit, start: { x: e.x, y: e.y }, p0: { tx: s.tx, ty: s.ty, sx: s.sx, sy: s.sy, rot: s.rot } };
  },
  move(engine, e) {
    const s = tf;
    if (!s?.drag) return;
    const d = s.drag;
    if (d.kind === 'move') {
      const c = constrained(d.start, e);
      s.tx = d.p0.tx + c.x;
      s.ty = d.p0.ty + c.y;
    } else if (d.kind === 'rotate') {
      const c = tfCenter(s);
      const a0 = Math.atan2(d.start.y - c.y, d.start.x - c.x);
      const a1 = Math.atan2(e.y - c.y, e.x - c.x);
      let rot = d.p0.rot + ((a1 - a0) * 180) / Math.PI;
      if (e.shift) rot = Math.round((s.r0 + rot) / 15) * 15 - s.r0;
      s.rot = rot;
    } else {
      // scale: work in the box's local frame at the start of the drag
      Object.assign(s, d.p0);
      const c0 = tfCenter(s);
      const q = tfToLocal(s, e, c0);
      const hw0 = (s.box.w / 2) * d.p0.sx;
      const hh0 = (s.box.h / 2) * d.p0.sy;
      const fromCenter = e.alt;
      let w = s.box.w * d.p0.sx;
      let h = s.box.h * d.p0.sy;
      let lcx = 0;
      let lcy = 0;
      if (d.hx) w = fromCenter ? 2 * q.x * d.hx : q.x * d.hx + hw0;
      if (d.hy) h = fromCenter ? 2 * q.y * d.hy : q.y * d.hy + hh0;
      let nsx = d.hx ? w / s.box.w : d.p0.sx;
      let nsy = d.hy ? h / s.box.h : d.p0.sy;
      const lockAspect = d.hx && d.hy ? !e.shift : false;
      if (lockAspect) {
        const k = Math.max(Math.abs(nsx / d.p0.sx), Math.abs(nsy / d.p0.sy));
        nsx = Math.sign(nsx || 1) * Math.abs(d.p0.sx) * k;
        nsy = Math.sign(nsy || 1) * Math.abs(d.p0.sy) * k;
      }
      if (!fromCenter) {
        if (d.hx) lcx = -d.hx * hw0 + (d.hx * (s.box.w * nsx)) / 2;
        if (d.hy) lcy = -d.hy * hh0 + (d.hy * (s.box.h * nsy)) / 2;
      }
      const a = rad(s.r0 + s.rot);
      s.sx = Math.abs(nsx) < 0.001 ? 0.001 : nsx;
      s.sy = Math.abs(nsy) < 0.001 ? 0.001 : nsy;
      s.tx = d.p0.tx + lcx * Math.cos(a) - lcy * Math.sin(a);
      s.ty = d.p0.ty + lcx * Math.sin(a) + lcy * Math.cos(a);
    }
    updateTransformPreview(engine);
  },
  up(_engine) {
    if (tf) tf.drag = null;
  },
  hover(engine, e) {
    const hit = tfHit(engine, e);
    engine.onCursor?.(hit.kind === 'move' ? 'move' : hit.kind === 'rotate' ? 'alias' : 'nwse-resize');
  },
  dblclick(engine) {
    applyFreeTransform(engine);
  },
  key(engine, e) {
    if (e.key === 'Enter') {
      applyFreeTransform(engine);
      return true;
    }
    if (e.key === 'Escape') {
      cancelFreeTransform(engine);
      return true;
    }
    return false;
  },
  overlay(engine, ctx) {
    const s = tf;
    if (!s) return;
    const hw = (s.box.w / 2) * s.sx;
    const hh = (s.box.h / 2) * s.sy;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => {
      const p = tfToDoc(s, x * hw, y * hh);
      return engine.docToScreen(p.x, p.y);
    });
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ff';
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    for (const hx of [-1, 0, 1]) {
      for (const hy of [-1, 0, 1]) {
        if (!hx && !hy) continue;
        const p = tfToDoc(s, hx * hw, hy * hh);
        const sp = engine.docToScreen(p.x, p.y);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sp.x - 4, sp.y - 4, 8, 8);
        ctx.strokeRect(sp.x - 4 + 0.5, sp.y - 4 + 0.5, 7, 7);
      }
    }
    const c = tfCenter(s);
    const cs = engine.docToScreen(c.x, c.y);
    ctx.beginPath();
    ctx.arc(cs.x, cs.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  },
};

export const moveTool: ToolHandler = {
  cursor: () => (tf ? 'default' : 'move'),
  down: (engine, e) => (tf ? transformHandler.down!(engine, e) : moveBase.down!(engine, e)),
  move: (engine, e) => (tf ? transformHandler.move!(engine, e) : moveBase.move!(engine, e)),
  up: (engine, e) => (tf ? transformHandler.up!(engine, e) : moveBase.up!(engine, e)),
  hover: (engine, e) => {
    if (tf) transformHandler.hover!(engine, e);
  },
  dblclick: (engine, e) => {
    if (tf) {
      transformHandler.dblclick!(engine, e);
      return;
    }
    const doc = engine.doc!;
    const hit = topLayerAt(doc, e.x, e.y);
    if (hit?.type === 'text') engine.startTextEdit(hit.id);
  },
  key(engine, e) {
    if (tf) return transformHandler.key!(engine, e);
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = arrows[e.key];
    if (d && !e.ctrlKey && !e.metaKey) {
      const step = e.shiftKey ? 10 : 1;
      nudge(engine, d[0] * step, d[1] * step);
      return true;
    }
    return false;
  },
  overlay(engine, ctx) {
    if (tf) {
      transformHandler.overlay!(engine, ctx);
      return;
    }
    // bounding box of the active layer
    const layer = engine.activeLayer();
    if (!layer || mv) return;
    let box = layerBox(layer);
    if (layer.type === 'raster') {
      const b = cachedAlphaBounds(layer.canvas);
      if (!b) return;
      box = { x: layer.x + b.x, y: layer.y + b.y, w: b.w, h: b.h };
    }
    const rot = layer.type === 'raster' ? 0 : layer.rotation;
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const a = rad(rot);
    const pts = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => {
      const lx = (x * box.w) / 2;
      const ly = (y * box.h) / 2;
      return engine.docToScreen(c.x + lx * Math.cos(a) - ly * Math.sin(a), c.y + lx * Math.sin(a) + ly * Math.cos(a));
    });
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(47,128,255,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  },
  deactivate(engine) {
    if (tf) applyFreeTransform(engine);
    mv = null;
  },
};
