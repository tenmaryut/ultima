import { blobToBase64, dataUrlToBlob } from '../../core/utils/base64';
import { loadImage } from '../../core/utils/image';
import { uid } from '../../core/utils/id';
import type { SerializedAsset } from './project';
import type { MediaProvider } from './render';
import type { Asset, Layer, MotionDoc } from './types';

/** Image / video assets: loading, decoding caches, preview playback and export frames (DOM). */

export const MAX_VIDEO_BYTES = 400 * 1024 * 1024;

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(file.name);
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(file.name);
}

function probeVideo(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = () => {
      v.removeAttribute('src');
      v.load();
    };
    v.onloadedmetadata = () => {
      const r = { width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : 0 };
      done();
      if (!r.width || !r.height) reject(new Error('The video has no picture track.'));
      else resolve(r);
    };
    v.onerror = () => {
      done();
      reject(new Error('This video format cannot be played here.'));
    };
    v.src = url;
  });
}

/** Creates an asset from a file/blob. Throws a readable error when it can't be decoded. */
export async function createAsset(blob: Blob, name: string, kind: 'image' | 'video', id = uid('a')): Promise<Asset> {
  const url = URL.createObjectURL(blob);
  try {
    if (kind === 'image') {
      const img = await loadImage(url);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) throw new Error('The image is empty.');
      return { id, kind, name, mime: blob.type || 'image/png', width, height, blob, url };
    }
    if (blob.size > MAX_VIDEO_BYTES) throw new Error('This video is too large to embed in a motion project (max 400 MB).');
    const meta = await probeVideo(url);
    return { id, kind, name, mime: blob.type || 'video/mp4', width: meta.width, height: meta.height, duration: meta.duration, blob, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function assetToDataUrl(asset: Asset): Promise<string> {
  const mime = asset.mime || asset.blob.type || 'application/octet-stream';
  return `data:${mime};base64,${await blobToBase64(asset.blob)}`;
}

export async function assetsToDataUrls(doc: MotionDoc): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const a of Object.values(doc.assets)) out[a.id] = await assetToDataUrl(a);
  return out;
}

/** Restores assets from a project file. Assets that fail to decode are skipped (reported). */
export async function restoreAssets(list: SerializedAsset[]): Promise<{ assets: Record<string, Asset>; failed: string[] }> {
  const assets: Record<string, Asset> = {};
  const failed: string[] = [];
  for (const s of list) {
    try {
      const blob = dataUrlToBlob(s.data);
      assets[s.id] = await createAsset(blob, s.name, s.kind, s.id);
    } catch {
      failed.push(s.name);
    }
  }
  return { assets, failed };
}

export function revokeAssets(assets: Record<string, Asset>): void {
  for (const a of Object.values(assets)) URL.revokeObjectURL(a.url);
}

/* ------------------------------ Decoded images ------------------------------ */

/** Decoded images by asset id; calls `onReady` when a new image finished decoding. */
export class ImageCache {
  private images = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  constructor(private onReady: () => void) {}

  get(asset: Asset | undefined): HTMLImageElement | null {
    if (!asset) return null;
    const img = this.images.get(asset.id);
    if (img && img.src === asset.url) return img;
    if (!this.loading.has(asset.id)) {
      this.loading.add(asset.id);
      void loadImage(asset.url)
        .then((loaded) => {
          this.images.set(asset.id, loaded);
          this.onReady();
        })
        .catch(() => undefined)
        .finally(() => this.loading.delete(asset.id));
    }
    return null;
  }

  /** Decodes every image of a document (export needs them all before the first frame). */
  async preload(doc: MotionDoc): Promise<void> {
    await Promise.all(
      Object.values(doc.assets)
        .filter((a) => a.kind === 'image')
        .map(async (a) => {
          const img = this.images.get(a.id);
          if (img && img.src === a.url) return;
          this.images.set(a.id, await loadImage(a.url));
        }),
    );
  }

  clear(): void {
    this.images.clear();
  }
}

/* ------------------------------- Preview video ------------------------------ */

function mediaTimeFor(layer: Layer, t: number): number {
  return t - layer.inPoint + (layer.mediaOffset ?? 0);
}

/**
 * One <video> element per video layer for real-time preview. While paused, frames are
 * seeked precisely (and `onFrame` asks for a redraw once the seek finished).
 */
export class VideoPool {
  private els = new Map<string, HTMLVideoElement>();
  playing = false;
  constructor(private onFrame: () => void) {}

  frame(layer: Layer, asset: Asset | undefined, t: number): HTMLVideoElement | null {
    if (!asset) return null;
    let el = this.els.get(layer.id);
    if (!el || el.dataset.asset !== asset.id) {
      el?.pause();
      el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.dataset.asset = asset.id;
      el.src = asset.url;
      el.addEventListener('seeked', () => this.onFrame());
      el.addEventListener('loadeddata', () => this.onFrame());
      this.els.set(layer.id, el);
    }
    const mt = mediaTimeFor(layer, t);
    const duration = asset.duration ?? el.duration ?? 0;
    if (mt < 0 || (duration && mt > duration + 0.05)) {
      if (!el.paused) el.pause();
      return null;
    }
    if (this.playing) {
      if (el.paused) void el.play().catch(() => undefined);
      if (Math.abs(el.currentTime - mt) > 0.25) el.currentTime = mt;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - mt) > 0.5 / 60) el.currentTime = mt;
    }
    return el.readyState >= 2 ? el : null;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (!playing) for (const el of this.els.values()) el.pause();
  }

  /** Drops elements of layers that no longer exist. */
  prune(doc: MotionDoc): void {
    const ids = new Set(doc.layers.map((l) => l.id));
    for (const [id, el] of this.els) {
      if (!ids.has(id)) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        this.els.delete(id);
      }
    }
  }

  dispose(): void {
    for (const el of this.els.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.els.clear();
  }
}

/** Media provider for the stage (images from the cache, videos from the pool). */
export function previewMedia(doc: MotionDoc, images: ImageCache, videos: VideoPool): MediaProvider {
  return {
    image: (id) => images.get(doc.assets[id]),
    video: (layer, t) => videos.frame(layer, layer.assetId ? doc.assets[layer.assetId] : undefined, t),
  };
}

/* ------------------------------- Export video ------------------------------- */

interface ExportVideoTrack {
  dispose: () => void;
  next: () => Promise<CanvasImageSource | null>;
}

/**
 * Frame-accurate video frames for export, decoded with mediabunny. Call `prepare(t)` before
 * rendering each frame (times must increase); `provider` then returns the decoded frames.
 */
export class ExportVideoFrames {
  private tracks = new Map<string, ExportVideoTrack>();
  private current = new Map<string, CanvasImageSource | null>();

  static async create(doc: MotionDoc, times: number[]): Promise<ExportVideoFrames> {
    const frames = new ExportVideoFrames();
    const videoLayers = doc.layers.filter((l) => l.type === 'video' && l.assetId && doc.assets[l.assetId]);
    if (!videoLayers.length) return frames;
    const mb = await import('mediabunny');
    for (const layer of videoLayers) {
      const asset = doc.assets[layer.assetId!];
      const input = new mb.Input({ source: new mb.BlobSource(asset.blob), formats: mb.ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) throw new Error('cannot decode');
        const sink = new mb.CanvasSink(track, { poolSize: 2 });
        const timestamps = times.map((t) => Math.max(0, mediaTimeFor(layer, t)));
        const it = sink.canvasesAtTimestamps(timestamps);
        frames.tracks.set(layer.id, {
          dispose: () => {
            void it.return(undefined);
            input.dispose();
          },
          next: async () => {
            const r = await it.next();
            return r.done || !r.value ? null : (r.value.canvas as CanvasImageSource);
          },
        });
      } catch {
        input.dispose();
        // Falls back to drawing nothing for this layer (reported by the caller via `missing`).
        frames.missing.push(layer.name);
      }
    }
    return frames;
  }

  missing: string[] = [];

  async prepare(): Promise<void> {
    for (const [id, track] of this.tracks) this.current.set(id, await track.next());
  }

  frame(layer: Layer): CanvasImageSource | null {
    return this.current.get(layer.id) ?? null;
  }

  dispose(): void {
    for (const t of this.tracks.values()) t.dispose();
    this.tracks.clear();
    this.current.clear();
  }
}
