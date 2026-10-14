import { bytesToBase64 } from './base64';

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function get2d(canvas: HTMLCanvasElement | OffscreenCanvas, willReadFrequently = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/** Decodes an image File/Blob/URL into an HTMLImageElement. */
export function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

/** Draws any image source into a new canvas (optionally scaled down to fit maxSize). */
export function imageToCanvas(image: CanvasImageSource & { width: number; height: number }, maxSize?: number): HTMLCanvasElement {
  let w = (image as HTMLImageElement).naturalWidth || image.width;
  let h = (image as HTMLImageElement).naturalHeight || image.height;
  if (maxSize && Math.max(w, h) > maxSize) {
    const s = maxSize / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = createCanvas(w, h);
  get2d(canvas).drawImage(image, 0, 0, w, h);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality);
  });
}

/**
 * Snapshot of a canvas for AI vision input: downscaled (default max 1280px), encoded as
 * JPEG (or PNG when transparency matters), returned as raw base64 without the data: prefix.
 */
export async function canvasToAIImage(
  canvas: HTMLCanvasElement,
  options: { maxSize?: number; format?: 'jpeg' | 'png' } = {},
): Promise<{ mime: string; base64: string }> {
  const maxSize = options.maxSize ?? 1280;
  const source = Math.max(canvas.width, canvas.height) > maxSize ? imageToCanvas(canvas, maxSize) : canvas;
  const format = options.format ?? 'jpeg';
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  let out = source;
  if (format === 'jpeg') {
    // flatten on white so transparent areas don't turn black
    out = createCanvas(source.width, source.height);
    const ctx = get2d(out);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, 0, 0);
  }
  const blob = await canvasToBlob(out, mime, 0.88);
  return { mime, base64: bytesToBase64(await blob.arrayBuffer()) };
}

/** Fits a (w,h) box inside (maxW,maxH) keeping aspect ratio. */
export function fitSize(w: number, h: number, maxW: number, maxH: number): { width: number; height: number; scale: number } {
  const scale = Math.min(maxW / w, maxH / h);
  return { width: w * scale, height: h * scale, scale };
}

export const IMAGE_ACCEPT = 'image/*,.psd,.svg';
export const VIDEO_ACCEPT = 'video/*,.mkv,.mov';
export const AUDIO_ACCEPT = 'audio/*,.flac,.m4a,.opus';
