/**
 * Paint Bucket and Gradient tools.
 */
import { ctx2d, makeCanvas, selectionCanvas } from '../canvas';
import { findLayer, updateLayer } from '../doc';
import { fillLayer, workArea } from '../docops';
import type { PhotoEngine } from '../engine';
import { luma, parseHex } from '../pixels/adjust';
import { antialiasMask, floodMask } from '../pixels/flood';
import { selectionFromMask } from '../selection';
import type { Layer, PhotoDoc, Point, Rect } from '../types';
import { snapAngle } from './brushMath';
import { paintTarget } from './paint';
import { sourcePixels } from './select';
import type { ToolHandler } from './types';

/* ---------------------------------- Bucket ---------------------------------- */

export const bucketTool: ToolHandler = {
  cursor: () => 'crosshair',
  down(engine, e) {
    const target = paintTarget(engine);
    const doc = engine.doc;
    if (!target || !doc) return;
    const o = engine.store.opts.bucket;
    const x = Math.floor(e.x);
    const y = Math.floor(e.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const data = sourcePixels(engine, o.sampleAll);
    if (!data) return;
    let mask = floodMask(data, doc.width, doc.height, x, y, o.tolerance, o.contiguous);
    if (o.antiAlias) mask = antialiasMask(mask, doc.width, doc.height);
    if (doc.selection) {
      const s = doc.selection.mask;
      for (let i = 0; i < mask.length; i++) if (mask[i]) mask[i] = (mask[i] * s[i]) / 255;
    }
    const fillSel = selectionFromMask(mask, doc.width, doc.height);
    if (!fillSel) return;
    const next = fillLayer(doc, target.layer.id, engine.store.fg, { opacity: o.opacity, onMask: target.target === 'mask', selection: fillSel });
    engine.commit(next, 'Paint Bucket');
  },
};

/* --------------------------------- Gradient --------------------------------- */

let grad: { start: Point; end: Point } | null = null;

function colorStops(engine: PhotoEngine): [string, string] {
  const o = engine.store.opts.gradient;
  const fg = engine.store.fg;
  const to = o.colors === 'fg-bg' ? engine.store.bg : transparentOf(fg);
  return o.reverse ? [to, fg] : [fg, to];
}

function transparentOf(color: string): string {
  const [r, g, b] = parseHex(color);
  return `rgba(${r}, ${g}, ${b}, 0)`;
}

function gradientCanvas(engine: PhotoEngine, area: Rect, start: Point, end: Point, stops: [string, string]): HTMLCanvasElement {
  const o = engine.store.opts.gradient;
  const c = makeCanvas(area.w, area.h);
  const ctx = ctx2d(c);
  const sx = start.x - area.x;
  const sy = start.y - area.y;
  const ex = end.x - area.x;
  const ey = end.y - area.y;
  const g = o.type === 'radial' ? ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.hypot(ex - sx, ey - sy)) : ctx.createLinearGradient(sx, sy, ex, ey);
  g.addColorStop(0, stops[0]);
  g.addColorStop(1, stops[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, area.w, area.h);
  return c;
}

/** Draws `overlay` (area sized) through the document selection onto `base`. */
function selectionClipped(doc: PhotoDoc, overlay: HTMLCanvasElement, area: Rect): HTMLCanvasElement {
  const sel = doc.selection;
  if (!sel) return overlay;
  const ctx = ctx2d(overlay);
  ctx.globalCompositeOperation = 'destination-in';
  const m = makeCanvas(area.w, area.h);
  ctx2d(m).drawImage(selectionCanvas(sel), sel.bounds.x - area.x, sel.bounds.y - area.y);
  ctx.drawImage(m, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return overlay;
}

function applyGradient(engine: PhotoEngine, layer: Layer, target: 'layer' | 'mask', start: Point, end: Point): void {
  const doc = engine.doc!;
  const o = engine.store.opts.gradient;
  const [c0, c1] = colorStops(engine);
  if (target === 'mask' && layer.mask) {
    const m = layer.mask;
    const area = { x: m.x, y: m.y, w: m.canvas.width, h: m.canvas.height };
    const gray = (c: string) => {
      if (c.startsWith('rgba')) return null;
      const [r, g, b] = parseHex(c);
      return luma(r, g, b) / 255;
    };
    const g0 = gray(c0);
    const g1 = gray(c1);
    // weight ramp (how much is replaced) and value ramp (white with alpha = gray)
    const weight = gradientCanvas(engine, area, start, end, [g0 === null ? 'rgba(255,255,255,0)' : '#ffffff', g1 === null ? 'rgba(255,255,255,0)' : '#ffffff']);
    const value = gradientCanvas(engine, area, start, end, [`rgba(255,255,255,${g0 ?? g1 ?? 0})`, `rgba(255,255,255,${g1 ?? g0 ?? 0})`]);
    selectionClipped(doc, weight, area);
    const vctx = ctx2d(value);
    vctx.globalCompositeOperation = 'destination-in';
    vctx.drawImage(weight, 0, 0);
    const out = makeCanvas(area.w, area.h);
    const ctx = ctx2d(out);
    ctx.drawImage(m.canvas, 0, 0);
    ctx.globalAlpha = o.opacity;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(weight, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(value, 0, 0);
    engine.commit(updateLayer(doc, layer.id, { mask: { ...m, canvas: out } } as Partial<Layer>), 'Gradient');
    return;
  }
  if (layer.type !== 'raster') return;
  const area = workArea(doc, layer);
  const g = selectionClipped(doc, gradientCanvas(engine, area, start, end, [c0, c1]), area);
  const out = makeCanvas(area.w, area.h);
  const ctx = ctx2d(out);
  ctx.drawImage(layer.canvas, layer.x - area.x, layer.y - area.y);
  ctx.globalAlpha = o.opacity;
  ctx.drawImage(g, 0, 0);
  engine.commit(updateLayer(doc, layer.id, { canvas: out, x: area.x, y: area.y } as Partial<Layer>), 'Gradient');
}

export const gradientTool: ToolHandler = {
  cursor: () => 'crosshair',
  down(_engine, e) {
    grad = { start: { x: e.x, y: e.y }, end: { x: e.x, y: e.y } };
  },
  move(_engine, e) {
    if (!grad) return;
    grad.end = e.shift ? snapAngle(grad.start, e) : { x: e.x, y: e.y };
  },
  up(engine) {
    const g = grad;
    grad = null;
    if (!g || Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) < 1) return;
    const target = paintTarget(engine);
    if (!target || !findLayer(engine.doc!, target.layer.id)) return;
    applyGradient(engine, target.layer, target.target, g.start, g.end);
  },
  key(engine, e) {
    if (e.key === 'Escape' && grad) {
      grad = null;
      engine.requestOverlay();
      return true;
    }
    return false;
  },
  overlay(engine, ctx) {
    if (!grad) return;
    const a = engine.docToScreen(grad.start.x, grad.start.y);
    const b = engine.docToScreen(grad.end.x, grad.end.y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.stroke();
    }
  },
};
