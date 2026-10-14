import { useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton, NumberField, Select } from '../../../components/ui';
import { BIQUAD_TYPES, EQ_PRESETS, MAX_EQ_BANDS, bandUsesGain, eqResponseDb, type BiquadType, type EqBand } from '../dsp/filters';

const F_MIN = 20;
const F_MAX = 20000;
const DB_RANGE = 24;

const TYPE_LABELS: Record<BiquadType, string> = {
  peaking: 'Bell',
  lowshelf: 'Low shelf',
  highshelf: 'High shelf',
  lowpass: 'Low-pass',
  highpass: 'High-pass',
  bandpass: 'Band-pass',
  notch: 'Notch',
};

const BAND_COLORS = ['#10d9b0', '#5b9cff', '#f5a524', '#e85d9b', '#a78bfa', '#4ade80'];

export function EqEditor({ bands, sampleRate, onChange }: { bands: EqBand[]; sampleRate: number; onChange: (bands: EqBand[]) => void }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<number | null>(null);
  const bandsRef = useRef(bands);
  bandsRef.current = bands;

  const xOfFreq = (f: number, w: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
  const freqOfX = (x: number, w: number) => F_MIN * Math.pow(F_MAX / F_MIN, Math.max(0, Math.min(1, x / w)));
  const yOfDb = (db: number, h: number) => h / 2 - (db / DB_RANGE) * (h / 2 - 6);
  const dbOfY = (y: number, h: number) => ((h / 2 - y) / (h / 2 - 6)) * DB_RANGE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(canvas);
    const grid = cs.getPropertyValue('--border').trim() || '#333';
    const text = cs.getPropertyValue('--text-3').trim() || '#777';
    const accent = cs.getPropertyValue('--accent').trim() || '#10d9b0';
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = grid;
    ctx.fillStyle = text;
    ctx.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
    ctx.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      const x = Math.round(xOfFreq(f, w)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, h - 3);
    }
    for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
      const y = Math.round(yOfDb(db, h)) + 0.5;
      ctx.globalAlpha = db === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(`${db > 0 ? '+' : ''}${db}`, 3, y - 2);
    }
    const freqs = new Float32Array(Math.max(2, Math.round(w)));
    for (let i = 0; i < freqs.length; i++) freqs[i] = freqOfX(i, w);
    const resp = eqResponseDb(bands, sampleRate, freqs);
    ctx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const y = yOfDb(Math.max(-DB_RANGE - 6, Math.min(DB_RANGE + 6, resp[i])), h);
      if (i === 0) ctx.moveTo(i, y);
      else ctx.lineTo(i, y);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(w, yOfDb(0, h));
    ctx.lineTo(0, yOfDb(0, h));
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.globalAlpha = 1;
    bands.forEach((b, i) => {
      const x = xOfFreq(b.freq, w);
      const y = yOfDb(bandUsesGain(b.type) ? b.gain : 0, h);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = b.enabled ? BAND_COLORS[i % BAND_COLORS.length] : grid;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText(String(i + 1), x - 2.5, y + 3);
    });
  }, [bands, sampleRate]);

  const update = (index: number, patch: Partial<EqBand>) => onChange(bandsRef.current.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestDist = 14;
    bands.forEach((b, i) => {
      const d = Math.hypot(xOfFreq(b.freq, rect.width) - x, yOfDb(bandUsesGain(b.type) ? b.gain : 0, rect.height) - y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best < 0) return;
    dragRef.current = best;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const i = dragRef.current;
    if (i === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const b = bandsRef.current[i];
    const freq = Math.round(freqOfX(e.clientX - rect.left, rect.width));
    const gain = Math.round(Math.max(-DB_RANGE, Math.min(DB_RANGE, dbOfY(e.clientY - rect.top, rect.height))) * 10) / 10;
    update(i, bandUsesGain(b.type) ? { freq, gain } : { freq });
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = -1;
    let bestDist = 30;
    bands.forEach((b, i) => {
      const d = Math.abs(xOfFreq(b.freq, rect.width) - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best < 0) return;
    const q = Math.min(18, Math.max(0.1, bands[best].q * Math.exp(-e.deltaY * 0.002)));
    update(best, { q: Math.round(q * 100) / 100 });
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row">
        <Select
          small
          value=""
          options={[{ value: '', label: t('Load preset…') }, ...EQ_PRESETS.map((p) => ({ value: p.id, label: t(p.name) }))]}
          onChange={(id) => {
            const preset = EQ_PRESETS.find((p) => p.id === id);
            if (preset) onChange(preset.bands.map((b) => ({ ...b })));
          }}
          style={{ maxWidth: 220 }}
        />
        <span className="faint" style={{ fontSize: 11 }}>
          {t('Drag the points · wheel over a point changes its width (Q)')}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="au-eq-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragRef.current = null)}
        onWheel={onWheel}
      />
      <div className="au-eq-bands">
        {bands.map((b, i) => (
          <div key={i} className="au-eq-band">
            <input type="checkbox" checked={b.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} title={t('Enabled')} />
            <span className="au-eq-dot" style={{ background: BAND_COLORS[i % BAND_COLORS.length] }}>
              {i + 1}
            </span>
            <Select small value={b.type} options={BIQUAD_TYPES.map((ty) => ({ value: ty, label: t(TYPE_LABELS[ty]) }))} onChange={(type) => update(i, { type })} />
            <NumberField small value={b.freq} min={20} max={20000} step={10} suffix="Hz" onChange={(freq) => update(i, { freq })} />
            <NumberField small value={b.gain} min={-24} max={24} step={0.5} suffix="dB" disabled={!bandUsesGain(b.type)} onChange={(gain) => update(i, { gain })} />
            <NumberField small value={b.q} min={0.1} max={18} step={0.1} suffix="Q" onChange={(q) => update(i, { q })} />
            <IconButton icon={X} size="sm" label={t('Remove band')} onClick={() => onChange(bands.filter((_, j) => j !== i))} />
          </div>
        ))}
        {bands.length < MAX_EQ_BANDS && (
          <Button size="sm" icon={Plus} onClick={() => onChange([...bands, { type: 'peaking', freq: 1000, gain: 0, q: 1, enabled: true }])}>
            {t('Add band')}
          </Button>
        )}
      </div>
    </div>
  );
}
