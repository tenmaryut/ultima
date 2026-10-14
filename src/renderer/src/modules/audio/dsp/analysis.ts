/**
 * Measurement: peak/RMS/DC/clipping statistics, ITU-R BS.1770-4 loudness (K-weighting,
 * 400 ms blocks with absolute and relative gating), per-second loudness, silence
 * detection and spectrogram columns. Accumulators can be fed in chunks so long files
 * are measured without blocking the UI.
 */
import { RealFFT } from './fft';
import { channelLength, type Channels } from './basic';
import type { BiquadCoefs } from './filters';

/** BS.1770 K-weighting (pre-filter shelf + RLB high-pass) for any sample rate. */
export function kWeightingCoefs(sampleRate: number): [BiquadCoefs, BiquadCoefs] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: BiquadCoefs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp: BiquadCoefs = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

export interface ChannelStats {
  peak: number;
  rms: number;
  dcOffset: number;
  clipped: number;
}

export interface AudioStats {
  samples: number;
  sampleRate: number;
  channels: number;
  peak: number;
  rms: number;
  clipped: number;
  /** Integrated loudness in LUFS (-Infinity for silence / too short). */
  loudness: number;
  /** Loudness of each second (LUFS, -70 floor), for summaries and charts. */
  perSecond: number[];
  perChannel: ChannelStats[];
}

const CLIP_LEVEL = 0.99997;
const SUB_BLOCK_SEC = 0.1;

export class StatsAccumulator {
  private readonly count: number;
  private readonly sampleRate: number;
  private readonly kw: [BiquadCoefs, BiquadCoefs];
  private readonly state: Float64Array; // 4 values per channel (z1,z2 for both filters)
  private readonly peak: Float64Array;
  private readonly sumSq: Float64Array;
  private readonly sum: Float64Array;
  private readonly clip: Float64Array;
  private readonly subLen: number;
  private subPos = 0;
  private subAcc = 0;
  private readonly subBlocks: number[] = [];
  private samples = 0;

  constructor(channels: number, sampleRate: number) {
    this.count = channels;
    this.sampleRate = sampleRate;
    this.kw = kWeightingCoefs(sampleRate);
    this.state = new Float64Array(channels * 4);
    this.peak = new Float64Array(channels);
    this.sumSq = new Float64Array(channels);
    this.sum = new Float64Array(channels);
    this.clip = new Float64Array(channels);
    this.subLen = Math.max(1, Math.round(SUB_BLOCK_SEC * sampleRate));
  }

  /** Feeds samples [start, end) of `ch` (must be called in order without gaps). */
  push(ch: Channels, start: number, end: number): void {
    const [s, h] = this.kw;
    const count = Math.min(this.count, ch.length);
    for (let i = start; i < end; i++) {
      let weighted = 0;
      for (let c = 0; c < count; c++) {
        const x = ch[c][i];
        const ax = x < 0 ? -x : x;
        if (ax > this.peak[c]) this.peak[c] = ax;
        if (ax >= CLIP_LEVEL) this.clip[c]++;
        this.sumSq[c] += x * x;
        this.sum[c] += x;
        const o = c * 4;
        // pre-filter
        const y1 = s.b0 * x + this.state[o];
        this.state[o] = s.b1 * x - s.a1 * y1 + this.state[o + 1];
        this.state[o + 1] = s.b2 * x - s.a2 * y1;
        // RLB high-pass
        const y2 = h.b0 * y1 + this.state[o + 2];
        this.state[o + 2] = h.b1 * y1 - h.a1 * y2 + this.state[o + 3];
        this.state[o + 3] = h.b2 * y1 - h.a2 * y2;
        weighted += y2 * y2;
      }
      this.subAcc += weighted;
      if (++this.subPos >= this.subLen) {
        this.subBlocks.push(this.subAcc / this.subLen);
        this.subAcc = 0;
        this.subPos = 0;
      }
    }
    this.samples += end - start;
  }

  result(): AudioStats {
    const n = this.samples;
    const perChannel: ChannelStats[] = [];
    let peak = 0;
    let sumSq = 0;
    let clipped = 0;
    for (let c = 0; c < this.count; c++) {
      perChannel.push({
        peak: this.peak[c],
        rms: n ? Math.sqrt(this.sumSq[c] / n) : 0,
        dcOffset: n ? this.sum[c] / n : 0,
        clipped: this.clip[c],
      });
      peak = Math.max(peak, this.peak[c]);
      sumSq += this.sumSq[c];
      clipped += this.clip[c];
    }
    const sub = this.subBlocks;
    // gating blocks: 400 ms = 4 sub-blocks, 75% overlap
    const blocks: number[] = [];
    for (let i = 0; i + 4 <= sub.length; i++) blocks.push((sub[i] + sub[i + 1] + sub[i + 2] + sub[i + 3]) / 4);
    const lufs = (z: number) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity);
    let loudness = -Infinity;
    const absGated = blocks.filter((z) => lufs(z) > -70);
    if (absGated.length) {
      const mean = absGated.reduce((a, b) => a + b, 0) / absGated.length;
      const relThreshold = lufs(mean) - 10;
      const relGated = absGated.filter((z) => lufs(z) > relThreshold);
      if (relGated.length) loudness = lufs(relGated.reduce((a, b) => a + b, 0) / relGated.length);
    }
    const perSecond: number[] = [];
    const per = Math.round(1 / SUB_BLOCK_SEC);
    for (let i = 0; i < sub.length; i += per) {
      const slice = sub.slice(i, i + per);
      const z = slice.reduce((a, b) => a + b, 0) / slice.length;
      perSecond.push(Math.max(-70, lufs(z)));
    }
    return {
      samples: n,
      sampleRate: this.sampleRate,
      channels: this.count,
      peak,
      rms: n && this.count ? Math.sqrt(sumSq / (n * this.count)) : 0,
      clipped,
      loudness,
      perSecond,
      perChannel,
    };
  }
}

export function computeStats(ch: Channels, sampleRate: number): AudioStats {
  const acc = new StatsAccumulator(ch.length, sampleRate);
  acc.push(ch, 0, channelLength(ch));
  return acc.result();
}

export function integratedLoudness(ch: Channels, sampleRate: number): number {
  return computeStats(ch, sampleRate).loudness;
}

/* ---------------------------- Silence detection ---------------------------- */

export interface SampleRange {
  start: number;
  end: number;
}

export interface SilenceOptions {
  thresholdDb: number;
  /** Minimum length of a silent stretch, seconds. */
  minDuration: number;
}

/** Ranges (in samples) where the 10 ms RMS of every channel stays below the threshold. */
export function detectSilence(ch: Channels, sampleRate: number, opts: SilenceOptions): SampleRange[] {
  const n = channelLength(ch);
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const threshold = Math.pow(10, opts.thresholdDb / 20);
  const thrSq = threshold * threshold;
  const minLen = Math.max(win, Math.round(opts.minDuration * sampleRate));
  const ranges: SampleRange[] = [];
  let runStart = -1;
  for (let s = 0; s < n; s += win) {
    const e = Math.min(n, s + win);
    let loud = false;
    for (const c of ch) {
      let acc = 0;
      for (let i = s; i < e; i++) acc += c[i] * c[i];
      if (acc / (e - s) > thrSq) {
        loud = true;
        break;
      }
    }
    if (!loud) {
      if (runStart < 0) runStart = s;
    } else if (runStart >= 0) {
      if (s - runStart >= minLen) ranges.push({ start: runStart, end: s });
      runStart = -1;
    }
  }
  if (runStart >= 0 && n - runStart >= minLen) ranges.push({ start: runStart, end: n });
  return ranges;
}

/**
 * Turns silent ranges into the ranges to delete, keeping `padding` seconds of silence
 * next to the sound on each side (none is kept at the very start/end of the file).
 */
export function silenceCutRanges(ranges: SampleRange[], sampleRate: number, padding: number, length: number): SampleRange[] {
  const pad = Math.max(0, Math.round(padding * sampleRate));
  const out: SampleRange[] = [];
  for (const r of ranges) {
    const start = r.start <= 0 ? 0 : r.start + pad;
    const end = r.end >= length ? length : r.end - pad;
    if (end - start > 0) out.push({ start, end });
  }
  return out;
}

/* ------------------------------- Spectrogram ------------------------------- */

export class SpectrumAnalyzer {
  readonly size: number;
  private readonly fft: RealFFT;
  private readonly win: Float64Array;
  private readonly frame: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly norm: number;

  constructor(size: number) {
    this.size = size;
    this.fft = new RealFFT(size);
    this.win = new Float64Array(size);
    let sum = 0;
    for (let i = 0; i < size; i++) {
      // Blackman-Harris: low side lobes keep the display clean
      const x = (2 * Math.PI * i) / size;
      this.win[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
      sum += this.win[i];
    }
    this.frame = new Float64Array(size);
    this.re = new Float64Array(size / 2 + 1);
    this.im = new Float64Array(size / 2 + 1);
    this.norm = 2 / sum; // full-scale sine → 0 dB
  }

  /** Magnitudes in dBFS of the frame centred at `center` (out length = size/2 + 1). */
  column(data: Float32Array, center: number, out: Float32Array): void {
    const N = this.size;
    const start = Math.round(center - N / 2);
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      this.frame[i] = idx >= 0 && idx < data.length ? data[idx] * this.win[i] : 0;
    }
    this.fft.forward(this.frame, this.re, this.im);
    for (let k = 0; k < out.length; k++) {
      const mag = Math.hypot(this.re[k], this.im[k]) * this.norm;
      out[k] = mag > 1e-10 ? 20 * Math.log10(mag) : -200;
    }
  }
}

/** Spectrogram colour map (dark → violet → red → orange → yellow → white), 256 RGB entries. */
export function spectrogramPalette(): Uint8Array {
  const stops: [number, number, number, number][] = [
    [0, 8, 6, 18],
    [0.2, 48, 16, 92],
    [0.4, 128, 24, 120],
    [0.6, 214, 52, 64],
    [0.78, 250, 140, 30],
    [0.92, 252, 222, 90],
    [1, 255, 255, 235],
  ];
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const [t0, r0, g0, b0] = stops[j];
    const [t1, r1, g1, b1] = stops[j + 1];
    const f = (t - t0) / (t1 - t0 || 1);
    out[i * 3] = Math.round(r0 + (r1 - r0) * f);
    out[i * 3 + 1] = Math.round(g0 + (g1 - g0) * f);
    out[i * 3 + 2] = Math.round(b0 + (b1 - b0) * f);
  }
  return out;
}
