/**
 * Dynamics processors: compressor, look-ahead brickwall limiter, noise gate.
 * All are stereo-linked (one gain for all channels) and process in place.
 */
import { channelLength, dbToGain, type Channels } from './basic';

const coef = (ms: number, sampleRate: number) => (ms <= 0 ? 0 : Math.exp(-1 / ((ms / 1000) * sampleRate)));

export interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
  /** When true, makeup gain is computed from threshold/ratio and `makeupDb` is added on top. */
  autoMakeup: boolean;
}

/** Static gain-computer curve (output level in dB for an input level in dB). */
export function compressorCurve(inDb: number, thresholdDb: number, ratio: number, kneeDb: number): number {
  const over = inDb - thresholdDb;
  const w = Math.max(0, kneeDb);
  if (2 * over < -w) return inDb;
  if (w > 0 && 2 * Math.abs(over) <= w) return inDb + ((1 / ratio - 1) * (over + w / 2) ** 2) / (2 * w);
  return thresholdDb + over / ratio;
}

export function autoMakeupDb(thresholdDb: number, ratio: number): number {
  // half of the gain reduction a full-scale signal would get
  return Math.max(0, -(compressorCurve(0, thresholdDb, ratio, 0) - 0) / 2);
}

export function compress(ch: Channels, sampleRate: number, p: CompressorParams): Channels {
  const n = channelLength(ch);
  const ratio = Math.max(1, p.ratio);
  const aA = coef(p.attackMs, sampleRate);
  const aR = coef(p.releaseMs, sampleRate);
  const makeup = p.makeupDb + (p.autoMakeup ? autoMakeupDb(p.thresholdDb, ratio) : 0);
  let env = 0; // smoothed gain reduction in dB (<= 0)
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const c of ch) {
      const v = c[i] < 0 ? -c[i] : c[i];
      if (v > x) x = v;
    }
    const inDb = x > 1e-9 ? 20 * Math.log10(x) : -180;
    const gr = compressorCurve(inDb, p.thresholdDb, ratio, p.kneeDb) - inDb;
    env = gr < env ? aA * env + (1 - aA) * gr : aR * env + (1 - aR) * gr;
    const g = Math.pow(10, (env + makeup) / 20);
    for (const c of ch) c[i] *= g;
  }
  return ch;
}

export interface LimiterParams {
  ceilingDb: number;
  releaseMs: number;
  lookaheadMs: number;
  /** Gain applied before limiting (dB). */
  inputGainDb: number;
}

/**
 * Look-ahead brickwall limiter. The gain for each sample is the minimum of the
 * required gain over the look-ahead window, released exponentially and smoothed
 * with a box filter of the same length, so no output sample exceeds the ceiling.
 */
export function limit(ch: Channels, sampleRate: number, p: LimiterParams): Channels {
  const n = channelLength(ch);
  if (!n) return ch;
  const ceiling = dbToGain(Math.min(0, p.ceilingDb));
  const pre = dbToGain(p.inputGainDb);
  const L = Math.max(1, Math.round((Math.max(0.1, p.lookaheadMs) / 1000) * sampleRate));
  const rel = coef(Math.max(1, p.releaseMs), sampleRate);
  const win = L + 1;
  // sliding-minimum deque over required gains r[k], k in [i-L, i]
  const dqIdx = new Int32Array(win + 1);
  const dqVal = new Float64Array(win + 1);
  let head = 0;
  let size = 0;
  // ring buffer of released gains for the box average
  const ring = new Float64Array(win).fill(1);
  let ringPos = 0;
  let sum = win;
  let released = 1;
  const total = n + L;
  for (let i = 0; i < total; i++) {
    // required gain for input sample i (beyond the end: 1)
    let r = 1;
    if (i < n) {
      let x = 0;
      for (const c of ch) {
        const v = Math.abs(c[i] * pre);
        if (v > x) x = v;
      }
      if (x > ceiling) r = ceiling / x;
    }
    // push into deque (keep increasing values)
    while (size > 0) {
      const back = (head + size - 1) % (win + 1);
      if (dqVal[back] >= r) size--;
      else break;
    }
    const slot = (head + size) % (win + 1);
    dqIdx[slot] = i;
    dqVal[slot] = r;
    size++;
    while (size > 0 && dqIdx[head] < i - L) {
      head = (head + 1) % (win + 1);
      size--;
    }
    const m = dqVal[head];
    released = m < released ? m : released + (1 - released) * (1 - rel);
    if (released > m) released = m;
    sum += released - ring[ringPos];
    ring[ringPos] = released;
    ringPos = (ringPos + 1) % win;
    // output sample j = i - L gets the average of released gains over [j, j + L]
    const j = i - L;
    if (j >= 0) {
      const g = (sum / win) * pre;
      for (const c of ch) {
        let y = c[j] * g;
        if (y > ceiling) y = ceiling;
        else if (y < -ceiling) y = -ceiling;
        c[j] = y;
      }
    }
  }
  return ch;
}

export interface GateParams {
  thresholdDb: number;
  attackMs: number;
  holdMs: number;
  releaseMs: number;
  /** Attenuation applied when the gate is closed (dB, positive). */
  rangeDb: number;
}

export function gate(ch: Channels, sampleRate: number, p: GateParams): Channels {
  const n = channelLength(ch);
  const openThreshold = dbToGain(p.thresholdDb);
  const closeThreshold = dbToGain(p.thresholdDb - 4); // hysteresis
  const floor = dbToGain(-Math.abs(p.rangeDb));
  const aOpen = coef(Math.max(0.05, p.attackMs), sampleRate);
  const aClose = coef(Math.max(1, p.releaseMs), sampleRate);
  const detA = coef(0.5, sampleRate);
  const detR = coef(30, sampleRate);
  const holdSamples = Math.round((Math.max(0, p.holdMs) / 1000) * sampleRate);
  let env = 0;
  let open = false;
  let holdLeft = 0;
  let g = floor;
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const c of ch) {
      const v = c[i] < 0 ? -c[i] : c[i];
      if (v > x) x = v;
    }
    env = x > env ? detA * env + (1 - detA) * x : detR * env + (1 - detR) * x;
    if (env >= openThreshold) {
      open = true;
      holdLeft = holdSamples;
    } else if (open && env < closeThreshold) {
      if (holdLeft > 0) holdLeft--;
      else open = false;
    }
    const target = open ? 1 : floor;
    g = target > g ? aOpen * g + (1 - aOpen) * target : aClose * g + (1 - aClose) * target;
    for (const c of ch) c[i] *= g;
  }
  return ch;
}
