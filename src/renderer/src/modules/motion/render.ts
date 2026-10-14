import { contentBox, inflate, strokeMargin, transformedBounds, type Box } from './bounds';
import { evaluateDoc, renderOrder, type EvaluatedLayer } from './evaluate';
import { flatten, shapeSubpaths, tracePath, trimPolylines, type Polyline } from './geometry';
import { multiply, type Mat } from './matrix';
import { charOffsets, layoutText } from './text-layout';
import type { BlendMode, Layer, MotionDoc, SubPath } from './types';

/**
 * Frame renderer shared by the stage preview and every exporter, so what you see is
 * exactly what gets exported.
 */

export interface MediaProvider {
  image(assetId: string): CanvasImageSource | null;
  /** Frame of a video layer at composition time `t` (or null while not available). */
  video(layer: Layer, t: number): CanvasImageSource | null;
}

export interface RenderOptions {
  time: number;
  /** Composition space → canvas pixels. */
  base: Mat;
  /** Canvas pixels per composition pixel (scales blur / shadow radii). */
  pixelScale: number;
  /** Paint the composition background color (ignored for transparent compositions). */
  background: boolean;
  /** Clip drawing to the composition rectangle. */
  clip: boolean;
  media: MediaProvider;
  evaluated?: Map<string, EvaluatedLayer>;
}

const BLEND_OPS: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  add: 'lighter',
};

/* ------------------------------ Geometry cache ----------------------------- */

const geomCache = new Map<string, SubPath[]>();
function shapeGeometry(layer: Layer, ev: EvaluatedLayer): SubPath[] {
  const s = layer.shape!;
  if (s.kind === 'path') return s.path ?? [];
  const key = `${s.kind}|${ev.size[0]}|${ev.size[1]}|${ev.cornerRadius}|${s.points}|${s.innerRadius}`;
  let g = geomCache.get(key);
  if (!g) {
    g = shapeSubpaths({ kind: s.kind, width: ev.size[0], height: ev.size[1], radius: ev.cornerRadius, points: s.points, innerRadius: s.innerRadius });
    if (geomCache.size > 500) geomCache.clear();
    geomCache.set(key, g);
  }
  return g;
}

const flatCache = new WeakMap<SubPath[], { tolerance: number; polys: Polyline[] }>();
function flattened(geom: SubPath[], tolerance: number): Polyline[] {
  const hit = flatCache.get(geom);
  if (hit && hit.tolerance <= tolerance * 1.5 && hit.tolerance >= tolerance / 3) return hit.polys;
  const polys = flatten(geom, tolerance);
  flatCache.set(geom, { tolerance, polys });
  return polys;
}

/* ------------------------------ Content drawing ----------------------------- */

function drawShape(ctx: CanvasRenderingContext2D, layer: Layer, ev: EvaluatedLayer, unitsPerPixel: number): void {
  const s = layer.shape;
  if (!s) return;
  const geom = shapeGeometry(layer, ev);
  if (!geom.length) return;
  const fill = s.fillEnabled && s.kind !== 'line';
  const stroke = s.strokeEnabled && ev.strokeWidth > 0;
  if (!fill && !stroke) return;
  const trimmed = ev.trimStart > 0.0001 || ev.trimEnd < 99.9999;
  ctx.beginPath();
  if (!trimmed) tracePath(ctx, geom);
  else {
    const parts = trimPolylines(flattened(geom, Math.max(0.02, unitsPerPixel * 0.35)), ev.trimStart, ev.trimEnd);
    if (!parts.length) return;
    for (const part of parts) {
      const p = part.points;
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      if (part.closed) ctx.closePath();
    }
  }
  if (fill) {
    ctx.fillStyle = ev.fill;
    ctx.fill('nonzero');
  }
  if (stroke) {
    ctx.strokeStyle = ev.strokeColor;
    ctx.lineWidth = ev.strokeWidth;
    ctx.lineCap = s.lineCap;
    ctx.lineJoin = s.lineJoin;
    ctx.miterLimit = 4;
    ctx.stroke();
  }
}

/** Units revealed (typewriter / word / line reveal) → per-unit alpha. */
function revealAlpha(index: number, revealed: number, style: 'instant' | 'fade' | 'rise'): number {
  if (style === 'instant') return index < Math.floor(revealed + 1e-6) ? 1 : 0;
  return Math.max(0, Math.min(1, revealed - index));
}

function drawText(ctx: CanvasRenderingContext2D, layer: Layer, ev: EvaluatedLayer): void {
  const t = layer.text;
  if (!t || !t.text) return;
  const layout = layoutText(t, ev.letterSpacing);
  const fill = t.fillEnabled;
  const stroke = t.strokeEnabled && ev.strokeWidth > 0;
  if (!fill && !stroke) return;
  ctx.font = layout.font;
  ctx.letterSpacing = `${ev.letterSpacing}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.fillStyle = ev.fill;
  ctx.strokeStyle = ev.strokeColor;
  // Stroke is painted behind the fill, so double it to keep the visible outline width.
  ctx.lineWidth = fill ? ev.strokeWidth * 2 : ev.strokeWidth;

  const paint = (text: string, x: number, y: number) => {
    if (stroke) ctx.strokeText(text, x, y);
    if (fill) ctx.fillText(text, x, y);
  };

  if (ev.reveal >= 100) {
    for (const line of layout.lines) if (line.text) paint(line.text, line.x, line.y);
    return;
  }
  const mode = t.revealMode;
  const style = t.revealStyle;
  const rise = t.fontSize * 0.45;
  const baseAlpha = ctx.globalAlpha;

  if (mode === 'lines') {
    const revealed = (ev.reveal / 100) * layout.lines.length;
    layout.lines.forEach((line, i) => {
      const a = revealAlpha(i, revealed, style);
      if (a <= 0 || !line.text) return;
      ctx.globalAlpha = baseAlpha * a;
      paint(line.text, line.x, line.y + (style === 'rise' ? (1 - a) * rise : 0));
    });
    ctx.globalAlpha = baseAlpha;
    return;
  }

  if (mode === 'words') {
    // Words are runs of non-space characters; spaces are revealed with the word before them.
    const words: { line: number; start: number; end: number }[] = [];
    layout.lines.forEach((line, li) => {
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line.text))) words.push({ line: li, start: m.index, end: m.index + m[0].length });
    });
    const revealed = (ev.reveal / 100) * words.length;
    words.forEach((w, i) => {
      const a = revealAlpha(i, revealed, style);
      if (a <= 0) return;
      const line = layout.lines[w.line];
      const offsets = charOffsets(line.text, layout.font, ev.letterSpacing);
      ctx.globalAlpha = baseAlpha * a;
      paint(line.text.slice(w.start, w.end), line.x + offsets[w.start], line.y + (style === 'rise' ? (1 - a) * rise : 0));
    });
    ctx.globalAlpha = baseAlpha;
    return;
  }

  // Characters
  const total = layout.charCount;
  const revealed = (ev.reveal / 100) * total;
  for (const line of layout.lines) {
    if (!line.text) continue;
    if (style === 'instant') {
      const count = Math.max(0, Math.min(line.text.length, Math.floor(revealed + 1e-6) - line.start));
      if (count > 0) paint(line.text.slice(0, count), line.x, line.y);
      continue;
    }
    const offsets = charOffsets(line.text, layout.font, ev.letterSpacing);
    for (let i = 0; i < line.text.length; i++) {
      const a = revealAlpha(line.start + i, revealed, style);
      if (a <= 0) break;
      const ch = line.text[i];
      if (ch === ' ') continue;
      ctx.globalAlpha = baseAlpha * a;
      paint(ch, line.x + offsets[i], line.y + (style === 'rise' ? (1 - a) * rise : 0));
    }
  }
  ctx.globalAlpha = baseAlpha;
}

function drawContent(
  ctx: CanvasRenderingContext2D,
  doc: MotionDoc,
  layer: Layer,
  ev: EvaluatedLayer,
  opts: RenderOptions,
  unitsPerPixel: number,
): void {
  switch (layer.type) {
    case 'shape':
      drawShape(ctx, layer, ev, unitsPerPixel);
      break;
    case 'text':
      drawText(ctx, layer, ev);
      break;
    case 'solid':
      ctx.fillStyle = ev.fill;
      ctx.fillRect(-ev.size[0] / 2, -ev.size[1] / 2, ev.size[0], ev.size[1]);
      break;
    case 'image':
    case 'video': {
      if (!layer.assetId) break;
      const src = layer.type === 'image' ? opts.media.image(layer.assetId) : opts.media.video(layer, opts.time);
      if (!src) break;
      const box = contentBox(layer, ev, doc.assets);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, box.x, box.y, box.w, box.h);
      break;
    }
    case 'null':
      break;
  }
}

/* --------------------------------- Renderer -------------------------------- */

export class FrameRenderer {
  private layerCanvas: HTMLCanvasElement | null = null;
  private tintCanvas: HTMLCanvasElement | null = null;

  private scratch(which: 'layer' | 'tint', w: number, h: number): CanvasRenderingContext2D {
    let c = which === 'layer' ? this.layerCanvas : this.tintCanvas;
    if (!c) {
      c = document.createElement('canvas');
      if (which === 'layer') this.layerCanvas = c;
      else this.tintCanvas = c;
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c.getContext('2d')!;
  }

  /** Frees the scratch canvases (call when the owner goes away). */
  dispose(): void {
    for (const c of [this.layerCanvas, this.tintCanvas]) {
      if (c) {
        c.width = 1;
        c.height = 1;
      }
    }
    this.layerCanvas = null;
    this.tintCanvas = null;
  }

  render(ctx: CanvasRenderingContext2D, doc: MotionDoc, opts: RenderOptions): void {
    const { comp } = doc;
    const canvas = ctx.canvas;
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    const b = opts.base;
    ctx.setTransform(b[0], b[1], b[2], b[3], b[4], b[5]);
    if (opts.clip) {
      ctx.beginPath();
      ctx.rect(0, 0, comp.width, comp.height);
      ctx.clip();
    }
    if (opts.background && !comp.transparent) {
      ctx.fillStyle = comp.background;
      ctx.fillRect(0, 0, comp.width, comp.height);
    }
    const evaluated = opts.evaluated ?? evaluateDoc(doc, opts.time);
    const viewport: Box = { x: 0, y: 0, w: W, h: H };
    for (const layer of renderOrder(doc, opts.time)) {
      const ev = evaluated.get(layer.id);
      if (!ev || ev.opacity <= 0) continue;
      try {
        this.drawLayer(ctx, doc, layer, ev, opts, viewport);
      } catch (error) {
        // One broken layer must never break the whole frame.
        console.warn('[motion] layer render failed', layer.name, error);
      }
    }
    ctx.restore();
  }

  private drawLayer(ctx: CanvasRenderingContext2D, doc: MotionDoc, layer: Layer, ev: EvaluatedLayer, opts: RenderOptions, viewport: Box): void {
    const m = multiply(opts.base, ev.world);
    const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    if (det < 1e-10) return; // scaled to nothing
    const unitsPerPixel = 1 / Math.sqrt(det);
    const opacity = ev.opacity / 100;
    const fx = layer.effects;
    const blur = ev.blur * opts.pixelScale;
    const shadow = fx.shadow.enabled;
    const glow = fx.glow.enabled && fx.glow.intensity > 0;
    const multiPart =
      layer.type === 'text' ||
      (layer.type === 'shape' && Boolean(layer.shape?.fillEnabled && layer.shape?.strokeEnabled && ev.strokeWidth > 0));
    const composite = blur > 0.05 || shadow || glow || ((opacity < 1 || layer.blendMode !== 'normal') && multiPart);

    if (!composite) {
      ctx.save();
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.globalAlpha *= opacity;
      ctx.globalCompositeOperation = BLEND_OPS[layer.blendMode];
      drawContent(ctx, doc, layer, ev, opts, unitsPerPixel);
      ctx.restore();
      return;
    }

    // Region of the canvas the layer can touch (content + stroke), clipped to the canvas.
    const local = inflate(contentBox(layer, ev, doc.assets), strokeMargin(layer, ev) + 2);
    const screen = transformedBounds(m, local);
    const region = intersect(inflate(screen, 2), viewport);
    if (!region) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const lctx = this.scratch('layer', W, H);
    lctx.save();
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(region.x, region.y, region.w, region.h);
    lctx.beginPath();
    lctx.rect(region.x, region.y, region.w, region.h);
    lctx.clip();
    lctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    drawContent(lctx, doc, layer, ev, opts, unitsPerPixel);
    lctx.restore();
    const layerCanvas = lctx.canvas;
    const { x, y, w, h } = region;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (glow) {
      const tctx = this.scratch('tint', W, H);
      tctx.save();
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = 'source-over';
      tctx.clearRect(x, y, w, h);
      tctx.drawImage(layerCanvas, x, y, w, h, x, y, w, h);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = fx.glow.color;
      tctx.fillRect(x, y, w, h);
      tctx.restore();
      const radius = Math.max(0.5, fx.glow.radius * opts.pixelScale);
      const passes = fx.glow.intensity / 100;
      ctx.filter = `blur(${radius.toFixed(2)}px)`;
      ctx.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : BLEND_OPS[layer.blendMode];
      for (let p = passes; p > 0.001; p -= 1) {
        ctx.globalAlpha = opacity * Math.min(1, p);
        ctx.drawImage(tctx.canvas, x, y, w, h, x, y, w, h);
      }
      ctx.filter = 'none';
    }
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = BLEND_OPS[layer.blendMode];
    if (blur > 0.05) ctx.filter = `blur(${blur.toFixed(2)}px)`;
    if (shadow) {
      const rad = (fx.shadow.angle * Math.PI) / 180;
      ctx.shadowColor = fx.shadow.color;
      ctx.shadowBlur = fx.shadow.softness * opts.pixelScale;
      ctx.shadowOffsetX = Math.cos(rad) * fx.shadow.distance * opts.pixelScale;
      ctx.shadowOffsetY = Math.sin(rad) * fx.shadow.distance * opts.pixelScale;
    }
    ctx.drawImage(layerCanvas, x, y, w, h, x, y, w, h);
    ctx.restore();
  }
}

function intersect(a: Box, b: Box): Box | null {
  const x0 = Math.max(Math.floor(a.x), b.x);
  const y0 = Math.max(Math.floor(a.y), b.y);
  const x1 = Math.min(Math.ceil(a.x + a.w), b.x + b.w);
  const y1 = Math.min(Math.ceil(a.y + a.h), b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
