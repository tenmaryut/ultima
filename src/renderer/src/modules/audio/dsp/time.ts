/**
 * Time-domain processing: band-limited resampling, speed change, phase-vocoder pitch
 * shifting (duration preserved) and echo/delay.
 */
import { RealFFT, hannWindow } from './fft';
import { channelLength, type Channels } from './basic';

export type Progress = (fraction: number) => void;

/* -------------------------------- Resampler -------------------------------- */

const ZERO_CROSSINGS = 12;
const TABLE_RES = 512;
let kernelTable: Float64Array | null = null;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/** Kaiser-windowed sinc sampled at TABLE_RES points per zero crossing. */
function kernel(): Float64Array {
  if (kernelTable) return kernelTable;
  const size = ZERO_CROSSINGS * TABLE_RES + 2;
  const table = new Float64Array(size);
  const beta = 8.6;
  const i0b = besselI0(beta);
  for (let i = 0; i < size; i++) {
    const x = i / TABLE_RES;
    if (x >= ZERO_CROSSINGS) {
      table[i] = 0;
      continue;
    }
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = x / ZERO_CROSSINGS;
    table[i] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b);
  }
  kernelTable = table;
  return table;
}

/**
 * Resamples `data` so that its length becomes `round(length * ratio)` (ratio = outRate / inRate).
 * Windowed-sinc interpolation with an anti-aliasing cut-off when downsampling.
 */
export function resample(data: Float32Array, ratio: number, onProgress?: Progress): Float32Array {
  if (!(ratio > 0) || !Number.isFinite(ratio)) throw new Error('Invalid resampling ratio');
  const inLen = data.length;
  const outLen = Math.max(0, Math.round(inLen * ratio));
  const out = new Float32Array(outLen);
  if (!inLen || !outLen) return out;
  if (Math.abs(ratio - 1) < 1e-12) {
    out.set(data.subarray(0, outLen));
    return out;
  }
  const table = kernel();
  const fc = Math.min(1, ratio); // cut-off relative to the input Nyquist
  const half = ZERO_CROSSINGS / fc; // kernel half-width in input samples
  const step = 1 / ratio;
  const progressEvery = 1 << 16;
  for (let j = 0; j < outLen; j++) {
    const x = j * step;
    const lo = Math.max(0, Math.ceil(x - half));
    const hi = Math.min(inLen - 1, Math.floor(x + half));
    let sum = 0;
    let wsum = 0;
    for (let i = lo; i <= hi; i++) {
      const u = Math.abs(x - i) * fc * TABLE_RES;
      const k = u | 0;
      const frac = u - k;
      const w = table[k] + (table[k + 1] - table[k]) * frac;
      sum += data[i] * w;
      wsum += w;
    }
    // normalise by the kernel's DC gain (sum of weights): exact for constant signals,
    // including near the edges where the kernel is truncated
    out[j] = wsum > 1e-9 ? sum / wsum : 0;
    if (onProgress && j % progressEvery === 0) onProgress(j / outLen);
  }
  return out;
}

export function resampleChannels(ch: Channels, fromRate: number, toRate: number, onProgress?: Progress): Channels {
  if (fromRate === toRate) return ch;
  const ratio = toRate / fromRate;
  return ch.map((c, i) => resample(c, ratio, onProgress ? (f) => onProgress((i + f) / ch.length) : undefined));
}

/** Plays faster (factor > 1) or slower like a tape: duration and pitch both change. */
export function changeSpeed(ch: Channels, factor: number, onProgress?: Progress): Channels {
  const f = Math.min(8, Math.max(0.125, factor));
  return ch.map((c, i) => resample(c, 1 / f, onProgress ? (p) => onProgress((i + p) / ch.length) : undefined));
}

/* ------------------------------- Pitch shift ------------------------------- */

function princarg(phase: number): number {
  return phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));
}

/**
 * Phase-vocoder time stretch with identity phase locking (Laroche & Dolson).
 * Output length ≈ input length × hs / ha.
 */
export function timeStretch(data: Float32Array, stretch: number, fftSize = 2048, onProgress?: Progress): { out: Float32Array; actual: number } {
  const N = fftSize;
  const ha = N / 8;
  const hs = Math.max(1, Math.round(ha * stretch));
  const actual = hs / ha;
  const len = data.length;
  const frames = Math.max(1, Math.ceil((len + N) / ha));
  const outLen = (frames - 1) * hs + N;
  const out = new Float64Array(outLen);
  const norm = new Float64Array(outLen);
  const win = hannWindow(N);
  const fft = new RealFFT(N);
  const bins = N / 2 + 1;
  const re = new Float64Array(bins);
  const im = new Float64Array(bins);
  const mag = new Float64Array(bins);
  const phase = new Float64Array(bins);
  const prevPhase = new Float64Array(bins);
  const synthPhase = new Float64Array(bins);
  const frame = new Float64Array(N);
  const time = new Float64Array(N);
  const peaks = new Int32Array(bins);
  let first = true;
  for (let f = 0; f < frames; f++) {
    // analysis frame starts at f*ha - N (so the signal is fully covered with padding)
    const start = f * ha - N;
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      frame[i] = idx >= 0 && idx < len ? data[idx] * win[i] : 0;
    }
    fft.forward(frame, re, im);
    for (let k = 0; k < bins; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      phase[k] = Math.atan2(im[k], re[k]);
    }
    if (first) {
      for (let k = 0; k < bins; k++) synthPhase[k] = phase[k];
      first = false;
    } else {
      // find spectral peaks
      let peakCount = 0;
      for (let k = 2; k < bins - 2; k++) {
        const m = mag[k];
        if (m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2]) peaks[peakCount++] = k;
      }
      if (peakCount === 0) {
        for (let k = 0; k < bins; k++) {
          const omega = (2 * Math.PI * k) / N;
          const delta = princarg(phase[k] - prevPhase[k] - omega * ha);
          synthPhase[k] = synthPhase[k] + (omega + delta / ha) * hs;
        }
      } else {
        // advance peak phases, then lock each region of influence to its peak
        let regionStart = 0;
        for (let p = 0; p < peakCount; p++) {
          const k = peaks[p];
          const omega = (2 * Math.PI * k) / N;
          const delta = princarg(phase[k] - prevPhase[k] - omega * ha);
          const peakSynth = synthPhase[k] + (omega + delta / ha) * hs;
          const regionEnd = p + 1 < peakCount ? Math.floor((k + peaks[p + 1]) / 2) : bins - 1;
          const rot = peakSynth - phase[k];
          for (let b = regionStart; b <= regionEnd; b++) synthPhase[b] = b === k ? peakSynth : phase[b] + rot;
          regionStart = regionEnd + 1;
        }
      }
    }
    for (let k = 0; k < bins; k++) {
      prevPhase[k] = phase[k];
      re[k] = mag[k] * Math.cos(synthPhase[k]);
      im[k] = mag[k] * Math.sin(synthPhase[k]);
    }
    fft.inverse(re, im, time);
    const outStart = f * hs;
    for (let i = 0; i < N; i++) {
      out[outStart + i] += time[i] * win[i];
      norm[outStart + i] += win[i] * win[i];
    }
    if (onProgress && f % 64 === 0) onProgress(f / frames);
  }
  // analysis frame centres (f*ha - N/2) map to synthesis frame centres (f*hs + N/2), so
  // input sample s lands at s*actual + (N/2)(actual + 1) in the output
  const lead = Math.round((N / 2) * (actual + 1));
  const resultLen = Math.max(0, Math.round(len * actual));
  const result = new Float32Array(resultLen);
  for (let i = 0; i < resultLen; i++) {
    const idx = i + lead;
    if (idx >= outLen) break;
    const w = norm[idx];
    result[i] = w > 1e-3 ? out[idx] / w : 0;
  }
  return { out: result, actual };
}

/** Shifts pitch by `semitones` while keeping the duration (phase vocoder + resampling). */
export function pitchShift(ch: Channels, sampleRate: number, semitones: number, onProgress?: Progress): Channels {
  const st = Math.min(24, Math.max(-24, semitones));
  if (Math.abs(st) < 1e-3) return ch;
  const ratio = Math.pow(2, st / 12);
  const fftSize = sampleRate > 64000 ? 4096 : 2048;
  const n = channelLength(ch);
  return ch.map((c, i) => {
    const report = onProgress ? (f: number) => onProgress((i + f) / ch.length) : undefined;
    const { out, actual } = timeStretch(c, ratio, fftSize, report ? (f) => report(f * 0.8) : undefined);
    const resampled = resample(out, 1 / actual, report ? (f) => report(0.8 + f * 0.2) : undefined);
    // exact original length
    if (resampled.length === n) return resampled;
    const fixed = new Float32Array(n);
    fixed.set(resampled.subarray(0, Math.min(n, resampled.length)));
    return fixed;
  });
}

/* ---------------------------------- Echo ---------------------------------- */

export interface EchoParams {
  delayMs: number;
  /** 0..0.95 */
  feedback: number;
  /** wet level 0..1 (dry stays at unity) */
  mix: number;
  pingPong: boolean;
}

export function echo(ch: Channels, sampleRate: number, p: EchoParams): Channels {
  const D = Math.max(1, Math.round((Math.max(1, p.delayMs) / 1000) * sampleRate));
  const fb = Math.min(0.95, Math.max(0, p.feedback));
  const mix = Math.min(1, Math.max(0, p.mix));
  const n = channelLength(ch);
  const count = ch.length;
  // per-channel ring buffers of the dry input and of the wet (delayed) signal
  const dry = Array.from({ length: count }, () => new Float32Array(D));
  const wet = Array.from({ length: count }, () => new Float32Array(D));
  const pingPong = p.pingPong && count >= 2;
  for (let i = 0; i < n; i++) {
    const pos = i % D;
    if (pingPong) {
      // the dry signal (mono sum) enters the left delay, which feeds the right one and vice versa
      const inL = (dry[0][pos] + dry[1][pos]) * 0.5;
      const newL = inL + fb * wet[1][pos];
      const newR = fb * wet[0][pos];
      for (let c = 0; c < count; c++) dry[c][pos] = ch[c][i];
      wet[0][pos] = newL;
      wet[1][pos] = newR;
      ch[0][i] += mix * newL;
      ch[1][i] += mix * newR;
    } else {
      for (let c = 0; c < count; c++) {
        const w = dry[c][pos] + fb * wet[c][pos];
        dry[c][pos] = ch[c][i];
        wet[c][pos] = w;
        ch[c][i] += mix * w;
      }
    }
  }
  return ch;
}
