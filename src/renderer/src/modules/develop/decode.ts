/**
 * Importing and decoding photos: header inspection (format, EXIF, size), RAW embedded
 * previews, TIFF decoding, EXIF/container orientation, scaled decodes, small caches for
 * the active photo's preview/full-resolution bitmaps and per-photo statistics.
 */
import { computeHistogram, type Histogram } from './histogram';
import { estimateAtmosphere, type Vec3 } from './color';
import { findEmbeddedJpeg, parseJpegExif, readImageHeader, RAW_EXTENSIONS, tiffOrientation, type ExifInfo } from './exif';
import { decodeTiff } from './tiff';
import type { Photo, SourceKind } from './types';
import { t } from '../../core/i18n';

export const PREVIEW_MAX = 2048;
export const THUMB_MAX = 360;

export const PHOTO_ACCEPT = ['image/*', '.tif', '.tiff', '.heic', '.heif', ...RAW_EXTENSIONS.map((e) => `.${e}`)].join(',');

export interface Inspection {
  kind: SourceKind;
  source: Blob | null;
  orientation: number;
  width: number;
  height: number;
  exif: ExifInfo | null;
  error?: string;
  note?: string;
}

async function readBytes(blob: Blob, start = 0, end = blob.size): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, Math.min(end, blob.size)).arrayBuffer());
}

const swapsAxes = (o: number) => o >= 5 && o <= 8;

/** Looks at a file's header: what it is, how big, EXIF, and how to decode it. */
export async function inspectFile(file: File): Promise<Inspection> {
  const head = await readBytes(file, 0, 4 * 1024 * 1024);
  const header = readImageHeader(head, file.name);
  switch (header.format) {
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'avif':
      return { kind: 'image', source: file, orientation: 1, width: header.width, height: header.height, exif: header.exif };
    case 'tiff': {
      const orientation = tiffOrientation(head);
      const [w, h] = swapsAxes(orientation) ? [header.height, header.width] : [header.width, header.height];
      return { kind: 'tiff', source: file, orientation, width: w, height: h, exif: header.exif };
    }
    case 'raw':
      return inspectRaw(file, head, header.exif);
    case 'heic':
      return {
        kind: 'unsupported',
        source: null,
        orientation: 1,
        width: header.width,
        height: header.height,
        exif: null,
        error: t('HEIC/HEIF photos can’t be decoded here. Export them as JPEG first (on iPhone: Settings → Camera → Formats → Most Compatible).'),
      };
    default:
      // let the browser try (e.g. unusual extensions)
      if (file.type.startsWith('image/')) return { kind: 'image', source: file, orientation: 1, width: 0, height: 0, exif: null };
      return { kind: 'unsupported', source: null, orientation: 1, width: 0, height: 0, exif: null, error: t('This file type is not supported.') };
  }
}

async function inspectRaw(file: File, head: Uint8Array, exif: ExifInfo | null): Promise<Inspection> {
  let found = findEmbeddedJpeg(head, { scan: false });
  if (!found && file.size <= 160 * 1024 * 1024) {
    const all = await readBytes(file);
    found = findEmbeddedJpeg(all);
  }
  if (!found || found.width < 160) {
    return {
      kind: 'unsupported',
      source: null,
      orientation: 1,
      width: 0,
      height: 0,
      exif,
      error: t('RAW files can’t be decoded in the browser engine. Export this photo to JPEG or TIFF from your camera software (or Lightroom / darktable / RawTherapee) and import that instead.'),
    };
  }
  const source = file.slice(found.offset, found.offset + found.length, 'image/jpeg');
  // the embedded JPEG may carry its own orientation; otherwise use the RAW container's
  const embeddedExif = parseJpegExif(await readBytes(source, 0, 128 * 1024));
  const own = embeddedExif?.orientation ?? 1;
  const orientation = own !== 1 ? 1 : tiffOrientation(head);
  const effective = own !== 1 ? own : orientation;
  const [w, h] = swapsAxes(effective) ? [found.height, found.width] : [found.width, found.height];
  return {
    kind: 'raw',
    source,
    orientation,
    width: w,
    height: h,
    exif: exif ?? embeddedExif,
    note: t('RAW file: using its embedded JPEG preview ({w}×{h}).', { w, h }),
  };
}

/* --------------------------------- Decoding --------------------------------- */

function newCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Applies an EXIF orientation (2–8) to a bitmap. */
async function orient(bitmap: ImageBitmap, o: number): Promise<ImageBitmap> {
  if (o <= 1 || o > 8) return bitmap;
  const w = bitmap.width;
  const h = bitmap.height;
  const swap = swapsAxes(o);
  const canvas = newCanvas(swap ? h : w, swap ? w : h);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return bitmap;
  // standard EXIF orientation transforms
  const tf: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  ctx.setTransform(...tf[o]);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return createImageBitmap(canvas);
}

/** Decodes a photo at full resolution (orientation applied). */
export async function decodeFull(photo: Pick<Photo, 'kind' | 'source' | 'orientation' | 'name'>): Promise<ImageBitmap> {
  if (!photo.source) throw new Error(t('The original file is missing. Re-import it to edit this photo.'));
  if (photo.kind === 'unsupported' || photo.kind === 'missing') throw new Error(t('This file type is not supported.'));
  let bitmap: ImageBitmap;
  if (photo.kind === 'tiff') {
    const img = await decodeTiff(new Uint8Array(await photo.source.arrayBuffer()));
    bitmap = await createImageBitmap(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height));
  } else {
    try {
      bitmap = await createImageBitmap(photo.source, { imageOrientation: 'from-image', premultiplyAlpha: 'premultiply' });
    } catch {
      throw new Error(t('Could not decode “{name}”. The file may be damaged or in an unsupported format.', { name: photo.name }));
    }
  }
  return orient(bitmap, photo.orientation);
}

/** Scales a bitmap so its long edge is at most `max` (returns the same bitmap when smaller). */
export async function downscale(bitmap: ImageBitmap, max: number, close = false): Promise<ImageBitmap> {
  const long = Math.max(bitmap.width, bitmap.height);
  if (long <= max) return bitmap;
  const s = max / long;
  const out = await createImageBitmap(bitmap, {
    resizeWidth: Math.max(1, Math.round(bitmap.width * s)),
    resizeHeight: Math.max(1, Math.round(bitmap.height * s)),
    resizeQuality: 'high',
  });
  if (close) bitmap.close();
  return out;
}

/** RGBA pixels of a bitmap scaled to fit `max` (for statistics). */
export function bitmapPixels(bitmap: ImageBitmap, max = 256): { data: Uint8ClampedArray; width: number; height: number } {
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  const canvas = newCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

export async function bitmapToBlob(bitmap: ImageBitmap | HTMLCanvasElement | OffscreenCanvas, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
  const canvas = newCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));
}

/* ---------------------------------- Caches ---------------------------------- */

/** Photos that share pixels (virtual copies) share decoded data. */
export function sourceKeyOf(photo: Pick<Photo, 'id' | 'masterId'>): string {
  return photo.masterId ?? photo.id;
}

export interface PreviewSource {
  key: string;
  bitmap: ImageBitmap;
  /** Full-resolution size (oriented). */
  fullW: number;
  fullH: number;
  /** Preview px per full-res px. */
  scale: number;
}

export interface PhotoStats {
  atmos: Vec3;
  histogram: Histogram;
}

const previewCache = new Map<string, PreviewSource>();
const previewPending = new Map<string, Promise<PreviewSource>>();
const statsCache = new Map<string, PhotoStats>();
let fullCache: { key: string; bitmap: ImageBitmap } | null = null;
let fullPending: { key: string; promise: Promise<ImageBitmap> } | null = null;
const PREVIEW_CACHE_SIZE = 4;

/** Preview bitmap (long edge ≤ 2048) + full-res size; keeps the full bitmap of the latest photo. */
export function getPreview(photo: Photo): Promise<PreviewSource> {
  const key = sourceKeyOf(photo);
  const cached = previewCache.get(key);
  if (cached) {
    previewCache.delete(key);
    previewCache.set(key, cached);
    return Promise.resolve(cached);
  }
  const pending = previewPending.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const full = await getFull(photo);
    const bitmap = await downscale(full, PREVIEW_MAX);
    const src: PreviewSource = { key, bitmap, fullW: full.width, fullH: full.height, scale: bitmap.width / full.width };
    previewCache.set(key, src);
    while (previewCache.size > PREVIEW_CACHE_SIZE) {
      const [oldKey, old] = previewCache.entries().next().value as [string, PreviewSource];
      previewCache.delete(oldKey);
      if (old.bitmap !== fullCache?.bitmap) old.bitmap.close();
    }
    return src;
  })().finally(() => previewPending.delete(key));
  previewPending.set(key, promise);
  return promise;
}

export function peekPreview(photo: Photo): PreviewSource | undefined {
  return previewCache.get(sourceKeyOf(photo));
}

/** Full-resolution bitmap (only one photo is kept in memory). */
export function getFull(photo: Photo): Promise<ImageBitmap> {
  const key = sourceKeyOf(photo);
  if (fullCache?.key === key) return Promise.resolve(fullCache.bitmap);
  if (fullPending?.key === key) return fullPending.promise;
  const promise = decodeFull(photo).then((bitmap) => {
    const keepOld = fullCache && [...previewCache.values()].some((p) => p.bitmap === fullCache!.bitmap);
    if (fullCache && !keepOld) fullCache.bitmap.close();
    fullCache = { key, bitmap };
    return bitmap;
  });
  fullPending = { key, promise };
  void promise.catch(() => undefined).finally(() => {
    if (fullPending?.promise === promise) fullPending = null;
  });
  return promise;
}

export function peekFull(photo: Photo): ImageBitmap | null {
  return fullCache?.key === sourceKeyOf(photo) ? fullCache.bitmap : null;
}

/** Airlight + unedited histogram (for dehaze and Auto Tone). */
export async function getStats(photo: Photo): Promise<PhotoStats> {
  const key = sourceKeyOf(photo);
  const cached = statsCache.get(key);
  if (cached) return cached;
  const preview = await getPreview(photo);
  const px = bitmapPixels(preview.bitmap, 256);
  const stats: PhotoStats = { atmos: estimateAtmosphere(px.data, px.width, px.height), histogram: computeHistogram(px.data) };
  statsCache.set(key, stats);
  return stats;
}

export function peekStats(photo: Photo): PhotoStats | undefined {
  return statsCache.get(sourceKeyOf(photo));
}

/** Drops everything cached for these source keys (photos removed from the library). */
export function forgetSources(keys: string[]): void {
  for (const key of keys) {
    const p = previewCache.get(key);
    if (p) {
      previewCache.delete(key);
      if (p.bitmap !== fullCache?.bitmap) p.bitmap.close();
    }
    statsCache.delete(key);
    if (fullCache?.key === key) {
      fullCache.bitmap.close();
      fullCache = null;
    }
  }
}

/** Decodes a small unedited thumbnail. Returns its JPEG blob and the full-res size. */
export async function makeThumbnail(photo: Photo): Promise<{ blob: Blob; fullW: number; fullH: number; thumb: ImageBitmap }> {
  const cachedPreview = peekPreview(photo);
  let fullW: number;
  let fullH: number;
  let thumb: ImageBitmap;
  if (cachedPreview) {
    fullW = cachedPreview.fullW;
    fullH = cachedPreview.fullH;
    thumb = await downscale(cachedPreview.bitmap, THUMB_MAX);
    if (thumb === cachedPreview.bitmap) thumb = await createImageBitmap(cachedPreview.bitmap);
  } else {
    const full = await decodeFull(photo);
    fullW = full.width;
    fullH = full.height;
    thumb = await downscale(full, THUMB_MAX, true);
  }
  const blob = await bitmapToBlob(thumb, 'image/jpeg', 0.86);
  return { blob, fullW, fullH, thumb };
}

/** Converts a data:/blob: URL or other module's image handoff into a File. */
export async function urlToFile(url: string, name: string): Promise<File> {
  const blob = await (await fetch(url)).blob();
  return new File([blob], name, { type: blob.type || 'image/png', lastModified: Date.now() });
}
