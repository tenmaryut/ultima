/**
 * Basic sample-level operations. Functions take planar channel data
 * (`Float32Array[]`, one array per channel). Unless documented otherwise they MAY
 * modify their input in place and return the result — callers pass copies.
 */

export type Channels = Float32Array[];

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function channelLength(ch: Channels): number {
  return ch[0]?.length ?? 0;
}

export function cloneChannels(ch: Channels): Channels {
  return ch.map((c) => c.slice());
}

export function sliceChannels(ch: Channels, start: number, end: number): Channels {
  return ch.map((c) => c.slice(start, end));
}

/** Silence: `channels` arrays of `length` zeros. */
export function silence(channels: number, length: number): Channels {
  return Array.from({ length: Math.max(1, channels) }, () => new Float32Array(Math.max(0, Math.round(length))));
}

export function applyGain(ch: Channels, gainDb: number): Channels {
  const g = dbToGain(gainDb);
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g;
  return ch;
}

/** Largest absolute sample value over all channels. */
export function peakOf(ch: Channels): number {
  let peak = 0;
  for (const c of ch) {
    for (let i = 0; i < c.length; i++) {
      const v = c[i] < 0 ? -c[i] : c[i];
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Scales so the peak equals `targetDb` dBFS. Silent input is returned unchanged. */
export function normalizePeak(ch: Channels, targetDb: number, perChannel = false): Channels {
  const target = dbToGain(targetDb);
  if (perChannel) {
    for (const c of ch) {
      const p = peakOf([c]);
      if (p > 1e-9) {
        const g = target / p;
        for (let i = 0; i < c.length; i++) c[i] *= g;
      }
    }
    return ch;
  }
  const peak = peakOf(ch);
  if (peak < 1e-9) return ch;
  const g = target / peak;
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g;
  return ch;
}

export type FadeCurve = 'linear' | 'log' | 'exp' | 'scurve';

export const FADE_CURVES: FadeCurve[] = ['linear', 'log', 'exp', 'scurve'];

/** Fade-in gain at position t ∈ [0, 1] for the given curve (0 → silent, 1 → unity). */
export function fadeGain(t: number, curve: FadeCurve): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  switch (curve) {
    case 'log': // fast rise, slow finish (convex)
      return Math.log1p(20 * x) / Math.log1p(20);
    case 'exp': // slow rise, fast finish (concave)
      return (Math.exp(4 * x) - 1) / (Math.exp(4) - 1);
    case 'scurve':
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    default:
      return x;
  }
}

/** Fades the whole input in or out. */
export function fade(ch: Channels, direction: 'in' | 'out', curve: FadeCurve = 'linear'): Channels {
  const n = channelLength(ch);
  if (n === 0) return ch;
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const t = i / denom;
    const g = fadeGain(direction === 'in' ? t : 1 - t, curve);
    for (const c of ch) c[i] *= g;
  }
  return ch;
}

export function reverse(ch: Channels): Channels {
  for (const c of ch) c.reverse();
  return ch;
}

export function invert(ch: Channels): Channels {
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i] = -c[i];
  return ch;
}

/** Removes the DC offset (mean value) of every channel. */
export function removeDcOffset(ch: Channels): Channels {
  for (const c of ch) {
    if (!c.length) continue;
    let sum = 0;
    for (let i = 0; i < c.length; i++) sum += c[i];
    const mean = sum / c.length;
    for (let i = 0; i < c.length; i++) c[i] -= mean;
  }
  return ch;
}

/** Averages all channels into one. Returns a new single-channel array. */
export function toMono(ch: Channels): Channels {
  if (ch.length <= 1) return ch;
  const n = channelLength(ch);
  const out = new Float32Array(n);
  const k = 1 / ch.length;
  for (const c of ch) for (let i = 0; i < n; i++) out[i] += c[i] * k;
  return [out];
}

/** Duplicates a mono channel into stereo (stereo input is returned as is). */
export function toStereo(ch: Channels): Channels {
  if (ch.length >= 2) return ch;
  const src = ch[0] ?? new Float32Array(0);
  return [src, src.slice()];
}

export function swapChannels(ch: Channels): Channels {
  if (ch.length < 2) return ch;
  return [ch[1], ch[0], ...ch.slice(2)];
}

/** Converts channel layout to `count` channels (mono↔stereo); more channels are averaged. */
export function matchChannelCount(ch: Channels, count: number): Channels {
  if (ch.length === count) return ch;
  if (count === 1) return toMono(ch);
  if (ch.length === 1) return Array.from({ length: count }, (_, i) => (i === 0 ? ch[0] : ch[0].slice()));
  // e.g. 6 → 2: average into the requested number of channels
  const mono = toMono(ch)[0];
  return Array.from({ length: count }, (_, i) => (i === 0 ? mono : mono.slice()));
}

/** Adds `source` (gain applied) into `target` starting at `offset`. Target is modified. */
export function mixInto(target: Channels, source: Channels, offset: number, gain = 1): void {
  const src = matchChannelCount(source, target.length);
  for (let c = 0; c < target.length; c++) {
    const t = target[c];
    const s = src[c];
    const end = Math.min(t.length, offset + s.length);
    for (let i = Math.max(0, offset); i < end; i++) t[i] += s[i - offset] * gain;
  }
}

/** Concatenates channel data. */
export function concatChannels(parts: Channels[]): Channels {
  const count = Math.max(...parts.map((p) => p.length));
  const total = parts.reduce((s, p) => s + channelLength(p), 0);
  const out = Array.from({ length: count }, () => new Float32Array(total));
  let pos = 0;
  for (const p of parts) {
    const matched = matchChannelCount(p, count);
    for (let c = 0; c < count; c++) out[c].set(matched[c], pos);
    pos += channelLength(p);
  }
  return out;
}

export type DistortionType = 'soft' | 'hard' | 'fuzz';

/** Waveshaping distortion with drive (dB), output mix and a post low-pass "tone". */
export function distortion(
  ch: Channels,
  sampleRate: number,
  params: { driveDb: number; mix: number; type: DistortionType; toneHz: number; outputDb: number },
): Channels {
  const drive = dbToGain(params.driveDb);
  const mix = Math.min(1, Math.max(0, params.mix));
  const out = dbToGain(params.outputDb);
  const bias = 0.4;
  const softNorm = 1 / Math.tanh(drive);
  const fuzzNorm = 1 / (Math.tanh(drive + bias) - Math.tanh(bias));
  // one-pole low-pass for tone, one-pole high-pass (DC blocker) for the asymmetric fuzz
  const fc = Math.min(sampleRate * 0.45, Math.max(200, params.toneHz));
  const a = Math.exp((-2 * Math.PI * fc) / sampleRate);
  const r = Math.exp((-2 * Math.PI * 10) / sampleRate);
  for (const c of ch) {
    let lp = 0;
    let dcIn = 0;
    let dcOut = 0;
    for (let i = 0; i < c.length; i++) {
      const x = c[i];
      const d = x * drive;
      let y: number;
      if (params.type === 'hard') y = d > 1 ? 1 : d < -1 ? -1 : d;
      else if (params.type === 'fuzz') {
        // biased (asymmetric) clipping adds even harmonics; remove the resulting DC
        const s = (Math.tanh(d + bias) - Math.tanh(bias)) * fuzzNorm;
        dcOut = s - dcIn + r * dcOut;
        dcIn = s;
        y = Math.max(-1, Math.min(1, dcOut));
      } else y = Math.tanh(d) * softNorm;
      lp = (1 - a) * y + a * lp;
      c[i] = (x * (1 - mix) + lp * mix) * out;
    }
  }
  return ch;
}
