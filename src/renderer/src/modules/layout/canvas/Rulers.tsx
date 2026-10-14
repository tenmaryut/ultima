import type { ViewportApi } from '../../../core/viewport';
import type { Rect, Unit } from '../types';
import { PX_PER_UNIT } from '../units';
import { RULER } from './useCanvasInteraction';
import type { PageSlot } from './world';

/** Ruler tick spacing (in units) so that labels are at least ~60 screen px apart. */
export function rulerStep(unit: Unit, zoom: number): number {
  const pxPerUnit = PX_PER_UNIT[unit] * zoom;
  const candidates =
    unit === 'in' ? [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 6, 12, 24, 48] : [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return candidates.find((c) => c * pxPerUnit >= 60) ?? candidates[candidates.length - 1];
}

interface Props {
  vp: ViewportApi;
  slot: PageSlot;
  unit: Unit;
  width: number;
  height: number;
  /** Selection bounds in page px (shaded on the rulers). */
  selection: Rect | null;
  pointer: { x: number; y: number } | null;
}

export function Rulers({ vp, slot, unit, width, height, selection, pointer }: Props) {
  const step = rulerStep(unit, vp.zoom);
  const ppu = PX_PER_UNIT[unit];
  const origin = vp.docToScreen(slot.x, slot.y);
  const unitPx = ppu * vp.zoom;
  const sub = unit === 'in' ? 4 : step >= 10 && String(step)[0] === '2' ? 4 : 5;
  const ticks = (length: number, o: number) => {
    const out: { pos: number; major: boolean; label: string }[] = [];
    const startU = Math.floor((RULER - o) / unitPx / step) * step;
    const endU = (length - o) / unitPx;
    for (let u = startU; u <= endU + step; u += step) {
      for (let k = 0; k < sub; k++) {
        const v = u + (k * step) / sub;
        const pos = o + v * unitPx;
        if (pos < RULER || pos > length) continue;
        const label = k === 0 ? String(Math.round(v * 1000) / 1000) : '';
        out.push({ pos, major: k === 0, label });
      }
    }
    return out;
  };
  const hx = ticks(width, origin.x);
  const vy = ticks(height, origin.y);
  const selA = selection ? vp.docToScreen(slot.x + selection.x, slot.y + selection.y) : null;
  const selB = selection ? vp.docToScreen(slot.x + selection.x + selection.w, slot.y + selection.y + selection.h) : null;
  return (
    <>
      <svg className="ly-ruler ly-ruler-h" width={width} height={RULER}>
        {selA && selB && <rect className="ly-ruler-sel" x={Math.max(RULER, selA.x)} y={0} width={Math.max(0, selB.x - Math.max(RULER, selA.x))} height={RULER} />}
        {hx.map((tk, i) => (
          <g key={i}>
            <line x1={tk.pos} x2={tk.pos} y1={tk.major ? 0 : RULER - 5} y2={RULER} />
            {tk.label && (
              <text x={tk.pos + 3} y={10}>
                {tk.label}
              </text>
            )}
          </g>
        ))}
        {pointer && pointer.x > RULER && <line className="ly-ruler-ptr" x1={pointer.x} x2={pointer.x} y1={0} y2={RULER} />}
      </svg>
      <svg className="ly-ruler ly-ruler-v" width={RULER} height={height}>
        {selA && selB && <rect className="ly-ruler-sel" x={0} y={Math.max(RULER, selA.y)} width={RULER} height={Math.max(0, selB.y - Math.max(RULER, selA.y))} />}
        {vy.map((tk, i) => (
          <g key={i}>
            <line y1={tk.pos} y2={tk.pos} x1={tk.major ? 0 : RULER - 5} x2={RULER} />
            {tk.label && (
              <text x={10} y={tk.pos + 3} transform={`rotate(-90 10 ${tk.pos + 3})`}>
                {tk.label}
              </text>
            )}
          </g>
        ))}
        {pointer && pointer.y > RULER && <line className="ly-ruler-ptr" y1={pointer.y} y2={pointer.y} x1={0} x2={RULER} />}
      </svg>
      <div className="ly-ruler-corner" title={unit}>
        {unit}
      </div>
    </>
  );
}
