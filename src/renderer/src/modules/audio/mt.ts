/**
 * Multitrack session controller: sources, tracks/clips (immutable session + snapshot
 * undo), mix playback through the shared player, mixdown to a new waveform document.
 */
import { t } from '../../core/i18n';
import { uid } from '../../core/utils/id';
import { fileBaseName } from '../../core/utils/format';
import { toast } from '../../components/ui';
import { PeakCache } from './engine/peaks';
import { copyRange } from './engine/document';
import { decodeFile } from './engine/io';
import {
  SnapshotHistory,
  addClip,
  addTrack,
  duplicateClip,
  emptySession,
  findClip,
  mixRange,
  moveClip,
  removeClip,
  removeTrack,
  sessionLength,
  splitClip,
  trimClip,
  updateTrack,
  type MtSession,
  type MtSource,
  type MtTrack,
} from './engine/multitrack';
import { audio } from './controller';
import { setUI, ui } from './state';

export interface SourceEntry extends MtSource {
  peaks: PeakCache;
}

export class MultitrackController {
  session: MtSession = emptySession(48000);
  sources = new Map<string, SourceEntry>();
  history = new SnapshotHistory<MtSession>(100);
  selectedClip: string | null = null;
  playhead = 0;
  view = { start: 0, spp: 1000 };
  viewWidth = 800;
  dirty = false;

  bump(): void {
    setUI({ mtRevision: ui().mtRevision + 1 });
  }

  get length(): number {
    return sessionLength(this.session);
  }

  get sampleRate(): number {
    return this.session.sampleRate;
  }

  /** Replaces the session state (records an undo step unless `record` is false). */
  set(next: MtSession, record = true, label = ''): void {
    if (next === this.session) return;
    if (record) this.history.push(this.session, label);
    this.session = next;
    this.dirty = true;
    if (this.selectedClip && !findClip(next, this.selectedClip)) this.selectedClip = null;
    this.bump();
  }

  /** Records `previous` as an undo step after a drag that used set(…, false). */
  commitFrom(previous: MtSession, label: string): void {
    if (previous !== this.session) this.history.push(previous, label);
  }

  undo(): void {
    const prev = this.history.undo(this.session);
    if (prev) {
      this.session = prev;
      this.bump();
    } else toast.info(t('Nothing to undo'));
  }

  redo(): void {
    const next = this.history.redo(this.session);
    if (next) {
      this.session = next;
      this.bump();
    } else toast.info(t('Nothing to redo'));
  }

  load(session: MtSession | null, sources: MtSource[]): void {
    this.stopIfPlaying();
    this.sources.clear();
    for (const s of sources) this.addSourceEntry(s);
    this.session = session ?? emptySession(48000);
    this.history.clear();
    this.selectedClip = null;
    this.playhead = 0;
    this.dirty = false;
    this.fit();
    this.bump();
  }

  private addSourceEntry(s: MtSource): SourceEntry {
    const peaks = new PeakCache();
    peaks.reset(s.channels);
    const entry = { ...s, peaks };
    this.sources.set(s.id, entry);
    return entry;
  }

  /** Adds audio as a new source and a clip on a new track at `at` (frames). */
  async addAudio(name: string, channels: Float32Array[], sampleRate: number, at = this.playhead): Promise<void> {
    let data = channels;
    if (!this.session.tracks.some((tr) => tr.clips.length)) {
      if (this.session.sampleRate !== sampleRate) this.session = { ...this.session, sampleRate };
    }
    if (sampleRate !== this.session.sampleRate) {
      const res = await audio.runBusy(t('Converting sample rate…'), (signal, progress) =>
        audio.dsp.run({ type: 'resample', channels: channels.map((c) => c.slice()), fromRate: sampleRate, toRate: this.session.sampleRate }, { signal, onProgress: progress, transfer: true }),
      );
      if (!res?.channels) return;
      data = res.channels;
    }
    const source = this.addSourceEntry({ id: uid('src'), name, sampleRate: this.session.sampleRate, channels: data });
    let next = addTrack(this.session, name.slice(0, 40));
    const track = next.tracks[next.tracks.length - 1];
    const added = addClip(next, track.id, { sourceId: source.id, start: Math.max(0, Math.round(at)), offset: 0, length: data[0]?.length ?? 0, gainDb: 0, fadeIn: 0, fadeOut: 0 });
    next = added.session;
    this.set(next, true, t('Add clip'));
    this.selectedClip = added.clipId;
    if (this.session.tracks.length === 1) this.fit();
    this.bump();
  }

  async importFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const loaded = await audio.runBusy(t('Opening {name}…', { name: file.name }), (_signal, progress) => decodeFile(file, progress), false);
      if (loaded) await this.addAudio(fileBaseName(file.name), loaded.channels, loaded.sampleRate, 0);
    }
  }

  /** Adds the waveform document (or its selection) as a clip. */
  async addFromWaveform(): Promise<void> {
    if (!audio.length) {
      toast.info(t('Open or record some audio first'));
      return;
    }
    const sel = audio.selection();
    const range = sel ?? { start: 0, end: audio.length };
    const name = `${fileBaseName(ui().docName) || t('Audio')}${sel ? ` (${t('selection')})` : ''}`;
    await this.addAudio(name, copyRange(audio.doc.channels, range.start, range.end), audio.sampleRate);
  }

  addTrack(): void {
    this.set(addTrack(this.session), true, t('Add track'));
  }

  removeTrack(id: string): void {
    this.set(removeTrack(this.session, id), true, t('Delete track'));
  }

  updateTrack(id: string, patch: Partial<Omit<MtTrack, 'id' | 'clips'>>, record = true): void {
    this.set(updateTrack(this.session, id, patch), record, t('Track settings'));
  }

  selectClip(id: string | null): void {
    this.selectedClip = id;
    this.bump();
  }

  deleteSelectedClip(): boolean {
    if (!this.selectedClip) return false;
    this.set(removeClip(this.session, this.selectedClip), true, t('Delete clip'));
    this.selectedClip = null;
    this.bump();
    return true;
  }

  duplicateSelectedClip(): boolean {
    if (!this.selectedClip) return false;
    const res = duplicateClip(this.session, this.selectedClip);
    this.set(res.session, true, t('Duplicate clip'));
    this.selectedClip = res.clipId;
    this.bump();
    return true;
  }

  splitAtPlayhead(): void {
    const id = this.selectedClip ?? this.clipUnderPlayhead();
    if (!id) {
      toast.info(t('Place the playhead over a clip to split it'));
      return;
    }
    this.set(splitClip(this.session, id, this.playhead), true, t('Split clip'));
  }

  private clipUnderPlayhead(): string | null {
    for (const tr of this.session.tracks) for (const c of tr.clips) if (this.playhead > c.start && this.playhead < c.start + c.length) return c.id;
    return null;
  }

  moveClip(id: string, start: number, trackId: string | undefined, record: boolean): void {
    this.set(moveClip(this.session, id, start, trackId), record, t('Move clip'));
  }

  trimClip(id: string, edge: 'start' | 'end', pos: number, record: boolean): void {
    const found = findClip(this.session, id);
    const src = found ? this.sources.get(found.clip.sourceId) : undefined;
    if (!found || !src) return;
    this.set(trimClip(this.session, id, edge, pos, src.channels[0]?.length ?? 0, Math.round(this.sampleRate * 0.01)), record, t('Trim clip'));
  }

  /* ------------------------------ view ------------------------------ */

  fit(): void {
    const len = Math.max(this.length, this.sampleRate * 30);
    this.view = { start: 0, spp: (len * 1.05) / Math.max(100, this.viewWidth) };
    this.bump();
  }

  zoomBy(factor: number, anchor?: number): void {
    const v = this.view;
    const a = anchor ?? this.playhead;
    const x = (a - v.start) / v.spp;
    const spp = Math.min(this.sampleRate * 60, Math.max(1, v.spp / factor));
    this.view = { start: Math.max(0, a - x * spp), spp };
    this.bump();
  }

  scrollTo(start: number): void {
    this.view = { ...this.view, start: Math.max(0, start) };
    this.bump();
  }

  /* ---------------------------- playback ---------------------------- */

  async play(): Promise<void> {
    const len = this.length;
    if (!len) {
      toast.info(t('Add clips to the session first'));
      return;
    }
    if (ui().playing) audio.stop();
    const sources = this.sources;
    const self = this;
    let from = this.playhead >= len - 1 ? 0 : this.playhead;
    if (from < 0) from = 0;
    try {
      await audio.player.play(
        {
          sampleRate: this.sampleRate,
          channelCount: 2,
          get length() {
            return sessionLength(self.session);
          },
          read: (start, count) => mixRange(self.session, sources, start, count),
        },
        { from, loop: ui().loop ? { start: 0, end: len } : null },
      );
      setUI({ playing: true, playingMix: true, previewing: false });
    } catch (error) {
      toast.error(t('Playback failed'), error instanceof Error ? error.message : String(error));
    }
  }

  pause(): void {
    const pos = audio.player.position();
    audio.player.stop();
    setUI({ playing: false, playingMix: false });
    if (pos !== null) this.playhead = pos;
    this.bump();
  }

  togglePlay(): void {
    if (ui().playing && ui().playingMix) this.pause();
    else void this.play();
  }

  stopIfPlaying(): void {
    if (ui().playingMix) {
      audio.player.stop();
      setUI({ playing: false, playingMix: false });
    }
  }

  /** Renders the whole mix (chunked so the UI stays responsive). */
  async renderMix(signal?: AbortSignal, onProgress?: (f: number) => void): Promise<Float32Array[]> {
    const len = this.length;
    const out = [new Float32Array(len), new Float32Array(len)];
    const step = 1 << 16;
    let last = performance.now();
    for (let pos = 0; pos < len; pos += step) {
      const n = Math.min(step, len - pos);
      const part = mixRange(this.session, this.sources, pos, n);
      out[0].set(part[0], pos);
      out[1].set(part[1], pos);
      if (performance.now() - last > 30) {
        onProgress?.(pos / len);
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      }
    }
    return out;
  }
}

export const mt = new MultitrackController();
