/**
 * Snapshot undo/redo for immutable documents with a memory budget.
 *
 * States share unchanged pixel buffers by reference, so a step only costs the layers it
 * changed. `estimate(state)` lists the big objects a state references (with their byte
 * sizes); the history drops its oldest steps while the union of all retained objects exceeds
 * `maxBytes` (or there are more than `maxSteps` steps).
 */

export interface HistoryEntry<T> {
  state: T;
  label: string;
}

export interface HistoryOptions<T> {
  maxSteps: number;
  maxBytes: number;
  estimate?: (state: T) => Iterable<[object, number]>;
}

export interface HistoryRow {
  label: string;
  index: number;
  current: boolean;
  future: boolean;
}

export class DocHistory<T> {
  private _present: T;
  /** State at the time of the last recorded step (base for live edits). */
  private anchor: T;
  past: HistoryEntry<T>[] = [];
  future: HistoryEntry<T>[] = [];
  /** Label of the oldest retained state ("Open", "New", or the label of a dropped step). */
  baseLabel: string;
  version = 0;
  private listeners = new Set<() => void>();

  constructor(
    initial: T,
    label: string,
    private readonly options: HistoryOptions<T>,
  ) {
    this._present = initial;
    this.anchor = initial;
    this.baseLabel = label;
  }

  get present(): T {
    return this._present;
  }

  get canUndo(): boolean {
    return this.past.length > 0 || this._present !== this.anchor;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** True when there are live (unrecorded) changes. */
  get hasLiveChanges(): boolean {
    return this._present !== this.anchor;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  set(next: T, options: { record?: boolean; label?: string } = {}): void {
    if (Object.is(next, this._present)) return;
    const record = options.record ?? true;
    this._present = next;
    if (record) {
      this.push(this.anchor, options.label ?? 'Edit');
      this.anchor = next;
    }
    this.emit();
  }

  /** Records the live changes made with `set(..., { record: false })` as one step. */
  commit(label = 'Edit'): void {
    if (Object.is(this.anchor, this._present)) return;
    this.push(this.anchor, label);
    this.anchor = this._present;
    this.emit();
  }

  /** Throws away live (unrecorded) changes. */
  discardLive(): void {
    if (Object.is(this.anchor, this._present)) return;
    this._present = this.anchor;
    this.emit();
  }

  undo(): void {
    if (this.hasLiveChanges) {
      this.discardLive();
      return;
    }
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ state: this._present, label: entry.label });
    this._present = entry.state;
    this.anchor = entry.state;
    this.emit();
  }

  redo(): void {
    if (this.hasLiveChanges) this.commit();
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ state: this._present, label: entry.label });
    this._present = entry.state;
    this.anchor = entry.state;
    this.emit();
  }

  /** Jump so that `index` steps are applied (0 = the oldest retained state). */
  jumpTo(index: number): void {
    if (this.hasLiveChanges) this.commit();
    let guard = 10_000;
    while (this.past.length > index && guard-- > 0) this.undo();
    while (this.past.length < index && this.future.length && guard-- > 0) this.redo();
  }

  reset(state: T, label: string): void {
    this.past = [];
    this.future = [];
    this._present = state;
    this.anchor = state;
    this.baseLabel = label;
    this.emit();
  }

  /** Timeline for a History panel: oldest state, applied steps, then redoable steps. */
  rows(): HistoryRow[] {
    const rows: HistoryRow[] = [{ label: this.baseLabel, index: 0, current: this.past.length === 0, future: false }];
    this.past.forEach((p, i) => rows.push({ label: p.label, index: i + 1, current: i === this.past.length - 1, future: false }));
    const n = this.past.length;
    [...this.future].reverse().forEach((f, i) => rows.push({ label: f.label, index: n + i + 1, current: false, future: true }));
    return rows;
  }

  /** Bytes referenced by all retained states (shared objects counted once). */
  memoryBytes(): number {
    const estimate = this.options.estimate;
    if (!estimate) return 0;
    const seen = new Set<object>();
    let total = 0;
    const visit = (state: T) => {
      for (const [obj, bytes] of estimate(state)) {
        if (seen.has(obj)) continue;
        seen.add(obj);
        total += bytes;
      }
    };
    visit(this._present);
    visit(this.anchor);
    for (const e of this.past) visit(e.state);
    for (const e of this.future) visit(e.state);
    return total;
  }

  private push(state: T, label: string): void {
    this.past.push({ state, label });
    this.future = [];
    this.trim();
  }

  private trim(): void {
    while (this.past.length > this.options.maxSteps) this.dropOldest();
    if (!this.options.estimate) return;
    while (this.past.length > 1 && this.memoryBytes() > this.options.maxBytes) this.dropOldest();
  }

  private dropOldest(): void {
    // the label of the dropped step now describes the oldest retained state
    const dropped = this.past.shift();
    if (dropped) this.baseLabel = dropped.label;
  }
}
