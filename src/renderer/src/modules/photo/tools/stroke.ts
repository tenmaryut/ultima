/**
 * Stroke pipeline shared by the painting tools. Dabs accumulate in a stroke buffer; the
 * layer preview is recomputed only inside the dirty rectangle each frame:
 *   preview = base ⊕ (strokeBuffer × selection) with the tool's mode and opacity.
 * The finished preview canvas becomes the layer's new (immutable) canvas.
 */
import { ctx2d, makeCanvas, readPixels, selectionCanvas } from '../canvas';
import { findLayer, updateLayer } from '../doc';
import type { PhotoEngine } from '../engine';
import { intersectRects, unionRects } from '../selection';
import type { Layer, PhotoDoc, Rect, Selection } from '../types';

export type StrokeMode = 'paint' | 'erase' | 'mask' | 'effect' | 'coverage';

/* ---------------------------------- stamps ---------------------------------- */

const stampCache = new Map<string, HTMLCanvasElement>();

/** Round brush tip: `size` px diameter, hardness 0..1 (soft falloff), solid color. */
export function brushStamp(size: number, hardness: number, color: string): HTMLCanvasElement {
  const s = Math.max(0.5, Math.round(size * 2) / 2);
  const h = Math.round(Math.max(0, Math.min(1, hardness)) * 20) / 20;
  const key = `b|${s}|${h}|${color}`;
  let c = stampCache.get(key);
  if (c) return c;
  const dim = Math.ceil(s) + 2;
  c = makeCanvas(dim, dim);
  const ctx = ctx2d(c);
  const r = s / 2;
  const cx = dim / 2;
  if (h >= 0.99 || s <= 2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cx, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, r);
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let a = 1;
      if (t > h) {
        const u = (t - h) / (1 - h);
        a = 1 - u * u * (3 - 2 * u);
      }
      g.addColorStop(t, withAlphaCss(color, a));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, dim, dim);
  }
  if (stampCache.size > 64) stampCache.delete(stampCache.keys().next().value as string);
  stampCache.set(key, c);
  return c;
}

/** Hard, aliased tip for the pencil (pixel exact). */
export function pencilStamp(size: number, color: string): HTMLCanvasElement {
  const s = Math.max(1, Math.round(size));
  const key = `p|${s}|${color}`;
  let c = stampCache.get(key);
  if (c) return c;
  c = makeCanvas(s, s);
  const ctx = ctx2d(c);
  ctx.fillStyle = color;
  if (s <= 2) ctx.fillRect(0, 0, s, s);
  else {
    const r = s / 2;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r) ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  stampCache.set(key, c);
  return c;
}

function withAlphaCss(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(4)})`;
  }
  const rgba = /^rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)$/.exec(color.replace(/\s+/g, ''));
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${(a * (rgba[4] ? parseFloat(rgba[4]) : 1)).toFixed(4)})`;
  return color;
}

/* ------------------------------- effect tiles ------------------------------- */

const TILE = 256;

/** Lazily computed "fully affected" version of the base (dodge/burn/blur/sharpen brushes). */
export class EffectTiles {
  readonly canvas: HTMLCanvasElement;
  private done: Uint8Array;
  private tx: number;

  constructor(
    private base: Uint8ClampedArray,
    private w: number,
    private h: number,
    private fn: (data: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray,
    private margin: number,
  ) {
    this.canvas = makeCanvas(w, h);
    this.tx = Math.ceil(w / TILE);
    this.done = new Uint8Array(this.tx * Math.ceil(h / TILE));
  }

  ensure(r: Rect): void {
    const x0 = Math.max(0, Math.floor(r.x / TILE));
    const y0 = Math.max(0, Math.floor(r.y / TILE));
    const x1 = Math.min(this.tx - 1, Math.floor((r.x + r.w) / TILE));
    const y1 = Math.min(Math.ceil(this.h / TILE) - 1, Math.floor((r.y + r.h) / TILE));
    const ctx = ctx2d(this.canvas);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * this.tx + tx;
        if (this.done[i]) continue;
        this.done[i] = 1;
        const tileX = tx * TILE;
        const tileY = ty * TILE;
        const tw = Math.min(TILE, this.w - tileX);
        const th = Math.min(TILE, this.h - tileY);
        const ex = Math.max(0, tileX - this.margin);
        const ey = Math.max(0, tileY - this.margin);
        const ew = Math.min(this.w, tileX + tw + this.margin) - ex;
        const eh = Math.min(this.h, tileY + th + this.margin) - ey;
        const sub = new Uint8ClampedArray(ew * eh * 4);
        for (let y = 0; y < eh; y++) sub.set(this.base.subarray(((ey + y) * this.w + ex) * 4, ((ey + y) * this.w + ex + ew) * 4), y * ew * 4);
        const out = this.fn(sub, ew, eh);
        const tile = new ImageData(tw, th);
        for (let y = 0; y < th; y++) {
          const from = ((tileY - ey + y) * ew + (tileX - ex)) * 4;
          tile.data.set(out.subarray(from, from + tw * 4), y * tw * 4);
        }
        ctx.putImageData(tile, tileX, tileY);
      }
    }
  }
}

/* ---------------------------------- session ---------------------------------- */

let tmpCanvas: HTMLCanvasElement | null = null;
function tmp(w: number, h: number): HTMLCanvasElement {
  if (!tmpCanvas || tmpCanvas.width < w || tmpCanvas.height < h) {
    tmpCanvas = makeCanvas(Math.max(w, tmpCanvas?.width ?? 0, 64), Math.max(h, tmpCanvas?.height ?? 0, 64));
  }
  return tmpCanvas;
}

export interface StrokeOptions {
  mode: StrokeMode;
  opacity: number;
  /** For mask painting: 0 = hide (black) … 1 = reveal (white). */
  maskGray?: number;
  effect?: { fn: (data: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray; margin: number };
}

export class StrokeSession {
  readonly layerId: string;
  readonly target: 'layer' | 'mask';
  readonly area: Rect;
  readonly preview: HTMLCanvasElement;
  readonly buf: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private baseX: number;
  private baseY: number;
  private reveal: boolean;
  private sel: Selection | null;
  private dirty: Rect | null = null;
  private touched: Rect | null = null;
  private effect: EffectTiles | null = null;
  readonly bufCtx: CanvasRenderingContext2D;

  constructor(
    private engine: PhotoEngine,
    layer: Layer,
    target: 'layer' | 'mask',
    readonly options: StrokeOptions,
  ) {
    const doc = engine.doc!;
    this.layerId = layer.id;
    this.target = target;
    this.sel = doc.selection;
    if (target === 'mask' && layer.mask) {
      this.base = layer.mask.canvas;
      this.baseX = layer.mask.x;
      this.baseY = layer.mask.y;
      this.reveal = layer.mask.reveal;
    } else if (layer.type === 'raster') {
      this.base = layer.canvas;
      this.baseX = layer.x;
      this.baseY = layer.y;
      this.reveal = false;
    } else throw new Error('Painting needs a pixel layer');
    this.area = unionRects({ x: 0, y: 0, w: doc.width, h: doc.height }, { x: this.baseX, y: this.baseY, w: this.base.width, h: this.base.height })!;
    this.preview = makeCanvas(this.area.w, this.area.h);
    this.buf = makeCanvas(this.area.w, this.area.h);
    this.bufCtx = ctx2d(this.buf);
    this.drawBase(ctx2d(this.preview), { x: 0, y: 0, w: this.area.w, h: this.area.h });
    if (options.mode === 'effect' && options.effect) {
      const data = readPixels(this.preview).data;
      this.effect = new EffectTiles(data, this.area.w, this.area.h, options.effect.fn, options.effect.margin);
    }
  }

  private drawBase(ctx: CanvasRenderingContext2D, r: Rect): void {
    const bx = this.baseX - this.area.x;
    const by = this.baseY - this.area.y;
    if (this.reveal) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.clearRect(bx, by, this.base.width, this.base.height);
    }
    ctx.drawImage(this.base, bx, by);
  }

  /** Marks a doc-space rect as changed. */
  touch(r: Rect): void {
    this.dirty = unionRects(this.dirty, r);
    this.touched = unionRects(this.touched, r);
  }

  /** Draws a stamp centered at doc (x, y). */
  dab(stamp: HTMLCanvasElement, x: number, y: number, alpha: number, pixelSnap = false): void {
    let dx = x - stamp.width / 2 - this.area.x;
    let dy = y - stamp.height / 2 - this.area.y;
    if (pixelSnap) {
      dx = Math.round(dx);
      dy = Math.round(dy);
    }
    const ctx = this.bufCtx;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(stamp, dx, dy);
    this.touch({ x: dx + this.area.x, y: dy + this.area.y, w: stamp.width, h: stamp.height });
  }

  /** Total doc-space area touched by the stroke. */
  get touchedRect(): Rect | null {
    return this.touched;
  }

  /** Recomputes the preview inside the dirty rect and shows it. */
  flush(): void {
    if (!this.dirty) return;
    const local = intersectRects(
      { x: Math.floor(this.dirty.x - this.area.x) - 1, y: Math.floor(this.dirty.y - this.area.y) - 1, w: Math.ceil(this.dirty.w) + 3, h: Math.ceil(this.dirty.h) + 3 },
      { x: 0, y: 0, w: this.area.w, h: this.area.h },
    );
    const docDirty = this.dirty;
    this.dirty = null;
    if (!local) return;
    const p = ctx2d(this.preview);
    p.save();
    p.beginPath();
    p.rect(local.x, local.y, local.w, local.h);
    p.clip();
    p.globalCompositeOperation = 'source-over';
    p.globalAlpha = 1;
    p.clearRect(local.x, local.y, local.w, local.h);
    this.drawBase(p, local);
    // coverage × selection, in a scratch canvas aligned to `local`
    const t = tmp(local.w, local.h);
    const tc = ctx2d(t);
    tc.save();
    tc.globalCompositeOperation = 'source-over';
    tc.globalAlpha = 1;
    tc.clearRect(0, 0, local.w, local.h);
    tc.drawImage(this.buf, local.x, local.y, local.w, local.h, 0, 0, local.w, local.h);
    if (this.sel) {
      const sb = this.sel.bounds;
      const sx = sb.x - this.area.x - local.x;
      const sy = sb.y - this.area.y - local.y;
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(selectionCanvas(this.sel), sx, sy);
      tc.globalCompositeOperation = 'source-over';
      // outside the selection bounds nothing is selected
      const ix0 = Math.max(0, sx);
      const iy0 = Math.max(0, sy);
      const ix1 = Math.min(local.w, sx + sb.w);
      const iy1 = Math.min(local.h, sy + sb.h);
      if (ix1 <= ix0 || iy1 <= iy0) tc.clearRect(0, 0, local.w, local.h);
      else {
        tc.clearRect(0, 0, local.w, iy0);
        tc.clearRect(0, iy1, local.w, local.h - iy1);
        tc.clearRect(0, iy0, ix0, iy1 - iy0);
        tc.clearRect(ix1, iy0, local.w - ix1, iy1 - iy0);
      }
    }
    const { mode, opacity } = this.options;
    if (mode === 'effect' && this.effect) {
      this.effect.ensure(local);
      tc.globalCompositeOperation = 'source-in';
      tc.drawImage(this.effect.canvas, local.x, local.y, local.w, local.h, 0, 0, local.w, local.h);
    }
    tc.restore();
    p.globalAlpha = Math.max(0, Math.min(1, opacity));
    if (mode === 'erase') {
      p.globalCompositeOperation = 'destination-out';
      p.drawImage(t, 0, 0, local.w, local.h, local.x, local.y, local.w, local.h);
    } else if (mode === 'mask') {
      p.globalCompositeOperation = 'destination-out';
      p.drawImage(t, 0, 0, local.w, local.h, local.x, local.y, local.w, local.h);
      p.globalAlpha = Math.max(0, Math.min(1, opacity * (this.options.maskGray ?? 1)));
      p.globalCompositeOperation = 'lighter';
      p.drawImage(t, 0, 0, local.w, local.h, local.x, local.y, local.w, local.h);
    } else if (mode === 'effect') {
      p.globalCompositeOperation = 'source-atop';
      p.drawImage(t, 0, 0, local.w, local.h, local.x, local.y, local.w, local.h);
    } else {
      p.globalCompositeOperation = 'source-over';
      p.drawImage(t, 0, 0, local.w, local.h, local.x, local.y, local.w, local.h);
    }
    p.restore();
    const rendered = { canvas: this.preview, x: this.area.x, y: this.area.y };
    if (this.target === 'mask') this.engine.setMaskOverride(this.layerId, rendered);
    else this.engine.setContentOverride(this.layerId, rendered);
    this.engine.requestRender(docDirty);
  }

  /** Coverage (stroke × selection) as a doc-area alpha buffer for `rect` (doc coords). */
  coverage(rect: Rect): Uint8Array {
    const c = makeCanvas(rect.w, rect.h);
    const ctx = ctx2d(c);
    ctx.drawImage(this.buf, this.area.x - rect.x, this.area.y - rect.y);
    if (this.sel) {
      ctx.globalCompositeOperation = 'destination-in';
      const m = makeCanvas(rect.w, rect.h);
      ctx2d(m).drawImage(selectionCanvas(this.sel), this.sel.bounds.x - rect.x, this.sel.bounds.y - rect.y);
      ctx.drawImage(m, 0, 0);
    }
    const d = readPixels(c).data;
    const out = new Uint8Array(rect.w * rect.h);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
    return out;
  }

  /** Base pixels (layer before the stroke) for a doc rect. */
  basePixels(rect: Rect): Uint8ClampedArray {
    const c = makeCanvas(rect.w, rect.h);
    this.drawBaseAt(ctx2d(c), rect);
    return readPixels(c).data;
  }

  private drawBaseAt(ctx: CanvasRenderingContext2D, rect: Rect): void {
    ctx.save();
    ctx.translate(this.area.x - rect.x, this.area.y - rect.y);
    this.drawBase(ctx, { x: 0, y: 0, w: this.area.w, h: this.area.h });
    ctx.restore();
  }

  /** New full-area canvas = base with `patch` (doc rect) replaced. */
  baseWithPatch(rect: Rect, patch: Uint8ClampedArray): HTMLCanvasElement {
    const c = makeCanvas(this.area.w, this.area.h);
    const ctx = ctx2d(c);
    this.drawBase(ctx, { x: 0, y: 0, w: this.area.w, h: this.area.h });
    ctx.putImageData(new ImageData(new Uint8ClampedArray(patch), rect.w, rect.h), rect.x - this.area.x, rect.y - this.area.y);
    return c;
  }

  /** Puts `canvas` (area sized) into the document as the new layer pixels / mask. */
  commitCanvas(canvas: HTMLCanvasElement, label: string): void {
    const engine = this.engine;
    const doc = engine.doc;
    this.clearOverride();
    if (!doc || !findLayer(doc, this.layerId)) return;
    const next: PhotoDoc = updateLayer(doc, this.layerId, (l) => {
      if (this.target === 'mask' && l.mask) return { ...l, mask: { ...l.mask, canvas, x: this.area.x, y: this.area.y } } as Layer;
      if (l.type === 'raster') return { ...l, canvas, x: this.area.x, y: this.area.y };
      return l;
    });
    engine.commit(next, label);
  }

  finish(label: string): void {
    this.flush();
    if (!this.touched) {
      this.cancel();
      return;
    }
    this.commitCanvas(this.preview, label);
  }

  clearOverride(): void {
    if (this.target === 'mask') this.engine.setMaskOverride(this.layerId, null);
    else this.engine.setContentOverride(this.layerId, null);
    this.engine.requestRender();
  }

  cancel(): void {
    this.clearOverride();
  }
}
