/**
 * Lazily rendered page thumbnail (pdf.js bitmap + annotation objects as SVG).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { engine } from '../engine';
import { viewportSize, viewportTransform } from '../geometry';
import type { Annot, PageEntry } from '../types';
import { AnnotShape, HighlightShapes, matrixAttr } from '../annotations/AnnotShapes';

export function thumbSize(entry: PageEntry, width: number, viewRotation = 0): { width: number; height: number; scale: number } {
  const info = engine.info(entry);
  if (!info) return { width, height: width * 1.3, scale: 1 };
  const rot = engine.rotation(entry, viewRotation);
  const s = viewportSize(info.view, 1, rot, info.userUnit);
  const scale = width / s.width;
  return { width, height: Math.round(s.height * scale), scale };
}

export const PageThumb = memo(function PageThumb({ entry, width, annots, viewRotation = 0 }: { entry: PageEntry; width: number; annots: Annot[]; viewRotation?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const info = engine.info(entry);
  const rot = engine.rotation(entry, viewRotation);
  const size = thumbSize(entry, width, viewRotation);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    engine
      .thumbnail(entry.src, entry.index, rot, Math.round(width * dpr))
      .then((u) => alive && setUrl(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visible, entry.src, entry.index, rot, width]);

  const m = info ? viewportTransform(info.view, size.scale, rot, info.userUnit) : null;
  return (
    <div ref={ref} className="pd-thumb-img" style={{ width: size.width, height: size.height }}>
      {url && <img src={url} alt="" draggable={false} />}
      {m && annots.length > 0 && (
        <svg width={size.width} height={size.height} style={{ pointerEvents: 'none' }}>
          <g transform={matrixAttr(m)} style={{ mixBlendMode: 'multiply' }}>
            <HighlightShapes annots={annots} />
          </g>
          <g transform={matrixAttr(m)}>
            {annots.map((a) => (
              <AnnotShape key={a.id} a={a} />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
});
