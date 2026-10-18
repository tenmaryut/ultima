/*
 * Point tracking (pure, unit tested): follows a small patch of the picture from frame to frame with normalized
 * cross-correlation, coarse to fine over an image pyramid, with sub-pixel peaks, a constant-velocity guess for fast
 * motion and a template that slowly adapts to the target (the first one is kept to recover from drift).
 */

/** A grayscale picture (luma 0-255). */
export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

export function toGray(rgba: ArrayLike<number>, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { w, h, data };
}

/** Half the size, each pixel the mean of 2×2. */
function half(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1);
  const h = Math.max(1, g.h >> 1);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = 2 * y * g.w;
    const b = Math.min(2 * y + 1, g.h - 1) * g.w;
    for (let x = 0; x < w; x++) {
      const x0 = 2 * x;
      const x1 = Math.min(x0 + 1, g.w - 1);
      data[y * w + x] = 0.25 * (g.data[a + x0] + g.data[a + x1] + g.data[b + x0] + g.data[b + x1]);
    }
  }
  return { w, h, data };
}

/** A pyramid level. */
interface Level {
  g: Gray;
}

function pyramid(g: Gray, levels: number): Level[] {
  const out = [{ g }];
  let cur = g;
  for (let i = 1; i < levels; i++) {
    cur = half(cur);
    out.push({ g: cur });
  }
  return out;
}

/**
 * Gaussian weights over a (2r+1)² patch (summing to 1): the middle of the box counts most, so the background around
 * the target (which moves differently) disturbs the match less.
 */
const weightCache = new Map<number, Float32Array>();
function weights(r: number): Float32Array {
  let w = weightCache.get(r);
  if (w) return w;
  const n = 2 * r + 1;
  const sigma = Math.max(1, r * 0.6);
  w = new Float32Array(n * n);
  let sum = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sum += w[y * n + x] = Math.exp(-((x - r) ** 2 + (y - r) ** 2) / (2 * sigma * sigma));
  for (let i = 0; i < w.length; i++) w[i] /= sum;
  weightCache.set(r, w);
  return w;
}

/**
 * A patch of (2r+1)² pixels around an integer centre (inside the picture), stored ready for weighted correlation:
 * a = w·(T − mean) / spread, so that Σa = 0 and Σa²/w = 1.
 */
interface Template {
  r: number;
  a: Float32Array;
  /** False for a flat patch (nothing to follow). */
  ok: boolean;
}

function patch(g: Gray, cx: number, cy: number, r: number): Template {
  const n = 2 * r + 1;
  const w = weights(r);
  const a = new Float32Array(n * n);
  let mean = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = g.data[(cy - r + y) * g.w + cx - r + x];
      a[y * n + x] = v;
      mean += w[y * n + x] * v;
    }
  }
  let spread = 0;
  for (let i = 0; i < a.length; i++) {
    a[i] -= mean;
    spread += w[i] * a[i] * a[i];
  }
  spread = Math.sqrt(spread);
  for (let i = 0; i < a.length; i++) a[i] = spread > 1e-6 ? (w[i] * a[i]) / spread : 0;
  // less than about 2 grey levels of texture: nothing to lock onto
  return { r, a, ok: spread > 2 };
}

/** Mixes a little of `next` into `t` (the target slowly changes its look). */
function blend(t: Template, next: Template, k: number): Template {
  if (!next.ok) return t;
  const w = weights(t.r);
  const a = new Float32Array(t.a.length);
  let norm = 0;
  for (let i = 0; i < a.length; i++) {
    a[i] = (1 - k) * t.a[i] + k * next.a[i];
    norm += (a[i] * a[i]) / w[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= norm;
  return { r: t.r, a, ok: true };
}

const inside = (L: Level, r: number, x: number, y: number) => x >= r && y >= r && x < L.g.w - r && y < L.g.h - r;

/** Weighted normalized cross-correlation (-1…1) of the template centred on (cx, cy); -1 outside the picture. */
function nccAt(L: Level, T: Template, cx: number, cy: number): number {
  const r = T.r;
  if (!inside(L, r, cx, cy)) return -1;
  const n = 2 * r + 1;
  const w = weights(r);
  const g = L.g.data;
  const gw = L.g.w;
  let dot = 0;
  let s1 = 0;
  let s2 = 0;
  for (let y = 0; y < n; y++) {
    const row = (cy - r + y) * gw + cx - r;
    const k = y * n;
    for (let x = 0; x < n; x++) {
      const v = g[row + x];
      const wi = w[k + x];
      dot += T.a[k + x] * v;
      s1 += wi * v;
      s2 += wi * v * v;
    }
  }
  const spread = s2 - s1 * s1;
  return spread > 1e-6 ? dot / Math.sqrt(spread) : 0;
}

/**
 * Best match within ±radius of (cx, cy). `prior` (0-1) prefers matches near the guess: a look-alike far away must
 * match clearly better than the target close by.
 */
function search(L: Level, T: Template, cx: number, cy: number, radius: number, prior = 0): { x: number; y: number; score: number } {
  let best = { x: Math.round(cx), y: Math.round(cy), score: -2 };
  let bestRank = -Infinity;
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const s = nccAt(L, T, x0 + dx, y0 + dy);
      const rank = s - prior * ((dx * dx + dy * dy) / (radius * radius)) - 1e-9 * Math.hypot(dx, dy);
      if (rank > bestRank) {
        bestRank = rank;
        best = { x: x0 + dx, y: y0 + dy, score: s };
      }
    }
  }
  return best;
}

/** Sub-pixel offset of a peak from its two neighbours (a parabola through the three scores). */
function subpixel(minus: number, mid: number, plus: number): number {
  const d = minus - 2 * mid + plus;
  if (d >= -1e-9 || minus < -1 || plus < -1) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (minus - plus)) / d));
}

export interface TrackerOptions {
  /** Half-size of the followed patch, in pixels of the frames given. */
  radius: number;
  /** How far the target may move between two frames, in pixels (default 6 × radius, at least 24). */
  reach?: number;
}

export interface TrackStep {
  x: number;
  y: number;
  /** How sure the match is (0-1). */
  score: number;
  /** The target was not found: the position is a guess. */
  lost: boolean;
}

/** Follows one point through a sequence of frames of the same size. */
export class PointTracker {
  readonly levels: number;
  private radii: number[];
  private first: Template[];
  private current: Template[];
  private x: number;
  private y: number;
  private vx = 0;
  private vy = 0;
  private reach: number;
  /** Running mean of recent match scores: a match much worse than usual is a look-alike, not the target. */
  private usual = 0.9;
  readonly ok: boolean;

  constructor(frame: Gray, x: number, y: number, o: TrackerOptions) {
    const r0 = Math.max(3, Math.round(o.radius));
    // coarser levels while the patch keeps at least 3 px of half-size there
    let levels = 1;
    while (levels < 4 && r0 >> levels >= 3 && frame.w >> levels >= 32 && frame.h >> levels >= 32) levels++;
    this.levels = levels;
    this.radii = Array.from({ length: levels }, (_, l) => Math.max(2, Math.round(r0 / 2 ** l)));
    this.reach = Math.max(24, o.reach ?? r0 * 6);
    const pyr = pyramid(frame, levels);
    this.x = Math.min(Math.max(x, r0), frame.w - 1 - r0);
    this.y = Math.min(Math.max(y, r0), frame.h - 1 - r0);
    this.first = pyr.map((L, l) => patch(L.g, clampTo(Math.round(this.x / 2 ** l), this.radii[l], L.g.w - 1 - this.radii[l]), clampTo(Math.round(this.y / 2 ** l), this.radii[l], L.g.h - 1 - this.radii[l]), this.radii[l]));
    this.current = this.first;
    this.ok = this.first[0].ok;
  }

  get position() {
    return { x: this.x, y: this.y };
  }

  /** Finds the point in the next frame. */
  next(frame: Gray): TrackStep {
    const pyr = pyramid(frame, this.levels);
    const guess = { x: this.x + this.vx, y: this.y + this.vy };
    const run = (templates: Template[]) => {
      const top = this.levels - 1;
      const k = 2 ** top;
      let m = search(pyr[top], templates[top], guess.x / k, guess.y / k, Math.ceil(this.reach / k) + 1, 0.1);
      for (let l = top - 1; l >= 0; l--) m = search(pyr[l], templates[l], m.x * 2, m.y * 2, 2);
      return m;
    };
    let m = run(this.current);
    let usedFirst = false;
    if (m.score < 0.6 && this.current !== this.first) {
      // the adapted look drifted: try the look the target had at the start
      const again = run(this.first);
      if (again.score > m.score) {
        m = again;
        usedFirst = true;
      }
    }
    const T = (usedFirst ? this.first : this.current)[0];
    const L0 = pyr[0];
    const sx = subpixel(nccAt(L0, T, m.x - 1, m.y), m.score, nccAt(L0, T, m.x + 1, m.y));
    const sy = subpixel(nccAt(L0, T, m.x, m.y - 1), m.score, nccAt(L0, T, m.x, m.y + 1));
    const score = Math.max(0, m.score);
    if (score < Math.max(0.45, 0.7 * this.usual)) {
      // lost (covered, out of the picture, motion blur): keep going where it was heading, slower
      this.x = clampTo(this.x + this.vx * 0.5, 0, frame.w - 1);
      this.y = clampTo(this.y + this.vy * 0.5, 0, frame.h - 1);
      this.vx *= 0.5;
      this.vy *= 0.5;
      return { x: this.x, y: this.y, score, lost: true };
    }
    const nx = m.x + sx;
    const ny = m.y + sy;
    this.usual = 0.8 * this.usual + 0.2 * score;
    this.vx = 0.8 * (nx - this.x);
    this.vy = 0.8 * (ny - this.y);
    this.x = nx;
    this.y = ny;
    if (score > 0.75) {
      this.current = (usedFirst ? this.first : this.current).map((t, l) => {
        const L = pyr[l];
        const r = this.radii[l];
        const cx = Math.round(nx / 2 ** l);
        const cy = Math.round(ny / 2 ** l);
        return inside(L, r, cx, cy) ? blend(t, patch(L.g, cx, cy, r), 0.15) : t;
      });
    }
    return { x: nx, y: ny, score, lost: false };
  }
}

function clampTo(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
