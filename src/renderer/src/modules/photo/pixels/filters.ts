/**
 * Image filters as pure functions on RGBA buffers (ImageData layout, non-premultiplied).
 * Each filter returns the output buffer (which may be the input, modified in place).
 * Blurs work on premultiplied copies so transparent edges don't get dark halos.
 */
import { boxesForGauss } from '../selection';
import { clamp, luma } from './adjust';

/* --------------------------------- helpers --------------------------------- */

export function isOpaque(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
  return true;
}

export function premultiplied(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    out[i] = (src[i] * a) / 255;
    out[i + 1] = (src[i + 1] * a) / 255;
    out[i + 2] = (src[i + 2] * a) / 255;
    out[i + 3] = a;
  }
  return out;
}

export function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0 || a === 255) continue;
    data[i] = (data[i] * 255) / a;
    data[i + 1] = (data[i + 1] * 255) / a;
    data[i + 2] = (data[i + 2] * 255) / a;
  }
}

const ci = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);

function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let k = -r; k <= r; k++) {
      const i = row + ci(k, w - 1) * 4;
      s0 += src[i];
      s1 += src[i + 1];
      s2 += src[i + 2];
      s3 += src[i + 3];
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      dst[o] = s0 / div;
      dst[o + 1] = s1 / div;
      dst[o + 2] = s2 / div;
      dst[o + 3] = s3 / div;
      const ia = row + ci(x + r + 1, w - 1) * 4;
      const ib = row + ci(x - r, w - 1) * 4;
      s0 += src[ia] - src[ib];
      s1 += src[ia + 1] - src[ib + 1];
      s2 += src[ia + 2] - src[ib + 2];
      s3 += src[ia + 3] - src[ib + 3];
    }
  }
}

function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = 2 * r + 1;
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    const col = x * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let k = -r; k <= r; k++) {
      const i = ci(k, h - 1) * stride + col;
      s0 += src[i];
      s1 += src[i + 1];
      s2 += src[i + 2];
      s3 += src[i + 3];
    }
    for (let y = 0; y < h; y++) {
      const o = y * stride + col;
      dst[o] = s0 / div;
      dst[o + 1] = s1 / div;
      dst[o + 2] = s2 / div;
      dst[o + 3] = s3 / div;
      const ia = ci(y + r + 1, h - 1) * stride + col;
      const ib = ci(y - r, h - 1) * stride + col;
      s0 += src[ia] - src[ib];
      s1 += src[ia + 1] - src[ib + 1];
      s2 += src[ia + 2] - src[ib + 2];
      s3 += src[ia + 3] - src[ib + 3];
    }
  }
}

/** Gaussian blur of a premultiplied RGBA buffer (3 box passes). Returns a new buffer. */
function gaussPremultiplied(pm: Uint8ClampedArray, w: number, h: number, sigma: number): Uint8ClampedArray {
  let a: Uint8ClampedArray = pm;
  let b: Uint8ClampedArray = new Uint8ClampedArray(pm.length);
  const tmp = new Uint8ClampedArray(pm.length);
  let first = true;
  for (const size of boxesForGauss(sigma, 3)) {
    const r = (size - 1) >> 1;
    if (r < 1) continue;
    boxBlurH(a, tmp, w, h, r);
    boxBlurV(tmp, b, w, h, r);
    if (first) {
      a = new Uint8ClampedArray(pm.length);
      first = false;
    }
    const t = a;
    a = b;
    b = t;
  }
  return a === pm ? pm.slice() : a;
}

/** Blurred copy (gaussian, `sigma` px) of a non-premultiplied buffer. */
export function blurredCopy(src: Uint8ClampedArray, w: number, h: number, sigma: number): Uint8ClampedArray {
  if (sigma <= 0.15) return src.slice();
  const opaque = isOpaque(src);
  const out = gaussPremultiplied(opaque ? src : premultiplied(src), w, h, sigma);
  if (!opaque) unpremultiply(out);
  return out;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussRandom(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------------------------------- Blurs ---------------------------------- */

export function gaussianBlur(data: Uint8ClampedArray, w: number, h: number, p: { radius: number }): Uint8ClampedArray {
  return blurredCopy(data, w, h, clamp(p.radius, 0, 250));
}

export function motionBlur(data: Uint8ClampedArray, w: number, h: number, p: { angle: number; distance: number }): Uint8ClampedArray {
  const dist = clamp(p.distance, 0, 500);
  if (dist < 1) return data;
  const a = (clamp(p.angle, -360, 360) * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const samples = Math.max(2, Math.min(96, Math.round(dist) + 1));
  const offsets: number[] = [];
  let last = '';
  for (let s = 0; s < samples; s++) {
    const t = (s / (samples - 1) - 0.5) * dist;
    const ox = Math.round(dx * t);
    const oy = Math.round(dy * t);
    const key = `${ox},${oy}`;
    if (key === last) continue;
    last = key;
    offsets.push(ox, oy);
  }
  const n = offsets.length / 2;
  const opaque = isOpaque(data);
  const src = opaque ? data : premultiplied(data);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let k = 0; k < offsets.length; k += 2) {
        const i = (ci(y + offsets[k + 1], h - 1) * w + ci(x + offsets[k], w - 1)) * 4;
        s0 += src[i];
        s1 += src[i + 1];
        s2 += src[i + 2];
        s3 += src[i + 3];
      }
      const o = (y * w + x) * 4;
      out[o] = s0 / n;
      out[o + 1] = s1 / n;
      out[o + 2] = s2 / n;
      out[o + 3] = s3 / n;
    }
  }
  if (!opaque) unpremultiply(out);
  return out;
}

/* -------------------------------- Sharpening -------------------------------- */

export function unsharpMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  p: { amount: number; radius: number; threshold: number },
): Uint8ClampedArray {
  const amount = clamp(p.amount, 0, 500) / 100;
  const thr = clamp(p.threshold, 0, 255);
  const blur = blurredCopy(data, w, h, clamp(p.radius, 0.1, 250));
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      const diff = v - blur[i + c];
      if (Math.abs(diff) >= thr) data[i + c] = v + diff * amount;
    }
  }
  return data;
}

export function sharpen(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  return unsharpMask(data, w, h, { amount: 60, radius: 0.8, threshold: 0 });
}

export function highPass(data: Uint8ClampedArray, w: number, h: number, p: { radius: number }): Uint8ClampedArray {
  const blur = blurredCopy(data, w, h, clamp(p.radius, 0.1, 250));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128 + data[i] - blur[i];
    data[i + 1] = 128 + data[i + 1] - blur[i + 1];
    data[i + 2] = 128 + data[i + 2] - blur[i + 2];
  }
  return data;
}

/* ----------------------------------- Noise ----------------------------------- */

export function addNoise(
  data: Uint8ClampedArray,
  _w: number,
  _h: number,
  p: { amount: number; distribution: 'uniform' | 'gaussian'; monochromatic: boolean; seed?: number },
): Uint8ClampedArray {
  const amp = clamp(p.amount, 0, 100) * 2.55;
  if (!amp) return data;
  const rand = mulberry32(p.seed ?? 1234);
  const next = () => (p.distribution === 'gaussian' ? gaussRandom(rand) * amp * 0.5 : (rand() * 2 - 1) * amp);
  for (let i = 0; i < data.length; i += 4) {
    if (p.monochromatic) {
      const n = next();
      data[i] += n;
      data[i + 1] += n;
      data[i + 2] += n;
    } else {
      data[i] += next();
      data[i + 1] += next();
      data[i + 2] += next();
    }
  }
  return data;
}

/** Median filter (Huang's sliding histogram) — "Reduce Noise". */
export function median(data: Uint8ClampedArray, w: number, h: number, p: { radius: number }): Uint8ClampedArray {
  const r = Math.round(clamp(p.radius, 1, 20));
  const out = new Uint8ClampedArray(data.length);
  const hist = new Int32Array(256);
  const total = (2 * r + 1) * (2 * r + 1);
  const half = total >> 1;
  for (let c = 0; c < 4; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      for (let dy = -r; dy <= r; dy++) {
        const yy = ci(y + dy, h - 1) * w;
        for (let dx = -r; dx <= r; dx++) hist[data[(yy + ci(dx, w - 1)) * 4 + c]]++;
      }
      let med = 0;
      let lt = 0;
      while (lt + hist[med] <= half) lt += hist[med++];
      out[y * w * 4 + c] = med;
      for (let x = 1; x < w; x++) {
        const xo = ci(x - r - 1, w - 1);
        const xn = ci(x + r, w - 1);
        for (let dy = -r; dy <= r; dy++) {
          const yy = ci(y + dy, h - 1) * w;
          const vo = data[(yy + xo) * 4 + c];
          const vn = data[(yy + xn) * 4 + c];
          hist[vo]--;
          if (vo < med) lt--;
          hist[vn]++;
          if (vn < med) lt++;
        }
        while (lt > half) {
          med--;
          lt -= hist[med];
        }
        while (lt + hist[med] <= half) lt += hist[med++];
        out[(y * w + x) * 4 + c] = med;
      }
    }
  }
  return out;
}

/* ---------------------------------- Stylize ---------------------------------- */

export function pixelate(data: Uint8ClampedArray, w: number, h: number, p: { size: number }): Uint8ClampedArray {
  const s = Math.round(clamp(p.size, 1, 1000));
  if (s <= 1) return data;
  for (let by = 0; by < h; by += s) {
    for (let bx = 0; bx < w; bx += s) {
      const ex = Math.min(w, bx + s);
      const ey = Math.min(h, by + s);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          const al = data[i + 3];
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const or = a ? r / a : 0;
      const og = a ? g / a : 0;
      const ob = a ? b / a : 0;
      const oa = a / n;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4;
          data[i] = or;
          data[i + 1] = og;
          data[i + 2] = ob;
          data[i + 3] = oa;
        }
      }
    }
  }
  return data;
}

function lumaPlane(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = luma(data[i], data[i + 1], data[i + 2]);
  return L;
}

export function emboss(data: Uint8ClampedArray, w: number, h: number, p: { angle: number; height: number; amount: number }): Uint8ClampedArray {
  const L = lumaPlane(data, w, h);
  const a = (clamp(p.angle, -360, 360) * Math.PI) / 180;
  const hgt = clamp(p.height, 1, 20);
  const ox = Math.round(Math.cos(a) * hgt);
  const oy = Math.round(-Math.sin(a) * hgt);
  const k = clamp(p.amount, 1, 500) / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v1 = L[ci(y + oy, h - 1) * w + ci(x + ox, w - 1)];
      const v2 = L[ci(y - oy, h - 1) * w + ci(x - ox, w - 1)];
      const g = 128 + (v1 - v2) * k;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
    }
  }
  return data;
}

export function findEdges(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    const ym = ci(y - 1, h - 1) * w;
    const y0 = y * w;
    const yp = ci(y + 1, h - 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = ci(x - 1, w - 1);
      const xp = ci(x + 1, w - 1);
      const o = (y0 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const tl = data[(ym + xm) * 4 + c];
        const t = data[(ym + x) * 4 + c];
        const tr = data[(ym + xp) * 4 + c];
        const l = data[(y0 + xm) * 4 + c];
        const r = data[(y0 + xp) * 4 + c];
        const bl = data[(yp + xm) * 4 + c];
        const b = data[(yp + x) * 4 + c];
        const br = data[(yp + xp) * 4 + c];
        const gx = tr + 2 * r + br - tl - 2 * l - bl;
        const gy = bl + 2 * b + br - tl - 2 * t - tr;
        out[o + c] = 255 - Math.sqrt(gx * gx + gy * gy) / 4;
      }
      out[o + 3] = data[o + 3];
    }
  }
  return out;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

/** amount > 0 darkens the edges, < 0 lightens them. */
export function vignette(data: Uint8ClampedArray, w: number, h: number, p: { amount: number; size: number; feather: number }): Uint8ClampedArray {
  const amt = clamp(p.amount, -100, 100) / 100;
  if (!amt) return data;
  const inner = (clamp(p.size, 0, 100) / 100) * 0.9;
  const outer = inner + Math.max(0.05, clamp(p.feather, 0, 100) / 100);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5 - cy) / cy;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5 - cx) / cx;
      const f = smoothstep(inner, outer, Math.sqrt(u * u + v * v) / Math.SQRT2);
      if (f <= 0) continue;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const val = data[i + c];
        data[i + c] = amt > 0 ? val * (1 - f * amt) : val + (255 - val) * f * -amt;
      }
    }
  }
  return data;
}

/** Film grain: monochrome noise, stronger in the midtones, `size` px clumps. */
export function grain(data: Uint8ClampedArray, w: number, h: number, p: { amount: number; size: number; seed?: number }): Uint8ClampedArray {
  const amp = clamp(p.amount, 0, 100) * 0.7;
  if (!amp) return data;
  const s = clamp(p.size, 1, 10);
  const gw = Math.max(2, Math.ceil(w / s) + 2);
  const gh = Math.max(2, Math.ceil(h / s) + 2);
  const rand = mulberry32(p.seed ?? 4321);
  const field = new Float32Array(gw * gh);
  for (let i = 0; i < field.length; i++) field[i] = gaussRandom(rand);
  for (let y = 0; y < h; y++) {
    const fy = y / s;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x / s;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = field[y0 * gw + x0];
      const b = field[y0 * gw + x0 + 1];
      const c = field[(y0 + 1) * gw + x0];
      const d = field[(y0 + 1) * gw + x0 + 1];
      const n = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      const i = (y * w + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]) / 255;
      const weight = 1 - Math.pow(Math.abs(2 * l - 1), 2) * 0.6;
      const delta = n * amp * weight;
      data[i] += delta;
      data[i + 1] += delta;
      data[i + 2] += delta;
    }
  }
  return data;
}

/** Classic "oil paint": most frequent intensity bin in the neighbourhood, averaged color. */
export function oilPaint(data: Uint8ClampedArray, w: number, h: number, p: { radius: number; levels: number }): Uint8ClampedArray {
  const r = Math.round(clamp(p.radius, 1, 10));
  const levels = Math.round(clamp(p.levels, 4, 64));
  const bin = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < bin.length; i += 4, j++) bin[j] = Math.round((luma(data[i], data[i + 1], data[i + 2]) * (levels - 1)) / 255);
  const out = new Uint8ClampedArray(data.length);
  const count = new Int32Array(levels);
  const sr = new Float64Array(levels);
  const sg = new Float64Array(levels);
  const sb = new Float64Array(levels);
  const update = (x: number, y0: number, sign: number) => {
    const xx = ci(x, w - 1);
    for (let dy = -r; dy <= r; dy++) {
      const j = ci(y0 + dy, h - 1) * w + xx;
      const k = bin[j];
      count[k] += sign;
      sr[k] += sign * data[j * 4];
      sg[k] += sign * data[j * 4 + 1];
      sb[k] += sign * data[j * 4 + 2];
    }
  };
  for (let y = 0; y < h; y++) {
    count.fill(0);
    sr.fill(0);
    sg.fill(0);
    sb.fill(0);
    for (let dx = -r; dx <= r; dx++) update(dx, y, 1);
    for (let x = 0; x < w; x++) {
      if (x > 0) {
        update(x - r - 1, y, -1);
        update(x + r, y, 1);
      }
      let best = 0;
      for (let k = 1; k < levels; k++) if (count[k] > count[best]) best = k;
      const o = (y * w + x) * 4;
      const n = count[best] || 1;
      out[o] = sr[best] / n;
      out[o + 1] = sg[best] / n;
      out[o + 2] = sb[best] / n;
      out[o + 3] = data[o + 3];
    }
  }
  return out;
}

/* ------------------------------ Selection blend ------------------------------ */

export interface MaskLike {
  mask: Uint8Array;
  width: number;
  height: number;
}

/**
 * Mixes `processed` into `orig` by the selection mask (document space); the buffers are a
 * layer of size lw×lh positioned at (lx, ly). Writes into `orig` and returns it.
 */
export function blendBySelection(
  orig: Uint8ClampedArray,
  processed: Uint8ClampedArray,
  lw: number,
  lh: number,
  lx: number,
  ly: number,
  sel: MaskLike | null,
): Uint8ClampedArray {
  if (!sel) {
    orig.set(processed);
    return orig;
  }
  for (let y = 0; y < lh; y++) {
    const dy = y + ly;
    for (let x = 0; x < lw; x++) {
      const dx = x + lx;
      const t = dx < 0 || dy < 0 || dx >= sel.width || dy >= sel.height ? 0 : sel.mask[dy * sel.width + dx];
      if (t === 0) continue;
      const i = (y * lw + x) * 4;
      if (t === 255) {
        orig[i] = processed[i];
        orig[i + 1] = processed[i + 1];
        orig[i + 2] = processed[i + 2];
        orig[i + 3] = processed[i + 3];
      } else {
        const f = t / 255;
        orig[i] += (processed[i] - orig[i]) * f;
        orig[i + 1] += (processed[i + 1] - orig[i + 1]) * f;
        orig[i + 2] += (processed[i + 2] - orig[i + 2]) * f;
        orig[i + 3] += (processed[i + 3] - orig[i + 3]) * f;
      }
    }
  }
  return orig;
}

/** Mask canvas pixels (alpha = mask) → opaque gray image so filters/adjustments can work on it. */
export function alphaToGray(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    data[i] = data[i + 1] = data[i + 2] = a;
    data[i + 3] = 255;
  }
}

/** Opaque gray image → mask canvas pixels (white, alpha = gray). */
export function grayToAlpha(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const v = luma(data[i], data[i + 1], data[i + 2]) * (data[i + 3] / 255);
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = v;
  }
}
