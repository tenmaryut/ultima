/** Timeline geometry: time ↔ pixel conversion, ruler ticks, snapping, timecode (pure). */

export interface TimelineScale {
  /** Pixels per second. */
  pxPerSec: number;
  /** Left padding (px) before time 0. */
  pad: number;
}

export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 4000;

export function timeToX(t: number, s: TimelineScale): number {
  return s.pad + t * s.pxPerSec;
}

export function xToTime(x: number, s: TimelineScale): number {
  return (x - s.pad) / s.pxPerSec;
}

/** Rounds a time to the nearest frame boundary. */
export function quantize(t: number, fps: number): number {
  if (!(fps > 0)) return t;
  return Math.round(t * fps) / fps;
}

export function frameOf(t: number, fps: number): number {
  return Math.round(t * fps + 1e-6);
}

export function clampTime(t: number, duration: number): number {
  return Math.min(Math.max(0, t), duration);
}

/** Last frame time that is still inside the composition. */
export function lastFrameTime(duration: number, fps: number): number {
  const frames = Math.max(1, Math.round(duration * fps));
  return (frames - 1) / fps;
}

/** Number of frames rendered for a range [start, end). */
export function frameCount(start: number, end: number, fps: number): number {
  return Math.max(1, Math.round((end - start) * fps));
}

/**
 * Snaps `t` to the closest candidate when it is within `thresholdPx` on screen.
 * Returns the (possibly unchanged) time and the candidate it snapped to.
 */
export function snapTime(t: number, candidates: number[], pxPerSec: number, thresholdPx = 6): { time: number; snapped: number | null } {
  let best: number | null = null;
  let bestDist = thresholdPx;
  for (const c of candidates) {
    const d = Math.abs(c - t) * pxPerSec;
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best === null ? { time: t, snapped: null } : { time: best, snapped: best };
}

/** Steps in seconds; the first one giving enough room between labels is used. */
export function pickTickStep(pxPerSec: number, fps: number, minLabelPx = 64): { major: number; minor: number } {
  const frame = 1 / fps;
  const candidates = [frame, 2 * frame, 5 * frame, 10 * frame, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].sort((a, b) => a - b);
  // De-duplicate with a tolerance but keep exact values (frame steps aren't round numbers).
  const unique = candidates.filter((c, i) => c > 0 && (i === 0 || c - candidates[i - 1] > 1e-9));
  let major = unique[unique.length - 1];
  for (const c of unique) {
    if (c * pxPerSec >= minLabelPx) {
      major = c;
      break;
    }
  }
  // Minor ticks: frames when there is room, else a fraction of the major step.
  let minor = major / 5;
  if (major <= 10 * frame + 1e-9) minor = frame;
  else if (major === 1 || major === 2) minor = major / 4;
  if (minor * pxPerSec < 5) minor = major / 2;
  if (minor * pxPerSec < 5) minor = major;
  return { major, minor };
}

export interface Tick {
  time: number;
  x: number;
  major: boolean;
}

/** Ticks visible in the pixel range [x0, x1] of the track area. */
export function rulerTicks(s: TimelineScale, x0: number, x1: number, fps: number, duration: number): Tick[] {
  const { major, minor } = pickTickStep(s.pxPerSec, fps);
  const t0 = Math.max(0, xToTime(x0, s));
  const t1 = Math.min(duration, xToTime(x1, s));
  const ticks: Tick[] = [];
  if (t1 < t0) return ticks;
  const first = Math.floor(t0 / minor);
  const last = Math.ceil(t1 / minor);
  if (last - first > 5000) return ticks;
  for (let i = first; i <= last; i++) {
    const time = i * minor;
    if (time < -1e-9 || time > duration + 1e-9) continue;
    ticks.push({ time, x: timeToX(time, s), major: Math.abs(time - Math.round(time / major) * major) < 1e-6 });
  }
  return ticks;
}

/** "mm:ss:ff" timecode (hours prepended when needed). */
export function formatTimecode(t: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round(t * fps + 1e-6));
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate + 1e-9);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}:${pad(frames)}` : `${pad(m)}:${pad(s)}:${pad(frames)}`;
}

/** Short ruler label: "0s", "1.5s", "12f" or "1:05". */
export function formatRulerLabel(t: number, fps: number, step: number): string {
  if (step < 1 - 1e-9 && Math.abs(t - Math.round(t)) > 1e-6) {
    const frame = frameOf(t - Math.floor(t + 1e-9), fps);
    return step < 0.5 - 1e-9 ? `${frame}f` : `${Math.round(t * 10) / 10}s`;
  }
  const secs = Math.round(t);
  if (secs >= 60) return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return `${secs}s`;
}

/** New scale after zooming by `factor`, keeping time under `anchorX` (relative to the track) fixed. */
export function zoomAround(
  s: TimelineScale,
  scrollLeft: number,
  factor: number,
  anchorX: number,
): { scale: TimelineScale; scrollLeft: number } {
  const pxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, s.pxPerSec * factor));
  const anchorTime = xToTime(scrollLeft + anchorX, s);
  const next = { ...s, pxPerSec };
  return { scale: next, scrollLeft: Math.max(0, timeToX(anchorTime, next) - anchorX) };
}

/** px/s that fits `duration` into `width` pixels. */
export function fitScale(duration: number, width: number, pad: number): number {
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, (width - pad * 2) / Math.max(0.1, duration)));
}

/** Parses "1.5", "1.5s", "45f", "00:01:15" (mm:ss:ff) or "1:02:03:04" into seconds. */
export function parseTimeInput(input: string, fps: number): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let m = /^(-?\d+(?:\.\d+)?)\s*s?$/.exec(s);
  if (m) return parseFloat(m[1]);
  m = /^(\d+)\s*f$/.exec(s);
  if (m) return parseInt(m[1], 10) / fps;
  const parts = s.split(/[:;]/);
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^\d+$/.test(p))) {
    const n = parts.map((p) => parseInt(p, 10));
    if (n.length === 2) return n[0] + n[1] / fps; // ss:ff
    if (n.length === 3) return n[0] * 60 + n[1] + n[2] / fps; // mm:ss:ff
    return n[0] * 3600 + n[1] * 60 + n[2] + n[3] / fps; // hh:mm:ss:ff
  }
  return null;
}
