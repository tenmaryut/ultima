import { useEffect, useRef } from 'react';
import { useT } from '../../../core/i18n';
import { cameraName, formatAperture, formatFocal, formatShutter } from '../exif';
import { histogramStats, type Histogram } from '../histogram';
import { setStore, useDevelop } from '../store';
import type { Photo } from '../types';

function draw(canvas: HTMLCanvasElement, h: Histogram | null) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const ht = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== ht) {
    canvas.width = w;
    canvas.height = ht;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, ht);
  // quarter grid
  ctx.strokeStyle = 'rgba(128,128,128,0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = Math.round((w * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ht);
    ctx.stroke();
  }
  if (!h || !h.total) return;
  // scale: ignore the extreme bins so a clipped spike doesn't flatten everything
  let max = 1;
  for (const ch of [h.r, h.g, h.b]) for (let i = 1; i < 255; i++) max = Math.max(max, ch[i]);
  const ys = (v: number) => ht - Math.min(1, Math.sqrt(v / max)) * (ht - 4);
  const path = (ch: Uint32Array) => {
    ctx.beginPath();
    ctx.moveTo(0, ht);
    for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, ys(ch[i]));
    ctx.lineTo(w, ht);
    ctx.closePath();
  };
  ctx.globalCompositeOperation = 'lighter';
  const colors: [Uint32Array, string][] = [
    [h.r, 'rgba(230,60,60,0.75)'],
    [h.g, 'rgba(60,200,80,0.75)'],
    [h.b, 'rgba(70,110,240,0.8)'],
  ];
  for (const [ch, color] of colors) {
    path(ch);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * w;
    const y = ys(h.l[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(235,235,235,0.75)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.stroke();
}

export function HistogramView({ photo }: { photo?: Photo }) {
  const t = useT();
  const histogram = useDevelop((s) => s.histogram);
  const clipping = useDevelop((s) => s.showClipping);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) draw(ref.current, histogram);
  }, [histogram]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw(el, useDevelop.getState().histogram));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stats = histogram ? histogramStats(histogram) : null;
  const e = photo?.exif;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="dv-hist">
        <canvas ref={ref} aria-label={t('Histogram')} />
        <button
          type="button"
          className={`dv-clip low ${clipping ? 'on' : ''} ${stats?.shadowsClipped ? 'hot' : ''}`}
          title={`${t('Show shadow clipping')} (J)`}
          aria-label={t('Show shadow clipping')}
          onClick={() => setStore({ showClipping: !clipping })}
        />
        <button
          type="button"
          className={`dv-clip high ${clipping ? 'on' : ''} ${stats?.highlightsClipped ? 'hot' : ''}`}
          title={`${t('Show highlight clipping')} (J)`}
          aria-label={t('Show highlight clipping')}
          onClick={() => setStore({ showClipping: !clipping })}
        />
      </div>
      <div className="dv-exif-line" title={cameraName(e) ?? ''}>
        <span>{e?.iso ? `ISO ${e.iso}` : '—'}</span>
        <span>{formatFocal(e?.focalLength) ?? '—'}</span>
        <span>{formatAperture(e?.fNumber) ?? '—'}</span>
        <span>{formatShutter(e?.exposureTime) ?? '—'}</span>
      </div>
    </div>
  );
}
