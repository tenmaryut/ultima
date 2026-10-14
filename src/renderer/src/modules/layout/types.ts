/**
 * Layout & Publishing document model.
 *
 * All lengths are stored in CSS pixels at 96 px per inch ("page px"). Units shown in the
 * UI (mm / in / pt / px) are display conversions only (see units.ts).
 * Colors are CSS color strings or theme references "$0".."$9" that resolve to
 * `doc.swatches[n]`, so a whole design can be recolored by changing the theme.
 */

export type Unit = 'mm' | 'in' | 'px' | 'pt';
export type FrameType = 'text' | 'image' | 'shape' | 'table';
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'triangle' | 'diamond' | 'star';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';
export type FitMode = 'fill' | 'fit' | 'stretch' | 'none';

export interface GradientStop {
  color: string;
  /** 0..1 */
  pos: number;
}

export interface Gradient {
  kind: 'linear' | 'radial';
  /** Degrees, CSS convention (0 = to top, 90 = to right). Ignored for radial. */
  angle: number;
  stops: GradientStop[];
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

export interface TextStyle {
  /** CSS font-family list, e.g. "Georgia, 'Times New Roman', serif". */
  fontFamily: string;
  /** px */
  fontSize: number;
  /** 100..900 */
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  color: string;
  align: TextAlign;
  /** Multiplier of the font size. */
  lineHeight: number;
  /** Tracking in 1/1000 em. */
  letterSpacing: number;
  /** Space after each paragraph, px. */
  spaceAfter: number;
}

export interface ParagraphStyle {
  id: string;
  name: string;
  style: TextStyle;
}

export interface FrameBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the frame center. */
  rotation: number;
  /** 0..1 */
  opacity: number;
  locked: boolean;
  hidden: boolean;
  /** Frames sharing a groupId are selected and moved together. */
  groupId: string | null;
  shadow: Shadow | null;
}

export interface TextFrame extends FrameBase {
  type: 'text';
  /** Plain text; "\n" separates paragraphs. Supports {page} and {pages} tokens. */
  text: string;
  styleId: string | null;
  /** Local overrides on top of the paragraph style. */
  overrides: Partial<TextStyle>;
  padding: number;
  vAlign: VAlign;
  columns: number;
  columnGap: number;
  /** Background color ('' = none). */
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  /** Next frame of the text thread (overflow flows into it). */
  nextId: string | null;
}

export interface ImageFrame extends FrameBase {
  type: 'image';
  assetId: string | null;
  fit: FitMode;
  /** Focal point / alignment of the image inside the frame, 0..1. */
  focalX: number;
  focalY: number;
  /** Extra scale on top of the fit mode (1 = none). */
  zoom: number;
  radius: number;
  stroke: string;
  strokeWidth: number;
  /** Shown while there is no image. */
  placeholder: string;
  flipX: boolean;
  grayscale: boolean;
}

export interface ShapeFrame extends FrameBase {
  type: 'shape';
  shape: ShapeKind;
  /** '' = no fill */
  fill: string;
  gradient: Gradient | null;
  stroke: string;
  strokeWidth: number;
  radius: number;
  dashed: boolean;
}

export interface TableFrame extends FrameBase {
  type: 'table';
  rows: number;
  cols: number;
  /** rows x cols plain text cells */
  cells: string[][];
  header: boolean;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  fill: string;
  headerFill: string;
  headerColor: string;
  /** Alternate row fill ('' = none). */
  bandFill: string;
  stroke: string;
  strokeWidth: number;
  cellPadding: number;
}

export type Frame = TextFrame | ImageFrame | ShapeFrame | TableFrame;

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Guides {
  /** Vertical guides (x positions, page px). */
  x: number[];
  /** Horizontal guides (y positions, page px). */
  y: number[];
}

export interface Page {
  id: string;
  width: number;
  height: number;
  /** Preset id (units.ts) or 'custom'. */
  preset: string;
  margins: Margins;
  columns: number;
  gutter: number;
  background: string;
  gradient: Gradient | null;
  applyMaster: boolean;
  frames: Frame[];
  guides: Guides;
}

export interface ImageAsset {
  id: string;
  name: string;
  /** data: URL */
  src: string;
  width: number;
  height: number;
}

export interface MasterPage {
  frames: Frame[];
}

export interface LayoutDoc {
  id: string;
  name: string;
  unit: Unit;
  facing: boolean;
  /** Mirror master items (and margins) on left pages of facing spreads. */
  mirrorMaster: boolean;
  /** Bleed in px (printing). */
  bleed: number;
  pages: Page[];
  master: MasterPage;
  styles: ParagraphStyle[];
  /** Theme colors referenced as "$0", "$1", … */
  swatches: string[];
  assets: Record<string, ImageAsset>;
}

/** Pseudo page id used when the master page is being edited. */
export const MASTER_ID = '__master__';

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
