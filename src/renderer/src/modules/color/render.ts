/**
 * Canvas rendering helpers for Color Studio (DOM only — not unit tested).
 */
import { createCanvas, get2d, canvasToBlob } from '../../core/utils/image';
import { formatColor, textOn } from './colormath';
import { type GradientDoc, sortedStops } from './gradient';

/** PNG image of the palette: one column per swatch with its name, HEX and RGB values. */
export async function renderPalettePng(name: string, colors: { hex: string; name?: string }[], scale = 2): Promise<Blob> {
  const colW = 220;
  const swatchH = 260;
  const labelH = 86;
  const headerH = 64;
  const pad = 24;
  const width = pad * 2 + colW * colors.length;
  const height = headerH + swatchH + labelH + pad;
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = get2d(canvas);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#14161a';
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(name || 'Palette', pad, headerH / 2 + 4);
  colors.forEach((c, i) => {
    const x = pad + i * colW;
    ctx.fillStyle = c.hex;
    ctx.fillRect(x, headerH, colW, swatchH);
    ctx.fillStyle = textOn(c.hex);
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    ctx.fillText(formatColor(c.hex, 'hex'), x + 14, headerH + swatchH - 22);
    ctx.fillStyle = '#14161a';
    ctx.font = '600 14px Inter, system-ui, sans-serif';
    ctx.fillText(truncate(ctx, c.name || `Color ${i + 1}`, colW - 20), x + 4, headerH + swatchH + 22);
    ctx.fillStyle = '#5b606b';
    ctx.font = '12.5px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`RGB ${formatColor(c.hex, 'rgb')}`, x + 4, headerH + swatchH + 44);
    ctx.fillText(`CMYK ${formatColor(c.hex, 'cmyk')}`, x + 4, headerH + swatchH + 64);
  });
  return canvasToBlob(canvas, 'image/png');
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** Renders the gradient to a PNG of the given size (uses the canvas gradient APIs). */
export async function renderGradientPng(g: GradientDoc, width: number, height: number): Promise<Blob> {
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  let grad: CanvasGradient;
  const cx = (g.cx / 100) * width;
  const cy = (g.cy / 100) * height;
  if (g.type === 'linear') {
    const rad = (g.angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
    grad = ctx.createLinearGradient(width / 2 - dx * half, height / 2 - dy * half, width / 2 + dx * half, height / 2 + dy * half);
  } else if (g.type === 'radial') {
    const fx = Math.max(cx, width - cx);
    const fy = Math.max(cy, height - cy);
    if (g.shape === 'ellipse') {
      // draw a circle gradient in a scaled space
      const rx = fx * Math.SQRT2;
      const ry = fy * Math.SQRT2;
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      addStops(grad, g);
      ctx.fillStyle = grad;
      ctx.fillRect(-cx, -cy * (rx / ry), width, height * (rx / ry));
      return canvasToBlob(canvas, 'image/png');
    }
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(fx, fy));
  } else {
    // canvas conic gradients start at 3 o'clock, CSS at 12 o'clock
    grad = ctx.createConicGradient(((g.angle - 90) * Math.PI) / 180, cx, cy);
  }
  addStops(grad, g);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  return canvasToBlob(canvas, 'image/png');
}

function addStops(grad: CanvasGradient, g: GradientDoc) {
  for (const s of sortedStops(g)) {
    try {
      grad.addColorStop(Math.max(0, Math.min(1, s.position / 100)), s.color);
    } catch {
      // invalid color string: skip
    }
  }
}

export interface LoadedImage {
  /** Object/data URL for display. */
  url: string;
  width: number;
  height: number;
  /** Pixels used for picking (≤ 1600 px). */
  pick: ImageData;
  /** Downsampled pixels for clustering (≤ 240 px). */
  small: ImageData;
  /** JPEG data URL (≤ 1200 px) stored in project files. */
  dataUrl: string;
}

/** Decodes an image and prepares the pixel buffers used for extraction and picking. */
export async function prepareImage(source: HTMLImageElement | ImageBitmap): Promise<LoadedImage> {
  const w = (source as HTMLImageElement).naturalWidth || source.width;
  const h = (source as HTMLImageElement).naturalHeight || source.height;
  if (!w || !h) throw new Error('Could not decode image');
  const scaled = (max: number) => {
    const s = Math.min(1, max / Math.max(w, h));
    const c = createCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    const ctx = get2d(c, true);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  };
  const pickCanvas = scaled(1600);
  const smallCanvas = scaled(240);
  const storeCanvas = scaled(1200);
  const flat = createCanvas(storeCanvas.width, storeCanvas.height);
  const fctx = get2d(flat);
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, flat.width, flat.height);
  fctx.drawImage(storeCanvas, 0, 0);
  const blob = await canvasToBlob(pickCanvas, 'image/png');
  return {
    url: URL.createObjectURL(blob),
    width: pickCanvas.width,
    height: pickCanvas.height,
    pick: get2d(pickCanvas, true).getImageData(0, 0, pickCanvas.width, pickCanvas.height),
    small: get2d(smallCanvas, true).getImageData(0, 0, smallCanvas.width, smallCanvas.height),
    dataUrl: flat.toDataURL('image/jpeg', 0.86),
  };
}

/** Wheel pixels: hue by angle (clockwise from the top), saturation by radius, full brightness. */
export function drawWheel(canvas: HTMLCanvasElement, sizePx: number, toRgbHue: (wheelAngle: number) => number): void {
  const px = Math.max(16, Math.round(sizePx));
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = get2d(canvas);
  const img = ctx.createImageData(px, px);
  const data = img.data;
  const r = px / 2;
  const lut = new Float32Array(3601);
  for (let i = 0; i <= 3600; i++) lut[i] = toRgbHue(i / 10);
  for (let y = 0; y < px; y++) {
    const dy = y + 0.5 - r;
    for (let x = 0; x < px; x++) {
      const dx = x + 0.5 - r;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * px + x) * 4;
      if (dist > r + 0.5) continue;
      let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      const h = lut[Math.round(angle * 10)] / 60;
      const s = Math.min(1, dist / r);
      // HSV → RGB with v = 1
      const c = s;
      const xx = c * (1 - Math.abs((h % 2) - 1));
      const m = 1 - c;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      if (h < 1) [rr, gg, bb] = [c, xx, 0];
      else if (h < 2) [rr, gg, bb] = [xx, c, 0];
      else if (h < 3) [rr, gg, bb] = [0, c, xx];
      else if (h < 4) [rr, gg, bb] = [0, xx, c];
      else if (h < 5) [rr, gg, bb] = [xx, 0, c];
      else [rr, gg, bb] = [c, 0, xx];
      data[i] = (rr + m) * 255;
      data[i + 1] = (gg + m) * 255;
      data[i + 2] = (bb + m) * 255;
      data[i + 3] = dist > r - 0.5 ? Math.max(0, Math.min(255, (r + 0.5 - dist) * 255)) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Copies ImageData into a new canvas (for AI snapshots). */
export function imageDataToCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = createCanvas(data.width, data.height);
  get2d(canvas).putImageData(data, 0, 0);
  return canvas;
}
