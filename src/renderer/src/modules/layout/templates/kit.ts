import { createDoc, createImageFrame, createPage, createShapeFrame, createTableFrame, createTextFrame } from '../model';
import { FONT_STACKS, cleanColor, defaultParagraphStyles, resolveTextStyle } from '../styles';
import type { Frame, Gradient, LayoutDoc, Margins, ParagraphStyle, Shadow, ShapeFrame, TableFrame, TextAlign, TextFrame, TextStyle, VAlign } from '../types';
import { getPreset, presetSizePx } from '../units';

/** Tiny DSL to build good-looking templates in code. Coordinates are page px. */

export const F = FONT_STACKS;

export interface TextOpts {
  style?: string;
  size?: number;
  weight?: number;
  family?: string;
  color?: string;
  align?: TextAlign;
  lh?: number;
  ls?: number;
  italic?: boolean;
  upper?: boolean;
  underline?: boolean;
  valign?: VAlign;
  padding?: number;
  fill?: string;
  radius?: number;
  columns?: number;
  gap?: number;
  after?: number;
  name?: string;
  rotation?: number;
  opacity?: number;
  shadow?: Shadow | null;
  stroke?: string;
  strokeWidth?: number;
  id?: string;
}

export function text(x: number, y: number, w: number, h: number, content: string, o: TextOpts = {}): TextFrame {
  const overrides: Partial<TextStyle> = {};
  if (o.size !== undefined) overrides.fontSize = o.size;
  if (o.weight !== undefined) overrides.fontWeight = o.weight;
  if (o.family !== undefined) overrides.fontFamily = o.family;
  if (o.color !== undefined) overrides.color = o.color;
  if (o.align !== undefined) overrides.align = o.align;
  if (o.lh !== undefined) overrides.lineHeight = o.lh;
  if (o.ls !== undefined) overrides.letterSpacing = o.ls;
  if (o.italic !== undefined) overrides.italic = o.italic;
  if (o.upper !== undefined) overrides.uppercase = o.upper;
  if (o.underline !== undefined) overrides.underline = o.underline;
  if (o.after !== undefined) overrides.spaceAfter = o.after;
  const frame = createTextFrame({
    x,
    y,
    w,
    h,
    name: o.name ?? '',
    text: content,
    styleId: o.style ?? 'body',
    overrides,
    vAlign: o.valign ?? 'top',
    padding: o.padding ?? 0,
    fill: o.fill ?? '',
    radius: o.radius ?? 0,
    columns: o.columns ?? 1,
    columnGap: o.gap ?? 16,
    rotation: o.rotation ?? 0,
    opacity: o.opacity ?? 1,
    shadow: o.shadow ?? null,
    stroke: o.stroke ?? '',
    strokeWidth: o.strokeWidth ?? 0,
  });
  return o.id ? { ...frame, id: o.id } : frame;
}

export interface ShapeOpts {
  radius?: number;
  stroke?: string;
  sw?: number;
  gradient?: Gradient | null;
  rotation?: number;
  opacity?: number;
  dashed?: boolean;
  name?: string;
  shadow?: Shadow | null;
  locked?: boolean;
}

function shape(kind: ShapeFrame['shape'], x: number, y: number, w: number, h: number, fill: string, o: ShapeOpts = {}): ShapeFrame {
  return createShapeFrame({
    x,
    y,
    w,
    h,
    shape: kind,
    fill,
    name: o.name ?? '',
    radius: o.radius ?? 0,
    stroke: o.stroke ?? '',
    strokeWidth: o.sw ?? (o.stroke ? 2 : 0),
    gradient: o.gradient ?? null,
    rotation: o.rotation ?? 0,
    opacity: o.opacity ?? 1,
    dashed: o.dashed ?? false,
    shadow: o.shadow ?? null,
    locked: o.locked ?? false,
  });
}

export const rect = (x: number, y: number, w: number, h: number, fill: string, o?: ShapeOpts) => shape('rect', x, y, w, h, fill, o);
export const ellipse = (x: number, y: number, w: number, h: number, fill: string, o?: ShapeOpts) => shape('ellipse', x, y, w, h, fill, o);
export const triangle = (x: number, y: number, w: number, h: number, fill: string, o?: ShapeOpts) => shape('triangle', x, y, w, h, fill, o);
export const diamond = (x: number, y: number, w: number, h: number, fill: string, o?: ShapeOpts) => shape('diamond', x, y, w, h, fill, o);
export const star = (x: number, y: number, w: number, h: number, fill: string, o?: ShapeOpts) => shape('star', x, y, w, h, fill, o);

/** Horizontal line of width `w` centered on y. */
export function line(x: number, y: number, w: number, color: string, thickness = 2, o: ShapeOpts = {}): ShapeFrame {
  const h = Math.max(thickness, 4);
  return shape('line', x, y - h / 2, w, h, '', { ...o, stroke: color, sw: thickness });
}

export function image(x: number, y: number, w: number, h: number, placeholder = '$4', o: { radius?: number; name?: string; stroke?: string; sw?: number } = {}) {
  return createImageFrame({
    x,
    y,
    w,
    h,
    placeholder,
    radius: o.radius ?? 0,
    name: o.name ?? 'Image',
    stroke: o.stroke ?? '',
    strokeWidth: o.sw ?? 0,
  });
}

export function table(x: number, y: number, w: number, h: number, cells: string[][], o: Partial<Omit<TableFrame, 'type' | 'id' | 'cells'>> = {}): TableFrame {
  return createTableFrame({ x, y, w, h, cells, rows: cells.length, cols: cells[0]?.length ?? 1, ...o });
}

export const linear = (angle: number, ...colors: string[]): Gradient => ({
  kind: 'linear',
  angle,
  stops: colors.map((color, i) => ({ color, pos: colors.length > 1 ? i / (colors.length - 1) : 0 })),
});

export const radial = (...colors: string[]): Gradient => ({
  kind: 'radial',
  angle: 0,
  stops: colors.map((color, i) => ({ color, pos: colors.length > 1 ? i / (colors.length - 1) : 0 })),
});

export const shadow = (x: number, y: number, blur: number, color = 'rgba(0, 0, 0, 0.3)'): Shadow => ({ x, y, blur, color: cleanColor(color, 'rgba(0, 0, 0, 0.3)') });

export interface PageSpec {
  background?: string;
  gradient?: Gradient | null;
  frames: Frame[];
  margins?: Partial<Margins>;
  columns?: number;
  gutter?: number;
  applyMaster?: boolean;
}

export interface DocSpec {
  name: string;
  preset: string;
  landscape?: boolean;
  swatches: string[];
  pages: PageSpec[];
  master?: Frame[];
  facing?: boolean;
  /** Paragraph style overrides by id (merged into the defaults). */
  styles?: Record<string, Partial<TextStyle>>;
  styleScale?: number;
  bleed?: number;
}

/**
 * Grows text frames so every explicit line fits (fonts render slightly differently per
 * platform, so a little slack is added). Middle/bottom aligned frames keep their anchor.
 */
export function fitTextFrames(frames: Frame[], styles: ParagraphStyle[]): Frame[] {
  return frames.map((f) => {
    if (f.type !== 'text' || !f.text || f.nextId || f.columns > 1) return f;
    const st = resolveTextStyle(f, styles);
    const lines = f.text.split('\n').length;
    const need = lines * st.fontSize * st.lineHeight + (lines - 1) * st.spaceAfter + 2 * f.padding + (f.stroke ? 2 * f.strokeWidth : 0);
    const want = need * 1.04;
    if (f.h >= want) return f;
    const grow = want - f.h;
    const y = f.vAlign === 'middle' ? f.y - grow / 2 : f.vAlign === 'bottom' ? f.y - grow : f.y;
    return { ...f, y, h: want };
  });
}

/** Builds a complete document. Paragraph styles follow the template's fonts and scale. */
export function makeDoc(spec: DocSpec): LayoutDoc {
  const preset = getPreset(spec.preset);
  const size = preset ? presetSizePx(preset) : { width: 793.7, height: 1122.5 };
  let { width, height } = size;
  if (spec.landscape) [width, height] = [Math.max(width, height), Math.min(width, height)];
  const doc = createDoc({ name: spec.name, presetId: spec.preset, landscape: spec.landscape, facing: spec.facing });
  const styles: ParagraphStyle[] = defaultParagraphStyles(spec.styleScale ?? 1).map((s) =>
    spec.styles?.[s.id] ? { ...s, style: { ...s.style, ...spec.styles[s.id] } } : s,
  );
  const pages = spec.pages.map((p) => {
    const base = createPage(width, height, preset?.id ?? 'custom', {
      background: p.background ?? '$1',
      gradient: p.gradient ?? null,
      frames: fitTextFrames(p.frames, styles),
      columns: p.columns ?? 1,
      applyMaster: p.applyMaster ?? true,
    });
    if (p.gutter !== undefined) base.gutter = p.gutter;
    if (p.margins) base.margins = { ...base.margins, ...p.margins };
    return base;
  });
  return {
    ...doc,
    swatches: [...spec.swatches],
    styles,
    pages,
    master: { frames: fitTextFrames(spec.master ?? [], styles) },
    bleed: spec.bleed ?? doc.bleed,
  };
}

export interface TemplateDef {
  id: string;
  name: string;
  category: 'print' | 'social' | 'presentation';
  description: string;
  build: () => LayoutDoc;
}
