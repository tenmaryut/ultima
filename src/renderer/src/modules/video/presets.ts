import type { CaptionStyle, ProjectSettings, TitleAnimation, TitleStyle, TransitionKind, VisualProps } from './types';

/** Pure defaults and preset tables (no DOM). */

export const RESOLUTION_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: '1080p', label: '1080p (1920×1080)', width: 1920, height: 1080 },
  { id: '720p', label: '720p (1280×720)', width: 1280, height: 720 },
  { id: '4k', label: '4K UHD (3840×2160)', width: 3840, height: 2160 },
  { id: 'vertical', label: 'Vertical 9:16 (1080×1920)', width: 1080, height: 1920 },
  { id: 'square', label: 'Square 1:1 (1080×1080)', width: 1080, height: 1080 },
];

export const FPS_OPTIONS = [24, 25, 30, 50, 60];

export const DEFAULT_SETTINGS: ProjectSettings = { width: 1920, height: 1080, fps: 30, background: '#000000' };

export function presetIdFor(width: number, height: number): string {
  return RESOLUTION_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? 'custom';
}

export const DEFAULT_VISUAL: VisualProps = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  temperature: 0,
  blur: 0,
  chromaKey: false,
  chromaColor: '#00ff00',
  chromaSimilarity: 0.3,
  chromaSmoothness: 0.1,
};

export const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: 'dissolve', label: 'Cross dissolve' },
  { kind: 'dipBlack', label: 'Dip to black' },
  { kind: 'dipWhite', label: 'Dip to white' },
  { kind: 'wipeLeft', label: 'Wipe left' },
  { kind: 'wipeRight', label: 'Wipe right' },
  { kind: 'slide', label: 'Slide' },
  { kind: 'zoom', label: 'Zoom' },
];

export const TRANSITION_KINDS = TRANSITIONS.map((t) => t.kind);

export const TITLE_ANIMATIONS: { id: TitleAnimation; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slideUp', label: 'Slide up' },
  { id: 'pop', label: 'Pop' },
  { id: 'typewriter', label: 'Typewriter' },
];

export function defaultTitle(frameHeight: number): TitleStyle {
  return {
    text: 'Your title',
    subtitle: '',
    font: 'Inter',
    size: Math.round(frameHeight * 0.085),
    weight: 700,
    italic: false,
    color: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 0,
    box: false,
    boxColor: 'rgba(0, 0, 0, 0.6)',
    shadow: true,
    align: 'center',
    x: 0.5,
    y: 0.5,
    animation: 'fade',
    animDuration: 0.5,
  };
}

export type TitlePresetId = 'basic' | 'lowerThird' | 'big' | 'subtitle' | 'typewriter' | 'pop' | 'endCard';

export const TITLE_PRESETS: { id: TitlePresetId; label: string; description: string }[] = [
  { id: 'basic', label: 'Basic title', description: 'Centered, fades in and out' },
  { id: 'lowerThird', label: 'Lower third', description: 'Name and role, bottom left' },
  { id: 'big', label: 'Big bold', description: 'Large text that pops in' },
  { id: 'subtitle', label: 'Bottom text', description: 'Text with a box near the bottom' },
  { id: 'typewriter', label: 'Typewriter', description: 'Types itself letter by letter' },
  { id: 'pop', label: 'Pop label', description: 'Boxed label that bounces in' },
  { id: 'endCard', label: 'End card', description: 'Thanks for watching' },
];

/** Builds a title style from a preset for a frame of the given size. */
export function titlePreset(id: TitlePresetId | string, width: number, height: number): TitleStyle {
  const base = defaultTitle(height);
  const s = height / 1080;
  switch (id) {
    case 'lowerThird':
      return {
        ...base,
        text: 'Your Name',
        subtitle: 'Title or role',
        size: Math.round(56 * s),
        align: 'left',
        x: width > height ? 0.07 : 0.08,
        y: 0.8,
        box: true,
        boxColor: 'rgba(17, 18, 22, 0.78)',
        shadow: false,
        animation: 'slideUp',
        animDuration: 0.45,
      };
    case 'big':
      return { ...base, text: 'BIG NEWS', size: Math.round(150 * s), weight: 900, outlineWidth: Math.round(6 * s), animation: 'pop', animDuration: 0.4 };
    case 'subtitle':
      return { ...base, text: 'Text near the bottom', size: Math.round(52 * s), weight: 600, y: 0.86, box: true, shadow: false, animation: 'fade', animDuration: 0.3 };
    case 'typewriter':
      return { ...base, text: 'Typing this out…', font: 'Courier New', size: Math.round(72 * s), weight: 700, animation: 'typewriter', animDuration: 1.5 };
    case 'pop':
      return {
        ...base,
        text: 'NEW!',
        size: Math.round(80 * s),
        weight: 800,
        color: '#111216',
        box: true,
        boxColor: '#ffd43b',
        shadow: false,
        x: 0.78,
        y: 0.2,
        animation: 'pop',
        animDuration: 0.35,
      };
    case 'endCard':
      return { ...base, text: 'Thanks for watching', subtitle: 'Subscribe for more', size: Math.round(96 * s), animation: 'fade', animDuration: 0.8 };
    default:
      return base;
  }
}

export function defaultCaptionStyle(frameHeight: number): CaptionStyle {
  return {
    font: 'Inter',
    size: Math.max(12, Math.round(frameHeight * 0.045)),
    weight: 600,
    color: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 0,
    box: true,
    boxColor: 'rgba(0, 0, 0, 0.65)',
    position: 'bottom',
    margin: 0.07,
    maxWidth: 0.84,
  };
}

/** Default length of still images and titles dropped on the timeline. */
export const DEFAULT_STILL_DURATION = 5;
export const DEFAULT_TITLE_DURATION = 4;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const MIN_VOLUME_DB = -60;
export const MAX_VOLUME_DB = 12;
