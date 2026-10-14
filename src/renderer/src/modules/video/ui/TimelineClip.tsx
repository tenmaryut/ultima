import { memo, useLayoutEffect, useRef } from 'react';
import { Captions, Image as ImageIcon, Link2, Music, Type, Video } from 'lucide-react';
import type { Clip, MediaRef } from '../types';
import type { MediaLibrary, RuntimeMedia } from '../media';
import { dbToGain } from '../time';
import { useAppStore } from '../../../core/store';

export interface ClipViewProps {
  clip: Clip;
  pps: number;
  height: number;
  /** Visible window in content pixels (the canvas only covers this part). */
  winStart: number;
  winEnd: number;
  selected: boolean;
  locked: boolean;
  media: MediaRef | undefined;
  runtime: RuntimeMedia | undefined;
  lib: MediaLibrary;
  libVersion: number;
  label: string;
}

const ICONS = { video: Video, image: ImageIcon, audio: Music, title: Type, caption: Captions };

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export const ClipView = memo(function ClipView(props: ClipViewProps) {
  const { clip, pps, height, winStart, winEnd, selected, locked, media, runtime, lib, libVersion, label } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useAppStore((s) => s.theme); // waveform colors come from the theme
  const left = clip.start * pps;
  const width = Math.max(2, clip.duration * pps);
  const offline = Boolean(clip.mediaId) && !runtime;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const visL = Math.max(left, winStart);
    const visR = Math.min(left + width, winEnd);
    const needsCanvas = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio';
    if (!needsCanvas || visR - visL < 1 || !runtime || !media) {
      canvas.style.display = 'none';
      return;
    }
    if (clip.kind === 'video' && !runtime.filmstrip) void lib.ensureFilmstrip(media);
    if (clip.kind === 'audio' && runtime.peaks === undefined) void lib.ensurePeaks(media);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = visR - visL;
    const h = Math.max(4, height - 6);
    canvas.style.display = 'block';
    canvas.style.left = `${visL - left - 1}px`;
    canvas.style.width = `${w}px`;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const offset = visL - left; // clip-local px of the canvas' left edge

    if (clip.kind === 'video' || clip.kind === 'image') {
      const y0 = 15;
      const th = Math.max(8, h - y0 - 2);
      const strip = runtime.filmstrip;
      const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
      const tw = Math.max(12, th * aspect);
      const first = Math.floor(offset / tw) * tw;
      ctx.globalAlpha = 0.9;
      for (let x = first; x < offset + w; x += tw) {
        let frame: CanvasImageSource | null = null;
        if (clip.kind === 'image') frame = runtime.image ?? null;
        else if (strip && strip.frames.length) {
          const st = clip.in + ((x + tw / 2) / pps) * clip.speed;
          let best = 0;
          let bestD = Infinity;
          strip.times.forEach((tt, i) => {
            const d = Math.abs(tt - st);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          frame = strip.frames[best];
        }
        if (frame) ctx.drawImage(frame, x - offset, y0, tw, th);
      }
      ctx.globalAlpha = 1;
    } else if (clip.kind === 'audio' && runtime.peaks) {
      const { data, perSecond } = runtime.peaks;
      const buckets = data.length / 2;
      const mid = h / 2 + 5;
      const amp = (h - 14) / 2;
      const gain = Math.min(3, dbToGain(clip.volume));
      ctx.fillStyle = cssVar(canvas, '--text-0', '#ffffff');
      ctx.globalAlpha = 0.6;
      for (let px = 0; px < w; px++) {
        const t0 = clip.in + ((offset + px) / pps) * clip.speed;
        const t1 = clip.in + ((offset + px + 1) / pps) * clip.speed;
        let b0 = Math.floor(t0 * perSecond);
        const b1 = Math.max(b0 + 1, Math.floor(t1 * perSecond));
        if (b0 >= buckets) break;
        let min = 0;
        let max = 0;
        for (; b0 < b1 && b0 < buckets; b0++) {
          if (data[b0 * 2] < min) min = data[b0 * 2];
          if (data[b0 * 2 + 1] > max) max = data[b0 * 2 + 1];
        }
        // perceptual (square-root) scale so quiet recordings stay visible
        const top = mid - Math.sqrt(Math.min(1, max * gain)) * amp;
        const bottom = mid + Math.sqrt(Math.min(1, -min * gain)) * amp;
        ctx.fillRect(px, top, 1, Math.max(1, bottom - top));
      }
      ctx.globalAlpha = 1;
    }
  }, [clip, pps, height, winStart, winEnd, runtime, media, lib, libVersion, left, width, theme]);

  const Icon = ICONS[clip.kind];
  const trW = clip.transition ? Math.min(width, clip.transition.duration * pps) : 0;
  const cls = ['vd-clip', `kind-${clip.kind}`, selected && 'selected', offline && 'offline', locked && 'locked'].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ left, width }} data-clip={clip.id} title={label}>
      <canvas ref={canvasRef} />
      {trW > 0 && <div className="vd-clip-tr" style={{ width: trW }} />}
      {clip.fadeIn > 0 && <div className="vd-clip-fade in" style={{ width: Math.min(width, clip.fadeIn * pps) }} />}
      {clip.fadeOut > 0 && <div className="vd-clip-fade out" style={{ width: Math.min(width, clip.fadeOut * pps) }} />}
      {width > 18 && (
        <div className="vd-clip-label">
          {width > 40 && <Icon size={11} style={{ flex: '0 0 auto' }} />}
          {clip.linkId && width > 60 && <Link2 size={10} style={{ flex: '0 0 auto' }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          {clip.speed !== 1 && width > 90 && <span className="vd-badge">{+clip.speed.toFixed(2)}×</span>}
        </div>
      )}
      {!locked && width > 14 && (
        <>
          <div className="vd-clip-handle left" data-part="start" />
          <div className="vd-clip-handle right" data-part="end" />
        </>
      )}
    </div>
  );
});
