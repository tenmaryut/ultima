import { FFT } from '../audio/dsp/fft';

/*
 * Content analysis for the AI assistant (pure, unit tested): tempo and beats of music, loud
 * moments of game or action footage, rises in energy (drops) and scene changes. All times are
 * seconds in the source media.
 */

export interface BeatInfo {
  bpm: number;
  /** Seconds between beats. */
  period: number;
  beats: number[];
  /** Beats that likely start a bar (every 4th beat, phase picked by the strongest low end). */
  downbeats: number[];
  /** 0..1 — how clearly the audio has a steady beat. */
  confidence: number;
}

export interface LoudMoment {
  time: number;
  /** Level of the moment (dBFS). */
  db: number;
  /** How far it sticks out above its surroundings (dB). */
  prominence: number;
}

export interface Burst {
  start: number;
  end: number;
  count: number;
}

export interface AudioAnalysis {
  duration: number;
  beats: BeatInfo | null;
  /** Strongest onsets (drum hits, impacts), in time order. */
  hits: number[];
  loud: LoudMoment[];
  /** Clusters of loud moments close together (shoot-outs, fights, fast action). */
  bursts: Burst[];
  /** Times where the sound gets clearly louder for a while (drops, choruses, action starting). */
  rises: number[];
  /** Loudness over time (RMS dB, `rate` values per second) — for ducking. */
  envelope: { rate: number; db: Float32Array };
}

export function monoMix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Halves the sample rate (simple averaging low-pass) until it is at most `maxRate`. */
function decimate(samples: Float32Array, sampleRate: number, maxRate = 24000): { samples: Float32Array; sampleRate: number } {
  let s = samples;
  let sr = sampleRate;
  while (sr > maxRate) {
    const out = new Float32Array(Math.floor(s.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * (s[2 * i] + s[2 * i + 1]);
    s = out;
    sr /= 2;
  }
  return { samples: s, sampleRate: sr };
}

/**
 * Spectral-flux onset strength, `fps` values per second, plus the low-band (kick) part.
 * `latency`: seconds to add to frame times (a sound shows up when it enters the analysis window).
 */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): { env: Float32Array; low: Float32Array; fps: number; latency: number } {
  const d = decimate(samples, sampleRate);
  const size = 1024;
  const hop = 256;
  const fps = d.sampleRate / hop;
  const frames = Math.max(0, Math.floor((d.samples.length - size) / hop) + 1);
  const env = new Float32Array(frames);
  const low = new Float32Array(frames);
  const latency = (size * 0.7) / d.sampleRate;
  if (!frames) return { env, low, fps, latency };
  const fft = new FFT(size);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const bins = size / 2;
  const lowBins = Math.max(2, Math.round((150 / d.sampleRate) * size));
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = d.samples[off + i] * win[i];
      im[i] = 0;
    }
    fft.forward(re, im);
    let flux = 0;
    let lowFlux = 0;
    for (let k = 1; k < bins; k++) {
      const mag = Math.log1p(100 * Math.hypot(re[k], im[k]));
      cur[k] = mag;
      const diff = mag - prev[k];
      if (diff > 0) {
        flux += diff;
        if (k <= lowBins) lowFlux += diff;
      }
    }
    env[f] = f ? flux : 0;
    low[f] = f ? lowFlux : 0;
    [prev, cur] = [cur, prev];
  }
  // remove the slowly changing part and normalise, so only sudden changes count
  const span = Math.max(1, Math.round(fps * 0.5));
  const out = new Float32Array(frames);
  let sum = 0;
  for (let i = 0; i < frames; i++) {
    sum += env[i];
    if (i > 2 * span) sum -= env[i - 2 * span - 1];
    const mean = sum / Math.min(i + 1, 2 * span + 1);
    out[i] = Math.max(0, env[i] - mean);
  }
  let max = 0;
  for (const v of out) max = Math.max(max, v);
  if (max > 0) for (let i = 0; i < frames; i++) out[i] /= max;
  let lowMax = 0;
  for (const v of low) lowMax = Math.max(lowMax, v);
  if (lowMax > 0) for (let i = 0; i < frames; i++) low[i] /= lowMax;
  return { env: out, low, fps, latency };
}

/** Tempo from the autocorrelation of the onset envelope (prefers 80–160 BPM). */
export function estimateTempo(env: Float32Array, fps: number, minBpm = 60, maxBpm = 200): { bpm: number; confidence: number } | null {
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * fps));
  const maxLag = Math.min(env.length - 1, Math.ceil((60 / minBpm) * fps));
  if (maxLag <= minLag + 2 || env.length < fps * 4) return null;
  // correlation of the mean-free envelope: noise gives ~0, a steady beat a clear peak
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const x = Float64Array.from(env, (v) => v - mean);
  let energy = 0;
  for (const v of x) energy += v * v;
  if (energy <= 0) return null;
  const acf = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
    acf[lag] = s / energy;
  }
  let best = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (!(acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1])) continue;
    const bpm = (60 * fps) / lag;
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = acf[lag] * weight;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0) return null;
  // parabolic refinement of the peak
  const a = acf[best - 1];
  const b = acf[best];
  const c = acf[best + 1];
  const denom = a - 2 * b + c;
  const shift = denom ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const bpm = (60 * fps) / (best + shift);
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.max(0, Math.min(1, b)) };
}

/** Beat positions (seconds) by dynamic programming over the onset envelope (Ellis 2007). */
export function trackBeats(env: Float32Array, fps: number, bpm: number): number[] {
  const period = (60 / bpm) * fps;
  const n = env.length;
  if (!n || period < 2) return [];
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const tightness = 100;
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    const from = Math.max(0, Math.round(t - 2 * period));
    const to = Math.round(t - period / 2);
    for (let tau = from; tau <= to; tau++) {
      const x = Math.log((t - tau) / period);
      const s = score[tau] - tightness * x * x;
      if (s > best || arg < 0) {
        best = s;
        arg = tau;
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // start from the best score in the last beat period
  let t = n - 1;
  for (let i = Math.max(0, Math.floor(n - period)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t / fps);
    t = back[t];
  }
  return beats.reverse();
}

/** Peaks of an envelope above mean + k·std, at least `minGap` seconds apart, strongest first. */
export function pickPeaks(env: Float32Array, fps: number, k = 1.5, minGap = 0.12): { time: number; value: number }[] {
  let mean = 0;
  for (const v of env) mean += v;
  mean /= Math.max(1, env.length);
  let varSum = 0;
  for (const v of env) varSum += (v - mean) ** 2;
  const std = Math.sqrt(varSum / Math.max(1, env.length));
  const thr = mean + k * std;
  const peaks: { time: number; value: number }[] = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > thr && env[i] >= env[i - 1] && env[i] > env[i + 1]) peaks.push({ time: i / fps, value: env[i] });
  }
  peaks.sort((a, b) => b.value - a.value);
  const kept: { time: number; value: number }[] = [];
  for (const p of peaks) if (kept.every((q) => Math.abs(q.time - p.time) >= minGap)) kept.push(p);
  return kept;
}

/** RMS level (dBFS) per window. */
export function levels(samples: Float32Array, sampleRate: number, window = 0.01): { db: Float32Array; rate: number } {
  const size = Math.max(1, Math.round(sampleRate * window));
  const count = Math.floor(samples.length / size);
  const db = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    let sum = 0;
    for (let i = w * size; i < (w + 1) * size; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / size);
    db[w] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  }
  return { db, rate: sampleRate / size };
}

function median(values: number[]): number {
  if (!values.length) return -120;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Moments that are much louder than the sound around them (gunshots, kills, impacts, cheers):
 * 10 ms levels compared with the median of the surrounding 3 s.
 */
export function loudMoments(samples: Float32Array, sampleRate: number, opts: { minProminence?: number; minGap?: number; max?: number } = {}): LoudMoment[] {
  const minProminence = opts.minProminence ?? 9;
  const minGap = opts.minGap ?? 0.2;
  const { db, rate } = levels(samples, sampleRate, 0.01);
  const half = Math.round(rate * 1.5);
  const step = Math.max(1, Math.round(rate * 0.25));
  // baseline: median level in a sliding 3 s window, sampled every 0.25 s
  const base = new Float32Array(db.length);
  for (let i = 0; i < db.length; i += step) {
    const m = median(Array.from(db.subarray(Math.max(0, i - half), Math.min(db.length, i + half))));
    for (let j = i; j < Math.min(db.length, i + step); j++) base[j] = m;
  }
  const found: LoudMoment[] = [];
  for (let i = 1; i < db.length - 1; i++) {
    if (db[i] < -45 || db[i] < db[i - 1] || db[i] < db[i + 1]) continue;
    const prominence = db[i] - Math.max(base[i], -70);
    if (prominence >= minProminence) found.push({ time: i / rate, db: Math.round(db[i] * 10) / 10, prominence: Math.round(prominence * 10) / 10 });
  }
  found.sort((a, b) => b.prominence - a.prominence || b.db - a.db);
  const kept: LoudMoment[] = [];
  for (const m of found) {
    if (kept.every((k) => Math.abs(k.time - m.time) >= minGap)) kept.push(m);
    if (kept.length >= (opts.max ?? 40)) break;
  }
  return kept.sort((a, b) => a.time - b.time);
}

/** Groups loud moments that follow each other within `gap` seconds; only groups of `minCount` or more. */
export function burstsOf(moments: LoudMoment[], gap = 0.8, minCount = 3): Burst[] {
  const out: Burst[] = [];
  let cur: Burst | null = null;
  for (const m of [...moments].sort((a, b) => a.time - b.time)) {
    if (cur && m.time - cur.end <= gap) {
      cur.end = m.time;
      cur.count++;
    } else {
      if (cur && cur.count >= minCount) out.push(cur);
      cur = { start: m.time, end: m.time, count: 1 };
    }
  }
  if (cur && cur.count >= minCount) out.push(cur);
  return out;
}

/**
 * Times where the typical (median) level over the next `span` seconds is `minRise` dB above the
 * previous `span` — sustained changes like a drop, not single bangs.
 */
export function energyRises(samples: Float32Array, sampleRate: number, span = 4, minRise = 6): number[] {
  const { db, rate } = levels(samples, sampleRate, 0.5);
  const w = Math.max(1, Math.round(span * rate));
  const avg = (from: number, to: number) => median(Array.from(db.subarray(from, to)));
  const rises: { time: number; gain: number }[] = [];
  for (let i = w; i + w <= db.length; i++) {
    const gain = avg(i, i + w) - avg(i - w, i);
    if (gain >= minRise) rises.push({ time: i / rate, gain });
  }
  // keep the strongest point of each run of rises
  const kept: number[] = [];
  let best: { time: number; gain: number } | null = null;
  for (const r of rises) {
    if (best && r.time - best.time > span) {
      kept.push(best.time);
      best = null;
    }
    if (!best || r.gain > best.gain) best = r;
  }
  if (best) kept.push(best.time);
  return kept;
}

/** Everything the AI gets to know about one audio track. */
export function analyzeAudio(channels: Float32Array[], sampleRate: number): AudioAnalysis {
  const mono = monoMix(channels);
  const duration = mono.length / sampleRate;
  const { env, low, fps, latency } = onsetEnvelope(mono, sampleRate);
  const at = (t: number) => Math.round((t + latency) * 1000) / 1000;
  const tempo = estimateTempo(env, fps);
  let beats: BeatInfo | null = null;
  // a real beat has an onset on most beat positions (sparse sounds like a few shots don't)
  const support = (times: number[]) => {
    if (!times.length) return 0;
    let hit = 0;
    for (const t of times) {
      const i = Math.round(t * fps);
      let m = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) m = Math.max(m, env[k]);
      if (m > 0.08) hit++;
    }
    return hit / times.length;
  };
  const tracked = tempo && tempo.confidence >= 0.15 ? trackBeats(env, fps, tempo.bpm) : [];
  if (tempo && tracked.length >= 8 && support(tracked) >= 0.6) {
    const times = tracked;
    // bar phase: the one of four offsets whose beats carry the most low-end
    let phase = 0;
    let bestLow = -1;
    for (let p = 0; p < 4; p++) {
      let s = 0;
      for (let i = p; i < times.length; i += 4) s += low[Math.min(low.length - 1, Math.round(times[i] * fps))] ?? 0;
      if (s > bestLow) {
        bestLow = s;
        phase = p;
      }
    }
    beats = {
      bpm: tempo.bpm,
      period: 60 / tempo.bpm,
      beats: times.map(at),
      downbeats: times.filter((_, i) => i % 4 === phase).map(at),
      confidence: Math.round(tempo.confidence * 100) / 100,
    };
  }
  // accents only mean something on top of a beat; without one the loud moments say it better
  const hits = beats
    ? pickPeaks(env, fps, 2, 0.15)
        .slice(0, 24)
        .map((p) => at(p.time))
        .sort((a, b) => a - b)
    : [];
  const loud = loudMoments(mono, sampleRate);
  const envelope = levels(mono, sampleRate, 0.05);
  return { duration, beats, hits, loud, bursts: burstsOf(loud), rises: energyRises(mono, sampleRate).map((t) => Math.round(t * 100) / 100), envelope };
}

/* ------------------------------- Scene changes ------------------------------ */

/** Mean absolute luma difference of two RGBA images of the same size, 0..1. */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    sum += Math.abs(la - lb);
  }
  return sum / (n / 4) / 255;
}

/**
 * Cuts between frames sampled at `times`: differences well above the typical difference
 * (and above `minDiff`). `diffs[i]` compares frame i with frame i + 1.
 */
export function sceneCuts(diffs: number[], times: number[], minDiff = 0.12): number[] {
  if (!diffs.length) return [];
  const sorted = [...diffs].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const thr = Math.max(minDiff, typical * 3);
  const cuts: number[] = [];
  diffs.forEach((d, i) => {
    if (d >= thr && (i === 0 || d >= diffs[i - 1]) && (i === diffs.length - 1 || d >= diffs[i + 1])) cuts.push(Math.round(((times[i] + times[i + 1]) / 2) * 100) / 100);
  });
  return cuts;
}

/** How busy the picture is per sample (0..1), e.g. for finding the most active moments. */
export function busiest(diffs: number[], times: number[], count = 5): number[] {
  return diffs
    .map((d, i) => ({ d, t: (times[i] + times[i + 1]) / 2 }))
    .sort((a, b) => b.d - a.d)
    .slice(0, count)
    .map((x) => Math.round(x.t * 100) / 100)
    .sort((a, b) => a - b);
}
