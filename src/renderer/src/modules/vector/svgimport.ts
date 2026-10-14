import { normalizeColor } from './colors';
import { bakeScale, visualBounds } from './geometry';
import { IDENTITY, apply, chain, invert, multiply, parseTransform, scale, translate, type Matrix, type Pt, type Rect } from './matrix';
import {
  createEllipse,
  createGroup,
  createImage,
  createLine,
  createPath,
  createRaw,
  createRect,
  createText,
  defaultStroke,
  NONE,
  type BlendMode,
  BLEND_MODES,
  type GradientStop,
  type LineCap,
  type LineJoin,
  type Paint,
  type PathGeom,
  type Stroke,
  type TextAlign,
  type VObject,
} from './model';
import { geomBounds, parsePathData } from './path';
import {
  computeStyle,
  declaredStyle,
  firstFontFamily,
  fraction,
  hrefOf,
  parseCss,
  parseFontWeight,
  parseLength,
  parseNumberList,
  urlRef,
  type StyleMap,
} from './svgstyle';
import { layoutText } from './text';
import { localName, parseXml, serializeXml, textContent, walkElements, type XElement, type XNode } from './xml';

export interface ImportResult {
  /** Objects in viewport coordinates (0..width, 0..height). */
  objects: VObject[];
  width: number;
  height: number;
  /** Number of elements that were embedded as raw SVG content. */
  rawCount: number;
}

interface Ctx {
  ids: Map<string, XElement>;
  rules: ReturnType<typeof parseCss>;
  vb: [number, number, number, number];
  sharedDefs: string;
  rawCount: number;
  depth: number;
  /** While estimating raw bounds: never produce raw objects. */
  measuring: boolean;
}

const SKIP = new Set([
  'defs', 'style', 'title', 'desc', 'metadata', 'linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter',
  'symbol', 'marker', 'script', 'stop', 'font', 'font-face', 'namedview', 'cursor', 'view',
]);

/** Matrix mapping a viewBox into a viewport (preserveAspectRatio aware). */
export function viewBoxMatrix(vb: [number, number, number, number], width: number, height: number, par?: string): Matrix {
  const [x, y, w, h] = vb;
  if (w <= 0 || h <= 0) return IDENTITY;
  const sx = width / w;
  const sy = height / h;
  const p = (par ?? 'xMidYMid meet').trim();
  if (p.startsWith('none')) return chain(scale(sx, sy), translate(-x, -y));
  const slice = /slice/.test(p);
  const s = slice ? Math.max(sx, sy) : Math.min(sx, sy);
  const align = /x(Min|Mid|Max)Y(Min|Mid|Max)/.exec(p);
  const ax = align?.[1] ?? 'Mid';
  const ay = align?.[2] ?? 'Mid';
  const tx = ax === 'Min' ? 0 : ax === 'Mid' ? (width - w * s) / 2 : width - w * s;
  const ty = ay === 'Min' ? 0 : ay === 'Mid' ? (height - h * s) / 2 : height - h * s;
  return chain(translate(tx, ty), scale(s), translate(-x, -y));
}

/** Imports SVG markup (already sanitized) into editable objects. */
export function importSvg(markup: string): ImportResult {
  const doc = parseXml(markup);
  let root: XElement | null = localName(doc.name) === 'svg' ? doc : null;
  if (!root) walkElements(doc, (e) => (root = root ?? (localName(e.name) === 'svg' ? e : null)));
  if (!root) throw new Error('No <svg> element found');
  const svg: XElement = root;
  const list = parseNumberList(svg.attrs.viewBox);
  const hasVb = list.length === 4 && list[2] > 0 && list[3] > 0;
  let width = parseLength(svg.attrs.width, hasVb ? list[2] : 300);
  let height = parseLength(svg.attrs.height, hasVb ? list[3] : 150);
  if (!width || width <= 0) width = hasVb ? list[2] : 300;
  if (!height || height <= 0) height = hasVb ? list[3] : 150;
  const vb: [number, number, number, number] = hasVb ? [list[0], list[1], list[2], list[3]] : [0, 0, width, height];
  const rootM = viewBoxMatrix(vb, width, height, svg.attrs.preserveAspectRatio);

  const ids = new Map<string, XElement>();
  let css = '';
  const shared: string[] = [];
  walkElements(svg, (e) => {
    if (e.attrs.id) ids.set(e.attrs.id, e);
    const name = localName(e.name);
    if (name === 'style') css += textContent(e) + '\n';
    if (name === 'defs' || name === 'style') shared.push(serializeXml(e));
  });
  const ctx: Ctx = { ids, rules: parseCss(css), vb, sharedDefs: shared.join(''), rawCount: 0, depth: 0, measuring: false };
  const rootStyle = computeStyle({}, declaredStyle(svg, ctx.rules));
  delete rootStyle.opacity;
  const objects = convertChildren(svg, rootStyle, rootM, IDENTITY, ctx).map(bakeScale);
  return { objects, width, height, rawCount: ctx.rawCount };
}

function convertChildren(el: XElement, style: StyleMap, toObj: Matrix, abs: Matrix, ctx: Ctx): VObject[] {
  const out: VObject[] = [];
  for (const c of el.children) {
    if (c.type !== 'element') continue;
    const o = convertElement(c, style, toObj, abs, ctx);
    if (o) out.push(o);
  }
  return out;
}

function nameFor(el: XElement, fallback: string): string {
  return (el.attrs['inkscape:label'] ?? el.attrs.id ?? fallback).slice(0, 60);
}

function needsRaw(style: StyleMap, ctx: Ctx): boolean {
  if (urlRef(style['clip-path']) || urlRef(style.mask) || urlRef(style.filter)) return true;
  if (urlRef(style['marker-start']) || urlRef(style['marker-mid']) || urlRef(style['marker-end'])) return true;
  for (const key of ['fill', 'stroke']) {
    const ref = urlRef(style[key]);
    if (ref) {
      const target = ctx.ids.get(ref);
      const name = target ? localName(target.name) : '';
      if (name !== 'linearGradient' && name !== 'radialGradient') return Boolean(target);
    }
  }
  return false;
}

/**
 * @param toObj matrix from the parent's user space into the parent object's local space
 * @param abs matrix from the parent's user space into the root user space (viewBox space)
 */
function convertElement(el: XElement, parentStyle: StyleMap, toObj: Matrix, abs: Matrix, ctx: Ctx): VObject | null {
  const name = localName(el.name);
  if (SKIP.has(name) || (el.name.includes(':') && !el.name.startsWith('svg:'))) return null;
  const style = computeStyle(parentStyle, declaredStyle(el, ctx.rules));
  if (style.display === 'none') return null;
  const t = parseTransform(el.attrs.transform);
  const m = multiply(toObj, t);
  if (!ctx.measuring && needsRaw(style, ctx)) return rawFallback(el, parentStyle, toObj, abs, ctx);
  const opacity = clamp01(parseFloat(style.opacity ?? '1'), 1);
  let obj: VObject | null = null;
  const vbW = ctx.vb[2];
  const vbH = ctx.vb[3];
  const len = (v: string | undefined, ref: number) => parseLength(v, ref) ?? 0;

  switch (name) {
    case 'g':
    case 'a':
    case 'switch': {
      const children = convertChildren(el, style, IDENTITY, multiply(abs, t), ctx);
      if (!children.length) return null;
      obj = createGroup(children, nameFor(el, 'Group'));
      obj.m = m;
      break;
    }
    case 'svg': {
      const x = len(el.attrs.x, vbW);
      const y = len(el.attrs.y, vbH);
      const w = parseLength(el.attrs.width, vbW) ?? vbW;
      const h = parseLength(el.attrs.height, vbH) ?? vbH;
      const l = parseNumberList(el.attrs.viewBox);
      const inner = l.length === 4 ? viewBoxMatrix([l[0], l[1], l[2], l[3]], w, h, el.attrs.preserveAspectRatio) : IDENTITY;
      const local = multiply(translate(x, y), inner);
      const children = convertChildren(el, style, IDENTITY, chain(abs, t, local), ctx);
      if (!children.length) return null;
      obj = createGroup(children, nameFor(el, 'Group'));
      obj.m = multiply(m, local);
      break;
    }
    case 'use': {
      const ref = ctx.ids.get((hrefOf(el) ?? '').replace(/^#/, ''));
      if (!ref || ctx.depth > 8) return null;
      const x = len(el.attrs.x, vbW);
      const y = len(el.attrs.y, vbH);
      const shift = translate(x, y);
      ctx.depth++;
      let inner: VObject | null;
      if (localName(ref.name) === 'symbol') {
        const l = parseNumberList(ref.attrs.viewBox);
        const w = parseLength(el.attrs.width, vbW) ?? (l.length === 4 ? l[2] : vbW);
        const h = parseLength(el.attrs.height, vbH) ?? (l.length === 4 ? l[3] : vbH);
        const vbm = l.length === 4 ? viewBoxMatrix([l[0], l[1], l[2], l[3]], w, h, ref.attrs.preserveAspectRatio) : IDENTITY;
        const symStyle = computeStyle(style, declaredStyle(ref, ctx.rules));
        const children = convertChildren(ref, symStyle, IDENTITY, chain(abs, t, shift, vbm), ctx);
        inner = children.length ? { ...createGroup(children, nameFor(el, ref.attrs.id ?? 'Symbol')), m: chain(m, shift, vbm) } : null;
      } else {
        inner = convertElement(ref, style, multiply(m, shift), chain(abs, t, shift), ctx);
      }
      ctx.depth--;
      if (inner && opacity < 1) inner = { ...inner, opacity: inner.opacity * opacity };
      return inner;
    }
    case 'rect': {
      const w = len(el.attrs.width, vbW);
      const h = len(el.attrs.height, vbH);
      if (w <= 0 || h <= 0) return null;
      const rxRaw = parseLength(el.attrs.rx, vbW);
      const ryRaw = parseLength(el.attrs.ry, vbH);
      const r = Math.max(0, rxRaw ?? ryRaw ?? 0, 0);
      const x = len(el.attrs.x, vbW);
      const y = len(el.attrs.y, vbH);
      obj = createRect(0, 0, w, h, undefined, Math.min(r, ryRaw ?? r));
      obj.m = multiply(m, translate(x, y));
      applyPaint(obj, style, { x, y, width: w, height: h }, ctx);
      break;
    }
    case 'circle':
    case 'ellipse': {
      const cx = len(el.attrs.cx, vbW);
      const cy = len(el.attrs.cy, vbH);
      const rx = name === 'circle' ? len(el.attrs.r, Math.hypot(vbW, vbH) / Math.SQRT2) : (parseLength(el.attrs.rx, vbW) ?? parseLength(el.attrs.ry, vbH) ?? 0);
      const ry = name === 'circle' ? rx : (parseLength(el.attrs.ry, vbH) ?? rx);
      if (rx <= 0 || ry <= 0) return null;
      obj = createEllipse(0, 0, rx * 2, ry * 2);
      obj.m = multiply(m, translate(cx - rx, cy - ry));
      applyPaint(obj, style, { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 }, ctx);
      break;
    }
    case 'line': {
      const x1 = len(el.attrs.x1, vbW);
      const y1 = len(el.attrs.y1, vbH);
      const x2 = len(el.attrs.x2, vbW);
      const y2 = len(el.attrs.y2, vbH);
      obj = createLine(x1, y1, x2, y2);
      obj.m = m;
      applyPaint(obj, style, { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }, ctx);
      break;
    }
    case 'polyline':
    case 'polygon': {
      const pts = parseNumberList(el.attrs.points);
      if (pts.length < 4) return null;
      const nodes = [];
      for (let i = 0; i + 1 < pts.length; i += 2) nodes.push({ x: pts[i], y: pts[i + 1] });
      const geom: PathGeom = { subpaths: [{ nodes, closed: name === 'polygon' }] };
      obj = createPath(geom, undefined, name === 'polygon' ? 'Polygon' : 'Polyline');
      obj.m = m;
      applyPaint(obj, style, geomBounds(geom) ?? { x: 0, y: 0, width: 1, height: 1 }, ctx);
      break;
    }
    case 'path': {
      const geom = parsePathData(el.attrs.d ?? '');
      if (!geom.subpaths.length) return null;
      if (style['fill-rule'] === 'evenodd') geom.fillRule = 'evenodd';
      obj = createPath(geom);
      obj.m = m;
      applyPaint(obj, style, geomBounds(geom) ?? { x: 0, y: 0, width: 1, height: 1 }, ctx);
      break;
    }
    case 'text':
      obj = convertText(el, style, m, ctx);
      break;
    case 'image': {
      const href = hrefOf(el) ?? '';
      if (!/^data:image\//i.test(href)) return null;
      const w = len(el.attrs.width, vbW);
      const h = len(el.attrs.height, vbH);
      if (w <= 0 || h <= 0) return null;
      obj = createImage(0, 0, w, h, href, nameFor(el, 'Image'));
      obj.m = multiply(m, translate(len(el.attrs.x, vbW), len(el.attrs.y, vbH)));
      obj.preserve = el.attrs.preserveAspectRatio ?? 'xMidYMid meet';
      break;
    }
    default:
      return ctx.measuring ? null : rawFallback(el, parentStyle, toObj, abs, ctx);
  }
  if (!obj) return null;
  if (name !== 'g' && name !== 'svg' && name !== 'a' && name !== 'switch' && el.attrs.id) obj.name = nameFor(el, obj.name);
  obj.opacity = opacity;
  const blend = style['mix-blend-mode'] as BlendMode | undefined;
  if (blend && (BLEND_MODES as readonly string[]).includes(blend)) obj.blend = blend;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') obj.visible = false;
  return obj;
}

function clamp01(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/* ---------------------------------- Paint ---------------------------------- */

function applyPaint(obj: VObject, style: StyleMap, box: Rect, ctx: Ctx): void {
  const fillOpacity = clamp01(parseFloat(style['fill-opacity'] ?? '1'), 1);
  const strokeOpacity = clamp01(parseFloat(style['stroke-opacity'] ?? '1'), 1);
  obj.fill = obj.type === 'line' ? NONE : resolvePaint(style.fill ?? 'black', fillOpacity, style, box, ctx);
  const strokePaint = resolvePaint(style.stroke ?? 'none', strokeOpacity, style, box, ctx);
  const width = parseLength(style['stroke-width'], Math.hypot(ctx.vb[2], ctx.vb[3]) / Math.SQRT2) ?? 1;
  const dash = parseNumberList(style['stroke-dasharray']).filter((d) => d >= 0);
  const stroke: Stroke = {
    ...defaultStroke(strokePaint, Math.max(0, width)),
    dash: dash.some((d) => d > 0) ? dash : [],
    cap: (['butt', 'round', 'square'].includes(style['stroke-linecap']) ? style['stroke-linecap'] : 'butt') as LineCap,
    join: (['miter', 'round', 'bevel'].includes(style['stroke-linejoin']) ? style['stroke-linejoin'] : 'miter') as LineJoin,
    miterLimit: Math.max(1, parseFloat(style['stroke-miterlimit'] ?? '4') || 4),
  };
  obj.stroke = stroke;
}

function resolvePaint(value: string, opacity: number, style: StyleMap, box: Rect, ctx: Ctx): Paint {
  const v = value.trim();
  if (!v || v === 'none' || v === 'transparent') return NONE;
  const ref = urlRef(v);
  if (ref) {
    const target = ctx.ids.get(ref);
    const g = target ? convertGradient(target, box, opacity, ctx) : null;
    if (g) return g;
    const fallback = v.replace(/url\([^)]*\)/, '').trim();
    return fallback ? resolvePaint(fallback, opacity, style, box, ctx) : NONE;
  }
  const colorText = v === 'currentColor' || v === 'currentcolor' ? (style.color ?? 'black') : v;
  const color = normalizeColor(colorText, opacity);
  return color ? { type: 'solid', color } : NONE;
}

function gradientChain(el: XElement, ctx: Ctx): XElement[] {
  const chainList = [el];
  let cur = el;
  for (let i = 0; i < 10; i++) {
    const next = ctx.ids.get((hrefOf(cur) ?? '').replace(/^#/, ''));
    if (!next || chainList.includes(next)) break;
    chainList.push(next);
    cur = next;
  }
  return chainList;
}

function convertGradient(el: XElement, box: Rect, opacity: number, ctx: Ctx): Paint | null {
  const kind = localName(el.name);
  if (kind !== 'linearGradient' && kind !== 'radialGradient') return null;
  const list = gradientChain(el, ctx);
  const attr = (k: string) => list.find((e) => e.attrs[k] !== undefined)?.attrs[k];
  const stopHost = list.find((e) => e.children.some((c) => c.type === 'element' && localName(c.name) === 'stop'));
  const stops: GradientStop[] = [];
  let last = 0;
  for (const c of stopHost?.children ?? []) {
    if (c.type !== 'element' || localName(c.name) !== 'stop') continue;
    const st = computeStyle({}, declaredStyle(c, ctx.rules));
    const offset = Math.max(last, Math.min(1, fraction(c.attrs.offset ?? st.offset, 0)));
    last = offset;
    const so = clamp01(parseFloat(st['stop-opacity'] ?? '1'), 1);
    const color = normalizeColor(st['stop-color'] ?? 'black', so * opacity) ?? '#000000';
    stops.push({ offset, color });
  }
  if (!stops.length) return null;
  if (stops.length === 1) return { type: 'solid', color: stops[0].color };
  const user = attr('gradientUnits') === 'userSpaceOnUse';
  const gt = parseTransform(attr('gradientTransform'));
  const bw = box.width || 1;
  const bh = box.height || 1;
  const coord = (v: string | undefined, def: number, ref: number) => (user ? (parseLength(v, ref) ?? def * ref) : fraction(v, def));
  const toFrac = (p: Pt): Pt => (user ? { x: (p.x - box.x) / bw, y: (p.y - box.y) / bh } : p);
  if (kind === 'linearGradient') {
    const p1 = { x: coord(attr('x1'), 0, ctx.vb[2]), y: coord(attr('y1'), 0, ctx.vb[3]) };
    const p2 = { x: coord(attr('x2'), 1, ctx.vb[2]), y: coord(attr('y2'), 0, ctx.vb[3]) };
    // exact transform of a linear gradient: start moves with T, direction with T^-T
    const v = { x: p2.x - p1.x, y: p2.y - p1.y };
    const q1 = apply(gt, p1);
    const inv = invert(gt);
    const w = { x: inv[0] * v.x + inv[1] * v.y, y: inv[2] * v.x + inv[3] * v.y };
    const ww = w.x * w.x + w.y * w.y || 1;
    const vv = v.x * v.x + v.y * v.y;
    const q2 = { x: q1.x + (w.x * vv) / ww, y: q1.y + (w.y * vv) / ww };
    const f1 = toFrac(q1);
    const f2 = toFrac(q2);
    return { type: 'linear', stops, x1: f1.x, y1: f1.y, x2: f2.x, y2: f2.y };
  }
  const c = { x: coord(attr('cx'), 0.5, ctx.vb[2]), y: coord(attr('cy'), 0.5, ctx.vb[3]) };
  const r = coord(attr('r'), 0.5, Math.hypot(ctx.vb[2], ctx.vb[3]) / Math.SQRT2);
  const center = toFrac(apply(gt, c));
  const rxAbs = r * Math.hypot(gt[0], gt[1]);
  const ryAbs = r * Math.hypot(gt[2], gt[3]);
  return { type: 'radial', stops, cx: center.x, cy: center.y, rx: user ? rxAbs / bw : rxAbs, ry: user ? ryAbs / bh : ryAbs };
}

/* ----------------------------------- Text ---------------------------------- */

interface Line {
  x: number;
  y: number;
  text: string;
}

function collapse(s: string, preserve: boolean): string {
  return preserve ? s.replace(/[\r\n\t]/g, ' ') : s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
}

function convertText(el: XElement, style: StyleMap, m: Matrix, ctx: Ctx): VObject | null {
  const size = parseLength(style['font-size'], 16) ?? 16;
  const preserve = el.attrs['xml:space'] === 'preserve';
  const anchor = style['text-anchor'];
  const align: TextAlign = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
  const opts = {
    fontFamily: firstFontFamily(style['font-family']),
    fontSize: size,
    fontWeight: parseFontWeight(style['font-weight']),
    italic: style['font-style'] === 'italic' || style['font-style'] === 'oblique',
    letterSpacing: parseLength(style['letter-spacing'] === 'normal' ? '0' : style['letter-spacing'], 0, size) ?? 0,
    align,
  };
  const x0 = parseNumberList(el.attrs.x)[0] ?? 0;
  const y0 = (parseNumberList(el.attrs.y)[0] ?? 0) + (parseNumberList(el.attrs.dy)[0] ?? 0);

  // text on a path
  const tp = el.children.find((c): c is XElement => c.type === 'element' && localName(c.name) === 'textPath');
  if (tp) {
    const ref = ctx.ids.get((hrefOf(tp) ?? '').replace(/^#/, ''));
    if (!ref || localName(ref.name) !== 'path') return null;
    const geom = parsePathData(ref.attrs.d ?? '');
    const text = collapse(textContent(tp), preserve).trim();
    const obj = createText(0, 0, text, { ...opts, align: 'left' });
    obj.m = m;
    obj.onPath = { geom, offset: Math.max(0, Math.min(100, fraction(tp.attrs.startOffset, 0) * (tp.attrs.startOffset?.endsWith('%') ? 100 : 0))) };
    applyTextPaint(obj, style, ctx);
    return obj;
  }

  const lines: Line[] = [];
  let current: Line = { x: x0, y: y0, text: '' };
  lines.push(current);
  const visit = (nodes: XNode[]) => {
    for (const c of nodes) {
      if (c.type === 'text') {
        current.text += collapse(c.text, preserve);
        continue;
      }
      if (localName(c.name) !== 'tspan') continue;
      const xs = parseNumberList(c.attrs.x);
      const ys = parseNumberList(c.attrs.y);
      const dy = parseNumberList(c.attrs.dy)[0] ?? 0;
      if (xs.length || ys.length || dy) {
        current = { x: xs[0] ?? current.x, y: (ys[0] ?? current.y) + dy, text: '' };
        lines.push(current);
      }
      visit(c.children);
    }
  };
  visit(el.children);
  const rows = lines.map((l) => ({ ...l, text: preserve ? l.text : l.text.trim() })).filter((l, i) => l.text || i > 0);
  if (!rows.length || rows.every((r) => !r.text)) return null;
  const sameX = rows.every((r) => Math.abs(r.x - rows[0].x) < 0.5);
  const gaps = rows.slice(1).map((r, i) => r.y - rows[i].y);
  const even = gaps.every((g) => g > 0 && Math.abs(g - gaps[0]) < 0.5);
  if (rows.length === 1 || (sameX && even)) {
    const lh = rows.length > 1 ? gaps[0] / size : 1.2;
    const obj = createText(0, 0, rows.map((r) => r.text).join('\n'), { ...opts, lineHeight: Math.max(0.5, lh) });
    obj.m = multiply(m, translate(rows[0].x, rows[0].y));
    applyTextPaint(obj, style, ctx);
    return obj;
  }
  const parts = rows
    .filter((r) => r.text)
    .map((r) => {
      const t = createText(0, 0, r.text, opts);
      t.m = translate(r.x, r.y);
      applyTextPaint(t, style, ctx);
      return t;
    });
  const g = createGroup(parts, 'Text');
  g.m = m;
  return g;
}

function applyTextPaint(obj: VObject, style: StyleMap, ctx: Ctx): void {
  const box = obj.type === 'text' ? layoutText(obj).bounds : { x: 0, y: 0, width: 1, height: 1 };
  applyPaint(obj, style, box, ctx);
}

/* ------------------------------- Raw fallback ------------------------------ */

const INHERITABLE_INLINE = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'color', 'visibility'];

/** Embeds an element Ultima cannot edit as sanitized raw SVG, keeping its look. */
function rawFallback(el: XElement, parentStyle: StyleMap, toObj: Matrix, abs: Matrix, ctx: Ctx): VObject | null {
  // estimate bounds by converting the element while ignoring the unsupported features
  ctx.measuring = true;
  let measured: VObject | null = null;
  try {
    measured = convertElement(el, parentStyle, IDENTITY, abs, ctx);
  } finally {
    ctx.measuring = false;
  }
  let box: Rect | null = measured ? visualBounds(measured, multiply(abs, measured.m)) : null;
  if (!box || !(box.width > 0) || !(box.height > 0)) box = { x: ctx.vb[0], y: ctx.vb[1], width: ctx.vb[2], height: ctx.vb[3] };
  else {
    const pad = Math.max(box.width, box.height) * 0.1 + 4;
    box = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
  }
  const inherited = INHERITABLE_INLINE.filter((k) => parentStyle[k] !== undefined)
    .map((k) => `${k}:${parentStyle[k].replace(/[;"<>]/g, '')}`)
    .join(';');
  const absAttr = `matrix(${abs.map((v) => +v.toFixed(6)).join(' ')})`;
  const content = `${ctx.sharedDefs}<g transform="${absAttr}"${inherited ? ` style="${inherited}"` : ''}>${serializeXml(el)}</g>`;
  ctx.rawCount++;
  const raw = createRaw(0, 0, box.width, box.height, [box.x, box.y, box.width, box.height], content, nameFor(el, 'SVG content'));
  raw.m = chain(toObj, invert(abs), translate(box.x, box.y));
  return raw;
}
