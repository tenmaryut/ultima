/**
 * Biquad filters (RBJ Audio EQ Cookbook), parametric EQ, high/low-pass.
 */
import type { Channels } from './basic';

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking' | 'lowshelf' | 'highshelf';

export const BIQUAD_TYPES: BiquadType[] = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch'];

export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function clampFrequency(freq: number, sampleRate: number): number {
  return Math.min(sampleRate * 0.49, Math.max(10, freq));
}

/** Designs a biquad (coefficients normalised by a0). */
export function designBiquad(type: BiquadType, freq: number, sampleRate: number, q = Math.SQRT1_2, gainDb = 0): BiquadCoefs {
  const f = clampFrequency(freq, sampleRate);
  const Q = Math.max(0.05, q);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
    default: // peaking
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Filters `data` in place (transposed direct form II, double precision state). */
export function processBiquad(data: Float32Array, c: BiquadCoefs, state?: { z1: number; z2: number }): void {
  let z1 = state?.z1 ?? 0;
  let z2 = state?.z2 ?? 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    data[i] = y;
  }
  // flush denormals
  if (state) {
    state.z1 = Math.abs(z1) < 1e-25 ? 0 : z1;
    state.z2 = Math.abs(z2) < 1e-25 ? 0 : z2;
  }
}

/** Magnitude response (linear) of a biquad at `freq`. */
export function biquadMagnitude(c: BiquadCoefs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/* ------------------------------ Parametric EQ ------------------------------ */

export interface EqBand {
  type: BiquadType;
  freq: number;
  gain: number;
  q: number;
  enabled: boolean;
}

export const MAX_EQ_BANDS = 6;

export function bandUsesGain(type: BiquadType): boolean {
  return type === 'peaking' || type === 'lowshelf' || type === 'highshelf';
}

export function sanitizeEqBands(raw: unknown): EqBand[] {
  if (!Array.isArray(raw)) return [];
  const out: EqBand[] = [];
  for (const item of raw.slice(0, MAX_EQ_BANDS)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const type = BIQUAD_TYPES.includes(r.type as BiquadType) ? (r.type as BiquadType) : 'peaking';
    const num = (v: unknown, min: number, max: number, def: number) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    out.push({
      type,
      freq: num(r.freq ?? r.frequency, 20, 20000, 1000),
      gain: num(r.gain ?? r.gainDb, -24, 24, 0),
      q: num(r.q ?? r.Q, 0.1, 18, 1),
      enabled: r.enabled !== false,
    });
  }
  return out;
}

export function eqCoefficients(bands: EqBand[], sampleRate: number): BiquadCoefs[] {
  return bands
    .filter((b) => b.enabled && (bandUsesGain(b.type) ? Math.abs(b.gain) > 0.01 : true))
    .map((b) => designBiquad(b.type, b.freq, sampleRate, b.q, b.gain));
}

export function applyEq(ch: Channels, sampleRate: number, bands: EqBand[]): Channels {
  const coefs = eqCoefficients(bands, sampleRate);
  for (const data of ch) for (const c of coefs) processBiquad(data, c);
  return ch;
}

/** EQ magnitude response in dB at each frequency of `freqs`. */
export function eqResponseDb(bands: EqBand[], sampleRate: number, freqs: ArrayLike<number>): Float32Array {
  const coefs = eqCoefficients(bands, sampleRate);
  const out = new Float32Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    let mag = 1;
    for (const c of coefs) mag *= biquadMagnitude(c, freqs[i], sampleRate);
    out[i] = 20 * Math.log10(Math.max(1e-9, mag));
  }
  return out;
}

const band = (type: BiquadType, freq: number, gain = 0, q = 1): EqBand => ({ type, freq, gain, q, enabled: true });

export const EQ_PRESETS: { id: string; name: string; bands: EqBand[] }[] = [
  { id: 'flat', name: 'Flat', bands: [band('lowshelf', 100, 0, 0.7), band('peaking', 400), band('peaking', 1500), band('peaking', 4000), band('highshelf', 10000, 0, 0.7)] },
  { id: 'voice', name: 'Voice clarity', bands: [band('highpass', 80, 0, 0.7), band('peaking', 250, -3, 1.2), band('peaking', 3000, 3, 1), band('highshelf', 10000, 2, 0.7)] },
  { id: 'podcast', name: 'Podcast warmth', bands: [band('highpass', 70, 0, 0.7), band('lowshelf', 150, 2, 0.7), band('peaking', 400, -2.5, 1.4), band('peaking', 5000, 2, 0.9)] },
  { id: 'bass', name: 'Bass boost', bands: [band('lowshelf', 120, 6, 0.7)] },
  { id: 'treble', name: 'Treble boost', bands: [band('highshelf', 6000, 6, 0.7)] },
  { id: 'demud', name: 'Remove mud', bands: [band('peaking', 300, -5, 1.4)] },
  { id: 'air', name: 'Add air', bands: [band('highshelf', 12000, 4, 0.7)] },
  { id: 'telephone', name: 'Telephone', bands: [band('highpass', 400, 0, 0.9), band('lowpass', 3200, 0, 0.9), band('peaking', 1500, 4, 1)] },
  { id: 'radio', name: 'Old radio', bands: [band('highpass', 250, 0, 0.8), band('lowpass', 5000, 0, 0.8), band('peaking', 1200, 5, 0.8)] },
  { id: 'smile', name: 'Loudness (smile)', bands: [band('lowshelf', 100, 5, 0.7), band('peaking', 1000, -2, 0.8), band('highshelf', 8000, 4, 0.7)] },
  { id: 'deess', name: 'Soften sibilance', bands: [band('peaking', 6500, -6, 3)] },
  { id: 'hum', name: 'Remove hum (50/60 Hz)', bands: [band('notch', 50, 0, 8), band('notch', 60, 0, 8), band('notch', 100, 0, 8), band('notch', 120, 0, 8)] },
];

/* ------------------------------ High/Low pass ------------------------------ */

/** Butterworth Q values for cascaded 2nd-order sections. */
function butterworthQs(order: number): number[] {
  const sections = Math.max(1, Math.round(order / 2));
  const n = sections * 2;
  return Array.from({ length: sections }, (_, k) => 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * n))));
}

/** Butterworth high-pass or low-pass of order 2/4/6/8 (12–48 dB/octave). */
export function passFilter(ch: Channels, sampleRate: number, type: 'highpass' | 'lowpass', freq: number, order = 4): Channels {
  const coefs = butterworthQs(order).map((q) => designBiquad(type, freq, sampleRate, q));
  for (const data of ch) for (const c of coefs) processBiquad(data, c);
  return ch;
}
