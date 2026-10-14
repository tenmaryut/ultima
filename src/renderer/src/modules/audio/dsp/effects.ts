/**
 * Effect registry: ids, parameter definitions (shared by the effect dialogs, the AI
 * action validator and the worker), defaults/clamping and the dispatcher.
 */
import {
  FADE_CURVES,
  applyGain,
  dbToGain,
  distortion,
  fade,
  invert,
  normalizePeak,
  peakOf,
  removeDcOffset,
  reverse,
  swapChannels,
  toMono,
  toStereo,
  type Channels,
  type DistortionType,
  type FadeCurve,
} from './basic';
import { EQ_PRESETS, applyEq, passFilter, sanitizeEqBands, type EqBand } from './filters';
import { compress, gate, limit } from './dynamics';
import { changeSpeed, echo, pitchShift, type Progress } from './time';
import { reverb } from './reverb';
import { estimateNoiseProfile, reduceNoise, type NoiseProfile } from './noise';
import { integratedLoudness } from './analysis';

export type EffectId =
  | 'amplify'
  | 'normalize'
  | 'fadeIn'
  | 'fadeOut'
  | 'reverse'
  | 'invert'
  | 'speed'
  | 'pitch'
  | 'eq'
  | 'highpass'
  | 'lowpass'
  | 'compressor'
  | 'limiter'
  | 'gate'
  | 'reverb'
  | 'echo'
  | 'distortion'
  | 'stereoToMono'
  | 'swapChannels'
  | 'monoToStereo'
  | 'dcOffset'
  | 'noiseReduction'
  | 'autoClean';

export type ParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; unit?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default: string }
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; type: 'eq'; default: EqBand[] };

export type EffectCategory = 'amplitude' | 'filter' | 'dynamics' | 'time' | 'space' | 'channels' | 'restoration';

export interface EffectDef {
  id: EffectId;
  name: string;
  description: string;
  category: EffectCategory;
  params: ParamDef[];
  /** Output length can differ from the input length. */
  changesLength?: boolean;
  /** Output channel count differs — only applies to the whole file. */
  changesChannels?: boolean;
  /** Needs (or uses) a noise print. */
  usesNoiseProfile?: boolean;
  /** Effects without parameters are applied immediately (no dialog). */
  instant?: boolean;
}

const num = (key: string, label: string, min: number, max: number, def: number, step: number, unit?: string): ParamDef => ({
  key,
  label,
  type: 'number',
  min,
  max,
  step,
  default: def,
  unit,
});
const bool = (key: string, label: string, def: boolean): ParamDef => ({ key, label, type: 'boolean', default: def });
const curveParam: ParamDef = {
  key: 'curve',
  label: 'Curve',
  type: 'select',
  default: 'linear',
  options: [
    { value: 'linear', label: 'Linear' },
    { value: 'log', label: 'Logarithmic' },
    { value: 'exp', label: 'Exponential' },
    { value: 'scurve', label: 'S-curve' },
  ],
};
const slopeParam: ParamDef = {
  key: 'order',
  label: 'Slope',
  type: 'select',
  default: '4',
  options: [
    { value: '2', label: '12 dB/octave' },
    { value: '4', label: '24 dB/octave' },
    { value: '8', label: '48 dB/octave' },
  ],
};

export const EFFECTS: EffectDef[] = [
  { id: 'amplify', name: 'Amplify', description: 'Raise or lower the volume by a fixed amount.', category: 'amplitude', params: [num('gainDb', 'Gain', -48, 48, 3, 0.5, 'dB')] },
  {
    id: 'normalize',
    name: 'Normalize',
    description: 'Set the loudest peak (or the average loudness) to a target level.',
    category: 'amplitude',
    params: [
      { key: 'mode', label: 'Mode', type: 'select', default: 'peak', options: [{ value: 'peak', label: 'Peak level' }, { value: 'loudness', label: 'Loudness (LUFS)' }] },
      num('peakDb', 'Peak target', -30, 0, -1, 0.1, 'dBFS'),
      num('lufs', 'Loudness target', -40, -5, -16, 0.5, 'LUFS'),
      bool('perChannel', 'Normalize channels separately', false),
      bool('limit', 'Prevent clipping (limit peaks to -1 dBFS)', true),
    ],
  },
  { id: 'fadeIn', name: 'Fade In', description: 'Fade from silence to full volume.', category: 'amplitude', params: [curveParam] },
  { id: 'fadeOut', name: 'Fade Out', description: 'Fade from full volume to silence.', category: 'amplitude', params: [curveParam] },
  { id: 'reverse', name: 'Reverse', description: 'Play backwards.', category: 'time', params: [], instant: true },
  { id: 'invert', name: 'Invert', description: 'Flip the polarity of the waveform.', category: 'amplitude', params: [], instant: true },
  {
    id: 'speed',
    name: 'Change Speed',
    description: 'Play faster or slower like a tape: duration and pitch change together.',
    category: 'time',
    params: [num('factor', 'Speed', 0.25, 4, 1.25, 0.01, '×')],
    changesLength: true,
  },
  {
    id: 'pitch',
    name: 'Pitch Shift',
    description: 'Change the pitch while keeping the duration (phase vocoder).',
    category: 'time',
    params: [num('semitones', 'Semitones', -12, 12, 2, 0.5, 'st'), num('cents', 'Fine tune', -100, 100, 0, 1, 'cents')],
  },
  {
    id: 'eq',
    name: 'Parametric EQ',
    description: 'Up to 6 bands of peaking, shelving and pass filters.',
    category: 'filter',
    params: [{ key: 'bands', label: 'Bands', type: 'eq', default: EQ_PRESETS[1].bands }],
  },
  { id: 'highpass', name: 'High-Pass Filter', description: 'Remove rumble and low frequencies below the cut-off.', category: 'filter', params: [num('freq', 'Cut-off', 20, 5000, 80, 1, 'Hz'), slopeParam] },
  { id: 'lowpass', name: 'Low-Pass Filter', description: 'Remove hiss and high frequencies above the cut-off.', category: 'filter', params: [num('freq', 'Cut-off', 200, 20000, 8000, 10, 'Hz'), slopeParam] },
  {
    id: 'compressor',
    name: 'Compressor',
    description: 'Even out the volume by turning down loud parts.',
    category: 'dynamics',
    params: [
      num('thresholdDb', 'Threshold', -60, 0, -20, 0.5, 'dB'),
      num('ratio', 'Ratio', 1, 20, 4, 0.1, ':1'),
      num('attackMs', 'Attack', 0.1, 200, 10, 0.1, 'ms'),
      num('releaseMs', 'Release', 10, 2000, 150, 1, 'ms'),
      num('kneeDb', 'Knee', 0, 24, 6, 0.5, 'dB'),
      num('makeupDb', 'Makeup gain', -12, 24, 0, 0.5, 'dB'),
      bool('autoMakeup', 'Automatic makeup gain', true),
    ],
  },
  {
    id: 'limiter',
    name: 'Hard Limiter',
    description: 'Stop peaks from exceeding a ceiling (look-ahead brickwall).',
    category: 'dynamics',
    params: [
      num('ceilingDb', 'Ceiling', -12, 0, -1, 0.1, 'dBFS'),
      num('inputGainDb', 'Input boost', 0, 24, 0, 0.5, 'dB'),
      num('releaseMs', 'Release', 1, 1000, 60, 1, 'ms'),
      num('lookaheadMs', 'Look-ahead', 0.5, 20, 5, 0.5, 'ms'),
    ],
  },
  {
    id: 'gate',
    name: 'Noise Gate',
    description: 'Silence the audio between phrases when it falls below a threshold.',
    category: 'dynamics',
    params: [
      num('thresholdDb', 'Threshold', -80, 0, -45, 0.5, 'dB'),
      num('attackMs', 'Attack', 0.1, 50, 2, 0.1, 'ms'),
      num('holdMs', 'Hold', 0, 500, 60, 1, 'ms'),
      num('releaseMs', 'Release', 5, 1000, 150, 1, 'ms'),
      num('rangeDb', 'Reduction', 0, 80, 40, 1, 'dB'),
    ],
  },
  {
    id: 'reverb',
    name: 'Reverb',
    description: 'Simulate a room or hall.',
    category: 'space',
    params: [
      num('roomSize', 'Room size', 0, 1, 0.5, 0.01),
      num('decay', 'Decay time', 0.2, 10, 1.8, 0.1, 's'),
      num('damping', 'Damping', 0, 1, 0.5, 0.01),
      num('preDelayMs', 'Pre-delay', 0, 200, 20, 1, 'ms'),
      num('mix', 'Wet/dry mix', 0, 1, 0.3, 0.01),
    ],
  },
  {
    id: 'echo',
    name: 'Echo / Delay',
    description: 'Repeating echoes.',
    category: 'space',
    params: [
      num('delayMs', 'Delay', 10, 2000, 350, 1, 'ms'),
      num('feedback', 'Feedback', 0, 0.95, 0.35, 0.01),
      num('mix', 'Echo level', 0, 1, 0.4, 0.01),
      bool('pingPong', 'Ping-pong (stereo)', false),
    ],
  },
  {
    id: 'distortion',
    name: 'Distortion',
    description: 'Saturation, overdrive and fuzz.',
    category: 'amplitude',
    params: [
      { key: 'type', label: 'Type', type: 'select', default: 'soft', options: [{ value: 'soft', label: 'Soft clip' }, { value: 'hard', label: 'Hard clip' }, { value: 'fuzz', label: 'Fuzz' }] },
      num('driveDb', 'Drive', 0, 48, 18, 0.5, 'dB'),
      num('toneHz', 'Tone', 500, 16000, 6000, 10, 'Hz'),
      num('mix', 'Mix', 0, 1, 1, 0.01),
      num('outputDb', 'Output', -24, 6, -6, 0.5, 'dB'),
    ],
  },
  { id: 'stereoToMono', name: 'Stereo to Mono', description: 'Mix all channels into one.', category: 'channels', params: [], changesChannels: true, instant: true },
  { id: 'swapChannels', name: 'Swap Channels', description: 'Exchange left and right.', category: 'channels', params: [], instant: true },
  { id: 'monoToStereo', name: 'Mono to Stereo', description: 'Duplicate a mono channel into stereo.', category: 'channels', params: [], changesChannels: true, instant: true },
  { id: 'dcOffset', name: 'Remove DC Offset', description: 'Center the waveform around zero.', category: 'restoration', params: [], instant: true },
  {
    id: 'noiseReduction',
    name: 'Noise Reduction',
    description: 'Remove steady background noise using a captured noise print.',
    category: 'restoration',
    usesNoiseProfile: true,
    params: [
      num('reductionDb', 'Reduce by', 0, 48, 18, 0.5, 'dB'),
      num('sensitivity', 'Sensitivity', 0, 10, 5, 0.1),
      num('freqSmoothing', 'Spectral smoothing', 0, 8, 2, 1, 'bins'),
      num('attackMs', 'Attack', 1, 100, 5, 1, 'ms'),
      num('releaseMs', 'Release', 10, 500, 80, 1, 'ms'),
      bool('noiseOnly', 'Output noise only', false),
    ],
  },
  {
    id: 'autoClean',
    name: 'Auto Clean Voice',
    description: 'High-pass 80 Hz, noise reduction, compression and normalize to −1 dBFS in one step.',
    category: 'restoration',
    usesNoiseProfile: true,
    params: [
      num('highpassHz', 'High-pass', 40, 200, 80, 1, 'Hz'),
      num('reductionDb', 'Noise reduction', 0, 30, 12, 0.5, 'dB'),
      num('thresholdDb', 'Compressor threshold', -40, 0, -22, 0.5, 'dB'),
      num('ratio', 'Compressor ratio', 1, 10, 3, 0.1, ':1'),
      num('targetDb', 'Normalize to', -6, 0, -1, 0.1, 'dBFS'),
    ],
  },
];

export const EFFECT_IDS = EFFECTS.map((e) => e.id);

export function getEffect(id: EffectId): EffectDef {
  const def = EFFECTS.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown effect ${id}`);
  return def;
}

const ALIASES: Record<string, EffectId> = {
  gain: 'amplify',
  volume: 'amplify',
  fade: 'fadeIn',
  changespeed: 'speed',
  tempo: 'speed',
  pitchshift: 'pitch',
  equalizer: 'eq',
  parametriceq: 'eq',
  hpf: 'highpass',
  lpf: 'lowpass',
  compress: 'compressor',
  limit: 'limiter',
  noisegate: 'gate',
  delay: 'echo',
  overdrive: 'distortion',
  mono: 'stereoToMono',
  stereo: 'monoToStereo',
  swap: 'swapChannels',
  removedc: 'dcOffset',
  dcoffsetremoval: 'dcOffset',
  denoise: 'noiseReduction',
  noisereduction: 'noiseReduction',
  autocleanvoice: 'autoClean',
};

/** Resolves an effect name from untrusted input (AI) to an id, or null. */
export function resolveEffectId(name: unknown): EffectId | null {
  if (typeof name !== 'string') return null;
  const exact = EFFECT_IDS.find((id) => id === name);
  if (exact) return exact;
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  const byLower = EFFECT_IDS.find((id) => id.toLowerCase() === key);
  return byLower ?? ALIASES[key] ?? null;
}

export type EffectParams = Record<string, number | string | boolean | EqBand[]>;

export function defaultParams(id: EffectId): EffectParams {
  const out: EffectParams = {};
  for (const p of getEffect(id).params) out[p.key] = p.type === 'eq' ? p.default.map((b) => ({ ...b })) : p.default;
  return out;
}

/** Validates and clamps parameters from any source (UI, AI, project file). */
export function sanitizeParams(id: EffectId, raw: unknown): EffectParams {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: EffectParams = {};
  for (const p of getEffect(id).params) {
    const v = src[p.key];
    if (p.type === 'number') {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
      out[p.key] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default;
    } else if (p.type === 'select') {
      const s = typeof v === 'number' ? String(v) : v;
      out[p.key] = typeof s === 'string' && p.options.some((o) => o.value === s) ? s : p.default;
    } else if (p.type === 'boolean') {
      out[p.key] = typeof v === 'boolean' ? v : p.default;
    } else {
      const bands = sanitizeEqBands(v);
      out[p.key] = bands.length ? bands : p.default.map((b) => ({ ...b }));
    }
  }
  return out;
}

export interface EffectExtras {
  noiseProfile?: NoiseProfile | null;
  onProgress?: Progress;
}

const n = (p: EffectParams, key: string) => Number(p[key]);

/** Runs an effect on a copy of the audio. May modify `ch` in place; returns the result. */
export function runEffect(id: EffectId, ch: Channels, sampleRate: number, rawParams: EffectParams, extras: EffectExtras = {}): Channels {
  const p = sanitizeParams(id, rawParams);
  const progress = extras.onProgress;
  switch (id) {
    case 'amplify':
      return applyGain(ch, n(p, 'gainDb'));
    case 'normalize': {
      if (p.mode === 'loudness') {
        const measured = integratedLoudness(ch, sampleRate);
        if (!Number.isFinite(measured)) return ch;
        applyGain(ch, n(p, 'lufs') - measured);
        if (p.limit && peakOf(ch) > dbToGain(-1)) limit(ch, sampleRate, { ceilingDb: -1, inputGainDb: 0, releaseMs: 80, lookaheadMs: 5 });
        return ch;
      }
      return normalizePeak(ch, n(p, 'peakDb'), Boolean(p.perChannel));
    }
    case 'fadeIn':
    case 'fadeOut':
      return fade(ch, id === 'fadeIn' ? 'in' : 'out', (FADE_CURVES.includes(p.curve as FadeCurve) ? p.curve : 'linear') as FadeCurve);
    case 'reverse':
      return reverse(ch);
    case 'invert':
      return invert(ch);
    case 'speed':
      return changeSpeed(ch, n(p, 'factor'), progress);
    case 'pitch':
      return pitchShift(ch, sampleRate, n(p, 'semitones') + n(p, 'cents') / 100, progress);
    case 'eq':
      return applyEq(ch, sampleRate, p.bands as EqBand[]);
    case 'highpass':
    case 'lowpass':
      return passFilter(ch, sampleRate, id, n(p, 'freq'), parseInt(String(p.order), 10) || 4);
    case 'compressor':
      return compress(ch, sampleRate, {
        thresholdDb: n(p, 'thresholdDb'),
        ratio: n(p, 'ratio'),
        attackMs: n(p, 'attackMs'),
        releaseMs: n(p, 'releaseMs'),
        kneeDb: n(p, 'kneeDb'),
        makeupDb: n(p, 'makeupDb'),
        autoMakeup: Boolean(p.autoMakeup),
      });
    case 'limiter':
      return limit(ch, sampleRate, { ceilingDb: n(p, 'ceilingDb'), inputGainDb: n(p, 'inputGainDb'), releaseMs: n(p, 'releaseMs'), lookaheadMs: n(p, 'lookaheadMs') });
    case 'gate':
      return gate(ch, sampleRate, { thresholdDb: n(p, 'thresholdDb'), attackMs: n(p, 'attackMs'), holdMs: n(p, 'holdMs'), releaseMs: n(p, 'releaseMs'), rangeDb: n(p, 'rangeDb') });
    case 'reverb':
      return reverb(ch, sampleRate, { roomSize: n(p, 'roomSize'), decay: n(p, 'decay'), damping: n(p, 'damping'), preDelayMs: n(p, 'preDelayMs'), mix: n(p, 'mix') }, progress);
    case 'echo':
      return echo(ch, sampleRate, { delayMs: n(p, 'delayMs'), feedback: n(p, 'feedback'), mix: n(p, 'mix'), pingPong: Boolean(p.pingPong) });
    case 'distortion':
      return distortion(ch, sampleRate, { type: p.type as DistortionType, driveDb: n(p, 'driveDb'), toneHz: n(p, 'toneHz'), mix: n(p, 'mix'), outputDb: n(p, 'outputDb') });
    case 'stereoToMono':
      return toMono(ch);
    case 'swapChannels':
      return swapChannels(ch);
    case 'monoToStereo':
      return toStereo(ch);
    case 'dcOffset':
      return removeDcOffset(ch);
    case 'noiseReduction': {
      const profile = extras.noiseProfile ?? estimateNoiseProfile(ch, sampleRate);
      return reduceNoise(
        ch,
        sampleRate,
        profile,
        {
          reductionDb: n(p, 'reductionDb'),
          sensitivity: n(p, 'sensitivity'),
          freqSmoothing: n(p, 'freqSmoothing'),
          attackMs: n(p, 'attackMs'),
          releaseMs: n(p, 'releaseMs'),
          noiseOnly: Boolean(p.noiseOnly),
        },
        progress,
      );
    }
    case 'autoClean': {
      const step = (from: number, to: number): Progress | undefined => (progress ? (f) => progress(from + (to - from) * f) : undefined);
      passFilter(ch, sampleRate, 'highpass', n(p, 'highpassHz'), 4);
      progress?.(0.05);
      const profile = extras.noiseProfile ?? estimateNoiseProfile(ch, sampleRate);
      let out = ch;
      if (n(p, 'reductionDb') > 0) {
        out = reduceNoise(out, sampleRate, profile, { reductionDb: n(p, 'reductionDb'), sensitivity: 5, freqSmoothing: 2, attackMs: 5, releaseMs: 80, noiseOnly: false }, step(0.05, 0.85));
      }
      compress(out, sampleRate, { thresholdDb: n(p, 'thresholdDb'), ratio: n(p, 'ratio'), attackMs: 8, releaseMs: 140, kneeDb: 6, makeupDb: 0, autoMakeup: false });
      progress?.(0.95);
      return normalizePeak(out, n(p, 'targetDb'));
    }
    default:
      return ch;
  }
}
