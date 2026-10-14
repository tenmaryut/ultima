import { create } from 'zustand';
import type { EffectId } from './dsp/effects';
import type { AudioStats } from './dsp/analysis';

/** Selection in samples (start < end). */
export interface Sel {
  start: number;
  end: number;
}

/** Visible range: first visible sample (may be fractional) and samples per CSS pixel. */
export interface View {
  start: number;
  spp: number;
}

export type GeneratorKind = 'tone' | 'noise' | 'silence' | 'dtmf';

export type DialogState =
  | { kind: 'effect'; effect: EffectId }
  | { kind: 'generate'; generator: GeneratorKind }
  | { kind: 'export'; selectionOnly?: boolean; multitrack?: boolean }
  | { kind: 'record' }
  | { kind: 'removeSilence' }
  | { kind: 'resample' }
  | { kind: 'notes'; title: string; text: string }
  | { kind: 'newFile' }
  | { kind: 'speech' };

export interface BusyState {
  label: string;
  /** 0..1, or null for indeterminate. */
  progress: number | null;
  cancel?: () => void;
}

export interface StatsState {
  version: number;
  scope: 'all' | 'selection';
  range: Sel;
  data: AudioStats;
}

export interface AudioUIState {
  tab: 'waveform' | 'multitrack';
  /** Bumped on every document change (re-render trigger). */
  revision: number;
  /** Bumped on every multitrack session change. */
  mtRevision: number;
  /** Bumped after saving/exporting (dirty flag changed). */
  savedTick: number;
  docName: string;
  selection: Sel | null;
  cursor: number;
  view: View;
  ampZoom: number;
  spectral: boolean;
  spectralLog: boolean;
  follow: boolean;
  loop: boolean;
  playing: boolean;
  /** Playback is of the multitrack mix (vs. the waveform). */
  playingMix: boolean;
  /** Effect preview is playing. */
  previewing: boolean;
  busy: BusyState | null;
  dialog: DialogState | null;
  hover: number | null;
  noisePrint: { duration: number } | null;
  clipboard: { duration: number; channels: number } | null;
  stats: StatsState | null;
  statsRunning: boolean;
  transcribing: boolean;
  set: (patch: Partial<AudioUIState>) => void;
}

export const useAudioUI = create<AudioUIState>()((set) => ({
  tab: 'waveform',
  revision: 0,
  mtRevision: 0,
  savedTick: 0,
  /** '' until a file is opened or named (shown as “Untitled” in the UI language). */
  docName: '',
  selection: null,
  cursor: 0,
  view: { start: 0, spp: 100 },
  ampZoom: 1,
  spectral: false,
  spectralLog: true,
  follow: true,
  loop: false,
  playing: false,
  playingMix: false,
  previewing: false,
  busy: null,
  dialog: null,
  hover: null,
  noisePrint: null,
  clipboard: null,
  stats: null,
  statsRunning: false,
  transcribing: false,
  set: (patch) => set(patch),
}));

export const ui = () => useAudioUI.getState();
export const setUI = (patch: Partial<AudioUIState>) => useAudioUI.getState().set(patch);
