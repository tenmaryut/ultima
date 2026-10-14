export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 75.5 -> "01:15.50" (or "1:02:03.00" for long durations). */
export function formatTime(seconds: number, withFraction = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  // Round to the displayed precision first so 59.996 s shows as 01:00.00, not 00:60.00.
  const total = withFraction ? Math.round(seconds * 100) / 100 : Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.round((total % 60) * 100) / 100;
  const ss = withFraction ? s.toFixed(2).padStart(5, '0') : Math.floor(s).toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** SRT/VTT style timestamp: 00:01:02,345 */
export function formatSrtTime(seconds: number, separator = ','): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(rest).padStart(3, '0')}`;
}

export function fileBaseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
