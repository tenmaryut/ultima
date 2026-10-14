/**
 * Layer rendering and compositing (DOM). Text and shape layers are rendered to cached
 * canvases; masks are applied per region with scratch canvases; layer effects are computed
 * on the CPU from the layer's alpha and cached per content.
 */
import { anyEffect } from './doc';
import { ctx2d, makeCanvas, readPixels } from './canvas';
import { distanceField, gaussianChannel, intersectRects } from './selection';
import { parseHex } from './pixels/adjust';
import type { Layer, LayerEffects, PhotoDoc, Rect, ShapeLayer, TextLayer } from './types';

export interface Rendered {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

export interface RenderOverrides {
  /** Live replacement of a layer's content (strokes, previews, transforms). */
  content?: Map<string, Rendered>;
  /** Live replacement of a layer's mask canvas. */
  mask?: Map<string, Rendered>;
  hidden?: Set<string>;
}

/* ----------------------------------- Text ----------------------------------- */

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace']);

export function cssFontFamily(font: string): string {
  const clean = font.replace(/["\\;{}]/g, '').trim() || 'sans-serif';
  return GENERIC.has(clean) ? clean : `"${clean}", sans-serif`;
}

export function textFont(l: Pick<TextLayer, 'italic' | 'weight' | 'size' | 'font'>, scale = 1): string {
  return `${l.italic ? 'italic ' : ''}${Math.round(l.weight)} ${Math.max(1, l.size * scale)}px ${cssFontFamily(l.font)}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = ctx2d(makeCanvas(4, 4));
  return measureCtx;
}

export interface TextLayout {
  lines: { text: string; width: number }[];
  width: number;
  height: number;
  advance: number;
  ascent: number;
  descent: number;
  /** Unrotated block rectangle in document coordinates. */
  box: Rect;
  cx: number;
  cy: number;
}

export function layoutText(l: TextLayer): TextLayout {
  const ctx = mctx();
  ctx.font = textFont(l);
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${l.letterSpacing}px`;
  const lines = (l.text || ' ').split('\n').map((text) => ({ text, width: ctx.measureText(text).width }));
  const metrics = ctx.measureText('Hg');
  const ascent = metrics.fontBoundingBoxAscent || l.size * 0.8;
  const descent = metrics.fontBoundingBoxDescent || l.size * 0.2;
  const advance = l.size * Math.max(0.5, l.lineHeight);
  const width = Math.max(1, ...lines.map((ln) => ln.width));
  const height = Math.max(advance, lines.length * advance);
  const left = l.x - (l.align === 'center' ? width / 2 : l.align === 'right' ? width : 0);
  const box = { x: left, y: l.y, w: width, h: height };
  return { lines, width, height, advance, ascent, descent, box, cx: left + width / 2, cy: l.y + height / 2 };
}

function rotatedBounds(box: Rect, deg: number, pad: number): Rect {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const a = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const hw = box.w / 2 + pad;
  const hh = box.h / 2 + pad;
  const ew = hw * cos + hh * sin;
  const eh = hw * sin + hh * cos;
  return { x: Math.floor(cx - ew), y: Math.floor(cy - eh), w: Math.ceil(ew * 2) + 2, h: Math.ceil(eh * 2) + 2 };
}

class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): void {
    this.map.set(key, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

const textCache = new LruCache<Rendered>(48);

export function renderText(l: TextLayer): Rendered {
  const key = JSON.stringify([l.text, l.x, l.y, l.font, l.size, l.weight, l.italic, l.underline, l.color, l.align, l.lineHeight, l.letterSpacing, l.rotation]);
  const hit = textCache.get(key);
  if (hit) return hit;
  const lay = layoutText(l);
  const pad = Math.ceil(l.size * 0.6 + Math.abs(l.letterSpacing));
  const bounds = rotatedBounds(lay.box, l.rotation, pad);
  const canvas = makeCanvas(bounds.w, bounds.h);
  const ctx = ctx2d(canvas);
  ctx.translate(lay.cx - bounds.x, lay.cy - bounds.y);
  ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.font = textFont(l);
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${l.letterSpacing}px`;
  ctx.fillStyle = l.color;
  ctx.textBaseline = 'alphabetic';
  const left = -lay.width / 2;
  const top = -lay.height / 2;
  lay.lines.forEach((ln, i) => {
    const lx = left + (l.align === 'center' ? (lay.width - ln.width) / 2 : l.align === 'right' ? lay.width - ln.width : 0);
    const baseline = top + i * lay.advance + (lay.advance - (lay.ascent + lay.descent)) / 2 + lay.ascent;
    ctx.fillText(ln.text, lx, baseline);
    if (l.underline && ln.text.trim()) ctx.fillRect(lx, baseline + l.size * 0.09, ln.width, Math.max(1, l.size * 0.06));
  });
  const out = { canvas, x: bounds.x, y: bounds.y };
  textCache.set(key, out);
  return out;
}

/* ---------------------------------- Shapes ---------------------------------- */

export function shapeBox(s: ShapeLayer): Rect {
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
}

const shapeCache = new LruCache<Rendered>(48);

export function renderShape(s: ShapeLayer): Rendered {
  const key = JSON.stringify([s.shape, s.x, s.y, s.w, s.h, s.fill, s.stroke, s.strokeWidth, s.radius, s.rotation]);
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const box = shapeBox(s);
  const sw = s.stroke || s.shape === 'line' ? Math.max(0, s.strokeWidth) : 0;
  const bounds = rotatedBounds(box, s.rotation, sw / 2 + 2);
  const canvas = makeCanvas(bounds.w, bounds.h);
  const ctx = ctx2d(canvas);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.translate(cx - bounds.x, cy - bounds.y);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.lineJoin = 'round';
  if (s.shape === 'line') {
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, s.strokeWidth);
    ctx.strokeStyle = s.stroke ?? s.fill ?? '#000000';
    ctx.beginPath();
    ctx.moveTo(s.x - cx, s.y - cy);
    ctx.lineTo(s.x + s.w - cx, s.y + s.h - cy);
    ctx.stroke();
  } else {
    ctx.beginPath();
    const x = -box.w / 2;
    const y = -box.h / 2;
    if (s.shape === 'ellipse') ctx.ellipse(0, 0, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    else if (s.shape === 'roundrect') ctx.roundRect(x, y, box.w, box.h, Math.max(0, Math.min(s.radius, box.w / 2, box.h / 2)));
    else ctx.rect(x, y, box.w, box.h);
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill();
    }
    if (s.stroke && s.strokeWidth > 0) {
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.stroke;
      ctx.stroke();
    }
  }
  const out = { canvas, x: bounds.x, y: bounds.y };
  shapeCache.set(key, out);
  return out;
}

/* ------------------------------ Content & bounds ------------------------------ */

export function layerContent(layer: Layer, overrides?: RenderOverrides): Rendered | null {
  const o = overrides?.content?.get(layer.id);
  if (o) return o;
  if (layer.type === 'raster') return { canvas: layer.canvas, x: layer.x, y: layer.y };
  if (layer.type === 'text') return layer.text ? renderText(layer) : null;
  return renderShape(layer);
}

/** Document-space bounds of a layer's content (unrotated box for text/shape). */
export function layerBox(layer: Layer): Rect {
  if (layer.type === 'raster') return { x: layer.x, y: layer.y, w: layer.canvas.width, h: layer.canvas.height };
  if (layer.type === 'text') return layoutText(layer).box;
  return shapeBox(layer);
}

/** Rotation in degrees of text/shape layers (0 for raster). */
export function layerRotation(layer: Layer): number {
  return layer.type === 'raster' ? 0 : layer.rotation;
}

/** True when the doc point hits the layer's visible content. */
export function hitTestLayer(layer: Layer, x: number, y: number): boolean {
  if (layer.type !== 'raster') {
    const box = layerBox(layer);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const a = (-layerRotation(layer) * Math.PI) / 180;
    const lx = cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
    const ly = cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
    const pad = layer.type === 'shape' && layer.shape === 'line' ? Math.max(6, layer.strokeWidth) : 2;
    return lx >= box.x - pad && lx <= box.x + box.w + pad && ly >= box.y - pad && ly <= box.y + box.h + pad;
  }
  const px = Math.floor(x - layer.x);
  const py = Math.floor(y - layer.y);
  if (px < 0 || py < 0 || px >= layer.canvas.width || py >= layer.canvas.height) return false;
  return ctx2d(layer.canvas).getImageData(px, py, 1, 1).data[3] > 10;
}

/* ----------------------------------- Masks ----------------------------------- */

let scratchA: HTMLCanvasElement | null = null;
let scratchB: HTMLCanvasElement | null = null;

function scratch(which: 'a' | 'b', w: number, h: number): HTMLCanvasElement {
  let c = which === 'a' ? scratchA : scratchB;
  if (!c || c.width < w || c.height < h) {
    c = makeCanvas(Math.max(w, c?.width ?? 0), Math.max(h, c?.height ?? 0));
    if (which === 'a') scratchA = c;
    else scratchB = c;
  }
  return c;
}

export interface MaskInput {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  reveal: boolean;
}

/** Clears the parts of (0,0,w,h) that are outside `inner`. */
function clearOutside(ctx: CanvasRenderingContext2D, w: number, h: number, inner: Rect): void {
  const x0 = Math.max(0, inner.x);
  const y0 = Math.max(0, inner.y);
  const x1 = Math.min(w, inner.x + inner.w);
  const y1 = Math.min(h, inner.y + inner.h);
  if (x1 <= x0 || y1 <= y0) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  ctx.clearRect(0, 0, w, y0);
  ctx.clearRect(0, y1, w, h - y1);
  ctx.clearRect(0, y0, x0, y1 - y0);
  ctx.clearRect(x1, y0, w - x1, y1 - y0);
}

/** Multiplies the content of `ctx` (a region r of the doc, drawn at 0,0) by the mask. */
export function applyMaskToRegion(ctx: CanvasRenderingContext2D, r: Rect, mask: MaskInput): void {
  const mr = { x: mask.x - r.x, y: mask.y - r.y, w: mask.canvas.width, h: mask.canvas.height };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (mask.reveal) {
    const m = scratch('b', r.w, r.h);
    const mc = ctx2d(m);
    mc.save();
    mc.globalCompositeOperation = 'source-over';
    mc.globalAlpha = 1;
    mc.clearRect(0, 0, r.w, r.h);
    mc.fillStyle = '#ffffff';
    mc.fillRect(0, 0, r.w, r.h);
    mc.clearRect(mr.x, mr.y, mr.w, mr.h);
    mc.drawImage(mask.canvas, mr.x, mr.y);
    mc.restore();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(m, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
  } else {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask.canvas, mr.x, mr.y);
    ctx.globalCompositeOperation = 'source-over';
    clearOutside(ctx, r.w, r.h, mr);
  }
  ctx.restore();
}

/** Content with the mask applied (full content size). */
export function maskedContent(content: Rendered, mask: MaskInput | null): Rendered {
  if (!mask) return content;
  const c = makeCanvas(content.canvas.width, content.canvas.height);
  const ctx = ctx2d(c);
  ctx.drawImage(content.canvas, 0, 0);
  applyMaskToRegion(ctx, { x: content.x, y: content.y, w: c.width, h: c.height }, mask);
  return { canvas: c, x: content.x, y: content.y };
}

/* ---------------------------------- Effects ---------------------------------- */

function alphaPlane(content: Rendered, margin: number): { a: Uint8Array; w: number; h: number } {
  const w = content.canvas.width + margin * 2;
  const h = content.canvas.height + margin * 2;
  const c = makeCanvas(w, h);
  ctx2d(c).drawImage(content.canvas, margin, margin);
  const d = readPixels(c).data;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return { a, w, h };
}

function coloredCanvas(alpha: Uint8Array | Float32Array, w: number, h: number, color: string): HTMLCanvasElement {
  const [r, g, b] = parseHex(color);
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0; i < alpha.length; i++) {
    const v = alpha[i];
    if (!v) continue;
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = v;
  }
  const c = makeCanvas(w, h);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

function dilate(a: Uint8Array, w: number, h: number, size: number): Uint8Array {
  const feature = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) feature[i] = a[i] >= 128 ? 1 : 0;
  const d = distanceField(feature, w, h);
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(a[i], Math.round(Math.max(0, Math.min(1, size + 0.5 - d[i])) * 255));
  return out;
}

function effectsKey(e: LayerEffects): string {
  return JSON.stringify([e.shadow?.enabled ? e.shadow : 0, e.stroke?.enabled ? e.stroke : 0, e.glow?.enabled ? e.glow : 0]);
}

/** Renders the masked content with its effects (drop shadow, outer glow, stroke). */
export function renderEffects(content: Rendered, e: LayerEffects): Rendered {
  const shadow = e.shadow?.enabled ? e.shadow : null;
  const stroke = e.stroke?.enabled && e.stroke.size > 0 ? e.stroke : null;
  const glow = e.glow?.enabled && e.glow.size > 0 ? e.glow : null;
  const margin = Math.ceil(
    Math.max(shadow ? shadow.distance + shadow.size * 1.5 : 0, stroke && stroke.position !== 'inside' ? stroke.size : 0, glow ? glow.size * 1.6 : 0) + 2,
  );
  const { a, w, h } = alphaPlane(content, margin);
  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);
  if (glow) {
    const spread = Math.max(0, Math.min(100, glow.spread)) / 100;
    let g = spread > 0 ? dilate(a, w, h, glow.size * spread) : a;
    g = gaussianChannel(g, w, h, Math.max(0.5, (glow.size * (1 - spread * 0.8)) / 2));
    ctx.globalAlpha = Math.max(0, Math.min(1, glow.opacity));
    ctx.drawImage(coloredCanvas(g, w, h, glow.color), 0, 0);
  }
  if (shadow) {
    const s = gaussianChannel(a, w, h, Math.max(0.3, shadow.size / 2));
    const ang = (shadow.angle * Math.PI) / 180;
    ctx.globalAlpha = Math.max(0, Math.min(1, shadow.opacity));
    ctx.drawImage(coloredCanvas(s, w, h, shadow.color), Math.round(-Math.cos(ang) * shadow.distance), Math.round(Math.sin(ang) * shadow.distance));
  }
  let inner: HTMLCanvasElement | null = null;
  if (stroke) {
    const size = stroke.position === 'center' ? stroke.size / 2 : stroke.size;
    if (stroke.position !== 'inside') {
      const ring = dilate(a, w, h, size);
      ctx.globalAlpha = Math.max(0, Math.min(1, stroke.opacity));
      ctx.drawImage(coloredCanvas(ring, w, h, stroke.color), 0, 0);
    }
    if (stroke.position !== 'outside') {
      const outside = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) outside[i] = a[i] < 128 ? 1 : 0;
      const d = distanceField(outside, w, h);
      const ring = new Uint8Array(a.length);
      for (let i = 0; i < a.length; i++) ring[i] = Math.round(Math.max(0, Math.min(1, size + 0.5 - d[i])) * a[i]);
      inner = coloredCanvas(ring, w, h, stroke.color);
    }
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(content.canvas, margin, margin);
  if (inner && stroke) {
    ctx.globalAlpha = Math.max(0, Math.min(1, stroke.opacity));
    ctx.drawImage(inner, 0, 0);
  }
  return { canvas: out, x: content.x - margin, y: content.y - margin };
}

interface EffectsEntry {
  key: string;
  mask: HTMLCanvasElement | undefined;
  result: Rendered;
}

const effectsCache = new WeakMap<HTMLCanvasElement, EffectsEntry>();

function cachedEffects(layer: Layer, content: Rendered, mask: MaskInput | null): Rendered {
  const key = `${effectsKey(layer.effects)}|${content.x},${content.y}|${mask ? `${mask.x},${mask.y},${mask.reveal}` : ''}`;
  const entry = effectsCache.get(content.canvas);
  if (entry && entry.key === key && entry.mask === mask?.canvas) return entry.result;
  const result = renderEffects(maskedContent(content, mask), layer.effects);
  effectsCache.set(content.canvas, { key, mask: mask?.canvas, result });
  return result;
}

/* --------------------------------- Compositor --------------------------------- */

function layerMaskInput(layer: Layer, overrides?: RenderOverrides): MaskInput | null {
  if (!layer.mask || !layer.mask.enabled) return null;
  const o = overrides?.mask?.get(layer.id);
  return o ? { ...o, reveal: layer.mask.reveal } : { canvas: layer.mask.canvas, x: layer.mask.x, y: layer.mask.y, reveal: layer.mask.reveal };
}

/** Draws one layer (content, mask, effects, opacity, blend) into ctx (doc coordinates), limited to `region`. */
export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, region: Rect, overrides?: RenderOverrides): void {
  if (!layer.visible || layer.opacity <= 0 || overrides?.hidden?.has(layer.id)) return;
  const content = layerContent(layer, overrides);
  if (!content) return;
  const mask = layerMaskInput(layer, overrides);
  const live = Boolean(overrides?.content?.has(layer.id) || overrides?.mask?.has(layer.id));
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
  ctx.globalCompositeOperation = layer.blend;
  if (anyEffect(layer.effects) && !(live && layer.type === 'raster')) {
    const fx = live ? renderEffects(maskedContent(content, mask), layer.effects) : cachedEffects(layer, content, mask);
    ctx.drawImage(fx.canvas, fx.x, fx.y);
    return;
  }
  if (!mask) {
    ctx.drawImage(content.canvas, content.x, content.y);
    return;
  }
  const r = intersectRects(region, { x: content.x, y: content.y, w: content.canvas.width, h: content.canvas.height });
  if (!r) return;
  const rr = { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w), h: Math.ceil(r.h) };
  const s = scratch('a', rr.w, rr.h);
  const sc = ctx2d(s);
  sc.save();
  sc.globalCompositeOperation = 'source-over';
  sc.globalAlpha = 1;
  sc.clearRect(0, 0, rr.w, rr.h);
  sc.drawImage(content.canvas, content.x - rr.x, content.y - rr.y);
  sc.restore();
  applyMaskToRegion(sc, rr, mask);
  ctx.drawImage(s, 0, 0, rr.w, rr.h, rr.x, rr.y, rr.w, rr.h);
}

/** Composites the whole document (or `region`) into ctx, whose origin is the doc origin. */
export function compositeDoc(doc: PhotoDoc, ctx: CanvasRenderingContext2D, region?: Rect, overrides?: RenderOverrides): void {
  const r = region ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
  for (const layer of doc.layers) {
    ctx.save();
    drawLayer(ctx, layer, r, overrides);
    ctx.restore();
  }
  ctx.restore();
}

/** New doc-sized canvas with the flattened image. */
export function flattenToCanvas(doc: PhotoDoc, overrides?: RenderOverrides, background?: string): HTMLCanvasElement {
  const c = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(c);
  compositeDoc(doc, ctx, undefined, overrides);
  if (background) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
  }
  return c;
}

/** Renders a single layer (with mask/effects/opacity) into a doc-sized canvas. */
export function renderLayerToDoc(doc: PhotoDoc, layer: Layer, withOpacity = true): HTMLCanvasElement {
  const c = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(c);
  drawLayer(ctx, withOpacity ? { ...layer, visible: true, blend: 'source-over' } : { ...layer, visible: true, opacity: 1, blend: 'source-over' }, { x: 0, y: 0, w: doc.width, h: doc.height });
  return c;
}

/** Pixels of the layer content as a raster canvas (text/shape rasterized), without mask/effects. */
export function rasterizeContent(layer: Layer): Rendered | null {
  return layerContent(layer);
}
