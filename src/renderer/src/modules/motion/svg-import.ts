import { sanitizeSvg } from '../../core/ai/sanitize';
import { parseColor, toCss } from '../../core/utils/color';
import { createCanvas, canvasToBlob, loadImage } from '../../core/utils/image';
import { centerSubpaths, ellipsePath, pathBounds, rectPath } from './geometry';
import { IDENTITY, multiply, scaling, translate, type Mat } from './matrix';
import { createLayer, staticProp } from './model';
import { parsePathData, parseTransformAttr, transformSubpaths } from './svgpath';
import type { Composition, Layer, SubPath, Vec2 } from './types';

/**
 * SVG → layers. Simple vector art (paths and basic shapes with flat colors) becomes
 * editable path layers grouped under a null; anything richer is rasterized.
 */

const MAX_SHAPES = 150;
const UNSUPPORTED = 'text, image, use, mask, clipPath, filter, pattern, foreignObject, linearGradient, radialGradient, style';

interface Style {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
}

function readStyle(el: Element, inherited: Style): Style | 'unsupported' {
  const style = new Map<string, string>();
  for (const part of (el.getAttribute('style') ?? '').split(';')) {
    const [k, v] = part.split(':').map((s) => s?.trim());
    if (k && v) style.set(k.toLowerCase(), v);
  }
  const get = (name: string) => style.get(name) ?? el.getAttribute(name) ?? undefined;
  const color = (v: string | undefined, fallback: string | null): string | null | 'unsupported' => {
    if (v === undefined || v === 'inherit') return fallback;
    if (v === 'none' || v === 'transparent') return null;
    if (/url\(/i.test(v)) return 'unsupported';
    if (v === 'currentColor') return fallback ?? '#000000';
    const c = parseColor(v);
    return c ? toCss(c) : fallback;
  };
  const fill = color(get('fill'), inherited.fill);
  const stroke = color(get('stroke'), inherited.stroke);
  if (fill === 'unsupported' || stroke === 'unsupported') return 'unsupported';
  const sw = get('stroke-width');
  const op = parseFloat(get('opacity') ?? '1');
  const fillOp = parseFloat(get('fill-opacity') ?? '1');
  const strokeOp = parseFloat(get('stroke-opacity') ?? '1');
  const withAlpha = (c: string | null, a: number) => {
    if (!c || !Number.isFinite(a) || a >= 1) return c;
    const p = parseColor(c);
    return p ? toCss({ ...p, a: p.a * Math.max(0, a) }) : c;
  };
  return {
    fill: withAlpha(fill, fillOp),
    stroke: withAlpha(stroke, strokeOp),
    strokeWidth: sw !== undefined && Number.isFinite(parseFloat(sw)) ? parseFloat(sw) : inherited.strokeWidth,
    opacity: inherited.opacity * (Number.isFinite(op) ? Math.max(0, Math.min(1, op)) : 1),
  };
}

function num(el: Element, name: string): number {
  const v = parseFloat(el.getAttribute(name) ?? '0');
  return Number.isFinite(v) ? v : 0;
}

function shapeGeometry(el: Element): SubPath[] | null {
  switch (el.tagName.toLowerCase()) {
    case 'path': {
      const d = el.getAttribute('d');
      return d ? parsePathData(d) : null;
    }
    case 'rect': {
      const w = num(el, 'width');
      const h = num(el, 'height');
      if (w <= 0 || h <= 0) return null;
      const r = Math.max(num(el, 'rx'), num(el, 'ry'));
      return transformSubpaths([rectPath(w, h, r)], translate(num(el, 'x') + w / 2, num(el, 'y') + h / 2));
    }
    case 'circle': {
      const r = num(el, 'r');
      if (r <= 0) return null;
      return transformSubpaths([ellipsePath(r * 2, r * 2)], translate(num(el, 'cx'), num(el, 'cy')));
    }
    case 'ellipse': {
      const rx = num(el, 'rx');
      const ry = num(el, 'ry');
      if (rx <= 0 || ry <= 0) return null;
      return transformSubpaths([ellipsePath(rx * 2, ry * 2)], translate(num(el, 'cx'), num(el, 'cy')));
    }
    case 'line':
      return parsePathData(`M${num(el, 'x1')} ${num(el, 'y1')} L${num(el, 'x2')} ${num(el, 'y2')}`);
    case 'polyline':
    case 'polygon': {
      const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(parseFloat);
      if (pts.length < 4 || pts.some((p) => !Number.isFinite(p))) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
      if (el.tagName.toLowerCase() === 'polygon') d += ' Z';
      return parsePathData(d);
    }
  }
  return null;
}

interface FoundShape {
  name: string;
  subpaths: SubPath[];
  style: Style;
}

function viewBoxMatrix(svg: Element): { m: Mat; width: number; height: number } {
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(parseFloat);
  const w = parseFloat(svg.getAttribute('width') ?? '');
  const h = parseFloat(svg.getAttribute('height') ?? '');
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    const width = Number.isFinite(w) && w > 0 ? w : vb[2];
    const height = Number.isFinite(h) && h > 0 ? h : vb[3];
    return { m: multiply(scaling(width / vb[2], height / vb[3]), translate(-vb[0], -vb[1])), width, height };
  }
  return { m: [...IDENTITY], width: Number.isFinite(w) && w > 0 ? w : 0, height: Number.isFinite(h) && h > 0 ? h : 0 };
}

/** Collects drawable shapes. Returns null when the SVG uses features we can't keep editable. */
export function collectSvgShapes(svgText: string): { shapes: FoundShape[]; width: number; height: number } | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  if (svg.querySelector(UNSUPPORTED)) return null;
  const { m: rootMatrix, width, height } = viewBoxMatrix(svg);
  const shapes: FoundShape[] = [];
  let unsupported = false;
  const walk = (el: Element, m: Mat, style: Style) => {
    if (unsupported) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata') return;
    const s = readStyle(el, style);
    if (s === 'unsupported') {
      unsupported = true;
      return;
    }
    if (el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden') return;
    const matrix = multiply(m, parseTransformAttr(el.getAttribute('transform')));
    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      for (const child of Array.from(el.children)) walk(child, tag === 'svg' && el !== svg ? matrix : matrix, s);
      return;
    }
    let geom: SubPath[] | null = null;
    try {
      geom = shapeGeometry(el);
    } catch {
      unsupported = true;
      return;
    }
    if (!geom?.length) return;
    if (!s.fill && !s.stroke) return;
    shapes.push({ name: el.getAttribute('id') || el.getAttribute('inkscape:label') || tag, subpaths: transformSubpaths(geom, matrix), style: s });
    if (shapes.length > MAX_SHAPES) unsupported = true;
  };
  walk(svg, rootMatrix, { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1 });
  if (unsupported || !shapes.length) return null;
  return { shapes, width, height };
}

export interface SvgImportResult {
  /** Layers to add (top-most first). */
  layers: Layer[];
  /** Raster image to add as an asset when the SVG couldn't be kept as vectors. */
  raster?: { blob: Blob; name: string };
}

/**
 * Imports an SVG into the composition, scaled to fit ~70% of it and centered. Vectors →
 * path layers parented to a null named after the file; otherwise → a PNG raster.
 */
export async function importSvg(raw: string, comp: Composition, name: string, index: number): Promise<SvgImportResult> {
  const clean = sanitizeSvg(raw);
  if (!clean) throw new Error('The SVG could not be read.');
  const found = collectSvgShapes(clean);
  if (found) {
    let all: SubPath[] = [];
    for (const s of found.shapes) all = all.concat(s.subpaths);
    const b = pathBounds(all);
    const fit = Math.min((comp.width * 0.7) / Math.max(1, b.w), (comp.height * 0.7) / Math.max(1, b.h), 4);
    const center: Vec2 = [comp.width / 2, comp.height / 2];
    const group = createLayer('null', comp, { name: name || 'SVG', position: center }, index);
    const layers: Layer[] = [];
    found.shapes.forEach((s, i) => {
      // Normalize into the group space: centered on the artwork, scaled to fit.
      const scaled = transformSubpaths(s.subpaths, multiply(scaling(fit, fit), translate(-(b.x + b.w / 2), -(b.y + b.h / 2))));
      const centered = centerSubpaths(scaled);
      const layer = createLayer('shape', comp, { shapeKind: 'path', name: `${s.name} ${i + 1}`.trim() }, index + i + 1);
      layer.shape = { ...layer.shape!, path: centered.subpaths, fillEnabled: Boolean(s.style.fill), strokeEnabled: Boolean(s.style.stroke) };
      layer.parentId = group.id;
      layer.props = {
        ...layer.props,
        position: staticProp<Vec2>([centered.cx, centered.cy]),
        fill: staticProp(s.style.fill ?? '#000000'),
        strokeColor: staticProp(s.style.stroke ?? '#000000'),
        strokeWidth: staticProp(s.style.stroke ? Math.max(0.1, s.style.strokeWidth * fit) : 0),
        opacity: staticProp(Math.round(s.style.opacity * 100)),
      };
      layers.push(layer);
    });
    // SVG paints later elements on top; our layer list is top-most first.
    return { layers: [group, ...layers.reverse()] };
  }
  // Rasterize (at up to 2048 px) to keep the look of complex artwork.
  const blob = new Blob([clean], { type: 'image/svg+xml' });
  const img = await loadImage(blob);
  const w0 = img.naturalWidth || 512;
  const h0 = img.naturalHeight || 512;
  const s = Math.min(2048 / Math.max(w0, h0), Math.max(1, Math.min(comp.width / w0, comp.height / h0)));
  const canvas = createCanvas(w0 * s, h0 * s);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { layers: [], raster: { blob: await canvasToBlob(canvas, 'image/png'), name: `${name || 'SVG'}.png` } };
}
