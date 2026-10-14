/** Pure time helpers: timecode, frame quantization, time ↔ pixels, zoom and snapping math. */

export const EPS = 1e-6;

export function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Finite number or the fallback. */
export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function frameDur(fps: number): number {
  return 1 / Math.max(1, fps);
}

/** Rounds a time to the nearest frame boundary. */
export function quantize(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

/** Frame index that is visible at time t. */
export function frameIndex(t: number, fps: number): number {
  return Math.floor(t * fps + 1e-6);
}

/** 83.5 s @ 30 fps -> "00:01:23:15" */
export function formatTimecode(t: number, fps: number): string {
  const f = Math.max(0, Math.round((Number.isFinite(t) ? t : 0) * fps));
  const rate = Math.max(1, Math.round(fps));
  const frames = f % rate;
  const totalSec = Math.floor(f / rate);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(frames)}`;
}

/** Short label for rulers: "0:05", "1:23", "1:02:03" (with frames when `withFrames`). */
export function formatRulerTime(t: number, fps: number, withFrames = false): string {
  const total = Math.max(0, t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  if (!withFrames) return base;
  const f = Math.round((total - Math.floor(total)) * fps) % Math.max(1, Math.round(fps));
  return `${base}:${String(f).padStart(2, '0')}`;
}

/**
 * Parses "HH:MM:SS:FF", "MM:SS", "SS.sss", "1:02.5" or plain seconds. Returns null when invalid.
 */
export function parseTimecode(text: string, fps: number): number | null {
  const s = text.trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.max(0, parseFloat(s));
  const parts = s.split(':');
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(parseFloat);
  if (n.length === 4) return n[0] * 3600 + n[1] * 60 + n[2] + n[3] / fps;
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length === 2) return n[0] * 60 + n[1];
  return null;
}

export function timeToPx(t: number, pxPerSec: number): number {
  return t * pxPerSec;
}

export function pxToTime(px: number, pxPerSec: number): number {
  return px / pxPerSec;
}

export const MIN_PPS = 0.5;
export const MAX_PPS = 2400;

/**
 * New scrollLeft after zooming so that `anchorTime` stays under the same screen x
 * (`anchorX` = position relative to the visible area's left edge).
 */
export function zoomScroll(anchorTime: number, anchorX: number, newPps: number): number {
  return Math.max(0, anchorTime * newPps - anchorX);
}

/** Zoom level that shows `duration` seconds in `width` pixels. */
export function fitPps(duration: number, width: number): number {
  if (duration <= 0 || width <= 0) return 80;
  return clampNum((width * 0.95) / duration, MIN_PPS, MAX_PPS);
}

/** Ruler tick spacing: major step in seconds that keeps labels ~minPx apart. */
export function rulerStep(pxPerSec: number, fps: number, minPx = 80): { major: number; minor: number } {
  const frame = 1 / fps;
  const candidates = [frame, 2 * frame, 5 * frame, 10 * frame, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const step of candidates) {
    if (step * pxPerSec >= minPx) {
      const minor = step >= 1 ? step / (step % 5 === 0 || step === 1 ? 5 : 2) : step / 2;
      return { major: step, minor: Math.max(frame, minor) };
    }
  }
  return { major: 7200, minor: 600 };
}

export interface SnapResult {
  value: number;
  /** The candidate time we snapped to (null = no snap). */
  target: number | null;
}

/** Snaps `t` to the nearest candidate within `threshold` seconds. */
export function snapValue(t: number, candidates: number[], threshold: number): SnapResult {
  let best: number | null = null;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best === null ? { value: t, target: null } : { value: best, target: best };
}

/** Snaps a range being moved: either its start or its end may stick to a candidate. */
export function snapRange(start: number, duration: number, candidates: number[], threshold: number): SnapResult {
  const a = snapValue(start, candidates, threshold);
  const b = snapValue(start + duration, candidates, threshold);
  const da = a.target === null ? Infinity : Math.abs(a.value - start);
  const db = b.target === null ? Infinity : Math.abs(b.value - (start + duration));
  if (da === Infinity && db === Infinity) return { value: start, target: null };
  if (da <= db) return { value: a.value, target: a.target };
  return { value: b.value - duration, target: b.target };
}

/** Sorted, merged, non-empty ranges. */
export function mergeRanges<T extends { start: number; end: number }>(ranges: T[], gap = 0): { start: number; end: number }[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start > EPS)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap + EPS) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** dB <-> linear gain. */
export function dbToGain(db: number): number {
  if (db <= -60) return 0;
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}
