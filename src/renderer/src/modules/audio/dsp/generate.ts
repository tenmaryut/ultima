/**
 * Signal generators: tones (band-limited square/saw via PolyBLEP), coloured noise,
 * DTMF and silence.
 */
import { mulberry32 } from './reverb';
import type { Channels } from './basic';

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';
export const WAVEFORMS: Waveform[] = ['sine', 'square', 'sawtooth', 'triangle'];
export type NoiseColor = 'white' | 'pink' | 'brown';
export const NOISE_COLORS: NoiseColor[] = ['white', 'pink', 'brown'];

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export interface ToneOptions {
  waveform: Waveform;
  frequency: number;
  /** Linear peak amplitude 0..1 */
  amplitude: number;
  duration: number;
  sampleRate: number;
  channels: number;
  /** Optional end frequency for a sweep (chirp). */
  endFrequency?: number;
}

export function generateTone(o: ToneOptions): Channels {
  const n = Math.max(0, Math.round(o.duration * o.sampleRate));
  const data = new Float32Array(n);
  const nyq = o.sampleRate / 2;
  const f0 = Math.min(nyq * 0.98, Math.max(1, o.frequency));
  const f1 = o.endFrequency ? Math.min(nyq * 0.98, Math.max(1, o.endFrequency)) : f0;
  const amp = Math.min(1, Math.max(0, o.amplitude));
  let phase = 0; // 0..1
  let tri = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 === f1 ? f0 : f0 * Math.pow(f1 / f0, i / Math.max(1, n - 1));
    const dt = f / o.sampleRate;
    let v: number;
    switch (o.waveform) {
      case 'square': {
        v = phase < 0.5 ? 1 : -1;
        v += polyBlep(phase, dt);
        v -= polyBlep((phase + 0.5) % 1, dt);
        break;
      }
      case 'sawtooth':
        v = 2 * phase - 1 - polyBlep(phase, dt);
        break;
      case 'triangle': {
        // leaky integration of a band-limited square
        let sq = phase < 0.5 ? 1 : -1;
        sq += polyBlep(phase, dt);
        sq -= polyBlep((phase + 0.5) % 1, dt);
        tri = dt * sq * 4 + (1 - dt * 0.05) * tri;
        v = tri;
        break;
      }
      default:
        v = Math.sin(2 * Math.PI * phase);
    }
    data[i] = v * amp;
    phase += dt;
    if (phase >= 1) phase -= 1;
  }
  if (o.waveform === 'triangle' && n) {
    // remove the integrator's start-up offset and normalise the peak
    let peak = 0;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += data[i];
    mean /= n;
    for (let i = 0; i < n; i++) {
      data[i] -= mean;
      peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak > 0) for (let i = 0; i < n; i++) data[i] *= amp / peak;
  }
  return Array.from({ length: Math.max(1, o.channels) }, (_, c) => (c === 0 ? data : data.slice()));
}

export interface NoiseOptions {
  color: NoiseColor;
  amplitude: number;
  duration: number;
  sampleRate: number;
  channels: number;
  seed?: number;
}

export function generateNoise(o: NoiseOptions): Channels {
  const n = Math.max(0, Math.round(o.duration * o.sampleRate));
  const amp = Math.min(1, Math.max(0, o.amplitude));
  return Array.from({ length: Math.max(1, o.channels) }, (_, c) => {
    const rnd = mulberry32((o.seed ?? 12345) + c * 104729);
    const data = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let brown = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const white = rnd() * 2 - 1;
      let v: number;
      if (o.color === 'pink') {
        // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
      } else if (o.color === 'brown') {
        brown = (brown + 0.02 * white) / 1.02;
        v = brown;
      } else v = white;
      data[i] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const g = peak > 0 ? amp / peak : 0;
    for (let i = 0; i < n; i++) data[i] *= g;
    return data;
  });
}

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], A: [697, 1633],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477], B: [770, 1633],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], C: [852, 1633],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477], D: [941, 1633],
};

export function sanitizeDtmf(digits: string): string {
  return digits.toUpperCase().split('').filter((d) => d in DTMF).join('').slice(0, 64);
}

export interface DtmfOptions {
  digits: string;
  toneMs: number;
  gapMs: number;
  amplitude: number;
  sampleRate: number;
  channels: number;
}

export function generateDtmf(o: DtmfOptions): Channels {
  const digits = sanitizeDtmf(o.digits);
  const tone = Math.max(1, Math.round((o.toneMs / 1000) * o.sampleRate));
  const gap = Math.max(0, Math.round((o.gapMs / 1000) * o.sampleRate));
  const n = digits.length * (tone + gap);
  const data = new Float32Array(n);
  const amp = Math.min(1, Math.max(0, o.amplitude)) / 2;
  const ramp = Math.min(tone / 2, Math.round(0.003 * o.sampleRate));
  digits.split('').forEach((d, idx) => {
    const [lo, hi] = DTMF[d];
    const off = idx * (tone + gap);
    for (let i = 0; i < tone; i++) {
      const t = i / o.sampleRate;
      const env = Math.min(1, i / (ramp || 1), (tone - 1 - i) / (ramp || 1));
      data[off + i] = amp * env * (Math.sin(2 * Math.PI * lo * t) + Math.sin(2 * Math.PI * hi * t));
    }
  });
  return Array.from({ length: Math.max(1, o.channels) }, (_, c) => (c === 0 ? data : data.slice()));
}
