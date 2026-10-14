/**
 * Pure selection math on 8-bit masks (one byte per document pixel). No DOM here so it can be
 * unit tested in node.
 */
import type { Point, Rect, Selection, SelectionMode } from './types';

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
}

export function unionRects(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Integer rect that fully contains `r`. */
export function roundOutRect(r: Rect): Rect {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

/** Bounding box of the non-zero pixels, or null if the mask is empty. */
export function maskBounds(mask: Uint8Array, w: number, h: number): Rect | null {
  let minX = w;
  let minY = -1;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let x0 = -1;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        x0 = x;
        break;
      }
    }
    if (x0 < 0) continue;
    let x1 = x0;
    for (let x = w - 1; x > x0; x--) {
      if (mask[row + x]) {
        x1 = x;
        break;
      }
    }
    if (minY < 0) minY = y;
    maxY = y;
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Wraps a mask into a Selection (null when nothing is selected). */
export function selectionFromMask(mask: Uint8Array, width: number, height: number): Selection | null {
  const bounds = maskBounds(mask, width, height);
  return bounds ? { width, height, mask, bounds } : null;
}

export function selectAll(width: number, height: number): Selection {
  return { width, height, mask: new Uint8Array(width * height).fill(255), bounds: { x: 0, y: 0, w: width, h: height } };
}

/** 0..255 selection value at a document pixel (255 everywhere when there is no selection). */
export function selectionValue(sel: Selection | null, x: number, y: number): number {
  if (!sel) return 255;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= sel.width || iy >= sel.height) return 0;
  return sel.mask[iy * sel.width + ix];
}

export function rectMask(w: number, h: number, r: Rect): Uint8Array {
  const mask = new Uint8Array(w * h);
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(w, Math.round(r.x + r.w));
  const y1 = Math.min(h, Math.round(r.y + r.h));
  for (let y = y0; y < y1; y++) mask.fill(255, y * w + x0, y * w + x1);
  return mask;
}

interface Edge {
  ymin: number;
  ymax: number;
  x0: number;
  y0: number;
  slope: number;
}

/**
 * Rasterizes a closed polygon (even-odd rule). With `antialias`, edges get fractional
 * coverage (4 sub-scanlines + exact horizontal span coverage).
 */
export function polygonMask(w: number, h: number, points: Point[], antialias = true): Uint8Array {
  const mask = new Uint8Array(w * h);
  if (points.length < 3) return mask;
  const edges: Edge[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    minY = Math.min(minY, a.y);
    maxY = Math.max(maxY, a.y);
    if (a.y === b.y) continue;
    const top = a.y < b.y ? a : b;
    const bottom = a.y < b.y ? b : a;
    edges.push({ ymin: top.y, ymax: bottom.y, x0: top.x, y0: top.y, slope: (bottom.x - top.x) / (bottom.y - top.y) });
  }
  if (!edges.length) return mask;
  edges.sort((p, q) => p.ymin - q.ymin);
  const ss = antialias ? 4 : 1;
  const cov = new Float32Array(w + 1);
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(h - 1, Math.ceil(maxY));
  let next = 0;
  let active: Edge[] = [];
  const xs: number[] = [];
  for (let y = yStart; y <= yEnd; y++) {
    let lo = w;
    let hi = -1;
    for (let s = 0; s < ss; s++) {
      const sy = y + (s + 0.5) / ss;
      while (next < edges.length && edges[next].ymin <= sy) active.push(edges[next++]);
      active = active.filter((e) => e.ymax > sy);
      xs.length = 0;
      for (const e of active) if (e.ymin <= sy) xs.push(e.x0 + (sy - e.y0) * e.slope);
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        if (antialias) {
          const a = Math.max(0, xs[k]);
          const b = Math.min(w, xs[k + 1]);
          if (b <= a) continue;
          const ia = Math.floor(a);
          const ib = Math.floor(b);
          lo = Math.min(lo, ia);
          hi = Math.max(hi, Math.min(w - 1, ib));
          if (ia === ib) cov[ia] += (b - a) / ss;
          else {
            cov[ia] += (ia + 1 - a) / ss;
            for (let i = ia + 1; i < ib; i++) cov[i] += 1 / ss;
            if (ib < w) cov[ib] += (b - ib) / ss;
          }
        } else {
          const ia = Math.max(0, Math.ceil(xs[k] - 0.5));
          const ib = Math.min(w, Math.ceil(xs[k + 1] - 0.5));
          if (ib <= ia) continue;
          lo = Math.min(lo, ia);
          hi = Math.max(hi, ib - 1);
          for (let i = ia; i < ib; i++) cov[i] += 1;
        }
      }
    }
    if (hi < lo) continue;
    const row = y * w;
    for (let x = lo; x <= hi; x++) {
      const v = cov[x];
      if (v > 0) mask[row + x] = v >= 1 ? 255 : Math.round(v * 255);
      cov[x] = 0;
    }
  }
  return mask;
}

/** Polygon approximating an ellipse inscribed in `r`. */
export function ellipsePoints(r: Rect): Point[] {
  const rx = r.w / 2;
  const ry = r.h / 2;
  const cx = r.x + rx;
  const cy = r.y + ry;
  const n = Math.max(32, Math.min(4096, Math.ceil((Math.PI * (rx + ry)) / 1.5)));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

export function ellipseMask(w: number, h: number, r: Rect, antialias = true): Uint8Array {
  if (r.w <= 0 || r.h <= 0) return new Uint8Array(w * h);
  return polygonMask(w, h, ellipsePoints(r), antialias);
}

/** Combines a new shape mask with an existing selection mask. */
export function combineMasks(base: Uint8Array | null, shape: Uint8Array, mode: SelectionMode): Uint8Array {
  if (mode === 'new' || (!base && mode === 'add')) return shape;
  if (!base) return new Uint8Array(shape.length);
  const out = new Uint8Array(shape.length);
  for (let i = 0; i < shape.length; i++) {
    const a = base[i];
    const b = shape[i];
    if (mode === 'add') out[i] = a > b ? a : b;
    else if (mode === 'subtract') out[i] = (a * (255 - b) + 127) / 255;
    else out[i] = a < b ? a : b;
  }
  return out;
}

export function invertMask(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = 255 - mask[i];
  return out;
}

/** Box sizes approximating a gaussian of `sigma` with `n` passes. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

/** Single channel box blur (edges extended). `src` and `dst` must differ. */
export function boxBlurChannel(src: Uint8Array | Uint8ClampedArray, dst: Uint8Array | Uint8ClampedArray, w: number, h: number, r: number): void {
  if (r < 1) {
    dst.set(src);
    return;
  }
  const tmp = new Uint8Array(w * h);
  const div = 2 * r + 1;
  const half = div >> 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = ((sum + half) / div) | 0;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = ((sum + half) / div) | 0;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/** Approximate gaussian blur of a single channel (3 box passes). */
export function gaussianChannel(src: Uint8Array, w: number, h: number, sigma: number): Uint8Array {
  if (sigma <= 0.2) return src.slice();
  let a = src.slice();
  let b = new Uint8Array(src.length);
  for (const size of boxesForGauss(sigma, 3)) {
    boxBlurChannel(a, b, w, h, (size - 1) >> 1);
    const t = a;
    a = b;
    b = t;
  }
  return a;
}

/** Feather: softens the selection edge over roughly `radius` px on each side. */
export function featherMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  return gaussianChannel(mask, w, h, radius / 2);
}

/* ------------------------------ Distance transform ------------------------------ */

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Exact euclidean distance (in px) from every pixel to the nearest pixel where
 * `feature[i]` is non-zero (Felzenszwalb & Huttenlocher). Pixels with no feature at all get Infinity.
 */
export function distanceField(feature: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = feature[i] ? 0 : INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x] >= INF / 2 ? Infinity : Math.sqrt(d[x]);
  }
  return out;
}

function cropMask(mask: Uint8Array, w: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(mask.subarray((r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w), y * r.w);
  return out;
}

function pasteMask(target: Uint8Array, w: number, part: Uint8Array, r: Rect): void {
  for (let y = 0; y < r.h; y++) target.set(part.subarray(y * r.w, (y + 1) * r.w), (r.y + y) * w + r.x);
}

/** Grows the selection by `px` (anti-aliased edge). */
export function expandMask(mask: Uint8Array, w: number, h: number, px: number): Uint8Array {
  const bounds = maskBounds(mask, w, h);
  if (!bounds || px <= 0) return mask;
  const m = Math.ceil(px) + 2;
  const r = intersectRects({ x: bounds.x - m, y: bounds.y - m, w: bounds.w + 2 * m, h: bounds.h + 2 * m }, { x: 0, y: 0, w, h })!;
  const part = cropMask(mask, w, r);
  const feature = new Uint8Array(part.length);
  for (let i = 0; i < part.length; i++) feature[i] = part[i] >= 128 ? 1 : 0;
  const dist = distanceField(feature, r.w, r.h);
  for (let i = 0; i < part.length; i++) {
    if (feature[i]) {
      part[i] = 255;
      continue;
    }
    const v = Math.max(0, Math.min(1, px + 1 - dist[i]));
    part[i] = Math.max(part[i], Math.round(v * 255));
  }
  const out = mask.slice();
  pasteMask(out, w, part, r);
  return out;
}

/** Shrinks the selection by `px` (the document edge does not count as outside). */
export function contractMask(mask: Uint8Array, w: number, h: number, px: number): Uint8Array {
  const bounds = maskBounds(mask, w, h);
  if (!bounds || px <= 0) return mask;
  const r = intersectRects({ x: bounds.x - 1, y: bounds.y - 1, w: bounds.w + 2, h: bounds.h + 2 }, { x: 0, y: 0, w, h })!;
  const part = cropMask(mask, w, r);
  const feature = new Uint8Array(part.length);
  let any = false;
  for (let i = 0; i < part.length; i++) {
    feature[i] = part[i] < 128 ? 1 : 0;
    if (feature[i]) any = true;
  }
  if (!any) return mask; // fully selected document: nothing to contract from
  const dist = distanceField(feature, r.w, r.h);
  for (let i = 0; i < part.length; i++) {
    if (feature[i]) {
      part[i] = 0;
      continue;
    }
    const v = Math.max(0, Math.min(1, dist[i] - px));
    part[i] = Math.min(part[i], Math.round(v * 255));
  }
  const out = mask.slice();
  pasteMask(out, w, part, r);
  return out;
}

/** Shifts a mask by whole pixels (pixels moved outside are dropped). */
export function translateMask(mask: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  for (let y = 0; y < h; y++) {
    const sy = y - oy;
    if (sy < 0 || sy >= h) continue;
    const x0 = Math.max(0, ox);
    const x1 = Math.min(w, w + ox);
    if (x1 <= x0) continue;
    out.set(mask.subarray(sy * w + x0 - ox, sy * w + x1 - ox), y * w + x0);
  }
  return out;
}

/**
 * Outline of the selection (edges between pixels >= threshold and the rest), as merged
 * axis-aligned segments [x1, y1, x2, y2, ...] in document pixel coordinates.
 */
export function outlineSegments(mask: Uint8Array, w: number, h: number, bounds: Rect | null = null, threshold = 128): Float32Array {
  const b = bounds ?? maskBounds(mask, w, h);
  if (!b) return new Float32Array(0);
  const out: number[] = [];
  const x0 = b.x;
  const x1 = b.x + b.w; // exclusive
  const y0 = b.y;
  const y1 = b.y + b.h;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= threshold;
  // horizontal edges on row boundaries y0..y1
  for (let y = y0; y <= y1; y++) {
    let run = -1;
    for (let x = x0; x <= x1; x++) {
      const edge = x < x1 && inside(x, y - 1) !== inside(x, y);
      if (edge && run < 0) run = x;
      else if (!edge && run >= 0) {
        out.push(run, y, x, y);
        run = -1;
      }
    }
  }
  // vertical edges on column boundaries x0..x1
  const runStart = new Int32Array(x1 - x0 + 1).fill(-1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edge = y < y1 && inside(x - 1, y) !== inside(x, y);
      const i = x - x0;
      if (edge && runStart[i] < 0) runStart[i] = y;
      else if (!edge && runStart[i] >= 0) {
        out.push(x, runStart[i], x, y);
        runStart[i] = -1;
      }
    }
  }
  return Float32Array.from(out);
}

/** Selection from a layer's alpha channel placed at (lx, ly) in the document. */
export function alphaToMask(rgba: Uint8ClampedArray, lw: number, lh: number, lx: number, ly: number, docW: number, docH: number): Uint8Array {
  const mask = new Uint8Array(docW * docH);
  for (let y = 0; y < lh; y++) {
    const dy = y + ly;
    if (dy < 0 || dy >= docH) continue;
    for (let x = 0; x < lw; x++) {
      const dx = x + lx;
      if (dx < 0 || dx >= docW) continue;
      mask[dy * docW + dx] = rgba[(y * lw + x) * 4 + 3];
    }
  }
  return mask;
}

/** Crops/extends a selection for a new document geometry (shift by -dx,-dy; new size). */
export function reframeSelection(sel: Selection | null, dx: number, dy: number, newW: number, newH: number): Selection | null {
  if (!sel) return null;
  const mask = new Uint8Array(newW * newH);
  for (let y = 0; y < newH; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= sel.height) continue;
    const xa = Math.max(0, -dx);
    const xb = Math.min(newW, sel.width - dx);
    if (xb <= xa) continue;
    mask.set(sel.mask.subarray(sy * sel.width + xa + dx, sy * sel.width + xb + dx), y * newW + xa);
  }
  return selectionFromMask(mask, newW, newH);
}
