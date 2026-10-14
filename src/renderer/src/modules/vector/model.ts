import { IDENTITY, type Matrix, type Pt } from './matrix';

/* ---------------------------------- Paint ---------------------------------- */

export interface GradientStop {
  /** 0..1 */
  offset: number;
  /** CSS color (#rrggbb or rgba()) */
  color: string;
}

/**
 * Linear gradient endpoints and radial geometry are stored as fractions of the object's
 * local bounding box (0..1), so gradients follow the object when it is resized.
 */
export interface LinearGradient {
  type: 'linear';
  stops: GradientStop[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RadialGradient {
  type: 'radial';
  stops: GradientStop[];
  cx: number;
  cy: number;
  /** Radius as a fraction of the box width / height (0.5 = touches the edges). */
  rx: number;
  ry: number;
}

export type Paint = { type: 'none' } | { type: 'solid'; color: string } | LinearGradient | RadialGradient;

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';
export type StrokeAlign = 'center' | 'inside' | 'outside';

export interface Stroke {
  paint: Paint;
  width: number;
  dash: number[];
  cap: LineCap;
  join: LineJoin;
  miterLimit: number;
  align: StrokeAlign;
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

export interface Effects {
  shadow?: Shadow;
  /** Gaussian blur radius in px. */
  blur?: number;
}

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/* ---------------------------------- Paths ---------------------------------- */

/** An anchor point with optional bézier handles (absolute local coordinates). */
export interface PathNode {
  x: number;
  y: number;
  /** Incoming control point (towards the previous node). */
  in?: Pt;
  /** Outgoing control point (towards the next node). */
  out?: Pt;
  /** Smooth nodes keep their handles collinear when edited. */
  smooth?: boolean;
}

export interface SubPath {
  nodes: PathNode[];
  closed: boolean;
}

export type FillRule = 'nonzero' | 'evenodd';

export interface PathGeom {
  subpaths: SubPath[];
  fillRule?: FillRule;
}

/* --------------------------------- Objects --------------------------------- */

export type ObjectType = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'path' | 'text' | 'image' | 'group' | 'raw';

interface BaseObject {
  id: string;
  name: string;
  /** Local → parent transform. Scale is normally folded into the geometry (see normalize()). */
  m: Matrix;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  fill: Paint;
  stroke: Stroke;
  effects: Effects;
}

export interface RectObject extends BaseObject {
  type: 'rect';
  width: number;
  height: number;
  radius: number;
}

export interface EllipseObject extends BaseObject {
  type: 'ellipse';
  width: number;
  height: number;
}

export interface PolygonObject extends BaseObject {
  type: 'polygon';
  width: number;
  height: number;
  sides: number;
}

export interface StarObject extends BaseObject {
  type: 'star';
  width: number;
  height: number;
  points: number;
  /** Inner radius as a fraction of the outer radius (0.05..0.95). */
  inner: number;
}

export interface LineObject extends BaseObject {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PathObject extends BaseObject {
  type: 'path';
  geom: PathGeom;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextObject extends BaseObject {
  type: 'text';
  /** Lines separated by \n. Local origin = baseline of the first line at the alignment anchor. */
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  /** Extra space between letters in px. */
  letterSpacing: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  align: TextAlign;
  /** Text on a path: the path (local coordinates) and the start offset in % of its length. */
  onPath?: { geom: PathGeom; offset: number };
}

export interface ImageObject extends BaseObject {
  type: 'image';
  width: number;
  height: number;
  /** data: URL */
  href: string;
  /** SVG preserveAspectRatio value; 'none' stretches. */
  preserve?: string;
}

export interface GroupObject extends BaseObject {
  type: 'group';
  children: VObject[];
}

/** Imported SVG content Ultima cannot edit natively (sanitized markup). */
export interface RawObject extends BaseObject {
  type: 'raw';
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  /** Sanitized inner markup of an <svg> element. */
  content: string;
}

export type VObject =
  | RectObject
  | EllipseObject
  | PolygonObject
  | StarObject
  | LineObject
  | PathObject
  | TextObject
  | ImageObject
  | GroupObject
  | RawObject;

export type BoxObject = RectObject | EllipseObject | PolygonObject | StarObject | ImageObject | RawObject;

export function isBoxObject(o: VObject): o is BoxObject {
  return o.type === 'rect' || o.type === 'ellipse' || o.type === 'polygon' || o.type === 'star' || o.type === 'image' || o.type === 'raw';
}

/** Objects that can show fill/stroke paint. */
export function hasPaint(o: VObject): boolean {
  return o.type !== 'group' && o.type !== 'image' && o.type !== 'raw';
}

export function isShapeLike(o: VObject): boolean {
  return o.type === 'rect' || o.type === 'ellipse' || o.type === 'polygon' || o.type === 'star' || o.type === 'line' || o.type === 'path';
}

/* -------------------------------- Document --------------------------------- */

export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS color or null for transparent. */
  background: string | null;
}

export interface VDoc {
  name: string;
  artboards: Artboard[];
  activeArtboard: string;
  /** Bottom to top. */
  objects: VObject[];
  swatches: string[];
}

/* -------------------------------- Defaults --------------------------------- */

export const NONE: Paint = { type: 'none' };

export function solid(color: string): Paint {
  return { type: 'solid', color };
}

export function defaultStroke(paint: Paint = NONE, width = 1): Stroke {
  return { paint, width, dash: [], cap: 'butt', join: 'miter', miterLimit: 4, align: 'center' };
}

export interface Style {
  fill: Paint;
  stroke: Stroke;
}

export const DEFAULT_STYLE: Style = {
  fill: solid('#ffffff'),
  stroke: defaultStroke(solid('#000000'), 1),
};

let idCounter = 0;
/** Short unique id for document objects. */
export function newId(prefix = 'o'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36).slice(-5)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function base(name: string, style: Partial<Style> = {}, m: Matrix = IDENTITY): BaseObject {
  return {
    id: newId(),
    name,
    m,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    fill: style.fill ?? DEFAULT_STYLE.fill,
    stroke: style.stroke ?? DEFAULT_STYLE.stroke,
    effects: {},
  };
}

const at = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

export function createRect(x: number, y: number, width: number, height: number, style?: Partial<Style>, radius = 0): RectObject {
  return { ...base('Rectangle', style, at(x, y)), type: 'rect', width, height, radius };
}

export function createEllipse(x: number, y: number, width: number, height: number, style?: Partial<Style>): EllipseObject {
  return { ...base('Ellipse', style, at(x, y)), type: 'ellipse', width, height };
}

export function createPolygon(x: number, y: number, width: number, height: number, sides = 6, style?: Partial<Style>): PolygonObject {
  return { ...base('Polygon', style, at(x, y)), type: 'polygon', width, height, sides: clampInt(sides, 3, 64) };
}

export function createStar(x: number, y: number, width: number, height: number, points = 5, inner = 0.5, style?: Partial<Style>): StarObject {
  return { ...base('Star', style, at(x, y)), type: 'star', width, height, points: clampInt(points, 3, 64), inner: clampNum(inner, 0.05, 0.95) };
}

export function createLine(x1: number, y1: number, x2: number, y2: number, style?: Partial<Style>): LineObject {
  return { ...base('Line', { fill: NONE, stroke: style?.stroke }), type: 'line', x1, y1, x2, y2 };
}

export function createPath(geom: PathGeom, style?: Partial<Style>, name = 'Path'): PathObject {
  return { ...base(name, style), type: 'path', geom };
}

export function createText(
  x: number,
  y: number,
  text: string,
  opts: Partial<Pick<TextObject, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'letterSpacing' | 'lineHeight' | 'align'>> = {},
  fill: Paint = solid('#000000'),
): TextObject {
  return {
    ...base('Text', { fill, stroke: defaultStroke(NONE, 1) }, at(x, y)),
    name: text.split('\n')[0].slice(0, 40) || 'Text',
    type: 'text',
    text,
    fontFamily: opts.fontFamily ?? 'Inter',
    fontSize: opts.fontSize ?? 36,
    fontWeight: opts.fontWeight ?? 400,
    italic: opts.italic ?? false,
    letterSpacing: opts.letterSpacing ?? 0,
    lineHeight: opts.lineHeight ?? 1.2,
    align: opts.align ?? 'left',
  };
}

export function createImage(x: number, y: number, width: number, height: number, href: string, name = 'Image'): ImageObject {
  return { ...base(name, { fill: NONE, stroke: defaultStroke() }, at(x, y)), type: 'image', width, height, href, preserve: 'none' };
}

export function createGroup(children: VObject[], name = 'Group'): GroupObject {
  return { ...base(name, { fill: NONE, stroke: defaultStroke() }), type: 'group', children };
}

export function createRaw(
  x: number,
  y: number,
  width: number,
  height: number,
  viewBox: [number, number, number, number],
  content: string,
  name = 'SVG content',
): RawObject {
  return { ...base(name, { fill: NONE, stroke: defaultStroke() }), m: at(x, y), type: 'raw', width, height, viewBox, content };
}

export function createArtboard(name: string, x: number, y: number, width: number, height: number, background: string | null = '#ffffff'): Artboard {
  return { id: newId('ab'), name, x, y, width, height, background };
}

export function createDocument(width = 1080, height = 1080, background: string | null = '#ffffff', name = 'Untitled'): VDoc {
  const ab = createArtboard('Artboard 1', 0, 0, width, height, background);
  return { name, artboards: [ab], activeArtboard: ab.id, objects: [], swatches: [] };
}

export interface ArtboardPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** Sizes in CSS pixels (96 per inch). */
export const ARTBOARD_PRESETS: ArtboardPreset[] = [
  { id: 'a4', label: 'A4', width: 794, height: 1123 },
  { id: 'letter', label: 'Letter', width: 816, height: 1056 },
  { id: 'square', label: '1080 × 1080', width: 1080, height: 1080 },
  { id: 'hd', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'logo', label: 'Logo 512 × 512', width: 512, height: 512 },
  { id: 'icon', label: 'Icon 24 × 24', width: 24, height: 24 },
  { id: 'card', label: 'Business card', width: 336, height: 192 },
];

export function clampNum(v: unknown, min: number, max: number, fallback = min): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampInt(v: unknown, min: number, max: number, fallback = min): number {
  return Math.round(clampNum(v, min, max, fallback));
}

/* ------------------------------- Tree helpers ------------------------------ */

export function walkObjects(objects: VObject[], fn: (o: VObject, parents: VObject[]) => void, parents: VObject[] = []): void {
  for (const o of objects) {
    fn(o, parents);
    if (o.type === 'group') walkObjects(o.children, fn, [...parents, o]);
  }
}

export function findObject(objects: VObject[], id: string): VObject | null {
  for (const o of objects) {
    if (o.id === id) return o;
    if (o.type === 'group') {
      const found = findObject(o.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Ancestors (outermost first) of the object with `id`, or null when not found. */
export function findAncestors(objects: VObject[], id: string, trail: VObject[] = []): VObject[] | null {
  for (const o of objects) {
    if (o.id === id) return trail;
    if (o.type === 'group') {
      const found = findAncestors(o.children, id, [...trail, o]);
      if (found) return found;
    }
  }
  return null;
}

export function allIds(objects: VObject[]): Set<string> {
  const ids = new Set<string>();
  walkObjects(objects, (o) => ids.add(o.id));
  return ids;
}

export function countObjects(objects: VObject[]): number {
  let n = 0;
  walkObjects(objects, () => n++);
  return n;
}

/** Deep copy with fresh ids (for duplicate/paste). */
export function cloneWithNewIds<T extends VObject>(o: T): T {
  const copy = { ...o, id: newId() } as T;
  if (copy.type === 'group') (copy as GroupObject).children = (copy as GroupObject).children.map((c) => cloneWithNewIds(c));
  return copy;
}

export const TYPE_LABELS: Record<ObjectType, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  path: 'Path',
  text: 'Text',
  image: 'Image',
  group: 'Group',
  raw: 'SVG content',
};
