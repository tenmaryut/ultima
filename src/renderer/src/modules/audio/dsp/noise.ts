/**
 * Audition-style noise reduction:
 *  1. capture a noise print (mean power spectrum of a noise-only selection), or
 *     estimate one from the quietest frames of the audio;
 *  2. STFT (Hann, 75% overlap) → per-bin spectral subtraction gain with
 *     over-subtraction, frequency + temporal gain smoothing (against "musical noise")
 *     and a reduction floor → inverse STFT with weighted overlap-add.
 */
import { RealFFT, hannWindow, overlapAddGain } from './fft';
import { channelLength, type Channels } from './basic';
import type { Progress } from './time';

export interface NoiseProfile {
  sampleRate: number;
  fftSize: number;
  /** Mean power per bin (fftSize/2 + 1 values), one array per captured channel. */
  power: Float32Array[];
  /** Seconds of audio the profile was measured from. */
  duration: number;
}

export interface NoiseReductionParams {
  /** Maximum attenuation of noise, dB (0..48). */
  reductionDb: number;
  /** 0..10 — higher removes more (over-subtraction), with more risk of artifacts. */
  sensitivity: number;
  /** Frequency smoothing radius in bins (0..8). */
  freqSmoothing: number;
  attackMs: number;
  releaseMs: number;
  /** Output only what would be removed (to audition the noise). */
  noiseOnly: boolean;
}

export const DEFAULT_NR: NoiseReductionParams = {
  reductionDb: 18,
  sensitivity: 5,
  freqSmoothing: 2,
  attackMs: 5,
  releaseMs: 80,
  noiseOnly: false,
};

export function noiseFftSize(sampleRate: number): number {
  return sampleRate > 64000 ? 4096 : sampleRate > 24000 ? 2048 : 1024;
}

function frameSpectrumPower(fft: RealFFT, data: Float32Array, start: number, win: Float64Array, frame: Float64Array, re: Float64Array, im: Float64Array, out: Float64Array): number {
  const N = win.length;
  let energy = 0;
  for (let i = 0; i < N; i++) {
    const idx = start + i;
    const v = idx >= 0 && idx < data.length ? data[idx] : 0;
    frame[i] = v * win[i];
    energy += v * v;
  }
  fft.forward(frame, re, im);
  for (let k = 0; k < out.length; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return energy / N;
}

/** Mean power spectrum of a noise-only selection. */
export function captureNoiseProfile(ch: Channels, sampleRate: number): NoiseProfile {
  const N = noiseFftSize(sampleRate);
  const H = N / 4;
  const n = channelLength(ch);
  const fft = new RealFFT(N);
  const win = hannWindow(N);
  const bins = N / 2 + 1;
  const frame = new Float64Array(N);
  const re = new Float64Array(bins);
  const im = new Float64Array(bins);
  const pow = new Float64Array(bins);
  const frames = n <= N ? 1 : Math.floor((n - N) / H) + 1;
  // cap the amount of work for very long selections by striding over frames
  const stride = Math.max(1, Math.floor(frames / 4000));
  const power = ch.map((data) => {
    const acc = new Float64Array(bins);
    let count = 0;
    for (let f = 0; f < frames; f += stride) {
      frameSpectrumPower(fft, data, f * H, win, frame, re, im, pow);
      for (let k = 0; k < bins; k++) acc[k] += pow[k];
      count++;
    }
    const outArr = new Float32Array(bins);
    for (let k = 0; k < bins; k++) outArr[k] = acc[k] / Math.max(1, count);
    return outArr;
  });
  return { sampleRate, fftSize: N, power, duration: n / sampleRate };
}

/**
 * Estimates a noise print from the quietest frames (default: quietest 10%) — used by
 * "Auto clean voice" and the AI when no noise print was captured.
 */
export function estimateNoiseProfile(ch: Channels, sampleRate: number, quantile = 0.1): NoiseProfile {
  const N = noiseFftSize(sampleRate);
  const H = N / 2;
  const n = channelLength(ch);
  const total = n <= N ? 1 : Math.floor((n - N) / H) + 1;
  const maxFrames = 6000;
  const stride = Math.max(1, Math.floor(total / maxFrames));
  const fft = new RealFFT(N);
  const win = hannWindow(N);
  const bins = N / 2 + 1;
  const frame = new Float64Array(N);
  const re = new Float64Array(bins);
  const im = new Float64Array(bins);
  const pow = new Float64Array(bins);
  // pass 1: frame energies (all channels)
  const starts: number[] = [];
  const energies: number[] = [];
  for (let f = 0; f < total; f += stride) {
    const s = f * H;
    let e = 0;
    for (const data of ch) {
      const end = Math.min(data.length, s + N);
      for (let i = s; i < end; i++) e += data[i] * data[i];
    }
    starts.push(s);
    energies.push(e);
  }
  const order = starts.map((_, i) => i).sort((a, b) => energies[a] - energies[b]);
  // ignore digital silence when there is anything else (it carries no noise information)
  const nonSilent = order.filter((i) => energies[i] > 1e-10 * N);
  const pool = nonSilent.length >= 4 ? nonSilent : order;
  const count = Math.max(1, Math.min(pool.length, Math.round(pool.length * Math.min(0.5, Math.max(0.02, quantile)))));
  const chosen = pool.slice(0, count);
  const power = ch.map((data) => {
    const acc = new Float64Array(bins);
    for (const idx of chosen) {
      frameSpectrumPower(fft, data, starts[idx], win, frame, re, im, pow);
      for (let k = 0; k < bins; k++) acc[k] += pow[k];
    }
    const outArr = new Float32Array(bins);
    // the quietest frames under-estimate the mean noise level; compensate slightly
    for (let k = 0; k < bins; k++) outArr[k] = (acc[k] / chosen.length) * 1.4;
    return outArr;
  });
  return { sampleRate, fftSize: N, power, duration: (chosen.length * N) / sampleRate };
}

/** Profile power for channel `c` remapped to an FFT of size N at `sampleRate`. */
function profileFor(profile: NoiseProfile, c: number, N: number, sampleRate: number): Float64Array {
  const src =
    profile.power.length > c
      ? profile.power[c]
      : (() => {
          const mean = new Float32Array(profile.power[0].length);
          for (const p of profile.power) for (let k = 0; k < mean.length; k++) mean[k] += p[k] / profile.power.length;
          return mean;
        })();
  const bins = N / 2 + 1;
  const out = new Float64Array(bins);
  if (profile.fftSize === N && profile.sampleRate === sampleRate) {
    for (let k = 0; k < bins; k++) out[k] = src[k];
    return out;
  }
  const scale = N / profile.fftSize; // per-bin power of a stationary signal grows with N
  for (let k = 0; k < bins; k++) {
    const freq = (k * sampleRate) / N;
    const pos = (freq * profile.fftSize) / profile.sampleRate;
    const i = Math.floor(pos);
    if (i >= src.length - 1) out[k] = src[src.length - 1] * scale;
    else out[k] = (src[i] + (src[i + 1] - src[i]) * (pos - i)) * scale;
  }
  return out;
}

export function reduceNoise(ch: Channels, sampleRate: number, profile: NoiseProfile, params: NoiseReductionParams, onProgress?: Progress): Channels {
  const n = channelLength(ch);
  if (!n || !profile.power.length) return ch;
  const N = profile.sampleRate === sampleRate ? profile.fftSize : noiseFftSize(sampleRate);
  const H = N / 4;
  const bins = N / 2 + 1;
  const fft = new RealFFT(N);
  const win = hannWindow(N);
  const ola = overlapAddGain(win, H);
  const floor = Math.pow(10, -Math.min(60, Math.max(0, params.reductionDb)) / 20);
  const alpha = 1 + Math.min(10, Math.max(0, params.sensitivity)) * 0.3;
  const radius = Math.round(Math.min(8, Math.max(0, params.freqSmoothing)));
  const hopSec = H / sampleRate;
  const cA = 1 - Math.exp(-hopSec / Math.max(0.0005, params.attackMs / 1000));
  const cR = 1 - Math.exp(-hopSec / Math.max(0.001, params.releaseMs / 1000));
  const frames = Math.ceil((n + N - H) / H);
  const frame = new Float64Array(N);
  const time = new Float64Array(N);
  const re = new Float64Array(bins);
  const im = new Float64Array(bins);
  const raw = new Float64Array(bins);
  const smooth = new Float64Array(bins);
  const gains = new Float64Array(bins);

  const acc = new Float64Array(N);
  const inv = 1 / ola;
  return ch.map((data, c) => {
    const noise = profileFor(profile, c, N, sampleRate);
    gains.fill(1);
    acc.fill(0);
    // Frame f reads data[start, start + N) and, once added, the first H accumulated samples
    // are final, so they are written back in place (later frames only read further on).
    for (let f = 0; f < frames; f++) {
      const start = f * H - (N - H);
      for (let i = 0; i < N; i++) {
        const idx = start + i;
        frame[i] = idx >= 0 && idx < n ? data[idx] * win[i] : 0;
      }
      fft.forward(frame, re, im);
      for (let k = 0; k < bins; k++) raw[k] = re[k] * re[k] + im[k] * im[k];
      // smooth the power over ±radius bins before deciding the gain: this lowers the
      // variance of noise-only bins (less "musical noise") without pulling down the gain
      // of tonal peaks (whose neighbours carry their main lobe)
      if (radius > 0) {
        let sum = 0;
        let cnt = 0;
        for (let k = 0; k <= Math.min(bins - 1, radius); k++) {
          sum += raw[k];
          cnt++;
        }
        for (let k = 0; k < bins; k++) {
          smooth[k] = Math.max(raw[k] * 0.5, sum / cnt);
          const add = k + radius + 1;
          const rem = k - radius;
          if (add < bins) {
            sum += raw[add];
            cnt++;
          }
          if (rem >= 0) {
            sum -= raw[rem];
            cnt--;
          }
        }
      } else smooth.set(raw);
      for (let k = 0; k < bins; k++) {
        const p = smooth[k];
        const g = p > 1e-20 ? 1 - (alpha * noise[k]) / p : 0;
        smooth[k] = g < 0 ? 0 : g;
      }
      for (let k = 0; k < bins; k++) {
        const target = smooth[k];
        const prev = gains[k];
        const g = target > prev ? prev + (target - prev) * cA : prev + (target - prev) * cR;
        gains[k] = g;
        const finalGain = floor + (1 - floor) * g;
        const applied = params.noiseOnly ? 1 - finalGain : finalGain;
        re[k] *= applied;
        im[k] *= applied;
      }
      fft.inverse(re, im, time);
      for (let i = 0; i < N; i++) acc[i] += time[i] * win[i];
      for (let i = 0; i < H; i++) {
        const idx = start + i;
        if (idx >= 0 && idx < n) data[idx] = acc[i] * inv;
      }
      acc.copyWithin(0, H);
      acc.fill(0, N - H);
      if (onProgress && f % 256 === 0) onProgress((c + f / frames) / ch.length);
    }
    return data;
  });
}
