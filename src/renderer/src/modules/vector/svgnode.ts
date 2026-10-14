import { normalizeColor, parseAnyColor } from './colors';
import { localBounds, polygonGeom, rectGeom, starGeom, strokeExtent, visualBounds } from './geometry';
import { fmt, matrixToSvg, type Rect } from './matrix';
import type { GroupObject, Paint, Stroke, TextObject, VObject } from './model';
import { serializePath } from './path';
import { cssFontFamily, layoutText } from './text';
import { toHex } from '../../core/utils/color';

/** Renderer-neutral SVG element description (turned into React elements or markup). */
export interface VNode {
  tag: string;
  attrs: Record<string, string | number | undefined>;
  style?: Record<string, string>;
  children?: VChild[];
}

/** `raw` children are trusted (already sanitized) markup, only used by the exporter. */
export type VChild = VNode | string | { raw: string };

export interface RenderCtx {
  /** Prefix for gradient/filter/clip ids (unique per rendered <svg>). */
  idPrefix: string;
  /** When given, <defs> content is collected here instead of being placed inline. */
  defs?: VNode[];
  /** Objects that should not be drawn (e.g. the text being edited). */
  hidden?: Set<string>;
  /** Exporter mode: raw SVG content is inlined; xlink:href added for old tools. */
  forExport?: boolean;
}

const n = (v: number) => fmt(v, 3);

function addDefs(ctx: RenderCtx, local: VNode[], node: VNode): void {
  if (ctx.defs) ctx.defs.push(node);
  else local.push(node);
}

function colorAttrs(color: string): { color: string; opacity?: string } {
  const c = parseAnyColor(color);
  if (!c) return { color: '#000000' };
  return { color: toHex(c), opacity: c.a < 1 ? n(c.a) : undefined };
}

function gradientNode(paint: Paint, id: string, box: Rect): VNode | null {
  if (paint.type !== 'linear' && paint.type !== 'radial') return null;
  const stops: VNode[] = [...paint.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => {
      const c = colorAttrs(s.color);
      return { tag: 'stop', attrs: { offset: n(Math.max(0, Math.min(1, s.offset))), 'stop-color': c.color, 'stop-opacity': c.opacity } };
    });
  if (paint.type === 'linear') {
    return {
      tag: 'linearGradient',
      attrs: {
        id,
        gradientUnits: 'userSpaceOnUse',
        x1: n(box.x + paint.x1 * box.width),
        y1: n(box.y + paint.y1 * box.height),
        x2: n(box.x + paint.x2 * box.width),
        y2: n(box.y + paint.y2 * box.height),
      },
      children: stops,
    };
  }
  const cx = box.x + paint.cx * box.width;
  const cy = box.y + paint.cy * box.height;
  const rx = Math.max(1e-6, paint.rx * box.width);
  const ry = Math.max(1e-6, paint.ry * box.height);
  return {
    tag: 'radialGradient',
    attrs: {
      id,
      gradientUnits: 'userSpaceOnUse',
      cx: 0,
      cy: 0,
      r: 1,
      gradientTransform: `translate(${n(cx)} ${n(cy)}) scale(${n(rx)} ${n(ry)})`,
    },
    children: stops,
  };
}

/** Paint → attribute value (+ opacity), registering gradients in defs. */
function paintAttr(paint: Paint, id: string, box: Rect, ctx: RenderCtx, local: VNode[]): { value: string; opacity?: string } {
  if (paint.type === 'none') return { value: 'none' };
  if (paint.type === 'solid') {
    const c = colorAttrs(normalizeColor(paint.color) ?? '#000000');
    return { value: c.color, opacity: c.opacity };
  }
  const g = gradientNode(paint, id, box);
  if (!g) return { value: 'none' };
  addDefs(ctx, local, g);
  return { value: `url(#${id})` };
}

function strokeAttrs(stroke: Stroke, id: string, box: Rect, ctx: RenderCtx, local: VNode[], widthFactor = 1): VNode['attrs'] {
  if (stroke.paint.type === 'none' || stroke.width <= 0) return {};
  const p = paintAttr(stroke.paint, id, box, ctx, local);
  return {
    stroke: p.value,
    'stroke-opacity': p.opacity,
    'stroke-width': n(stroke.width * widthFactor),
    'stroke-dasharray': stroke.dash.length ? stroke.dash.map((d) => n(Math.max(0, d))).join(' ') : undefined,
    'stroke-linecap': stroke.cap !== 'butt' ? stroke.cap : undefined,
    'stroke-linejoin': stroke.join !== 'miter' ? stroke.join : undefined,
    'stroke-miterlimit': stroke.join === 'miter' && stroke.miterLimit !== 4 ? n(stroke.miterLimit) : undefined,
  };
}

/** Shape element (without paint) in local coordinates. */
function shapeElement(o: VObject): VNode | null {
  switch (o.type) {
    case 'rect': {
      const r = Math.max(0, Math.min(o.radius, o.width / 2, o.height / 2));
      return { tag: 'rect', attrs: { width: n(o.width), height: n(o.height), rx: r > 0 ? n(r) : undefined } };
    }
    case 'ellipse':
      return { tag: 'ellipse', attrs: { cx: n(o.width / 2), cy: n(o.height / 2), rx: n(o.width / 2), ry: n(o.height / 2) } };
    case 'polygon':
    case 'star': {
      const g = o.type === 'polygon' ? polygonGeom(o.width, o.height, o.sides) : starGeom(o.width, o.height, o.points, o.inner);
      return { tag: 'polygon', attrs: { points: g.subpaths[0].nodes.map((p) => `${n(p.x)},${n(p.y)}`).join(' ') } };
    }
    case 'line':
      return { tag: 'line', attrs: { x1: n(o.x1), y1: n(o.y1), x2: n(o.x2), y2: n(o.y2) } };
    case 'path':
      return {
        tag: 'path',
        attrs: { d: serializePath(o.geom), 'fill-rule': o.geom.fillRule === 'evenodd' ? 'evenodd' : undefined },
      };
    default:
      return null;
  }
}

/** Path data of a shape (for clip paths). */
function shapePathD(o: VObject): string {
  switch (o.type) {
    case 'rect':
      return serializePath(rectGeom(o.width, o.height, o.radius));
    case 'path':
      return serializePath(o.geom);
    default: {
      const el = shapeElement(o);
      if (!el) return '';
      if (el.tag === 'ellipse') {
        const { cx, cy, rx, ry } = el.attrs as Record<string, string>;
        return `M${+cx - +rx} ${cy}A${rx} ${ry} 0 1 0 ${+cx + +rx} ${cy}A${rx} ${ry} 0 1 0 ${+cx - +rx} ${cy}Z`;
      }
      if (el.tag === 'polygon') return `M${String(el.attrs.points).replace(/ /g, 'L')}Z`;
      return '';
    }
  }
}

function textNode(o: TextObject, ctx: RenderCtx, local: VNode[], paint: VNode['attrs']): VNode {
  const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : undefined;
  const attrs: VNode['attrs'] = {
    'font-family': cssFontFamily(o.fontFamily),
    'font-size': n(o.fontSize),
    'font-weight': o.fontWeight !== 400 ? o.fontWeight : undefined,
    'font-style': o.italic ? 'italic' : undefined,
    'letter-spacing': o.letterSpacing ? n(o.letterSpacing) : undefined,
    'text-anchor': o.onPath ? undefined : anchor,
    'xml:space': 'preserve',
    ...paint,
  };
  if (o.onPath) {
    const pid = `${ctx.idPrefix}tp-${o.id}`;
    addDefs(ctx, local, { tag: 'path', attrs: { id: pid, d: serializePath(o.onPath.geom) } });
    const tp: VNode = {
      tag: 'textPath',
      attrs: { href: `#${pid}`, 'xlink:href': ctx.forExport ? `#${pid}` : undefined, startOffset: `${n(o.onPath.offset)}%` },
      children: [o.text.replace(/\n/g, ' ')],
    };
    return { tag: 'text', attrs, children: [tp] };
  }
  const layout = layoutText(o);
  const tspans: VNode[] = layout.lines.map((line) => ({
    tag: 'tspan',
    attrs: { x: 0, y: n(line.baseline) },
    children: line.text ? [line.text] : [],
  }));
  return { tag: 'text', attrs, children: tspans };
}

function filterNode(o: VObject, id: string): VNode | null {
  const blur = o.effects.blur ?? 0;
  const sh = o.effects.shadow;
  if (blur <= 0 && !sh) return null;
  const region = visualBounds(o, o.m);
  if (!region) return null;
  const pad = 4;
  const prims: VNode[] = [];
  if (blur > 0) prims.push({ tag: 'feGaussianBlur', attrs: { in: 'SourceGraphic', stdDeviation: n(blur), result: 'blurred' } });
  if (sh) {
    const c = colorAttrs(sh.color);
    prims.push({
      tag: 'feDropShadow',
      attrs: {
        in: blur > 0 ? 'blurred' : 'SourceGraphic',
        dx: n(sh.x),
        dy: n(sh.y),
        stdDeviation: n(Math.max(0, sh.blur / 2)),
        'flood-color': c.color,
        'flood-opacity': c.opacity ?? 1,
      },
    });
  }
  return {
    tag: 'filter',
    attrs: {
      id,
      filterUnits: 'userSpaceOnUse',
      x: n(region.x - pad),
      y: n(region.y - pad),
      width: n(region.width + pad * 2),
      height: n(region.height + pad * 2),
      'color-interpolation-filters': 'sRGB',
    },
    children: prims,
  };
}

function rawDataUrl(o: Extract<VObject, { type: 'raw' }>): string {
  const [x, y, w, h] = o.viewBox;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${x} ${y} ${w} ${h}" width="${n(o.width)}" height="${n(o.height)}" preserveAspectRatio="none">${o.content}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Builds the SVG description of one object (and its children). */
export function objectToNode(o: VObject, ctx: RenderCtx): VNode | null {
  if (!o.visible || ctx.hidden?.has(o.id)) return null;
  const local: VNode[] = [];
  const transform = matrixToSvg(o.m);
  const base = `${ctx.idPrefix}${o.id}`;
  let inner: VNode | null = null;

  if (o.type === 'group') {
    const children = (o as GroupObject).children.map((c) => objectToNode(c, ctx)).filter((c): c is VNode => Boolean(c));
    inner = { tag: 'g', attrs: { transform }, children };
  } else if (o.type === 'image') {
    inner = {
      tag: 'image',
      attrs: {
        href: o.href,
        'xlink:href': ctx.forExport ? o.href : undefined,
        width: n(o.width),
        height: n(o.height),
        preserveAspectRatio: o.preserve ?? 'none',
        transform,
      },
    };
  } else if (o.type === 'raw') {
    if (ctx.forExport) {
      const [x, y, w, h] = o.viewBox;
      inner = {
        tag: 'g',
        attrs: { transform },
        children: [
          {
            tag: 'svg',
            attrs: { viewBox: `${x} ${y} ${w} ${h}`, width: n(o.width), height: n(o.height), preserveAspectRatio: 'none', overflow: 'visible' },
            children: [{ raw: o.content }],
          },
        ],
      };
    } else {
      inner = { tag: 'image', attrs: { href: rawDataUrl(o), width: n(o.width), height: n(o.height), preserveAspectRatio: 'none', transform } };
    }
  } else {
    const box = localBounds(o);
    const fill = paintAttr(o.type === 'line' ? { type: 'none' } : o.fill, `${base}-f`, box, ctx, local);
    const fillAttrs: VNode['attrs'] = { fill: fill.value, 'fill-opacity': fill.opacity };
    const closed = o.type !== 'line' && !(o.type === 'path' && o.geom.subpaths.every((s) => !s.closed)) && o.type !== 'text';
    const align = closed ? o.stroke.align : 'center';
    if (o.type === 'text') {
      inner = textNode(o, ctx, local, { ...fillAttrs, ...strokeAttrs(o.stroke, `${base}-s`, box, ctx, local) });
      inner.attrs.transform = transform;
    } else if (align === 'center' || o.stroke.paint.type === 'none' || o.stroke.width <= 0) {
      const el = shapeElement(o) as VNode;
      inner = { ...el, attrs: { ...el.attrs, ...fillAttrs, ...strokeAttrs(o.stroke, `${base}-s`, box, ctx, local), transform } };
    } else if (align === 'inside') {
      const clipId = `${base}-clip`;
      addDefs(ctx, local, { tag: 'clipPath', attrs: { id: clipId }, children: [{ tag: 'path', attrs: { d: shapePathD(o) } }] });
      const el = shapeElement(o) as VNode;
      inner = {
        ...el,
        attrs: { ...el.attrs, ...fillAttrs, ...strokeAttrs(o.stroke, `${base}-s`, box, ctx, local, 2), 'clip-path': `url(#${clipId})`, transform },
      };
    } else {
      const maskId = `${base}-mask`;
      const pad = strokeExtent(o) * 2 + o.stroke.width * 2 + 2;
      addDefs(ctx, local, {
        tag: 'mask',
        attrs: { id: maskId, maskUnits: 'userSpaceOnUse', x: n(box.x - pad), y: n(box.y - pad), width: n(box.width + pad * 2), height: n(box.height + pad * 2) },
        children: [
          { tag: 'rect', attrs: { x: n(box.x - pad), y: n(box.y - pad), width: n(box.width + pad * 2), height: n(box.height + pad * 2), fill: '#ffffff' } },
          { tag: 'path', attrs: { d: shapePathD(o), fill: '#000000' } },
        ],
      });
      const el = shapeElement(o) as VNode;
      inner = {
        tag: 'g',
        attrs: { transform },
        children: [
          { ...el, attrs: { ...el.attrs, ...fillAttrs } },
          { ...el, attrs: { ...el.attrs, fill: 'none', ...strokeAttrs(o.stroke, `${base}-s`, box, ctx, local, 2), mask: `url(#${maskId})` } },
        ],
      };
    }
  }
  if (!inner) return null;

  const filter = filterNode(o, `${base}-fx`);
  if (filter) addDefs(ctx, local, filter);
  const opacity = o.opacity < 1 ? n(Math.max(0, o.opacity)) : undefined;
  const style = o.blend !== 'normal' ? { 'mix-blend-mode': o.blend } : undefined;
  let out: VNode;
  if (filter) {
    out = { tag: 'g', attrs: { filter: `url(#${base}-fx)`, opacity }, style, children: [inner] };
  } else {
    out = { ...inner, attrs: { ...inner.attrs, opacity }, style };
  }
  if (local.length) {
    out = { tag: 'g', attrs: {}, children: [{ tag: 'defs', attrs: {}, children: local }, out] };
  }
  return out;
}
