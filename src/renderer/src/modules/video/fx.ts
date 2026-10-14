import type { TitleAnimation, TransitionKind, VisualProps } from './types';

/* Pure rendering math shared by the preview and the export (unit tested). */

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Opacity / gain multiplier of a clip at `local` seconds into it. */
export function fadeFactor(local: number, duration: number, fadeIn: number, fadeOut: number): number {
  let f = 1;
  if (fadeIn > 0 && local < fadeIn) f = local / fadeIn;
  if (fadeOut > 0 && local > duration - fadeOut) f = Math.min(f, (duration - local) / fadeOut);
  return clamp01(f);
}

export interface ClipLayout {
  /** Center of the (uncropped) media in project px. */
  cx: number;
  cy: number;
  rotation: number;
  /** Drawn (cropped) rectangle relative to the center, before rotation. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** Source rectangle as fractions of the source size. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Where a media of `mediaW × mediaH` lands in the frame for the given transform. */
export function clipLayout(mediaW: number, mediaH: number, frameW: number, frameH: number, v: VisualProps): ClipLayout {
  const mw = Math.max(1, mediaW);
  const mh = Math.max(1, mediaH);
  const fit = Math.min(frameW / mw, frameH / mh);
  const fullW = mw * fit * v.scale;
  const fullH = mh * fit * v.scale;
  const cl = clamp01(v.cropLeft);
  const cr = clamp01(v.cropRight);
  const ct = clamp01(v.cropTop);
  const cb = clamp01(v.cropBottom);
  const sw = Math.max(0.01, 1 - cl - cr);
  const sh = Math.max(0.01, 1 - ct - cb);
  return {
    cx: frameW / 2 + v.x,
    cy: frameH / 2 + v.y,
    rotation: v.rotation,
    dx: -fullW / 2 + cl * fullW,
    dy: -fullH / 2 + ct * fullH,
    dw: fullW * sw,
    dh: fullH * sh,
    sx: cl,
    sy: ct,
    sw,
    sh,
  };
}

/** Corners of a layout in frame coordinates (for hit testing and selection outlines). */
export function layoutCorners(l: ClipLayout): { x: number; y: number }[] {
  const rad = (l.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [l.dx, l.dy],
    [l.dx + l.dw, l.dy],
    [l.dx + l.dw, l.dy + l.dh],
    [l.dx, l.dy + l.dh],
  ].map(([x, y]) => ({ x: l.cx + x * cos - y * sin, y: l.cy + x * sin + y * cos }));
}

/** True when the point lies inside the (rotated) drawn rectangle. */
export function hitLayout(l: ClipLayout, px: number, py: number): boolean {
  const rad = (-l.rotation * Math.PI) / 180;
  const x = px - l.cx;
  const y = py - l.cy;
  const lx = x * Math.cos(rad) - y * Math.sin(rad);
  const ly = x * Math.sin(rad) + y * Math.cos(rad);
  return lx >= l.dx && lx <= l.dx + l.dw && ly >= l.dy && ly <= l.dy + l.dh;
}

/** How a transition (or a clip effect) changes the drawing of one clip. */
export interface Mods {
  /** Opacity multiplier. */
  alpha: number;
  /** Offset in fractions of the frame. */
  dx: number;
  dy: number;
  /** Scale and rotation (degrees) around the frame center. */
  scale: number;
  rotation: number;
  /** Visible horizontal band of the frame (wipes), fractions of the width. */
  band: { x0: number; x1: number } | null;
  /** Motion blur streak in fractions of the frame (whip pans). */
  blurX: number;
  blurY: number;
  /** Zoom blur 0-1. */
  zoomBlur: number;
  /** Extra blur in project px. */
  blur: number;
  /** Extra RGB split in project px. */
  rgbSplit: number;
  /** Glitch slices 0-1. */
  glitch: number;
  /** Luma fade: visible only where brighter than `threshold`. */
  luma: { threshold: number; softness: number } | null;
  /** Varies glitch patterns over time. */
  seed: number;
}

export const NO_MODS: Mods = { alpha: 1, dx: 0, dy: 0, scale: 1, rotation: 0, band: null, blurX: 0, blurY: 0, zoomBlur: 0, blur: 0, rgbSplit: 0, glitch: 0, luma: null, seed: 0 };

export interface TransitionFx {
  /** Draw the outgoing clip A (when there is an adjacent one) and the incoming clip B. */
  showA: boolean;
  showB: boolean;
  a: Mods;
  b: Mods;
  /** Dip color drawn over this track's pictures. */
  dip: { color: string; alpha: number } | null;
}

const mods = (patch: Partial<Mods>): Mods => ({ ...NO_MODS, ...patch });
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const easeIn = (t: number) => t * t * t;
/** Speed of easeInOutCubic (0 at the ends, 1.5 in the middle). */
const easeSpeed = (t: number) => (t < 0.5 ? 12 * t * t : 3 * Math.pow(-2 * t + 2, 2) / 2);

/** What a transition does at `progress` (0 = only the outgoing clip, 1 = only the incoming one). */
export function transitionFx(kind: TransitionKind, progress: number): TransitionFx {
  const p = clamp01(progress);
  const base: TransitionFx = { showA: true, showB: true, a: NO_MODS, b: NO_MODS, dip: null };
  switch (kind) {
    case 'dissolve':
      return { ...base, b: mods({ alpha: p }) };
    case 'dipBlack':
    case 'dipWhite': {
      const color = kind === 'dipBlack' ? '#000000' : '#ffffff';
      return p < 0.5 ? { ...base, showB: false, dip: { color, alpha: p * 2 } } : { ...base, showA: false, dip: { color, alpha: (1 - p) * 2 } };
    }
    case 'flash': {
      // white builds up just before the cut and fades out quickly after it
      const x = p < 0.5 ? p * 2 : (1 - p) * 2;
      return p < 0.5 ? { ...base, showB: false, dip: { color: '#ffffff', alpha: x * x } } : { ...base, showA: false, dip: { color: '#ffffff', alpha: x * x * x } };
    }
    case 'wipeLeft':
      return { ...base, b: mods({ band: { x0: 1 - p, x1: 1 } }) };
    case 'wipeRight':
      return { ...base, b: mods({ band: { x0: 0, x1: p } }) };
    case 'slide':
      return { ...base, b: mods({ dx: 1 - easeInOutCubic(p) }) };
    case 'zoom': {
      const e = easeOutCubic(p);
      return { ...base, b: mods({ scale: 0.4 + 0.6 * e, alpha: e }) };
    }
    case 'whipLeft':
    case 'whipRight': {
      // both pictures fly past with a motion streak that is longest in the middle
      const dir = kind === 'whipLeft' ? -1 : 1;
      const e = easeInOutCubic(p);
      const streak = 0.22 * (easeSpeed(p) / 1.5);
      return { ...base, a: mods({ dx: dir * e, blurX: streak }), b: mods({ dx: dir * (e - 1), blurX: streak }) };
    }
    case 'spin': {
      const e = easeInOutCubic(p);
      const zoom = 0.45 * (easeSpeed(p) / 1.5);
      return {
        ...base,
        showA: p < 0.6,
        showB: p > 0.4,
        a: mods({ rotation: e * 180, scale: 1 + e * 0.6, alpha: 1 - smoothstep(0.4, 0.6, p), zoomBlur: zoom }),
        b: mods({ rotation: (e - 1) * 180, scale: 1.6 - 0.6 * e, alpha: smoothstep(0.4, 0.6, p), zoomBlur: zoom }),
      };
    }
    case 'zoomBlur': {
      if (p < 0.5) {
        const x = easeIn(p * 2);
        return { ...base, showB: false, a: mods({ scale: 1 + 0.5 * x, zoomBlur: 0.9 * x }) };
      }
      const x = easeOutCubic((p - 0.5) * 2);
      return { ...base, showA: false, b: mods({ scale: 1.5 - 0.5 * x, zoomBlur: 0.9 * (1 - x) }) };
    }
    case 'glitch': {
      // strongest at the cut; the pattern changes 24 times per transition
      const g = 1 - Math.abs(2 * p - 1);
      const seed = Math.floor(p * 24);
      const m = mods({ glitch: g, rgbSplit: 24 * g, seed });
      return p < 0.5 ? { ...base, showB: false, a: m } : { ...base, showA: false, b: m };
    }
    case 'lumaFade':
      // the brightest parts of the incoming picture appear first
      return { ...base, b: mods({ luma: { threshold: 1.1 - 1.2 * p, softness: 0.1 } }) };
    case 'blurDissolve':
      return { ...base, a: mods({ blur: 40 * p }), b: mods({ blur: 40 * (1 - p), alpha: p }) };
    default:
      return { ...base, showA: false };
  }
}

/** Bar height (fraction of the frame height, per side) that letterboxes a W×H frame to `ratio` (width / height). */
export function letterboxBars(ratio: number, W: number, H: number): number {
  if (!(ratio > 0) || ratio <= W / H) return 0;
  return Math.min(0.3, (1 - W / H / ratio) / 2);
}

/** Repeatable pseudo-random numbers 0-1 for a seed (glitch slices, shake phases). */
export function seeded(seed: number): () => number {
  let s = (Math.floor(seed) * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** A number from a string (to give every clip its own shake). */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Camera shake at `t` seconds: smooth, repeatable offsets in px (up to about `amount`) and a small
 * rotation in degrees. `speed` is roughly the number of shakes per second.
 */
export function shakeAt(t: number, amount: number, speed: number, seed: number): { x: number; y: number; rotation: number } {
  if (amount <= 0) return { x: 0, y: 0, rotation: 0 };
  const r = seeded(seed);
  const phase = () => r() * Math.PI * 2;
  const w = Math.PI * 2 * Math.max(0.1, speed);
  const p1 = phase();
  const p2 = phase();
  const p3 = phase();
  const p4 = phase();
  const p5 = phase();
  const x = amount * (0.62 * Math.sin(w * t + p1) + 0.38 * Math.sin(w * 2.31 * t + p2));
  const y = amount * (0.62 * Math.sin(w * 1.13 * t + p3) + 0.38 * Math.sin(w * 2.67 * t + p4));
  const rotation = Math.min(4, amount / 30) * Math.sin(w * 0.87 * t + p5);
  return { x, y, rotation };
}

/** Horizontal glitch slices: bands (fractions of the height) and their sideways shift (fractions of the width). */
export function glitchSlices(amount: number, seed: number): { y0: number; y1: number; shift: number }[] {
  if (amount <= 0) return [];
  const r = seeded(seed + 7919);
  const out: { y0: number; y1: number; shift: number }[] = [];
  let y = 0;
  while (y < 1) {
    const h = 0.02 + r() * 0.12;
    const y1 = Math.min(1, y + h);
    // most bands stay, some jump sideways
    const shift = r() < 0.45 * amount + 0.1 ? (r() - 0.5) * 0.16 * amount : 0;
    out.push({ y0: y, y1, shift });
    y = y1;
  }
  return out;
}

export interface TitleAnimState {
  alpha: number;
  /** Vertical offset as a fraction of the frame height. */
  dy: number;
  scale: number;
  /** Fraction of characters shown (typewriter). */
  reveal: number;
}

export function titleAnimState(anim: TitleAnimation, local: number, duration: number, animDuration: number): TitleAnimState {
  const d = Math.max(0.01, animDuration);
  const tin = clamp01(local / d);
  const tout = clamp01((duration - local) / d);
  switch (anim) {
    case 'fade':
      return { alpha: Math.min(easeOutCubic(tin), easeOutCubic(tout)), dy: 0, scale: 1, reveal: 1 };
    case 'slideUp':
      return { alpha: Math.min(tin, tout), dy: (1 - easeOutCubic(tin)) * 0.05, scale: 1, reveal: 1 };
    case 'pop':
      return { alpha: Math.min(clamp01(tin * 2.5), tout), dy: 0, scale: tin < 1 ? Math.max(0.05, easeOutBack(tin)) : 1, reveal: 1 };
    case 'typewriter':
      return { alpha: clamp01((duration - local) / 0.25), dy: 0, scale: 1, reveal: tin };
    default:
      return { alpha: 1, dy: 0, scale: 1, reveal: 1 };
  }
}
