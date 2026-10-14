import { normalizeColor } from './colors';
import { selectionBounds, visualBounds } from './geometry';
import { expandRect, fmt, rectsIntersect, unionRects, type Rect } from './matrix';
import type { Artboard, VDoc, VObject } from './model';
import { objectToNode, type VChild, type VNode } from './svgnode';
import { escapeAttr, escapeText } from './xml';

/** Serializes a VNode tree to markup. */
export function serializeNode(node: VChild, depth = 0, pretty = true): string {
  if (typeof node === 'string') return escapeText(node);
  if ('raw' in node) return node.raw;
  const pad = pretty ? '  '.repeat(depth) : '';
  const attrs = Object.entries(node.attrs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('');
  const style = node.style
    ? Object.entries(node.style)
        .map(([k, v]) => `${k}:${v}`)
        .join(';')
    : '';
  const styleAttr = style ? ` style="${escapeAttr(style)}"` : '';
  const children = node.children ?? [];
  if (!children.length) return `${pad}<${node.tag}${attrs}${styleAttr}/>`;
  const textOnly = children.every((c) => typeof c === 'string') || node.tag === 'text' || node.tag === 'tspan' || node.tag === 'textPath';
  if (textOnly || !pretty) {
    return `${pad}<${node.tag}${attrs}${styleAttr}>${children.map((c) => serializeNode(c, 0, false)).join('')}</${node.tag}>`;
  }
  const inner = children.map((c) => serializeNode(c, depth + 1, pretty)).join('\n');
  return `${pad}<${node.tag}${attrs}${styleAttr}>\n${inner}\n${pad}</${node.tag}>`;
}

/** Renames the long internal ids to short ones (g1, f1, ...) in the final markup. */
function shortenIds(markup: string, ids: string[]): string {
  let out = markup;
  ids.forEach((id, i) => {
    const kind = /-fx$/.test(id) ? 'fx' : /-clip$/.test(id) ? 'clip' : /-mask$/.test(id) ? 'mask' : /tp-/.test(id) ? 'tp' : 'g';
    out = out.split(`"${id}"`).join(`"${kind}${i + 1}"`);
    out = out.split(`#${id})`).join(`#${kind}${i + 1})`);
    out = out.split(`"#${id}"`).join(`"#${kind}${i + 1}"`);
  });
  return out;
}

function collectIds(nodes: VNode[]): string[] {
  const ids: string[] = [];
  const walk = (n: VChild) => {
    if (typeof n === 'string' || 'raw' in n) return;
    if (typeof n.attrs.id === 'string') ids.push(n.attrs.id);
    n.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return ids;
}

export interface SvgExportOptions {
  /** Include the artboard background color (default true). */
  background?: boolean;
  pretty?: boolean;
  /** Only these object ids (top level). */
  onlyIds?: Set<string>;
}

function svgDocument(viewBox: Rect, width: number, height: number, body: VNode[], defs: VNode[], pretty: boolean): string {
  const parts = [...(defs.length ? [{ tag: 'defs', attrs: {}, children: defs } as VNode] : []), ...body];
  let inner = parts.map((p) => serializeNode(p, 1, pretty)).join(pretty ? '\n' : '');
  inner = shortenIds(inner, collectIds(defs));
  const xlink = inner.includes('xlink:href') ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '';
  const head = `<svg xmlns="http://www.w3.org/2000/svg"${xlink} width="${fmt(width)}" height="${fmt(height)}" viewBox="${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}">`;
  return `${head}${pretty ? '\n' : ''}${inner}${pretty ? '\n' : ''}</svg>${pretty ? '\n' : ''}`;
}

/** Clean standalone SVG of one artboard (objects outside it are left out). */
export function exportArtboardSvg(doc: VDoc, artboard: Artboard, options: SvgExportOptions = {}): string {
  const pretty = options.pretty ?? true;
  const area: Rect = { x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height };
  const defs: VNode[] = [];
  const body: VNode[] = [];
  const bg = options.background !== false ? normalizeColor(artboard.background) : null;
  if (bg) {
    body.push({ tag: 'rect', attrs: { x: fmt(area.x), y: fmt(area.y), width: fmt(area.width), height: fmt(area.height), fill: bg } });
  }
  for (const o of doc.objects) {
    if (options.onlyIds && !options.onlyIds.has(o.id)) continue;
    const vb = visualBounds(o, o.m);
    if (!vb || !rectsIntersect(vb, area)) continue;
    const node = objectToNode(o, { idPrefix: 'e', defs, forExport: true });
    if (node) body.push(node);
  }
  return svgDocument(area, artboard.width, artboard.height, body, defs, pretty);
}

/** SVG of arbitrary objects (clipboard / selection export), cropped to their bounds. */
export function exportObjectsSvg(objects: VObject[], pretty = false): string {
  const bounds = unionRects(objects.map((o) => visualBounds(o, o.m))) ?? selectionBounds(objects, objects.map((o) => o.id));
  const area = bounds ? expandRect(bounds, 0) : { x: 0, y: 0, width: 1, height: 1 };
  const defs: VNode[] = [];
  const body = objects.map((o) => objectToNode(o, { idPrefix: 'e', defs, forExport: true })).filter((n): n is VNode => Boolean(n));
  return svgDocument(area, Math.max(1, area.width), Math.max(1, area.height), body, defs, pretty);
}

/** Standalone HTML page that prints an SVG at its exact size (desktop PDF export). */
export function printableHtml(svg: string, widthPx: number, heightPx: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${fmt(widthPx)}px ${fmt(heightPx)}px;margin:0}html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${fmt(widthPx)}px;height:${fmt(heightPx)}px}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`;
}
