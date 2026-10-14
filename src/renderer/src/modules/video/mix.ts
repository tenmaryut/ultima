import type { Clip, Project, TimeRange } from './types';
import { clipEnd, getMedia, sourceOut, tracksOfKind } from './model';
import { fadeFactor } from './fx';
import { dbToGain } from './time';
import { readPcm, type Pcm } from './audioSource';
import { timeStretch } from './stretch';
import { animatedLowPass, animatedVolume, isRemapped, sourceAt } from './keyframes';
import { buildChain, fxTail } from './audiofx';
import type { MediaLibrary } from './media';

/* Offline timeline audio mix (OfflineAudioContext), rendered chunk by chunk to bound memory. */

/** Audio tracks that are heard (mute + solo rules). */
export function audibleTrackIds(p: Project): Set<string> {
  const audio = tracksOfKind(p, 'audio');
  const solo = audio.some((t) => t.solo);
  return new Set(audio.filter((t) => !t.muted && (!solo || t.solo)).map((t) => t.id));
}

/** Audio clips that are heard, sorted by start. */
export function audibleClips(p: Project): Clip[] {
  const tracks = audibleTrackIds(p);
  return p.clips.filter((c) => c.kind === 'audio' && tracks.has(c.trackId) && c.mediaId).sort((a, b) => a.start - b.start);
}

/** Gain of a clip at timeline time t (volume with its keyframes, fades; frozen clips are silent). */
export function clipGainAt(c: Clip, t: number): number {
  if (c.freeze) return 0;
  return dbToGain(animatedVolume(c, t - c.start)) * fadeFactor(t - c.start, c.duration, c.fadeIn, c.fadeOut);
}

/**
 * Source audio laid out on the timeline for [a, b) of a clip whose time is remapped (speed ramp
 * or reverse): every output sample reads the source at sourceAt() (pitch follows the speed).
 */
export function remapPcm(clip: Clip, src: Pcm, srcFrom: number, a: number, b: number): Pcm {
  const sr = src.sampleRate;
  const len = Math.max(0, Math.round((b - a) * sr));
  const channels = src.channels.map(() => new Float32Array(len));
  const n = src.channels[0]?.length ?? 0;
  for (let i = 0; i < len; i++) {
    const pos = (sourceAt(clip, a - clip.start + i / sr) - srcFrom) * sr;
    const j = Math.floor(pos);
    if (j < 0 || j >= n) continue;
    const f = pos - j;
    for (let c = 0; c < channels.length; c++) {
      const ch = src.channels[c];
      channels[c][i] = ch[j] + (j + 1 < n ? (ch[j + 1] - ch[j]) * f : 0);
    }
  }
  return { sampleRate: sr, channels };
}

export interface MixOptions {
  sampleRate?: number;
  channels?: number;
  /** Seconds per rendered chunk. */
  chunk?: number;
}

const STRETCH_WHOLE_LIMIT = 900; // seconds of source audio stretched in one piece

export class TimelineMixer {
  readonly sampleRate: number;
  readonly channels: number;
  private chunk: number;
  private clips: Clip[];
  private stretched = new Map<string, Promise<Pcm | null>>();
  /** Samples rendered so far. */
  private done = 0;
  readonly totalSamples: number;

  constructor(
    private project: Project,
    private lib: MediaLibrary,
    private range: TimeRange,
    opts: MixOptions = {},
  ) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.channels = opts.channels ?? 2;
    this.chunk = opts.chunk ?? 2;
    // a clip with reverb is heard after its end too
    this.clips = audibleClips(project).filter((c) => c.start < range.end && clipEnd(c) + fxTail(c) > range.start);
    this.totalSamples = Math.max(1, Math.round((range.end - range.start) * this.sampleRate));
  }

  /** Seconds of audio rendered so far. */
  get renderedSeconds(): number {
    return this.done / this.sampleRate;
  }

  get finished(): boolean {
    return this.done >= this.totalSamples;
  }

  /** Renders the next chunk, or returns null when everything has been rendered. */
  async next(): Promise<AudioBuffer | null> {
    if (this.finished) return null;
    const s0 = this.done;
    const s1 = Math.min(this.totalSamples, s0 + Math.round(this.chunk * this.sampleRate));
    this.done = s1;
    const c0 = this.range.start + s0 / this.sampleRate;
    const c1 = this.range.start + s1 / this.sampleRate;
    const active = this.clips.filter((c) => c.start < c1 && clipEnd(c) + fxTail(c) > c0);
    // effects need the sound just before the chunk (filter state, reverb tails): render it and drop it
    const preSamples = Math.ceil(Math.max(0, ...active.map(fxTail)) * this.sampleRate);
    const pre = preSamples / this.sampleRate;
    const t0 = c0 - pre;
    const ctx = new OfflineAudioContext(this.channels, s1 - s0 + preSamples, this.sampleRate);
    for (const clip of active) {
      const a = Math.max(c0 - fxTail(clip), clip.start);
      const b = Math.min(c1, clipEnd(clip));
      if (b - a <= 1e-6) continue;
      const piece = await this.clipAudio(clip, a, b);
      if (!piece) continue;
      const len = piece.pcm.channels[0].length;
      if (!len) continue;
      const buffer = ctx.createBuffer(piece.pcm.channels.length, len, piece.pcm.sampleRate);
      piece.pcm.channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (!piece.stretched && clip.speed !== 1) src.playbackRate.value = clip.speed;
      const gain = ctx.createGain();
      const steps = Math.max(2, Math.ceil((b - a) * 60));
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) curve[i] = clipGainAt(clip, a + ((b - a) * i) / (steps - 1));
      if (curve.every((g) => g === curve[0])) gain.gain.value = curve[0];
      else gain.gain.setValueCurveAtTime(curve, a - t0, b - a);
      src.connect(gain);
      const chain = buildChain(ctx, clip);
      if (chain) {
        gain.connect(chain.input);
        chain.output.connect(ctx.destination);
        if (chain.lowPass && clip.keys?.lowPass?.length) {
          const f = new Float32Array(steps);
          for (let i = 0; i < steps; i++) f[i] = animatedLowPass(clip, a + ((b - a) * i) / (steps - 1) - clip.start);
          chain.lowPass.frequency.setValueCurveAtTime(f, a - t0, b - a);
        }
      } else gain.connect(ctx.destination);
      src.start(a - t0);
    }
    const rendered = await ctx.startRendering();
    if (!preSamples) return rendered;
    const out = new AudioBuffer({ length: s1 - s0, numberOfChannels: rendered.numberOfChannels, sampleRate: this.sampleRate });
    for (let ch = 0; ch < rendered.numberOfChannels; ch++) out.copyToChannel(rendered.getChannelData(ch).subarray(preSamples), ch);
    return out;
  }

  /** PCM for clip time [a, b): either pre-stretched to timeline speed, or raw source audio played at clip speed. */
  private async clipAudio(clip: Clip, a: number, b: number): Promise<{ pcm: Pcm; stretched: boolean } | null> {
    const media = getMedia(this.project, clip.mediaId);
    const file = this.lib.file(clip.mediaId);
    if (!media || !file || clip.freeze) return null;
    if (isRemapped(clip)) {
      // ramps and reverse: read the clip's whole source range once, then map it sample by sample
      let p = this.stretched.get(clip.id);
      if (!p) {
        p = readPcm(media, file, clip.in, sourceOut(clip) + 0.05);
        this.stretched.set(clip.id, p);
      }
      const whole = await p;
      return whole ? { pcm: remapPcm(clip, whole, clip.in, a, b), stretched: true } : null;
    }
    if (clip.speed !== 1 && clip.keepPitch && clip.duration * clip.speed <= STRETCH_WHOLE_LIMIT) {
      let p = this.stretched.get(clip.id);
      if (!p) {
        p = readPcm(media, file, clip.in, sourceOut(clip)).then((src) =>
          src ? { sampleRate: src.sampleRate, channels: timeStretch(src.channels, clip.speed, src.sampleRate) } : null,
        );
        this.stretched.set(clip.id, p);
      }
      const whole = await p;
      if (!whole) return null;
      const sr = whole.sampleRate;
      const from = Math.round((a - clip.start) * sr);
      const to = Math.round((b - clip.start) * sr);
      return {
        stretched: true,
        pcm: { sampleRate: sr, channels: whole.channels.map((ch) => ch.slice(Math.max(0, from), Math.max(from, Math.min(ch.length, to)))) },
      };
    }
    const srcA = clip.in + (a - clip.start) * clip.speed;
    const srcB = clip.in + (b - clip.start) * clip.speed;
    const pcm = await readPcm(media, file, srcA, srcB);
    return pcm ? { pcm, stretched: false } : null;
  }

  dispose(): void {
    this.stretched.clear();
  }
}

/**
 * Mixes a whole range into one buffer (used for captions, silence detection and WAV export of
 * short ranges). Mono output is the channel average.
 */
export async function mixRange(
  project: Project,
  lib: MediaLibrary,
  range: TimeRange,
  opts: MixOptions & { onProgress?: (f: number) => void; signal?: AbortSignal } = {},
): Promise<{ sampleRate: number; channels: Float32Array[] }> {
  const mixer = new TimelineMixer(project, lib, range, { chunk: 10, ...opts });
  const channels = Array.from({ length: mixer.channels }, () => new Float32Array(mixer.totalSamples));
  let offset = 0;
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const buf = await mixer.next();
      if (!buf) break;
      for (let c = 0; c < channels.length; c++) channels[c].set(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).subarray(0, channels[c].length - offset), offset);
      offset += buf.length;
      opts.onProgress?.(mixer.renderedSeconds / Math.max(1e-6, range.end - range.start));
    }
  } finally {
    mixer.dispose();
  }
  return { sampleRate: mixer.sampleRate, channels };
}

/** True when any audible clip exists in the range. */
export function hasAudioIn(p: Project, range: TimeRange): boolean {
  return audibleClips(p).some((c) => c.start < range.end && clipEnd(c) > range.start);
}
