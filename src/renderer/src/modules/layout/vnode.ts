import { imagePlacement, shapePolygon } from './geometry';
import { gradientCss, resolveColor, resolveTextStyle, substituteTokens } from './styles';
import type { Frame, Gradient, ImageAsset, ImageFrame, LayoutDoc, Page, ShapeFrame, TableFrame, TextFrame, TextStyle } from './types';

/**
 * Pure page renderer. A page is turned into a tree of plain objects (VNode) that is
 * converted to React elements for the editor and serialized to XHTML for PDF/PNG export,
 * so the screen, the PDF and the images always use exactly the same markup.
 * Text is always inserted as text (escaped) — never as markup.
 */

export type Style = Record<string, string>;
export interface VNode {
  tag: string;
  style?: Style;
  attrs?: Record<string, string>;
  children?: Child[];
}
export type Child = VNode | string;

export interface Flow {
  text: string;
  overflow: boolean;
}
export type FlowMap = ReadonlyMap<string, Flow>;

export interface RenderOptions {
  doc: LayoutDoc;
  page: Page;
  /** 0-based index (-1 = master page view). */
  pageIndex: number;
  flows?: FlowMap;
  /** URL used for an image asset (data: URL for export, cached object URL in the editor). */
  assetSrc?: (asset: ImageAsset) => string;
  /** Bleed area rendered around the trim box (px). */
  bleed?: number;
  /** Render master items behind the page items. */
  withMaster?: boolean;
  /** Frames whose content is hidden (e.g. text being edited inline). */
  hideContent?: ReadonlySet<string>;
  /** Editor-only decorations (image placeholders). */
  editor?: boolean;
  /** Unique prefix for SVG ids when several renders share one HTML document. */
  idPrefix?: string;
}

const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;

/** Left pages of facing spreads (0-based: page 2, 4, … → index 1, 3, …). */
export function isLeftPage(doc: LayoutDoc, pageIndex: number): boolean {
  return doc.facing && pageIndex > 0 && pageIndex % 2 === 1;
}

/** Mirrors a master frame for a left page. */
export function mirrorFrame(f: Frame, pageWidth: number): Frame {
  const x = pageWidth - f.x - f.w;
  const rotation = -f.rotation;
  if (f.type === 'text') {
    const align = f.overrides.align;
    const flip = align === 'left' ? 'right' : align === 'right' ? 'left' : align;
    return { ...f, x, rotation, overrides: flip ? { ...f.overrides, align: flip } : f.overrides };
  }
  return { ...f, x, rotation };
}

function textStyleCss(style: TextStyle, swatches: string[]): Style {
  const s: Style = {
    fontFamily: style.fontFamily,
    fontSize: px(style.fontSize),
    fontWeight: String(style.fontWeight),
    fontStyle: style.italic ? 'italic' : 'normal',
    color: resolveColor(style.color, swatches, '#000000'),
    textAlign: style.align,
    lineHeight: String(style.lineHeight),
    letterSpacing: `${style.letterSpacing / 1000}em`,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'normal',
  };
  if (style.underline) s.textDecoration = 'underline';
  if (style.uppercase) s.textTransform = 'uppercase';
  return s;
}

function shadowCss(f: Frame, swatches: string[]): string | null {
  if (!f.shadow) return null;
  const { x, y, blur, color } = f.shadow;
  return `${px(x)} ${px(y)} ${px(blur)} ${resolveColor(color, swatches, 'rgba(0,0,0,0.35)')}`;
}

/** Content box of a text frame (border-box minus padding and border). */
export function textContentSize(f: Pick<TextFrame, 'w' | 'h' | 'padding' | 'strokeWidth' | 'stroke'>): { w: number; h: number } {
  const border = f.stroke ? f.strokeWidth : 0;
  return { w: Math.max(1, f.w - 2 * f.padding - 2 * border), h: Math.max(1, f.h - 2 * f.padding - 2 * border) };
}

/**
 * The text block of a text frame. With `measure`, it gets a fixed size so overflow can be
 * detected with scrollHeight/scrollWidth (see measure.ts).
 */
export function textBlockNode(
  f: Pick<TextFrame, 'w' | 'h' | 'padding' | 'strokeWidth' | 'stroke' | 'columns' | 'columnGap'>,
  style: TextStyle,
  text: string,
  swatches: string[],
  measure = false,
): VNode {
  const content = textContentSize(f);
  const css = textStyleCss(style, swatches);
  css.flex = 'none';
  css.margin = '0';
  if (f.columns > 1) {
    css.columnCount = String(f.columns);
    css.columnGap = px(f.columnGap);
    css.columnFill = 'auto';
    css.height = px(content.h);
  }
  if (measure) {
    css.width = px(content.w);
    css.height = px(content.h);
    css.overflow = 'hidden';
    css.boxSizing = 'content-box';
    css.padding = '0';
    css.border = '0';
  }
  const paragraphs = text.split('\n');
  const children: Child[] = paragraphs.map((p, i) => {
    const pStyle: Style = { margin: '0', padding: '0' };
    if (style.spaceAfter && i < paragraphs.length - 1) pStyle.marginBottom = px(style.spaceAfter);
    return { tag: 'div', style: pStyle, children: [p.length ? p : '​'] };
  });
  return { tag: 'div', style: css, children };
}

function baseFrameStyle(f: Frame, offset: number): Style {
  const s: Style = {
    position: 'absolute',
    left: px(f.x + offset),
    top: px(f.y + offset),
    width: px(f.w),
    height: px(f.h),
    boxSizing: 'border-box',
    margin: '0',
  };
  if (f.rotation) s.transform = `rotate(${Math.round(f.rotation * 100) / 100}deg)`;
  if (f.opacity < 1) s.opacity = String(Math.round(f.opacity * 1000) / 1000);
  return s;
}

function paint(color: string, gradient: Gradient | null, swatches: string[]): Style {
  if (gradient) return { backgroundImage: gradientCss(gradient, swatches) };
  if (color) return { backgroundColor: resolveColor(color, swatches) };
  return {};
}

function textFrameNode(f: TextFrame, o: RenderOptions, offset: number, isMaster: boolean): VNode {
  const { doc } = o;
  const style = resolveTextStyle(f, doc.styles);
  const pageNum = o.pageIndex < 0 ? '#' : String(o.pageIndex + 1);
  const flow = !isMaster ? o.flows?.get(f.id) : undefined;
  const text = flow ? flow.text : substituteTokens(f.text, pageNum, String(doc.pages.length));
  const s = baseFrameStyle(f, offset);
  s.padding = px(f.padding);
  s.display = 'flex';
  s.flexDirection = 'column';
  s.justifyContent = f.columns > 1 ? 'flex-start' : f.vAlign === 'middle' ? 'safe center' : f.vAlign === 'bottom' ? 'safe flex-end' : 'flex-start';
  s.overflow = 'hidden';
  Object.assign(s, paint(f.fill, null, doc.swatches));
  if (f.stroke && f.strokeWidth > 0) s.border = `${px(f.strokeWidth)} solid ${resolveColor(f.stroke, doc.swatches, '#000000')}`;
  if (f.radius) s.borderRadius = px(f.radius);
  const block = textBlockNode(f, style, text, doc.swatches);
  const shadow = shadowCss(f, doc.swatches);
  if (shadow && block.style) block.style.textShadow = shadow;
  if (o.hideContent?.has(f.id) && block.style) block.style.visibility = 'hidden';
  return { tag: 'div', style: s, children: [block] };
}

function imageFrameNode(f: ImageFrame, o: RenderOptions, offset: number): VNode {
  const { doc } = o;
  const s = baseFrameStyle(f, offset);
  s.overflow = 'hidden';
  if (f.radius) s.borderRadius = px(f.radius);
  const shadow = shadowCss(f, doc.swatches);
  if (shadow) s.boxShadow = shadow;
  const children: Child[] = [];
  const asset = f.assetId ? doc.assets[f.assetId] : undefined;
  if (asset && !o.hideContent?.has(f.id)) {
    const r = imagePlacement(f.w, f.h, asset.width, asset.height, f.fit, f.focalX, f.focalY, f.zoom);
    const img: Style = {
      position: 'absolute',
      left: px(r.x),
      top: px(r.y),
      width: px(r.w),
      height: px(r.h),
      maxWidth: 'none',
      maxHeight: 'none',
      margin: '0',
      display: 'block',
    };
    if (f.flipX) img.transform = 'scaleX(-1)';
    if (f.grayscale) img.filter = 'grayscale(1)';
    const src = o.assetSrc ? o.assetSrc(asset) : asset.src;
    children.push({ tag: 'img', attrs: { src, alt: '' }, style: img });
  } else if (!asset) {
    s.backgroundColor = resolveColor(f.placeholder, doc.swatches, '#cccccc');
    if (o.editor) {
      children.push({
        tag: 'div',
        style: {
          position: 'absolute',
          left: '0',
          top: '0',
          right: '0',
          bottom: '0',
          backgroundImage:
            'linear-gradient(to top right, transparent calc(50% - 1px), rgba(0,0,0,0.18) 50%, transparent calc(50% + 1px)), linear-gradient(to bottom right, transparent calc(50% - 1px), rgba(0,0,0,0.18) 50%, transparent calc(50% + 1px))',
        },
      });
    }
  }
  if (f.stroke && f.strokeWidth > 0) {
    children.push({
      tag: 'div',
      style: {
        position: 'absolute',
        left: '0',
        top: '0',
        right: '0',
        bottom: '0',
        border: `${px(f.strokeWidth)} solid ${resolveColor(f.stroke, doc.swatches, '#000000')}`,
        borderRadius: f.radius ? px(f.radius) : '0',
        boxSizing: 'border-box',
      },
    });
  }
  return { tag: 'div', style: s, children };
}

function svgGradient(id: string, g: Gradient, swatches: string[]): VNode {
  const stops: Child[] = [...g.stops]
    .sort((a, b) => a.pos - b.pos)
    .map((st) => ({ tag: 'stop', attrs: { offset: String(st.pos), 'stop-color': resolveColor(st.color, swatches, '#000000') } }));
  if (g.kind === 'radial') return { tag: 'radialGradient', attrs: { id, cx: '0.5', cy: '0.5', r: '0.5' }, children: stops };
  const a = (g.angle * Math.PI) / 180;
  const dx = Math.sin(a) / 2;
  const dy = -Math.cos(a) / 2;
  const f = (n: number) => String(Math.round(n * 10000) / 10000);
  return { tag: 'linearGradient', attrs: { id, x1: f(0.5 - dx), y1: f(0.5 - dy), x2: f(0.5 + dx), y2: f(0.5 + dy) }, children: stops };
}

function shapeFrameNode(f: ShapeFrame, o: RenderOptions, offset: number): VNode {
  const { doc } = o;
  const s = baseFrameStyle(f, offset);
  const shadow = shadowCss(f, doc.swatches);
  const strokeColor = f.stroke ? resolveColor(f.stroke, doc.swatches, '#000000') : '';
  if (f.shape === 'rect' || f.shape === 'ellipse') {
    Object.assign(s, paint(f.fill, f.gradient, doc.swatches));
    if (strokeColor && f.strokeWidth > 0) s.border = `${px(f.strokeWidth)} ${f.dashed ? 'dashed' : 'solid'} ${strokeColor}`;
    if (f.shape === 'ellipse') s.borderRadius = '50%';
    else if (f.radius) s.borderRadius = px(Math.min(f.radius, f.w / 2, f.h / 2));
    if (shadow) s.boxShadow = shadow;
    return { tag: 'div', style: s };
  }
  if (f.shape === 'line') {
    const color = strokeColor || resolveColor(f.fill || '$0', doc.swatches, '#000000');
    const thickness = Math.max(0.25, f.strokeWidth || 2);
    const line: Style = { position: 'absolute', left: '0', right: '0', top: px((f.h - thickness) / 2), height: '0', margin: '0' };
    line.borderTop = `${px(thickness)} ${f.dashed ? 'dashed' : 'solid'} ${color}`;
    if (shadow) line.boxShadow = shadow;
    return { tag: 'div', style: s, children: [{ tag: 'div', style: line }] };
  }
  const sw = strokeColor ? f.strokeWidth : 0;
  const points = shapePolygon(f.shape, f.w, f.h, sw / 2)
    .map((p) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`)
    .join(' ');
  const gid = `${o.idPrefix ?? 'g'}-${f.id}`;
  const fill = f.gradient ? `url(#${gid})` : f.fill ? resolveColor(f.fill, doc.swatches) : 'none';
  const poly: Record<string, string> = { points, fill };
  if (sw > 0) {
    poly.stroke = strokeColor;
    poly['stroke-width'] = String(sw);
    poly['stroke-linejoin'] = 'round';
    if (f.dashed) poly['stroke-dasharray'] = `${sw * 3} ${sw * 2}`;
  }
  const svgChildren: Child[] = [];
  if (f.gradient) svgChildren.push({ tag: 'defs', children: [svgGradient(gid, f.gradient, doc.swatches)] });
  svgChildren.push({ tag: 'polygon', attrs: poly });
  const svgStyle: Style = { position: 'absolute', left: '0', top: '0', overflow: 'visible', display: 'block' };
  if (shadow) svgStyle.filter = `drop-shadow(${shadow})`;
  return {
    tag: 'div',
    style: s,
    children: [
      {
        tag: 'svg',
        attrs: { xmlns: 'http://www.w3.org/2000/svg', width: String(f.w), height: String(f.h), viewBox: `0 0 ${f.w} ${f.h}` },
        style: svgStyle,
        children: svgChildren,
      },
    ],
  };
}

function tableFrameNode(f: TableFrame, o: RenderOptions, offset: number): VNode {
  const { doc } = o;
  const sw = doc.swatches;
  const s = baseFrameStyle(f, offset);
  s.overflow = 'hidden';
  Object.assign(s, paint(f.fill, null, sw));
  const shadow = shadowCss(f, sw);
  if (shadow) s.boxShadow = shadow;
  const border = f.stroke && f.strokeWidth > 0 ? `${px(f.strokeWidth)} solid ${resolveColor(f.stroke, sw, '#000000')}` : 'none';
  const rowH = f.h / Math.max(1, f.rows);
  const rows: Child[] = [];
  for (let r = 0; r < f.rows; r++) {
    const isHeader = f.header && r === 0;
    const cells: Child[] = [];
    for (let c = 0; c < f.cols; c++) {
      const td: Style = {
        border,
        padding: px(f.cellPadding),
        textAlign: f.align,
        verticalAlign: 'middle',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        overflow: 'hidden',
        lineHeight: '1.3',
      };
      if (isHeader) {
        td.fontWeight = '700';
        td.color = resolveColor(f.headerColor, sw, '#000000');
        if (f.headerFill) td.backgroundColor = resolveColor(f.headerFill, sw);
      } else if (f.bandFill && (r - (f.header ? 1 : 0)) % 2 === 1) td.backgroundColor = resolveColor(f.bandFill, sw);
      const text = f.cells[r]?.[c] ?? '';
      cells.push({ tag: 'td', style: td, children: o.hideContent?.has(`${f.id}:${r}:${c}`) ? [] : [text] });
    }
    rows.push({ tag: 'tr', style: { height: px(rowH) }, children: cells });
  }
  const table: VNode = {
    tag: 'table',
    style: {
      width: '100%',
      height: '100%',
      borderCollapse: 'collapse',
      tableLayout: 'fixed',
      fontFamily: f.fontFamily,
      fontSize: px(f.fontSize),
      color: resolveColor(f.color, sw, '#000000'),
      margin: '0',
    },
    children: [{ tag: 'tbody', children: rows }],
  };
  return { tag: 'div', style: s, children: [table] };
}

export function frameNode(f: Frame, o: RenderOptions, offset = 0, isMaster = false): VNode | null {
  if (f.hidden) return null;
  switch (f.type) {
    case 'text':
      return textFrameNode(f, o, offset, isMaster);
    case 'image':
      return imageFrameNode(f, o, offset);
    case 'shape':
      return shapeFrameNode(f, o, offset);
    case 'table':
      return tableFrameNode(f, o, offset);
  }
}

/** Page background style. */
export function pageBackground(page: Page, swatches: string[]): Style {
  if (page.gradient) return { backgroundColor: resolveColor(page.background || '$1', swatches, '#ffffff'), backgroundImage: gradientCss(page.gradient, swatches) };
  return { backgroundColor: page.background ? resolveColor(page.background, swatches, '#ffffff') : 'transparent' };
}

/** The whole page (trim box + bleed) with master items behind page items. */
export function pageNode(o: RenderOptions): VNode {
  const { doc, page } = o;
  const b = o.bleed ?? 0;
  const style: Style = {
    position: 'relative',
    width: px(page.width + 2 * b),
    height: px(page.height + 2 * b),
    overflow: 'hidden',
    margin: '0',
    ...pageBackground(page, doc.swatches),
  };
  const children: Child[] = [];
  if (o.withMaster && page.applyMaster && o.pageIndex >= 0) {
    const mirror = doc.mirrorMaster && isLeftPage(doc, o.pageIndex);
    for (const mf of doc.master.frames) {
      const node = frameNode(mirror ? mirrorFrame(mf, page.width) : mf, o, b, true);
      if (node) children.push(node);
    }
  }
  for (const f of page.frames) {
    const node = frameNode(f, o, b, o.pageIndex < 0);
    if (node) children.push(node);
  }
  return { tag: 'div', style, children };
}

/* ------------------------------ Serialization ------------------------------ */

const VOID = new Set(['img', 'br', 'hr', 'stop', 'polygon', 'input', 'meta']);

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function cssProperty(key: string): string {
  const kebab = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return /^(webkit|moz|ms)-/.test(kebab) ? `-${kebab}` : kebab;
}

export function styleToCss(style: Style): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${cssProperty(k)}:${v.replace(/[<>]/g, '')}`)
    .join(';');
}

/** Serializes a VNode tree as XHTML-compatible markup (valid inside SVG foreignObject). */
export function toHtml(node: Child): string {
  if (typeof node === 'string') return escapeText(node);
  const attrs = Object.entries(node.attrs ?? {})
    .filter(([k]) => /^[a-zA-Z][\w:-]*$/.test(k) && !/^on/i.test(k))
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  const style = node.style && Object.keys(node.style).length ? ` style="${escapeAttr(styleToCss(node.style))}"` : '';
  if (VOID.has(node.tag) && !node.children?.length) return `<${node.tag}${attrs}${style}/>`;
  return `<${node.tag}${attrs}${style}>${(node.children ?? []).map(toHtml).join('')}</${node.tag}>`;
}
