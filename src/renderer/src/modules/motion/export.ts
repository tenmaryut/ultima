import type JSZip from 'jszip';
import type { StreamTargetChunk } from 'mediabunny';
import { createFileWriter, saveFile, type FileWriter } from '../../core/platform';
import { QUALITY_MODE_BITRATE, avcCodecString } from '../../core/utils/avc';
import { canvasToBlob } from '../../core/utils/image';
import { gifDelays, indexFrame, nearestLookup, samplePixels } from './gif';
import { ExportVideoFrames, type ImageCache } from './media';
import { FrameRenderer, type MediaProvider } from './render';
import { frameCount } from './timeline-math';
import type { MotionDoc } from './types';

/** Deterministic frame-by-frame export (video, GIF, PNG) from the document model. */

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'png-seq' | 'png-frame';
export type ExportQuality = 'low' | 'medium' | 'high' | 'very-high';

export interface ExportSettings {
  format: ExportFormat;
  range: 'all' | 'work';
  /** Output width in px (height follows the aspect ratio). */
  width: number;
  fps: number;
  quality: ExportQuality;
  gifDither: boolean;
  gifLoop: boolean;
  /** Keep transparency (WebM VP9 alpha / PNG) when the composition background is transparent. */
  keepAlpha: boolean;
  /** Time of the single PNG frame. */
  frameTime: number;
  fileName: string;
}

export interface ExportCallbacks {
  onProgress: (fraction: number, label: string) => void;
  signal: AbortSignal;
  images: ImageCache;
}

export interface ExportResult {
  saved: boolean;
  warnings: string[];
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/** Output size for a requested width (even numbers for video codecs). */
export function outputSize(doc: MotionDoc, width: number, even: boolean): { width: number; height: number; scale: number } {
  const w0 = Math.max(16, Math.min(8192, Math.round(width)));
  const scale = w0 / doc.comp.width;
  let w = w0;
  let h = Math.max(16, Math.round(doc.comp.height * scale));
  if (even) {
    w -= w % 2;
    h -= h % 2;
  }
  return { width: w, height: h, scale };
}

function frameTimes(doc: MotionDoc, s: ExportSettings): number[] {
  const start = s.range === 'work' ? doc.comp.workStart : 0;
  const end = s.range === 'work' ? doc.comp.workEnd : doc.comp.duration;
  const n = frameCount(start, end, s.fps);
  return Array.from({ length: n }, (_, i) => start + i / s.fps);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface FrameSource {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Renders frame `index` (times must be requested in order). */
  render: (index: number) => Promise<void>;
  dispose: () => void;
  warnings: string[];
}

async function createFrameSource(doc: MotionDoc, s: ExportSettings, times: number[], size: { width: number; height: number; scale: number }, cb: ExportCallbacks, readback: boolean): Promise<FrameSource> {
  await cb.images.preload(doc);
  const videos = await ExportVideoFrames.create(doc, times);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: readback, alpha: true })!;
  const renderer = new FrameRenderer();
  const media: MediaProvider = {
    image: (id) => cb.images.get(doc.assets[id]),
    video: (layer) => videos.frame(layer),
  };
  const transparent = doc.comp.transparent && s.keepAlpha;
  return {
    canvas,
    ctx,
    warnings: videos.missing.length ? [`Some video layers could not be decoded for export: ${videos.missing.join(', ')}`] : [],
    render: async (index: number) => {
      await videos.prepare();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!transparent) {
        // Formats without alpha (or alpha not wanted) get an opaque background.
        ctx.fillStyle = doc.comp.transparent ? '#000000' : doc.comp.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      renderer.render(ctx, doc, {
        time: times[index],
        base: [size.scale, 0, 0, size.scale, 0, 0],
        pixelScale: size.scale,
        background: true,
        clip: true,
        media,
      });
    },
    dispose: () => {
      videos.dispose();
      renderer.dispose();
    },
  };
}

function check(signal: AbortSignal): void {
  if (signal.aborted) throw new ExportCancelled();
}

/* ---------------------------------- Video ---------------------------------- */

async function exportVideo(doc: MotionDoc, s: ExportSettings, cb: ExportCallbacks): Promise<ExportResult> {
  const mb = await import('mediabunny');
  const size = outputSize(doc, s.width, true);
  const isMp4 = s.format === 'mp4';
  const quality = { low: mb.QUALITY_LOW, medium: mb.QUALITY_MEDIUM, high: mb.QUALITY_HIGH, 'very-high': mb.QUALITY_VERY_HIGH }[s.quality];
  const wantAlpha = !isMp4 && doc.comp.transparent && s.keepAlpha;
  const candidates = isMp4 ? (['avc', 'hevc', 'av1'] as const) : (['vp9', 'vp8', 'av1'] as const);
  let codec = await mb.getFirstEncodableVideoCodec([...candidates], { width: size.width, height: size.height, quality, frameRate: s.fps });
  if (!codec) {
    throw new Error(
      isMp4
        ? 'This computer cannot encode MP4 (H.264/HEVC/AV1) video. Export as WebM or GIF instead.'
        : 'This computer cannot encode WebM (VP9/VP8/AV1) video. Export as MP4 or GIF instead.',
    );
  }
  const warnings: string[] = [];
  let alpha: 'keep' | 'discard' = 'discard';
  if (wantAlpha) {
    const ok = await mb.canEncodeVideo('vp9', { width: size.width, height: size.height, quality, alpha: 'keep' }).catch(() => false);
    if (ok) {
      codec = 'vp9';
      alpha = 'keep';
    } else warnings.push('Transparent WebM is not supported here; the video was exported on black.');
  }
  const times = frameTimes(doc, s);
  const ext = isMp4 ? 'mp4' : 'webm';
  const writer = await createFileWriter({ suggestedName: `${s.fileName}.${ext}`, filters: [{ name: isMp4 ? 'MP4 video' : 'WebM video', extensions: [ext] }] });
  if (!writer) return { saved: false, warnings };
  const source = await createFrameSource(doc, { ...s, keepAlpha: alpha === 'keep' }, times, size, cb, false);
  warnings.push(...source.warnings);
  let output: InstanceType<typeof mb.Output> | null = null;
  try {
    const stream = new WritableStream<StreamTargetChunk>({
      write: (chunk) => writer.write(chunk.data, chunk.position),
    });
    output = new mb.Output({
      // MP4 index at the start ("fast start"), in room reserved for the known number of frames.
      format: isMp4 ? new mb.Mp4OutputFormat({ fastStart: 'reserve' }) : new mb.WebMOutputFormat(),
      target: new mb.StreamTarget(stream, { chunked: true, chunkSize: 8 * 1024 * 1024 }),
    });
    // H.264 level from size and frame rate too (mediabunny's own pick labels 1080p60 as level 4.0).
    const levelString = codec === 'avc' ? avcCodecString(size.width, size.height, s.fps, QUALITY_MODE_BITRATE) : null;
    const fullCodecString =
      levelString && (await mb.canEncodeVideo('avc', { width: size.width, height: size.height, quality, frameRate: s.fps, fullCodecString: levelString }).catch(() => false))
        ? levelString
        : undefined;
    const video = new mb.CanvasSource(source.canvas, { codec, quality, keyFrameInterval: 2, alpha, latencyMode: 'quality', ...(fullCodecString ? { fullCodecString } : {}) });
    output.addVideoTrack(video, { frameRate: s.fps, ...(isMp4 ? { maximumPacketCount: times.length + 16 } : {}) });
    await output.start();
    for (let i = 0; i < times.length; i++) {
      check(cb.signal);
      await source.render(i);
      await video.add(i / s.fps, 1 / s.fps);
      cb.onProgress((i + 1) / times.length, `${i + 1} / ${times.length}`);
    }
    cb.onProgress(1, 'Finishing…');
    await output.finalize();
    await writer.close();
    return { saved: true, warnings };
  } catch (error) {
    await output?.cancel().catch(() => undefined);
    await writer.abort().catch(() => undefined);
    throw error;
  } finally {
    source.dispose();
  }
}

/* ----------------------------------- GIF ----------------------------------- */

async function exportGif(doc: MotionDoc, s: ExportSettings, cb: ExportCallbacks): Promise<ExportResult> {
  const { GIFEncoder, quantize } = await import('gifenc');
  const size = outputSize(doc, s.width, false);
  const times = frameTimes(doc, s);
  const transparent = doc.comp.transparent && s.keepAlpha;
  const source = await createFrameSource(doc, s, times, size, cb, true);
  try {
    // Pass 1: one global palette from a sample of frames.
    const sampleCount = Math.min(times.length, 12);
    const sampleTimes = Array.from({ length: sampleCount }, (_, k) => times[Math.floor((k * times.length) / sampleCount)]);
    const samples: Uint8ClampedArray[] = [];
    const sampleSource = await createFrameSource(doc, s, sampleTimes, size, cb, true);
    try {
      for (let k = 0; k < sampleCount; k++) {
        check(cb.signal);
        await sampleSource.render(k);
        samples.push(sampleSource.ctx.getImageData(0, 0, size.width, size.height).data);
        cb.onProgress((k + 1) / sampleCount / 5, 'Building palette…');
      }
    } finally {
      sampleSource.dispose();
    }
    const palette = quantize(samplePixels(samples), transparent ? 255 : 256, { format: 'rgb565' });
    samples.length = 0;
    const transparentIndex = transparent ? palette.length : undefined;
    const fullPalette = transparent ? [...palette, [0, 0, 0]] : palette;
    const lookup = nearestLookup(palette);
    const delays = gifDelays(times.length, s.fps);
    const gif = GIFEncoder();
    for (let i = 0; i < times.length; i++) {
      check(cb.signal);
      await source.render(i);
      const data = source.ctx.getImageData(0, 0, size.width, size.height).data;
      const index = indexFrame(data, size.width, size.height, fullPalette, { dither: s.gifDither, transparentIndex, lookup });
      gif.writeFrame(index, size.width, size.height, {
        palette: i === 0 ? fullPalette : undefined,
        delay: delays[i],
        repeat: s.gifLoop ? 0 : -1,
        transparent: transparentIndex !== undefined,
        transparentIndex: transparentIndex ?? 0,
        dispose: transparentIndex !== undefined ? 2 : -1,
      });
      cb.onProgress(0.2 + (0.8 * (i + 1)) / times.length, `${i + 1} / ${times.length}`);
      if (i % 2 === 1) await tick(); // keep the UI responsive
    }
    gif.finish();
    const bytes = gif.bytes();
    const res = await saveFile(new Blob([bytes as BlobPart], { type: 'image/gif' }), {
      suggestedName: `${s.fileName}.gif`,
      filters: [{ name: 'GIF image', extensions: ['gif'] }],
    });
    return { saved: Boolean(res), warnings: source.warnings };
  } finally {
    source.dispose();
  }
}

/* ----------------------------------- PNG ----------------------------------- */

async function exportPngSequence(doc: MotionDoc, s: ExportSettings, cb: ExportCallbacks): Promise<ExportResult> {
  const { default: JSZip } = await import('jszip');
  const size = outputSize(doc, s.width, false);
  const times = frameTimes(doc, s);
  const writer = await createFileWriter({ suggestedName: `${s.fileName}.zip`, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
  if (!writer) return { saved: false, warnings: [] };
  const source = await createFrameSource(doc, s, times, size, cb, false);
  try {
    const zip = new JSZip();
    const digits = Math.max(4, String(times.length).length);
    for (let i = 0; i < times.length; i++) {
      check(cb.signal);
      await source.render(i);
      const blob = await canvasToBlob(source.canvas, 'image/png');
      zip.file(`${s.fileName}_${String(i).padStart(digits, '0')}.png`, blob);
      cb.onProgress((0.85 * (i + 1)) / times.length, `${i + 1} / ${times.length}`);
    }
    cb.onProgress(0.9, 'Writing ZIP…');
    await streamZip(zip, writer, cb.signal);
    return { saved: true, warnings: source.warnings };
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  } finally {
    source.dispose();
  }
}

/** Streams a JSZip archive into a FileWriter (PNG data is already compressed: STORE). */
function streamZip(zip: JSZip, writer: FileWriter, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = zip.generateInternalStream({ type: 'uint8array', streamFiles: true, compression: 'STORE' });
    let chain = Promise.resolve();
    let failed = false;
    stream.on('data', (data: Uint8Array) => {
      if (signal.aborted && !failed) {
        failed = true;
        stream.pause();
        reject(new ExportCancelled());
        return;
      }
      const copy = data.slice();
      stream.pause();
      chain = chain
        .then(() => writer.write(copy))
        .then(() => {
          if (!failed) stream.resume();
        })
        .catch((error) => {
          failed = true;
          reject(error);
        });
    });
    stream.on('error', (error: Error) => {
      failed = true;
      reject(error);
    });
    stream.on('end', () => {
      chain.then(() => writer.close()).then(resolve, reject);
    });
    stream.resume();
  });
}

async function exportPngFrame(doc: MotionDoc, s: ExportSettings, cb: ExportCallbacks): Promise<ExportResult> {
  const size = outputSize(doc, s.width, false);
  const time = Math.max(0, Math.min(doc.comp.duration, s.frameTime));
  const source = await createFrameSource(doc, s, [time], size, cb, false);
  try {
    await source.render(0);
    cb.onProgress(1, '');
    const blob = await canvasToBlob(source.canvas, 'image/png');
    const res = await saveFile(blob, { suggestedName: `${s.fileName}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    return { saved: Boolean(res), warnings: source.warnings };
  } finally {
    source.dispose();
  }
}

export async function exportComposition(doc: MotionDoc, settings: ExportSettings, cb: ExportCallbacks): Promise<ExportResult> {
  switch (settings.format) {
    case 'mp4':
    case 'webm':
      return exportVideo(doc, settings, cb);
    case 'gif':
      return exportGif(doc, settings, cb);
    case 'png-seq':
      return exportPngSequence(doc, settings, cb);
    case 'png-frame':
      return exportPngFrame(doc, settings, cb);
  }
}

/** Codecs this computer can encode (for the export dialog). */
export async function detectVideoSupport(width: number, height: number): Promise<{ mp4: boolean; webm: boolean; webmAlpha: boolean }> {
  try {
    const mb = await import('mediabunny');
    const opts = { width: width - (width % 2), height: height - (height % 2) };
    const [mp4, webm, webmAlpha] = await Promise.all([
      mb.getFirstEncodableVideoCodec(['avc', 'hevc', 'av1'], opts),
      mb.getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], opts),
      mb.canEncodeVideo('vp9', { ...opts, alpha: 'keep' }).catch(() => false),
    ]);
    return { mp4: Boolean(mp4), webm: Boolean(webm), webmAlpha: Boolean(webmAlpha) };
  } catch {
    return { mp4: false, webm: false, webmAlpha: false };
  }
}

/** Renders one frame at up to `maxSize` px (AI snapshots, thumbnails). */
export function renderStill(doc: MotionDoc, time: number, maxSize: number, media: MediaProvider): HTMLCanvasElement {
  const scale = Math.min(1, maxSize / Math.max(doc.comp.width, doc.comp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(doc.comp.width * scale));
  canvas.height = Math.max(1, Math.round(doc.comp.height * scale));
  const ctx = canvas.getContext('2d')!;
  if (doc.comp.transparent) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const renderer = new FrameRenderer();
  renderer.render(ctx, doc, { time, base: [scale, 0, 0, scale, 0, 0], pixelScale: scale, background: true, clip: true, media });
  renderer.dispose();
  return canvas;
}
