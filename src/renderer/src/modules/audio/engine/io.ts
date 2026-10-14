/**
 * File input/output: decoding audio (WAV natively, everything else through the
 * browser's decoder or mediabunny for video containers), encoding exports (WAV,
 * Opus/AAC via WebCodecs + mediabunny, MP3/FLAC through the desktop app's FFmpeg) and
 * the .ultima project format.
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
} from 'mediabunny';
import { decodeAudio } from '../../../core/utils/audio';
import { fileExtension } from '../../../core/utils/format';
import { base64ToBytes, bytesToBase64 } from '../../../core/utils/base64';
import { desktop } from '../../../core/platform';
import { decodeWavBytes, encodeWavBytes, isWav, type WavFormat } from '../wav';
import { resampleChannels } from '../dsp/time';
import { matchChannelCount } from '../dsp/basic';
import type { Marker, TranscriptSegment } from './document';
import type { MtSession, MtSource } from './multitrack';
import { uid } from '../../../core/utils/id';
import { t } from '../../../core/i18n';

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'wave', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'weba', 'webm', 'aif', 'aiff', 'caf'];
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'm4v', 'ogv', 'avi'];
export const OPEN_ACCEPT = 'audio/*,video/*,.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.opus,.weba,.webm,.mp4,.mov,.mkv,.m4v,.ultima';

export interface LoadedAudio {
  name: string;
  sampleRate: number;
  channels: Float32Array[];
  /** Short description of the source format, e.g. "WAV 24-bit". */
  format: string;
}

export function isProjectFile(file: File): boolean {
  return fileExtension(file.name) === 'ultima';
}

export function isAudioOrVideoFile(file: File): boolean {
  const ext = fileExtension(file.name);
  return AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext) || file.type.startsWith('audio/') || file.type.startsWith('video/');
}

async function decodeWithMediabunny(file: Blob, onProgress?: (f: number) => void): Promise<{ sampleRate: number; channels: Float32Array[]; codec: string }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error(t('This file has no audio track.'));
    if (!(await track.canDecode())) throw new Error(t("This file's audio codec ({codec}) cannot be decoded here.", { codec: (await track.getCodec()) ?? '?' }));
    const sampleRate = await track.getSampleRate();
    const count = Math.max(1, await track.getNumberOfChannels());
    const duration = await track.computeDuration().catch(() => 0);
    const first = await track.getFirstTimestamp().catch(() => 0);
    let capacity = Math.max(sampleRate, Math.ceil((duration - first + 1) * sampleRate));
    let channels = Array.from({ length: count }, () => new Float32Array(capacity));
    let written = 0;
    const sink = new AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers()) {
      const at = Math.max(0, Math.round((timestamp - first) * sampleRate));
      const end = at + buffer.length;
      if (end > capacity) {
        capacity = Math.max(end, Math.ceil(capacity * 1.5));
        channels = channels.map((c) => {
          const grown = new Float32Array(capacity);
          grown.set(c);
          return grown;
        });
      }
      for (let c = 0; c < count; c++) {
        const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        channels[c].set(src, at);
      }
      written = Math.max(written, end);
      if (onProgress && duration > 0) onProgress(Math.min(1, (timestamp - first) / duration));
    }
    if (!written) throw new Error(t('No audio could be decoded from this file.'));
    return { sampleRate, channels: channels.map((c) => c.slice(0, written)), codec: (await track.getCodec()) ?? 'audio' };
  } finally {
    input.dispose();
  }
}

/** Decodes an audio or video file into planar channels. */
export async function decodeFile(file: File, onProgress?: (f: number) => void): Promise<LoadedAudio> {
  const ext = fileExtension(file.name);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (isWav(head)) {
    try {
      const wav = decodeWavBytes(new Uint8Array(await file.arrayBuffer()));
      return { name: file.name, sampleRate: wav.sampleRate, channels: wav.channels, format: `WAV ${wav.float ? '32-bit float' : `${wav.bitsPerSample}-bit`}` };
    } catch {
      // unusual WAV flavour: let the browser try
    }
  }
  const isVideo = VIDEO_EXTENSIONS.includes(ext) || file.type.startsWith('video/');
  const attempts: (() => Promise<LoadedAudio>)[] = [];
  const viaBrowser = async (): Promise<LoadedAudio> => {
    const buffer = await decodeAudio(file);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    return { name: file.name, sampleRate: buffer.sampleRate, channels, format: (ext || 'audio').toUpperCase() };
  };
  const viaMediabunny = async (): Promise<LoadedAudio> => {
    const r = await decodeWithMediabunny(file, onProgress);
    return { name: file.name, sampleRate: r.sampleRate, channels: r.channels, format: `${(ext || 'media').toUpperCase()} · ${r.codec.toUpperCase()}` };
  };
  if (isVideo) attempts.push(viaMediabunny, viaBrowser);
  else attempts.push(viaBrowser, viaMediabunny);
  const errors: unknown[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (!result.channels.length || !result.channels[0].length) throw new Error(t('The file contains no audio.'));
      return result;
    } catch (error) {
      errors.push(error);
    }
  }
  // prefer the most informative message (mediabunny names the codec; the browser just says "Unable to decode")
  const informative = errors.find((e) => e instanceof Error && !/unable to decode|decodeAudioData|EncodingError/i.test(e.message));
  const chosen = informative ?? errors[0];
  throw chosen instanceof Error && !/unable to decode/i.test(chosen.message) ? chosen : new Error(t('Unsupported or damaged audio file.'));
}

/* --------------------------------- Export --------------------------------- */

export type ExportFormat = 'wav16' | 'wav24' | 'wav32f' | 'ogg' | 'webm' | 'm4a' | 'mp3' | 'flac';

export interface ExportFormatInfo {
  id: ExportFormat;
  label: string;
  extension: string;
  mime: string;
  lossy: boolean;
  /** Needs the desktop app with FFmpeg. */
  ffmpeg?: boolean;
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'wav16', label: 'WAV 16-bit PCM', extension: 'wav', mime: 'audio/wav', lossy: false },
  { id: 'wav24', label: 'WAV 24-bit PCM', extension: 'wav', mime: 'audio/wav', lossy: false },
  { id: 'wav32f', label: 'WAV 32-bit float', extension: 'wav', mime: 'audio/wav', lossy: false },
  { id: 'mp3', label: 'MP3', extension: 'mp3', mime: 'audio/mpeg', lossy: true, ffmpeg: true },
  { id: 'flac', label: 'FLAC (lossless)', extension: 'flac', mime: 'audio/flac', lossy: false, ffmpeg: true },
  { id: 'ogg', label: 'OGG / Opus', extension: 'ogg', mime: 'audio/ogg', lossy: true },
  { id: 'webm', label: 'WebM / Opus', extension: 'webm', mime: 'audio/webm', lossy: true },
  { id: 'm4a', label: 'M4A / AAC', extension: 'm4a', mime: 'audio/mp4', lossy: true },
];

export interface ExportOptions {
  format: ExportFormat;
  /** Target sample rate (0 = keep). */
  sampleRate: number;
  channels: 'keep' | 'mono' | 'stereo';
  /** kbps for lossy formats */
  bitrate: number;
  dither: boolean;
}

export interface EncodedFile {
  bytes: Uint8Array;
  extension: string;
  mime: string;
}

const OPUS_RATES = [8000, 12000, 16000, 24000, 48000];

async function encodeWithMediabunny(
  channels: Float32Array[],
  sampleRate: number,
  kind: 'ogg' | 'webm' | 'm4a',
  bitrate: number,
  onProgress?: (f: number) => void,
): Promise<Uint8Array> {
  const codec = kind === 'm4a' ? 'aac' : 'opus';
  const output = new Output({
    format: kind === 'ogg' ? new OggOutputFormat() : kind === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const source = new AudioSampleSource({ codec, quality: new Quality({ bitrate: bitrate * 1000 }) });
  output.addAudioTrack(source);
  await output.start();
  const count = channels.length;
  const length = channels[0]?.length ?? 0;
  const chunk = 8192;
  for (let pos = 0; pos < length; pos += chunk) {
    const n = Math.min(chunk, length - pos);
    const planar = new Float32Array(n * count);
    for (let c = 0; c < count; c++) planar.set(channels[c].subarray(pos, pos + n), c * n);
    const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: count, sampleRate, timestamp: pos / sampleRate });
    await source.add(sample);
    sample.close();
    onProgress?.(pos / length);
  }
  source.close();
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error(t('Encoding produced no data.'));
  return new Uint8Array(buffer);
}

/** Checks which WebCodecs-based formats can be encoded here. */
export async function supportedLossyFormats(): Promise<Record<'ogg' | 'webm' | 'm4a', boolean>> {
  const check = async (codec: 'opus' | 'aac') => {
    try {
      return await canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: 48000, bitrate: 128000 });
    } catch {
      return false;
    }
  };
  const [opus, aac] = await Promise.all([check('opus'), check('aac')]);
  return { ogg: opus, webm: opus, m4a: aac };
}

export async function encodeAudio(input: Float32Array[], inputRate: number, options: ExportOptions, onProgress?: (f: number) => void): Promise<EncodedFile> {
  const info = EXPORT_FORMATS.find((f) => f.id === options.format) ?? EXPORT_FORMATS[0];
  let channels = input;
  if (options.channels === 'mono') channels = matchChannelCount(channels, 1);
  else if (options.channels === 'stereo') channels = matchChannelCount(channels, 2);
  let rate = options.sampleRate > 0 ? options.sampleRate : inputRate;
  if ((options.format === 'ogg' || options.format === 'webm') && !OPUS_RATES.includes(rate)) rate = 48000;
  if (options.format === 'm4a' && rate > 48000) rate = 48000;
  if (rate !== inputRate) channels = resampleChannels(channels, inputRate, rate, onProgress ? (f) => onProgress(f * 0.4) : undefined);
  const report = onProgress ? (f: number) => onProgress(rate !== inputRate ? 0.4 + f * 0.6 : f) : undefined;

  if (options.format === 'wav16' || options.format === 'wav24' || options.format === 'wav32f') {
    const fmt: WavFormat = options.format === 'wav16' ? 'pcm16' : options.format === 'wav24' ? 'pcm24' : 'float32';
    return { bytes: encodeWavBytes(channels, rate, { format: fmt, dither: options.dither }), extension: 'wav', mime: 'audio/wav' };
  }
  if (options.format === 'mp3' || options.format === 'flac') {
    if (!desktop) throw new Error(t('MP3 and FLAC export need the Ultima desktop app with FFmpeg installed. In the browser, export WAV, OGG/Opus or M4A instead.'));
    const wav = encodeWavBytes(channels, rate, { format: options.format === 'flac' ? 'pcm24' : 'pcm16', dither: options.format === 'mp3' });
    report?.(0.3);
    const quality = options.bitrate >= 256 ? 'high' : options.bitrate <= 112 ? 'small' : 'medium';
    const result = await desktop.tools.transcode({ requestId: uid('tc'), input: wav, inputName: 'audio.wav', format: options.format, quality });
    if (!result.ok || !result.data) throw new Error(result.error || t('FFmpeg could not convert the audio.'));
    return { bytes: result.data, extension: info.extension, mime: info.mime };
  }
  // WebCodecs (Opus / AAC) through mediabunny, FFmpeg as a fallback on desktop
  const supported = await supportedLossyFormats();
  const kind = options.format as 'ogg' | 'webm' | 'm4a';
  if (supported[kind]) {
    return { bytes: await encodeWithMediabunny(channels, rate, kind, options.bitrate, report), extension: info.extension, mime: info.mime };
  }
  if (desktop && kind !== 'webm') {
    const wav = encodeWavBytes(channels, rate, { format: 'pcm16', dither: true });
    const result = await desktop.tools.transcode({ requestId: uid('tc'), input: wav, inputName: 'audio.wav', format: kind, quality: options.bitrate >= 192 ? 'high' : options.bitrate <= 96 ? 'small' : 'medium' });
    if (result.ok && result.data) return { bytes: result.data, extension: info.extension, mime: info.mime };
    throw new Error(result.error || t('FFmpeg could not convert the audio.'));
  }
  throw new Error(t('{format} encoding is not supported on this system. Export WAV instead (or install FFmpeg in the desktop app).', { format: info.label }));
}

/* --------------------------------- Project --------------------------------- */

export interface ProjectAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export interface ProjectData {
  name: string;
  audio: ProjectAudio | null;
  markers: Marker[];
  transcript: TranscriptSegment[];
  session: MtSession | null;
  sources: MtSource[];
  view?: { start: number; spp: number };
}

interface StoredAudio {
  sampleRate: number;
  channels: number;
  length: number;
  encoding: 'wav' | 'opus';
  data: string;
}

export type ProjectEncoding = 'float' | 'pcm16' | 'opus';

/** Approximate size in bytes of the project for each encoding (for the size warning). */
export function estimateProjectBytes(totalSamples: number, encoding: ProjectEncoding): number {
  const raw = encoding === 'float' ? totalSamples * 4 : encoding === 'pcm16' ? totalSamples * 2 : totalSamples * 0.02;
  return Math.round(raw * 1.34) + 4096;
}

async function storeAudio(channels: Float32Array[], sampleRate: number, encoding: ProjectEncoding): Promise<StoredAudio> {
  const length = channels[0]?.length ?? 0;
  if (encoding === 'opus') {
    const supported = await supportedLossyFormats();
    if (supported.webm) {
      const rate = OPUS_RATES.includes(sampleRate) ? sampleRate : 48000;
      const data = rate === sampleRate ? channels : resampleChannels(channels, sampleRate, rate);
      const bytes = await encodeWithMediabunny(data, rate, 'webm', 160);
      return { sampleRate, channels: channels.length, length, encoding: 'opus', data: bytesToBase64(bytes) };
    }
    encoding = 'pcm16';
  }
  const bytes = encodeWavBytes(channels, sampleRate, { format: encoding === 'float' ? 'float32' : 'pcm16' });
  return { sampleRate, channels: channels.length, length, encoding: 'wav', data: bytesToBase64(bytes) };
}

async function loadAudio(stored: StoredAudio): Promise<ProjectAudio> {
  const bytes = base64ToBytes(stored.data);
  if (stored.encoding === 'wav') {
    const wav = decodeWavBytes(bytes);
    return { sampleRate: wav.sampleRate, channels: wav.channels };
  }
  const blob = new Blob([bytes as BlobPart], { type: 'audio/webm' });
  let decoded: { sampleRate: number; channels: Float32Array[] };
  try {
    const buffer = await decodeAudio(blob);
    decoded = { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)) };
  } catch {
    decoded = await decodeWithMediabunny(blob);
  }
  let channels = matchChannelCount(decoded.channels, Math.max(1, stored.channels));
  if (decoded.sampleRate !== stored.sampleRate) channels = resampleChannels(channels, decoded.sampleRate, stored.sampleRate);
  // trim / pad to the stored length (codec priming)
  channels = channels.map((c) => {
    if (c.length === stored.length) return c;
    const out = new Float32Array(stored.length);
    out.set(c.subarray(0, Math.min(c.length, stored.length)));
    return out;
  });
  return { sampleRate: stored.sampleRate, channels };
}

export async function buildProject(data: ProjectData, encoding: ProjectEncoding): Promise<string> {
  const audio = data.audio ? await storeAudio(data.audio.channels, data.audio.sampleRate, encoding) : null;
  const usedSources = new Set(data.session?.tracks.flatMap((t) => t.clips.map((c) => c.sourceId)) ?? []);
  const sources = [];
  for (const s of data.sources) {
    if (!usedSources.has(s.id)) continue;
    sources.push({ id: s.id, name: s.name, audio: await storeAudio(s.channels, s.sampleRate, encoding) });
  }
  const json = {
    app: 'ultima',
    module: 'audio',
    version: 1,
    name: data.name,
    savedAt: new Date().toISOString(),
    audio,
    markers: data.markers.map((m) => ({ pos: m.pos, label: m.label })),
    transcript: data.transcript.map((s) => ({ start: s.start, end: s.end, text: s.text })),
    multitrack: data.session ? { sampleRate: data.session.sampleRate, tracks: data.session.tracks, sources } : null,
    view: data.view,
  };
  return JSON.stringify(json);
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object';
const finite = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

function validStoredAudio(v: unknown): v is StoredAudio {
  return isObj(v) && typeof v.data === 'string' && (v.encoding === 'wav' || v.encoding === 'opus') && finite(v.sampleRate, 0) >= 1000;
}

export async function parseProject(text: string): Promise<ProjectData> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(t('This project file is damaged (invalid JSON).'));
  }
  if (!isObj(json) || json.app !== 'ultima' || json.module !== 'audio') throw new Error(t('This is not an Ultima audio project.'));
  if (finite(json.version, 0) > 1) throw new Error(t('This project was saved by a newer version of Ultima.'));
  const audio = validStoredAudio(json.audio) ? await loadAudio(json.audio) : null;
  const markers: Marker[] = Array.isArray(json.markers)
    ? json.markers.filter(isObj).map((m) => ({ id: uid('mk'), pos: Math.max(0, Math.round(finite(m.pos, 0))), label: String(m.label ?? '').slice(0, 200) }))
    : [];
  const transcript: TranscriptSegment[] = Array.isArray(json.transcript)
    ? json.transcript
        .filter(isObj)
        .map((s) => ({ id: uid('ts'), start: Math.max(0, Math.round(finite(s.start, 0))), end: Math.max(0, Math.round(finite(s.end, 0))), text: String(s.text ?? '').slice(0, 2000) }))
        .filter((s) => s.end > s.start)
    : [];
  let session: MtSession | null = null;
  const sources: MtSource[] = [];
  if (isObj(json.multitrack) && Array.isArray(json.multitrack.tracks)) {
    const mt = json.multitrack;
    for (const s of Array.isArray(mt.sources) ? mt.sources.filter(isObj) : []) {
      if (typeof s.id !== 'string' || !validStoredAudio(s.audio)) continue;
      const a = await loadAudio(s.audio);
      sources.push({ id: s.id, name: String(s.name ?? 'Clip'), sampleRate: a.sampleRate, channels: a.channels });
    }
    const known = new Set(sources.map((s) => s.id));
    session = {
      sampleRate: Math.round(finite(mt.sampleRate, 48000)),
      tracks: (mt.tracks as unknown[]).filter(isObj).map((t, i) => ({
        id: typeof t.id === 'string' ? t.id : uid('trk'),
        name: String(t.name ?? `Track ${i + 1}`).slice(0, 80),
        volumeDb: Math.min(12, Math.max(-60, finite(t.volumeDb, 0))),
        pan: Math.min(1, Math.max(-1, finite(t.pan, 0))),
        mute: Boolean(t.mute),
        solo: Boolean(t.solo),
        color: typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#10d9b0',
        clips: (Array.isArray(t.clips) ? t.clips : [])
          .filter(isObj)
          .filter((c) => typeof c.sourceId === 'string' && known.has(c.sourceId))
          .map((c) => ({
            id: typeof c.id === 'string' ? c.id : uid('clp'),
            sourceId: c.sourceId as string,
            start: Math.max(0, Math.round(finite(c.start, 0))),
            offset: Math.max(0, Math.round(finite(c.offset, 0))),
            length: Math.max(1, Math.round(finite(c.length, 1))),
            gainDb: Math.min(24, Math.max(-60, finite(c.gainDb, 0))),
            fadeIn: Math.max(0, Math.round(finite(c.fadeIn, 0))),
            fadeOut: Math.max(0, Math.round(finite(c.fadeOut, 0))),
          })),
      })),
    };
  }
  const view = isObj(json.view) ? { start: Math.max(0, finite(json.view.start, 0)), spp: Math.max(0.01, finite(json.view.spp, 100)) } : undefined;
  return { name: String(json.name ?? 'Untitled').slice(0, 200), audio, markers, transcript, session, sources, view };
}
