import { uid } from '../../core/utils/id';
import type {
  Frame,
  FrameType,
  Gradient,
  ImageAsset,
  ImageFrame,
  LayoutDoc,
  Margins,
  Page,
  ParagraphStyle,
  ShapeFrame,
  Shadow,
  TableFrame,
  TextFrame,
  TextStyle,
  Unit,
} from './types';
import { defaultBleed, defaultMargin, getPreset, matchPreset, presetSizePx, type PagePreset } from './units';
import {
  DEFAULT_SWATCHES,
  DEFAULT_TEXT_STYLE,
  FONT_STACKS,
  TEXT_STYLE_KEYS,
  cleanColor,
  defaultParagraphStyles,
  sanitizeFontStack,
} from './styles';

/* ------------------------------ Value helpers ------------------------------ */

export function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Strips control characters that break XML/HTML export (keeps \n and \t). */
export function cleanText(value: unknown, maxLength = 100_000): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/g, '').slice(0, maxLength);
}

export function str(value: unknown, fallback: string, maxLength = 200): string {
  return typeof value === 'string' ? cleanText(value, maxLength) : fallback;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const MAX_COORD = 100_000;
const MAX_SIZE = 50_000;

/* -------------------------------- Factories -------------------------------- */

export interface FrameInit {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  name?: string;
}

function base(type: FrameType, init: FrameInit, defaults: { w: number; h: number }) {
  return {
    id: uid('f'),
    name: init.name ?? '',
    x: init.x ?? 0,
    y: init.y ?? 0,
    w: init.w ?? defaults.w,
    h: init.h ?? defaults.h,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: null,
    shadow: null,
    type,
  };
}

export function createTextFrame(init: FrameInit & Partial<Omit<TextFrame, 'type' | 'id'>> = {}): TextFrame {
  return {
    ...base('text', init, { w: 320, h: 80 }),
    text: '',
    styleId: 'body',
    overrides: {},
    padding: 0,
    vAlign: 'top',
    columns: 1,
    columnGap: 16,
    fill: '',
    stroke: '',
    strokeWidth: 0,
    radius: 0,
    nextId: null,
    ...stripBase(init),
    type: 'text',
  };
}

export function createImageFrame(init: FrameInit & Partial<Omit<ImageFrame, 'type' | 'id'>> = {}): ImageFrame {
  return {
    ...base('image', init, { w: 320, h: 240 }),
    assetId: null,
    fit: 'fill',
    focalX: 0.5,
    focalY: 0.5,
    zoom: 1,
    radius: 0,
    stroke: '',
    strokeWidth: 0,
    placeholder: '$4',
    flipX: false,
    grayscale: false,
    ...stripBase(init),
    type: 'image',
  };
}

export function createShapeFrame(init: FrameInit & Partial<Omit<ShapeFrame, 'type' | 'id'>> = {}): ShapeFrame {
  return {
    ...base('shape', init, { w: 200, h: 200 }),
    shape: 'rect',
    fill: '$2',
    gradient: null,
    stroke: '',
    strokeWidth: 0,
    radius: 0,
    dashed: false,
    ...stripBase(init),
    type: 'shape',
  };
}

export function createTableFrame(init: FrameInit & Partial<Omit<TableFrame, 'type' | 'id'>> = {}): TableFrame {
  const rows = init.rows ?? init.cells?.length ?? 4;
  const cols = init.cols ?? init.cells?.[0]?.length ?? 3;
  const cells =
    init.cells ??
    Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `Header ${c + 1}` : '')));
  return {
    ...base('table', init, { w: 420, h: 160 }),
    header: true,
    fontFamily: FONT_STACKS.sans,
    fontSize: 14,
    color: '$0',
    align: 'left',
    fill: '',
    headerFill: '$2',
    headerColor: '$1',
    bandFill: '',
    stroke: '$4',
    strokeWidth: 1,
    cellPadding: 6,
    ...stripBase(init),
    rows,
    cols,
    cells,
    type: 'table',
  };
}

function stripBase<T extends FrameInit>(init: T): Omit<T, 'type' | 'id'> {
  const copy = { ...init } as Record<string, unknown>;
  delete copy.type;
  delete copy.id;
  return copy as Omit<T, 'type' | 'id'>;
}

export function createPage(width: number, height: number, preset = 'custom', patch: Partial<Page> = {}): Page {
  const m = defaultMargin(width, height);
  return {
    id: uid('p'),
    width,
    height,
    preset,
    margins: { top: m, right: m, bottom: m, left: m },
    columns: 1,
    gutter: Math.round(Math.min(width, height) * 0.02 * 10) / 10 || 12,
    background: '$1',
    gradient: null,
    applyMaster: true,
    frames: [],
    guides: { x: [], y: [] },
    ...patch,
  };
}

/** Style scale for a page size: social/screen graphics need bigger type. */
export function styleScaleFor(preset: PagePreset | undefined, width: number, height: number): number {
  if (preset?.group === 'social' || preset?.group === 'screen') return 2;
  const short = Math.min(width, height);
  if (short < 300) return 0.6;
  if (short > 1400) return 1.8;
  return 1;
}

export interface NewDocOptions {
  name?: string;
  presetId?: string;
  width?: number;
  height?: number;
  landscape?: boolean;
  pages?: number;
  unit?: Unit;
  facing?: boolean;
  margins?: Partial<Margins>;
  columns?: number;
  gutter?: number;
  bleed?: number;
}

export function createDoc(options: NewDocOptions = {}): LayoutDoc {
  const preset = options.presetId ? getPreset(options.presetId) : getPreset('a4');
  let width = options.width ?? (preset ? presetSizePx(preset).width : 793.7);
  let height = options.height ?? (preset ? presetSizePx(preset).height : 1122.5);
  if (options.landscape !== undefined && options.landscape !== width > height) [width, height] = [height, width];
  const presetId = options.width || options.height ? (matchPreset(width, height)?.id ?? 'custom') : (preset?.id ?? 'custom');
  const usedPreset = getPreset(presetId);
  const count = Math.max(1, Math.min(500, Math.round(options.pages ?? 1)));
  const m = defaultMargin(width, height);
  const margins: Margins = { top: m, right: m, bottom: m, left: m, ...options.margins };
  const pages: Page[] = [];
  for (let i = 0; i < count; i++) {
    pages.push(
      createPage(width, height, presetId, {
        margins: { ...margins },
        columns: options.columns ?? 1,
        ...(options.gutter !== undefined ? { gutter: options.gutter } : {}),
      }),
    );
  }
  return {
    id: uid('d'),
    name: options.name ?? 'Untitled',
    unit: options.unit ?? usedPreset?.unit ?? 'mm',
    facing: options.facing ?? false,
    mirrorMaster: true,
    bleed: options.bleed ?? defaultBleed(usedPreset),
    pages,
    master: { frames: [] },
    styles: defaultParagraphStyles(styleScaleFor(usedPreset, width, height)),
    swatches: [...DEFAULT_SWATCHES],
    assets: {},
  };
}

/* ------------------------------- Normalization ------------------------------ */

function normGradient(v: unknown): Gradient | null {
  if (!isObj(v) || !Array.isArray(v.stops)) return null;
  const stops = v.stops
    .filter(isObj)
    .slice(0, 8)
    .map((s) => ({ color: cleanColor(s.color, '#000000'), pos: num(s.pos, 0, 0, 1) }));
  if (stops.length < 2) return null;
  return { kind: oneOf(v.kind, ['linear', 'radial'] as const, 'linear'), angle: num(v.angle, 180, -360, 360), stops };
}

function normShadow(v: unknown): Shadow | null {
  if (!isObj(v)) return null;
  return {
    x: num(v.x, 0, -500, 500),
    y: num(v.y, 4, -500, 500),
    blur: num(v.blur, 12, 0, 500),
    color: cleanColor(v.color, 'rgba(0, 0, 0, 0.35)'),
  };
}

export function normTextStyle(v: unknown, partial: true): Partial<TextStyle>;
export function normTextStyle(v: unknown, partial: false): TextStyle;
export function normTextStyle(v: unknown, partial: boolean): Partial<TextStyle> | TextStyle {
  const src = isObj(v) ? v : {};
  const d = DEFAULT_TEXT_STYLE;
  const out: Partial<TextStyle> = {};
  const has = (k: keyof TextStyle) => !partial || src[k] !== undefined;
  if (has('fontFamily')) out.fontFamily = typeof src.fontFamily === 'string' ? sanitizeFontStack(src.fontFamily) : d.fontFamily;
  if (has('fontSize')) out.fontSize = num(src.fontSize, d.fontSize, 1, 2000);
  if (has('fontWeight')) out.fontWeight = Math.round(num(src.fontWeight, d.fontWeight, 100, 900) / 100) * 100;
  if (has('italic')) out.italic = bool(src.italic, d.italic);
  if (has('underline')) out.underline = bool(src.underline, d.underline);
  if (has('uppercase')) out.uppercase = bool(src.uppercase, d.uppercase);
  if (has('color')) out.color = cleanColor(src.color, d.color);
  if (has('align')) out.align = oneOf(src.align, ['left', 'center', 'right', 'justify'] as const, d.align);
  if (has('lineHeight')) out.lineHeight = num(src.lineHeight, d.lineHeight, 0.5, 5);
  if (has('letterSpacing')) out.letterSpacing = num(src.letterSpacing, d.letterSpacing, -500, 2000);
  if (has('spaceAfter')) out.spaceAfter = num(src.spaceAfter, d.spaceAfter, 0, 2000);
  if (partial) for (const k of Object.keys(out) as (keyof TextStyle)[]) if (!TEXT_STYLE_KEYS.includes(k)) delete out[k];
  return partial ? out : (out as TextStyle);
}

export function normFrame(v: unknown, assetIds?: Set<string>): Frame | null {
  if (!isObj(v)) return null;
  const type = oneOf(v.type, ['text', 'image', 'shape', 'table'] as const, 'shape');
  if (v.type !== type) return null;
  const common = {
    id: typeof v.id === 'string' && v.id ? v.id.slice(0, 64) : uid('f'),
    name: str(v.name, '', 120),
    x: num(v.x, 0, -MAX_COORD, MAX_COORD),
    y: num(v.y, 0, -MAX_COORD, MAX_COORD),
    w: num(v.w, 100, 1, MAX_SIZE),
    h: num(v.h, 100, 1, MAX_SIZE),
    rotation: num(v.rotation, 0, -360, 360),
    opacity: num(v.opacity, 1, 0, 1),
    locked: bool(v.locked, false),
    hidden: bool(v.hidden, false),
    groupId: typeof v.groupId === 'string' && v.groupId ? v.groupId.slice(0, 64) : null,
    shadow: normShadow(v.shadow),
  };
  switch (type) {
    case 'text':
      return {
        ...common,
        type,
        text: cleanText(v.text),
        styleId: typeof v.styleId === 'string' && v.styleId ? v.styleId.slice(0, 64) : null,
        overrides: normTextStyle(v.overrides, true),
        padding: num(v.padding, 0, 0, 2000),
        vAlign: oneOf(v.vAlign, ['top', 'middle', 'bottom'] as const, 'top'),
        columns: Math.round(num(v.columns, 1, 1, 12)),
        columnGap: num(v.columnGap, 16, 0, 2000),
        fill: cleanColor(v.fill, '', true),
        stroke: cleanColor(v.stroke, '', true),
        strokeWidth: num(v.strokeWidth, 0, 0, 500),
        radius: num(v.radius, 0, 0, 5000),
        nextId: typeof v.nextId === 'string' && v.nextId ? v.nextId.slice(0, 64) : null,
      };
    case 'image': {
      const assetId = typeof v.assetId === 'string' && (!assetIds || assetIds.has(v.assetId)) ? v.assetId : null;
      return {
        ...common,
        type,
        assetId,
        fit: oneOf(v.fit, ['fill', 'fit', 'stretch', 'none'] as const, 'fill'),
        focalX: num(v.focalX, 0.5, 0, 1),
        focalY: num(v.focalY, 0.5, 0, 1),
        zoom: num(v.zoom, 1, 0.05, 20),
        radius: num(v.radius, 0, 0, 5000),
        stroke: cleanColor(v.stroke, '', true),
        strokeWidth: num(v.strokeWidth, 0, 0, 500),
        placeholder: cleanColor(v.placeholder, '$4'),
        flipX: bool(v.flipX, false),
        grayscale: bool(v.grayscale, false),
      };
    }
    case 'shape':
      return {
        ...common,
        type,
        shape: oneOf(v.shape, ['rect', 'ellipse', 'line', 'triangle', 'diamond', 'star'] as const, 'rect'),
        fill: cleanColor(v.fill, '', true),
        gradient: normGradient(v.gradient),
        stroke: cleanColor(v.stroke, '', true),
        strokeWidth: num(v.strokeWidth, 0, 0, 500),
        radius: num(v.radius, 0, 0, 5000),
        dashed: bool(v.dashed, false),
      };
    case 'table': {
      const rows = Math.round(num(v.rows, 3, 1, 100));
      const cols = Math.round(num(v.cols, 3, 1, 30));
      const rawCells = Array.isArray(v.cells) ? v.cells : [];
      const cells = Array.from({ length: rows }, (_, r) => {
        const row = Array.isArray(rawCells[r]) ? (rawCells[r] as unknown[]) : [];
        return Array.from({ length: cols }, (_, c) => cleanText(row[c], 5000));
      });
      return {
        ...common,
        type,
        rows,
        cols,
        cells,
        header: bool(v.header, true),
        fontFamily: typeof v.fontFamily === 'string' ? sanitizeFontStack(v.fontFamily) : FONT_STACKS.sans,
        fontSize: num(v.fontSize, 14, 1, 500),
        color: cleanColor(v.color, '$0'),
        align: oneOf(v.align, ['left', 'center', 'right', 'justify'] as const, 'left'),
        fill: cleanColor(v.fill, '', true),
        headerFill: cleanColor(v.headerFill, '$2', true),
        headerColor: cleanColor(v.headerColor, '$1'),
        bandFill: cleanColor(v.bandFill, '', true),
        stroke: cleanColor(v.stroke, '$4', true),
        strokeWidth: num(v.strokeWidth, 1, 0, 50),
        cellPadding: num(v.cellPadding, 6, 0, 200),
      };
    }
  }
}

function normFrames(v: unknown, assetIds: Set<string>, usedIds: Set<string>): Frame[] {
  if (!Array.isArray(v)) return [];
  const out: Frame[] = [];
  for (const raw of v.slice(0, 5000)) {
    const f = normFrame(raw, assetIds);
    if (!f) continue;
    if (usedIds.has(f.id)) f.id = uid('f');
    usedIds.add(f.id);
    out.push(f);
  }
  return out;
}

function normPage(v: unknown, assetIds: Set<string>, usedIds: Set<string>): Page | null {
  if (!isObj(v)) return null;
  const width = num(v.width, 793.7, 10, MAX_SIZE);
  const height = num(v.height, 1122.5, 10, MAX_SIZE);
  const m = isObj(v.margins) ? v.margins : {};
  const dm = defaultMargin(width, height);
  const guides = isObj(v.guides) ? v.guides : {};
  const nums = (a: unknown) =>
    Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(0, 200) : [];
  const id = typeof v.id === 'string' && v.id && !usedIds.has(v.id) ? v.id.slice(0, 64) : uid('p');
  usedIds.add(id);
  return {
    id,
    width,
    height,
    preset: typeof v.preset === 'string' && (v.preset === 'custom' || getPreset(v.preset)) ? v.preset : (matchPreset(width, height)?.id ?? 'custom'),
    margins: {
      top: num(m.top, dm, 0, height / 2),
      right: num(m.right, dm, 0, width / 2),
      bottom: num(m.bottom, dm, 0, height / 2),
      left: num(m.left, dm, 0, width / 2),
    },
    columns: Math.round(num(v.columns, 1, 1, 24)),
    gutter: num(v.gutter, 12, 0, width / 2),
    background: cleanColor(v.background, '#ffffff', true),
    gradient: normGradient(v.gradient),
    applyMaster: bool(v.applyMaster, true),
    frames: normFrames(v.frames, assetIds, usedIds),
    guides: { x: nums(guides.x), y: nums(guides.y) },
  };
}

function normStyles(v: unknown): ParagraphStyle[] {
  if (!Array.isArray(v)) return defaultParagraphStyles();
  const out: ParagraphStyle[] = [];
  for (const raw of v.slice(0, 200)) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) continue;
    if (out.some((s) => s.id === raw.id)) continue;
    out.push({ id: raw.id.slice(0, 64), name: str(raw.name, 'Style', 80) || 'Style', style: normTextStyle(raw.style, false) });
  }
  return out.length ? out : defaultParagraphStyles();
}

function normAssets(v: unknown): Record<string, ImageAsset> {
  const out: Record<string, ImageAsset> = {};
  if (!isObj(v)) return out;
  for (const [key, raw] of Object.entries(v)) {
    if (!isObj(raw) || typeof raw.src !== 'string') continue;
    if (!/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp);base64,/i.test(raw.src)) continue;
    const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : key.slice(0, 64);
    out[id] = { id, name: str(raw.name, 'image', 200), src: raw.src, width: num(raw.width, 100, 1, 100_000), height: num(raw.height, 100, 1, 100_000) };
  }
  return out;
}

/**
 * Validates and repairs a document from an untrusted source (project file, AI, clipboard).
 * Never throws; unknown fields are dropped and out-of-range values clamped.
 */
export function normalizeDoc(raw: unknown): LayoutDoc {
  const v = isObj(raw) ? raw : {};
  const assets = normAssets(v.assets);
  const assetIds = new Set(Object.keys(assets));
  const usedIds = new Set<string>();
  const pages = (Array.isArray(v.pages) ? v.pages : [])
    .slice(0, 1000)
    .map((p) => normPage(p, assetIds, usedIds))
    .filter((p): p is Page => Boolean(p));
  const master = isObj(v.master) ? v.master : {};
  const doc: LayoutDoc = {
    id: typeof v.id === 'string' && v.id ? v.id.slice(0, 64) : uid('d'),
    name: str(v.name, 'Untitled', 120) || 'Untitled',
    unit: oneOf(v.unit, ['mm', 'in', 'px', 'pt'] as const, 'mm'),
    facing: bool(v.facing, false),
    mirrorMaster: bool(v.mirrorMaster, true),
    bleed: num(v.bleed, 0, 0, 200),
    pages: pages.length ? pages : createDoc().pages,
    master: { frames: normFrames(master.frames, assetIds, usedIds) },
    styles: normStyles(v.styles),
    swatches: Array.isArray(v.swatches)
      ? v.swatches.slice(0, 10).map((c, i) => cleanColor(c, DEFAULT_SWATCHES[i] ?? '#888888'))
      : [...DEFAULT_SWATCHES],
    assets,
  };
  while (doc.swatches.length < 6) doc.swatches.push(DEFAULT_SWATCHES[doc.swatches.length]);
  // repair references
  const styleIds = new Set(doc.styles.map((s) => s.id));
  const textIds = new Set<string>();
  for (const p of doc.pages) for (const f of p.frames) if (f.type === 'text') textIds.add(f.id);
  const fixFrame = (f: Frame): Frame => {
    if (f.type !== 'text') return f;
    let next = f;
    if (f.styleId && !styleIds.has(f.styleId)) next = { ...next, styleId: null };
    if (f.nextId && (!textIds.has(f.nextId) || f.nextId === f.id)) next = { ...next, nextId: null };
    return next;
  };
  doc.pages = doc.pages.map((p) => ({ ...p, frames: p.frames.map(fixFrame) }));
  doc.master = { frames: doc.master.frames.map((f) => (f.type === 'text' ? { ...fixFrame(f), nextId: null } : f)) };
  return breakThreadCycles(doc);
}

/** Ensures every text thread is a simple chain (no cycles, no frame with two predecessors). */
export function breakThreadCycles(doc: LayoutDoc): LayoutDoc {
  const next = new Map<string, string>();
  for (const p of doc.pages) for (const f of p.frames) if (f.type === 'text' && f.nextId) next.set(f.id, f.nextId);
  const bad = new Set<string>();
  const hasPred = new Set<string>();
  for (const [from, to] of next) {
    if (hasPred.has(to)) bad.add(from);
    else hasPred.add(to);
  }
  for (const start of next.keys()) {
    const seen = new Set<string>([start]);
    let cur = next.get(start);
    while (cur) {
      if (seen.has(cur)) {
        bad.add(start);
        break;
      }
      seen.add(cur);
      cur = bad.has(cur) ? undefined : next.get(cur);
    }
  }
  if (!bad.size) return doc;
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      frames: p.frames.map((f) => (f.type === 'text' && bad.has(f.id) ? { ...f, nextId: null } : f)),
    })),
  };
}

/** Project file payload. */
export function serializeDoc(doc: LayoutDoc): string {
  return JSON.stringify({ app: 'ultima', module: 'layout', version: 1, doc });
}

export function parseProject(text: string): LayoutDoc {
  const data = JSON.parse(text) as unknown;
  if (!isObj(data) || data.app !== 'ultima') throw new Error('Not an Ultima project file');
  if (data.module !== 'layout') throw new Error(`This project belongs to another module (${String(data.module)})`);
  return normalizeDoc(data.doc);
}

/** All frames of a document (pages + master). */
export function allFrames(doc: LayoutDoc): Frame[] {
  return [...doc.master.frames, ...doc.pages.flatMap((p) => p.frames)];
}
