import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type StreamTargetChunk,
  type Target,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { createFileWriter, desktop, saveFile } from '../../core/platform';
import { uid } from '../../core/utils/id';
import type { Clip, Project, TimeRange } from './types';
import type { MediaLibrary, RuntimeMedia } from './media';
import { Compositor, frameNeeds } from './compositor';
import { speedAt } from './keyframes';
import { TimelineMixer } from './mix';
import { getMedia } from './model';
import { QUALITY_MODE_BITRATE, avcCodecString } from '../../core/utils/avc';

/* Offline, frame-accurate rendering of the timeline to video files, GIF, PNG and WAV. */

export type VideoFormat = 'mp4' | 'webm';
export type QualityLevel = 'low' | 'medium' | 'high' | 'very-high';
export type CodecNote = 'no-h264' | 'no-video-encoder' | 'opus-in-mp4' | 'no-audio-encoder';

export interface CodecChoice {
  video: VideoCodec | null;
  audio: AudioCodec | null;
  notes: CodecNote[];
}

/** Picks encoders the system supports for a container (checking canEncode*). */
export async function chooseCodecs(format: VideoFormat, width: number, height: number, fps: number): Promise<CodecChoice> {
  const notes: CodecNote[] = [];
  let video: VideoCodec | null = null;
  for (const c of (format === 'mp4' ? ['avc'] : ['vp9', 'vp8', 'av1']) as VideoCodec[]) {
    if (await canEncodeVideo(c, { width, height, frameRate: fps }).catch(() => false)) {
      video = c;
      break;
    }
  }
  if (!video) notes.push(format === 'mp4' ? 'no-h264' : 'no-video-encoder');
  let audio: AudioCodec | null = null;
  for (const c of (format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis']) as AudioCodec[]) {
    if (await canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false)) {
      audio = c;
      break;
    }
  }
  if (format === 'mp4' && audio === 'opus') notes.push('opus-in-mp4');
  if (!audio) notes.push('no-audio-encoder');
  return { video, audio, notes };
}

const abortError = () => new DOMException('Cancelled', 'AbortError');

function once(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), timeoutMs);
    const ok = () => done(true);
    const fail = () => done(false);
    function done(v: boolean) {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
      resolve(v);
    }
    el.addEventListener(event, ok);
    el.addEventListener('error', fail);
  });
}

/** Decodes the frames one clip needs, in order (mediabunny), falling back to seeking a <video>. */
class ClipReader {
  private iter: AsyncGenerator<WrappedCanvas | null, void, unknown> | null = null;
  private input: Input | null = null;
  private el: HTMLVideoElement | null = null;
  private last: CanvasImageSource | null = null;
  private mode: 'sink' | 'element' | 'none';

  constructor(
    private item: RuntimeMedia,
    private times: number[],
    private size: { w: number; h: number },
  ) {
    this.mode = item.decodable ? 'sink' : item.playable ? 'element' : 'none';
  }

  async next(sourceTime: number): Promise<CanvasImageSource | null> {
    if (this.mode === 'sink') {
      try {
        if (!this.iter) {
          this.input = new Input({ source: new BlobSource(this.item.file), formats: ALL_FORMATS });
          const track = await this.input.getPrimaryVideoTrack();
          if (!track || !(await track.canDecode())) throw new Error('not decodable');
          const sink = new CanvasSink(track, { width: this.size.w, height: this.size.h, fit: 'fill', poolSize: 2 });
          this.iter = sink.canvasesAtTimestamps(this.times);
        }
        const r = await this.iter.next();
        if (!r.done && r.value) this.last = r.value.canvas;
        return this.last;
      } catch {
        await this.closeSink();
        this.mode = this.item.playable ? 'element' : 'none';
      }
    }
    if (this.mode === 'element') {
      if (!this.el) {
        const el = document.createElement('video');
        el.muted = true;
        el.preload = 'auto';
        el.src = this.item.url;
        this.el = el;
        if (!(await once(el, 'loadeddata', 15000))) {
          this.mode = 'none';
          return null;
        }
      }
      const el = this.el;
      if (Math.abs(el.currentTime - sourceTime) > 1e-4 || el.readyState < 2) {
        el.currentTime = sourceTime;
        await once(el, 'seeked', 5000);
      }
      return el.readyState >= 2 ? el : this.last;
    }
    return null;
  }

  private async closeSink() {
    try {
      await this.iter?.return();
    } catch {
      // ignore
    }
    this.iter = null;
    this.input?.dispose();
    this.input = null;
  }

  async dispose() {
    await this.closeSink();
    if (this.el) {
      this.el.removeAttribute('src');
      this.el.load();
      this.el = null;
    }
  }
}

export interface RenderJob {
  project: Project;
  lib: MediaLibrary;
  range: TimeRange;
  fps: number;
  width: number;
  height: number;
  burnCaptions: boolean;
}

/** Renders timeline frames at a fixed rate with exact source frames. */
export class FrameRenderer {
  readonly frameCount: number;
  private plan = new Map<string, number[]>();
  private used = new Map<string, number>();
  private readers = new Map<string, ClipReader | null>();
  private compositor = new Compositor();
  private frames = new Map<string, CanvasImageSource | null>();

  constructor(private job: RenderJob) {
    this.frameCount = Math.max(1, Math.round((job.range.end - job.range.start) * job.fps));
    for (let i = 0; i < this.frameCount; i++) {
      for (const n of frameNeeds(job.project, this.time(i))) {
        const list = this.plan.get(n.clip.id) ?? [];
        const blend = this.blendOf(n.clip, n.sourceTime, this.time(i));
        if (blend) list.push(blend.a + 1e-3, blend.b + 1e-3);
        else list.push(n.sourceTime + 1e-3);
        this.plan.set(n.clip.id, list);
      }
    }
  }

  /** Smooth slow motion: the two source frames around `sourceTime` and how much of the second to mix in. */
  private blendOf(clip: Clip, sourceTime: number, t: number): { a: number; b: number; w: number } | null {
    if (!clip.frameBlend || clip.freeze || speedAt(clip, t - clip.start) >= 0.999) return null;
    const fps = getMedia(this.job.project, clip.mediaId)?.fps || 30;
    const pos = sourceTime * fps;
    const a = Math.floor(pos) / fps;
    const w = pos - Math.floor(pos);
    if (w < 0.02) return null;
    return { a, b: a + 1 / fps, w };
  }

  private blendCanvas: HTMLCanvasElement | null = null;

  time(i: number): number {
    return this.job.range.start + i / this.job.fps;
  }

  private reader(clip: Clip): ClipReader | null {
    if (this.readers.has(clip.id)) return this.readers.get(clip.id) ?? null;
    const item = this.job.lib.get(clip.mediaId);
    const media = getMedia(this.job.project, clip.mediaId);
    let reader: ClipReader | null = null;
    if (item && media) {
      const cap = Math.max(this.job.width, this.job.height) * Math.max(1, clip.visual?.scale ?? 1);
      const k = Math.min(1, cap / Math.max(1, media.width, media.height));
      const w = Math.max(2, Math.round((media.width || this.job.width) * k));
      const h = Math.max(2, Math.round((media.height || this.job.height) * k));
      reader = new ClipReader(item, this.plan.get(clip.id) ?? [], { w, h });
    }
    this.readers.set(clip.id, reader);
    return reader;
  }

  async render(ctx: CanvasRenderingContext2D, i: number): Promise<void> {
    const { project, lib } = this.job;
    const t = this.time(i);
    this.frames.clear();
    for (const n of frameNeeds(project, t)) {
      const reader = this.reader(n.clip);
      const blend = this.blendOf(n.clip, n.sourceTime, t);
      if (reader && blend) {
        const first = await reader.next(blend.a + 1e-3);
        const firstCopy = first ? this.copyFrame(first) : null;
        const second = await reader.next(blend.b + 1e-3);
        if (firstCopy && second) {
          const ctx2 = firstCopy.getContext('2d')!;
          ctx2.globalAlpha = blend.w;
          ctx2.drawImage(second, 0, 0, firstCopy.width, firstCopy.height);
          ctx2.globalAlpha = 1;
        }
        this.frames.set(n.clip.id, firstCopy ?? second);
        this.used.set(n.clip.id, (this.used.get(n.clip.id) ?? 0) + 2);
        continue;
      }
      this.frames.set(n.clip.id, reader ? await reader.next(n.sourceTime + 1e-3) : null);
      this.used.set(n.clip.id, (this.used.get(n.clip.id) ?? 0) + 1);
    }
    this.compositor.render(
      ctx,
      project,
      t,
      { video: (clip) => this.frames.get(clip.id) ?? null, image: (id) => lib.image(id) },
      { scale: this.job.width / project.settings.width, captions: this.job.burnCaptions },
    );
    // release decoders of clips that won't be needed again
    for (const [id, count] of this.used) {
      if (count >= (this.plan.get(id)?.length ?? 0)) {
        const r = this.readers.get(id);
        if (r) {
          this.readers.set(id, null);
          await r.dispose();
        }
      }
    }
  }

  /** A private copy of a decoded frame (decoders reuse their canvases). */
  private copyFrame(src: CanvasImageSource): HTMLCanvasElement {
    const s = src as { width: number; height: number };
    if (!this.blendCanvas) this.blendCanvas = document.createElement('canvas');
    const c = this.blendCanvas;
    if (c.width !== s.width || c.height !== s.height) {
      c.width = Math.max(1, s.width);
      c.height = Math.max(1, s.height);
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
    return c;
  }

  async dispose(): Promise<void> {
    for (const r of this.readers.values()) await r?.dispose();
    this.readers.clear();
  }
}

export interface VideoExportSettings {
  format: VideoFormat;
  width: number;
  height: number;
  /** Output frame rate (the project's by default). */
  fps: number;
  quality: QualityLevel;
  /** bits per second; null = use `quality`. */
  videoBitrate: number | null;
  audio: boolean;
  audioBitrate: number;
  range: TimeRange;
  burnCaptions: boolean;
}

export type ProgressFn = (fraction: number) => void;

/** Upper bound of audio packets for a reserved MP4 index: one per 10 ms (AAC and Opus use 20+ ms) plus a margin. */
function maxAudioPackets(seconds: number): number {
  return Math.ceil((Math.max(0, seconds) + 1) * 100 * 1.34) + 64;
}

/**
 * H.264 codec string whose level covers the frame rate (mediabunny picks the level from size and bitrate only,
 * which labels 1080p60 as level 4.0). Undefined when this system's encoder refuses it.
 */
async function avcStringFor(width: number, height: number, fps: number, bitrate: number, quality: Quality): Promise<string | undefined> {
  const fullCodecString = avcCodecString(width, height, fps, bitrate);
  const ok = await canEncodeVideo('avc', { width, height, frameRate: fps, quality, fullCodecString }).catch(() => false);
  return ok ? fullCodecString : undefined;
}

async function encodeTimeline(
  project: Project,
  lib: MediaLibrary,
  s: VideoExportSettings,
  target: Target,
  codecs: CodecChoice,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<void> {
  if (!codecs.video) throw new Error('No video encoder available');
  const fps = s.fps;
  const renderer = new FrameRenderer({ project, lib, range: s.range, fps, width: s.width, height: s.height, burnCaptions: s.burnCaptions });
  // MP4 index at the start ("fast start"): streamed files reserve room for it, so the packet counts need an upper bound.
  const reserve = s.format === 'mp4' && !(target instanceof BufferTarget);
  const output = new Output({
    format: s.format === 'mp4' ? new Mp4OutputFormat({ fastStart: reserve ? 'reserve' : 'in-memory' }) : new WebMOutputFormat(),
    target,
  });
  const canvas = document.createElement('canvas');
  canvas.width = s.width;
  canvas.height = s.height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const quality = s.videoBitrate ? new Quality({ bitrate: s.videoBitrate }) : new Quality(s.quality);
  const fullCodecString = codecs.video === 'avc' ? await avcStringFor(s.width, s.height, fps, s.videoBitrate ?? QUALITY_MODE_BITRATE, quality) : undefined;
  const videoSource = new CanvasSource(canvas, { codec: codecs.video, quality, keyFrameInterval: 2, ...(fullCodecString ? { fullCodecString } : {}) });
  output.addVideoTrack(videoSource, { frameRate: fps, ...(reserve ? { maximumPacketCount: renderer.frameCount + 16 } : {}) });
  let audioSource: AudioBufferSource | null = null;
  if (s.audio && codecs.audio) {
    audioSource = new AudioBufferSource({ codec: codecs.audio, quality: new Quality({ bitrate: s.audioBitrate }) });
    output.addAudioTrack(audioSource, reserve ? { maximumPacketCount: maxAudioPackets(s.range.end - s.range.start) } : {});
  }
  const mixer = audioSource ? new TimelineMixer(project, lib, s.range, { sampleRate: 48000, channels: 2, chunk: 1 }) : null;
  try {
    await output.start();
    for (let i = 0; i < renderer.frameCount; i++) {
      if (signal.aborted) throw abortError();
      await renderer.render(ctx, i);
      await videoSource.add(i / fps, 1 / fps);
      if (mixer && audioSource) {
        const need = (i + 1) / fps + 0.5;
        while (!mixer.finished && mixer.renderedSeconds < need) {
          const buf = await mixer.next();
          if (buf) await audioSource.add(buf);
        }
      }
      onProgress((i + 1) / renderer.frameCount);
    }
    if (mixer && audioSource) {
      while (!mixer.finished) {
        if (signal.aborted) throw abortError();
        const buf = await mixer.next();
        if (buf) await audioSource.add(buf);
      }
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    await renderer.dispose();
    mixer?.dispose();
  }
}

/** Renders to a file chosen by the user (streamed to disk on desktop). Null = cancelled in the save dialog. */
export async function exportVideoFile(
  project: Project,
  lib: MediaLibrary,
  s: VideoExportSettings,
  codecs: CodecChoice,
  baseName: string,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<{ path?: string } | null> {
  const writer = await createFileWriter({
    suggestedName: `${baseName}.${s.format}`,
    filters: [{ name: s.format === 'mp4' ? 'MP4 video' : 'WebM video', extensions: [s.format] }],
    toExportFolder: true,
  });
  if (!writer) return null;
  const writable = new WritableStream<StreamTargetChunk>({ write: (chunk) => writer.write(chunk.data, chunk.position) });
  const target = new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 });
  try {
    await encodeTimeline(project, lib, s, target, codecs, onProgress, signal);
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
  await writer.close();
  return { path: writer.path };
}

export function ffmpegReady(tools: { id: string; available: boolean }[]): boolean {
  return Boolean(desktop && tools.some((t) => t.id === 'ffmpeg' && t.available));
}

/**
 * Renders WebM in memory and converts it with the user's FFmpeg (H.264/AAC MP4 or MOV). With the social preset
 * the intermediate keeps the target bitrate and FFmpeg writes the upload-ready MP4 (see socialVideoArgs).
 */
export async function exportWithFfmpeg(
  project: Project,
  lib: MediaLibrary,
  s: VideoExportSettings,
  container: 'mp4' | 'mov',
  baseName: string,
  onProgress: (fraction: number, stage: 'render' | 'convert') => void,
  signal: AbortSignal,
  preset?: 'social',
): Promise<{ path?: string } | null> {
  const api = desktop;
  if (!api) throw new Error('FFmpeg conversion needs the desktop app.');
  const codecs = await chooseCodecs('webm', s.width, s.height, s.fps);
  if (!codecs.video) throw new Error('No video encoder available');
  const target = new BufferTarget();
  const intermediate = { ...s, format: 'webm' as const, quality: 'very-high' as const, videoBitrate: preset === 'social' ? s.videoBitrate : null };
  await encodeTimeline(project, lib, intermediate, target, codecs, (f) => onProgress(f * 0.85, 'render'), signal);
  if (!target.buffer) throw new Error('Rendering failed');
  onProgress(0.88, 'convert');
  const requestId = uid('tc_');
  const stop = () => void api.tools.cancelTranscode(requestId);
  signal.addEventListener('abort', stop, { once: true });
  const res = await api.tools.transcode({
    requestId,
    input: new Uint8Array(target.buffer),
    inputName: 'timeline.webm',
    format: container,
    quality: s.quality === 'low' ? 'small' : s.quality === 'medium' ? 'medium' : 'high',
    ...(preset === 'social' ? { preset, fps: s.fps, videoBitrate: s.videoBitrate ?? undefined } : {}),
  }).finally(() => signal.removeEventListener('abort', stop));
  if (signal.aborted) throw abortError();
  if (!res.ok || !res.data) throw new Error(res.error || 'FFmpeg failed');
  onProgress(1, 'convert');
  return saveFile(res.data, {
    suggestedName: `${baseName}.${container}`,
    filters: [{ name: container === 'mp4' ? 'MP4 video' : 'QuickTime movie', extensions: [container] }],
    toExportFolder: true,
  });
}

/** Animated GIF of a (short) range. */
export async function renderGif(
  project: Project,
  lib: MediaLibrary,
  opts: { range: TimeRange; width: number; fps: number; burnCaptions: boolean },
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const { width: W, height: H } = project.settings;
  const width = Math.max(16, Math.round(opts.width / 2) * 2);
  const height = Math.max(16, Math.round((width * H) / W / 2) * 2);
  const renderer = new FrameRenderer({ project, lib, range: opts.range, fps: opts.fps, width, height, burnCaptions: opts.burnCaptions });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const gif = GIFEncoder();
  const delay = Math.round(1000 / opts.fps);
  try {
    for (let i = 0; i < renderer.frameCount; i++) {
      if (signal.aborted) throw abortError();
      await renderer.render(ctx, i);
      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: 0 });
      onProgress((i + 1) / renderer.frameCount);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    gif.finish();
    return gif.bytes();
  } finally {
    await renderer.dispose();
  }
}

/** One full-quality frame (for PNG export and AI snapshots). */
export async function renderStill(project: Project, lib: MediaLibrary, t: number, scale = 1): Promise<HTMLCanvasElement> {
  const fps = project.settings.fps;
  const width = Math.max(2, Math.round(project.settings.width * scale));
  const height = Math.max(2, Math.round(project.settings.height * scale));
  const renderer = new FrameRenderer({ project, lib, range: { start: t, end: t + 1 / fps }, fps, width, height, burnCaptions: true });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    await renderer.render(canvas.getContext('2d')!, 0);
  } finally {
    await renderer.dispose();
  }
  return canvas;
}

/** 44-byte PCM WAV header. */
export function wavHeader(dataBytes: number, sampleRate: number, channels: number, bits = 16): Uint8Array {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  const block = channels * (bits / 8);
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * block, true);
  v.setUint16(32, block, true);
  v.setUint16(34, bits, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}

/** Interleaved 16-bit little-endian PCM. */
export function toPcm16(channels: Float32Array[], length: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(length * channels.length * 2));
  let o = 0;
  for (let i = 0; i < length; i++) {
    for (const ch of channels) {
      const s = Math.max(-1, Math.min(1, ch[i] ?? 0));
      out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}

/** Streams the mixed timeline audio to a 16-bit stereo WAV file. */
export async function exportWavFile(
  project: Project,
  lib: MediaLibrary,
  range: TimeRange,
  baseName: string,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<{ path?: string } | null> {
  const writer = await createFileWriter({ suggestedName: `${baseName}.wav`, filters: [{ name: 'WAV audio', extensions: ['wav'] }], toExportFolder: true });
  if (!writer) return null;
  const mixer = new TimelineMixer(project, lib, range, { sampleRate: 48000, channels: 2, chunk: 5 });
  try {
    await writer.write(wavHeader(mixer.totalSamples * 4, 48000, 2), 0);
    let pos = 44;
    for (;;) {
      if (signal.aborted) throw abortError();
      const buf = await mixer.next();
      if (!buf) break;
      const chs = [buf.getChannelData(0), buf.getChannelData(Math.min(1, buf.numberOfChannels - 1))];
      const bytes = toPcm16(chs, buf.length);
      await writer.write(bytes, pos);
      pos += bytes.byteLength;
      onProgress(mixer.renderedSeconds / Math.max(1e-6, range.end - range.start));
    }
    await writer.close();
    return { path: writer.path };
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  } finally {
    mixer.dispose();
  }
}
