/**
 * Algorithmic-IR convolution reverb: a deterministic impulse response (early reflections
 * + exponentially decaying, progressively darker noise tail) convolved with FFT
 * overlap-add. Same input + params always give the same output (preview == apply).
 */
import { RealFFT, nextPow2 } from './fft';
import { channelLength, dbToGain, type Channels } from './basic';
import type { Progress } from './time';

export interface ReverbParams {
  /** 0..1 — small room → large hall (pre-delay, reflection spacing). */
  roomSize: number;
  /** RT60 in seconds (0.1..10). */
  decay: number;
  /** 0..1 — high-frequency damping of the tail. */
  damping: number;
  /** 0..1 wet/dry mix. */
  mix: number;
  preDelayMs: number;
}

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateImpulseResponse(sampleRate: number, p: ReverbParams, channels = 2): Float32Array[] {
  const decay = Math.min(10, Math.max(0.1, p.decay));
  const size = Math.min(1, Math.max(0, p.roomSize));
  const damping = Math.min(1, Math.max(0, p.damping));
  const preDelay = Math.round((Math.min(200, Math.max(0, p.preDelayMs)) / 1000) * sampleRate);
  const tailLen = Math.round(Math.min(decay * 1.1, 10) * sampleRate);
  const length = preDelay + tailLen;
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const ir = new Float32Array(Math.max(1, length));
    const rnd = mulberry32(0x5eed + c * 7919);
    // late tail: noise × exponential decay (60 dB over `decay` seconds), low-passed more over time
    const k = Math.log(1000) / decay;
    let lp = 0;
    const fStart = 16000 - damping * 9000;
    const fEnd = Math.max(800, 6000 - damping * 5000);
    for (let i = 0; i < tailLen; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-k * t);
      const fc = fEnd + (fStart - fEnd) * Math.exp(-t * (1 + 4 * damping));
      const a = Math.exp((-2 * Math.PI * Math.min(fc, sampleRate * 0.45)) / sampleRate);
      const noise = rnd() * 2 - 1;
      lp = (1 - a) * noise + a * lp;
      // soft onset avoids a click at the start of the tail
      const onset = Math.min(1, i / (0.004 * sampleRate + 1));
      ir[preDelay + i] = lp * env * onset;
    }
    // early reflections: a few discrete taps spread over 5–80 ms depending on room size
    const taps = 10;
    const spread = (0.005 + size * 0.075) * sampleRate;
    for (let tIdx = 0; tIdx < taps; tIdx++) {
      const pos = preDelay + Math.round(((tIdx + rnd()) / taps) * spread);
      if (pos < ir.length) ir[pos] += (rnd() < 0.5 ? -1 : 1) * 0.6 * Math.pow(0.82, tIdx);
    }
    out.push(ir);
  }
  // normalise to unit energy (per channel average) so wet level ≈ dry level
  let energy = 0;
  for (const ir of out) for (let i = 0; i < ir.length; i++) energy += ir[i] * ir[i];
  const g = energy > 0 ? 1 / Math.sqrt(energy / out.length) : 1;
  for (const ir of out) for (let i = 0; i < ir.length; i++) ir[i] *= g;
  return out;
}

/**
 * Linear convolution of `signal` with `ir`, truncated to the signal length (FFT overlap-add).
 */
export function convolve(signal: Float32Array, ir: Float32Array, onProgress?: Progress): Float32Array {
  const n = signal.length;
  const m = ir.length;
  const out = new Float32Array(n);
  if (!n || !m) return out;
  const block = nextPow2(Math.max(m, 4096));
  const size = block * 2;
  const fft = new RealFFT(size);
  const bins = size / 2 + 1;
  const hRe = new Float64Array(bins);
  const hIm = new Float64Array(bins);
  fft.forward(ir, hRe, hIm, m);
  const re = new Float64Array(bins);
  const im = new Float64Array(bins);
  const time = new Float64Array(size);
  const blocks = Math.ceil(n / block);
  for (let b = 0; b < blocks; b++) {
    const start = b * block;
    const len = Math.min(block, n - start);
    fft.forward(signal.subarray(start, start + len), re, im, len);
    for (let k = 0; k < bins; k++) {
      const r = re[k] * hRe[k] - im[k] * hIm[k];
      const ii = re[k] * hIm[k] + im[k] * hRe[k];
      re[k] = r;
      im[k] = ii;
    }
    fft.inverse(re, im, time);
    const end = Math.min(n, start + size);
    for (let i = start; i < end; i++) out[i] += time[i - start];
    if (onProgress) onProgress((b + 1) / blocks);
  }
  return out;
}

export function reverb(ch: Channels, sampleRate: number, p: ReverbParams, onProgress?: Progress): Channels {
  const n = channelLength(ch);
  if (!n) return ch;
  const ir = generateImpulseResponse(sampleRate, p, Math.max(1, Math.min(2, ch.length)));
  const mix = Math.min(1, Math.max(0, p.mix));
  // equal-power style crossfade keeps the perceived level steady
  const dryGain = Math.cos((mix * Math.PI) / 2);
  const wetGain = Math.sin((mix * Math.PI) / 2) * dbToGain(-3);
  return ch.map((c, i) => {
    const wet = convolve(c, ir[Math.min(i, ir.length - 1)], onProgress ? (f) => onProgress((i + f) / ch.length) : undefined);
    for (let j = 0; j < n; j++) wet[j] = c[j] * dryGain + wet[j] * wetGain;
    return wet;
  });
}
