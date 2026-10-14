import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';
import { getAudioContext } from '../../core/utils/audio';
import type { MediaRef } from './types';

/**
 * Decoded audio for the timeline mix, waveforms, captions and silence detection.
 *
 * Memory rules: a media file's whole audio track is decoded and cached only when its PCM
 * fits a budget (LRU across files). Longer files are decoded range by range straight from
 * the File (mediabunny reads slices of the Blob — the file is never fully copied).
 */

export interface Pcm {
  sampleRate: number;
  /** 1 or 2 channels. */
  channels: Float32Array[];
}

export interface Peaks {
  /** [min, max] pairs per bucket (both channels combined). */
  data: Float32Array;
  perSecond: number;
}

const MAX_FULL_PCM_BYTES = 400 * 1024 * 1024;
const CACHE_BUDGET = 800 * 1024 * 1024;
const MAX_DECODE_AUDIO_DATA_FILE = 1024 * 1024 * 1024;

interface Entry extends Pcm {
  bytes: number;
  lastUse: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | null>>();
const failed = new Set<string>();
let cacheBytes = 0;

function pcmBytes(p: Pcm): number {
  return p.channels.reduce((n, c) => n + c.byteLength, 0);
}

function remember(id: string, pcm: Pcm): Entry {
  const entry: Entry = { ...pcm, bytes: pcmBytes(pcm), lastUse: performance.now() };
  cache.set(id, entry);
  cacheBytes += entry.bytes;
  while (cacheBytes > CACHE_BUDGET && cache.size > 1) {
    let oldest: string | null = null;
    let t = Infinity;
    for (const [k, v] of cache) if (k !== id && v.lastUse < t) {
      t = v.lastUse;
      oldest = k;
    }
    if (!oldest) break;
    cacheBytes -= cache.get(oldest)!.bytes;
    cache.delete(oldest);
  }
  return entry;
}

/* ------------------------------ mediabunny inputs ----------------------------- */

interface OpenInput {
  input: Input;
  track: InputAudioTrack | null;
  sink: AudioBufferSink | null;
  lastUse: number;
}
const inputs = new Map<string, Promise<OpenInput>>();

async function openInput(id: string, file: File): Promise<OpenInput> {
  let p = inputs.get(id);
  if (!p) {
    p = (async () => {
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      const track = await input.getPrimaryAudioTrack().catch(() => null);
      const ok = track ? await track.canDecode().catch(() => false) : false;
      return { input, track, sink: track && ok ? new AudioBufferSink(track) : null, lastUse: performance.now() };
    })();
    inputs.set(id, p);
    if (inputs.size > 8) {
      const first = inputs.keys().next().value as string;
      const old = inputs.get(first);
      inputs.delete(first);
      void old?.then((o) => o.input.dispose()).catch(() => undefined);
    }
  }
  const o = await p;
  o.lastUse = performance.now();
  return o;
}

/** Releases decoders and cached audio of a media item (e.g. after removing or relinking it). */
export function forgetAudio(id: string): void {
  const e = cache.get(id);
  if (e) {
    cacheBytes -= e.bytes;
    cache.delete(id);
  }
  failed.delete(id);
  const p = inputs.get(id);
  inputs.delete(id);
  void p?.then((o) => o.input.dispose()).catch(() => undefined);
}

/** Decodes [from, to) with mediabunny into at most 2 channels. Null when nothing could be decoded. */
async function decodeRange(sink: AudioBufferSink, from: number, to: number): Promise<Pcm | null> {
  let sr = 0;
  let out: Float32Array[] = [];
  let len = 0;
  for await (const wb of sink.buffers(Math.max(0, from), to)) {
    const buf = wb.buffer;
    if (!sr) {
      sr = buf.sampleRate;
      const chs = Math.min(2, buf.numberOfChannels);
      len = Math.max(1, Math.ceil((to - from) * sr));
      out = Array.from({ length: chs }, () => new Float32Array(len));
    }
    const offset = Math.round((wb.timestamp - from) * sr);
    const start = Math.max(0, -offset);
    const end = Math.min(buf.length, len - offset);
    if (end <= start) continue;
    for (let c = 0; c < out.length; c++) {
      const data = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
      out[c].set(data.subarray(start, end), offset + start);
    }
  }
  return sr ? { sampleRate: sr, channels: out } : null;
}

async function decodeWhole(media: MediaRef, file: File): Promise<Pcm | null> {
  try {
    const o = await openInput(media.id, file);
    if (o.sink) {
      const duration = media.duration || (await o.input.computeDuration());
      const pcm = await decodeRange(o.sink, 0, duration + 0.05);
      if (pcm) return pcm;
    }
  } catch {
    // fall through to the Web Audio decoder
  }
  if (file.size > MAX_DECODE_AUDIO_DATA_FILE) return null;
  try {
    const buffer = await getAudioContext().decodeAudioData(await file.arrayBuffer());
    const chs = Math.min(2, buffer.numberOfChannels);
    return { sampleRate: buffer.sampleRate, channels: Array.from({ length: chs }, (_, c) => buffer.getChannelData(c).slice()) };
  } catch {
    return null;
  }
}

/** The whole audio track (cached), or null when it is too long to keep in memory / has no audio. */
export async function fullAudio(media: MediaRef, file: File): Promise<Pcm | null> {
  const hit = cache.get(media.id);
  if (hit) {
    hit.lastUse = performance.now();
    return hit;
  }
  if (!media.hasAudio || failed.has(media.id)) return null;
  if (media.duration * 48000 * 2 * 4 > MAX_FULL_PCM_BYTES) return null;
  let p = inflight.get(media.id);
  if (!p) {
    p = decodeWhole(media, file).then((pcm) => {
      inflight.delete(media.id);
      if (!pcm) {
        failed.add(media.id);
        return null;
      }
      return remember(media.id, pcm);
    });
    inflight.set(media.id, p);
  }
  return p;
}

function slice(pcm: Pcm, from: number, to: number): Pcm {
  const sr = pcm.sampleRate;
  const len = Math.max(1, Math.round((to - from) * sr));
  const a = Math.round(from * sr);
  return {
    sampleRate: sr,
    channels: pcm.channels.map((ch) => {
      const out = new Float32Array(len);
      const s = Math.max(0, a);
      const e = Math.min(ch.length, a + len);
      if (e > s) out.set(ch.subarray(s, e), s - a);
      return out;
    }),
  };
}

/** Source audio between `from` and `to` seconds (zero padded). Null when the media has no usable audio. */
export async function readPcm(media: MediaRef, file: File, from: number, to: number): Promise<Pcm | null> {
  if (!media.hasAudio || to <= from) return null;
  const full = await fullAudio(media, file);
  if (full) return slice(full, from, to);
  if (failed.has(media.id)) return null;
  try {
    const o = await openInput(media.id, file);
    if (!o.sink) return null;
    return await decodeRange(o.sink, from, to);
  } catch {
    return null;
  }
}

/** Waveform peaks for a media file (bounded size even for very long files). */
export async function computeMediaPeaks(media: MediaRef, file: File): Promise<Peaks | null> {
  if (!media.hasAudio || media.duration <= 0) return null;
  const perSecond = Math.max(4, Math.min(200, Math.round(60000 / Math.max(1, media.duration))));
  const buckets = Math.max(1, Math.ceil(media.duration * perSecond));
  const data = new Float32Array(buckets * 2);
  const add = (pcm: Pcm, offsetSec: number) => {
    const per = pcm.sampleRate / perSecond;
    const len = pcm.channels[0].length;
    for (let b = Math.max(0, Math.floor(offsetSec * perSecond)); b < buckets; b++) {
      const from = Math.floor((b / perSecond - offsetSec) * pcm.sampleRate);
      const to = Math.min(len, Math.floor(from + per));
      if (from >= len) break;
      let min = data[b * 2];
      let max = data[b * 2 + 1];
      for (const ch of pcm.channels) {
        for (let i = Math.max(0, from); i < to; i++) {
          const v = ch[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      data[b * 2] = min;
      data[b * 2 + 1] = max;
    }
  };
  const full = await fullAudio(media, file);
  if (full) {
    add(full, 0);
    return { data, perSecond };
  }
  try {
    const o = await openInput(media.id, file);
    if (!o.sink) return null;
    let any = false;
    for await (const wb of o.sink.buffers(0, media.duration + 0.05)) {
      const buf = wb.buffer;
      const chs = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c));
      add({ sampleRate: buf.sampleRate, channels: chs }, wb.timestamp);
      any = true;
    }
    return any ? { data, perSecond } : null;
  } catch {
    return null;
  }
}
