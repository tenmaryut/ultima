import type { AudioFx, Clip } from './types';
import { OPEN_LOW_PASS } from './keyframes';

/*
 * Sound effects of an audio clip as a Web Audio chain: low cut, high cut (muffle, can be animated),
 * three-band EQ and reverb. The preview (AudioContext) and the export (OfflineAudioContext) build the
 * same chain, so what you hear is what you export.
 */

/** True when a clip's effects change its sound. */
export function audioFxActive(c: Clip): boolean {
  const fx = c.audioFx;
  return Boolean(c.keys?.lowPass?.length || (fx && (fx.highPass > 0 || (fx.lowPass > 0 && fx.lowPass < OPEN_LOW_PASS) || fx.eqLow || fx.eqMid || fx.eqHigh || fx.reverb > 0)));
}

/** Seconds of sound the effects add after the input stops, and of history they need (reverb tail, filter state). */
export function fxTail(c: Clip): number {
  if (!audioFxActive(c)) return 0;
  return c.audioFx && c.audioFx.reverb > 0 ? Math.min(8, c.audioFx.reverbSize) + 0.1 : 0.05;
}

/** Changes whenever the chain has to be rebuilt. */
export function chainKey(c: Clip): string {
  const fx = c.audioFx;
  return audioFxActive(c) ? `${fx?.highPass ?? 0}|${fx?.lowPass ?? 0}|${fx?.eqLow ?? 0}|${fx?.eqMid ?? 0}|${fx?.eqHigh ?? 0}|${fx?.reverb ?? 0}|${fx?.reverbSize ?? 0}|${c.keys?.lowPass?.length ? 'k' : ''}` : '';
}

/** Reverb impulse response: decaying stereo noise, the same every time. */
export function impulseResponse(sampleRate: number, seconds: number): Float32Array[] {
  const len = Math.max(1, Math.round(sampleRate * Math.max(0.05, seconds)));
  return [0, 1].map((ch) => {
    const d = new Float32Array(len);
    let s = (12345 + ch * 7919) >>> 0;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      // −60 dB at the end, with a short fade-in so the onset is soft
      d[i] = (s / 4294967296) * 2 - 1;
      d[i] *= Math.exp((-6.9 * i) / len) * Math.min(1, i / (sampleRate * 0.004) + 0.05);
    }
    return d;
  });
}

const impulses = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function impulseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  let byCtx = impulses.get(ctx);
  if (!byCtx) {
    byCtx = new Map();
    impulses.set(ctx, byCtx);
  }
  const key = seconds.toFixed(2);
  let buf = byCtx.get(key);
  if (!buf) {
    const data = impulseResponse(ctx.sampleRate, seconds);
    buf = ctx.createBuffer(2, data[0].length, ctx.sampleRate);
    data.forEach((d, i) => buf!.copyToChannel(d as Float32Array<ArrayBuffer>, i));
    byCtx.set(key, buf);
  }
  return buf;
}

export interface FxChain {
  input: AudioNode;
  output: AudioNode;
  /** The high-cut filter, for animating it (null without one). */
  lowPass: BiquadFilterNode | null;
  dispose(): void;
}

/** The effect chain of a clip, or null when it has no effects. */
export function buildChain(ctx: BaseAudioContext, c: Clip): FxChain | null {
  if (!audioFxActive(c)) return null;
  const fx: AudioFx = c.audioFx ?? { highPass: 0, lowPass: 0, eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0, reverbSize: 1.5 };
  const nodes: AudioNode[] = [];
  const biquad = (type: BiquadFilterType, frequency: number, gain = 0, q = 0.707) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    nodes.push(f);
    return f;
  };
  if (fx.highPass > 0) biquad('highpass', Math.min(20000, fx.highPass));
  let lowPass: BiquadFilterNode | null = null;
  if ((fx.lowPass > 0 && fx.lowPass < OPEN_LOW_PASS) || c.keys?.lowPass?.length) lowPass = biquad('lowpass', Math.min(OPEN_LOW_PASS, fx.lowPass || OPEN_LOW_PASS));
  if (fx.eqLow) biquad('lowshelf', 150, fx.eqLow);
  if (fx.eqMid) biquad('peaking', 1000, fx.eqMid, 0.9);
  if (fx.eqHigh) biquad('highshelf', 6000, fx.eqHigh);
  const input = ctx.createGain();
  let last: AudioNode = input;
  for (const n of nodes) {
    last.connect(n);
    last = n;
  }
  const all: AudioNode[] = [input, ...nodes];
  let output: AudioNode = last;
  if (fx.reverb > 0) {
    const mix = Math.min(1, fx.reverb);
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    const out = ctx.createGain();
    dry.gain.value = Math.cos((mix * Math.PI) / 2) * 0.35 + 0.65;
    wet.gain.value = Math.sin((mix * Math.PI) / 2);
    conv.normalize = true;
    conv.buffer = impulseBuffer(ctx, Math.min(8, Math.max(0.2, fx.reverbSize)));
    last.connect(dry).connect(out);
    last.connect(conv).connect(wet).connect(out);
    all.push(dry, wet, conv, out);
    output = out;
  }
  return {
    input,
    output,
    lowPass,
    dispose: () => {
      for (const n of all) {
        try {
          n.disconnect();
        } catch {
          // already disconnected
        }
      }
    },
  };
}
