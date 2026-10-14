import { useRef, useState } from 'react';
import { ArrowLeftRight, Ban, Circle, Square, SquareDashed, Trash2, type LucideIcon } from 'lucide-react';
import { ColorPicker, IconButton, NumberField, Slider } from '../../../components/ui';
import { useT } from '../../../core/i18n';
import { mixColors } from '../../../core/utils/color';
import { normalizeColor } from '../colors';
import type { GradientStop, LinearGradient, Paint, RadialGradient } from '../model';

export interface PaintFieldProps {
  value: Paint;
  /** `live` = while dragging (no undo step yet). */
  onChange: (paint: Paint, live?: boolean) => void;
  onCommit: () => void;
  /** Size of the object's box (for geometric gradient angles). */
  box?: { width: number; height: number };
  allowNone?: boolean;
}

function firstColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (p.type === 'linear' || p.type === 'radial') return p.stops[0]?.color ?? '#000000';
  return '#000000';
}

export function gradientCss(stops: GradientStop[], angle = 90): string {
  const s = [...stops].sort((a, b) => a.offset - b.offset).map((st) => `${st.color} ${(st.offset * 100).toFixed(1)}%`);
  return `linear-gradient(${angle}deg, ${s.join(', ')})`;
}

/** Geometric angle (degrees, 0 = left→right, 90 = top→bottom) of a linear gradient. */
export function linearAngle(g: LinearGradient, box: { width: number; height: number }): number {
  const a = (Math.atan2((g.y2 - g.y1) * (box.height || 1), (g.x2 - g.x1) * (box.width || 1)) * 180) / Math.PI;
  return Math.round(a * 10) / 10;
}

/** Endpoints spanning the box at a geometric angle. */
export function linearAt(angle: number, box: { width: number; height: number }): Pick<LinearGradient, 'x1' | 'y1' | 'x2' | 'y2'> {
  const w = box.width || 1;
  const h = box.height || 1;
  const r = (angle * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const half = (Math.abs(w * c) + Math.abs(h * s)) / 2;
  return { x1: 0.5 - (c * half) / w, y1: 0.5 - (s * half) / h, x2: 0.5 + (c * half) / w, y2: 0.5 + (s * half) / h };
}

export function convertPaint(p: Paint, type: Paint['type'], box: { width: number; height: number }): Paint {
  if (p.type === type) return p;
  const base = firstColor(p);
  const stops: GradientStop[] =
    p.type === 'linear' || p.type === 'radial' ? p.stops : [{ offset: 0, color: base }, { offset: 1, color: mixColors(base, '#ffffff', 0.85) }];
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'solid':
      return { type: 'solid', color: base };
    case 'linear':
      return { type: 'linear', stops, ...linearAt(0, box) };
    case 'radial':
      return { type: 'radial', stops, cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 };
  }
}

function interpolateAt(stops: GradientStop[], offset: number): string {
  const s = [...stops].sort((a, b) => a.offset - b.offset);
  if (offset <= s[0].offset) return s[0].color;
  for (let i = 1; i < s.length; i++) {
    if (offset <= s[i].offset) {
      const t = (offset - s[i - 1].offset) / (s[i].offset - s[i - 1].offset || 1);
      return mixColors(s[i - 1].color, s[i].color, t);
    }
  }
  return s[s.length - 1].color;
}

export function PaintField({ value, onChange, onCommit, box = { width: 100, height: 100 }, allowNone = true }: PaintFieldProps) {
  const t = useT();
  const [stopIndex, setStopIndex] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const isGradient = value.type === 'linear' || value.type === 'radial';
  const g = isGradient ? (value as LinearGradient | RadialGradient) : null;
  const sel = g ? Math.min(stopIndex, g.stops.length - 1) : 0;

  const setStops = (stops: GradientStop[], live = false) => {
    if (!g) return;
    onChange({ ...g, stops } as Paint, live);
  };

  const startStopDrag = (index: number, e: React.PointerEvent) => {
    if (!g || !barRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setStopIndex(index);
    const rect = barRef.current.getBoundingClientRect();
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const offset = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      setStops(
        g.stops.map((s, i) => (i === index ? { ...s, offset: Math.round(offset * 1000) / 1000 } : s)),
        true,
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) onCommit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const types: { type: Paint['type']; Icon: LucideIcon; label: string }[] = [
    ...(allowNone ? [{ type: 'none' as const, Icon: Ban, label: t('None') }] : []),
    { type: 'solid', Icon: Square, label: t('Solid color') },
    { type: 'linear', Icon: SquareDashed, label: t('Linear gradient') },
    { type: 'radial', Icon: Circle, label: t('Radial gradient') },
  ];

  return (
    <div className="vc-paint">
      <div className="row" style={{ gap: 4 }}>
        <div className="segmented vc-paint-types" role="radiogroup">
          {types.map(({ type, Icon, label }) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={value.type === type}
              className={value.type === type ? 'active' : ''}
              title={label}
              aria-label={label}
              onClick={() => onChange(convertPaint(value, type, box))}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
        {value.type === 'solid' && (
          <>
            <ColorPicker value={value.color} onChange={(c) => onChange({ type: 'solid', color: c }, true)} onCommit={() => onCommit()} label={t('Color')} />
            <input
              className="input sm mono vc-hex"
              key={value.color}
              defaultValue={value.color}
              aria-label={t('Color')}
              onBlur={(e) => {
                const c = normalizeColor(e.target.value);
                if (c && c !== value.color) onChange({ type: 'solid', color: c });
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </>
        )}
      </div>
      {g && (
        <div className="col" style={{ gap: 6 }}>
          <div
            ref={barRef}
            className="vc-grad-bar checker"
            title={t('Click to add a color stop')}
            onPointerDown={(e) => {
              if (!barRef.current) return;
              const rect = barRef.current.getBoundingClientRect();
              const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const stops = [...g.stops, { offset, color: interpolateAt(g.stops, offset) }];
              setStops(stops);
              setStopIndex(stops.length - 1);
            }}
          >
            <div className="vc-grad-fill" style={{ background: gradientCss(g.stops) }} />
            {g.stops.map((s, i) => (
              <span
                key={i}
                className={`vc-grad-stop ${i === sel ? 'sel' : ''}`}
                style={{ left: `${s.offset * 100}%`, background: s.color }}
                onPointerDown={(e) => startStopDrag(i, e)}
              />
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <ColorPicker
              value={g.stops[sel].color}
              onChange={(c) => setStops(g.stops.map((s, i) => (i === sel ? { ...s, color: c } : s)), true)}
              onCommit={() => onCommit()}
              label={t('Stop color')}
            />
            <NumberField
              small
              value={Math.round(g.stops[sel].offset * 100)}
              min={0}
              max={100}
              suffix="%"
              title={t('Stop position')}
              onChange={(v) => setStops(g.stops.map((s, i) => (i === sel ? { ...s, offset: v / 100 } : s)))}
            />
            <IconButton
              icon={ArrowLeftRight}
              size="sm"
              label={t('Reverse gradient')}
              onClick={() => setStops(g.stops.map((s) => ({ ...s, offset: 1 - s.offset })))}
            />
            <IconButton
              icon={Trash2}
              size="sm"
              label={t('Delete stop')}
              disabled={g.stops.length <= 2}
              onClick={() => {
                setStops(g.stops.filter((_, i) => i !== sel));
                setStopIndex(0);
              }}
            />
          </div>
          {value.type === 'linear' && (
            <Slider
              label={t('Angle')}
              min={-180}
              max={180}
              value={linearAngle(value, box)}
              format={(v) => `${Math.round(v)}°`}
              onChange={(v) => onChange({ ...value, ...linearAt(v, box) }, true)}
              onCommit={() => onCommit()}
              defaultValue={0}
            />
          )}
          {value.type === 'radial' && (
            <>
              <Slider
                label={t('Radius')}
                min={5}
                max={150}
                value={Math.round(((value.rx + value.ry) / 2) * 200)}
                format={(v) => `${Math.round(v)}%`}
                onChange={(v) => onChange({ ...value, rx: v / 200, ry: v / 200 }, true)}
                onCommit={() => onCommit()}
                defaultValue={100}
              />
              <div className="row" style={{ gap: 6 }}>
                <Slider label={t('Center X')} min={0} max={100} value={Math.round(value.cx * 100)} format={(v) => `${v}%`} onChange={(v) => onChange({ ...value, cx: v / 100 }, true)} onCommit={() => onCommit()} defaultValue={50} />
                <Slider label={t('Center Y')} min={0} max={100} value={Math.round(value.cy * 100)} format={(v) => `${v}%`} onChange={(v) => onChange({ ...value, cy: v / 100 }, true)} onCommit={() => onCommit()} defaultValue={50} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Small swatch showing a paint (none = red slash). */
export function PaintSwatch({ paint, size = 22 }: { paint: Paint; size?: number }) {
  const bg =
    paint.type === 'solid'
      ? paint.color
      : paint.type === 'linear'
        ? gradientCss(paint.stops)
        : paint.type === 'radial'
          ? `radial-gradient(${[...paint.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})`
          : undefined;
  return (
    <span className={`vc-paint-swatch checker ${paint.type === 'none' ? 'none' : ''}`} style={{ width: size, height: size }}>
      {bg && <span style={{ background: bg }} />}
    </span>
  );
}
