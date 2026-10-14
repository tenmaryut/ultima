import type { Clip, MediaRef, Project, VisualProps } from './types';
import { DEFAULT_VISUAL } from './presets';
import { applyChromaKey, applyTemperature, clipLayout, fadeFactor, transitionFx, type TransitionFx } from './fx';
import { drawCaption, drawTitle } from './text';
import { clipEnd, getMedia, tracksOfKind } from './model';
import { animatedVisual, sourceAt } from './keyframes';
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

const isVisual = (c: Clip) => c.kind === 'video' || c.kind === 'image' || c.kind === 'title';

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
    if (tr && tr.duration > 0 && t < clip.start + tr.duration) {
      progress = Math.max(0, Math.min(1, (t - clip.start) / tr.duration));
      for (const c of p.clips) {
        if (c !== clip && c.trackId === track.id && isVisual(c) && Math.abs(clipEnd(c) - clip.start) <= halfFrame + EPS) outgoing = c;
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

export function cssFilter(v: VisualProps, scale: number): string {
  const parts: string[] = [];
  if (v.brightness) parts.push(`brightness(${(1 + v.brightness / 100).toFixed(3)})`);
  if (v.contrast) parts.push(`contrast(${(1 + v.contrast / 100).toFixed(3)})`);
  if (v.saturation) parts.push(`saturate(${(1 + v.saturation / 100).toFixed(3)})`);
  if (v.hue) parts.push(`hue-rotate(${v.hue.toFixed(1)}deg)`);
  if (v.blur > 0) parts.push(`blur(${(v.blur * scale).toFixed(2)}px)`);
  return parts.join(' ');
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return { w: src.displayWidth, h: src.displayHeight };
  const s = src as { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  return { w: typeof s.width === 'number' ? s.width : 0, h: typeof s.height === 'number' ? s.height : 0 };
}

type Ctx2D = CanvasRenderingContext2D;

export class Compositor {
  private scratch: HTMLCanvasElement | null = null;
  private layerCanvas: HTMLCanvasElement | null = null;

  private scratchCtx(w: number, h: number): CanvasRenderingContext2D {
    if (!this.scratch) this.scratch = document.createElement('canvas');
    if (this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch.width = w;
      this.scratch.height = h;
    }
    const ctx = this.scratch.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  render(ctx: Ctx2D, p: Project, t: number, provider: FrameProvider, opts: RenderOptions): void {
    const canvas = ctx.canvas;
    const s = opts.scale;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = p.settings.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    for (const layer of visualLayers(p, t)) {
      if (layer.progress === null || !layer.clip.transition) {
        this.drawClip(ctx, p, layer.clip, t, provider, opts, null);
        continue;
      }
      const fx = transitionFx(layer.clip.transition.kind, layer.progress);
      if (fx.dip) {
        // isolate the track so the dip color only covers this track's pictures
        if (!this.layerCanvas) this.layerCanvas = document.createElement('canvas');
        const lc = this.layerCanvas;
        if (lc.width !== canvas.width || lc.height !== canvas.height) {
          lc.width = canvas.width;
          lc.height = canvas.height;
        }
        const lctx = lc.getContext('2d')!;
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.clearRect(0, 0, lc.width, lc.height);
        lctx.setTransform(s, 0, 0, s, 0, 0);
        if (fx.showA && layer.outgoing) this.drawClip(lctx, p, layer.outgoing, t, provider, opts, null);
        if (fx.showB) this.drawClip(lctx, p, layer.clip, t, provider, opts, null);
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalCompositeOperation = 'source-atop';
        lctx.globalAlpha = fx.dip.alpha;
        lctx.fillStyle = fx.dip.color;
        lctx.fillRect(0, 0, lc.width, lc.height);
        lctx.globalCompositeOperation = 'source-over';
        lctx.globalAlpha = 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(lc, 0, 0);
        ctx.restore();
      } else {
        if (fx.showA && layer.outgoing) this.drawClip(ctx, p, layer.outgoing, t, provider, opts, null);
        if (fx.showB) this.drawClip(ctx, p, layer.clip, t, provider, opts, fx);
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

  private drawClip(ctx: Ctx2D, p: Project, clip: Clip, t: number, provider: FrameProvider, opts: RenderOptions, fx: TransitionFx | null) {
    const { width: W, height: H } = p.settings;
    const local = Math.min(t - clip.start, clip.duration);
    const v = clip.visual ? animatedVisual(clip, local) : DEFAULT_VISUAL;
    let alpha = v.opacity * fadeFactor(local, clip.duration, clip.fadeIn, clip.fadeOut);
    if (fx) alpha *= fx.bAlpha;
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fx?.bClip) {
      ctx.beginPath();
      ctx.rect(fx.bClip.x0 * W, 0, (fx.bClip.x1 - fx.bClip.x0) * W, H);
      ctx.clip();
    }
    if (fx && (fx.bOffsetX || fx.bScale !== 1)) {
      ctx.translate(fx.bOffsetX * W + W / 2, H / 2);
      ctx.scale(fx.bScale, fx.bScale);
      ctx.translate(-W / 2, -H / 2);
    }
    const filter = cssFilter(v, opts.scale);
    if (clip.kind === 'title') {
      if (clip.title) {
        ctx.translate(W / 2 + v.x, H / 2 + v.y);
        ctx.rotate((v.rotation * Math.PI) / 180);
        ctx.scale(v.scale, v.scale);
        ctx.translate(-W / 2, -H / 2);
        if (filter) ctx.filter = filter;
        drawTitle(ctx, clip.title, t - clip.start, clip.duration, W, H);
      }
      ctx.restore();
      return;
    }
    const media = getMedia(p, clip.mediaId);
    const src = clip.kind === 'video' ? provider.video(clip, sourceTimeAt(clip, t, media)) : provider.image(clip.mediaId ?? '');
    const size = src ? sourceSize(src) : { w: 0, h: 0 };
    const mw = media?.width || size.w || W;
    const mh = media?.height || size.h || H;
    const L = clipLayout(mw, mh, W, H, v);
    ctx.translate(L.cx, L.cy);
    ctx.rotate((L.rotation * Math.PI) / 180);
    if (!src || !size.w || !size.h) {
      if (clip.mediaId && opts.isOffline?.(clip.mediaId)) this.drawOffline(ctx, L.dx, L.dy, L.dw, L.dh, opts.offlineLabel ?? 'Media offline');
      ctx.restore();
      return;
    }
    let source: CanvasImageSource = src;
    let sx = L.sx * size.w;
    let sy = L.sy * size.h;
    let sw = L.sw * size.w;
    let sh = L.sh * size.h;
    if (v.temperature || v.chromaKey) {
      const dw = Math.max(1, Math.min(4096, Math.round(Math.abs(L.dw * opts.scale * (fx?.bScale ?? 1)))));
      const dh = Math.max(1, Math.min(4096, Math.round(Math.abs(L.dh * opts.scale * (fx?.bScale ?? 1)))));
      const sctx = this.scratchCtx(dw, dh);
      sctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
      const img = sctx.getImageData(0, 0, dw, dh);
      if (v.temperature) applyTemperature(img.data, v.temperature);
      if (v.chromaKey) {
        const key = parseColor(v.chromaColor) ?? { r: 0, g: 255, b: 0, a: 1 };
        applyChromaKey(img.data, key, v.chromaSimilarity, v.chromaSmoothness);
      }
      sctx.putImageData(img, 0, 0);
      source = this.scratch!;
      sx = 0;
      sy = 0;
      sw = dw;
      sh = dh;
    }
    if (filter) ctx.filter = filter;
    ctx.drawImage(source, sx, sy, sw, sh, L.dx, L.dy, L.dw, L.dh);
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
