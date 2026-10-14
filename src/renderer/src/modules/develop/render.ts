/**
 * High-level rendering on top of the WebGL pipeline: the interactive preview, small
 * offscreen renders (histogram, thumbnails, AI snapshots) and tiled full-resolution
 * renders (export, 100% detail view) that stay under MAX_TEXTURE_SIZE.
 */
import { DevelopRenderer, Pipeline } from './gl/renderer';
import { geometry, transformedBounds, type Rect } from './geometry';
import type { DevelopSettings } from './params';
import { finalUniforms, tilePadding } from './pipeline';
import type { Vec3 } from './color';
import { computeHistogram, type Histogram } from './histogram';
import type { PreviewSource } from './decode';

let renderer: DevelopRenderer | null | undefined;
let rendererError = '';

/** The shared WebGL2 renderer, or null when WebGL2 isn't available. */
export function getRenderer(): DevelopRenderer | null {
  if (renderer !== undefined) return renderer;
  try {
    renderer = new DevelopRenderer();
  } catch (error) {
    rendererError = error instanceof Error ? error.message : String(error);
    console.error('[develop] WebGL2 renderer unavailable:', error);
    renderer = null;
  }
  return renderer;
}

export function rendererProblem(): string {
  return rendererError;
}

export const previewPipeline = new Pipeline();
const utilPipeline = new Pipeline();

export interface ViewOptions {
  cropMode?: boolean;
  split?: number;
  clip?: boolean;
  /** Device px per full-res px on screen; the canvas is rendered at min(this, preview scale). */
  displayScale?: number;
}

export interface PreviewResult {
  /** Full-resolution size of what is displayed (cropped output, or the oriented frame in crop mode). */
  docW: number;
  docH: number;
  canvasW: number;
  canvasH: number;
}

/** Renders the preview of a photo into the renderer's canvas. */
export function renderPreview(src: PreviewSource, settings: DevelopSettings, atmos: Vec3, view: ViewOptions = {}): PreviewResult {
  const r = getRenderer();
  if (!r) throw new Error('WebGL 2 is not available');
  r.setSource(previewPipeline, src.bitmap, src.bitmap.width, src.bitmap.height, src.key);
  const geo = geometry(settings, src.fullW, src.fullH, view.cropMode);
  const display = view.displayScale && view.displayScale > 0 ? view.displayScale : src.scale;
  const scale = Math.max(Math.min(src.scale, display), Math.min(src.scale, 96 / Math.max(geo.outW, geo.outH)));
  const width = Math.max(1, Math.round(geo.outW * scale));
  const height = Math.max(1, Math.round(geo.outH * scale));
  r.render(previewPipeline, {
    settings,
    atmos,
    fullLong: Math.max(src.fullW, src.fullH),
    srcRect: { x: 0, y: 0, w: src.fullW, h: src.fullH },
    srcScale: scale,
    outToSrc: geo.outToSrc,
    outW: geo.outW,
    outH: geo.outH,
    region: { x: 0, y: 0, w: geo.outW, h: geo.outH },
    outScale: width / geo.outW,
    width,
    height,
    toCanvas: true,
    split: view.split,
    clip: view.clip,
    effects: !view.cropMode,
    fillOutside: view.cropMode,
  });
  return { docW: geo.outW, docH: geo.outH, canvasW: width, canvasH: height };
}

/**
 * Small offscreen render through the same (cached) preview pipeline: used for the
 * histogram. Must be called right after renderPreview for the same photo.
 */
export function previewHistogram(src: PreviewSource, settings: DevelopSettings, atmos: Vec3, cropMode = false, max = 320): Histogram | null {
  const r = getRenderer();
  if (!r || !r.hasSource(previewPipeline, src.key)) return null;
  const geo = geometry(settings, src.fullW, src.fullH, cropMode);
  const s = Math.min(src.scale, max / Math.max(geo.outW, geo.outH));
  const width = Math.max(1, Math.round(geo.outW * s));
  const height = Math.max(1, Math.round(geo.outH * s));
  r.render(previewPipeline, {
    settings,
    atmos,
    fullLong: Math.max(src.fullW, src.fullH),
    srcRect: { x: 0, y: 0, w: src.fullW, h: src.fullH },
    srcScale: src.scale,
    outToSrc: geo.outToSrc,
    outW: geo.outW,
    outH: geo.outH,
    region: { x: 0, y: 0, w: geo.outW, h: geo.outH },
    outScale: width / geo.outW,
    width,
    height,
    toCanvas: false,
    effects: !cropMode,
    fillOutside: cropMode,
  });
  return computeHistogram(r.readPixels(previewPipeline));
}

/** Renders a whole photo from a (small) bitmap into a 2D canvas — thumbnails, AI snapshots, preset previews. */
export function renderSmall(
  bitmap: ImageBitmap,
  key: string,
  fullW: number,
  fullH: number,
  settings: DevelopSettings,
  atmos: Vec3,
  maxSize: number,
): HTMLCanvasElement {
  const r = getRenderer();
  if (!r) throw new Error('WebGL 2 is not available');
  const geo = geometry(settings, fullW, fullH);
  const srcScale = bitmap.width / fullW;
  const s = Math.min(srcScale, maxSize / Math.max(geo.outW, geo.outH));
  const width = Math.max(1, Math.round(geo.outW * s));
  const height = Math.max(1, Math.round(geo.outH * s));
  r.setSource(utilPipeline, bitmap, bitmap.width, bitmap.height, key);
  r.render(utilPipeline, {
    settings,
    atmos,
    fullLong: Math.max(fullW, fullH),
    srcRect: { x: 0, y: 0, w: fullW, h: fullH },
    srcScale,
    outToSrc: geo.outToSrc,
    outW: geo.outW,
    outH: geo.outH,
    region: { x: 0, y: 0, w: geo.outW, h: geo.outH },
    outScale: width / geo.outW,
    width,
    height,
    toCanvas: false,
  });
  const px = r.readPixels(utilPipeline);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), width, height), 0, 0);
  return canvas;
}

export interface RegionJob {
  /** Full-resolution, oriented source bitmap. */
  full: ImageBitmap;
  key: string;
  settings: DevelopSettings;
  atmos: Vec3;
  /** Region in full-resolution output px (defaults to the whole output). */
  region?: Rect;
  /** Output px per full-res output px (≤ 1 renders from a resampled source). */
  scale: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Receives each finished tile (target px, relative to the region). */
  onTile: (pixels: Uint8Array, x: number, y: number, w: number, h: number) => void;
}

export class AbortError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

/** Output size for a region job (for allocating the destination). */
export function regionSize(settings: DevelopSettings, fullW: number, fullH: number, scale: number, region?: Rect): { width: number; height: number; region: Rect } {
  const geo = geometry(settings, fullW, fullH);
  const reg = region ?? { x: 0, y: 0, w: geo.outW, h: geo.outH };
  return { width: Math.max(1, Math.round(reg.w * scale)), height: Math.max(1, Math.round(reg.h * scale)), region: reg };
}

/**
 * Renders (part of) the output at any size by splitting it into tiles; each tile
 * uploads only the source area it needs (+ blur padding), resampled to the output scale.
 */
export async function renderRegion(job: RegionJob): Promise<{ width: number; height: number }> {
  const r = getRenderer();
  if (!r) throw new Error('WebGL 2 is not available');
  const fullW = job.full.width;
  const fullH = job.full.height;
  const geo = geometry(job.settings, fullW, fullH);
  const { width, height, region } = regionSize(job.settings, fullW, fullH, job.scale, job.region);
  const uniforms = finalUniforms(job.settings, job.atmos);
  const srcScale = Math.min(1, job.scale);
  const pad = tilePadding(job.settings, Math.max(fullW, fullH)) + 2;
  // tile size in target px so that the (rotated, padded) source area fits the texture limit
  const limit = Math.min(r.maxTexture, 8192);
  const tile = Math.max(256, Math.min(1536, Math.floor((limit - 2 * pad * srcScale) / 1.45)));
  const cols = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  const total = cols * rows;
  let done = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (job.signal?.aborted) throw new AbortError();
      const px = tx * tile;
      const py = ty * tile;
      const tw = Math.min(tile, width - px);
      const th = Math.min(tile, height - py);
      // tile area in full-res output coordinates
      const tileRegion: Rect = { x: region.x + px / job.scale, y: region.y + py / job.scale, w: tw / job.scale, h: th / job.scale };
      const b = transformedBounds(geo.outToSrc, tileRegion);
      const sx = Math.max(0, Math.floor(b.x - pad));
      const sy = Math.max(0, Math.floor(b.y - pad));
      const ex = Math.min(fullW, Math.ceil(b.x + b.w + pad));
      const ey = Math.min(fullH, Math.ceil(b.y + b.h + pad));
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);
      const rw = Math.max(1, Math.round(sw * srcScale));
      const rh = Math.max(1, Math.round(sh * srcScale));
      const tileSrc =
        srcScale < 1
          ? await createImageBitmap(job.full, sx, sy, sw, sh, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' })
          : await createImageBitmap(job.full, sx, sy, sw, sh);
      if (job.signal?.aborted) {
        tileSrc.close();
        throw new AbortError();
      }
      try {
        r.setSource(utilPipeline, tileSrc, tileSrc.width, tileSrc.height, `${job.key}|${sx},${sy},${sw},${sh}|${rw}x${rh}|${Math.random()}`);
        r.render(utilPipeline, {
          settings: job.settings,
          uniforms,
          atmos: job.atmos,
          fullLong: Math.max(fullW, fullH),
          srcRect: { x: sx, y: sy, w: sw, h: sh },
          srcScale: tileSrc.width / sw,
          outToSrc: geo.outToSrc,
          outW: geo.outW,
          outH: geo.outH,
          region: tileRegion,
          outScale: job.scale,
          width: tw,
          height: th,
          toCanvas: false,
        });
        job.onTile(r.readPixels(utilPipeline), px, py, tw, th);
      } finally {
        tileSrc.close();
      }
      done++;
      job.onProgress?.(done, total);
      // let the UI breathe between tiles
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { width, height };
}

/** Full render into a 2D canvas (export). */
export async function renderToCanvas(job: Omit<RegionJob, 'onTile'>): Promise<HTMLCanvasElement> {
  const { width, height } = regionSize(job.settings, job.full.width, job.full.height, job.scale, job.region);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  await renderRegion({
    ...job,
    onTile: (pixels, x, y, w, h) => ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, 0, w * h * 4), w, h), x, y),
  });
  return canvas;
}
