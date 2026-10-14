/**
 * Spot healing: fills a masked area with a smooth interpolation of its surroundings
 * (push–pull membrane) and adds back fine texture sampled from the best matching nearby
 * patch. Pure function on an RGBA patch.
 */
import { distanceField, maskBounds } from '../selection';
import { blurredCopy } from './filters';

/** Smooth (low frequency) fill of the unknown pixels (weight 0) from the known ones. */
export function pushPullFill(values: Float32Array, weights: Float32Array, w: number, h: number, channels: number): Float32Array {
  type Level = { v: Float32Array; wt: Float32Array; w: number; h: number };
  const levels: Level[] = [{ v: values, wt: weights, w, h }];
  // pull: build coarser levels (weighted averages)
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const prev = levels[levels.length - 1];
    const nw = Math.max(1, Math.ceil(prev.w / 2));
    const nh = Math.max(1, Math.ceil(prev.h / 2));
    const v = new Float32Array(nw * nh * channels);
    const wt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sw = 0;
        const acc = new Float64Array(channels);
        for (let dy = 0; dy < 2; dy++) {
          const yy = y * 2 + dy;
          if (yy >= prev.h) continue;
          for (let dx = 0; dx < 2; dx++) {
            const xx = x * 2 + dx;
            if (xx >= prev.w) continue;
            const p = yy * prev.w + xx;
            const ww = prev.wt[p];
            if (!ww) continue;
            sw += ww;
            for (let c = 0; c < channels; c++) acc[c] += prev.v[p * channels + c] * ww;
          }
        }
        const q = y * nw + x;
        wt[q] = Math.min(1, sw);
        if (sw > 0) for (let c = 0; c < channels; c++) v[q * channels + c] = acc[c] / sw;
      }
    }
    levels.push({ v, wt, w: nw, h: nh });
    if (levels.length > 32) break;
  }
  // push: fill each level's gaps from the coarser one (bilinear)
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    const out = new Float32Array(fine.v.length);
    for (let y = 0; y < fine.h; y++) {
      const cy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(cy);
      const y1 = Math.min(coarse.h - 1, y0 + 1);
      const ty = cy - y0;
      for (let x = 0; x < fine.w; x++) {
        const cx = Math.min(coarse.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(cx);
        const x1 = Math.min(coarse.w - 1, x0 + 1);
        const tx = cx - x0;
        const p = y * fine.w + x;
        const wf = Math.min(1, fine.wt[p]);
        for (let c = 0; c < channels; c++) {
          const a = coarse.v[(y0 * coarse.w + x0) * channels + c];
          const b = coarse.v[(y0 * coarse.w + x1) * channels + c];
          const d = coarse.v[(y1 * coarse.w + x0) * channels + c];
          const e = coarse.v[(y1 * coarse.w + x1) * channels + c];
          const interp = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
          out[p * channels + c] = wf * fine.v[p * channels + c] + (1 - wf) * interp;
        }
      }
    }
    fine.v = out;
    fine.wt = new Float32Array(fine.w * fine.h).fill(1);
  }
  return levels[0].v;
}

/** Relaxes the unknown pixels towards the average of their neighbours (Laplace smoothing). */
function relax(v: Float32Array, unknown: Uint8Array, w: number, h: number, channels: number, iterations: number): void {
  const idx: number[] = [];
  for (let p = 0; p < unknown.length; p++) if (unknown[p]) idx.push(p);
  for (let it = 0; it < iterations; it++) {
    for (const p of idx) {
      const x = p % w;
      const y = (p - x) / w;
      const l = x > 0 ? p - 1 : p;
      const r = x < w - 1 ? p + 1 : p;
      const u = y > 0 ? p - w : p;
      const d = y < h - 1 ? p + w : p;
      for (let c = 0; c < channels; c++) {
        v[p * channels + c] = (v[l * channels + c] + v[r * channels + c] + v[u * channels + c] + v[d * channels + c]) / 4;
      }
    }
  }
}

/** Finds a source offset whose surroundings best match the region's ring. */
export function bestSourceOffset(img: Uint8ClampedArray, w: number, h: number, mask: Uint8Array): { dx: number; dy: number } | null {
  const rb = maskBounds(mask, w, h);
  if (!rb) return null;
  const feature = new Uint8Array(w * h);
  for (let p = 0; p < feature.length; p++) feature[p] = mask[p] ? 1 : 0;
  const dist = distanceField(feature, w, h);
  const ring: number[] = [];
  for (let p = 0; p < dist.length; p++) if (!mask[p] && dist[p] <= 4) ring.push(p);
  const size = Math.max(rb.w, rb.h);
  let best: { dx: number; dy: number; score: number } | null = null;
  for (const k of [1.05, 1.4, 1.9, 2.6]) {
    const d = size * k + 3;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const dx = Math.round(Math.cos(ang) * d);
      const dy = Math.round(Math.sin(ang) * d);
      // the source of every masked pixel must be a known pixel inside the patch
      if (rb.x + dx < 0 || rb.y + dy < 0 || rb.x + rb.w + dx > w || rb.y + rb.h + dy > h) continue;
      let ok = true;
      for (let y = rb.y; y < rb.y + rb.h && ok; y++) {
        for (let x = rb.x; x < rb.x + rb.w; x++) {
          if (mask[y * w + x] && mask[(y + dy) * w + x + dx]) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      let score = 0;
      let n = 0;
      for (const p of ring) {
        const x = (p % w) + dx;
        const y = Math.floor(p / w) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const q = y * w + x;
        for (let c = 0; c < 3; c++) {
          const diff = img[p * 4 + c] - img[q * 4 + c];
          score += diff * diff;
        }
        n++;
      }
      if (!n) continue;
      score /= n;
      score *= 1 + k * 0.05; // prefer closer sources slightly
      if (!best || score < best.score) best = { dx, dy, score };
    }
  }
  return best ? { dx: best.dx, dy: best.dy } : null;
}

/**
 * Heals the pixels where `mask` > 0 (coverage 0..255) inside an RGBA patch and returns a new
 * buffer. The patch should include a generous margin around the masked area.
 */
export function healPatch(img: Uint8ClampedArray, w: number, h: number, mask: Uint8Array): Uint8ClampedArray {
  const out = img.slice();
  const n = w * h;
  let known = 0;
  for (let p = 0; p < n; p++) if (!mask[p]) known++;
  if (known === 0 || known === n) return out;
  const values = new Float32Array(n * 4);
  const weights = new Float32Array(n);
  const unknown = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < 4; c++) values[p * 4 + c] = img[p * 4 + c];
    if (mask[p]) unknown[p] = 1;
    else weights[p] = 1;
  }
  const fill = pushPullFill(values, weights, w, h, 4);
  relax(fill, unknown, w, h, 4, 24);
  const offset = bestSourceOffset(img, w, h, mask);
  const low = offset ? blurredCopy(img, w, h, 2) : null;
  for (let p = 0; p < n; p++) {
    const m = mask[p];
    if (!m) continue;
    const t = m / 255;
    let q = -1;
    if (offset && low) {
      const x = (p % w) + offset.dx;
      const y = Math.floor(p / w) + offset.dy;
      if (x >= 0 && y >= 0 && x < w && y < h) q = y * w + x;
    }
    for (let c = 0; c < 4; c++) {
      let v = fill[p * 4 + c];
      if (q >= 0 && c < 3) v += img[q * 4 + c] - low![q * 4 + c];
      out[p * 4 + c] = img[p * 4 + c] + (v - img[p * 4 + c]) * t;
    }
  }
  return out;
}
