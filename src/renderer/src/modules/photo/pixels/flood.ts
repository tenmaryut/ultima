/**
 * Flood fill / magic wand masks and "uniform background" detection (pure functions).
 */
import { boxBlurChannel } from '../selection';

type RGBA4 = [number, number, number, number];

function matcher(data: Uint8ClampedArray, color: RGBA4, tolerance: number) {
  const [r0, g0, b0, a0] = color;
  const tol = Math.max(0, Math.min(255, tolerance));
  return (p: number): boolean => {
    const j = p * 4;
    const a = data[j + 3];
    // fully transparent pixels match each other regardless of their (meaningless) color
    if (a === 0 && a0 === 0) return true;
    return (
      Math.abs(data[j] - r0) <= tol &&
      Math.abs(data[j + 1] - g0) <= tol &&
      Math.abs(data[j + 2] - b0) <= tol &&
      Math.abs(a - a0) <= tol
    );
  };
}

/** Scanline flood fill from several seed pixels; matching is relative to `color`. */
export function floodFromSeeds(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seeds: number[],
  color: RGBA4,
  tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const match = matcher(data, color, tolerance);
  let stack = new Int32Array(Math.max(64, seeds.length));
  let sp = 0;
  const push = (x: number, y: number) => {
    if (sp + 2 > stack.length) {
      const bigger = new Int32Array(stack.length * 2);
      bigger.set(stack);
      stack = bigger;
    }
    stack[sp++] = x;
    stack[sp++] = y;
  };
  for (let i = 0; i + 1 < seeds.length; i += 2) {
    const x = seeds[i];
    const y = seeds[i + 1];
    if (x >= 0 && y >= 0 && x < w && y < h && match(y * w + x)) push(x, y);
  }
  while (sp > 0) {
    const y = stack[--sp];
    const x = stack[--sp];
    const row = y * w;
    if (mask[row + x]) continue;
    let xl = x;
    while (xl > 0 && !mask[row + xl - 1] && match(row + xl - 1)) xl--;
    let xr = x;
    while (xr < w - 1 && !mask[row + xr + 1] && match(row + xr + 1)) xr++;
    mask.fill(255, row + xl, row + xr + 1);
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inSpan = false;
      for (let xx = xl; xx <= xr; xx++) {
        const ok = !mask[nrow + xx] && match(nrow + xx);
        if (ok && !inSpan) {
          push(xx, ny);
          inSpan = true;
        } else if (!ok) inSpan = false;
      }
    }
  }
  return mask;
}

/** Magic wand / paint bucket region (0/255) for the pixel at (sx, sy). */
export function floodMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean,
): Uint8Array {
  const x = Math.floor(sx);
  const y = Math.floor(sy);
  if (x < 0 || y < 0 || x >= w || y >= h) return new Uint8Array(w * h);
  const i0 = (y * w + x) * 4;
  const color: RGBA4 = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
  if (contiguous) return floodFromSeeds(data, w, h, [x, y], color, tolerance);
  const mask = new Uint8Array(w * h);
  const match = matcher(data, color, tolerance);
  for (let p = 0; p < w * h; p++) if (match(p)) mask[p] = 255;
  return mask;
}

/** Softens a hard 0/255 mask by one pixel (anti-aliased edges). */
export function antialiasMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  boxBlurChannel(mask, out, w, h, 1);
  for (let i = 0; i < mask.length; i++) if (mask[i] === 255) out[i] = 255;
  return out;
}

/** Median color of the image border (the likely background color). */
export function borderColor(data: Uint8ClampedArray, w: number, h: number): RGBA4 {
  const ch: number[][] = [[], [], [], []];
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) ch[c].push(data[i + c]);
  };
  const step = Math.max(1, Math.floor((w + h) / 2000));
  for (let x = 0; x < w; x += step) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    add(0, y);
    add(w - 1, y);
  }
  return ch.map((values) => {
    values.sort((a, b) => a - b);
    return values[values.length >> 1] ?? 0;
  }) as RGBA4;
}

/**
 * Mask (255 = background) of a uniform background connected to the image border.
 * Used by "Remove uniform background" when no AI tool is installed.
 */
export function uniformBackgroundMask(data: Uint8ClampedArray, w: number, h: number, tolerance: number): Uint8Array {
  const color = borderColor(data, w, h);
  const seeds: number[] = [];
  for (let x = 0; x < w; x++) seeds.push(x, 0, x, h - 1);
  for (let y = 0; y < h; y++) seeds.push(0, y, w - 1, y);
  return floodFromSeeds(data, w, h, seeds, color, tolerance);
}

/** Makes the masked (background) pixels transparent, with a 1px soft edge. Modifies `data`. */
export function clearByMask(data: Uint8ClampedArray, w: number, h: number, bgMask: Uint8Array): void {
  const soft = antialiasMask(bgMask, w, h);
  for (let p = 0; p < w * h; p++) {
    const m = soft[p];
    if (m) data[p * 4 + 3] = (data[p * 4 + 3] * (255 - m)) / 255;
  }
}
