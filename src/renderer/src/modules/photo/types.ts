/**
 * Document model of the Photo Editor.
 *
 * Documents are immutable: every edit produces a new `PhotoDoc` object. Pixel buffers
 * (canvases) are shared between states and are NEVER mutated once they are referenced by a
 * document (copy-on-write), so undo history only keeps the layers that actually changed.
 */

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'lighter';

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'darken', label: 'Darken' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'screen', label: 'Screen' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'lighter', label: 'Linear Dodge (Add)' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && BLEND_MODES.some((b) => b.value === value);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ShadowEffect {
  enabled: boolean;
  color: string;
  /** 0..1 */
  opacity: number;
  /** Light angle in degrees (Photoshop convention: 120 = light from the upper left). */
  angle: number;
  distance: number;
  /** Blur size in px. */
  size: number;
}

export interface StrokeEffect {
  enabled: boolean;
  color: string;
  size: number;
  opacity: number;
  position: 'outside' | 'center' | 'inside';
}

export interface GlowEffect {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  /** 0..100 % of the size that is solid before the falloff. */
  spread: number;
}

export interface LayerEffects {
  shadow?: ShadowEffect;
  stroke?: StrokeEffect;
  glow?: GlowEffect;
}

/**
 * Layer mask. The canvas stores the mask in its ALPHA channel (opaque = revealed,
 * transparent = hidden). `reveal` is the value outside the canvas bounds.
 */
export interface LayerMask {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  reveal: boolean;
  enabled: boolean;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  mask: LayerMask | null;
  effects: LayerEffects;
}

export interface RasterLayer extends LayerBase {
  type: 'raster';
  canvas: HTMLCanvasElement;
  /** Position of the canvas in document pixels (may be negative / outside the document). */
  x: number;
  y: number;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  /** Anchor: x is the left edge / center / right edge (by `align`), y is the top of the first line. */
  x: number;
  y: number;
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  align: TextAlign;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Extra px between characters. */
  letterSpacing: number;
  /** Degrees, around the text block's center. */
  rotation: number;
}

export type ShapeKind = 'rect' | 'roundrect' | 'ellipse' | 'line';

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: ShapeKind;
  /** Box (for lines: start point, and x+w / y+h is the end point; w/h may be negative). */
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  rotation: number;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer;
export type LayerType = Layer['type'];

/** A selection: one byte per document pixel (0 = not selected, 255 = fully selected). */
export interface Selection {
  width: number;
  height: number;
  mask: Uint8Array;
  /** Bounding box of the non-zero pixels (never empty — an empty selection is `null`). */
  bounds: Rect;
}

export interface PhotoDoc {
  width: number;
  height: number;
  /** Bottom → top. */
  layers: Layer[];
  activeId: string | null;
  selection: Selection | null;
}

export type ToolId =
  | 'move'
  | 'marquee'
  | 'lasso'
  | 'wand'
  | 'crop'
  | 'eyedropper'
  | 'heal'
  | 'clone'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'gradient'
  | 'dodge'
  | 'blur'
  | 'text'
  | 'shape'
  | 'hand'
  | 'zoom';

export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect';

export interface ToolOptions {
  move: { autoSelect: boolean };
  marquee: { shape: 'rect' | 'ellipse'; feather: number; style: 'normal' | 'ratio' | 'size'; ratioW: number; ratioH: number; fixedW: number; fixedH: number };
  lasso: { kind: 'free' | 'polygon'; feather: number };
  wand: { tolerance: number; contiguous: boolean; sampleAll: boolean; antiAlias: boolean };
  selMode: SelectionMode;
  crop: { aspect: string; angle: number };
  brush: { size: number; hardness: number; opacity: number; flow: number; smoothing: number; pressureSize: boolean; pressureOpacity: boolean };
  pencil: { size: number; opacity: number };
  eraser: { size: number; hardness: number; opacity: number; flow: number };
  clone: { size: number; hardness: number; opacity: number; flow: number; aligned: boolean; sampleAll: boolean };
  heal: { size: number; hardness: number };
  dodge: { size: number; hardness: number; mode: 'dodge' | 'burn' | 'sponge'; range: 'shadows' | 'midtones' | 'highlights'; exposure: number; sponge: 'saturate' | 'desaturate' };
  blur: { size: number; hardness: number; mode: 'blur' | 'sharpen'; strength: number };
  bucket: { tolerance: number; contiguous: boolean; sampleAll: boolean; opacity: number; antiAlias: boolean };
  gradient: { type: 'linear' | 'radial'; colors: 'fg-bg' | 'fg-transparent'; reverse: boolean; opacity: number };
  eyedropper: { sampleSize: number; sampleAll: boolean };
  text: { font: string; size: number; weight: number; italic: boolean; align: TextAlign };
  shape: { kind: ShapeKind; fill: boolean; stroke: boolean; strokeWidth: number; radius: number; strokeColor: string };
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  move: { autoSelect: false },
  marquee: { shape: 'rect', feather: 0, style: 'normal', ratioW: 1, ratioH: 1, fixedW: 512, fixedH: 512 },
  lasso: { kind: 'free', feather: 0 },
  wand: { tolerance: 32, contiguous: true, sampleAll: false, antiAlias: true },
  selMode: 'new',
  crop: { aspect: 'free', angle: 0 },
  brush: { size: 24, hardness: 0.8, opacity: 1, flow: 1, smoothing: 0.25, pressureSize: true, pressureOpacity: false },
  pencil: { size: 1, opacity: 1 },
  eraser: { size: 40, hardness: 0.8, opacity: 1, flow: 1 },
  clone: { size: 40, hardness: 0.5, opacity: 1, flow: 1, aligned: true, sampleAll: false },
  heal: { size: 30, hardness: 0.6 },
  dodge: { size: 60, hardness: 0.3, mode: 'dodge', range: 'midtones', exposure: 0.5, sponge: 'desaturate' },
  blur: { size: 40, hardness: 0.3, mode: 'blur', strength: 0.5 },
  bucket: { tolerance: 32, contiguous: true, sampleAll: false, opacity: 1, antiAlias: true },
  gradient: { type: 'linear', colors: 'fg-bg', reverse: false, opacity: 1 },
  eyedropper: { sampleSize: 1, sampleAll: true },
  text: { font: 'Inter', size: 64, weight: 700, italic: false, align: 'left' },
  shape: { kind: 'rect', fill: true, stroke: false, strokeWidth: 4, radius: 24, strokeColor: '#000000' },
};

export const MAX_DOC_SIDE = 16000;
export const MAX_DOC_PIXELS = 120_000_000;
