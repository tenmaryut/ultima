import { normalizeColor } from './colors';
import { IDENTITY, type Matrix } from './matrix';
import {
  BLEND_MODES,
  clampInt,
  clampNum,
  createDocument,
  defaultStroke,
  newId,
  NONE,
  type Artboard,
  type BlendMode,
  type Effects,
  type GradientStop,
  type Paint,
  type PathGeom,
  type PathNode,
  type Stroke,
  type VDoc,
  type VObject,
} from './model';

export const PROJECT_VERSION = 1;

export function serializeProject(doc: VDoc): string {
  return JSON.stringify({ app: 'ultima', module: 'vector', version: PROJECT_VERSION, savedAt: new Date().toISOString(), doc });
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

function matrix(v: unknown): Matrix {
  if (Array.isArray(v) && v.length === 6 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return v as Matrix;
  return IDENTITY;
}

function color(v: unknown, fallback = '#000000'): string {
  return normalizeColor(typeof v === 'string' ? v : null) ?? fallback;
}

function stops(v: unknown): GradientStop[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((s) => ({ offset: clampNum(s.offset, 0, 1, 0), color: color(s.color) }));
}

export function sanitizePaint(v: unknown): Paint {
  if (!isObj(v)) return NONE;
  switch (v.type) {
    case 'solid':
      return { type: 'solid', color: color(v.color) };
    case 'linear': {
      const s = stops(v.stops);
      if (s.length < 2) return s.length ? { type: 'solid', color: s[0].color } : NONE;
      return { type: 'linear', stops: s, x1: num(v.x1, 0), y1: num(v.y1, 0), x2: num(v.x2, 1), y2: num(v.y2, 0) };
    }
    case 'radial': {
      const s = stops(v.stops);
      if (s.length < 2) return s.length ? { type: 'solid', color: s[0].color } : NONE;
      return { type: 'radial', stops: s, cx: num(v.cx, 0.5), cy: num(v.cy, 0.5), rx: Math.max(0.001, num(v.rx, 0.5)), ry: Math.max(0.001, num(v.ry, 0.5)) };
    }
    default:
      return NONE;
  }
}

function sanitizeStroke(v: unknown): Stroke {
  if (!isObj(v)) return defaultStroke();
  const cap = ['butt', 'round', 'square'].includes(v.cap as string) ? (v.cap as Stroke['cap']) : 'butt';
  const join = ['miter', 'round', 'bevel'].includes(v.join as string) ? (v.join as Stroke['join']) : 'miter';
  const align = ['center', 'inside', 'outside'].includes(v.align as string) ? (v.align as Stroke['align']) : 'center';
  return {
    paint: sanitizePaint(v.paint),
    width: clampNum(v.width, 0, 1000, 1),
    dash: Array.isArray(v.dash) ? v.dash.filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d >= 0).slice(0, 16) : [],
    cap,
    join,
    miterLimit: clampNum(v.miterLimit, 1, 100, 4),
    align,
  };
}

function sanitizeEffects(v: unknown): Effects {
  if (!isObj(v)) return {};
  const out: Effects = {};
  if (isObj(v.shadow)) {
    out.shadow = {
      x: clampNum(v.shadow.x, -1000, 1000, 0),
      y: clampNum(v.shadow.y, -1000, 1000, 4),
      blur: clampNum(v.shadow.blur, 0, 500, 8),
      color: color(v.shadow.color, 'rgba(0, 0, 0, 0.35)'),
    };
  }
  if (typeof v.blur === 'number' && v.blur > 0) out.blur = clampNum(v.blur, 0, 500, 0);
  return out;
}

function pt(v: unknown): { x: number; y: number } | undefined {
  return isObj(v) && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : undefined;
}

export function sanitizeGeom(v: unknown): PathGeom {
  if (!isObj(v) || !Array.isArray(v.subpaths)) return { subpaths: [] };
  const subpaths = v.subpaths.filter(isObj).map((s) => ({
    closed: bool(s.closed),
    nodes: (Array.isArray(s.nodes) ? s.nodes : [])
      .filter(isObj)
      .filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y))
      .map((n) => {
        const node: PathNode = { x: n.x as number, y: n.y as number };
        const i = pt(n.in);
        const o = pt(n.out);
        if (i) node.in = i;
        if (o) node.out = o;
        if (n.smooth === true) node.smooth = true;
        return node;
      }),
  }));
  return { subpaths: subpaths.filter((s) => s.nodes.length > 0), fillRule: v.fillRule === 'evenodd' ? 'evenodd' : undefined };
}

/** Validates an object tree from untrusted JSON. Unknown types are dropped; ids are made unique. */
export function sanitizeObject(v: unknown, seen: Set<string>, depth = 0): VObject | null {
  if (!isObj(v) || depth > 64) return null;
  let id = str(v.id);
  if (!id || seen.has(id)) id = newId();
  seen.add(id);
  const blend = (BLEND_MODES as readonly string[]).includes(v.blend as string) ? (v.blend as BlendMode) : 'normal';
  const base = {
    id,
    name: str(v.name, 'Object').slice(0, 200),
    m: matrix(v.m),
    visible: bool(v.visible, true),
    locked: bool(v.locked, false),
    opacity: clampNum(v.opacity, 0, 1, 1),
    blend,
    fill: sanitizePaint(v.fill),
    stroke: sanitizeStroke(v.stroke),
    effects: sanitizeEffects(v.effects),
  };
  const w = clampNum(v.width, 0, 1e6, 0);
  const h = clampNum(v.height, 0, 1e6, 0);
  switch (v.type) {
    case 'rect':
      return { ...base, type: 'rect', width: w, height: h, radius: clampNum(v.radius, 0, 1e6, 0) };
    case 'ellipse':
      return { ...base, type: 'ellipse', width: w, height: h };
    case 'polygon':
      return { ...base, type: 'polygon', width: w, height: h, sides: clampInt(v.sides, 3, 64, 6) };
    case 'star':
      return { ...base, type: 'star', width: w, height: h, points: clampInt(v.points, 3, 64, 5), inner: clampNum(v.inner, 0.05, 0.95, 0.5) };
    case 'line':
      return { ...base, type: 'line', x1: num(v.x1), y1: num(v.y1), x2: num(v.x2), y2: num(v.y2) };
    case 'path':
      return { ...base, type: 'path', geom: sanitizeGeom(v.geom) };
    case 'text': {
      const align = ['left', 'center', 'right'].includes(v.align as string) ? (v.align as 'left') : 'left';
      const out: VObject = {
        ...base,
        type: 'text',
        text: str(v.text).slice(0, 100000),
        fontFamily: str(v.fontFamily, 'Inter').slice(0, 200),
        fontSize: clampNum(v.fontSize, 1, 2000, 36),
        fontWeight: clampInt(v.fontWeight, 100, 900, 400),
        italic: bool(v.italic),
        letterSpacing: clampNum(v.letterSpacing, -200, 1000, 0),
        lineHeight: clampNum(v.lineHeight, 0.3, 10, 1.2),
        align,
      };
      if (isObj(v.onPath)) out.onPath = { geom: sanitizeGeom(v.onPath.geom), offset: clampNum(v.onPath.offset, 0, 100, 0) };
      return out;
    }
    case 'image': {
      const href = str(v.href);
      if (!/^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif);/i.test(href)) return null;
      return { ...base, type: 'image', width: w, height: h, href, preserve: typeof v.preserve === 'string' ? v.preserve.slice(0, 40) : 'none' };
    }
    case 'raw': {
      const vb = Array.isArray(v.viewBox) && v.viewBox.length === 4 && v.viewBox.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v.viewBox as [number, number, number, number]) : null;
      if (!vb) return null;
      return { ...base, type: 'raw', width: w, height: h, viewBox: vb, content: str(v.content) };
    }
    case 'group': {
      const children = (Array.isArray(v.children) ? v.children : []).map((c) => sanitizeObject(c, seen, depth + 1)).filter((c): c is VObject => Boolean(c));
      return { ...base, type: 'group', children };
    }
    default:
      return null;
  }
}

function sanitizeArtboard(v: unknown, index: number): Artboard | null {
  if (!isObj(v)) return null;
  return {
    id: str(v.id) || newId('ab'),
    name: str(v.name, `Artboard ${index + 1}`).slice(0, 120),
    x: num(v.x),
    y: num(v.y),
    width: clampNum(v.width, 1, 100000, 1080),
    height: clampNum(v.height, 1, 100000, 1080),
    background: v.background === null ? null : (normalizeColor(str(v.background)) ?? '#ffffff'),
  };
}

/** Parses an .ultima vector project (throws on anything that is not one). */
export function parseProject(text: string): VDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not a valid Ultima project.');
  }
  if (!isObj(data) || data.app !== 'ultima' || data.module !== 'vector' || !isObj(data.doc)) {
    throw new Error('This is not a Vector Designer project.');
  }
  if (typeof data.version === 'number' && data.version > PROJECT_VERSION) {
    throw new Error('This project was saved by a newer version of Ultima.');
  }
  const d = data.doc;
  const artboards = (Array.isArray(d.artboards) ? d.artboards : []).map(sanitizeArtboard).filter((a): a is Artboard => Boolean(a));
  const base = createDocument();
  const seen = new Set<string>();
  const objects = (Array.isArray(d.objects) ? d.objects : []).map((o) => sanitizeObject(o, seen)).filter((o): o is VObject => Boolean(o));
  const abs = artboards.length ? artboards : base.artboards;
  const active = str(d.activeArtboard);
  return {
    name: str(d.name, 'Untitled').slice(0, 200),
    artboards: abs,
    activeArtboard: abs.some((a) => a.id === active) ? active : abs[0].id,
    objects,
    swatches: (Array.isArray(d.swatches) ? d.swatches : []).map((c) => normalizeColor(typeof c === 'string' ? c : null)).filter((c): c is string => Boolean(c)).slice(0, 500),
  };
}
