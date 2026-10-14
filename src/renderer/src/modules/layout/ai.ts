import { createImageFrame, createShapeFrame, createTextFrame, num, oneOf, cleanText, bool } from './model';
import {
  addFrames,
  addPage,
  deleteFrames,
  getFrames,
  locateFrame,
  patchFrames,
  reorderFrames,
  setPageSize,
  setStoryText,
  setTextOverrides,
  updatePage,
  updateParagraphStyle,
} from './ops';
import { cleanColor, fontStackFor, resolveTextStyle } from './styles';
import { buildTemplate, findTemplate } from './templates';
import type { Frame, Gradient, LayoutDoc, ParagraphStyle, ShapeKind, TextStyle, Unit } from './types';
import { findPreset, fromUnit, presetSizePx } from './units';

/**
 * AI actions for the Layout module. Everything coming from the model is untrusted:
 * every field is validated and clamped, unknown action types are ignored and all
 * actions of one reply produce ONE new document (one undo step).
 */

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface AIApplyContext {
  /** 0-based index of the page shown in the editor. */
  currentPage: number;
}

export interface AIApplyResult {
  doc: LayoutDoc;
  applied: number;
  skipped: string[];
  /** Ids of frames that were created (to select them). */
  created: string[];
  /** Page to show afterwards (0-based), when an action targeted another page. */
  page?: number;
}

/** Resolves a paragraph style given as id or name ("Heading 1", "h1", "title"…). */
export function findStyleId(styles: ParagraphStyle[], value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const key = value.trim().toLowerCase();
  const compact = key.replace(/[\s_-]+/g, '');
  const found =
    styles.find((s) => s.id.toLowerCase() === key) ??
    styles.find((s) => s.name.toLowerCase() === key) ??
    styles.find((s) => s.name.toLowerCase().replace(/[\s_-]+/g, '') === compact) ??
    styles.find((s) => compact === 'heading1' && s.id === 'h1') ??
    styles.find((s) => compact === 'heading2' && s.id === 'h2') ??
    styles.find((s) => (compact === 'heading' || compact === 'headline') && s.id === 'h1');
  return found?.id ?? null;
}

function aiGradient(v: unknown): Gradient | null {
  if (!isObj(v)) return null;
  const colors = Array.isArray(v.colors) ? v.colors : Array.isArray(v.stops) ? v.stops.map((s) => (isObj(s) ? s.color : s)) : [];
  const clean = colors.slice(0, 6).map((c) => cleanColor(c, '')).filter(Boolean);
  if (clean.length < 2) return null;
  return {
    kind: v.type === 'radial' || v.kind === 'radial' ? 'radial' : 'linear',
    angle: num(v.angle, 180, -360, 360),
    stops: clean.map((color, i) => ({ color, pos: i / (clean.length - 1) })),
  };
}

/** Text style fields the AI may set (fontSize in px). */
function aiTextStyle(v: Raw): Partial<TextStyle> {
  const out: Partial<TextStyle> = {};
  if (v.fontSize !== undefined) out.fontSize = num(v.fontSize, 16, 4, 1000);
  if (typeof v.fontFamily === 'string' && v.fontFamily.trim()) out.fontFamily = fontStackFor(v.fontFamily.slice(0, 80));
  if (v.fontWeight !== undefined) out.fontWeight = Math.round(num(v.fontWeight, 400, 100, 900) / 100) * 100;
  if (v.bold !== undefined) out.fontWeight = bool(v.bold, false) ? 700 : 400;
  if (v.italic !== undefined) out.italic = bool(v.italic, false);
  if (v.underline !== undefined) out.underline = bool(v.underline, false);
  if (v.uppercase !== undefined) out.uppercase = bool(v.uppercase, false);
  if (v.color !== undefined) out.color = cleanColor(v.color, '$0');
  if (v.align !== undefined) out.align = oneOf(v.align, ['left', 'center', 'right', 'justify'] as const, 'left');
  if (v.lineHeight !== undefined) out.lineHeight = num(v.lineHeight, 1.3, 0.6, 4);
  if (v.letterSpacing !== undefined) out.letterSpacing = num(v.letterSpacing, 0, -200, 1500);
  if (v.spaceAfter !== undefined) out.spaceAfter = num(v.spaceAfter, 0, 0, 500);
  return out;
}

interface Box {
  width: number;
  height: number;
}

function aiRect(v: Raw, page: Box, def: { w: number; h: number }) {
  const w = num(v.w ?? v.width, def.w, 1, page.width * 4);
  const h = num(v.h ?? v.height, def.h, 1, page.height * 4);
  return {
    x: num(v.x, (page.width - w) / 2, -page.width, page.width * 2),
    y: num(v.y, (page.height - h) / 2, -page.height, page.height * 2),
    w,
    h,
  };
}

function common(v: Raw) {
  const out: Record<string, unknown> = {};
  if (v.rotation !== undefined) out.rotation = num(v.rotation, 0, -360, 360);
  if (v.opacity !== undefined) out.opacity = num(v.opacity, 1, 0, 1);
  if (typeof v.name === 'string') out.name = cleanText(v.name, 80);
  return out;
}

export function textFrameFromAI(v: Raw, page: Box, styles: ParagraphStyle[]): Frame {
  const styleId = findStyleId(styles, v.style) ?? 'body';
  const known = styles.some((s) => s.id === styleId) ? styleId : (styles[0]?.id ?? null);
  return createTextFrame({
    ...aiRect(v, page, { w: page.width * 0.6, h: page.height * 0.12 }),
    ...common(v),
    text: cleanText(v.text, 20_000),
    styleId: known,
    overrides: aiTextStyle(v),
    vAlign: oneOf(v.vAlign ?? v.verticalAlign, ['top', 'middle', 'bottom'] as const, 'top'),
    padding: num(v.padding, 0, 0, 500),
    fill: cleanColor(v.fill ?? v.background, '', true),
    radius: num(v.radius, 0, 0, 2000),
    columns: Math.round(num(v.columns, 1, 1, 6)),
  });
}

const SHAPES: readonly ShapeKind[] = ['rect', 'ellipse', 'line', 'triangle', 'diamond', 'star'];

export function shapeFrameFromAI(v: Raw, page: Box): Frame {
  let kind = oneOf(v.shape, SHAPES, 'rect');
  if (v.shape === 'circle' || v.shape === 'oval') kind = 'ellipse';
  if (v.shape === 'rectangle' || v.shape === 'square') kind = 'rect';
  const isLine = kind === 'line';
  return createShapeFrame({
    ...aiRect(v, page, isLine ? { w: page.width * 0.5, h: 8 } : { w: page.width * 0.3, h: page.width * 0.3 }),
    ...common(v),
    shape: kind,
    fill: cleanColor(v.fill, isLine ? '' : '$2', true),
    gradient: aiGradient(v.gradient),
    stroke: cleanColor(v.stroke, isLine ? '$0' : '', true),
    strokeWidth: num(v.strokeWidth, isLine ? 3 : v.stroke ? 2 : 0, 0, 200),
    radius: num(v.radius, 0, 0, 2000),
    dashed: bool(v.dashed, false),
  });
}

export function imageFrameFromAI(v: Raw, page: Box): Frame {
  return createImageFrame({
    ...aiRect(v, page, { w: page.width * 0.5, h: page.height * 0.35 }),
    ...common(v),
    placeholder: cleanColor(v.placeholderColor ?? v.placeholder ?? v.fill, '$4'),
    radius: num(v.radius, 0, 0, 5000),
    stroke: cleanColor(v.stroke, '', true),
    strokeWidth: num(v.strokeWidth, 0, 0, 100),
    name: typeof v.name === 'string' ? cleanText(v.name, 80) : 'Image',
  });
}

/** Validated property patch for an existing frame. */
export function framePatchFromAI(frame: Frame, props: Raw, page: Box, styles: ParagraphStyle[]): { patch: Record<string, unknown>; text?: string; style?: Partial<TextStyle>; styleId?: string | null } {
  const patch: Record<string, unknown> = { ...common(props) };
  for (const key of ['x', 'y'] as const) if (props[key] !== undefined) patch[key] = num(props[key], frame[key], -page.width * 2, page.width * 3);
  if (props.w !== undefined || props.width !== undefined) patch.w = num(props.w ?? props.width, frame.w, 1, page.width * 4);
  if (props.h !== undefined || props.height !== undefined) patch.h = num(props.h ?? props.height, frame.h, 1, page.height * 4);
  if (props.locked !== undefined) patch.locked = bool(props.locked, frame.locked);
  if (props.hidden !== undefined) patch.hidden = bool(props.hidden, frame.hidden);
  if (props.radius !== undefined && 'radius' in frame) patch.radius = num(props.radius, 0, 0, 5000);
  if (props.stroke !== undefined && 'stroke' in frame) patch.stroke = cleanColor(props.stroke, '', true);
  if (props.strokeWidth !== undefined && 'strokeWidth' in frame) patch.strokeWidth = num(props.strokeWidth, 0, 0, 200);
  const out: ReturnType<typeof framePatchFromAI> = { patch };
  switch (frame.type) {
    case 'text': {
      if (props.fill !== undefined || props.background !== undefined) patch.fill = cleanColor(props.fill ?? props.background, '', true);
      if (props.padding !== undefined) patch.padding = num(props.padding, 0, 0, 500);
      if (props.vAlign !== undefined) patch.vAlign = oneOf(props.vAlign, ['top', 'middle', 'bottom'] as const, 'top');
      if (props.columns !== undefined) patch.columns = Math.round(num(props.columns, 1, 1, 6));
      if (typeof props.text === 'string') out.text = cleanText(props.text, 20_000);
      if (props.style !== undefined) out.styleId = findStyleId(styles, props.style);
      const style = aiTextStyle(props);
      if (Object.keys(style).length) out.style = style;
      break;
    }
    case 'shape':
      if (props.fill !== undefined) patch.fill = cleanColor(props.fill, '', true);
      if (props.gradient !== undefined) patch.gradient = aiGradient(props.gradient);
      if (props.shape !== undefined) patch.shape = oneOf(props.shape, SHAPES, frame.shape);
      if (props.dashed !== undefined) patch.dashed = bool(props.dashed, false);
      break;
    case 'image':
      if (props.placeholderColor !== undefined || props.fill !== undefined) patch.placeholder = cleanColor(props.placeholderColor ?? props.fill, frame.placeholder);
      if (props.fit !== undefined) patch.fit = oneOf(props.fit, ['fill', 'fit', 'stretch', 'none'] as const, frame.fit);
      if (props.grayscale !== undefined) patch.grayscale = bool(props.grayscale, false);
      break;
    case 'table':
      if (props.fill !== undefined) patch.fill = cleanColor(props.fill, '', true);
      if (props.fontSize !== undefined) patch.fontSize = num(props.fontSize, frame.fontSize, 4, 300);
      if (props.color !== undefined) patch.color = cleanColor(props.color, frame.color);
      if (props.headerFill !== undefined) patch.headerFill = cleanColor(props.headerFill, frame.headerFill, true);
      break;
  }
  return out;
}

/** Page size from {preset} or {width,height,unit}. */
export function pageSizeFromAI(v: Raw, fallback: Box): { width: number; height: number; preset: string } | null {
  const presetName = typeof v.preset === 'string' ? v.preset : typeof v.size === 'string' ? v.size : null;
  let width: number | null = null;
  let height: number | null = null;
  let preset = 'custom';
  if (presetName) {
    const p = findPreset(presetName);
    if (p) {
      ({ width, height } = presetSizePx(p));
      preset = p.id;
    }
  }
  const sizeObj = isObj(v.size) ? v.size : v;
  if (width === null && (sizeObj.width !== undefined || sizeObj.height !== undefined)) {
    const unit = oneOf(sizeObj.unit, ['px', 'mm', 'in', 'pt'] as const, 'px') as Unit;
    width = fromUnit(num(sizeObj.width, fallback.width, 1, 50_000), unit);
    height = fromUnit(num(sizeObj.height, fallback.height, 1, 50_000), unit);
    width = Math.max(10, Math.min(50_000, width));
    height = Math.max(10, Math.min(50_000, height));
  }
  if (width === null || height === null) return null;
  const orientation = v.orientation;
  if ((orientation === 'landscape' && height > width) || (orientation === 'portrait' && width > height)) [width, height] = [height, width];
  return { width, height, preset };
}

function pageIndexFrom(v: unknown, doc: LayoutDoc, current: number): number {
  if (v === undefined || v === null || v === 'current') return current;
  const n = Math.round(num(v, current + 1, 1, doc.pages.length));
  return Math.max(0, Math.min(doc.pages.length - 1, n - 1));
}

export function applyAIActions(input: LayoutDoc, actions: unknown[], ctx: AIApplyContext): AIApplyResult {
  let doc = input;
  let applied = 0;
  let page: number | undefined;
  const skipped: string[] = [];
  const created: string[] = [];
  for (const raw of actions.slice(0, 200)) {
    if (!isObj(raw) || typeof raw.type !== 'string') {
      skipped.push('invalid action');
      continue;
    }
    const a = raw;
    const current = Math.max(0, Math.min(doc.pages.length - 1, page ?? ctx.currentPage));
    try {
      switch (a.type) {
        case 'addText':
        case 'addShape':
        case 'addImageFrame': {
          const pi = pageIndexFrom(a.page, doc, current);
          const p = doc.pages[pi];
          const frame =
            a.type === 'addText' ? textFrameFromAI(a, p, doc.styles) : a.type === 'addShape' ? shapeFrameFromAI(a, p) : imageFrameFromAI(a, p);
          doc = addFrames(doc, p.id, [frame]);
          created.push(frame.id);
          if (pi !== ctx.currentPage) page = pi;
          applied++;
          break;
        }
        case 'update': {
          const id = typeof a.id === 'string' ? a.id : '';
          const loc = locateFrame(doc, id);
          const props = isObj(a.props) ? a.props : {};
          if (!loc) {
            skipped.push(`update: unknown id ${id}`);
            break;
          }
          const pageBox = doc.pages.find((p) => p.id === loc.pageId) ?? doc.pages[0];
          const res = framePatchFromAI(loc.frame, props, pageBox, doc.styles);
          doc = patchFrames(doc, loc.pageId, [id], res.patch);
          if (res.styleId !== undefined && loc.frame.type === 'text') {
            doc = patchFrames(doc, loc.pageId, [id], { styleId: res.styleId, overrides: {} });
          }
          if (res.style) doc = setTextOverrides(doc, loc.pageId, [id], res.style);
          if (res.text !== undefined) doc = setStoryText(doc, id, res.text);
          applied++;
          break;
        }
        case 'rewriteText': {
          const id = typeof a.id === 'string' ? a.id : '';
          const loc = locateFrame(doc, id);
          if (!loc || loc.frame.type !== 'text' || typeof a.text !== 'string') {
            skipped.push(`rewriteText: no text frame ${id}`);
            break;
          }
          doc = setStoryText(doc, id, cleanText(a.text, 20_000));
          applied++;
          break;
        }
        case 'delete': {
          const ids = (Array.isArray(a.ids) ? a.ids : typeof a.id === 'string' ? [a.id] : []).filter((x): x is string => typeof x === 'string');
          let n = 0;
          for (const id of ids) {
            const loc = locateFrame(doc, id);
            if (!loc) continue;
            doc = deleteFrames(doc, loc.pageId, [id]);
            n++;
          }
          if (n) applied++;
          else skipped.push('delete: nothing matched');
          break;
        }
        case 'addPage': {
          const ref = doc.pages[current];
          const size = pageSizeFromAI(a, ref);
          const after = a.after !== undefined ? pageIndexFrom(a.after, doc, current) : doc.pages.length - 1;
          doc = addPage(doc, after + 1);
          const newPage = doc.pages[after + 1];
          if (size) doc = setPageSize(doc, [newPage.id], size.width, size.height, size.preset);
          if (a.background !== undefined) doc = updatePage(doc, newPage.id, (p) => ({ ...p, background: cleanColor(a.background, '$1', true), gradient: null }));
          page = after + 1;
          applied++;
          break;
        }
        case 'setPageSize': {
          const all = a.page === 'all' || a.pages === 'all';
          const pi = pageIndexFrom(a.page, doc, current);
          const size = pageSizeFromAI(a, doc.pages[pi]);
          if (!size) {
            skipped.push('setPageSize: no valid size');
            break;
          }
          doc = setPageSize(doc, all ? 'all' : [doc.pages[pi].id], size.width, size.height, size.preset, bool(a.scaleContent, false));
          applied++;
          break;
        }
        case 'setBackground': {
          const pi = pageIndexFrom(a.page, doc, current);
          const gradient = aiGradient(a.gradient);
          doc = updatePage(doc, doc.pages[pi].id, (p) => ({ ...p, background: cleanColor(a.color, p.background || '$1', true), gradient }));
          applied++;
          break;
        }
        case 'applyTemplate': {
          const def = typeof a.name === 'string' ? findTemplate(a.name) : undefined;
          if (!def) {
            skipped.push(`applyTemplate: unknown template ${String(a.name)}`);
            break;
          }
          const t = buildTemplate(def);
          doc = { ...t, id: doc.id, name: doc.name === 'Untitled' ? t.name : doc.name, assets: { ...doc.assets } };
          page = 0;
          applied++;
          break;
        }
        case 'setTheme': {
          const colors = Array.isArray(a.colors) ? a.colors.slice(0, 10) : [];
          const next = [...doc.swatches];
          colors.forEach((c, i) => {
            const v = cleanColor(c, '');
            if (v && !v.startsWith('$')) next[i] = v;
          });
          doc = { ...doc, swatches: next };
          applied++;
          break;
        }
        case 'reorder': {
          const id = typeof a.id === 'string' ? a.id : '';
          const loc = locateFrame(doc, id);
          if (!loc) break;
          const op = oneOf(a.to, ['front', 'forward', 'backward', 'back'] as const, 'front');
          doc = reorderFrames(doc, loc.pageId, [id], op);
          applied++;
          break;
        }
        case 'updateStyle': {
          const sid = findStyleId(doc.styles, a.style ?? a.name);
          if (!sid) {
            skipped.push('updateStyle: unknown style');
            break;
          }
          doc = updateParagraphStyle(doc, sid, aiTextStyle(isObj(a.props) ? a.props : a));
          applied++;
          break;
        }
        default:
          skipped.push(`unknown action ${String(a.type).slice(0, 40)}`);
      }
    } catch (error) {
      skipped.push(`${String(a.type)}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  return { doc, applied, skipped, created, page };
}

/* ---------------------------- Design from a brief ---------------------------- */

export interface PageSpec {
  width: number;
  height: number;
  preset: string;
  background: string;
  gradient: Gradient | null;
  swatches: string[] | null;
  frames: Frame[];
  warnings: string[];
}

/**
 * Validates a full page design returned by the AI:
 * { size, theme?, background?, backgroundGradient?, frames: [{type:'text'|'shape'|'image', ...}] }
 */
export function validatePageSpec(raw: unknown, fallback: Box & { preset: string }, styles: ParagraphStyle[]): PageSpec {
  const v = isObj(raw) ? raw : {};
  const warnings: string[] = [];
  const size = pageSizeFromAI(v, fallback) ?? { width: fallback.width, height: fallback.height, preset: fallback.preset };
  const box = { width: size.width, height: size.height };
  let swatches: string[] | null = null;
  if (Array.isArray(v.theme) && v.theme.length >= 2) {
    const clean = v.theme.slice(0, 8).map((c) => cleanColor(c, '')).filter((c) => c && !c.startsWith('$'));
    if (clean.length >= 2) swatches = clean;
    else warnings.push('theme ignored');
  }
  const framesRaw = Array.isArray(v.frames) ? v.frames : Array.isArray(v.elements) ? v.elements : [];
  const frames: Frame[] = [];
  for (const f of framesRaw.slice(0, 80)) {
    if (!isObj(f)) continue;
    const type = typeof f.type === 'string' ? f.type.toLowerCase() : '';
    if (type === 'text') {
      if (typeof f.text !== 'string' || !f.text.trim()) {
        warnings.push('empty text skipped');
        continue;
      }
      frames.push(textFrameFromAI(f, box, styles));
    } else if (type === 'shape' || type === 'rect' || type === 'ellipse' || type === 'circle' || type === 'line') {
      frames.push(shapeFrameFromAI(type === 'shape' ? f : { ...f, shape: f.shape ?? type }, box));
    } else if (type === 'image') frames.push(imageFrameFromAI(f, box));
    else warnings.push(`unknown element type ${type || '?'}`);
  }
  if (!frames.length) warnings.push('no elements');
  return {
    ...size,
    background: cleanColor(v.background, '$1', true),
    gradient: aiGradient(v.backgroundGradient ?? v.gradient),
    swatches,
    frames,
    warnings,
  };
}

/** Effective text style for describing frames to the AI. */
export function describeStyle(doc: LayoutDoc, frameId: string): TextStyle | null {
  const loc = locateFrame(doc, frameId);
  if (!loc || loc.frame.type !== 'text') return null;
  return resolveTextStyle(loc.frame, doc.styles);
}

/** Frames of a page (helper for callers that only know the index). */
export function framesOfPage(doc: LayoutDoc, index: number): Frame[] {
  const p = doc.pages[index];
  return p ? getFrames(doc, p.id) : [];
}

/* ------------------------------ Spec post-processing ------------------------------ */

/** Replaces "$n" references with literal colors from `swatches` (keeps a design's look in another theme). */
export function resolveThemeRefs(frames: Frame[], swatches: string[]): Frame[] {
  const r = (c: string) => (/^\$\d$/.test(c) ? (swatches[Number(c.slice(1))] ?? c) : c);
  return frames.map((f) => {
    const shadow = f.shadow ? { ...f.shadow, color: r(f.shadow.color) } : null;
    switch (f.type) {
      case 'text':
        return { ...f, shadow, fill: r(f.fill), stroke: r(f.stroke), overrides: f.overrides.color ? { ...f.overrides, color: r(f.overrides.color) } : f.overrides };
      case 'shape':
        return {
          ...f,
          shadow,
          fill: r(f.fill),
          stroke: r(f.stroke),
          gradient: f.gradient ? { ...f.gradient, stops: f.gradient.stops.map((s) => ({ ...s, color: r(s.color) })) } : null,
        };
      case 'image':
        return { ...f, shadow, placeholder: r(f.placeholder), stroke: r(f.stroke) };
      case 'table':
        return { ...f, shadow, fill: r(f.fill), stroke: r(f.stroke), color: r(f.color), headerFill: r(f.headerFill), headerColor: r(f.headerColor), bandFill: r(f.bandFill) };
    }
  });
}

/** Text frames for generated copy, stacked inside the page margins. */
export function copyToFrames(
  copy: { headline: string; subheadline: string; body: string; cta: string },
  page: { width: number; height: number; margins: { top: number; left: number; right: number; bottom: number } },
  styles: ParagraphStyle[],
): Frame[] {
  const x = page.margins.left;
  const w = Math.max(40, page.width - page.margins.left - page.margins.right);
  let y = page.margins.top + (page.height - page.margins.top - page.margins.bottom) * 0.08;
  const out: Frame[] = [];
  const add = (text: string, styleId: string) => {
    if (!text.trim()) return;
    const st = resolveTextStyle({ styleId: styles.some((s) => s.id === styleId) ? styleId : null, overrides: {} }, styles);
    const charsPerLine = Math.max(8, w / (st.fontSize * 0.55));
    const lines = text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / charsPerLine)), 0);
    const h = lines * st.fontSize * st.lineHeight + (text.split('\n').length - 1) * st.spaceAfter + st.fontSize * 0.4;
    out.push(textFrameFromAI({ x, y, w, h, text, style: styleId }, page, styles));
    y += h + st.fontSize * 0.8;
  };
  add(copy.headline, 'title');
  add(copy.subheadline, 'subtitle');
  add(copy.body, 'body');
  add(copy.cta, 'label');
  return out;
}
