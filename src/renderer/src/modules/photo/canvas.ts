/**
 * Canvas helpers (DOM). Canvases referenced by a document are immutable: every function
 * here returns NEW canvases.
 */
import type { Rect, Selection } from './types';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', willReadFrequently ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available (the image may be too large)');
  return ctx;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function readPixels(canvas: HTMLCanvasElement, rect?: Rect): ImageData {
  const r = rect ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
  return ctx2d(canvas).getImageData(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h));
}

export function canvasFromPixels(data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const img = new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, w * h * 4), w, h);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

export function filledCanvas(w: number, h: number, color: string): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** New canvas covering `area` (doc coords) with `src` (placed at sx, sy) drawn into it. */
export function placeInArea(src: HTMLCanvasElement | null, sx: number, sy: number, area: Rect): HTMLCanvasElement {
  const c = makeCanvas(area.w, area.h);
  if (src) ctx2d(c).drawImage(src, sx - area.x, sy - area.y);
  return c;
}

export function flipCanvas(src: HTMLCanvasElement, axis: 'horizontal' | 'vertical'): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = ctx2d(c);
  if (axis === 'horizontal') ctx.setTransform(-1, 0, 0, 1, src.width, 0);
  else ctx.setTransform(1, 0, 0, -1, 0, src.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Rotates by a multiple of 90° clockwise. */
export function rotateCanvas90(src: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (q === 0) return cloneCanvas(src);
  const swap = q % 2 === 1;
  const c = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = ctx2d(c);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export type ResampleQuality = 'high' | 'medium' | 'low' | 'nearest';

/** Scales a canvas (multi-step halving when shrinking a lot, for quality). */
export function scaleCanvas(src: HTMLCanvasElement, w: number, h: number, quality: ResampleQuality = 'high'): HTMLCanvasElement {
  const tw = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(h));
  let cur = src;
  if (quality !== 'nearest') {
    while (cur.width / 2 >= tw && cur.height / 2 >= th && cur.width > 2) {
      const half = makeCanvas(Math.ceil(cur.width / 2), Math.ceil(cur.height / 2));
      const hctx = ctx2d(half);
      hctx.imageSmoothingQuality = 'high';
      hctx.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
  }
  const c = makeCanvas(tw, th);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = quality !== 'nearest';
  if (quality !== 'nearest') ctx.imageSmoothingQuality = quality;
  ctx.drawImage(cur, 0, 0, tw, th);
  return c;
}

/** Bounds of the non-transparent pixels of a canvas (null when fully transparent). */
export function alphaBounds(canvas: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = canvas;
  const data = readPixels(canvas).data;
  let minX = w;
  let minY = -1;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let x0 = -1;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3]) {
        x0 = x;
        break;
      }
    }
    if (x0 < 0) continue;
    let x1 = x0;
    for (let x = w - 1; x > x0; x--) {
      if (data[row + x * 4 + 3]) {
        x1 = x;
        break;
      }
    }
    if (minY < 0) minY = y;
    maxY = y;
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const alphaBoundsCache = new WeakMap<HTMLCanvasElement, Rect | null>();
export function cachedAlphaBounds(canvas: HTMLCanvasElement): Rect | null {
  if (!alphaBoundsCache.has(canvas)) alphaBoundsCache.set(canvas, alphaBounds(canvas));
  return alphaBoundsCache.get(canvas) ?? null;
}

export function cropCanvas(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = makeCanvas(r.w, r.h);
  ctx2d(c).drawImage(src, -r.x, -r.y);
  return c;
}

/* ------------------------------ Selection canvas ------------------------------ */

const selectionCanvasCache = new WeakMap<Selection, HTMLCanvasElement>();

/** Canvas (selection bounds size, at bounds.x/y) whose alpha is the selection mask. */
export function selectionCanvas(sel: Selection): HTMLCanvasElement {
  let c = selectionCanvasCache.get(sel);
  if (c) return c;
  const b = sel.bounds;
  c = makeCanvas(b.w, b.h);
  const img = new ImageData(b.w, b.h);
  const d = img.data;
  for (let y = 0; y < b.h; y++) {
    const srow = (b.y + y) * sel.width + b.x;
    for (let x = 0; x < b.w; x++) {
      const o = (y * b.w + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = sel.mask[srow + x];
    }
  }
  ctx2d(c).putImageData(img, 0, 0);
  selectionCanvasCache.set(sel, c);
  return c;
}

/** Clips everything already drawn in `ctx` (whose origin is doc point ox,oy) to the selection. */
export function clipToSelection(ctx: CanvasRenderingContext2D, sel: Selection | null, ox: number, oy: number): void {
  if (!sel) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(selectionCanvas(sel), sel.bounds.x - ox, sel.bounds.y - oy);
  ctx.restore();
}

/** Pixels of a canvas as an RGBA buffer for the region `area` (doc coords) — canvas placed at sx, sy. */
export function pixelsInArea(src: HTMLCanvasElement, sx: number, sy: number, area: Rect): Uint8ClampedArray {
  return readPixels(placeInArea(src, sx, sy, area)).data;
}

export async function canvasToBlobAsync(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality);
  });
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/** A mask canvas (white, alpha = value) filled with one value. */
export function solidMaskCanvas(w: number, h: number, reveal: boolean): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  if (reveal) {
    const ctx = ctx2d(c);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/** Mask canvas from a selection (selected = revealed). */
export function maskCanvasFromSelection(sel: Selection): HTMLCanvasElement {
  const c = makeCanvas(sel.width, sel.height);
  ctx2d(c).drawImage(selectionCanvas(sel), sel.bounds.x, sel.bounds.y);
  return c;
}

/** Inverts a mask canvas' alpha. */
export function invertMaskCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(src, 0, 0);
  return c;
}
