import { describe, expect, it } from 'vitest';
import { FFT, RealFFT, hannWindow, overlapAddGain } from './fft';
import { applyGain, dbToGain, fade, fadeGain, gainToDb, normalizePeak, peakOf, removeDcOffset, reverse, toMono, toStereo, swapChannels, mixInto, concatChannels } from './basic';
import { applyEq, biquadMagnitude, designBiquad, eqResponseDb, passFilter, sanitizeEqBands } from './filters';
import { compress, compressorCurve, gate, limit } from './dynamics';
import { changeSpeed, echo, pitchShift, resample } from './time';
import { convolve, generateImpulseResponse, mulberry32, reverb } from './reverb';
import { captureNoiseProfile, estimateNoiseProfile, reduceNoise, DEFAULT_NR } from './noise';
import { StatsAccumulator, computeStats, detectSilence, integratedLoudness, silenceCutRanges } from './analysis';
import { generateDtmf, generateNoise, generateTone } from './generate';
import { defaultParams, resolveEffectId, runEffect, sanitizeParams } from './effects';

const SR = 16000;

function sine(freq: number, seconds: number, amp = 1, sr = SR, phase = 0): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr + phase);
  return out;
}

function rms(data: Float32Array, start = 0, end = data.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

function dominantFrequency(data: Float32Array, sr: number): number {
  let N = 1;
  while (N * 2 <= data.length && N < 65536) N *= 2;
  const fft = new RealFFT(N);
  const win = hannWindow(N);
  const frame = new Float64Array(N);
  const off = Math.floor((data.length - N) / 2);
  for (let i = 0; i < N; i++) frame[i] = data[off + i] * win[i];
  const re = new Float64Array(N / 2 + 1);
  const im = new Float64Array(N / 2 + 1);
  fft.forward(frame, re, im);
  let best = 1;
  let bestMag = 0;
  const mags = new Float64Array(N / 2 + 1);
  for (let k = 1; k < N / 2; k++) {
    mags[k] = Math.hypot(re[k], im[k]);
    if (mags[k] > bestMag) {
      bestMag = mags[k];
      best = k;
    }
  }
  const a = Math.log(mags[best - 1] + 1e-12);
  const b = Math.log(mags[best] + 1e-12);
  const c = Math.log(mags[best + 1] + 1e-12);
  const delta = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return ((best + delta) * sr) / N;
}

/** Amplitude of the `freq` component (least squares fit of sin + cos). */
function toneAmplitude(data: Float32Array, freq: number, sr: number, start: number, end: number): number {
  let ss = 0, sc = 0;
  for (let i = start; i < end; i++) {
    const w = (2 * Math.PI * freq * i) / sr;
    ss += data[i] * Math.sin(w);
    sc += data[i] * Math.cos(w);
  }
  const n = end - start;
  return (2 / n) * Math.hypot(ss, sc);
}

function whiteNoise(n: number, sigma: number, seed = 1): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    // Box-Muller
    const u1 = Math.max(1e-12, rnd());
    const u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1)) * sigma;
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

describe('FFT', () => {
  it('matches a naive DFT', () => {
    const N = 64;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    const x = Array.from({ length: N }, (_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7) + (i % 5) * 0.1);
    x.forEach((v, i) => (re[i] = v));
    new FFT(N).forward(re, im);
    for (let k = 0; k < N; k++) {
      let r = 0, j = 0;
      for (let n = 0; n < N; n++) {
        r += x[n] * Math.cos((-2 * Math.PI * k * n) / N);
        j += x[n] * Math.sin((-2 * Math.PI * k * n) / N);
      }
      expect(re[k]).toBeCloseTo(r, 8);
      expect(im[k]).toBeCloseTo(j, 8);
    }
  });

  it('real FFT agrees with the complex FFT and inverts exactly', () => {
    const N = 256;
    const x = Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.11) * Math.cos(i * 0.031) + ((i * 7919) % 13) / 13 - 0.5);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re.set(x);
    new FFT(N).forward(re, im);
    const rf = new RealFFT(N);
    const rr = new Float64Array(N / 2 + 1);
    const ri = new Float64Array(N / 2 + 1);
    rf.forward(x, rr, ri);
    for (let k = 0; k <= N / 2; k++) {
      expect(rr[k]).toBeCloseTo(re[k], 9);
      expect(ri[k]).toBeCloseTo(im[k], 9);
    }
    const back = new Float64Array(N);
    rf.inverse(rr, ri, back);
    for (let i = 0; i < N; i++) expect(back[i]).toBeCloseTo(x[i], 10);
  });

  it('Hann at 75% overlap sums to a constant', () => {
    expect(overlapAddGain(hannWindow(1024), 256)).toBeCloseTo(1.5, 6);
  });
});

describe('gain, normalize, fades', () => {
  it('converts dB', () => {
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(gainToDb(0.1)).toBeCloseTo(-20, 6);
  });

  it('amplifies and normalizes peaks', () => {
    const ch = [sine(440, 0.1, 0.25)];
    applyGain(ch, 6.0206);
    expect(peakOf(ch)).toBeCloseTo(0.5, 3);
    normalizePeak(ch, -1);
    expect(gainToDb(peakOf(ch))).toBeCloseTo(-1, 4);
    const quiet = [new Float32Array(100)];
    normalizePeak(quiet, 0);
    expect(peakOf(quiet)).toBe(0);
  });

  it('normalizes channels separately when asked', () => {
    const ch = [sine(440, 0.05, 0.1), sine(440, 0.05, 0.4)];
    normalizePeak(ch, 0, true);
    expect(peakOf([ch[0]])).toBeCloseTo(1, 3);
    expect(peakOf([ch[1]])).toBeCloseTo(1, 3);
  });

  it('normalizes loudness to a LUFS target', () => {
    const ch = [sine(997, 3, 0.05, 48000), sine(997, 3, 0.05, 48000)];
    const out = runEffect('normalize', ch, 48000, { ...defaultParams('normalize'), mode: 'loudness', lufs: -18 });
    expect(integratedLoudness(out, 48000)).toBeCloseTo(-18, 1);
  });

  it('fade curves start at 0 and end at 1, monotonic', () => {
    for (const curve of ['linear', 'log', 'exp', 'scurve'] as const) {
      expect(fadeGain(0, curve)).toBeCloseTo(0, 9);
      expect(fadeGain(1, curve)).toBeCloseTo(1, 9);
      let prev = -1;
      for (let t = 0; t <= 1; t += 0.05) {
        const g = fadeGain(t, curve);
        expect(g).toBeGreaterThanOrEqual(prev);
        prev = g;
      }
    }
    expect(fadeGain(0.5, 'log')).toBeGreaterThan(0.5);
    expect(fadeGain(0.5, 'exp')).toBeLessThan(0.5);
    expect(fadeGain(0.5, 'scurve')).toBeCloseTo(0.5, 6);
  });

  it('fades in and out', () => {
    const fin = fade([new Float32Array(101).fill(1)], 'in', 'linear')[0];
    expect(fin[0]).toBe(0);
    expect(fin[50]).toBeCloseTo(0.5, 5);
    expect(fin[100]).toBeCloseTo(1, 5);
    const fout = fade([new Float32Array(101).fill(1)], 'out', 'scurve')[0];
    expect(fout[0]).toBeCloseTo(1, 5);
    expect(fout[100]).toBeCloseTo(0, 5);
  });

  it('reverses, removes DC and converts channels', () => {
    expect(Array.from(reverse([Float32Array.from([1, 2, 3])])[0])).toEqual([3, 2, 1]);
    const dc = removeDcOffset([Float32Array.from([1.5, 0.5, 1, 1])])[0];
    expect(dc.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
    const mono = toMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
    expect(Array.from(mono[0])).toEqual([0.5, 0.5]);
    const stereo = toStereo([Float32Array.from([0.25])]);
    expect(stereo.length).toBe(2);
    expect(stereo[1][0]).toBe(0.25);
    const swapped = swapChannels([Float32Array.from([1]), Float32Array.from([2])]);
    expect(swapped[0][0]).toBe(2);
  });

  it('mixes and concatenates', () => {
    const target = [new Float32Array(4)];
    mixInto(target, [Float32Array.from([1, 1]), Float32Array.from([0, 0])], 1, 2);
    expect(Array.from(target[0])).toEqual([0, 1, 1, 0]);
    const joined = concatChannels([[Float32Array.from([1])], [Float32Array.from([2]), Float32Array.from([3])]]);
    expect(joined.length).toBe(2);
    expect(Array.from(joined[0])).toEqual([1, 2]);
    expect(Array.from(joined[1])).toEqual([1, 3]);
  });
});

describe('resampling and time', () => {
  it('resamples to the expected length and keeps the frequency', () => {
    const x = sine(1000, 1, 0.5, 44100);
    const y = resample(x, 48000 / 44100);
    expect(y.length).toBe(48000);
    expect(dominantFrequency(y, 48000)).toBeCloseTo(1000, 0);
    expect(rms(y, 1000, 47000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('keeps DC exactly and filters aliases when downsampling', () => {
    const dcOut = resample(new Float32Array(1000).fill(0.3), 0.37);
    for (let i = 0; i < dcOut.length; i++) expect(dcOut[i]).toBeCloseTo(0.3, 4);
    // 7 kHz tone cannot exist at 8 kHz sample rate: must be strongly attenuated
    const hi = resample(sine(7000, 0.5, 1, 32000), 0.25);
    expect(rms(hi, 100, hi.length - 100)).toBeLessThan(0.05);
  });

  it('changes speed (tape style)', () => {
    const x = [sine(500, 1, 0.5)];
    const y = changeSpeed(x, 2)[0];
    expect(y.length).toBe(SR / 2);
    expect(dominantFrequency(y, SR)).toBeCloseTo(1000, -1);
  });

  it('pitch shift keeps the duration and moves the frequency', () => {
    const x = [sine(440, 1.5, 0.5)];
    const up = pitchShift([x[0].slice()], SR, 12)[0];
    expect(up.length).toBe(x[0].length);
    expect(Math.abs(dominantFrequency(up, SR) - 880)).toBeLessThan(8);
    const down = pitchShift([x[0].slice()], SR, -5)[0];
    expect(Math.abs(dominantFrequency(down, SR) - 440 * Math.pow(2, -5 / 12))).toBeLessThan(6);
    // level is roughly preserved
    expect(rms(up, 2000, up.length - 2000)).toBeGreaterThan(0.25);
  });

  it('pitch shift keeps events aligned in time', () => {
    const n = SR * 2;
    const burst = new Float32Array(n);
    const tone = sine(600, 0.5, 0.5);
    burst.set(tone, SR); // tone from 1.0 s to 1.5 s
    const out = pitchShift([burst], SR, 7)[0];
    const win = SR / 20;
    const env = (data: Float32Array, at: number) => rms(data, at, at + win);
    // silent well before, loud in the middle, silent after
    expect(env(out, Math.round(0.5 * SR))).toBeLessThan(0.02);
    expect(env(out, Math.round(1.2 * SR))).toBeGreaterThan(0.2);
    expect(env(out, Math.round(1.75 * SR))).toBeLessThan(0.05);
  });

  it('echo adds a delayed, decaying copy', () => {
    const x = new Float32Array(SR);
    x[0] = 1;
    const y = echo([x], SR, { delayMs: 100, feedback: 0.5, mix: 1, pingPong: false })[0];
    const d = Math.round(0.1 * SR);
    expect(y[0]).toBe(1);
    expect(y[d]).toBeCloseTo(1, 6);
    expect(y[2 * d]).toBeCloseTo(0.5, 6);
    expect(y[3 * d]).toBeCloseTo(0.25, 6);
    expect(y[d + 5]).toBe(0);
  });
});

describe('filters', () => {
  it('peaking EQ has the requested gain at its centre', () => {
    const c = designBiquad('peaking', 1000, 48000, 1, 6);
    expect(20 * Math.log10(biquadMagnitude(c, 1000, 48000))).toBeCloseTo(6, 3);
    expect(20 * Math.log10(biquadMagnitude(c, 50, 48000))).toBeCloseTo(0, 1);
  });

  it('shelves reach their gain far from the corner', () => {
    const lo = designBiquad('lowshelf', 200, 48000, Math.SQRT1_2, 9);
    expect(20 * Math.log10(biquadMagnitude(lo, 20, 48000))).toBeCloseTo(9, 0);
    expect(20 * Math.log10(biquadMagnitude(lo, 10000, 48000))).toBeCloseTo(0, 1);
    const hi = designBiquad('highshelf', 4000, 48000, Math.SQRT1_2, -6);
    expect(20 * Math.log10(biquadMagnitude(hi, 20000, 48000))).toBeCloseTo(-6, 0);
  });

  it('Butterworth low-pass is -3 dB at the cut-off', () => {
    const c = designBiquad('lowpass', 2000, 48000, Math.SQRT1_2);
    expect(20 * Math.log10(biquadMagnitude(c, 2000, 48000))).toBeCloseTo(-3.01, 1);
    expect(biquadMagnitude(c, 0.0001, 48000)).toBeCloseTo(1, 4);
  });

  it('high-pass removes low tones in the time domain', () => {
    const low = [sine(50, 1, 0.5)];
    passFilter(low, SR, 'highpass', 400, 4);
    expect(rms(low[0], SR / 2)).toBeLessThan(0.01);
    const high = [sine(3000, 1, 0.5)];
    passFilter(high, SR, 'highpass', 400, 4);
    expect(rms(high[0], SR / 2)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('EQ response and processing agree', () => {
    const bands = sanitizeEqBands([{ type: 'peaking', freq: 1000, gain: -12, q: 2 }, { type: 'bogus', freq: 1e9, gain: 99 }]);
    expect(bands.length).toBe(2);
    expect(bands[1].type).toBe('peaking');
    expect(bands[1].freq).toBe(20000);
    expect(bands[1].gain).toBe(24);
    const resp = eqResponseDb([bands[0]], SR, [1000]);
    expect(resp[0]).toBeCloseTo(-12, 2);
    const x = [sine(1000, 1, 0.5)];
    applyEq(x, SR, [bands[0]]);
    expect(gainToDb(rms(x[0], SR / 2) / (0.5 / Math.SQRT2))).toBeCloseTo(-12, 0);
  });
});

describe('dynamics', () => {
  it('compressor curve', () => {
    expect(compressorCurve(-30, -20, 4, 0)).toBe(-30);
    expect(compressorCurve(-10, -20, 4, 0)).toBeCloseTo(-17.5, 6);
    expect(compressorCurve(-20, -20, 4, 6)).toBeLessThan(-20);
  });

  it('compressor reduces loud parts more than quiet parts', () => {
    const quiet = sine(500, 0.5, 0.05);
    const loud = sine(500, 0.5, 0.8);
    const sig = [concatChannels([[quiet], [loud]])[0]];
    compress(sig, SR, { thresholdDb: -20, ratio: 4, attackMs: 1, releaseMs: 50, kneeDb: 0, makeupDb: 0, autoMakeup: false });
    const q = rms(sig[0], 2000, 7000);
    const l = rms(sig[0], 10000, 15000);
    expect(gainToDb(q / (0.05 / Math.SQRT2))).toBeCloseTo(0, 0);
    expect(gainToDb(l / (0.8 / Math.SQRT2))).toBeLessThan(-8);
  });

  it('limiter never exceeds the ceiling', () => {
    const x = [sine(220, 1, 1.5), sine(330, 1, 0.9)];
    x[0][1234] = 3;
    limit(x, SR, { ceilingDb: -1, inputGainDb: 0, releaseMs: 50, lookaheadMs: 5 });
    expect(peakOf(x)).toBeLessThanOrEqual(dbToGain(-1) + 1e-6);
    expect(peakOf(x)).toBeGreaterThan(dbToGain(-2));
  });

  it('gate attenuates quiet passages', () => {
    const sig = concatChannels([[whiteNoise(SR, 0.001)], [sine(500, 1, 0.5)]]);
    gate(sig, SR, { thresholdDb: -30, attackMs: 1, holdMs: 20, releaseMs: 20, rangeDb: 40 });
    expect(rms(sig[0], 2000, 12000)).toBeLessThan(0.001 * 0.05);
    expect(rms(sig[0], SR + 2000, 2 * SR - 1000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });
});

describe('reverb', () => {
  it('generates a deterministic, decaying impulse response', () => {
    const a = generateImpulseResponse(SR, { roomSize: 0.5, decay: 1, damping: 0.5, mix: 0.3, preDelayMs: 10 });
    const b = generateImpulseResponse(SR, { roomSize: 0.5, decay: 1, damping: 0.5, mix: 0.3, preDelayMs: 10 });
    expect(Array.from(a[0].slice(0, 500))).toEqual(Array.from(b[0].slice(0, 500)));
    const early = rms(a[0], 0, SR / 10);
    const late = rms(a[0], Math.round(SR * 0.8), Math.round(SR * 0.9));
    expect(gainToDb(late / early)).toBeLessThan(-30);
  });

  it('FFT convolution equals direct convolution', () => {
    const sig = Float32Array.from({ length: 9000 }, (_, i) => Math.sin(i * 0.01) * ((i % 97) / 97));
    const ir = Float32Array.from({ length: 300 }, (_, i) => Math.exp(-i / 50) * (i % 2 ? -1 : 1));
    const fast = convolve(sig, ir);
    for (const idx of [0, 1, 299, 4096, 5000, 8191, 8999]) {
      let s = 0;
      for (let k = 0; k < ir.length && k <= idx; k++) s += ir[k] * sig[idx - k];
      expect(fast[idx]).toBeCloseTo(s, 4);
    }
  });

  it('keeps the length and adds a tail', () => {
    const x = new Float32Array(SR);
    x.set(sine(800, 0.1, 0.5));
    const y = reverb([x], SR, { roomSize: 0.6, decay: 1.5, damping: 0.4, mix: 0.5, preDelayMs: 0 })[0];
    expect(y.length).toBe(SR);
    expect(rms(y, Math.round(SR * 0.3), Math.round(SR * 0.4))).toBeGreaterThan(0.001);
  });
});

describe('noise reduction', () => {
  const n = SR * 3;
  const makeSignal = () => {
    const noise = whiteNoise(n, 0.05, 7);
    const tone = sine(1000, 2, 0.3);
    const x = noise.slice();
    for (let i = 0; i < tone.length; i++) x[SR + i] += tone[i];
    return x;
  };

  it('captures a profile and removes noise while keeping the tone', () => {
    const x = makeSignal();
    const profile = captureNoiseProfile([x.slice(0, Math.round(SR * 0.9))], SR);
    expect(profile.power[0].length).toBe(profile.fftSize / 2 + 1);
    const before = rms(x, Math.round(0.1 * SR), Math.round(0.8 * SR));
    const toneBefore = toneAmplitude(x, 1000, SR, Math.round(1.5 * SR), Math.round(2.5 * SR));
    const out = reduceNoise([x], SR, profile, { ...DEFAULT_NR, reductionDb: 24 })[0];
    const after = rms(out, Math.round(0.1 * SR), Math.round(0.8 * SR));
    expect(gainToDb(after / before)).toBeLessThan(-15);
    const toneAfter = toneAmplitude(out, 1000, SR, Math.round(1.5 * SR), Math.round(2.5 * SR));
    expect(Math.abs(gainToDb(toneAfter / toneBefore))).toBeLessThan(1);
    // residual noise around the tone is reduced too
    const residual = out.slice(Math.round(1.5 * SR), Math.round(2.5 * SR));
    for (let i = 0; i < residual.length; i++) residual[i] -= 0.3 * Math.sin((2 * Math.PI * 1000 * (i + Math.round(1.5 * SR) - SR)) / SR);
    expect(rms(residual)).toBeLessThan(0.05 * 0.5);
  });

  it('is transparent with 0 dB reduction', () => {
    const x = makeSignal();
    const profile = captureNoiseProfile([x.slice(0, SR)], SR);
    const out = reduceNoise([x.slice()], SR, profile, { ...DEFAULT_NR, reductionDb: 0 })[0];
    let maxErr = 0;
    for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - x[i]));
    expect(maxErr).toBeLessThan(1e-5);
  });

  it('outputs only the noise when asked', () => {
    const x = makeSignal();
    const profile = captureNoiseProfile([x.slice(0, SR)], SR);
    const noiseOnly = reduceNoise([x.slice()], SR, profile, { ...DEFAULT_NR, reductionDb: 40, noiseOnly: true })[0];
    // the tone is mostly absent from the "removed" signal
    expect(toneAmplitude(noiseOnly, 1000, SR, Math.round(1.5 * SR), Math.round(2.5 * SR))).toBeLessThan(0.05);
  });

  it('estimates a noise print from the quietest frames', () => {
    const x = makeSignal();
    const est = estimateNoiseProfile([x], SR);
    const cap = captureNoiseProfile([x.slice(0, SR)], SR);
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    const ratio = mean(est.power[0]) / mean(cap.power[0]);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(2.5);
  });
});

describe('analysis', () => {
  it('measures BS.1770 loudness of a stereo -20 dBFS sine as about -20 LUFS', () => {
    const l = sine(997, 5, 0.1, 48000);
    expect(integratedLoudness([l, l.slice()], 48000)).toBeCloseTo(-20, 0);
    expect(Math.abs(integratedLoudness([l, l.slice()], 48000) + 20)).toBeLessThan(0.3);
    expect(Math.abs(integratedLoudness([l.slice()], 48000) + 23.01)).toBeLessThan(0.3);
    expect(integratedLoudness([new Float32Array(48000 * 2)], 48000)).toBe(-Infinity);
  });

  it('accumulates statistics in chunks identically', () => {
    const data = [sine(300, 2, 0.5), sine(450, 2, 0.25)];
    data[0][100] = 1;
    const whole = computeStats(data, SR);
    const acc = new StatsAccumulator(2, SR);
    for (let s = 0; s < data[0].length; s += 3333) acc.push(data, s, Math.min(data[0].length, s + 3333));
    const chunked = acc.result();
    expect(chunked.peak).toBe(whole.peak);
    expect(chunked.loudness).toBeCloseTo(whole.loudness, 6);
    expect(whole.clipped).toBe(1);
    expect(whole.perChannel[0].rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(whole.perSecond.length).toBe(2);
  });

  it('detects silence and computes cut ranges with padding', () => {
    const x = concatChannels([[sine(400, 1, 0.5)], [new Float32Array(SR)], [sine(400, 0.5, 0.5)], [new Float32Array(SR / 4)]]);
    const ranges = detectSilence(x, SR, { thresholdDb: -40, minDuration: 0.5 });
    expect(ranges.length).toBe(1);
    expect(Math.abs(ranges[0].start - SR)).toBeLessThanOrEqual(SR * 0.011);
    expect(Math.abs(ranges[0].end - 2 * SR)).toBeLessThanOrEqual(SR * 0.011);
    const cuts = silenceCutRanges(ranges, SR, 0.1, x[0].length);
    expect(cuts[0].start).toBe(ranges[0].start + SR * 0.1);
    expect(cuts[0].end).toBe(ranges[0].end - SR * 0.1);
    const edge = silenceCutRanges([{ start: 0, end: 1000 }], SR, 0.01, 5000);
    expect(edge[0]).toEqual({ start: 0, end: 1000 - 160 });
  });
});

describe('generators', () => {
  it('generates tones at the requested frequency and level', () => {
    for (const waveform of ['sine', 'square', 'sawtooth', 'triangle'] as const) {
      const [t] = generateTone({ waveform, frequency: 440, amplitude: 0.5, duration: 1, sampleRate: SR, channels: 1 });
      expect(t.length).toBe(SR);
      expect(Math.abs(dominantFrequency(t, SR) - 440)).toBeLessThan(2);
      expect(peakOf([t])).toBeLessThanOrEqual(0.62);
      expect(peakOf([t])).toBeGreaterThan(0.4);
    }
  });

  it('generates noise and DTMF', () => {
    const noise = generateNoise({ color: 'pink', amplitude: 0.5, duration: 0.5, sampleRate: SR, channels: 2 });
    expect(noise.length).toBe(2);
    expect(peakOf(noise)).toBeCloseTo(0.5, 5);
    const dtmf = generateDtmf({ digits: '12x#', toneMs: 100, gapMs: 50, amplitude: 0.8, sampleRate: SR, channels: 1 });
    expect(dtmf[0].length).toBe(3 * Math.round(0.15 * SR));
  });
});

describe('effect registry', () => {
  it('resolves names and aliases', () => {
    expect(resolveEffectId('Amplify')).toBe('amplify');
    expect(resolveEffectId('noise_reduction')).toBe('noiseReduction');
    expect(resolveEffectId('denoise')).toBe('noiseReduction');
    expect(resolveEffectId('high-pass')).toBe('highpass');
    expect(resolveEffectId('unknownThing')).toBeNull();
    expect(resolveEffectId(42)).toBeNull();
  });

  it('clamps and defaults parameters', () => {
    const p = sanitizeParams('compressor', { thresholdDb: -500, ratio: '3', attackMs: 'x', autoMakeup: 'yes' });
    expect(p.thresholdDb).toBe(-60);
    expect(p.ratio).toBe(3);
    expect(p.attackMs).toBe(10);
    expect(p.autoMakeup).toBe(true);
    expect(sanitizeParams('highpass', { order: 8 }).order).toBe('8');
    expect(sanitizeParams('distortion', { type: 'nuclear' }).type).toBe('soft');
  });

  it('runs every effect without changing the length unexpectedly', () => {
    const ids = ['amplify', 'normalize', 'fadeIn', 'fadeOut', 'reverse', 'invert', 'pitch', 'eq', 'highpass', 'lowpass', 'compressor', 'limiter', 'gate', 'reverb', 'echo', 'distortion', 'swapChannels', 'dcOffset', 'noiseReduction', 'autoClean'] as const;
    for (const id of ids) {
      const ch = [sine(440, 0.5, 0.3), sine(660, 0.5, 0.3)];
      const out = runEffect(id, ch, SR, defaultParams(id));
      expect(out.length, id).toBe(2);
      expect(out[0].length, id).toBe(SR / 2);
      for (const c of out) for (let i = 0; i < c.length; i += 97) expect(Number.isFinite(c[i]), id).toBe(true);
    }
    expect(runEffect('stereoToMono', [sine(1, 0.1), sine(1, 0.1)], SR, {}).length).toBe(1);
    expect(runEffect('monoToStereo', [sine(1, 0.1)], SR, {}).length).toBe(2);
    expect(runEffect('speed', [sine(440, 1)], SR, { factor: 0.5 })[0].length).toBe(2 * SR);
  });
});
