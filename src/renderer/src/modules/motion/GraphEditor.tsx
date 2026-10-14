import { useRef } from 'react';
import { useT } from '../../core/i18n';
import { bezierFor, BEZIER_PRESETS, ease, EASING_TYPES } from './easing';
import type { Bezier, EasingType } from './types';
import { ScrubNumber } from './widgets';

/**
 * Small cubic-bézier curve editor. Shows any easing; dragging a handle turns it into a
 * custom curve. y may overshoot (-0.5 … 1.5) for anticipation / overshoot effects.
 */

const SIZE = 180;
const PAD = 14;
const Y_MIN = -0.5;
const Y_MAX = 1.5;

const sx = (x: number) => PAD + x * (SIZE - 2 * PAD);
const sy = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * (SIZE - 2 * PAD);

export function GraphEditor({
  easing,
  bezier,
  onChange,
  onCommit,
}: {
  easing: EasingType;
  bezier?: Bezier;
  /** Live update while dragging. */
  onChange: (easing: EasingType, bezier?: Bezier) => void;
  /** Final value (record an undo step). */
  onCommit: (easing: EasingType, bezier?: Bezier) => void;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ handle: 0 | 1; b: Bezier } | null>(null);
  const editable = easing === 'bezier' || easing in BEZIER_PRESETS;
  const b = bezierFor(easing, bezier);

  const pts: string[] = [];
  for (let i = 0; i <= 80; i++) {
    const u = i / 80;
    pts.push(`${sx(u).toFixed(1)},${sy(ease(easing, u, bezier)).toFixed(1)}`);
  }

  const toCurve = (clientX: number, clientY: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * SIZE;
    const y = ((clientY - r.top) / r.height) * SIZE;
    const cx = Math.min(1, Math.max(0, (x - PAD) / (SIZE - 2 * PAD)));
    const cy = Math.min(Y_MAX, Math.max(Y_MIN, Y_MAX - ((y - PAD) / (SIZE - 2 * PAD)) * (Y_MAX - Y_MIN)));
    return [Math.round(cx * 100) / 100, Math.round(cy * 100) / 100];
  };

  const startDrag = (handle: 0 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { handle, b: [...b] as Bezier };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const [x, y] = toCurve(e.clientX, e.clientY);
    if (d.handle === 0) d.b = [x, y, d.b[2], d.b[3]];
    else d.b = [d.b[0], d.b[1], x, y];
    onChange('bezier', d.b);
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d) onCommit('bezier', d.b);
  };

  const setValue = (i: number, v: number) => {
    const next = [...b] as Bezier;
    next[i] = v;
    onCommit('bezier', next);
  };

  return (
    <div className="mo-graph">
      <svg
        ref={svgRef}
        className="mo-graph-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label={t('Easing curve')}
      >
        <rect x={sx(0)} y={sy(1)} width={sx(1) - sx(0)} height={sy(0) - sy(1)} className="mo-graph-box" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} className="mo-graph-diag" />
        <polyline points={pts.join(' ')} className="mo-graph-curve" />
        {editable && (
          <>
            <line x1={sx(0)} y1={sy(0)} x2={sx(b[0])} y2={sy(b[1])} className="mo-graph-arm" />
            <line x1={sx(1)} y1={sy(1)} x2={sx(b[2])} y2={sy(b[3])} className="mo-graph-arm" />
            <circle cx={sx(b[0])} cy={sy(b[1])} r={6} className="mo-graph-handle" onPointerDown={startDrag(0)} />
            <circle cx={sx(b[2])} cy={sy(b[3])} r={6} className="mo-graph-handle" onPointerDown={startDrag(1)} />
          </>
        )}
      </svg>
      {editable ? (
        <div className="mo-graph-values">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((label, i) => (
            <label key={label} className="mo-graph-value">
              <span className="faint">{label}</span>
              <ScrubNumber
                value={b[i]}
                step={0.01}
                precision={2}
                min={i % 2 === 0 ? 0 : Y_MIN}
                max={i % 2 === 0 ? 1 : Y_MAX}
                onChange={(v) => {
                  const next = [...b] as Bezier;
                  next[i] = v;
                  onChange('bezier', next);
                }}
                onCommit={(v) => setValue(i, v)}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="faint" style={{ fontSize: 11 }}>
          {t('Drag-editable curves: choose Linear, an Ease or Custom.')}
        </div>
      )}
      <div className="mo-graph-presets">
        {EASING_TYPES.filter((e) => e.value !== 'bezier').map((e) => (
          <button key={e.value} type="button" className={`chip ${easing === e.value ? 'mo-chip-active' : ''}`} onClick={() => onCommit(e.value)}>
            {t(e.label)}
          </button>
        ))}
        <button
          type="button"
          className={`chip ${easing === 'bezier' ? 'mo-chip-active' : ''}`}
          onClick={() => onCommit('bezier', bezierFor(easing, bezier))}
        >
          {t('Custom curve')}
        </button>
      </div>
    </div>
  );
}
