/**
 * Heavy DSP jobs, executed in a Web Worker (dsp.worker.ts) or — when workers are not
 * available — on the main thread. Pure TypeScript, no DOM.
 */
import { runEffect, type EffectId, type EffectParams } from './effects';
import { captureNoiseProfile, estimateNoiseProfile, type NoiseProfile } from './noise';
import { resampleChannels, type Progress } from './time';
import { computeStats, detectSilence, type AudioStats, type SampleRange } from './analysis';

export type DspJob =
  | { type: 'effect'; effect: EffectId; params: EffectParams; channels: Float32Array[]; sampleRate: number; noiseProfile?: NoiseProfile | null }
  | { type: 'chain'; steps: { effect: EffectId; params: EffectParams }[]; channels: Float32Array[]; sampleRate: number; noiseProfile?: NoiseProfile | null }
  | { type: 'resample'; channels: Float32Array[]; fromRate: number; toRate: number }
  | { type: 'noiseProfile'; channels: Float32Array[]; sampleRate: number; auto?: boolean }
  | { type: 'stats'; channels: Float32Array[]; sampleRate: number }
  | { type: 'silence'; channels: Float32Array[]; sampleRate: number; thresholdDb: number; minDuration: number };

export interface DspResult {
  channels?: Float32Array[];
  profile?: NoiseProfile;
  stats?: AudioStats;
  ranges?: SampleRange[];
}

export function runDspJob(job: DspJob, onProgress?: Progress): DspResult {
  switch (job.type) {
    case 'effect':
      return { channels: runEffect(job.effect, job.channels, job.sampleRate, job.params, { noiseProfile: job.noiseProfile, onProgress }) };
    case 'chain': {
      let ch = job.channels;
      job.steps.forEach((step, i) => {
        const report: Progress | undefined = onProgress ? (f) => onProgress((i + f) / job.steps.length) : undefined;
        ch = runEffect(step.effect, ch, job.sampleRate, step.params, { noiseProfile: job.noiseProfile, onProgress: report });
      });
      return { channels: ch };
    }
    case 'resample':
      return { channels: resampleChannels(job.channels, job.fromRate, job.toRate, onProgress) };
    case 'noiseProfile':
      return { profile: job.auto ? estimateNoiseProfile(job.channels, job.sampleRate) : captureNoiseProfile(job.channels, job.sampleRate) };
    case 'stats':
      return { stats: computeStats(job.channels, job.sampleRate) };
    case 'silence':
      return { ranges: detectSilence(job.channels, job.sampleRate, { thresholdDb: job.thresholdDb, minDuration: job.minDuration }) };
  }
}

/** Transferable buffers of a result (for postMessage). */
export function resultTransferables(result: DspResult): ArrayBuffer[] {
  const list: ArrayBuffer[] = [];
  for (const c of result.channels ?? []) if (c.buffer instanceof ArrayBuffer) list.push(c.buffer);
  for (const c of result.profile?.power ?? []) if (c.buffer instanceof ArrayBuffer) list.push(c.buffer);
  return [...new Set(list)];
}
