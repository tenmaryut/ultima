/**
 * Canvas drawing for the waveform editor: theme colours from CSS variables, time
 * ruler, min/max + RMS waveform lanes, sample-level drawing when zoomed in, and the
 * STFT spectrogram.
 */
import { PeakCache, createColumns, type PeakColumns } from '../engine/peaks';
import { SpectrumAnalyzer, spectrogramPalette } from '../dsp/analysis';
import type { View } from '../state';

export interface Theme {
  bg: string;
  lane: string;
  wave: string;
  rms: string;
  grid: string;
  text: string;
  textDim: string;
  accent: string;
  selection: string;
  cursor: string;
  playhead: string;
  marker: string;
  danger: string;
  border: string;
}

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const accent = v('--au-wave', v('--accent', '#10d9b0'));
  return {
    bg: v('--bg-canvas', '#0c0d10'),
    lane: v('--au-lane', v('--bg-canvas', '#0c0d10')),
    wave: accent,
    rms: v('--au-wave-rms', '#7af5dc'),
    grid: v('--border', '#2a2d34'),
    text: v('--text-1', '#c8ccd4'),
    textDim: v('--text-3', '#626772'),
    accent: v('--accent', '#10d9b0'),
    selection: v('--selection', '#2f80ff'),
    cursor: v('--text-0', '#f3f4f6'),
    playhead: v('--au-playhead', '#ffcc33'),
    marker: v('--au-marker', '#f5a524'),
    danger: v('--danger', '#f05252'),
    border: v('--border-strong', '#3a3e47'),
  };
}

/* ---------------------------------- ruler ---------------------------------- */

const STEPS = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

export function niceStep(secondsPerPixel: number, minPixels: number): number {
  const target = secondsPerPixel * minPixels;
  return STEPS.find((s) => s >= target) ?? STEPS[STEPS.length - 1];
}

export function formatRulerTime(sec: number, step: number): string {
  const sign = sec < 0 ? '-' : '';
  const s = Math.abs(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const decimals = step < 0.001 ? 4 : step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const secs = decimals ? rest.toFixed(decimals).padStart(decimals + 3, '0') : String(Math.floor(rest + 1e-9)).padStart(2, '0');
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${secs}` : `${sign}${m}:${secs}`;
}

/** Formats a time for displays: h:mm:ss.mmm */
export function formatClock(sec: number, decimals = 3): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const secs = r.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${secs}`;
}

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  view: View,
  sampleRate: number,
  theme: Theme,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const spp = view.spp;
  const secPerPx = spp / sampleRate;
  const step = niceStep(secPerPx, 90);
  const minor = step / 5;
  const t0 = view.start / sampleRate;
  const t1 = t0 + width * secPerPx;
  ctx.strokeStyle = theme.textDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
    const x = Math.round((t - t0) / secPerPx) + 0.5;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ctx.moveTo(x, height);
    ctx.lineTo(x, height - (major ? 9 : 4));
  }
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.font = '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
    if (t < -1e-9) continue;
    const x = Math.round((t - t0) / secPerPx);
    ctx.fillText(formatRulerTime(t, step), x + 3, 3);
  }
  ctx.strokeStyle = theme.grid;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();
}

/* --------------------------------- waveform --------------------------------- */

let columns: PeakColumns = createColumns(1);

/**
 * Draws one channel lane in device pixels. `cache` provides peaks; when zoomed in to
 * less than one sample per device pixel, the samples are drawn as a line (with dots).
 */
export function drawLane(
  ctx: CanvasRenderingContext2D,
  cache: PeakCache,
  data: Float32Array | undefined,
  channel: number,
  view: View,
  top: number,
  laneHeight: number,
  width: number,
  dpr: number,
  ampZoom: number,
  theme: Theme,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const W = Math.round(width * dpr);
  const H = Math.round(laneHeight * dpr);
  const T = Math.round(top * dpr);
  const mid = T + H / 2;
  const half = H / 2 - 2 * dpr;
  const yOf = (v: number) => mid - Math.max(-1.02, Math.min(1.02, v * ampZoom)) * half;
  // guides: centre and -6 dB
  ctx.fillStyle = theme.grid;
  ctx.fillRect(0, Math.round(mid), W, Math.max(1, Math.round(dpr * 0.75)));
  ctx.globalAlpha = 0.35;
  for (const g of [0.5, -0.5]) {
    const y = Math.round(yOf(g));
    if (y > T && y < T + H) ctx.fillRect(0, y, W, 1);
  }
  ctx.globalAlpha = 1;
  if (!data) return;
  const sppDev = view.spp / dpr;
  if (sppDev < 1) {
    // sample-level: polyline through the samples
    const first = Math.max(0, Math.floor(view.start) - 1);
    const last = Math.min(data.length - 1, Math.ceil(view.start + width * view.spp) + 1);
    ctx.strokeStyle = theme.wave;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
      const x = (i - view.start) / sppDev;
      const y = yOf(data[i]);
      if (i === first) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (1 / sppDev >= 6 * dpr) {
      ctx.fillStyle = theme.wave;
      const r = Math.max(1.5, dpr * 1.6);
      for (let i = first; i <= last; i++) {
        const x = (i - view.start) / sppDev;
        ctx.fillRect(x - r, yOf(data[i]) - r, r * 2, r * 2);
      }
    }
    return;
  }
  if (columns.min.length !== W) columns = createColumns(W);
  cache.query(channel, view.start, sppDev, columns);
  const { min, max, rms, valid } = columns;
  ctx.fillStyle = theme.wave;
  for (let x = 0; x < W; x++) {
    if (!valid[x]) continue;
    const y1 = yOf(max[x]);
    const y2 = yOf(min[x]);
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  ctx.fillStyle = theme.rms;
  ctx.globalAlpha = 0.55;
  for (let x = 0; x < W; x++) {
    if (!valid[x]) continue;
    const r = Math.min(rms[x], Math.max(Math.abs(min[x]), Math.abs(max[x])));
    const y1 = yOf(Math.min(r, max[x]));
    const y2 = yOf(Math.max(-r, min[x]));
    if (y2 - y1 >= 1) ctx.fillRect(x, y1, 1, y2 - y1);
  }
  ctx.globalAlpha = 1;
  // clipping indicators
  ctx.fillStyle = theme.danger;
  for (let x = 0; x < W; x++) {
    if (!valid[x]) continue;
    if (max[x] >= 0.99997) ctx.fillRect(x, T, 1, Math.max(2, dpr * 2));
    if (min[x] <= -0.99997) ctx.fillRect(x, T + H - Math.max(2, dpr * 2), 1, Math.max(2, dpr * 2));
  }
}

/* -------------------------------- spectrogram -------------------------------- */

const palette = spectrogramPalette();
const analyzers = new Map<number, SpectrumAnalyzer>();
let specCanvas: HTMLCanvasElement | null = null;

function analyzer(size: number): SpectrumAnalyzer {
  let a = analyzers.get(size);
  if (!a) {
    a = new SpectrumAnalyzer(size);
    analyzers.set(size, a);
  }
  return a;
}

export interface SpectroOptions {
  log: boolean;
  floorDb: number;
  ceilDb: number;
}

/**
 * Draws a spectrogram of `data` for the visible view into the lane (CSS-pixel
 * resolution, scaled up). Frequency axis: log (20 Hz…Nyquist) or linear.
 */
export function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  sampleRate: number,
  view: View,
  top: number,
  laneHeight: number,
  width: number,
  dpr: number,
  options: SpectroOptions,
): void {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(laneHeight));
  const size = sampleRate >= 32000 ? 2048 : 1024;
  const an = analyzer(size);
  const bins = size / 2 + 1;
  const col = new Float32Array(bins);
  const image = new ImageData(w, h);
  const px = image.data;
  const nyq = sampleRate / 2;
  const fMin = 20;
  // precompute the bin range of each row
  const rowLo = new Int32Array(h);
  const rowHi = new Int32Array(h);
  const freqAt = (y: number) => (options.log ? fMin * Math.pow(nyq / fMin, 1 - y / h) : nyq * (1 - y / h));
  for (let y = 0; y < h; y++) {
    const fTop = freqAt(y);
    const fBottom = freqAt(y + 1);
    const lo = Math.max(0, Math.floor((fBottom / nyq) * (bins - 1)));
    const hi = Math.min(bins - 1, Math.max(lo, Math.ceil((fTop / nyq) * (bins - 1))));
    rowLo[y] = lo;
    rowHi[y] = hi;
  }
  const range = options.ceilDb - options.floorDb;
  for (let x = 0; x < w; x++) {
    const center = view.start + (x + 0.5) * view.spp;
    if (center < 0 || center >= data.length) continue;
    an.column(data, center, col);
    for (let y = 0; y < h; y++) {
      let db = -300;
      for (let k = rowLo[y]; k <= rowHi[y]; k++) if (col[k] > db) db = col[k];
      const v = Math.max(0, Math.min(255, Math.round(((db - options.floorDb) / range) * 255)));
      const o = (y * w + x) * 4;
      px[o] = palette[v * 3];
      px[o + 1] = palette[v * 3 + 1];
      px[o + 2] = palette[v * 3 + 2];
      px[o + 3] = 255;
    }
  }
  if (!specCanvas) specCanvas = document.createElement('canvas');
  specCanvas.width = w;
  specCanvas.height = h;
  specCanvas.getContext('2d')!.putImageData(image, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(specCanvas, 0, Math.round(top * dpr), Math.round(width * dpr), Math.round(laneHeight * dpr));
}

/** Frequency labels for the spectrogram axis. */
export function spectroLabels(sampleRate: number, laneHeight: number, log: boolean): { y: number; label: string }[] {
  const nyq = sampleRate / 2;
  const freqs = log ? [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] : [1000, 2000, 5000, 10000, 15000, 20000];
  return freqs
    .filter((f) => f < nyq)
    .map((f) => {
      const y = log ? laneHeight * (1 - Math.log(f / 20) / Math.log(nyq / 20)) : laneHeight * (1 - f / nyq);
      return { y, label: f >= 1000 ? `${f / 1000}k` : String(f) };
    })
    .filter((l) => l.y > 8 && l.y < laneHeight - 4);
}
