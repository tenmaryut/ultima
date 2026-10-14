import type { BlendMode, Clip, ClipMask, MediaRef, Project, TransitionKind, VisualProps } from './types';
import { DEFAULT_VISUAL } from './presets';
import { clipLayout, fadeFactor, glitchSlices, hashString, NO_MODS, shakeAt, transitionFx, type ClipLayout, type Mods } from './fx';
import { drawCaption, drawTitle } from './text';
import { clipEnd, getMedia, tracksOfKind } from './model';
import { animatedVisual, sourceAt } from './keyframes';
import { bakeGrade, gradeActive } from './grade';
import { PixelStage, pixelWork, type PixelParams } from './pixelfx';
import { EPS } from './time';
import { parseColor } from '../../core/utils/color';

/**
 * Draws one frame of the timeline. The preview and the export call the same code — only
 * the frame provider differs (<video> elements vs. frame-accurate mediabunny decoding).
 */

export interface FrameProvider {
  /** Current picture of a video clip at `sourceTime`, or null when not available yet. */
  video(clip: Clip, sourceTime: number): CanvasImageSource | null;
  /** Decoded still image. */
  image(mediaId: string): CanvasImageSource | null;
}

export interface RenderOptions {
  /** Canvas pixels per project pixel. */
  scale: number;
  /** Draw captions from visible caption tracks. */
  captions: boolean;
  /** Mark clips whose media is missing (preview only). */
  isOffline?: (mediaId: string) => boolean;
  /** Text drawn on missing media (translated). */
  offlineLabel?: string;
}

export interface Layer {
  trackId: string;
  clip: Clip;
  /** Transition progress 0..1 while inside the clip's transition, otherwise null. */
  progress: number | null;
  /** Adjacent clip that the transition comes from. */
  outgoing: Clip | null;
}

const isVisual = (c: Clip) => c.kind === 'video' || c.kind === 'image' || c.kind === 'title' || c.kind === 'adjustment';
const hasPicture = (c: Clip) => c.kind === 'video' || c.kind === 'image' || c.kind === 'title';

/** Visual layers at time t, bottom track first. */
export function visualLayers(p: Project, t: number): Layer[] {
  const out: Layer[] = [];
  const halfFrame = 0.5 / p.settings.fps;
  for (const track of tracksOfKind(p, 'video')) {
    if (track.hidden) continue;
    let clip: Clip | null = null;
    for (const c of p.clips) {
      if (c.trackId === track.id && isVisual(c) && c.start <= t + EPS && t < clipEnd(c) - EPS && (!clip || c.start > clip.start)) clip = c;
    }
    if (!clip) continue;
    let progress: number | null = null;
    let outgoing: Clip | null = null;
    const tr = clip.transition;
    if (tr && tr.duration > 0 && t < clip.start + tr.duration && hasPicture(clip)) {
      progress = Math.max(0, Math.min(1, (t - clip.start) / tr.duration));
      for (const c of p.clips) {
        if (c !== clip && c.trackId === track.id && hasPicture(c) && Math.abs(clipEnd(c) - clip.start) <= halfFrame + EPS) outgoing = c;
      }
    }
    out.push({ trackId: track.id, clip, progress, outgoing });
  }
  return out;
}

/** Source time of a clip at timeline time t (speed ramps, reverse and freeze included; clamped to the media length). */
export function sourceTimeAt(clip: Clip, t: number, media?: MediaRef): number {
  const st = sourceAt(clip, t - clip.start);
  if (media && media.duration > 0) return Math.max(0, Math.min(st, media.duration - 0.001));
  return Math.max(0, st);
}

export interface FrameNeed {
  clip: Clip;
  sourceTime: number;
}

/** Video frames a timeline frame needs (incl. transition sources), in drawing order. */
export function frameNeeds(p: Project, t: number): FrameNeed[] {
  const needs: FrameNeed[] = [];
  for (const layer of visualLayers(p, t)) {
    let showA = true;
    let showB = true;
    if (layer.progress !== null && layer.clip.transition) {
      const fx = transitionFx(layer.clip.transition.kind, layer.progress);
      showA = fx.showA;
      showB = fx.showB;
    }
    if (layer.outgoing && showA && layer.outgoing.kind === 'video') {
      needs.push({ clip: layer.outgoing, sourceTime: sourceTimeAt(layer.outgoing, t, getMedia(p, layer.outgoing.mediaId)) });
    }
    if (showB && layer.clip.kind === 'video') needs.push({ clip: layer.clip, sourceTime: sourceTimeAt(layer.clip, t, getMedia(p, layer.clip.mediaId)) });
  }
  return needs;
}

export function cssFilter(v: VisualProps, scale: number, extraBlur = 0): string {
  const parts: string[] = [];
  if (v.brightness) parts.push(`brightness(${(1 + v.brightness / 100).toFixed(3)})`);
  if (v.contrast) parts.push(`contrast(${(1 + v.contrast / 100).toFixed(3)})`);
  if (v.saturation) parts.push(`saturate(${(1 + v.saturation / 100).toFixed(3)})`);
  if (v.hue) parts.push(`hue-rotate(${v.hue.toFixed(1)}deg)`);
  const blur = v.blur + extraBlur;
  if (blur > 0) parts.push(`blur(${(blur * scale).toFixed(2)}px)`);
  return parts.join(' ');
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return { w: src.displayWidth, h: src.displayHeight };
  const s = src as { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  return { w: typeof s.width === 'number' ? s.width : 0, h: typeof s.height === 'number' ? s.height : 0 };
}

export const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  colorDodge: 'color-dodge',
  colorBurn: 'color-burn',
  hardLight: 'hard-light',
  softLight: 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  add: 'lighter',
};

/** Two sets of drawing modifiers on top of each other (a transition and an out-animation). */
export function combineMods(a: Mods, b: Mods): Mods {
  if (a === NO_MODS) return b;
  if (b === NO_MODS) return a;
  let band = a.band ?? b.band;
  if (a.band && b.band) band = { x0: Math.max(a.band.x0, b.band.x0), x1: Math.min(a.band.x1, b.band.x1) };
  return {
    alpha: a.alpha * b.alpha,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
    band,
    blurX: a.blurX + b.blurX,
    blurY: a.blurY + b.blurY,
    zoomBlur: a.zoomBlur + b.zoomBlur,
    blur: a.blur + b.blur,
    rgbSplit: a.rgbSplit + b.rgbSplit,
    glitch: Math.max(a.glitch, b.glitch),
    luma: b.luma ?? a.luma,
    seed: a.seed + b.seed,
  };
}

type Ctx2D = CanvasRenderingContext2D;

/** Out-animations that move like the outgoing clip of a transition. */
const OUT_AS_OUTGOING: readonly TransitionKind[] = ['whipLeft', 'whipRight', 'spin', 'zoomBlur', 'glitch'];

/** A picture to draw: a source cut-out placed by a layout (project px around the clip center). */
interface Picture {
  src: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  L: ClipLayout;
}

/** Layout of a frame-sized picture (adjustment layers, titles drawn into a layer). */
function frameLayout(W: number, H: number): ClipLayout {
  return { cx: W / 2, cy: H / 2, rotation: 0, dx: -W / 2, dy: -H / 2, dw: W, dh: H, sx: 0, sy: 0, sw: 1, sh: 1 };
}

/** True when a clip's effects need its picture drawn into its own layer first. */
function titleNeedsLayer(clip: Clip, v: VisualProps, m: Mods): boolean {
  return Boolean(
    clip.mask || clip.grade || v.glow > 0 || v.rgbSplit > 0 || v.motionBlur > 0 || v.zoomBlur > 0 || v.vignette > 0 || v.sharpen > 0 || v.grain > 0 || v.temperature || m.blurX || m.blurY || m.zoomBlur > 0 || m.rgbSplit > 0 || m.glitch > 0 || m.luma,
  );
}

export class Compositor {
  private pool = new Map<string, HTMLCanvasElement>();
  private stage = new PixelStage();

  /** A reusable canvas of the given size, cleared, with an identity transform. */
  private layer(name: string, w: number, h: number): Ctx2D {
    let c = this.pool.get(name);
    if (!c) {
      c = document.createElement('canvas');
      this.pool.set(name, c);
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  render(ctx: Ctx2D, p: Project, t: number, provider: FrameProvider, opts: RenderOptions): void {
    const canvas = ctx.canvas;
    const s = opts.scale;
    const frame = Math.floor(t * p.settings.fps + 1e-6);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = p.settings.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    for (const layer of visualLayers(p, t)) {
      if (layer.clip.kind === 'adjustment') {
        this.drawAdjustment(ctx, p, layer.clip, t, opts, frame);
        continue;
      }
      if (layer.progress === null || !layer.clip.transition) {
        this.drawClip(ctx, p, layer.clip, t, provider, opts, NO_MODS, frame);
        continue;
      }
      const fx = transitionFx(layer.clip.transition.kind, layer.progress);
      if (fx.dip) {
        // isolate the track so the dip color only covers this track's pictures
        const lctx = this.layer('dip', canvas.width, canvas.height);
        lctx.setTransform(s, 0, 0, s, 0, 0);
        if (fx.showA && layer.outgoing) this.drawClip(lctx, p, layer.outgoing, t, provider, opts, fx.a, frame);
        if (fx.showB) this.drawClip(lctx, p, layer.clip, t, provider, opts, fx.b, frame);
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalCompositeOperation = 'source-atop';
        lctx.globalAlpha = fx.dip.alpha;
        lctx.fillStyle = fx.dip.color;
        lctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(lctx.canvas, 0, 0);
        ctx.restore();
      } else {
        if (fx.showA && layer.outgoing) this.drawClip(ctx, p, layer.outgoing, t, provider, opts, fx.a, frame);
        if (fx.showB) this.drawClip(ctx, p, layer.clip, t, provider, opts, fx.b, frame);
      }
    }
    if (opts.captions) this.drawCaptions(ctx, p, t);
    ctx.restore();
  }

  private drawCaptions(ctx: Ctx2D, p: Project, t: number) {
    const tracks = tracksOfKind(p, 'caption').filter((tr) => !tr.hidden).reverse();
    for (const track of tracks) {
      const cap = p.clips.find((c) => c.trackId === track.id && c.kind === 'caption' && c.start <= t + EPS && t < clipEnd(c) - EPS);
      if (cap?.text) {
        drawCaption(ctx, cap.text, p.captionStyle, p.settings.width, p.settings.height);
        return;
      }
    }
  }

  /** The clip's animated look at `t`, its out-animation and its opacity (null when invisible). */
  private state(clip: Clip, t: number, mods: Mods): { v: VisualProps; m: Mods; alpha: number; dip: { color: string; alpha: number } | null; local: number } | null {
    const local = Math.min(Math.max(0, t - clip.start), clip.duration);
    const v = clip.visual ? animatedVisual(clip, local) : DEFAULT_VISUAL;
    let m = mods;
    let dip: { color: string; alpha: number } | null = null;
    const out = clip.transitionOut;
    if (out && out.duration > 0 && local > clip.duration - out.duration) {
      const left = Math.max(0, (clip.duration - local) / out.duration);
      if (OUT_AS_OUTGOING.includes(out.kind)) {
        // moves away the way an outgoing clip does (a whip pan out to the left goes left)
        const fx = transitionFx(out.kind, 1 - left);
        if (!fx.showA) return null;
        m = combineMods(m, fx.a);
      } else {
        // the transition in, played backwards
        const fx = transitionFx(out.kind, left);
        if (!fx.showB) return null;
        m = combineMods(m, fx.b);
        dip = fx.dip;
      }
    }
    const alpha = v.opacity * fadeFactor(local, clip.duration, clip.fadeIn, clip.fadeOut) * m.alpha;
    if (alpha <= 0.002) return null;
    return { v, m, alpha, dip, local };
  }

  private drawClip(ctx: Ctx2D, p: Project, clip: Clip, t: number, provider: FrameProvider, opts: RenderOptions, mods: Mods, frame: number) {
    const { width: W, height: H } = p.settings;
    const st = this.state(clip, t, mods);
    if (!st) return;
    const { v, m } = st;
    if (clip.kind === 'title') {
      if (!clip.title) return;
      const drawText = (c: Ctx2D) => {
        c.translate(W / 2 + v.x, H / 2 + v.y);
        c.rotate((v.rotation * Math.PI) / 180);
        c.scale(v.scale, v.scale);
        c.translate(-W / 2, -H / 2);
        drawTitle(c, clip.title!, t - clip.start, clip.duration, W, H);
      };
      if (titleNeedsLayer(clip, v, m) || st.dip) {
        // effects work on pictures: draw the title into a frame-sized layer first
        const tctx = this.layer('title', ctx.canvas.width, ctx.canvas.height);
        tctx.setTransform(opts.scale, 0, 0, opts.scale, 0, 0);
        drawText(tctx);
        const pic: Picture = { src: tctx.canvas, sx: 0, sy: 0, sw: tctx.canvas.width, sh: tctx.canvas.height, L: frameLayout(W, H) };
        this.drawPicture(ctx, p, clip, pic, st, opts, frame, true);
        return;
      }
      ctx.save();
      ctx.globalAlpha = st.alpha;
      if (clip.blend && clip.blend !== 'normal') ctx.globalCompositeOperation = COMPOSITE[clip.blend];
      this.frameMods(ctx, m, W, H);
      const shake = shakeAt(t, v.shake, v.shakeSpeed, hashString(clip.id));
      if (shake.x || shake.y || shake.rotation) {
        ctx.translate(W / 2 + shake.x, H / 2 + shake.y);
        ctx.rotate((shake.rotation * Math.PI) / 180);
        ctx.translate(-W / 2, -H / 2);
      }
      const filter = cssFilter(v, opts.scale, m.blur);
      if (filter) ctx.filter = filter;
      drawText(ctx);
      ctx.restore();
      this.drawLetterbox(ctx, v, st.alpha, W, H);
      return;
    }
    const media = getMedia(p, clip.mediaId);
    const src = clip.kind === 'video' ? provider.video(clip, sourceTimeAt(clip, t, media)) : provider.image(clip.mediaId ?? '');
    const size = src ? sourceSize(src) : { w: 0, h: 0 };
    const mw = media?.width || size.w || W;
    const mh = media?.height || size.h || H;
    const L = clipLayout(mw, mh, W, H, v);
    if (!src || !size.w || !size.h) {
      if (clip.mediaId && opts.isOffline?.(clip.mediaId)) {
        ctx.save();
        this.frameMods(ctx, m, W, H);
        ctx.translate(L.cx, L.cy);
        ctx.rotate((L.rotation * Math.PI) / 180);
        this.drawOffline(ctx, L.dx, L.dy, L.dw, L.dh, opts.offlineLabel ?? 'Media offline');
        ctx.restore();
      }
      return;
    }
    const pic: Picture = { src, sx: L.sx * size.w, sy: L.sy * size.h, sw: L.sw * size.w, sh: L.sh * size.h, L };
    this.drawPicture(ctx, p, clip, pic, st, opts, frame, false);
  }

  /** Applies an adjustment layer to everything drawn so far. */
  private drawAdjustment(ctx: Ctx2D, p: Project, clip: Clip, t: number, opts: RenderOptions, frame: number) {
    const { width: W, height: H } = p.settings;
    const st = this.state(clip, t, NO_MODS);
    if (!st) return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const snap = this.layer('adjustment', cw, ch);
    snap.drawImage(ctx.canvas, 0, 0);
    // the frame below is the picture; position, scale and rotation move the whole frame
    const pic: Picture = { src: snap.canvas, sx: 0, sy: 0, sw: cw, sh: ch, L: clipLayout(W, H, W, H, st.v) };
    pic.sx = pic.L.sx * cw;
    pic.sy = pic.L.sy * ch;
    pic.sw = pic.L.sw * cw;
    pic.sh = pic.L.sh * ch;
    this.drawPicture(ctx, p, clip, pic, st, opts, frame, false);
  }

  /** Frame-space modifiers of transitions: the visible band, offset, scale and rotation. */
  private frameMods(c: Ctx2D, m: Mods, W: number, H: number) {
    if (m.band) {
      c.beginPath();
      c.rect(m.band.x0 * W, 0, (m.band.x1 - m.band.x0) * W, H);
      c.clip();
    }
    if (m.dx || m.dy || m.scale !== 1 || m.rotation) {
      c.translate(W / 2 + m.dx * W, H / 2 + m.dy * H);
      if (m.rotation) c.rotate((m.rotation * Math.PI) / 180);
      c.scale(m.scale, m.scale);
      c.translate(-W / 2, -H / 2);
    }
  }

  /** Draws a picture with all of the clip's effects (pixel effects, blur, glow, mask, blend). */
  private drawPicture(
    ctx: Ctx2D,
    p: Project,
    clip: Clip,
    pic: Picture,
    st: { v: VisualProps; m: Mods; alpha: number; dip: { color: string; alpha: number } | null },
    opts: RenderOptions,
    frame: number,
    frameSized: boolean,
  ) {
    const { width: W, height: H } = p.settings;
    const s = opts.scale;
    const { v, m } = st;
    const L = pic.L;
    const t = frame / p.settings.fps;
    // camera shake moves the picture and zooms in a little so its edges stay hidden
    const shake = shakeAt(t, v.shake, v.shakeSpeed, hashString(clip.id));
    const shakeZoom = v.shake > 0 ? 1 + (2 * v.shake) / Math.min(W, H) : 1;
    const place = (c: Ctx2D) => {
      this.frameMods(c, m, W, H);
      c.translate(L.cx + shake.x, L.cy + shake.y);
      c.rotate(((L.rotation + shake.rotation) * Math.PI) / 180);
      if (shakeZoom !== 1) c.scale(shakeZoom, shakeZoom);
    };

    // 1. per-pixel effects at the size the picture is drawn
    const split = v.rgbSplit + m.rgbSplit;
    const grade = clip.grade && gradeActive(clip.grade, p.luts) ? bakeGrade(clip.grade, p.luts) : null;
    const key = v.chromaKey ? parseColor(v.chromaColor) ?? { r: 0, g: 255, b: 0, a: 1 } : null;
    const px: PixelParams = {
      lut: grade,
      temperature: v.temperature,
      sharpen: v.sharpen,
      split: split > 0 ? { x: split * s, y: 0 } : null,
      grain: v.grain,
      seed: frame,
      vignette: v.vignette,
      chroma: key ? { r: key.r, g: key.g, b: key.b, similarity: v.chromaSimilarity, smoothness: v.chromaSmoothness } : null,
      luma: m.luma,
    };
    let src = pic.src;
    let sx = pic.sx;
    let sy = pic.sy;
    let sw = pic.sw;
    let sh = pic.sh;
    if (pixelWork(px)) {
      const ow = Math.abs(L.dw) * s * m.scale * shakeZoom;
      const oh = Math.abs(L.dh) * s * m.scale * shakeZoom;
      // frame-sized pictures keep their resolution
      const out = this.stage.run(src, sx, sy, sw, sh, frameSized ? sw : ow, frameSized ? sh : oh, px);
      src = out;
      sx = 0;
      sy = 0;
      sw = out.width;
      sh = out.height;
    }

    // 2. what has to be drawn more than once
    const angle = (v.motionBlurAngle * Math.PI) / 180;
    const streakX = v.motionBlur * Math.cos(angle) + m.blurX * W;
    const streakY = v.motionBlur * Math.sin(angle) + m.blurY * H;
    const streak = Math.hypot(streakX, streakY) * s;
    const zoom = v.zoomBlur + m.zoomBlur;
    const glow = v.glow;
    const multi = streak > 1.5 || zoom > 0.01;
    const useLayer = Boolean(clip.mask || st.dip || multi || glow > 0.004);
    const filter = cssFilter(v, s, m.blur);
    const slices = m.glitch > 0 ? glitchSlices(m.glitch, m.seed + frame) : [];

    const drawOnce = (c: Ctx2D, alpha: number, extra?: (c: Ctx2D) => void) => {
      c.save();
      c.globalAlpha = alpha;
      place(c);
      extra?.(c);
      if (filter) c.filter = filter;
      if (slices.length) {
        for (const sl of slices) {
          c.drawImage(src, sx, sy + sl.y0 * sh, sw, (sl.y1 - sl.y0) * sh, L.dx + sl.shift * W, L.dy + sl.y0 * L.dh, L.dw, (sl.y1 - sl.y0) * L.dh);
        }
      } else c.drawImage(src, sx, sy, sw, sh, L.dx, L.dy, L.dw, L.dh);
      c.restore();
    };

    const target = useLayer ? this.layer('clip', ctx.canvas.width, ctx.canvas.height) : ctx;
    if (useLayer) target.setTransform(s, 0, 0, s, 0, 0);
    else {
      ctx.save();
      if (clip.blend && clip.blend !== 'normal') ctx.globalCompositeOperation = COMPOSITE[clip.blend];
    }
    const baseAlpha = useLayer ? 1 : st.alpha;
    if (multi) {
      // running average of shifted / zoomed copies, the sharp copy first and the farthest last
      const n = Math.max(5, Math.min(25, Math.ceil(Math.max(streak / 3, zoom * 24)) | 1));
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
      order.forEach((i, k) => {
        const f = i / (n - 1) - 0.5;
        const z = zoom > 0 ? 1 + zoom * 0.3 * (k / (n - 1)) : 1;
        drawOnce(target, baseAlpha / (k + 1), (c) => {
          if (streak > 1.5) {
            // the streak runs along the frame, whatever the clip's rotation
            c.rotate(-((L.rotation + shake.rotation) * Math.PI) / 180);
            c.translate((streakX * f) / shakeZoom, (streakY * f) / shakeZoom);
            c.rotate(((L.rotation + shake.rotation) * Math.PI) / 180);
          }
          if (z !== 1) {
            const cx = L.dx + L.dw / 2;
            const cy = L.dy + L.dh / 2;
            c.translate(cx, cy);
            c.scale(z, z);
            c.translate(-cx, -cy);
          }
        });
      });
    } else drawOnce(target, baseAlpha);

    if (glow > 0.004) {
      // bright parts, blurred and screened on top
      target.save();
      target.globalAlpha = Math.min(1, glow * 1.3);
      target.globalCompositeOperation = 'screen';
      place(target);
      target.filter = `${filter ? `${filter} ` : ''}brightness(0.7) contrast(3) saturate(1.3) blur(${(v.glowRadius * s).toFixed(1)}px)`;
      target.drawImage(src, sx, sy, sw, sh, L.dx, L.dy, L.dw, L.dh);
      target.restore();
    }

    if (useLayer) {
      if (clip.mask) this.applyMask(target, clip.mask, L, place, s);
      if (st.dip) {
        target.save();
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.globalCompositeOperation = 'source-atop';
        target.globalAlpha = st.dip.alpha;
        target.fillStyle = st.dip.color;
        target.fillRect(0, 0, target.canvas.width, target.canvas.height);
        target.restore();
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = st.alpha;
      if (clip.blend && clip.blend !== 'normal') ctx.globalCompositeOperation = COMPOSITE[clip.blend];
      ctx.drawImage(target.canvas, 0, 0);
      ctx.restore();
    } else ctx.restore();
    this.drawLetterbox(ctx, v, st.alpha, W, H);
  }

  /** Keeps only the masked part of the layer (the mask moves with the picture). */
  private applyMask(c: Ctx2D, mask: ClipMask, L: ClipLayout, place: (c: Ctx2D) => void, s: number) {
    const fullW = L.dw / Math.max(1e-6, L.sw);
    const fullH = L.dh / Math.max(1e-6, L.sh);
    const x0 = L.dx - L.sx * fullW;
    const y0 = L.dy - L.sy * fullH;
    const cx = x0 + mask.x * fullW;
    const cy = y0 + mask.y * fullH;
    const feather = mask.feather * Math.min(Math.abs(fullW), Math.abs(fullH));
    c.save();
    c.setTransform(s, 0, 0, s, 0, 0);
    c.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in';
    place(c);
    if (feather > 0) c.filter = `blur(${(feather * s * 0.5).toFixed(2)}px)`;
    c.fillStyle = '#000';
    c.translate(cx, cy);
    c.rotate((mask.rotation * Math.PI) / 180);
    c.beginPath();
    if (mask.shape === 'linear') {
      const big = (Math.abs(fullW) + Math.abs(fullH)) * 4;
      c.rect(-big, -big, big, big * 2);
    } else if (mask.shape === 'ellipse') c.ellipse(0, 0, Math.abs((mask.w * fullW) / 2), Math.abs((mask.h * fullH) / 2), 0, 0, Math.PI * 2);
    else c.rect((-mask.w * fullW) / 2, (-mask.h * fullH) / 2, mask.w * fullW, mask.h * fullH);
    c.fill();
    c.restore();
  }

  private drawLetterbox(ctx: Ctx2D, v: VisualProps, alpha: number, W: number, H: number) {
    if (v.letterbox <= 0) return;
    const bar = Math.min(0.5, v.letterbox) * H;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha / Math.max(0.001, v.opacity));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(-1, -1, W + 2, bar + 1);
    ctx.fillRect(-1, H - bar, W + 2, bar + 1);
    ctx.restore();
  }

  private drawOffline(ctx: Ctx2D, x: number, y: number, w: number, h: number, label: string) {
    ctx.fillStyle = '#5a1620';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = Math.max(4, w / 60);
    ctx.beginPath();
    for (let i = -h; i < w; i += Math.max(20, w / 16)) {
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.max(12, Math.round(h / 14))}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }
}
