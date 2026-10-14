/**
 * Waveform document + undo/redo.
 *
 * The audio lives in planar Float32Arrays. Every edit is expressed as a *splice*
 * (replace samples [start, start+length) with new data) or a full replacement (channel
 * count / sample-rate changes). Undo records only store the samples that were replaced
 * (the changed range), plus markers/transcript, so memory stays bounded; the history
 * is additionally capped by step count and total bytes. Several edits can be grouped
 * into one undo step with begin()/commit() (used for AI replies and multi-range edits).
 *
 * Pure TypeScript (no DOM) — unit tested.
 */

export interface Marker {
  id: string;
  /** Position in samples. */
  pos: number;
  label: string;
}

export interface TranscriptSegment {
  id: string;
  /** Samples. */
  start: number;
  end: number;
  text: string;
}

export interface DocMeta {
  markers: Marker[];
  transcript: TranscriptSegment[];
}

export interface DocState extends DocMeta {
  sampleRate: number;
  channels: Float32Array[];
}

export type ChangeInfo =
  | { kind: 'range'; start: number; end: number }
  | { kind: 'splice'; start: number }
  | { kind: 'full' }
  | { kind: 'meta' };

type SpliceRecord = { type: 'splice'; start: number; length: number; data: Float32Array[]; meta: DocMeta };
type FullRecord = { type: 'full'; sampleRate: number; channels: Float32Array[]; meta: DocMeta };
type MetaRecord = { type: 'meta'; meta: DocMeta };
type CompoundRecord = { type: 'compound'; records: EditRecord[] };
export type EditRecord = SpliceRecord | FullRecord | MetaRecord | CompoundRecord;

interface Entry {
  id: number;
  label: string;
  record: EditRecord;
  bytes: number;
  before?: unknown;
  after?: unknown;
}

export type MetaMode = 'shift' | 'scale';

export interface EditOptions {
  /** How markers/transcript inside the replaced range move: 'shift' (cut/paste) or 'scale' (speed change). */
  metaMode?: MetaMode;
  /** Opaque UI state restored on undo (e.g. the selection before the edit). */
  before?: unknown;
  /** Opaque UI state restored on redo. */
  after?: unknown;
}

export interface ChangeEvent {
  change: ChangeInfo;
  /** UI state to restore after undo/redo. */
  restore?: unknown;
  source: 'edit' | 'undo' | 'redo' | 'load';
}

/* ------------------------------ helpers ------------------------------ */

export function lengthOf(ch: Float32Array[]): number {
  return ch[0]?.length ?? 0;
}

export function copyRange(ch: Float32Array[], start: number, end: number): Float32Array[] {
  return ch.map((c) => c.slice(start, end));
}

function recordBytes(rec: EditRecord): number {
  switch (rec.type) {
    case 'splice':
      return rec.data.reduce((s, c) => s + c.byteLength, 0) + 256;
    case 'full':
      return rec.channels.reduce((s, c) => s + c.byteLength, 0) + 256;
    case 'meta':
      return 256 + rec.meta.markers.length * 64 + rec.meta.transcript.length * 128;
    case 'compound':
      return rec.records.reduce((s, r) => s + recordBytes(r), 0);
  }
}

export function mergeChanges(a: ChangeInfo | null, b: ChangeInfo): ChangeInfo {
  if (!a) return b;
  if (a.kind === 'full' || b.kind === 'full') return { kind: 'full' };
  if (a.kind === 'meta') return b;
  if (b.kind === 'meta') return a;
  const startA = a.start;
  const startB = b.start;
  if (a.kind === 'range' && b.kind === 'range') return { kind: 'range', start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
  return { kind: 'splice', start: Math.min(startA, startB) };
}

/** Maps a position through a splice of [start, start+removed) → `inserted` samples. */
export function mapPosition(pos: number, start: number, removed: number, inserted: number, mode: MetaMode): number {
  const end = start + removed;
  if (pos < start) return pos;
  if (pos >= end) return pos + (inserted - removed);
  if (mode === 'scale' && removed > 0) return start + Math.round(((pos - start) * inserted) / removed);
  return start + Math.min(pos - start, inserted);
}

export function shiftMeta(meta: DocMeta, start: number, removed: number, inserted: number, mode: MetaMode): DocMeta {
  if (removed === inserted && mode === 'shift') return meta;
  const end = start + removed;
  const markers: Marker[] = [];
  for (const m of meta.markers) {
    // markers strictly inside a deleted range disappear with the audio
    if (inserted === 0 && removed > 0 && m.pos > start && m.pos < end) continue;
    markers.push({ ...m, pos: mapPosition(m.pos, start, removed, inserted, mode) });
  }
  const transcript: TranscriptSegment[] = [];
  for (const s of meta.transcript) {
    const a = mapPosition(s.start, start, removed, inserted, mode);
    const b = mapPosition(s.end, start, removed, inserted, mode);
    if (b - a <= 0) continue;
    transcript.push({ ...s, start: a, end: b });
  }
  return { markers: markers.sort((x, y) => x.pos - y.pos), transcript };
}

/* -------------------------------- core -------------------------------- */

export interface HistoryLimits {
  maxSteps: number;
  maxBytes: number;
}

export class AudioDocument {
  sampleRate = 48000;
  channels: Float32Array[] = [];
  markers: Marker[] = [];
  transcript: TranscriptSegment[] = [];
  /** Increments on every change (cache key for peaks/stats). */
  version = 0;

  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private undoBytes = 0;
  private nextId = 1;
  private savedId = 0;
  private tx: { label: string; records: EditRecord[]; before?: unknown; change: ChangeInfo | null } | null = null;
  private listeners = new Set<(e: ChangeEvent) => void>();
  readonly limits: HistoryLimits;

  constructor(limits: Partial<HistoryLimits> = {}) {
    this.limits = { maxSteps: limits.maxSteps ?? 100, maxBytes: limits.maxBytes ?? 1024 * 1024 * 1024 };
  }

  get length(): number {
    return lengthOf(this.channels);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  get isEmpty(): boolean {
    return this.length === 0;
  }

  subscribe(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ChangeEvent): void {
    this.version++;
    for (const fn of this.listeners) fn(e);
  }

  private meta(): DocMeta {
    return { markers: this.markers, transcript: this.transcript };
  }

  private setMetaState(meta: DocMeta): void {
    this.markers = meta.markers;
    this.transcript = meta.transcript;
  }

  /** Replaces the whole document and clears the history. */
  load(state: DocState): void {
    this.sampleRate = state.sampleRate;
    this.channels = state.channels;
    this.markers = [...state.markers].sort((a, b) => a.pos - b.pos);
    this.transcript = state.transcript;
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.tx = null;
    this.savedId = 0;
    this.emit({ change: { kind: 'full' }, source: 'load' });
  }

  /* ---------------------------- history state ---------------------------- */

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.tx;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.tx;
  }

  get undoLabels(): string[] {
    return this.undoStack.map((e) => e.label);
  }

  get redoLabels(): string[] {
    return [...this.redoStack].reverse().map((e) => e.label);
  }

  get historyBytes(): number {
    return this.undoBytes + this.redoStack.reduce((s, e) => s + e.bytes, 0);
  }

  private currentId(): number {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].id : 0;
  }

  get dirty(): boolean {
    return this.currentId() !== this.savedId;
  }

  markSaved(): void {
    this.savedId = this.currentId();
  }

  /** Forces the dirty flag (e.g. a freshly recorded document that was never saved). */
  markUnsaved(): void {
    this.savedId = -1;
  }

  /* ------------------------------ transactions ------------------------------ */

  get inTransaction(): boolean {
    return Boolean(this.tx);
  }

  begin(label: string, before?: unknown): void {
    if (this.tx) throw new Error('A transaction is already open');
    this.tx = { label, records: [], before, change: null };
  }

  /** Ends the transaction, pushing ONE undo step (nothing if no edits happened). */
  commit(after?: unknown): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    if (!tx.records.length) return;
    const record: EditRecord = tx.records.length === 1 ? tx.records[0] : { type: 'compound', records: tx.records };
    this.pushUndo({ id: this.nextId++, label: tx.label, record, bytes: recordBytes(record), before: tx.before, after });
  }

  /** Reverts every edit of the open transaction. */
  rollback(): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    if (!tx.records.length) return;
    let change: ChangeInfo | null = null;
    for (let i = tx.records.length - 1; i >= 0; i--) {
      const res = this.applyRecord(tx.records[i]);
      change = mergeChanges(change, res.change);
    }
    if (change) this.emit({ change, restore: tx.before, source: 'undo' });
  }

  private pushUndo(entry: Entry): void {
    this.undoStack.push(entry);
    this.undoBytes += entry.bytes;
    this.redoStack = [];
    // bounded memory: drop the oldest steps (always keep the newest one)
    while (this.undoStack.length > 1 && (this.undoStack.length > this.limits.maxSteps || this.undoBytes > this.limits.maxBytes)) {
      const dropped = this.undoStack.shift()!;
      this.undoBytes -= dropped.bytes;
      if (dropped.id === this.savedId) this.savedId = -1; // saved state no longer reachable
    }
  }

  private record(label: string, rec: EditRecord, change: ChangeInfo, opts: EditOptions): void {
    if (this.tx) {
      this.tx.records.push(rec);
      this.tx.change = mergeChanges(this.tx.change, change);
    } else {
      this.pushUndo({ id: this.nextId++, label, record: rec, bytes: recordBytes(rec), before: opts.before, after: opts.after });
    }
    this.emit({ change, source: 'edit' });
  }

  /* --------------------------------- edits --------------------------------- */

  /**
   * Replaces samples [start, end) with `data` (null = delete). `data` must have the
   * document's channel count. Returns the new end of the inserted region.
   */
  replaceRange(start: number, end: number, data: Float32Array[] | null, label: string, opts: EditOptions = {}): number {
    const len = this.length;
    const s = Math.max(0, Math.min(len, Math.round(start)));
    const e = Math.max(s, Math.min(len, Math.round(end)));
    const insert = data ?? [];
    const inserted = data ? lengthOf(data) : 0;
    if (data && data.length !== this.channels.length) throw new Error('Channel count mismatch');
    const removed = e - s;
    if (removed === 0 && inserted === 0) return s;
    const before = this.meta();
    const undo: SpliceRecord = { type: 'splice', start: s, length: inserted, data: copyRange(this.channels, s, e), meta: before };
    let change: ChangeInfo;
    if (inserted === removed) {
      for (let c = 0; c < this.channels.length; c++) this.channels[c].set(insert[c], s);
      change = { kind: 'range', start: s, end: e };
    } else {
      this.channels = this.channels.map((old, c) => {
        const out = new Float32Array(len - removed + inserted);
        out.set(old.subarray(0, s), 0);
        if (inserted) out.set(insert[c], s);
        out.set(old.subarray(e), s + inserted);
        return out;
      });
      change = { kind: 'splice', start: s };
    }
    this.setMetaState(shiftMeta(before, s, removed, inserted, opts.metaMode ?? 'shift'));
    this.record(label, undo, change, opts);
    return s + inserted;
  }

  /** Replaces all audio (channel-count or sample-rate changes). The old arrays become the undo data. */
  replaceAll(channels: Float32Array[], sampleRate: number, label: string, opts: EditOptions & { meta?: DocMeta } = {}): void {
    const undo: FullRecord = { type: 'full', sampleRate: this.sampleRate, channels: this.channels, meta: this.meta() };
    this.channels = channels;
    this.sampleRate = sampleRate;
    if (opts.meta) this.setMetaState(opts.meta);
    this.record(label, undo, { kind: 'full' }, opts);
  }

  /** Changes markers and/or transcript as one undoable step. */
  setMeta(patch: Partial<DocMeta>, label: string, opts: EditOptions = {}): void {
    const undo: MetaRecord = { type: 'meta', meta: this.meta() };
    this.setMetaState({
      markers: patch.markers ? [...patch.markers].sort((a, b) => a.pos - b.pos) : this.markers,
      transcript: patch.transcript ?? this.transcript,
    });
    this.record(label, undo, { kind: 'meta' }, opts);
  }

  /* ------------------------------ undo / redo ------------------------------ */

  private applyRecord(rec: EditRecord): { inverse: EditRecord; change: ChangeInfo } {
    switch (rec.type) {
      case 'splice': {
        const len = this.length;
        const s = Math.min(rec.start, len);
        const e = Math.min(len, s + rec.length);
        const inserted = lengthOf(rec.data);
        const inverse: SpliceRecord = { type: 'splice', start: s, length: inserted, data: copyRange(this.channels, s, e), meta: this.meta() };
        let change: ChangeInfo;
        if (inserted === e - s && rec.data.length === this.channels.length) {
          for (let c = 0; c < this.channels.length; c++) this.channels[c].set(rec.data[c], s);
          change = { kind: 'range', start: s, end: e };
        } else {
          this.channels = rec.data.map((d, c) => {
            const old = this.channels[c] ?? this.channels[0];
            const out = new Float32Array(len - (e - s) + inserted);
            out.set(old.subarray(0, s), 0);
            out.set(d, s);
            out.set(old.subarray(e), s + inserted);
            return out;
          });
          change = { kind: 'splice', start: s };
        }
        this.setMetaState(rec.meta);
        return { inverse, change };
      }
      case 'full': {
        const inverse: FullRecord = { type: 'full', sampleRate: this.sampleRate, channels: this.channels, meta: this.meta() };
        this.channels = rec.channels;
        this.sampleRate = rec.sampleRate;
        this.setMetaState(rec.meta);
        return { inverse, change: { kind: 'full' } };
      }
      case 'meta': {
        const inverse: MetaRecord = { type: 'meta', meta: this.meta() };
        this.setMetaState(rec.meta);
        return { inverse, change: { kind: 'meta' } };
      }
      case 'compound': {
        const inverses: EditRecord[] = [];
        let change: ChangeInfo | null = null;
        for (let i = rec.records.length - 1; i >= 0; i--) {
          const res = this.applyRecord(rec.records[i]);
          inverses.push(res.inverse);
          change = mergeChanges(change, res.change);
        }
        return { inverse: { type: 'compound', records: inverses }, change: change ?? { kind: 'meta' } };
      }
    }
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const entry = this.undoStack.pop()!;
    this.undoBytes -= entry.bytes;
    const { inverse, change } = this.applyRecord(entry.record);
    this.redoStack.push({ ...entry, record: inverse, bytes: recordBytes(inverse) });
    this.emit({ change, restore: entry.before, source: 'undo' });
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const entry = this.redoStack.pop()!;
    const { inverse, change } = this.applyRecord(entry.record);
    const back = { ...entry, record: inverse, bytes: recordBytes(inverse) };
    this.undoStack.push(back);
    this.undoBytes += back.bytes;
    this.emit({ change, restore: entry.after, source: 'redo' });
    return true;
  }

  /** Undo/redo until `count` steps are in the undo stack. */
  jumpTo(count: number): void {
    while (this.undoStack.length > count && this.undo());
    while (this.undoStack.length < count && this.redo());
  }
}
