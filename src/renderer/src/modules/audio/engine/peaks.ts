/**
 * Multi-resolution peak cache for waveform drawing. Level 0 stores min / max / sum of
 * squares per 256 samples, every next level aggregates 4 buckets of the previous one.
 * Drawing any zoom level therefore touches at most ~4 buckets per pixel, which keeps
 * hour-long files smooth. After an edit only the changed range (or everything after a
 * length change) is recomputed, incrementally via pump(), so the UI never freezes.
 *
 * Pure TypeScript (no DOM) — unit tested.
 */
import type { ChangeInfo } from './document';

export const BASE_BUCKET = 256;
const FACTOR = 4;
const CHUNK = 1 << 18; // samples per pump step

interface Level {
  bucket: number;
  count: number;
  min: Float32Array[];
  max: Float32Array[];
  sq: Float32Array[];
}

export interface PeakColumns {
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
  /** 1 when the column has data, 0 when not yet computed / out of range. */
  valid: Uint8Array;
}

export function createColumns(pixels: number): PeakColumns {
  return { min: new Float32Array(pixels), max: new Float32Array(pixels), rms: new Float32Array(pixels), valid: new Uint8Array(pixels) };
}

export class PeakCache {
  private levels: Level[] = [];
  private channels: Float32Array[] = [];
  private length = 0;
  private dirtyFrom = 0;
  private dirtyTo = 0;

  /** Points the cache at new audio data and schedules a full recompute. */
  reset(channels: Float32Array[]): void {
    this.channels = channels;
    this.length = channels[0]?.length ?? 0;
    this.levels = this.allocate(this.length, channels.length, []);
    this.dirtyFrom = 0;
    this.dirtyTo = this.length;
  }

  /** Updates after an edit of the document (channels are the document's current arrays). */
  invalidate(channels: Float32Array[], change: ChangeInfo): void {
    if (change.kind === 'meta') {
      this.channels = channels;
      return;
    }
    if (change.kind === 'full' || channels.length !== this.channels.length) {
      this.reset(channels);
      return;
    }
    const oldLevels = this.levels;
    this.channels = channels;
    const newLength = channels[0]?.length ?? 0;
    if (change.kind === 'range' && newLength === this.length) {
      this.markDirty(change.start, change.end);
      return;
    }
    // length changed from change.start on: keep the untouched prefix
    const start = change.kind === 'splice' || change.kind === 'range' ? change.start : 0;
    this.length = newLength;
    this.levels = this.allocate(newLength, channels.length, oldLevels, start);
    const from = this.dirtyFrom < this.dirtyTo ? Math.min(this.dirtyFrom, start) : start;
    this.dirtyFrom = Math.max(0, Math.floor(from / BASE_BUCKET) * BASE_BUCKET);
    this.dirtyTo = newLength;
  }

  private markDirty(start: number, end: number): void {
    if (this.dirtyFrom >= this.dirtyTo) {
      this.dirtyFrom = start;
      this.dirtyTo = end;
    } else {
      this.dirtyFrom = Math.min(this.dirtyFrom, start);
      this.dirtyTo = Math.max(this.dirtyTo, end);
    }
    this.dirtyFrom = Math.max(0, Math.floor(this.dirtyFrom / BASE_BUCKET) * BASE_BUCKET);
    this.dirtyTo = Math.min(this.length, this.dirtyTo);
  }

  private allocate(length: number, channelCount: number, old: Level[], keepUntilSample = 0): Level[] {
    const levels: Level[] = [];
    let bucket = BASE_BUCKET;
    for (let li = 0; ; li++) {
      const count = Math.max(1, Math.ceil(length / bucket));
      const prev = old[li];
      const keep = prev ? Math.min(prev.count, count, Math.floor(keepUntilSample / bucket)) : 0;
      const make = (src?: Float32Array[]) =>
        Array.from({ length: channelCount }, (_, c) => {
          const arr = new Float32Array(count);
          if (keep > 0 && src?.[c]) arr.set(src[c].subarray(0, keep));
          return arr;
        });
      levels.push({ bucket, count, min: make(prev?.min), max: make(prev?.max), sq: make(prev?.sq) });
      if (count <= 1) break;
      bucket *= FACTOR;
    }
    return levels;
  }

  get dirty(): boolean {
    return this.dirtyFrom < this.dirtyTo;
  }

  /** Computes dirty buckets for up to `budgetMs`. Returns true when everything is up to date. */
  pump(budgetMs = 8): boolean {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    while (this.dirtyFrom < this.dirtyTo) {
      const from = this.dirtyFrom;
      const to = Math.min(this.dirtyTo, from + CHUNK);
      this.computeRange(from, to);
      this.dirtyFrom = to;
      if (now() - t0 > budgetMs) break;
    }
    return !this.dirty;
  }

  /** Synchronously completes all pending work. */
  flush(): void {
    while (!this.pump(1e9));
  }

  private computeRange(from: number, to: number): void {
    const l0 = this.levels[0];
    if (!l0) return;
    const b0 = Math.floor(from / BASE_BUCKET);
    const b1 = Math.min(l0.count, Math.ceil(to / BASE_BUCKET));
    for (let c = 0; c < this.channels.length; c++) {
      const data = this.channels[c];
      const mn = l0.min[c];
      const mx = l0.max[c];
      const sq = l0.sq[c];
      for (let b = b0; b < b1; b++) {
        const s = b * BASE_BUCKET;
        const e = Math.min(this.length, s + BASE_BUCKET);
        let lo = Infinity;
        let hi = -Infinity;
        let acc = 0;
        for (let i = s; i < e; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          acc += v * v;
        }
        if (e <= s) {
          lo = 0;
          hi = 0;
        }
        mn[b] = lo;
        mx[b] = hi;
        sq[b] = acc;
      }
    }
    // propagate to coarser levels
    for (let li = 1; li < this.levels.length; li++) {
      const prev = this.levels[li - 1];
      const lvl = this.levels[li];
      const k0 = Math.floor(from / lvl.bucket);
      const k1 = Math.min(lvl.count, Math.ceil(to / lvl.bucket));
      for (let c = 0; c < this.channels.length; c++) {
        for (let k = k0; k < k1; k++) {
          const p0 = k * FACTOR;
          const p1 = Math.min(prev.count, p0 + FACTOR);
          let lo = Infinity;
          let hi = -Infinity;
          let acc = 0;
          for (let p = p0; p < p1; p++) {
            if (prev.min[c][p] < lo) lo = prev.min[c][p];
            if (prev.max[c][p] > hi) hi = prev.max[c][p];
            acc += prev.sq[c][p];
          }
          if (p1 <= p0) {
            lo = 0;
            hi = 0;
          }
          lvl.min[c][k] = lo;
          lvl.max[c][k] = hi;
          lvl.sq[c][k] = acc;
        }
      }
    }
  }

  /**
   * Fills `out` with one column per pixel for samples starting at `start` with
   * `spp` samples per pixel (may be < 1 when zoomed in past single samples).
   */
  query(channel: number, start: number, spp: number, out: PeakColumns): void {
    const pixels = out.min.length;
    const data = this.channels[channel];
    out.valid.fill(0);
    if (!data || !this.length) return;
    const len = this.length;
    // choose the coarsest level whose bucket fits in one pixel
    let level: Level | null = null;
    for (const l of this.levels) if (l.bucket <= spp) level = l;
    const dirty = this.dirtyFrom < this.dirtyTo;
    for (let px = 0; px < pixels; px++) {
      const s0 = start + px * spp;
      const s1 = s0 + spp;
      if (s1 <= 0 || s0 >= len) continue;
      let a = Math.max(0, Math.floor(s0));
      let b = Math.min(len, Math.ceil(s1));
      if (b <= a) b = Math.min(len, a + 1);
      const inDirty = dirty && b > this.dirtyFrom && a < this.dirtyTo;
      if (!level || (inDirty && spp <= 8192)) {
        let lo = Infinity;
        let hi = -Infinity;
        let acc = 0;
        for (let i = a; i < b; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          acc += v * v;
        }
        out.min[px] = lo;
        out.max[px] = hi;
        out.rms[px] = Math.sqrt(acc / (b - a));
        out.valid[px] = 1;
        continue;
      }
      if (inDirty) continue;
      const bucket = level.bucket;
      const k0 = Math.floor(a / bucket);
      const k1 = Math.min(level.count, Math.max(k0 + 1, Math.ceil(b / bucket)));
      let lo = Infinity;
      let hi = -Infinity;
      let acc = 0;
      const mn = level.min[channel];
      const mx = level.max[channel];
      const sq = level.sq[channel];
      for (let k = k0; k < k1; k++) {
        if (mn[k] < lo) lo = mn[k];
        if (mx[k] > hi) hi = mx[k];
        acc += sq[k];
      }
      a = k0 * bucket;
      b = Math.min(len, k1 * bucket);
      out.min[px] = lo;
      out.max[px] = hi;
      out.rms[px] = Math.sqrt(acc / Math.max(1, b - a));
      out.valid[px] = 1;
    }
  }
}
