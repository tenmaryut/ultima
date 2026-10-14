import { memo, useEffect, useRef } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { useT } from '../../../core/i18n';
import type { ViewportApi } from '../../../core/viewport';
import { ctx2d } from '../canvas';
import type { PhotoEngine } from '../engine';
import type { Session } from '../store';

/* ---------------------------------- History ---------------------------------- */

/** Translates a history label ("Lasso (add)" → base label + translated mode). */
function historyLabel(t: (k: string) => string, label: string): string {
  const m = /^(.*?) \((add|subtract|intersect)\)$/.exec(label);
  return m ? `${t(m[1])} (${t(m[2])})` : t(label);
}

export const HistoryPanel = memo(function HistoryPanel({ session }: { session: Session; version: number }) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const rows = session.history.rows();
  useEffect(() => {
    listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  });
  return (
    <div className="ph-history" ref={listRef} role="list">
      {rows.map((r) => (
        <button
          key={`${r.index}-${r.label}`}
          type="button"
          role="listitem"
          className={`ph-history-row ${r.current ? 'current' : ''} ${r.future ? 'future' : ''}`}
          onClick={() => session.history.jumpTo(r.index)}
        >
          <HistoryIcon size={12} />
          <span className="ph-ellipsis">{historyLabel(t, r.label)}</span>
        </button>
      ))}
    </div>
  );
});

/* --------------------------------- Navigator --------------------------------- */

export function NavigatorPanel({ engine, viewport, version }: { engine: PhotoEngine; viewport: ViewportApi; version: number }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const W = 248;
  const H = 150;

  useEffect(() => {
    const id = window.setTimeout(() => {
      const c = ref.current;
      const display = engine.display;
      const doc = engine.doc;
      const container = engine.container;
      if (!c || !display || !doc || !container) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = W * dpr;
      c.height = H * dpr;
      const ctx = ctx2d(c);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const s = Math.min(W / doc.width, H / doc.height);
      const ox = (W - doc.width * s) / 2;
      const oy = (H - doc.height * s) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ox, oy, doc.width * s, doc.height * s);
      ctx.fillStyle = '#e5e5e5';
      const cell = 6;
      for (let y = 0; y < doc.height * s; y += cell) for (let x = (Math.floor(y / cell) % 2) * cell; x < doc.width * s; x += cell * 2) ctx.fillRect(ox + x, oy + y, Math.min(cell, doc.width * s - x), Math.min(cell, doc.height * s - y));
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(display, ox, oy, doc.width * s, doc.height * s);
      const v = viewport.view;
      const vx = (-v.x / v.zoom) * s + ox;
      const vy = (-v.y / v.zoom) * s + oy;
      const vw = (container.clientWidth / v.zoom) * s;
      const vh = (container.clientHeight / v.zoom) * s;
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, vw, vh);
    }, 120);
    return () => window.clearTimeout(id);
  });

  const centerAt = (e: React.PointerEvent) => {
    const doc = engine.doc;
    const container = engine.container;
    if (!doc || !container) return;
    const r = e.currentTarget.getBoundingClientRect();
    const s = Math.min(W / doc.width, H / doc.height);
    const ox = (W - doc.width * s) / 2;
    const oy = (H - doc.height * s) / 2;
    const dx = (e.clientX - r.left - ox) / s;
    const dy = (e.clientY - r.top - oy) / s;
    const z = viewport.view.zoom;
    viewport.setView({ zoom: z, x: container.clientWidth / 2 - dx * z, y: container.clientHeight / 2 - dy * z });
  };

  void version;
  return (
    <canvas
      ref={ref}
      className="ph-navigator"
      style={{ width: W, height: H }}
      aria-label={t('Navigator')}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        centerAt(e);
      }}
      onPointerMove={(e) => dragging.current && centerAt(e)}
      onPointerUp={() => (dragging.current = false)}
    />
  );
}
