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

export interface TransitionFx {
  /** Draw the outgoing clip (when there is an adjacent one). */
  showA: boolean;
  /** Opacity multiplier of the incoming clip. */
  bAlpha: number;
  /** Horizontal offset of the incoming clip, fraction of the frame width. */
  bOffsetX: number;
  bScale: number;
  /** Visible horizontal band of the incoming clip (fractions of the frame width). */
  bClip: { x0: number; x1: number } | null;
  showB: boolean;
  /** Dip color overlay drawn over the visible clip. */
  dip: { color: string; alpha: number } | null;
}

export function transitionFx(kind: TransitionKind, progress: number): TransitionFx {
  const p = clamp01(progress);
  const base: TransitionFx = { showA: true, bAlpha: 1, bOffsetX: 0, bScale: 1, bClip: null, showB: true, dip: null };
  switch (kind) {
    case 'dissolve':
      return { ...base, bAlpha: p };
    case 'dipBlack':
    case 'dipWhite': {
      const color = kind === 'dipBlack' ? '#000000' : '#ffffff';
      return p < 0.5
        ? { ...base, showB: false, dip: { color, alpha: p * 2 } }
        : { ...base, showA: false, dip: { color, alpha: (1 - p) * 2 } };
    }
    case 'wipeLeft':
      return { ...base, bClip: { x0: 1 - p, x1: 1 } };
    case 'wipeRight':
      return { ...base, bClip: { x0: 0, x1: p } };
    case 'slide':
      return { ...base, bOffsetX: 1 - easeInOutCubic(p) };
    case 'zoom': {
      const e = easeOutCubic(p);
      return { ...base, bScale: 0.4 + 0.6 * e, bAlpha: e };
    }
    default:
      return { ...base, showA: false };
  }
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

/* ------------------------------- Pixel effects ------------------------------ */

/** Warm (+) / cool (−) white balance shift, amount −100..100. In place. */
export function applyTemperature(data: Uint8ClampedArray, amount: number): void {
  const k = Math.max(-1, Math.min(1, amount / 100));
  if (!k) return;
  const rm = 1 + 0.22 * k;
  const gm = 1 + 0.04 * k;
  const bm = 1 - 0.22 * k;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] * rm;
    data[i + 1] = data[i + 1] * gm;
    data[i + 2] = data[i + 2] * bm;
  }
}

function cbcr(r: number, g: number, b: number): [number, number] {
  return [(-0.168736 * r - 0.331264 * g + 0.5 * b) / 255, (0.5 * r - 0.418688 * g - 0.081312 * b) / 255];
}

/**
 * Chroma key (green screen): pixels close to `key` in CbCr space become transparent.
 * `similarity` and `smoothness` are 0..1. Edges are de-spilled. In place.
 */
export function applyChromaKey(data: Uint8ClampedArray, key: { r: number; g: number; b: number }, similarity: number, smoothness: number): void {
  const [kcb, kcr] = cbcr(key.r, key.g, key.b);
  const t0 = Math.max(0, similarity) * 0.6;
  const t1 = t0 + Math.max(0.005, smoothness * 0.3);
  const dominant = key.g >= key.r && key.g >= key.b ? 1 : key.b >= key.r ? 2 : 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [pcb, pcr] = cbcr(r, g, b);
    const d = Math.hypot(pcb - kcb, pcr - kcr);
    if (d >= t1 + 0.08) continue;
    let a = 1;
    if (d < t0) a = 0;
    else if (d < t1) {
      const x = (d - t0) / (t1 - t0);
      a = x * x * (3 - 2 * x);
    }
    data[i + 3] = data[i + 3] * a;
    // spill suppression: clamp the key's dominant channel to the other two
    const ch = i + dominant;
    const others = dominant === 0 ? Math.max(g, b) : dominant === 1 ? Math.max(r, b) : Math.max(r, g);
    if (data[ch] > others) data[ch] = others + (data[ch] - others) * Math.max(0, Math.min(1, (d - t0) / (t1 + 0.08 - t0)));
  }
}
