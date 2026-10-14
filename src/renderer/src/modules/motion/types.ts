/** Data model of the Motion Graphics module (pure types, no DOM). */

export type Vec2 = [number, number];
/** number | [x, y] | CSS color string */
export type PropValue = number | Vec2 | string;
export type PropKind = 'number' | 'vec2' | 'color';

export type EasingType =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'hold'
  | 'back'
  | 'elastic'
  | 'bounce'
  | 'bezier';

/** cubic-bezier(x1, y1, x2, y2) control points (x in 0..1, y may overshoot). */
export type Bezier = [number, number, number, number];

export interface Keyframe<V extends PropValue = PropValue> {
  id: string;
  /** Composition time in seconds. */
  time: number;
  value: V;
  /** Interpolation from this keyframe to the next one. */
  easing: EasingType;
  /** Control points when easing === 'bezier'. */
  bezier?: Bezier;
}

export interface AnimProp<V extends PropValue = PropValue> {
  /** Value used while the property is not animated (no keyframes). */
  value: V;
  /** Sorted by time. A non-empty list means the stopwatch is on. */
  keyframes: Keyframe<V>[];
}

export type PropKey =
  | 'anchor'
  | 'position'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'size'
  | 'fill'
  | 'strokeColor'
  | 'strokeWidth'
  | 'cornerRadius'
  | 'trimStart'
  | 'trimEnd'
  | 'letterSpacing'
  | 'reveal'
  | 'blur';

export interface LayerProps {
  /** Offset (px, layer space) of the transform origin from the layer's natural center. */
  anchor: AnimProp<Vec2>;
  /** Where the anchor point sits in the parent (or composition) space, px. */
  position: AnimProp<Vec2>;
  /** Percent (100 = original size). */
  scale: AnimProp<Vec2>;
  /** Degrees, clockwise. */
  rotation: AnimProp<number>;
  /** 0..100 % */
  opacity: AnimProp<number>;
  /** Shape / solid size in px. */
  size: AnimProp<Vec2>;
  fill: AnimProp<string>;
  strokeColor: AnimProp<string>;
  strokeWidth: AnimProp<number>;
  cornerRadius: AnimProp<number>;
  /** Trim paths, 0..100 % of the outline. */
  trimStart: AnimProp<number>;
  trimEnd: AnimProp<number>;
  /** Text tracking in px. */
  letterSpacing: AnimProp<number>;
  /** Text reveal 0..100 % (typewriter / word-by-word). */
  reveal: AnimProp<number>;
  /** Gaussian blur radius in px. */
  blur: AnimProp<number>;
}

export type LayerType = 'text' | 'shape' | 'image' | 'solid' | 'null' | 'video';
export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'path';
export type TextAlign = 'left' | 'center' | 'right';
export type RevealMode = 'chars' | 'words' | 'lines';
export type RevealStyle = 'instant' | 'fade' | 'rise';

export type BlendMode =
  | 'normal'
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
  | 'add';

/** Bézier node: anchor point + in/out handles stored relative to the point. */
export interface PathNode {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export interface SubPath {
  closed: boolean;
  nodes: PathNode[];
}

export interface TextData {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: TextAlign;
  /** Multiplier of the font size. */
  lineHeight: number;
  fillEnabled: boolean;
  strokeEnabled: boolean;
  revealMode: RevealMode;
  revealStyle: RevealStyle;
}

export interface ShapeData {
  kind: ShapeKind;
  /** Polygon sides / star points. */
  points: number;
  /** Star inner radius, % of the outer radius. */
  innerRadius: number;
  /** Path geometry (kind === 'path'), centered on the layer origin. */
  path?: SubPath[];
  fillEnabled: boolean;
  strokeEnabled: boolean;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
}

export interface DropShadow {
  enabled: boolean;
  color: string;
  /** Direction in degrees (0 = right, 90 = down). */
  angle: number;
  distance: number;
  softness: number;
}

export interface Glow {
  enabled: boolean;
  color: string;
  radius: number;
  /** 0..300 % */
  intensity: number;
}

export interface LayerEffects {
  shadow: DropShadow;
  glow: Glow;
}

export type WiggleTarget = 'position' | 'rotation' | 'scale' | 'opacity';

/** Procedural animation (like After Effects' wiggle() expression). */
export interface Wiggle {
  id: string;
  property: WiggleTarget;
  /** Wiggles per second. */
  frequency: number;
  /** px for position, degrees for rotation, % for scale/opacity. */
  amplitude: number;
  seed: number;
  start: number;
  end: number;
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  solo: boolean;
  /** Seconds (composition time). The layer is visible in [inPoint, outPoint). */
  inPoint: number;
  outPoint: number;
  parentId: string | null;
  blendMode: BlendMode;
  /** Timeline bar color. */
  label: string;
  props: LayerProps;
  text?: TextData;
  shape?: ShapeData;
  /** image / video layers */
  assetId?: string;
  /** Video layers: source time (s) shown at the layer's in point. */
  mediaOffset?: number;
  effects: LayerEffects;
  wiggles: Wiggle[];
}

export interface Composition {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Seconds. */
  duration: number;
  background: string;
  transparent: boolean;
  workStart: number;
  workEnd: number;
}

export interface Asset {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mime: string;
  width: number;
  height: number;
  /** Video duration in seconds. */
  duration?: number;
  blob: Blob;
  /** Object URL of `blob` (runtime only). */
  url: string;
}

export interface MotionDoc {
  comp: Composition;
  /** Index 0 is the top-most layer (drawn last), like After Effects. */
  layers: Layer[];
  assets: Record<string, Asset>;
}

/** Reference to one keyframe in the document. */
export interface KeyRef {
  layerId: string;
  prop: PropKey;
  keyId: string;
}
