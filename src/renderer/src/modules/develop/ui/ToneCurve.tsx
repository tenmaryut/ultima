import { useMemo, useRef, useState } from 'react';
import { useT } from '../../../core/i18n';
import { Select, Segmented } from '../../../components/ui';
import { buildCurve } from '../curve';
import { CURVE_KEYS, SECTION_GROUPS, curveIsIdentity, identityCurve, type CurveChannel, type CurvePoint, type DevelopSettings } from '../params';
import { resetSection } from '../ops';
import { getPhoto, useDevelop } from '../store';
import type { Photo } from '../types';
import { editorFor, Section } from './common';

const CHANNEL_COLORS: Record<CurveChannel, string> = { rgb: 'var(--text-0)', red: '#e5484d', green: '#30a46c', blue: '#3e8ef7' };

const CURVE_PRESETS: { id: string; label: string; points: CurvePoint[] }[] = [
  { id: 'linear', label: 'Linear', points: identityCurve() },
  { id: 'medium', label: 'Medium Contrast', points: [[0, 0], [0.25, 0.22], [0.75, 0.78], [1, 1]] },
  { id: 'strong', label: 'Strong Contrast', points: [[0, 0], [0.25, 0.17], [0.75, 0.85], [1, 1]] },
  { id: 'fade', label: 'Faded Blacks', points: [[0, 0.09], [0.3, 0.3], [1, 1]] },
  { id: 'soft', label: 'Soft Highlights', points: [[0, 0], [0.7, 0.72], [1, 0.92]] },
];

function curvePath(points: CurvePoint[]): string {
  const fn = buildCurve(points);
  const parts: string[] = [];
  for (let i = 0; i <= 96; i++) {
    const x = i / 96;
    const y = Math.max(0, Math.min(1, fn(x)));
    parts.push(`${i ? 'L' : 'M'}${(x * 256).toFixed(2)},${((1 - y) * 256).toFixed(2)}`);
  }
  return parts.join(' ');
}

export function ToneCurvePanel({ photo }: { photo: Photo }) {
  const t = useT();
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const ed = editorFor(photo);
  const key = CURVE_KEYS[channel];
  const points = photo.settings[key];
  const histogram = useDevelop((s) => s.histogram);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; remove: boolean } | null>(null);
  const [readout, setReadout] = useState<string | null>(null);

  const histPath = useMemo(() => {
    if (!histogram?.total) return '';
    const ch = channel === 'red' ? histogram.r : channel === 'green' ? histogram.g : channel === 'blue' ? histogram.b : histogram.l;
    let max = 1;
    for (let i = 1; i < 255; i++) max = Math.max(max, ch[i]);
    let d = 'M0,256';
    for (let i = 0; i < 256; i++) d += ` L${i},${(256 - Math.min(1, Math.sqrt(ch[i] / max)) * 240).toFixed(1)}`;
    return `${d} L256,256 Z`;
  }, [histogram, channel]);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  };
  const setPoints = (next: CurvePoint[]) => ed.live({ [key]: next } as Partial<DevelopSettings>);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toNorm(e);
    const r = boxRef.current!.getBoundingClientRect();
    const tol = 10 / r.width;
    let index = points.findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < tol * 1.4);
    let next = points;
    if (index < 0) {
      const x = Math.max(0, Math.min(1, p.x));
      if (points.some(([px]) => Math.abs(px - x) < 0.015) || points.length >= 16) return;
      next = [...points, [x, Math.max(0, Math.min(1, p.y))] as CurvePoint].sort((a, b) => a[0] - b[0]);
      index = next.findIndex(([px]) => px === x);
      setPoints(next);
    }
    drag.current = { index, remove: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setReadout(`${Math.round(next[index][0] * 255)} → ${Math.round(next[index][1] * 255)}`);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toNorm(e);
    if (!drag.current) {
      if (e.buttons === 0) setReadout(p.x >= 0 && p.x <= 1 ? `${Math.round(p.x * 255)}` : null);
      return;
    }
    const base = getPhoto(photo.id)?.settings[key] ?? points;
    const i = drag.current.index;
    if (i < 0 || i >= base.length) return;
    const lo = i === 0 ? 0 : base[i - 1][0] + 0.01;
    const hi = i === base.length - 1 ? 1 : base[i + 1][0] - 0.01;
    const interior = i > 0 && i < base.length - 1;
    drag.current.remove = interior && (p.y < -0.12 || p.y > 1.12);
    const x = Math.max(lo, Math.min(hi, p.x));
    const y = Math.max(0, Math.min(1, p.y));
    const next = base.map((pt, k) => (k === i ? ([x, y] as CurvePoint) : pt));
    setPoints(next);
    setReadout(drag.current.remove ? t('Release to remove the point') : `${Math.round(x * 255)} → ${Math.round(y * 255)}`);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.remove) {
      const cur = getPhoto(photo.id)?.settings[key] ?? points;
      setPoints(cur.filter((_, k) => k !== d.index));
    }
    ed.commit(t('Tone Curve'));
    setReadout(null);
  };

  const removeAt = (index: number) => {
    if (index <= 0 || index >= points.length - 1) return;
    ed.apply({ [key]: points.filter((_, k) => k !== index) } as Partial<DevelopSettings>, t('Tone Curve'));
  };

  const others = (['red', 'green', 'blue'] as CurveChannel[]).filter((c) => c !== channel && !curveIsIdentity(photo.settings[CURVE_KEYS[c]]));
  return (
    <Section title={t('Tone Curve')} onReset={() => resetSection(photo.id, SECTION_GROUPS.curve, `${t('Reset')} ${t('Tone Curve')}`)}>
      <div className="dv-row" style={{ justifyContent: 'space-between' }}>
        <Segmented<CurveChannel>
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'rgb', label: 'RGB', title: t('Master curve') },
            { value: 'red', label: 'R', title: t('Red channel') },
            { value: 'green', label: 'G', title: t('Green channel') },
            { value: 'blue', label: 'B', title: t('Blue channel') },
          ]}
        />
        <Select
          small
          value=""
          style={{ width: 110 }}
          aria-label={t('Curve presets')}
          options={[{ value: '', label: t('Presets…') }, ...CURVE_PRESETS.map((p) => ({ value: p.id, label: t(p.label) }))]}
          onChange={(id) => {
            const preset = CURVE_PRESETS.find((p) => p.id === id);
            if (preset) ed.apply({ [key]: preset.points.map((p) => [...p] as CurvePoint) } as Partial<DevelopSettings>, t('Tone Curve'));
          }}
        />
      </div>
      <div
        ref={boxRef}
        className="dv-curve"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !drag.current && setReadout(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg viewBox="0 0 256 256" preserveAspectRatio="none">
          {histPath && <path d={histPath} fill="var(--text-3)" opacity={0.25} />}
          {[64, 128, 192].map((v) => (
            <g key={v} stroke="var(--border-strong)" strokeWidth={0.6} vectorEffect="non-scaling-stroke">
              <line x1={v} y1={0} x2={v} y2={256} />
              <line x1={0} y1={v} x2={256} y2={v} />
            </g>
          ))}
          <line x1={0} y1={256} x2={256} y2={0} stroke="var(--text-3)" strokeWidth={0.8} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {others.map((c) => (
            <path key={c} d={curvePath(photo.settings[CURVE_KEYS[c]])} fill="none" stroke={CHANNEL_COLORS[c]} strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={curvePath(points)} fill="none" stroke={CHANNEL_COLORS[channel]} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
          {points.map(([x, y], i) => (
            <circle
              key={i}
              cx={x * 256}
              cy={(1 - y) * 256}
              r={4.5}
              fill="var(--bg-1)"
              stroke={CHANNEL_COLORS[channel]}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                removeAt(i);
              }}
            />
          ))}
        </svg>
        {readout && <span className="dv-curve-readout">{readout}</span>}
      </div>
      <span className="dv-hint">{t('Click to add a point, drag to shape, double-click or drag a point out to remove it.')}</span>
    </Section>
  );
}
