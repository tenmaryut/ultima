/**
 * Editing operations built on the controller: effects (with live preview), generators,
 * noise prints, silence removal, sample-rate conversion and analysis.
 */
import { t } from '../../core/i18n';
import { toast } from '../../components/ui';
import { copyRange } from './engine/document';
import { channelSource } from './engine/player';
import { CancelledError } from './engine/dspClient';
import { audio } from './controller';
import { setUI, ui, type GeneratorKind, type Sel } from './state';
import { getEffect, sanitizeParams, type EffectId, type EffectParams } from './dsp/effects';
import { captureNoiseProfile, estimateNoiseProfile, noiseFftSize } from './dsp/noise';
import { StatsAccumulator, detectSilence, silenceCutRanges, type AudioStats, type SampleRange } from './dsp/analysis';
import { generateDtmf, generateNoise, generateTone, type NoiseColor, type Waveform } from './dsp/generate';

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

/** Runs `fn` over [0, total) in slices, yielding to the UI every ~30 ms. */
async function sliced(total: number, step: number, fn: (from: number, to: number) => void, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<void> {
  let last = performance.now();
  for (let pos = 0; pos < total; pos += step) {
    fn(pos, Math.min(total, pos + step));
    if (performance.now() - last > 30) {
      onProgress?.(pos / total);
      await yieldToUI();
      last = performance.now();
      if (signal?.aborted) throw new CancelledError();
    }
  }
}

/* --------------------------------- effects --------------------------------- */

export function effectLabel(id: EffectId): string {
  return t(getEffect(id).name);
}

/** The range an effect applies to: the selection, or the whole file. */
export function effectRange(id: EffectId, override?: Sel | null): Sel {
  if (getEffect(id).changesChannels) return { start: 0, end: audio.length };
  return override ?? audio.rangeOrAll();
}

function noiseProfileFor(id: EffectId) {
  if (!getEffect(id).usesNoiseProfile) return null;
  if (audio.noiseProfile) return audio.noiseProfile;
  // no captured print: estimate one from the quietest parts of the whole file
  return estimateNoiseProfile(audio.doc.channels, audio.sampleRate);
}

/**
 * Applies an effect to the selection (or whole file). When called inside an open
 * document transaction (AI replies) the edit joins that transaction.
 */
export async function applyEffect(id: EffectId, rawParams: EffectParams | Record<string, unknown>, options: { range?: Sel | null; quiet?: boolean } = {}): Promise<boolean> {
  if (!audio.length) {
    toast.info(t('Open or record some audio first'));
    return false;
  }
  const def = getEffect(id);
  const params = sanitizeParams(id, rawParams);
  if ((id === 'swapChannels' || id === 'stereoToMono') && audio.doc.channels.length < 2) {
    if (!options.quiet) toast.info(t('This effect needs stereo audio'));
    return false;
  }
  if (id === 'monoToStereo' && audio.doc.channels.length !== 1) {
    if (!options.quiet) toast.info(t('The audio is already stereo'));
    return false;
  }
  const range = effectRange(id, options.range);
  if (range.end - range.start < 1) return false;
  const before = audio.selection();
  const whole = range.start === 0 && range.end === audio.length;
  const label = effectLabel(id);
  const result = await audio.runBusy(t('Applying {name}…', { name: label }), async (signal, progress) => {
    const input = copyRange(audio.doc.channels, range.start, range.end);
    const noiseProfile = noiseProfileFor(id);
    const res = await audio.dsp.run({ type: 'effect', effect: id, params, channels: input, sampleRate: audio.sampleRate, noiseProfile }, { onProgress: progress, signal, transfer: true });
    if (!res.channels) throw new Error(t('The effect produced no audio'));
    return res.channels;
  });
  if (!result) return false;
  const newLen = result[0]?.length ?? 0;
  if (def.changesChannels || (whole && newLen === audio.length)) {
    audio.doc.replaceAll(result, audio.sampleRate, label, { before, after: before });
  } else {
    const after = before ? { start: range.start, end: range.start + newLen } : null;
    audio.doc.replaceRange(range.start, range.end, result, label, { metaMode: def.changesLength ? 'scale' : 'shift', before, after });
    if (after) audio.setSelection(after);
  }
  return true;
}

/* ------------------------------- live preview ------------------------------- */

let previewGeneration = 0;
let previewRegion: Sel | null = null;

/** Region auditioned by the preview: the selection (max 20 s) or 10 s from the cursor. */
function previewRange(id: EffectId): Sel {
  const sr = audio.sampleRate;
  const sel = getEffect(id).changesChannels ? null : audio.selection();
  if (sel) return { start: sel.start, end: Math.min(sel.end, sel.start + 20 * sr) };
  const start = Math.min(ui().cursor, Math.max(0, audio.length - 10 * sr));
  return { start, end: Math.min(audio.length, start + 10 * sr) };
}

/** Renders the effect over the preview region and loops it (call again on parameter changes). */
export async function previewEffect(id: EffectId, rawParams: EffectParams): Promise<boolean> {
  if (!audio.length) return false;
  const gen = ++previewGeneration;
  const region = previewRange(id);
  previewRegion = region;
  const params = sanitizeParams(id, rawParams);
  try {
    const input = copyRange(audio.doc.channels, region.start, region.end);
    const res = await audio.dsp.run(
      { type: 'effect', effect: id, params, channels: input, sampleRate: audio.sampleRate, noiseProfile: noiseProfileFor(id) },
      { transfer: true },
    );
    if (gen !== previewGeneration || !res.channels) return false;
    const source = channelSource(res.channels, audio.sampleRate);
    if (ui().previewing && audio.player.playing) {
      audio.player.setSource(source);
      audio.player.setLoop({ start: 0, end: source.length });
    } else {
      await audio.player.play(source, { from: 0, loop: { start: 0, end: source.length }, offset: region.start });
      setUI({ playing: true, previewing: true, playingMix: false });
    }
    return true;
  } catch (error) {
    if (gen === previewGeneration) toast.error(t('Preview failed'), error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function stopPreview(): void {
  previewGeneration++;
  previewRegion = null;
  if (ui().previewing) {
    audio.player.stop();
    setUI({ playing: false, previewing: false });
  }
}

export function previewInfo(): Sel | null {
  return previewRegion;
}

/* -------------------------------- generators -------------------------------- */

export interface GenerateOptions {
  kind: GeneratorKind;
  duration: number;
  waveform?: Waveform;
  frequency?: number;
  endFrequency?: number;
  amplitudeDb?: number;
  color?: NoiseColor;
  digits?: string;
  toneMs?: number;
  gapMs?: number;
}

/** Generates audio and inserts it at the cursor (replacing the selection). */
export function generate(o: GenerateOptions): Sel | null {
  const sampleRate = audio.hasAudio && audio.length ? audio.sampleRate : audio.sampleRate || 48000;
  const channels = Math.max(1, audio.doc.channels.length || 2);
  const amplitude = Math.pow(10, Math.min(0, Math.max(-60, o.amplitudeDb ?? -6)) / 20);
  const duration = Math.min(3600, Math.max(0.001, o.duration));
  let data: Float32Array[];
  let label: string;
  switch (o.kind) {
    case 'tone':
      data = generateTone({ waveform: o.waveform ?? 'sine', frequency: o.frequency ?? 440, endFrequency: o.endFrequency, amplitude, duration, sampleRate, channels });
      label = t('Generate tone');
      break;
    case 'noise':
      data = generateNoise({ color: o.color ?? 'white', amplitude, duration, sampleRate, channels, seed: Date.now() & 0xffff });
      label = t('Generate noise');
      break;
    case 'dtmf':
      data = generateDtmf({ digits: o.digits ?? '', toneMs: o.toneMs ?? 120, gapMs: o.gapMs ?? 80, amplitude, sampleRate, channels });
      if (!data[0].length) {
        toast.info(t('Enter digits 0–9, *, #, A–D'));
        return null;
      }
      label = t('Generate DTMF');
      break;
    default:
      data = Array.from({ length: channels }, () => new Float32Array(Math.round(duration * sampleRate)));
      label = t('Insert silence');
  }
  return audio.insertAudio(data, sampleRate, ui().cursor, label, audio.selection());
}

/* ------------------------------- noise print ------------------------------- */

export function captureNoisePrint(): boolean {
  const sel = audio.selection();
  const min = noiseFftSize(audio.sampleRate) * 2;
  if (!sel || sel.end - sel.start < min) {
    toast.info(t('Select a noise-only part first'), t('Select at least half a second of background noise (no speech or music), then capture the noise print.'));
    return false;
  }
  audio.noiseProfile = captureNoiseProfile(copyRange(audio.doc.channels, sel.start, sel.end), audio.sampleRate);
  setUI({ noisePrint: { duration: (sel.end - sel.start) / audio.sampleRate } });
  toast.success(t('Noise print captured'), t('Now select the audio to clean (or nothing for the whole file) and open Noise Reduction.'));
  return true;
}

export function clearNoisePrint(): void {
  audio.noiseProfile = null;
  setUI({ noisePrint: null });
}

/* ---------------------------------- silence ---------------------------------- */

/** Silent ranges within `scope` (chunked so long files don't freeze the UI). */
export async function findSilence(opts: { thresholdDb: number; minDuration: number }, scope: Sel, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<SampleRange[]> {
  const sr = audio.sampleRate;
  const win = Math.max(1, Math.round(sr * 0.01));
  const step = win * 2000;
  const runs: SampleRange[] = [];
  const channels = audio.doc.channels;
  await sliced(
    scope.end - scope.start,
    step,
    (from, to) => {
      const a = scope.start + from;
      const b = scope.start + to;
      const part = channels.map((c) => c.subarray(a, b));
      for (const r of detectSilence(part, sr, { thresholdDb: opts.thresholdDb, minDuration: 0 })) {
        const run = { start: r.start + a, end: r.end + a };
        const last = runs[runs.length - 1];
        if (last && last.end >= run.start) last.end = run.end;
        else runs.push(run);
      }
    },
    onProgress,
    signal,
  );
  const minLen = Math.round(opts.minDuration * sr);
  return runs.filter((r) => r.end - r.start >= minLen);
}

export interface RemoveSilenceOptions {
  thresholdDb: number;
  minDuration: number;
  padding: number;
}

/** Deletes silent stretches (keeping `padding` seconds) as ONE undo step. */
export async function removeSilence(o: RemoveSilenceOptions, scope?: Sel | null): Promise<{ count: number; seconds: number } | null> {
  const range = scope ?? audio.rangeOrAll();
  const ranges = await audio.runBusy(t('Finding silence…'), (signal, progress) => findSilence(o, range, signal, progress));
  if (!ranges) return null;
  const cuts = silenceCutRanges(ranges, audio.sampleRate, o.padding, audio.length).filter((r) => r.start >= range.start && r.end <= range.end);
  if (!cuts.length) return { count: 0, seconds: 0 };
  const before = audio.selection();
  const ownTx = !audio.doc.inTransaction;
  if (ownTx) audio.doc.begin(t('Remove silence'), before);
  let removed = 0;
  try {
    for (let i = cuts.length - 1; i >= 0; i--) {
      audio.doc.replaceRange(cuts[i].start, cuts[i].end, null, t('Remove silence'));
      removed += cuts[i].end - cuts[i].start;
    }
  } finally {
    if (ownTx) audio.doc.commit(null);
  }
  audio.setSelection(null);
  return { count: cuts.length, seconds: removed / audio.sampleRate };
}

/* --------------------------- sample-rate conversion --------------------------- */

export async function convertSampleRate(rate: number): Promise<boolean> {
  const from = audio.sampleRate;
  if (!audio.length || rate === from) return false;
  const result = await audio.runBusy(t('Converting sample rate…'), async (signal, progress) => {
    const res = await audio.dsp.run({ type: 'resample', channels: audio.doc.channels.map((c) => c.slice()), fromRate: from, toRate: rate }, { onProgress: progress, signal, transfer: true });
    return res.channels ?? null;
  });
  if (!result) return false;
  const k = rate / from;
  const meta = {
    markers: audio.doc.markers.map((m) => ({ ...m, pos: Math.round(m.pos * k) })),
    transcript: audio.doc.transcript.map((s) => ({ ...s, start: Math.round(s.start * k), end: Math.round(s.end * k) })),
  };
  const view = ui().view;
  audio.doc.replaceAll(result, rate, t('Convert sample rate'), { meta, before: null, after: null });
  audio.setSelection(null);
  audio.setCursor(Math.round(ui().cursor * k));
  audio.setView({ start: view.start * k, spp: view.spp * k });
  return true;
}

/* ---------------------------------- analysis ---------------------------------- */

/** Statistics of the selection or whole file (chunked; cached per document version). */
export async function analyze(scope: 'all' | 'selection' = 'all', signal?: AbortSignal): Promise<AudioStats | null> {
  if (!audio.length) return null;
  const range = scope === 'selection' && audio.selection() ? audio.selection()! : { start: 0, end: audio.length };
  const cached = ui().stats;
  if (cached && cached.version === audio.doc.version && cached.range.start === range.start && cached.range.end === range.end) return cached.data;
  const version = audio.doc.version;
  setUI({ statsRunning: true });
  try {
    const acc = new StatsAccumulator(audio.doc.channels.length, audio.sampleRate);
    const channels = audio.doc.channels;
    await sliced(range.end - range.start, 1 << 18, (from, to) => acc.push(channels, range.start + from, range.start + to), undefined, signal);
    if (version !== audio.doc.version) return null; // edited meanwhile
    const data = acc.result();
    setUI({ stats: { version, scope, range, data } });
    return data;
  } catch {
    return null;
  } finally {
    setUI({ statsRunning: false });
  }
}
