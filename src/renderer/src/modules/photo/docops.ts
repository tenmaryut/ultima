/**
 * Document operations that create new pixel buffers (DOM canvases). Every function returns
 * a new PhotoDoc and never mutates canvases referenced by the input document.
 */
import { anyEffect, findLayer, insertLayer, layerIndex, makeRasterLayer, nextLayerName, updateLayer } from './doc';
import { ctx2d, makeCanvas, maskCanvasFromSelection, readPixels, selectionCanvas, solidMaskCanvas, invertMaskCanvas, canvasFromPixels } from './canvas';
import { drawLayer, flattenToCanvas, layerBox, layerContent, layoutText, shapeBox } from './render';
import { alphaToMask, intersectRects, reframeSelection, selectionFromMask, unionRects } from './selection';
import { luma, parseHex } from './pixels/adjust';
import type { Layer, LayerEffects, LayerMask, PhotoDoc, RasterLayer, Rect, Selection, ShapeLayer, TextLayer } from './types';

const docRect = (doc: PhotoDoc): Rect => ({ x: 0, y: 0, w: doc.width, h: doc.height });

/* ---------------------------------- layers ---------------------------------- */

export function rasterizeLayer(doc: PhotoDoc, id: string): PhotoDoc {
  return updateLayer(doc, id, (l) => {
    if (l.type === 'raster') return l;
    const c = layerContent(l);
    const canvas = c ? c.canvas : makeCanvas(1, 1);
    const raster: RasterLayer = {
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blend: l.blend,
      mask: l.mask,
      effects: l.effects,
      type: 'raster',
      canvas,
      x: c ? c.x : 0,
      y: c ? c.y : 0,
    };
    return raster;
  });
}

export function addEmptyLayer(doc: PhotoDoc, name?: string): PhotoDoc {
  return insertLayer(doc, makeRasterLayer(name ?? nextLayerName(doc), makeCanvas(doc.width, doc.height)));
}

/** Union of the document and the layer's extent (where painting may happen). */
export function workArea(doc: PhotoDoc, layer: RasterLayer): Rect {
  return unionRects(docRect(doc), { x: layer.x, y: layer.y, w: layer.canvas.width, h: layer.canvas.height })!;
}

/** Bakes mask + effects of `lower`, then draws `upper` with its opacity/blend onto it. */
export function mergeDown(doc: PhotoDoc, id: string): PhotoDoc {
  const i = layerIndex(doc, id);
  if (i <= 0) return doc;
  const upper = doc.layers[i];
  const lower = doc.layers[i - 1];
  const area = unionRects(unionRects(docRect(doc), layerBox(lower)), layerBox(upper))!;
  const a = { x: Math.floor(area.x), y: Math.floor(area.y), w: Math.ceil(area.w), h: Math.ceil(area.h) };
  const canvas = makeCanvas(a.w, a.h);
  const ctx = ctx2d(canvas);
  ctx.translate(-a.x, -a.y);
  ctx.save();
  drawLayer(ctx, { ...lower, visible: true, opacity: 1, blend: 'source-over' }, a);
  ctx.restore();
  if (upper.visible) {
    ctx.save();
    drawLayer(ctx, upper, a);
    ctx.restore();
  }
  const merged: RasterLayer = {
    id: lower.id,
    name: lower.name,
    visible: lower.visible,
    locked: false,
    opacity: lower.opacity,
    blend: lower.blend,
    mask: null,
    effects: {},
    type: 'raster',
    canvas,
    x: a.x,
    y: a.y,
  };
  const layers = [...doc.layers];
  layers.splice(i - 1, 2, merged);
  return { ...doc, layers, activeId: merged.id };
}

export function mergeVisible(doc: PhotoDoc): PhotoDoc {
  const visible = doc.layers.filter((l) => l.visible);
  if (visible.length < 2) return doc;
  const canvas = flattenToCanvas({ ...doc, layers: visible });
  const top = visible[visible.length - 1];
  const merged = makeRasterLayer(top.name, canvas);
  const layers: Layer[] = [];
  for (const l of doc.layers) {
    if (!l.visible) layers.push(l);
    else if (l === top) layers.push(merged);
  }
  return { ...doc, layers, activeId: merged.id };
}

export function flattenImage(doc: PhotoDoc, name = 'Background'): PhotoDoc {
  const canvas = flattenToCanvas(doc);
  const layer = makeRasterLayer(name, canvas);
  return { ...doc, layers: [layer], activeId: layer.id };
}

/* ----------------------------------- masks ----------------------------------- */

export function addMask(doc: PhotoDoc, id: string, mode: 'reveal' | 'hide' | 'selection'): PhotoDoc {
  let mask: LayerMask;
  if (mode === 'selection' && doc.selection) mask = { canvas: maskCanvasFromSelection(doc.selection), x: 0, y: 0, reveal: false, enabled: true };
  else mask = { canvas: solidMaskCanvas(doc.width, doc.height, mode !== 'hide'), x: 0, y: 0, reveal: mode !== 'hide', enabled: true };
  return updateLayer(doc, id, { mask } as Partial<Layer>);
}

export function deleteMask(doc: PhotoDoc, id: string): PhotoDoc {
  return updateLayer(doc, id, { mask: null } as Partial<Layer>);
}

export function invertLayerMask(doc: PhotoDoc, id: string): PhotoDoc {
  return updateLayer(doc, id, (l) => {
    if (!l.mask) return l;
    // inverting also flips the meaning of the area outside the mask canvas
    return { ...l, mask: { ...l.mask, canvas: invertMaskCanvas(l.mask.canvas), reveal: !l.mask.reveal } } as Layer;
  });
}

/** Bakes the mask into the layer's pixels (rasterizes text/shape layers). */
export function applyMask(doc: PhotoDoc, id: string): PhotoDoc {
  const layer = findLayer(doc, id);
  if (!layer?.mask) return doc;
  const content = layerContent(layer);
  if (!content) return deleteMask(doc, id);
  const area = { x: content.x, y: content.y, w: content.canvas.width, h: content.canvas.height };
  const c = makeCanvas(area.w, area.h);
  const ctx = ctx2d(c);
  ctx.translate(-area.x, -area.y);
  drawLayer(ctx, { ...layer, visible: true, opacity: 1, blend: 'source-over', effects: {} }, area);
  const raster: RasterLayer = { ...(layer as RasterLayer), type: 'raster', canvas: c, x: area.x, y: area.y, mask: null } as RasterLayer;
  return updateLayer(doc, id, () => raster);
}

/* --------------------------- selection & pixel edits --------------------------- */

/** Expands a raster layer's canvas to the work area (doc ∪ layer). */
function expandedRaster(doc: PhotoDoc, layer: RasterLayer): { canvas: HTMLCanvasElement; area: Rect } {
  const area = workArea(doc, layer);
  const canvas = makeCanvas(area.w, area.h);
  ctx2d(canvas).drawImage(layer.canvas, layer.x - area.x, layer.y - area.y);
  return { canvas, area };
}

/** Deletes the selected pixels of a raster layer (or hides them on its mask). */
export function clearSelected(doc: PhotoDoc, id: string, onMask: boolean): PhotoDoc {
  const sel = doc.selection;
  const layer = findLayer(doc, id);
  if (!sel || !layer) return doc;
  if (onMask && layer.mask) {
    const m = layer.mask;
    const c = makeCanvas(m.canvas.width, m.canvas.height);
    const ctx = ctx2d(c);
    ctx.drawImage(m.canvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(selectionCanvas(sel), sel.bounds.x - m.x, sel.bounds.y - m.y);
    return updateLayer(doc, id, { mask: { ...m, canvas: c } } as Partial<Layer>);
  }
  if (layer.type !== 'raster') return doc;
  const c = makeCanvas(layer.canvas.width, layer.canvas.height);
  const ctx = ctx2d(c);
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(selectionCanvas(sel), sel.bounds.x - layer.x, sel.bounds.y - layer.y);
  return updateLayer(doc, id, { canvas: c } as Partial<Layer>);
}

/** Fills the selection (or the whole layer area) with a color. */
export function fillLayer(
  doc: PhotoDoc,
  id: string,
  color: string,
  options: { opacity?: number; blend?: GlobalCompositeOperation; onMask?: boolean; selection?: Selection | null } = {},
): PhotoDoc {
  const layer = findLayer(doc, id);
  if (!layer) return doc;
  const sel = options.selection === undefined ? doc.selection : options.selection;
  const opacity = Math.max(0, Math.min(1, options.opacity ?? 1));
  if (options.onMask && layer.mask) {
    const m = layer.mask;
    const [r, g, b] = parseHex(color);
    const gray = luma(r, g, b) / 255;
    const cov = makeCanvas(m.canvas.width, m.canvas.height);
    const cc = ctx2d(cov);
    cc.fillStyle = '#ffffff';
    if (sel) cc.drawImage(selectionCanvas(sel), sel.bounds.x - m.x, sel.bounds.y - m.y);
    else cc.fillRect(0, 0, cov.width, cov.height);
    const c = makeCanvas(m.canvas.width, m.canvas.height);
    const ctx = ctx2d(c);
    ctx.drawImage(m.canvas, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(cov, 0, 0);
    ctx.globalAlpha = opacity * gray;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(cov, 0, 0);
    return updateLayer(doc, id, { mask: { ...m, canvas: c } } as Partial<Layer>);
  }
  if (layer.type !== 'raster') return doc;
  const { canvas, area } = expandedRaster(doc, layer);
  const fill = makeCanvas(area.w, area.h);
  const fctx = ctx2d(fill);
  fctx.fillStyle = color;
  if (sel) {
    fctx.drawImage(selectionCanvas(sel), sel.bounds.x - area.x, sel.bounds.y - area.y);
    fctx.globalCompositeOperation = 'source-in';
    fctx.fillRect(0, 0, area.w, area.h);
  } else fctx.fillRect(0, 0, area.w, area.h);
  const ctx = ctx2d(canvas);
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = options.blend ?? 'source-over';
  ctx.drawImage(fill, 0, 0);
  return updateLayer(doc, id, { canvas, x: area.x, y: area.y } as Partial<Layer>);
}

export interface ClipboardImage {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

/** Selected pixels of a layer (or of the merged image). */
export function copyPixels(doc: PhotoDoc, merged: boolean): ClipboardImage | null {
  const sel = doc.selection;
  let src: { canvas: HTMLCanvasElement; x: number; y: number } | null;
  if (merged) src = { canvas: flattenToCanvas(doc), x: 0, y: 0 };
  else {
    const layer = findLayer(doc, doc.activeId);
    if (!layer) return null;
    if (layer.mask || anyEffect(layer.effects)) {
      // copy what the layer looks like (mask applied), not hidden pixels
      const box = layerBox(layer);
      const area = { x: Math.floor(box.x), y: Math.floor(box.y), w: Math.ceil(box.w) + 1, h: Math.ceil(box.h) + 1 };
      const c = makeCanvas(area.w, area.h);
      const ctx = ctx2d(c);
      ctx.translate(-area.x, -area.y);
      drawLayer(ctx, { ...layer, visible: true, opacity: 1, blend: 'source-over', effects: {} }, area);
      src = { canvas: c, x: area.x, y: area.y };
    } else src = layerContent(layer);
  }
  if (!src) return null;
  if (!sel) return { canvas: src.canvas, x: src.x, y: src.y };
  const b = intersectRects(sel.bounds, { x: src.x, y: src.y, w: src.canvas.width, h: src.canvas.height });
  if (!b) return null;
  const c = makeCanvas(b.w, b.h);
  const ctx = ctx2d(c);
  ctx.drawImage(src.canvas, src.x - b.x, src.y - b.y);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(selectionCanvas(sel), sel.bounds.x - b.x, sel.bounds.y - b.y);
  return { canvas: c, x: b.x, y: b.y };
}

/** Pastes an image as a new layer (at its original place when visible, else centered). */
export function pasteAsLayer(doc: PhotoDoc, clip: ClipboardImage | { canvas: HTMLCanvasElement; x?: number; y?: number }, name?: string): PhotoDoc {
  let x = clip.x ?? NaN;
  let y = clip.y ?? NaN;
  const w = clip.canvas.width;
  const h = clip.canvas.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !intersectRects({ x, y, w, h }, docRect(doc))) {
    x = Math.round((doc.width - w) / 2);
    y = Math.round((doc.height - h) / 2);
  }
  return insertLayer({ ...doc, selection: null }, makeRasterLayer(name ?? nextLayerName(doc), clip.canvas, x, y));
}

export function selectLayerPixels(doc: PhotoDoc, id: string): PhotoDoc {
  const layer = findLayer(doc, id);
  if (!layer) return doc;
  const c = layerContent(layer);
  if (!c) return { ...doc, selection: null };
  const data = readPixels(c.canvas).data;
  const mask = alphaToMask(data, c.canvas.width, c.canvas.height, Math.round(c.x), Math.round(c.y), doc.width, doc.height);
  return { ...doc, selection: selectionFromMask(mask, doc.width, doc.height) };
}

/** Replaces a raster layer's pixels (or its mask) with a processed buffer of the same size. */
export function withPixels(doc: PhotoDoc, id: string, data: Uint8ClampedArray, w: number, h: number, onMask: boolean): PhotoDoc {
  const canvas = canvasFromPixels(data, w, h);
  return updateLayer(doc, id, (l) => (onMask && l.mask ? ({ ...l, mask: { ...l.mask, canvas } } as Layer) : l.type === 'raster' ? { ...l, canvas } : l));
}

/* ----------------------------- geometric transforms ----------------------------- */

interface Geo {
  matrix: [number, number, number, number, number, number];
  newW: number;
  newH: number;
  /** degrees added to text/shape rotation */
  rot: number;
  mirror: boolean;
  /** uniform scale for sizes (text size, stroke widths, effects) */
  scale: number;
  /** clip raster layers to the new document (delete cropped pixels) */
  clip: boolean;
  quality?: ImageSmoothingQuality | 'nearest';
}

function mapPoint(m: Geo['matrix'], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function transformBitmap(canvas: HTMLCanvasElement, x: number, y: number, g: Geo): { canvas: HTMLCanvasElement; x: number; y: number } {
  const corners = [mapPoint(g.matrix, x, y), mapPoint(g.matrix, x + canvas.width, y), mapPoint(g.matrix, x, y + canvas.height), mapPoint(g.matrix, x + canvas.width, y + canvas.height)];
  let bx = Math.floor(Math.min(...corners.map((c) => c[0])) + 1e-6);
  let by = Math.floor(Math.min(...corners.map((c) => c[1])) + 1e-6);
  let bx2 = Math.ceil(Math.max(...corners.map((c) => c[0])) - 1e-6);
  let by2 = Math.ceil(Math.max(...corners.map((c) => c[1])) - 1e-6);
  if (g.clip) {
    bx = Math.max(0, bx);
    by = Math.max(0, by);
    bx2 = Math.min(g.newW, bx2);
    by2 = Math.min(g.newH, by2);
  }
  const w = Math.max(1, bx2 - bx);
  const h = Math.max(1, by2 - by);
  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);
  const [a, b, c, d, e, f] = g.matrix;
  ctx.imageSmoothingEnabled = g.quality !== 'nearest';
  if (g.quality && g.quality !== 'nearest') ctx.imageSmoothingQuality = g.quality;
  ctx.setTransform(a, b, c, d, e - bx, f - by);
  ctx.drawImage(canvas, x, y);
  return { canvas: out, x: bx, y: by };
}

function scaleEffects(e: LayerEffects, s: number): LayerEffects {
  if (s === 1) return e;
  return {
    shadow: e.shadow ? { ...e.shadow, distance: e.shadow.distance * s, size: e.shadow.size * s } : undefined,
    stroke: e.stroke ? { ...e.stroke, size: e.stroke.size * s } : undefined,
    glow: e.glow ? { ...e.glow, size: e.glow.size * s } : undefined,
  };
}

/** Sets a text layer's anchor so that its block center is at (cx, cy). */
export function textWithCenter(l: TextLayer, cx: number, cy: number): TextLayer {
  const lay = layoutText(l);
  const alignOffset = l.align === 'center' ? lay.width / 2 : l.align === 'right' ? lay.width : 0;
  return { ...l, x: cx - lay.width / 2 + alignOffset, y: cy - lay.height / 2 };
}

function transformLayer(layer: Layer, g: Geo): Layer {
  const mask = layer.mask ? (() => {
    const t = transformBitmap(layer.mask.canvas, layer.mask.x, layer.mask.y, { ...g, clip: g.clip && !layer.mask.reveal });
    return { ...layer.mask, canvas: t.canvas, x: t.x, y: t.y };
  })() : null;
  const effects = scaleEffects(layer.effects, g.scale);
  if (layer.type === 'raster') {
    const t = transformBitmap(layer.canvas, layer.x, layer.y, g);
    return { ...layer, canvas: t.canvas, x: t.x, y: t.y, mask, effects };
  }
  const rot = (r: number) => (g.mirror ? -r : r) + g.rot;
  if (layer.type === 'text') {
    const lay = layoutText(layer);
    const [cx, cy] = mapPoint(g.matrix, lay.cx, lay.cy);
    const scaled: TextLayer = { ...layer, size: layer.size * g.scale, letterSpacing: layer.letterSpacing * g.scale, rotation: normalizeAngle(rot(layer.rotation)), mask, effects };
    return textWithCenter(scaled, cx, cy);
  }
  const s = layer as ShapeLayer;
  if (s.shape === 'line') {
    const box = shapeBox(s);
    const cx0 = box.x + box.w / 2;
    const cy0 = box.y + box.h / 2;
    const a = (s.rotation * Math.PI) / 180;
    const rotP = (px: number, py: number): [number, number] => [cx0 + (px - cx0) * Math.cos(a) - (py - cy0) * Math.sin(a), cy0 + (px - cx0) * Math.sin(a) + (py - cy0) * Math.cos(a)];
    const p1 = mapPoint(g.matrix, ...rotP(s.x, s.y));
    const p2 = mapPoint(g.matrix, ...rotP(s.x + s.w, s.y + s.h));
    return { ...s, x: p1[0], y: p1[1], w: p2[0] - p1[0], h: p2[1] - p1[1], rotation: 0, strokeWidth: s.strokeWidth * g.scale, mask, effects };
  }
  const box = shapeBox(s);
  const [cx, cy] = mapPoint(g.matrix, box.x + box.w / 2, box.y + box.h / 2);
  const sx = Math.hypot(g.matrix[0], g.matrix[1]);
  const sy = Math.hypot(g.matrix[2], g.matrix[3]);
  const quarter = Math.abs(Math.round(g.rot / 90)) % 2 === 1 && g.rot % 90 === 0;
  const w = box.w * (quarter ? sy : sx);
  const h = box.h * (quarter ? sx : sy);
  return {
    ...s,
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    rotation: normalizeAngle(rot(s.rotation)),
    strokeWidth: s.strokeWidth * g.scale,
    radius: s.radius * g.scale,
    mask,
    effects,
  };
}

function normalizeAngle(a: number): number {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.round(r * 1000) / 1000;
}

function transformDoc(doc: PhotoDoc, g: Geo, selection: Selection | null = null): PhotoDoc {
  return { ...doc, width: g.newW, height: g.newH, layers: doc.layers.map((l) => transformLayer(l, g)), selection };
}

/** Crops to `rect` (doc coords); with `angle` the image is first rotated around the rect center. */
export function cropDoc(doc: PhotoDoc, rect: Rect, angle = 0): PhotoDoc {
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  if (!angle) {
    const dx = Math.round(rect.x);
    const dy = Math.round(rect.y);
    const g: Geo = { matrix: [1, 0, 0, 1, -dx, -dy], newW: w, newH: h, rot: 0, mirror: false, scale: 1, clip: true, quality: 'nearest' };
    return transformDoc(doc, g, reframeSelection(doc.selection, dx, dy, w, h));
  }
  const a = (angle * Math.PI) / 180;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // p' = R(a)(p - c) + (w/2, h/2)
  const matrix: Geo['matrix'] = [cos, sin, -sin, cos, w / 2 - (cos * cx - sin * cy), h / 2 - (sin * cx + cos * cy)];
  return transformDoc(doc, { matrix, newW: w, newH: h, rot: angle, mirror: false, scale: 1, clip: true, quality: 'high' });
}

export function resizeImage(doc: PhotoDoc, newW: number, newH: number, quality: ImageSmoothingQuality | 'nearest' = 'high'): PhotoDoc {
  const sx = newW / doc.width;
  const sy = newH / doc.height;
  const g: Geo = { matrix: [sx, 0, 0, sy, 0, 0], newW: Math.round(newW), newH: Math.round(newH), rot: 0, mirror: false, scale: Math.sqrt(sx * sy), clip: false, quality };
  return transformDoc(doc, g);
}

/** Canvas size with an anchor (0, 0.5, 1 per axis). `fill` paints the new area of the bottom layer. */
export function canvasSize(doc: PhotoDoc, newW: number, newH: number, anchorX: number, anchorY: number, fill?: string): PhotoDoc {
  const dx = Math.round((newW - doc.width) * anchorX);
  const dy = Math.round((newH - doc.height) * anchorY);
  const g: Geo = { matrix: [1, 0, 0, 1, dx, dy], newW: Math.round(newW), newH: Math.round(newH), rot: 0, mirror: false, scale: 1, clip: false, quality: 'nearest' };
  let next = transformDoc(doc, g, reframeSelection(doc.selection, -dx, -dy, Math.round(newW), Math.round(newH)));
  const bottom = next.layers[0];
  if (fill && bottom?.type === 'raster') {
    const c = makeCanvas(next.width, next.height);
    const ctx = ctx2d(c);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bottom.canvas, bottom.x, bottom.y);
    next = updateLayer(next, bottom.id, { canvas: c, x: 0, y: 0 } as Partial<Layer>);
  }
  return next;
}

/** Rotates the whole image by multiples of 90° clockwise. */
export function rotateDoc90(doc: PhotoDoc, quarterTurns: number): PhotoDoc {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (!q) return doc;
  const W = doc.width;
  const H = doc.height;
  const matrix: Geo['matrix'] = q === 1 ? [0, 1, -1, 0, H, 0] : q === 2 ? [-1, 0, 0, -1, W, H] : [0, -1, 1, 0, 0, W];
  const swap = q % 2 === 1;
  return transformDoc(doc, { matrix, newW: swap ? H : W, newH: swap ? W : H, rot: q * 90, mirror: false, scale: 1, clip: false, quality: 'nearest' });
}

/** Rotates by any angle (clockwise degrees), enlarging the canvas to fit. */
export function rotateDocArbitrary(doc: PhotoDoc, degrees: number): PhotoDoc {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const newW = Math.ceil(Math.abs(doc.width * cos) + Math.abs(doc.height * sin));
  const newH = Math.ceil(Math.abs(doc.width * sin) + Math.abs(doc.height * cos));
  const cx = doc.width / 2;
  const cy = doc.height / 2;
  const matrix: Geo['matrix'] = [cos, sin, -sin, cos, newW / 2 - (cos * cx - sin * cy), newH / 2 - (sin * cx + cos * cy)];
  return transformDoc(doc, { matrix, newW, newH, rot: degrees, mirror: false, scale: 1, clip: false, quality: 'high' });
}

export function flipDoc(doc: PhotoDoc, axis: 'horizontal' | 'vertical'): PhotoDoc {
  const matrix: Geo['matrix'] = axis === 'horizontal' ? [-1, 0, 0, 1, doc.width, 0] : [1, 0, 0, -1, 0, doc.height];
  return transformDoc(doc, { matrix, newW: doc.width, newH: doc.height, rot: 0, mirror: true, scale: 1, clip: false, quality: 'nearest' });
}

/** Flips one layer in place (around its own center). */
export function flipLayer(doc: PhotoDoc, id: string, axis: 'horizontal' | 'vertical'): PhotoDoc {
  const layer = findLayer(doc, id);
  if (!layer) return doc;
  const box = layerBox(layer);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const matrix: Geo['matrix'] = axis === 'horizontal' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy];
  return updateLayer(doc, id, (l) => transformLayer(l, { matrix, newW: doc.width, newH: doc.height, rot: 0, mirror: true, scale: 1, clip: false, quality: 'nearest' }));
}

/** Applies a free transform (scale sx/sy around the box center, rotate, translate) to one layer. */
export function transformLayerFree(
  doc: PhotoDoc,
  id: string,
  t: { cx: number; cy: number; sx: number; sy: number; rotation: number; tx: number; ty: number },
): PhotoDoc {
  const layer = findLayer(doc, id);
  if (!layer) return doc;
  const a = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // p' = T(c + t) R S (p - c)
  const m: Geo['matrix'] = [
    cos * t.sx,
    sin * t.sx,
    -sin * t.sy,
    cos * t.sy,
    t.cx + t.tx - (cos * t.sx * t.cx - sin * t.sy * t.cy),
    t.cy + t.ty - (sin * t.sx * t.cx + cos * t.sy * t.cy),
  ];
  const g: Geo = { matrix: m, newW: doc.width, newH: doc.height, rot: t.rotation, mirror: t.sx * t.sy < 0, scale: Math.sqrt(Math.abs(t.sx * t.sy)), clip: false, quality: 'high' };
  if (layer.type === 'text' && Math.abs(Math.abs(t.sx) - Math.abs(t.sy)) > 0.001) {
    // non-uniform scaling of live text: use the average scale
    g.scale = (Math.abs(t.sx) + Math.abs(t.sy)) / 2;
  }
  if (layer.type === 'shape' && layer.shape !== 'line') {
    const box = shapeBox(layer);
    const [ncx, ncy] = mapPoint(m, box.x + box.w / 2, box.y + box.h / 2);
    const w = box.w * Math.abs(t.sx);
    const h = box.h * Math.abs(t.sy);
    return updateLayer(doc, id, {
      x: ncx - w / 2,
      y: ncy - h / 2,
      w,
      h,
      rotation: normalizeAngle(layer.rotation + t.rotation),
      strokeWidth: layer.strokeWidth * g.scale,
      radius: layer.radius * g.scale,
      effects: scaleEffects(layer.effects, g.scale),
      mask: layer.mask ? { ...layer.mask, ...transformBitmap(layer.mask.canvas, layer.mask.x, layer.mask.y, g) } : null,
    } as Partial<Layer>);
  }
  return updateLayer(doc, id, (l) => transformLayer(l, g));
}

/** Bounds of the non-transparent pixels of the flattened image. */
export function trimBounds(doc: PhotoDoc): Rect | null {
  const data = readPixels(flattenToCanvas(doc)).data;
  const mask = new Uint8Array(doc.width * doc.height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3];
  return selectionFromMask(mask, doc.width, doc.height)?.bounds ?? null;
}

export function documentFromCanvas(canvas: HTMLCanvasElement, name = 'Background'): PhotoDoc {
  const layer = makeRasterLayer(name, canvas);
  return { width: canvas.width, height: canvas.height, layers: [layer], activeId: layer.id, selection: null };
}

/** Fills the new area of a blank document. */
export function blankDocument(width: number, height: number, background: string | null): PhotoDoc {
  const c = makeCanvas(width, height);
  if (background) {
    const ctx = ctx2d(c);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  return documentFromCanvas(c, background ? 'Background' : 'Layer 1');
}
