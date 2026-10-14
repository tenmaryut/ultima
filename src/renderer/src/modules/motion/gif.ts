/** GIF encoding helpers (pure): frame delays, palette sampling, dithering to a fixed palette. */

export type Palette = number[][];

/**
 * Per-frame delays in ms (multiples of 10, GIF's resolution) whose running total tracks
 * the real frame times, e.g. 30 fps → 30, 30, 40, 30, 30, 40 …
 */
export function gifDelays(frames: number, fps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < frames; i++) {
    const a = Math.round((i * 100) / fps);
    const b = Math.round(((i + 1) * 100) / fps);
    out.push(Math.max(2, b - a) * 10);
  }
  return out;
}

/**
 * Collects up to `maxPixels` opaque pixels from several frames into one RGBA buffer, so a
 * single global palette represents the whole animation.
 */
export function samplePixels(frames: Uint8ClampedArray[], maxPixels = 400_000, alphaThreshold = 128): Uint8ClampedArray {
  let opaque = 0;
  for (const f of frames) for (let i = 3; i < f.length; i += 4) if (f[i] >= alphaThreshold) opaque++;
  const step = Math.max(1, Math.ceil(opaque / maxPixels));
  const out = new Uint8ClampedArray(Math.ceil(opaque / step) * 4 + 4);
  let n = 0;
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3] < alphaThreshold) continue;
      if (k++ % step) continue;
      out[n++] = f[i];
      out[n++] = f[i + 1];
      out[n++] = f[i + 2];
      out[n++] = 255;
    }
  }
  return n ? out.subarray(0, n) : new Uint8ClampedArray([0, 0, 0, 255]);
}

/** Nearest palette index with a 15-bit color cache. */
export function nearestLookup(palette: Palette): (r: number, g: number, b: number) => number {
  const cache = new Int16Array(32768).fill(-1);
  const count = palette.length;
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key];
    if (hit >= 0) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < count; i++) {
      const p = palette[i];
      const dr = p[0] - r;
      const dg = p[1] - g;
      const db = p[2] - b;
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };
}

/**
 * Maps RGBA pixels onto the palette, optionally with serpentine Floyd–Steinberg dithering.
 * Pixels with alpha below `alphaThreshold` get `transparentIndex` (when given).
 */
export function indexFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Palette,
  options: { dither: boolean; transparentIndex?: number; alphaThreshold?: number; lookup?: (r: number, g: number, b: number) => number },
): Uint8Array {
  const lookup = options.lookup ?? nearestLookup(palette.slice(0, options.transparentIndex ?? palette.length));
  const threshold = options.alphaThreshold ?? 128;
  const out = new Uint8Array(width * height);
  const transparent = options.transparentIndex;
  if (!options.dither) {
    for (let i = 0, p = 0; p < out.length; i += 4, p++) {
      out[p] = transparent !== undefined && rgba[i + 3] < threshold ? transparent : lookup(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
    return out;
  }
  // Error buffers for the current and next row (r,g,b per pixel).
  let cur = new Float32Array(width * 3);
  let next = new Float32Array(width * 3);
  for (let y = 0; y < height; y++) {
    next.fill(0);
    const ltr = y % 2 === 0;
    for (let n = 0; n < width; n++) {
      const x = ltr ? n : width - 1 - n;
      const p = y * width + x;
      const i = p * 4;
      if (transparent !== undefined && rgba[i + 3] < threshold) {
        out[p] = transparent;
        continue;
      }
      const r = clamp(rgba[i] + cur[x * 3]);
      const g = clamp(rgba[i + 1] + cur[x * 3 + 1]);
      const b = clamp(rgba[i + 2] + cur[x * 3 + 2]);
      const idx = lookup(r, g, b);
      out[p] = idx;
      const c = palette[idx];
      const er = r - c[0];
      const eg = g - c[1];
      const eb = b - c[2];
      const dir = ltr ? 1 : -1;
      const xn = x + dir;
      const xp = x - dir;
      if (xn >= 0 && xn < width) add(cur, xn, er, eg, eb, 7 / 16);
      if (xp >= 0 && xp < width) add(next, xp, er, eg, eb, 3 / 16);
      add(next, x, er, eg, eb, 5 / 16);
      if (xn >= 0 && xn < width) add(next, xn, er, eg, eb, 1 / 16);
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return out;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function add(buf: Float32Array, x: number, er: number, eg: number, eb: number, f: number): void {
  buf[x * 3] += er * f;
  buf[x * 3 + 1] += eg * f;
  buf[x * 3 + 2] += eb * f;
}
