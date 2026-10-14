import { useEffect, useMemo, useRef } from 'react';
import { useElementSize } from '../../core/hooks';
import { useT } from '../../core/i18n';
import { hsvToRgb, toHex, type HSV } from './colormath';
import { baseWheelFromMarker, generateHarmony, rgbHueToWheel, spreadFromMarker, wheelHueToRgb } from './harmony';
import { baseIndex, hexToHsv, hsvToHex, regenerate, setSpread, spreadOf, type ColorDoc } from './state';
import { drawWheel } from './render';

interface Props {
  doc: ColorDoc;
  selected: number;
  onSelect: (index: number) => void;
  /** Live update (no undo step). */
  onPreview: (doc: ColorDoc) => void;
  /** Records one undo step for the live updates since the drag started. */
  onCommit: (label: string) => void;
}

/** Interactive HSB color wheel: hue = angle, saturation = radius. Markers show every swatch. */
export function WheelView({ doc, selected, onSelect, onPreview, onCommit }: Props) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);
  const diameter = Math.max(160, Math.min(560, Math.floor(Math.min(size.width, size.height) - 40)));
  const radius = diameter / 2;
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const drag = useRef<{ index: number; start: ColorDoc; pointerId: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width) return;
    drawWheel(canvas, diameter * dpr, (angle) => wheelHueToRgb(angle, doc.wheel));
  }, [diameter, dpr, doc.wheel, size.width]);

  const bi = baseIndex(doc);
  const markers = useMemo(
    () =>
      doc.swatches.map((s, i) => {
        const hsv = hexToHsv(s.hex);
        const angle = (rgbHueToWheel(hsv.h, doc.wheel) * Math.PI) / 180;
        const r = hsv.s * radius;
        return { i, hex: s.hex, x: radius + Math.sin(angle) * r, y: radius - Math.cos(angle) * r, locked: s.locked };
      }),
    [doc.swatches, doc.wheel, radius],
  );

  const polar = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.querySelector('.co-wheel')?.getBoundingClientRect();
    if (!rect) return null;
    const dx = clientX - rect.left - radius;
    const dy = clientY - rect.top - radius;
    let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    return { angle, sat: Math.min(1, Math.hypot(dx, dy) / radius) };
  };

  /** Computes the document for marker `index` dragged to (angle, sat), starting from `start`. */
  const dragged = (start: ColorDoc, index: number, angle: number, sat: number): ColorDoc => {
    const sw = start.swatches[index];
    if (!sw || sw.locked) return start;
    const b = baseIndex(start);
    const hsv = hexToHsv(sw.hex);
    const target: HSV = { h: wheelHueToRgb(angle, start.wheel), s: sat, v: hsv.v };
    if (start.rule === 'custom') {
      return { ...start, swatches: start.swatches.map((s, i) => (i === index ? { ...s, hex: hsvToHex(target), point: undefined } : s)) };
    }
    if (index === b) return regenerate(start, target);
    const base = hexToHsv(start.swatches[b].hex);
    const spread = spreadOf(start);
    const slot = generateHarmony(base, start.rule, start.swatches.length, b, spread, start.wheel).specs[index];
    let next: ColorDoc;
    if (!slot) return start;
    const newSpread = spreadFromMarker(slot, rgbHueToWheel(base.h, start.wheel), angle, start.rule);
    if (newSpread !== null) {
      next = setSpread(start, newSpread);
    } else {
      const baseWheel = baseWheelFromMarker(slot, angle, spread);
      if (start.swatches[b].locked) return start;
      next = regenerate(start, { ...base, h: wheelHueToRgb(baseWheel, start.wheel) });
    }
    // the radial position sets this swatch's saturation
    const cur = hexToHsv(next.swatches[index].hex);
    const hex = toHex(hsvToRgb({ ...cur, s: sat }));
    return { ...next, swatches: next.swatches.map((s, i) => (i === index ? { ...s, hex } : s)) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = (e.target as Element).closest('[data-marker]');
    let index = target ? Number(target.getAttribute('data-marker')) : selected;
    const p = polar(e.clientX, e.clientY);
    if (!p) return;
    if (!target && p.sat >= 1.02) return;
    if (!doc.swatches[index]) index = bi;
    onSelect(index);
    if (doc.swatches[index].locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { index, start: doc, pointerId: e.pointerId };
    if (!target) onPreview(dragged(doc, index, p.angle, Math.min(1, p.sat)));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = polar(e.clientX, e.clientY);
    if (p) onPreview(dragged(d.start, d.index, p.angle, p.sat));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    onCommit(d.index === baseIndex(d.start) ? 'Move base color' : 'Move color');
  };

  return (
    <div className="co-wheel-wrap" ref={wrapRef}>
      <div
        className="co-wheel"
        style={{ width: diameter, height: diameter }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label={t('Color wheel')}
      >
        <canvas ref={canvasRef} style={{ width: diameter, height: diameter }} />
        <svg className="co-wheel-overlay" width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`}>
          {markers.map((m) => (
            <line key={`l${m.i}`} x1={radius} y1={radius} x2={m.x} y2={m.y} className="co-wheel-line" />
          ))}
          <circle cx={radius} cy={radius} r={3} className="co-wheel-center" />
          {markers.map((m) => {
            const isBase = m.i === bi;
            const r = isBase ? 14 : 10;
            return (
              <g key={m.i} data-marker={m.i} className={`co-marker ${m.i === selected ? 'selected' : ''} ${m.locked ? 'locked' : ''}`}>
                <title>{`${m.hex.toUpperCase()}${isBase ? ` — ${t('Base color')}` : ''}${m.locked ? ` (${t('Locked')})` : ''}`}</title>
                <circle cx={m.x} cy={m.y} r={r + 2.5} className="co-marker-ring" />
                <circle cx={m.x} cy={m.y} r={r} fill={m.hex} className="co-marker-fill" />
                {isBase && <circle cx={m.x} cy={m.y} r={4} className="co-marker-dot" />}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="co-wheel-hint faint">
        {doc.rule === 'custom'
          ? t('Drag any marker to change that color.')
          : t('Drag the large marker (base color) to move the whole harmony. Drag other markers to change the spread or rotate it.')}
      </div>
    </div>
  );
}
