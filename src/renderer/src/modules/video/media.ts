import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { uid } from '../../core/utils/id';
import { fileExtension } from '../../core/utils/format';
import { canvasToBlob, createCanvas, get2d } from '../../core/utils/image';
import { pathForFile } from '../../core/platform';
import type { MediaKind, MediaRef } from './types';
import { computeMediaPeaks, forgetAudio, type Peaks } from './audioSource';

/* Runtime media: Files, object URLs, decoded stills, thumbnails, filmstrips and waveforms. */

export interface Filmstrip {
  times: number[];
  frames: CanvasImageSource[];
  width: number;
  height: number;
}

export interface RuntimeMedia {
  id: string;
  file: File;
  url: string;
  /** Small poster image URL. */
  thumb?: string;
  image?: HTMLImageElement;
  filmstrip?: Filmstrip;
  peaks?: Peaks | null;
  /** The <video>/<audio> element can play it (preview works). */
  playable: boolean;
  /** WebCodecs (mediabunny) can decode its video track (frame-accurate export). */
  decodable: boolean;
}

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv', 'avi', '3gp']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'weba']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg']);

export const MEDIA_ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov,.flac,.m4a,.opus';

export function mediaKindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return mediaKindOfName(file.name);
}

/** Media kind from a file name's extension alone (files in linked folders before they are opened). */
export function mediaKindOfName(name: string): MediaKind | null {
  const ext = fileExtension(name);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  return null;
}

interface Probe {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  decodable: boolean;
  fps?: number;
}

async function probeMediabunny(file: File): Promise<Probe | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) return null;
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    let duration = (await input.getDurationFromMetadata().catch(() => null)) ?? 0;
    if (!duration || !Number.isFinite(duration)) duration = await input.computeDuration();
    return {
      duration,
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
      decodable: video ? await video.canDecode() : false,
      fps: video ? (await video.computePacketStats(90).catch(() => null))?.averagePacketRate : undefined,
    };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

function once(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onEvent = () => finish(true);
    const onError = () => finish(false);
    function finish(ok: boolean) {
      clearTimeout(timer);
      el.removeEventListener(event, onEvent);
      el.removeEventListener('error', onError);
      resolve(ok);
    }
    el.addEventListener(event, onEvent);
    el.addEventListener('error', onError);
  });
}

/** Loads metadata in a media element: tells whether the built-in player can play the file. */
async function probeElement(url: string, kind: 'video' | 'audio'): Promise<{ duration: number; width: number; height: number } | null> {
  const el = document.createElement(kind);
  el.preload = 'metadata';
  el.muted = true;
  el.src = url;
  try {
    if (!(await once(el, 'loadedmetadata', 15000))) return null;
    let duration = el.duration;
    if (!Number.isFinite(duration)) {
      // e.g. MediaRecorder WebM without duration: seek far to make the browser find the end
      el.currentTime = 1e9;
      await once(el, 'durationchange', 5000);
      duration = Number.isFinite(el.duration) ? el.duration : 0;
    }
    const v = el as HTMLVideoElement;
    if (kind === 'video' && !v.videoWidth) return null;
    return { duration, width: kind === 'video' ? v.videoWidth : 0, height: kind === 'video' ? v.videoHeight : 0 };
  } finally {
    el.removeAttribute('src');
    el.load();
  }
}

async function seekElementFrame(el: HTMLVideoElement, t: number): Promise<boolean> {
  if (Math.abs(el.currentTime - t) < 1e-3 && el.readyState >= 2) return true;
  el.currentTime = t;
  return once(el, 'seeked', 5000);
}

/** Runs async jobs one (or `n`) at a time. */
class Queue {
  private running = 0;
  private waiting: (() => void)[] = [];
  constructor(private n: number) {}
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.n) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}

export class MediaLibrary {
  private items = new Map<string, RuntimeMedia>();
  private listeners = new Set<() => void>();
  private jobs = new Map<string, Promise<unknown>>();
  private heavy = new Queue(1);
  private probes = new Queue(3);
  version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get(id: string | undefined): RuntimeMedia | undefined {
    return id ? this.items.get(id) : undefined;
  }
  has(id: string | undefined): boolean {
    return Boolean(id && this.items.has(id));
  }
  file(id: string | undefined): File | undefined {
    return this.get(id)?.file;
  }

  /**
   * Probes files and returns their media references (unsupported/unreadable files are reported via `onSkip`).
   * `idFor` gives a file a fixed id (files from linked folders keep theirs).
   */
  async importFiles(files: File[], onSkip?: (name: string, reason: string) => void, idFor?: (file: File) => string | undefined): Promise<MediaRef[]> {
    const results = await Promise.all(
      files.map((file) =>
        this.probes.run(async () => {
          try {
            return await this.add(file, idFor?.(file) ?? uid('m_'));
          } catch (error) {
            onSkip?.(file.name, error instanceof Error ? error.message : String(error));
            return null;
          }
        }),
      ),
    );
    return results.filter((r): r is MediaRef => Boolean(r));
  }

  /** Probes one file and registers it. `id` reuses an existing reference id (relinking). */
  async add(file: File, id: string = uid('m_')): Promise<MediaRef> {
    const kind = mediaKindOf(file);
    if (!kind) throw new Error('Unsupported file type');
    // a folder file the AI looked at is registered already: replace it cleanly
    if (this.items.has(id)) this.remove(id);
    const url = URL.createObjectURL(file);
    try {
      let ref: MediaRef;
      let playable = true;
      let decodable = false;
      const base = { id, name: file.name, kind, size: file.size, mime: file.type, path: pathForFile(file), lastModified: file.lastModified };
      if (kind === 'image') {
        const img = await loadImageUrl(url);
        ref = { ...base, duration: 0, width: img.naturalWidth || 1, height: img.naturalHeight || 1, hasAudio: false };
        this.items.set(id, { id, file, url, thumb: url, image: img, playable: true, decodable: true });
      } else {
        const [mb, el] = await Promise.all([probeMediabunny(file), probeElement(url, kind)]);
        if (!mb && !el) throw new Error('This file could not be read (unsupported format or codec).');
        playable = Boolean(el);
        decodable = Boolean(mb?.decodable);
        const duration = mb?.duration || el?.duration || 0;
        if (!(duration > 0)) throw new Error('Could not determine the duration of this file.');
        if (kind === 'video' && mb && !mb.hasVideo && !el) throw new Error('No video track found.');
        const isVideo = kind === 'video' && (mb ? mb.hasVideo : true);
        ref = {
          ...base,
          kind: isVideo ? 'video' : 'audio',
          duration,
          width: isVideo ? mb?.width || el?.width || 0 : 0,
          height: isVideo ? mb?.height || el?.height || 0 : 0,
          hasAudio: mb ? mb.hasAudio : true,
          ...(isVideo && mb?.fps && Number.isFinite(mb.fps) ? { fps: Math.round(mb.fps * 1000) / 1000 } : {}),
        };
        this.items.set(id, { id, file, url, playable, decodable });
      }
      this.emit();
      if (ref.kind === 'video') void this.ensureThumb(ref);
      return ref;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  /** Relinks a missing media reference to a file the user picked. */
  async relink(ref: MediaRef, file: File): Promise<MediaRef> {
    this.remove(ref.id);
    const fresh = await this.add(file, ref.id);
    return { ...fresh, id: ref.id };
  }

  remove(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    URL.revokeObjectURL(item.url);
    if (item.thumb && item.thumb !== item.url) URL.revokeObjectURL(item.thumb);
    this.items.delete(id);
    forgetAudio(id);
    this.emit();
  }

  dispose(): void {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  /** Decoded still image (null until loaded). */
  image(id: string | undefined): HTMLImageElement | null {
    return this.get(id)?.image ?? null;
  }

  private job<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.jobs.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn().finally(() => this.emit());
      this.jobs.set(key, p);
    }
    return p;
  }

  async ensureThumb(ref: MediaRef): Promise<void> {
    const item = this.get(ref.id);
    if (!item || item.thumb || ref.kind !== 'video') return;
    await this.job(`thumb:${ref.id}`, async () => {
      const t = Math.min(ref.duration * 0.1, 1);
      const frames = await this.grabFrames(ref, item, [t], 160);
      const frame = frames[0];
      if (!frame) return;
      const c = createCanvas((frame as HTMLCanvasElement).width, (frame as HTMLCanvasElement).height);
      get2d(c).drawImage(frame, 0, 0);
      const blob = await canvasToBlob(c, 'image/jpeg', 0.8);
      if (this.items.get(ref.id) === item) item.thumb = URL.createObjectURL(blob);
    }).catch(() => undefined);
  }

  /** Thumbnails along a video for the timeline (computed once, lazily). */
  async ensureFilmstrip(ref: MediaRef): Promise<void> {
    const item = this.get(ref.id);
    if (!item || item.filmstrip || ref.kind !== 'video') return;
    await this.job(`strip:${ref.id}`, () =>
      this.heavy.run(async () => {
        const count = Math.max(2, Math.min(48, Math.ceil(ref.duration / 2)));
        const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * ref.duration);
        const frames = await this.grabFrames(ref, item, times, 54);
        if (frames.length && this.items.get(ref.id) === item) {
          const f0 = frames.find(Boolean) as HTMLCanvasElement | undefined;
          item.filmstrip = { times, frames: frames.map((f) => f ?? f0!) as CanvasImageSource[], width: f0?.width ?? 96, height: f0?.height ?? 54 };
        }
      }),
    ).catch(() => undefined);
  }

  /** Frames already shown to the AI assistant, by media URL, height and time (oldest dropped first). */
  private aiFrames = new Map<string, HTMLCanvasElement>();

  /** Frames at source times (seconds), `height` px tall, for the AI assistant; an image gives its picture. */
  async framesAt(ref: MediaRef, times: number[], height: number): Promise<(HTMLCanvasElement | null)[]> {
    const item = this.get(ref.id);
    if (!item || (ref.kind !== 'video' && ref.kind !== 'image')) return times.map(() => null);
    const key = (t: number) => `${item.url}|${height}|${ref.kind === 'image' ? 0 : t.toFixed(2)}`;
    const missing = [...new Set(times.filter((t) => !this.aiFrames.has(key(t))))];
    if (missing.length) {
      const got = ref.kind === 'image' ? missing.map(() => stillCanvas(item, ref, height)) : await this.grabFrames(ref, item, missing, height).catch(() => []);
      missing.forEach((t, i) => {
        const frame = got[i];
        if (!frame) return;
        this.aiFrames.set(key(t), frame);
        if (this.aiFrames.size > 96) this.aiFrames.delete(this.aiFrames.keys().next().value!);
      });
    }
    return times.map((t) => this.aiFrames.get(key(t)) ?? null);
  }

  async ensurePeaks(ref: MediaRef): Promise<void> {
    const item = this.get(ref.id);
    if (!item || item.peaks !== undefined || !ref.hasAudio) return;
    await this.job(`peaks:${ref.id}`, () =>
      this.heavy.run(async () => {
        const peaks = await computeMediaPeaks(ref, item.file).catch(() => null);
        if (this.items.get(ref.id) === item) item.peaks = peaks;
      }),
    );
  }

  /** Frames at the given times, scaled to `height` px (mediabunny when possible, otherwise the <video> element). */
  private async grabFrames(ref: MediaRef, item: RuntimeMedia, times: number[], height: number): Promise<(HTMLCanvasElement | null)[]> {
    const aspect = ref.width && ref.height ? ref.width / ref.height : 16 / 9;
    const h = Math.max(16, Math.round(height));
    const w = Math.max(16, Math.round(h * aspect));
    if (item.decodable) {
      const input = new Input({ source: new BlobSource(item.file), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (track) {
          const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill' });
          const out: (HTMLCanvasElement | null)[] = [];
          for await (const wc of sink.canvasesAtTimestamps(times)) {
            if (!wc) {
              out.push(null);
              continue;
            }
            const c = createCanvas(w, h);
            get2d(c).drawImage(wc.canvas, 0, 0, w, h);
            out.push(c);
          }
          if (out.some(Boolean)) return out;
        }
      } catch {
        // fall back to the element
      } finally {
        input.dispose();
      }
    }
    if (!item.playable) return [];
    const el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    el.src = item.url;
    try {
      if (!(await once(el, 'loadeddata', 15000))) return [];
      const out: (HTMLCanvasElement | null)[] = [];
      for (const t of times) {
        const ok = await seekElementFrame(el, Math.min(t, Math.max(0, el.duration - 0.05)));
        if (!ok) {
          out.push(null);
          continue;
        }
        const c = createCanvas(w, h);
        get2d(c).drawImage(el, 0, 0, w, h);
        out.push(c);
      }
      return out;
    } finally {
      el.removeAttribute('src');
      el.load();
    }
  }
}

/** The picture of an image item, `height` px tall. */
function stillCanvas(item: RuntimeMedia, ref: MediaRef, height: number): HTMLCanvasElement | null {
  const img = item.image;
  if (!img?.naturalWidth) return null;
  const aspect = ref.width && ref.height ? ref.width / ref.height : img.naturalWidth / img.naturalHeight;
  const h = Math.max(16, Math.round(height));
  const c = createCanvas(Math.max(16, Math.round(h * aspect)), h);
  get2d(c).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function loadImageUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });
}
