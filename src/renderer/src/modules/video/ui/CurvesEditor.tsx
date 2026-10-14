import { useRef, useState } from 'react';
import type { CurveChannel, CurvePoint } from '../types';
import { useT } from '../../../core/i18n';
import { curveTable } from '../grade';

/* Tone curve editor: click to add a point, drag to move it, double-click to remove it. */

const COLORS: Record<CurveChannel, string> = { master: 'var(--text-0)', r: '#ff5c5c', g: '#4cd964', b: '#4c8dff' };
const IDENTITY: CurvePoint[] = [
  [0, 0],
  [1, 1],
];

interface Props {
  channel: CurveChannel;
  points: CurvePoint[] | undefined;
  /** `commit`: the gesture ended (record one undo step). */
  onChange: (points: CurvePoint[], commit: boolean) => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function CurvesEditor({ channel, points, onChange }: Props) {
  const t = useT();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; list: CurvePoint[] } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pts = points?.length ? points : IDENTITY;
  const table = curveTable(pts);
  const path = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64;
    return `${i ? 'L' : 'M'}${(x * 100).toFixed(2)},${((1 - table[Math.round(x * 255)]) * 100).toFixed(2)}`;
  }).join(' ');

  const toPoint = (e: React.PointerEvent): CurvePoint => {
    const r = svg.current!.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)];
  };

  const move = (list: CurvePoint[], index: number, [x, y]: CurvePoint): CurvePoint[] => {
    const next = list.map((p) => [...p] as CurvePoint);
    const first = index === 0;
    const last = index === list.length - 1;
    // the ends stay at the left and right edges; the others stay between their neighbours
    const lo = first ? 0 : list[index - 1][0] + 0.01;
    const hi = last ? 1 : list[index + 1][0] - 0.01;
    next[index] = [first ? 0 : last ? 1 : Math.min(hi, Math.max(lo, x)), y];
    return next;
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toPoint(e);
    const r = svg.current!.getBoundingClientRect();
    // grab a point near the pointer, or add one on the curve
    let index = pts.findIndex(([x, y]) => Math.hypot((x - p[0]) * r.width, (y - p[1]) * r.height) < 9);
    let list = pts;
    if (index < 0) {
      list = [...pts, p].sort((a, b) => a[0] - b[0]);
      index = list.indexOf(p);
      if (list.length > 16) return;
    }
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = { index, list };
    onChange(move(list, index, p), false);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = move(d.list, d.index, toPoint(e));
    onChange(next, false);
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    onChange(move(d.list, d.index, toPoint(e)), true);
  };

  return (
    <svg
      ref={svg}
      className="vd-curves"
      viewBox="-2 -2 104 104"
      preserveAspectRatio="none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="img"
      aria-label={t('Tone curve: click to add a point, drag to move it, double-click to remove it')}
    >
      <rect x="0" y="0" width="100" height="100" className="vd-curves-bg" />
      {[25, 50, 75].map((g) => (
        <g key={g} className="vd-curves-grid">
          <line x1={g} y1="0" x2={g} y2="100" />
          <line x1="0" y1={g} x2="100" y2={g} />
        </g>
      ))}
      <line x1="0" y1="100" x2="100" y2="0" className="vd-curves-diag" />
      <path d={path} fill="none" stroke={COLORS[channel]} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x * 100}
          cy={(1 - y) * 100}
          r={hover === i ? 3.2 : 2.4}
          fill={COLORS[channel]}
          stroke="var(--bg-0, #000)"
          strokeWidth="0.8"
          onPointerEnter={() => setHover(i)}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() => {
            if (i === 0 || i === pts.length - 1) return;
            onChange(
              pts.filter((_, j) => j !== i),
              true,
            );
          }}
        />
      ))}
    </svg>
  );
}
