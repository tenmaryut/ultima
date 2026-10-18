/**
 * Video Editor document model. Everything in `Project` is plain JSON (saved in .ultima
 * files and kept in the undo history). Runtime-only data (File objects, object URLs,
 * thumbnails, waveforms) lives in the MediaLibrary, keyed by `MediaRef.id`.
 *
 * Units: times in seconds, positions in project pixels, colors as CSS strings.
 */

export type TrackKind = 'video' | 'audio' | 'caption';
/** "adjustment": a layer without a picture whose color and effects apply to everything below it. */
export type ClipKind = 'video' | 'audio' | 'image' | 'title' | 'caption' | 'adjustment';
export type MediaKind = 'video' | 'audio' | 'image';
export type TransitionKind =
  | 'dissolve'
  | 'dipBlack'
  | 'dipWhite'
  | 'wipeLeft'
  | 'wipeRight'
  | 'slide'
  | 'zoom'
  | 'flash'
  | 'whipLeft'
  | 'whipRight'
  | 'spin'
  | 'zoomBlur'
  | 'glitch'
  | 'lumaFade'
  | 'blurDissolve';
export type TitleAnimation = 'none' | 'fade' | 'slideUp' | 'pop' | 'typewriter';
export type TextAlign = 'left' | 'center' | 'right';

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  /** Color behind all tracks. */
  background: string;
}

export interface MediaRef {
  id: string;
  name: string;
  kind: MediaKind;
  /** Seconds (0 for still images). */
  duration: number;
  width: number;
  height: number;
  size: number;
  mime: string;
  hasAudio: boolean;
  /** Frames per second of a video (when known). */
  fps?: number;
  /** Absolute path on disk (desktop) — only used to help the user relink. */
  path?: string;
  lastModified?: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Audio tracks: silent. */
  muted: boolean;
  /** Video / caption tracks: not rendered. */
  hidden: boolean;
  /** Clips can't be selected or edited. */
  locked: boolean;
  /** Audio tracks: when any track is soloed, only soloed tracks are heard. */
  solo: boolean;
}

export interface Transition {
  kind: TransitionKind;
  /** Seconds, starting at the clip's start. */
  duration: number;
}

/** Transform + effects of a visual clip (video, image, title). */
export interface VisualProps {
  /** Offset of the clip center from the frame center, project px. */
  x: number;
  y: number;
  /** 1 = media fitted inside the frame. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0-1 */
  opacity: number;
  /** Fractions (0-0.45) cut from each side of the source. */
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
  /** -100..100, 0 = neutral */
  brightness: number;
  contrast: number;
  saturation: number;
  /** -180..180 degrees */
  hue: number;
  /** -100 (cool) .. 100 (warm) */
  temperature: number;
  /** Blur radius in project px (0-50). */
  blur: number;
  chromaKey: boolean;
  chromaColor: string;
  /** 0-1 */
  chromaSimilarity: number;
  /** 0-1 */
  chromaSmoothness: number;
  /** Camera shake: strength in project px (0 = off) and shakes per second. */
  shake: number;
  shakeSpeed: number;
  /** Glow (bloom) of bright areas 0-1, and its radius in project px. */
  glow: number;
  glowRadius: number;
  /** Chromatic aberration: red and blue pushed apart by this many project px. */
  rgbSplit: number;
  /** Motion blur streak length in project px, and its direction in degrees (0 = horizontal). */
  motionBlur: number;
  motionBlurAngle: number;
  /** Radial (zoom) blur 0-1. */
  zoomBlur: number;
  /** Dark edges 0-1. */
  vignette: number;
  /** 0-1 */
  sharpen: number;
  /** Film grain 0-1. */
  grain: number;
  /** Black bars at the top and bottom of the frame: fraction of the frame height each (0-0.3). */
  letterbox: number;
}

/** How a clip's picture mixes with what is below it. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'add';

export type MaskShape = 'rectangle' | 'ellipse' | 'linear';

/** Shows only part of a clip. Positions are fractions of the clip's (uncropped) picture, so the mask moves with it. */
export interface ClipMask {
  shape: MaskShape;
  /** Center (0-1). For "linear": a point on the edge. */
  x: number;
  y: number;
  /** Size (0-2) — rectangle and ellipse. */
  w: number;
  h: number;
  /** Degrees. For "linear": the direction the visible side faces (0 = left part visible… 90 = top). */
  rotation: number;
  /** Soft edge, fraction of the picture's shorter side (0-0.5). */
  feather: number;
  /** Shows the outside instead. */
  invert: boolean;
}

export type LookId =
  | 'cinematic'
  | 'tealOrange'
  | 'warm'
  | 'cool'
  | 'vintage'
  | 'faded'
  | 'bw'
  | 'noir'
  | 'sepia'
  | 'vivid'
  | 'cyberpunk'
  | 'moody'
  | 'golden'
  | 'bleach'
  | 'pastel'
  | 'night';

export type HueRange = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export type CurveChannel = 'master' | 'r' | 'g' | 'b';
/** [input, output], both 0-1. */
export type CurvePoint = [number, number];

/** Color grading beyond the basic sliders. */
export interface ColorGrade {
  /** A built-in look and how strong it is (0-1). */
  look?: LookId;
  lookAmount: number;
  /** An imported .cube LUT (id in `Project.luts`) and how strong it is (0-1). */
  lut?: string;
  lutAmount: number;
  /** Tone curves (points sorted by input). */
  curves?: Partial<Record<CurveChannel, CurvePoint[]>>;
  /** Per color range: hue shift (degrees, -30..30), saturation and luminance (-100..100). */
  hsl?: Partial<Record<HueRange, { h: number; s: number; l: number }>>;
}

/** Sound effects of an audio clip (0 = off for the filters). */
export interface AudioFx {
  /** Cuts below this frequency (Hz): rumble, wind. */
  highPass: number;
  /** Cuts above this frequency (Hz): low values sound muffled (through a wall, underwater). */
  lowPass: number;
  /** Bass (low shelf 150 Hz), mids (1 kHz) and treble (high shelf 6 kHz) in dB, −24..24. */
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  /** Reverb mix 0-1 and its length in seconds (0.2-8). */
  reverb: number;
  reverbSize: number;
}

/** A font file stored in the project (so titles look the same on any computer). */
export interface FontAsset {
  id: string;
  /** The family name titles use. */
  family: string;
  /** Original file name. */
  name: string;
  /** Base64 of the font file (TTF, OTF, WOFF or WOFF2). */
  data: string;
}

/** A 3D color lookup table imported from a .cube file. */
export interface LutAsset {
  id: string;
  name: string;
  /** Points per side (2-65). */
  size: number;
  /** Base64 of size³ × 3 little-endian Uint16 values (0-65535), red changing fastest. */
  data: string;
}

export interface TitleStyle {
  text: string;
  /** Optional smaller second line (lower thirds). */
  subtitle: string;
  font: string;
  /** Font size in project px. */
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  outlineColor: string;
  /** Outline width in project px (0 = none). */
  outlineWidth: number;
  box: boolean;
  boxColor: string;
  shadow: boolean;
  align: TextAlign;
  /** Anchor position as fractions of the frame (0-1). */
  x: number;
  y: number;
  animation: TitleAnimation;
  /** Seconds for the in/out animation (typewriter: typing time). */
  animDuration: number;
}

/** How a keyframe moves towards the next one. */
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';

export interface Keyframe {
  /** Seconds from the clip start. */
  t: number;
  v: number;
  ease: Easing;
}

/** Animatable clip properties (visual ones and the volume in dB). */
export type KeyProp =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'hue'
  | 'temperature'
  | 'shake'
  | 'glow'
  | 'rgbSplit'
  | 'motionBlur'
  | 'zoomBlur'
  | 'vignette'
  | 'sharpen'
  | 'grain'
  | 'letterbox'
  | 'volume'
  | 'lowPass';

export interface Clip {
  id: string;
  kind: ClipKind;
  trackId: string;
  name: string;
  /** Timeline position (seconds). */
  start: number;
  /** Timeline length (seconds, after speed). */
  duration: number;
  /** Source media (video/audio/image clips). */
  mediaId?: string;
  /** Source in-point (seconds). */
  in: number;
  /** Playback speed 0.25-4. */
  speed: number;
  /** Keep the audio pitch when the speed changes. */
  keepPitch: boolean;
  /** Audio gain in dB (-60..+12). */
  volume: number;
  /** Seconds (audio: volume ramp, visual: opacity ramp). */
  fadeIn: number;
  fadeOut: number;
  /** Clips with the same linkId move/trim/split together (video + its audio). */
  linkId?: string;
  /** Transition into this clip at its start. */
  transition?: Transition;
  /** Animation out of this clip at its end (the reverse of a transition in). */
  transitionOut?: Transition;
  visual?: VisualProps;
  /** Visual clips: how the picture mixes with what is below (default normal). */
  blend?: BlendMode;
  mask?: ClipMask;
  grade?: ColorGrade;
  /** Audio clips: filters, EQ and reverb. */
  audioFx?: AudioFx;
  title?: TitleStyle;
  /** Caption text. */
  text?: string;
  /** Animated properties. */
  keys?: Partial<Record<KeyProp, Keyframe[]>>;
  /** Speed over time (speed ramp); replaces `speed` while present. */
  speedKeys?: Keyframe[];
  /** Plays the source backwards. */
  reverse?: boolean;
  /** Holds the frame at `in` for the whole clip (freeze frame, silent). */
  freeze?: boolean;
  /** Blends neighbouring source frames in slow motion (export). */
  frameBlend?: boolean;
  /** Video clips: points followed through the picture (motion tracking). */
  tracks?: MotionTrack[];
}

/** A point followed through a video, in source time and as fractions of the source picture. */
export interface MotionTrack {
  id: string;
  name: string;
  /** In source-time order; `s` is how sure the tracker was (0-1, 0 = lost there, a guess). */
  points: { t: number; x: number; y: number; s: number }[];
  /** Size of the followed patch, as fractions of the source picture. */
  w: number;
  h: number;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
}

export interface CaptionStyle {
  font: string;
  /** Font size in project px. */
  size: number;
  weight: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  box: boolean;
  boxColor: string;
  position: 'bottom' | 'top';
  /** Distance from the frame edge, fraction of the height. */
  margin: number;
  /** Max text width, fraction of the frame width. */
  maxWidth: number;
}

export interface Project {
  version: 1;
  name: string;
  settings: ProjectSettings;
  media: MediaRef[];
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  /** In/out work area (export range, loop range). */
  workArea: { start: number; end: number } | null;
  captionStyle: CaptionStyle;
  /** Imported color lookup tables. */
  luts: LutAsset[];
  /** Imported fonts. */
  fonts: FontAsset[];
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}
