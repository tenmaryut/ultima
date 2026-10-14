/**
 * The waveform editor controller: owns the document, peak cache, player and DSP
 * worker, and implements view/selection management, playback and the basic edits.
 * React components read UI state from the zustand store (state.ts) and call these
 * methods. Effects, generators and analysis live in ops.ts; files in files.ts.
 */
import { t } from '../../core/i18n';
import { uid } from '../../core/utils/id';
import { toast } from '../../components/ui';
import { AudioDocument, copyRange, type ChangeEvent, type Marker } from './engine/document';
import { PeakCache } from './engine/peaks';
import { ChunkPlayer, channelSource } from './engine/player';
import { CancelledError, DspClient } from './engine/dspClient';
import { matchChannelCount } from './dsp/basic';
import { resampleChannels } from './dsp/time';
import type { NoiseProfile } from './dsp/noise';
import { setUI, ui, type Sel, type View } from './state';

export const MIN_SPP = 1 / 64;

export function isSel(v: unknown): v is Sel {
  return Boolean(v) && typeof (v as Sel).start === 'number' && typeof (v as Sel).end === 'number';
}

export class AudioController {
  readonly doc = new AudioDocument({ maxSteps: 100, maxBytes: 1024 * 1024 * 1024 });
  readonly peaks = new PeakCache();
  readonly player = new ChunkPlayer();
  readonly dsp = new DspClient();
  clipboard: { sampleRate: number; channels: Float32Array[] } | null = null;
  noiseProfile: NoiseProfile | null = null;
  /** Path of the .ultima project on disk (desktop) for Save. */
  projectPath: string | undefined;
  /** Description of the opened file's format. */
  sourceFormat = '';
  /** Width of the waveform area in CSS pixels (set by the view). */
  viewWidth = 800;
  /** Where the current playback started (Stop returns here). */
  private playStart = 0;
  private busyAbort: AbortController | null = null;
  /** Called after playback stops (multitrack view uses it too). */
  onPlaybackStateChange: (() => void) | null = null;

  constructor() {
    this.doc.subscribe((e) => this.onDocChange(e));
    this.player.onEnded = () => {
      const { playingMix, previewing } = ui();
      setUI({ playing: false, playingMix: false, previewing: false });
      if (!playingMix && !previewing) this.setCursor(this.playStart);
      this.onPlaybackStateChange?.();
    };
  }

  /* ------------------------------- basics ------------------------------- */

  get length(): number {
    return this.doc.length;
  }

  get sampleRate(): number {
    return this.doc.sampleRate;
  }

  get hasAudio(): boolean {
    return this.doc.channels.length > 0;
  }

  toSeconds(samples: number): number {
    return samples / this.doc.sampleRate;
  }

  toSamples(seconds: number): number {
    return Math.round(seconds * this.doc.sampleRate);
  }

  private onDocChange(e: ChangeEvent): void {
    if (e.source === 'load') this.peaks.reset(this.doc.channels);
    else this.peaks.invalidate(this.doc.channels, e.change);
    const len = this.length;
    let selection = ui().selection;
    if ((e.source === 'undo' || e.source === 'redo') && (e.restore === null || isSel(e.restore))) selection = e.restore as Sel | null;
    if (selection) {
      const start = Math.max(0, Math.min(len, selection.start));
      const end = Math.max(0, Math.min(len, selection.end));
      selection = end - start >= 1 ? { start, end } : null;
    }
    setUI({ revision: this.doc.version, selection, cursor: Math.min(ui().cursor, len) });
    if (this.player.playing && !ui().playingMix && !ui().previewing) {
      this.player.setSource(channelSource(this.doc.channels, this.doc.sampleRate));
    }
    this.setView(ui().view);
  }

  /* ------------------------------ selection ------------------------------ */

  selection(): Sel | null {
    const s = ui().selection;
    return s && s.end - s.start >= 1 ? s : null;
  }

  /** The selection, or the whole file when nothing is selected. */
  rangeOrAll(): Sel {
    return this.selection() ?? { start: 0, end: this.length };
  }

  setSelection(sel: Sel | null): void {
    if (!sel) {
      setUI({ selection: null });
      return;
    }
    const len = this.length;
    const a = Math.max(0, Math.min(len, Math.round(Math.min(sel.start, sel.end))));
    const b = Math.max(0, Math.min(len, Math.round(Math.max(sel.start, sel.end))));
    setUI({ selection: b - a >= 1 ? { start: a, end: b } : null });
  }

  setCursor(pos: number): void {
    const c = Math.max(0, Math.min(this.length, Math.round(pos)));
    setUI({ cursor: c });
    if (!this.player.playing) this.playStart = c;
  }

  selectAll(): void {
    if (!this.length) return;
    this.setSelection({ start: 0, end: this.length });
  }

  /* -------------------------------- view -------------------------------- */

  maxSpp(): number {
    return Math.max(MIN_SPP * 4, (this.length || this.doc.sampleRate * 10) / Math.max(50, this.viewWidth));
  }

  setView(v: View): void {
    const spp = Math.min(this.maxSpp(), Math.max(MIN_SPP, v.spp));
    const maxStart = Math.max(0, this.length - this.viewWidth * spp);
    const start = Math.min(maxStart, Math.max(0, v.start));
    const cur = ui().view;
    if (cur.start !== start || cur.spp !== spp) setUI({ view: { start, spp } });
  }

  zoomFit(): void {
    this.setView({ start: 0, spp: this.maxSpp() });
  }

  /** Zooms by `factor` (>1 = zoom in) keeping `anchor` (sample) at the same screen x. */
  zoomBy(factor: number, anchor?: number): void {
    const v = ui().view;
    const width = this.viewWidth;
    let a = anchor;
    if (a === undefined) {
      const playhead = this.player.playing ? this.player.position() : null;
      const ref = playhead ?? ui().cursor;
      a = ref >= v.start && ref <= v.start + width * v.spp ? ref : v.start + (width * v.spp) / 2;
    }
    const x = (a - v.start) / v.spp;
    const spp = Math.min(this.maxSpp(), Math.max(MIN_SPP, v.spp / factor));
    this.setView({ start: a - x * spp, spp });
  }

  zoomToSelection(): void {
    const sel = this.selection();
    if (!sel) {
      this.zoomFit();
      return;
    }
    const len = sel.end - sel.start;
    const spp = Math.max(MIN_SPP, (len * 1.1) / Math.max(50, this.viewWidth));
    this.setView({ start: sel.start - len * 0.05, spp });
  }

  /** Scrolls so `pos` is visible (page-style when following playback). */
  scrollToShow(pos: number, page = false): void {
    const v = ui().view;
    const span = this.viewWidth * v.spp;
    if (pos >= v.start && pos <= v.start + span) return;
    this.setView({ start: page ? pos - span * 0.05 : pos - span / 2, spp: v.spp });
  }

  /* ------------------------------ playback ------------------------------ */

  async play(options: { from?: number; ignoreSelection?: boolean } = {}): Promise<void> {
    if (!this.length) return;
    const sel = options.ignoreSelection ? null : this.selection();
    let from = options.from ?? ui().cursor;
    let to = this.length;
    let loop: Sel | null = null;
    if (sel) {
      if (from < sel.start || from >= sel.end - 1) from = sel.start;
      to = sel.end;
      if (ui().loop) loop = sel;
    } else {
      if (from >= this.length - 1) from = 0;
      if (ui().loop) loop = { start: 0, end: this.length };
    }
    this.playStart = from;
    try {
      await this.player.play(channelSource(this.doc.channels, this.doc.sampleRate), { from, to, loop });
      setUI({ playing: true, playingMix: false, previewing: false });
    } catch (error) {
      toast.error(t('Playback failed'), error instanceof Error ? error.message : String(error));
    }
    this.onPlaybackStateChange?.();
  }

  /** Stops and leaves the cursor where playback was. */
  pause(): void {
    const pos = this.player.position();
    const mix = ui().playingMix;
    this.player.stop();
    setUI({ playing: false, playingMix: false, previewing: false });
    if (pos !== null && !mix) {
      setUI({ cursor: Math.min(this.length, pos) });
      this.playStart = Math.min(this.length, pos);
    }
    this.onPlaybackStateChange?.();
  }

  /** Stops and returns the cursor to where playback started. */
  stop(): void {
    const mix = ui().playingMix;
    this.player.stop();
    setUI({ playing: false, playingMix: false, previewing: false });
    if (!mix) setUI({ cursor: this.playStart });
    this.onPlaybackStateChange?.();
  }

  togglePlay(): void {
    if (ui().playing) this.pause();
    else void this.play();
  }

  toggleLoop(): void {
    const loop = !ui().loop;
    setUI({ loop });
    if (this.player.playing && !ui().playingMix && !ui().previewing) {
      const sel = this.selection();
      this.player.setLoop(loop ? (sel ?? { start: 0, end: this.length }) : null);
    }
  }

  /* ------------------------------ busy jobs ------------------------------ */

  get busy(): boolean {
    return Boolean(ui().busy);
  }

  /**
   * Runs a long job with a progress overlay. Errors are reported as toasts; returns
   * null when it failed or was cancelled.
   */
  async runBusy<T>(label: string, job: (signal: AbortSignal, progress: (f: number) => void) => Promise<T>, cancellable = true): Promise<T | null> {
    if (this.busyAbort) {
      toast.info(t('Please wait for the current operation to finish'));
      return null;
    }
    const ctrl = new AbortController();
    this.busyAbort = ctrl;
    let lastUpdate = 0;
    setUI({ busy: { label, progress: null, cancel: cancellable ? () => ctrl.abort() : undefined } });
    const progress = (f: number) => {
      const now = performance.now();
      if (now - lastUpdate < 60 && f < 1) return;
      lastUpdate = now;
      const b = ui().busy;
      if (b) setUI({ busy: { ...b, progress: Math.max(0, Math.min(1, f)) } });
    };
    try {
      return await job(ctrl.signal, progress);
    } catch (error) {
      if (error instanceof CancelledError || (error as Error)?.name === 'AbortError') toast.info(t('Cancelled'));
      else toast.error(label.replace(/…$/, ''), error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      this.busyAbort = null;
      setUI({ busy: null });
    }
  }

  /* ------------------------------ clipboard ------------------------------ */

  /** Converts audio to the document's channel count and sample rate (copying). */
  fitToDoc(channels: Float32Array[], sampleRate: number): Float32Array[] {
    let out = matchChannelCount(channels.map((c) => c.slice()), Math.max(1, this.doc.channels.length));
    if (sampleRate !== this.doc.sampleRate) out = resampleChannels(out, sampleRate, this.doc.sampleRate);
    return out;
  }

  private requireSelection(): Sel | null {
    const sel = this.selection();
    if (!sel) toast.info(t('Select a range first'), t('Drag across the waveform to select audio.'));
    return sel;
  }

  copy(): boolean {
    const sel = this.requireSelection();
    if (!sel) return false;
    this.clipboard = { sampleRate: this.doc.sampleRate, channels: copyRange(this.doc.channels, sel.start, sel.end) };
    setUI({ clipboard: { duration: (sel.end - sel.start) / this.doc.sampleRate, channels: this.doc.channels.length } });
    return true;
  }

  cut(): void {
    if (this.copy()) this.deleteSelection(t('Cut'));
  }

  deleteSelection(label = t('Delete')): void {
    const sel = this.requireSelection();
    if (!sel) return;
    this.doc.replaceRange(sel.start, sel.end, null, label, { before: sel, after: null });
    setUI({ selection: null });
    this.setCursor(sel.start);
  }

  /**
   * Inserts audio at `at` (replacing `replace` when given). An empty document adopts the
   * inserted audio's format. Returns the inserted range.
   */
  insertAudio(channels: Float32Array[], sampleRate: number, at: number, label: string, replace: Sel | null = null): Sel {
    const before = this.selection();
    if (!this.length) {
      const len = channels[0]?.length ?? 0;
      this.doc.replaceAll(channels.map((c) => c.slice()), sampleRate, label, { before, after: { start: 0, end: len } });
      this.setSelection({ start: 0, end: len });
      this.setCursor(0);
      this.zoomFit();
      return { start: 0, end: len };
    }
    const data = this.fitToDoc(channels, sampleRate);
    const len = data[0]?.length ?? 0;
    const start = replace ? replace.start : at;
    const end = replace ? replace.end : at;
    const range = { start, end: start + len };
    this.doc.replaceRange(start, end, data, label, { before, after: range });
    this.setSelection(range);
    this.setCursor(start);
    return range;
  }

  paste(): void {
    const clip = this.clipboard;
    if (!clip) {
      toast.info(t('The clipboard is empty'), t('Copy or cut a selection first.'));
      return;
    }
    const sel = this.selection();
    this.insertAudio(clip.channels, clip.sampleRate, ui().cursor, t('Paste'), sel);
  }

  /** Mixes the clipboard over the audio at the cursor (selection start), extending the file if needed. */
  pasteMix(gain = 1): void {
    const clip = this.clipboard;
    if (!clip) {
      toast.info(t('The clipboard is empty'), t('Copy or cut a selection first.'));
      return;
    }
    if (!this.length) return this.paste();
    const data = this.fitToDoc(clip.channels, clip.sampleRate);
    const len = data[0].length;
    const start = this.selection()?.start ?? ui().cursor;
    const overlapEnd = Math.min(this.length, start + len);
    for (let c = 0; c < data.length; c++) {
      const src = this.doc.channels[c];
      for (let i = start; i < overlapEnd; i++) data[c][i - start] = src[i] + data[c][i - start] * gain;
      if (gain !== 1) for (let i = overlapEnd - start; i < len; i++) data[c][i] *= gain;
    }
    const range = { start, end: start + len };
    this.doc.replaceRange(start, overlapEnd, data, t('Mix paste'), { before: this.selection(), after: range });
    this.setSelection(range);
  }

  cropToSelection(): void {
    const sel = this.requireSelection();
    if (!sel) return;
    if (sel.start === 0 && sel.end === this.length) return;
    this.doc.begin(t('Crop'), sel);
    try {
      this.doc.replaceRange(sel.end, this.length, null, t('Crop'));
      this.doc.replaceRange(0, sel.start, null, t('Crop'));
    } finally {
      this.doc.commit({ start: 0, end: sel.end - sel.start });
    }
    this.setSelection({ start: 0, end: sel.end - sel.start });
    this.setCursor(0);
    this.zoomFit();
  }

  silenceSelection(): void {
    const sel = this.requireSelection();
    if (!sel) return;
    const zeros = this.doc.channels.map(() => new Float32Array(sel.end - sel.start));
    this.doc.replaceRange(sel.start, sel.end, zeros, t('Silence'), { before: sel, after: sel });
  }

  insertSilence(seconds: number): void {
    const n = Math.max(1, Math.round(Math.min(3600, Math.max(0.001, seconds)) * this.doc.sampleRate));
    const channels = Array.from({ length: Math.max(1, this.doc.channels.length || 2) }, () => new Float32Array(n));
    this.insertAudio(channels, this.doc.sampleRate, ui().cursor, t('Insert silence'));
  }

  duplicateSelection(): void {
    const sel = this.requireSelection();
    if (!sel) return;
    const data = copyRange(this.doc.channels, sel.start, sel.end);
    const range = { start: sel.end, end: sel.end + (sel.end - sel.start) };
    this.doc.replaceRange(sel.end, sel.end, data, t('Duplicate'), { before: sel, after: range });
    this.setSelection(range);
  }

  /* ------------------------------ history ------------------------------ */

  undo(): void {
    if (this.busy || this.doc.inTransaction) return;
    if (!this.doc.undo()) toast.info(t('Nothing to undo'));
  }

  redo(): void {
    if (this.busy || this.doc.inTransaction) return;
    if (!this.doc.redo()) toast.info(t('Nothing to redo'));
  }

  /* ------------------------------- markers ------------------------------- */

  addMarker(pos?: number, label?: string): Marker | null {
    if (!this.hasAudio) return null;
    const at = Math.max(0, Math.min(this.length, Math.round(pos ?? this.player.position() ?? ui().cursor)));
    const marker: Marker = { id: uid('mk'), pos: at, label: (label ?? '').trim() || t('Marker {n}', { n: this.doc.markers.length + 1 }) };
    this.doc.setMeta({ markers: [...this.doc.markers, marker] }, t('Add marker'), { before: this.selection(), after: this.selection() });
    return marker;
  }

  updateMarker(id: string, patch: Partial<Pick<Marker, 'pos' | 'label'>>): void {
    const markers = this.doc.markers.map((m) => (m.id === id ? { ...m, ...patch, pos: Math.max(0, Math.min(this.length, Math.round(patch.pos ?? m.pos))) } : m));
    this.doc.setMeta({ markers }, patch.label !== undefined ? t('Rename marker') : t('Move marker'), { before: this.selection(), after: this.selection() });
  }

  removeMarker(id: string): void {
    this.doc.setMeta({ markers: this.doc.markers.filter((m) => m.id !== id) }, t('Delete marker'), { before: this.selection(), after: this.selection() });
  }

  clearMarkers(): void {
    if (!this.doc.markers.length) return;
    this.doc.setMeta({ markers: [] }, t('Clear markers'), { before: this.selection(), after: this.selection() });
  }

  /** Moves the cursor (or playback) to the previous/next marker. */
  jumpToMarker(direction: 1 | -1): void {
    const ref = this.player.playing ? (this.player.position() ?? ui().cursor) : ui().cursor;
    const markers = this.doc.markers;
    const target = direction > 0 ? markers.find((m) => m.pos > ref + 1) : [...markers].reverse().find((m) => m.pos < ref - 1);
    const pos = target ? target.pos : direction > 0 ? this.length : 0;
    this.seek(pos);
  }

  /** Moves the cursor; restarts playback there when playing. */
  seek(pos: number): void {
    const p = Math.max(0, Math.min(this.length, Math.round(pos)));
    if (this.player.playing && !ui().playingMix && !ui().previewing) {
      this.setCursor(p);
      void this.play({ from: p, ignoreSelection: !this.selection() || p < this.selection()!.start || p >= this.selection()!.end });
    } else this.setCursor(p);
    this.scrollToShow(p);
  }

  /** Moves the cursor by `seconds` (keyboard nudge); extends the selection with `extend`. */
  nudge(seconds: number, extend: boolean): void {
    const delta = this.toSamples(seconds);
    const cursor = ui().cursor;
    const next = Math.max(0, Math.min(this.length, cursor + delta));
    if (extend) {
      const sel = this.selection();
      const anchor = sel ? (cursor === sel.start ? sel.end : sel.start) : cursor;
      this.setSelection({ start: Math.min(anchor, next), end: Math.max(anchor, next) });
    }
    this.setCursor(next);
    this.scrollToShow(next);
  }

  dispose(): void {
    this.player.dispose();
    this.dsp.dispose();
  }
}

export const audio = new AudioController();
