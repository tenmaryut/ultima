/**
 * Video Editor document model. Everything in `Project` is plain JSON (saved in .ultima
 * files and kept in the undo history). Runtime-only data (File objects, object URLs,
 * thumbnails, waveforms) lives in the MediaLibrary, keyed by `MediaRef.id`.
 *
 * Units: times in seconds, positions in project pixels, colors as CSS strings.
 */

export type TrackKind = 'video' | 'audio' | 'caption';
export type ClipKind = 'video' | 'audio' | 'image' | 'title' | 'caption';
export type MediaKind = 'video' | 'audio' | 'image';
export type TransitionKind = 'dissolve' | 'dipBlack' | 'dipWhite' | 'wipeLeft' | 'wipeRight' | 'slide' | 'zoom';
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
  visual?: VisualProps;
  title?: TitleStyle;
  /** Caption text. */
  text?: string;
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
