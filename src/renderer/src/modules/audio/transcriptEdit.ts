/**
 * "Edit by transcript" helpers: work out which words were deleted from a transcript
 * segment, estimate their time range (character-proportional within the segment) and
 * snap cut points to the quietest nearby moment. Also TXT/SRT/VTT/chapters export.
 * Pure TypeScript — unit tested.
 */
import { formatSrtTime } from '../../core/utils/format';

export interface TimeRange {
  start: number;
  end: number;
}

interface Token {
  text: string;
  norm: string;
}

function tokenize(text: string): Token[] {
  return (text.match(/\S+/g) ?? []).map((w) => ({ text: w, norm: w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '') }));
}

/** Indices of words of `original` missing from `edited`, grouped into consecutive runs. */
export function deletedWordRuns(original: string, edited: string): { runs: [number, number][]; inserted: boolean; words: number } {
  const a = tokenize(original);
  const b = tokenize(edited);
  const n = a.length;
  const m = b.length;
  // LCS table
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].norm === b[j].norm ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const deleted: number[] = [];
  let inserted = false;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].norm === b[j].norm) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) deleted.push(i++);
    else {
      inserted = true;
      j++;
    }
  }
  while (i < n) deleted.push(i++);
  if (j < m) inserted = true;
  const runs: [number, number][] = [];
  for (const idx of deleted) {
    const last = runs[runs.length - 1];
    if (last && last[1] === idx - 1) last[1] = idx;
    else runs.push([idx, idx]);
  }
  return { runs, inserted, words: n };
}

/** Estimated [start, end] time of each word, proportional to its length within the segment. */
export function wordTimes(text: string, start: number, end: number): TimeRange[] {
  const words = tokenize(text);
  const weights = words.map((w) => w.text.length + 1);
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const out: TimeRange[] = [];
  let acc = 0;
  for (const w of weights) {
    const a = start + ((end - start) * acc) / total;
    acc += w;
    const b = start + ((end - start) * acc) / total;
    out.push({ start: a, end: b });
  }
  return out;
}

/** Time ranges (same unit as start/end) to delete when `original` is edited into `edited`. */
export function planTranscriptCut(original: string, edited: string, start: number, end: number): { ranges: TimeRange[]; inserted: boolean } {
  const { runs, inserted, words } = deletedWordRuns(original, edited);
  const times = wordTimes(original, start, end);
  const ranges: TimeRange[] = runs.map(([a, b]) => ({
    start: a === 0 ? start : times[a].start,
    end: b === words - 1 ? end : times[b].end,
  }));
  return { ranges, inserted };
}

/**
 * Moves `pos` (samples) to the quietest 5 ms window within ±`radius` samples, so cuts
 * land between words instead of inside them.
 */
export function snapToQuiet(channels: Float32Array[], pos: number, radius: number, sampleRate: number): number {
  const len = channels[0]?.length ?? 0;
  const win = Math.max(8, Math.round(sampleRate * 0.005));
  const from = Math.max(0, Math.round(pos - radius));
  const to = Math.min(len - win, Math.round(pos + radius));
  if (to <= from) return Math.max(0, Math.min(len, Math.round(pos)));
  let best = Math.round(pos);
  let bestEnergy = Infinity;
  const step = Math.max(1, Math.floor(win / 4));
  for (let s = from; s <= to; s += step) {
    let e = 0;
    for (const c of channels) for (let i = s; i < s + win; i++) e += c[i] * c[i];
    // slight preference for staying close to the estimate
    const penalty = 1 + (Math.abs(s + win / 2 - pos) / Math.max(1, radius)) * 0.15;
    if (e * penalty < bestEnergy) {
      bestEnergy = e * penalty;
      best = s + Math.floor(win / 2);
    }
  }
  return best;
}

export interface TimedText {
  start: number;
  end: number;
  text: string;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function transcriptToText(segments: TimedText[], withTimes: boolean): string {
  return segments
    .map((s) => (withTimes ? `[${formatSrtTime(s.start, '.').slice(0, 8)}] ${clean(s.text)}` : clean(s.text)))
    .join('\n');
}

export function transcriptToSrt(segments: TimedText[]): string {
  return segments.map((s, i) => `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}\n${clean(s.text)}\n`).join('\n');
}

export function transcriptToVtt(segments: TimedText[]): string {
  return `WEBVTT\n\n${segments.map((s) => `${formatSrtTime(s.start, '.')} --> ${formatSrtTime(s.end, '.')}\n${clean(s.text)}\n`).join('\n')}`;
}

/** "mm:ss Label" lines (YouTube chapters style); the first chapter must start at 0:00. */
export function chaptersText(markers: { time: number; label: string }[], introLabel = 'Intro'): string {
  const fmt = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  };
  const sorted = [...markers].sort((a, b) => a.time - b.time);
  if (!sorted.length || sorted[0].time > 0.5) sorted.unshift({ time: 0, label: introLabel });
  return sorted.map((m) => `${fmt(m.time)} ${clean(m.label)}`).join('\n');
}
