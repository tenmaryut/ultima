import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../../core/i18n';
import { Button, ColorPicker, Field, Modal, Segmented, Select, Slider, Spinner, Toggle } from '../../../components/ui';
import { ctx2d } from '../canvas';
import type { PhotoEngine } from '../engine';
import { LivePreview, pixelTarget } from '../pixelActions';
import { autoToneParams, histogram, type Histogram } from '../pixels/tone';
import {
  curveLut,
  DEFAULT_BLACK_WHITE,
  defaultCurves,
  defaultLevels,
  PHOTO_FILTER_PRESETS,
  type CurvePoint,
  type CurvesParams,
  type LevelsChannel,
  type LevelsParams,
} from '../pixels/adjust';
import type { PixelOp } from '../pixels/ops';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Params = Record<string, any>;

interface SliderField {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}

export interface OpDef {
  op: PixelOp;
  title: string;
  /** History label. */
  label: string;
  defaults: () => Params;
  fields?: SliderField[];
  editor?: 'levels' | 'curves' | 'hueSat' | 'colorBalance' | 'photoFilter' | 'blackWhite' | 'noise' | 'threshold';
}

export const OP_DEFS: Record<string, OpDef> = {
  brightnessContrast: {
    op: 'brightnessContrast',
    title: 'Brightness/Contrast',
    label: 'Brightness/Contrast',
    defaults: () => ({ brightness: 0, contrast: 0 }),
    fields: [
      { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
    ],
  },
  levels: { op: 'levels', title: 'Levels', label: 'Levels', defaults: () => defaultLevels(), editor: 'levels' },
  curves: { op: 'curves', title: 'Curves', label: 'Curves', defaults: () => defaultCurves(), editor: 'curves' },
  hueSaturation: { op: 'hueSaturation', title: 'Hue/Saturation', label: 'Hue/Saturation', defaults: () => ({ hue: 0, saturation: 0, lightness: 0, colorize: false }), editor: 'hueSat' },
  colorBalance: {
    op: 'colorBalance',
    title: 'Color Balance',
    label: 'Color Balance',
    defaults: () => ({ shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true }),
    editor: 'colorBalance',
  },
  vibrance: {
    op: 'vibrance',
    title: 'Vibrance',
    label: 'Vibrance',
    defaults: () => ({ vibrance: 0, saturation: 0 }),
    fields: [
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
    ],
  },
  exposure: {
    op: 'exposure',
    title: 'Exposure',
    label: 'Exposure',
    defaults: () => ({ exposure: 0, offset: 0, gamma: 1 }),
    fields: [
      { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01 },
      { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.001 },
      { key: 'gamma', label: 'Gamma correction', min: 0.1, max: 9.99, step: 0.01 },
    ],
  },
  blackWhite: { op: 'blackWhite', title: 'Black & White', label: 'Black & White', defaults: () => ({ ...DEFAULT_BLACK_WHITE }), editor: 'blackWhite' },
  photoFilter: { op: 'photoFilter', title: 'Photo Filter', label: 'Photo Filter', defaults: () => ({ color: '#ec8a00', density: 25, preserveLuminosity: true }), editor: 'photoFilter' },
  threshold: { op: 'threshold', title: 'Threshold', label: 'Threshold', defaults: () => ({ level: 128 }), editor: 'threshold' },
  posterize: { op: 'posterize', title: 'Posterize', label: 'Posterize', defaults: () => ({ levels: 4 }), fields: [{ key: 'levels', label: 'Levels', min: 2, max: 64 }] },
  gaussianBlur: { op: 'gaussianBlur', title: 'Gaussian Blur', label: 'Gaussian Blur', defaults: () => ({ radius: 4 }), fields: [{ key: 'radius', label: 'Radius', min: 0.1, max: 100, step: 0.1, suffix: 'px' }] },
  motionBlur: {
    op: 'motionBlur',
    title: 'Motion Blur',
    label: 'Motion Blur',
    defaults: () => ({ angle: 0, distance: 20 }),
    fields: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, suffix: '°' },
      { key: 'distance', label: 'Distance', min: 1, max: 300, suffix: 'px' },
    ],
  },
  unsharpMask: {
    op: 'unsharpMask',
    title: 'Unsharp Mask',
    label: 'Unsharp Mask',
    defaults: () => ({ amount: 100, radius: 1.5, threshold: 0 }),
    fields: [
      { key: 'amount', label: 'Amount', min: 1, max: 500, suffix: '%' },
      { key: 'radius', label: 'Radius', min: 0.1, max: 50, step: 0.1, suffix: 'px' },
      { key: 'threshold', label: 'Threshold', min: 0, max: 255 },
    ],
  },
  highPass: { op: 'highPass', title: 'High Pass', label: 'High Pass', defaults: () => ({ radius: 10 }), fields: [{ key: 'radius', label: 'Radius', min: 0.1, max: 250, step: 0.1, suffix: 'px' }] },
  addNoise: { op: 'addNoise', title: 'Add Noise', label: 'Add Noise', defaults: () => ({ amount: 12, distribution: 'gaussian', monochromatic: true, seed: 1 }), editor: 'noise' },
  median: { op: 'median', title: 'Reduce Noise (Median)', label: 'Reduce Noise', defaults: () => ({ radius: 1 }), fields: [{ key: 'radius', label: 'Radius', min: 1, max: 10, suffix: 'px' }] },
  pixelate: { op: 'pixelate', title: 'Pixelate', label: 'Pixelate', defaults: () => ({ size: 12 }), fields: [{ key: 'size', label: 'Cell size', min: 2, max: 200, suffix: 'px' }] },
  emboss: {
    op: 'emboss',
    title: 'Emboss',
    label: 'Emboss',
    defaults: () => ({ angle: 135, height: 3, amount: 100 }),
    fields: [
      { key: 'angle', label: 'Angle', min: -180, max: 180, suffix: '°' },
      { key: 'height', label: 'Height', min: 1, max: 10, suffix: 'px' },
      { key: 'amount', label: 'Amount', min: 1, max: 500, suffix: '%' },
    ],
  },
  vignette: {
    op: 'vignette',
    title: 'Vignette',
    label: 'Vignette',
    defaults: () => ({ amount: 50, size: 50, feather: 50 }),
    fields: [
      { key: 'amount', label: 'Amount', min: -100, max: 100 },
      { key: 'size', label: 'Size', min: 0, max: 100 },
      { key: 'feather', label: 'Feather', min: 0, max: 100 },
    ],
  },
  grain: {
    op: 'grain',
    title: 'Film Grain',
    label: 'Grain',
    defaults: () => ({ amount: 25, size: 1.5, seed: 7 }),
    fields: [
      { key: 'amount', label: 'Amount', min: 0, max: 100 },
      { key: 'size', label: 'Size', min: 1, max: 10, step: 0.1 },
    ],
  },
  oilPaint: {
    op: 'oilPaint',
    title: 'Oil Paint',
    label: 'Oil Paint',
    defaults: () => ({ radius: 3, levels: 24 }),
    fields: [
      { key: 'radius', label: 'Brush size', min: 1, max: 8 },
      { key: 'levels', label: 'Detail', min: 4, max: 64 },
    ],
  },
};

/* ------------------------------ histogram view ------------------------------ */

function drawHistogram(ctx: CanvasRenderingContext2D, hist: Uint32Array, w: number, h: number, color: string): void {
  let max = 1;
  for (let i = 1; i < 255; i++) max = Math.max(max, hist[i]);
  ctx.fillStyle = color;
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, hist[i] / max);
    const bh = Math.sqrt(v) * h;
    ctx.fillRect((i / 256) * w, h - bh, Math.max(1, w / 256), bh);
  }
}

function HistogramView({ hist, height = 90, marker }: { hist: Uint32Array; height?: number; marker?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = 256;
    c.height = height;
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, 256, height);
    drawHistogram(ctx, hist, 256, height, 'rgba(160,160,170,0.9)');
    if (marker !== undefined) {
      ctx.fillStyle = '#ff3b30';
      ctx.fillRect(marker, 0, 1, height);
    }
  }, [hist, height, marker]);
  return <canvas ref={ref} className="ph-histogram" style={{ height }} />;
}

/* ---------------------------------- Levels ---------------------------------- */

type Channel = 'rgb' | 'r' | 'g' | 'b';

function LevelsEditor({ value, onChange, hist }: { value: LevelsParams; onChange: (v: LevelsParams) => void; hist: Histogram }) {
  const t = useT();
  const [ch, setCh] = useState<Channel>('rgb');
  const c = value[ch];
  const set = (patch: Partial<LevelsChannel>) => onChange({ ...value, [ch]: { ...c, ...patch } });
  const h = ch === 'rgb' ? hist.l : hist[ch];
  return (
    <>
      <div className="row">
        <Segmented<Channel>
          value={ch}
          onChange={setCh}
          options={[
            { value: 'rgb', label: 'RGB' },
            { value: 'r', label: t('Red') },
            { value: 'g', label: t('Green') },
            { value: 'b', label: t('Blue') },
          ]}
        />
        <span className="spacer" />
        <Button size="sm" onClick={() => onChange(autoToneParams(hist, 0.001))}>
          {t('Auto')}
        </Button>
      </div>
      <HistogramView hist={h} />
      <Slider label={t('Input black')} value={c.inBlack} min={0} max={253} onChange={(v) => set({ inBlack: Math.min(v, c.inWhite - 2) })} defaultValue={0} />
      <Slider label={t('Midtones (gamma)')} value={c.gamma} min={0.1} max={9.99} step={0.01} onChange={(v) => set({ gamma: v })} defaultValue={1} />
      <Slider label={t('Input white')} value={c.inWhite} min={2} max={255} onChange={(v) => set({ inWhite: Math.max(v, c.inBlack + 2) })} defaultValue={255} />
      <Slider label={t('Output black')} value={c.outBlack} min={0} max={255} onChange={(v) => set({ outBlack: v })} defaultValue={0} />
      <Slider label={t('Output white')} value={c.outWhite} min={0} max={255} onChange={(v) => set({ outWhite: v })} defaultValue={255} />
    </>
  );
}

/* ---------------------------------- Curves ---------------------------------- */

function CurvesEditor({ value, onChange, hist }: { value: CurvesParams; onChange: (v: CurvesParams) => void; hist: Histogram }) {
  const t = useT();
  const [ch, setCh] = useState<Channel>('rgb');
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  const SIZE = 256;
  const pts = value[ch];
  const setPts = (p: CurvePoint[]) => onChange({ ...value, [ch]: p });

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = SIZE;
    c.height = SIZE;
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawHistogram(ctx, ch === 'rgb' ? hist.l : hist[ch], SIZE, SIZE, 'rgba(140,140,150,0.35)');
    ctx.strokeStyle = 'rgba(150,150,160,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * SIZE) / 4 + 0.5, 0);
      ctx.lineTo((i * SIZE) / 4 + 0.5, SIZE);
      ctx.moveTo(0, (i * SIZE) / 4 + 0.5);
      ctx.lineTo(SIZE, (i * SIZE) / 4 + 0.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    ctx.lineTo(SIZE, 0);
    ctx.stroke();
    const lut = curveLut(pts);
    ctx.strokeStyle = ch === 'r' ? '#ff4d4d' : ch === 'g' ? '#3ccf5a' : ch === 'b' ? '#4d8bff' : '#e6e6e6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) {
      const y = SIZE - (lut[x] / 255) * SIZE;
      if (x) ctx.lineTo((x / 255) * SIZE, y);
      else ctx.moveTo(0, y);
    }
    ctx.stroke();
    for (const [x, y] of pts) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect((x / 255) * SIZE - 4, SIZE - (y / 255) * SIZE - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
  }, [pts, ch, hist]);

  const toValue = (e: React.PointerEvent): CurvePoint => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255))), Math.round(Math.max(0, Math.min(255, (1 - (e.clientY - r.top) / r.height) * 255)))];
  };

  return (
    <>
      <div className="row">
        <Segmented<Channel>
          value={ch}
          onChange={setCh}
          options={[
            { value: 'rgb', label: 'RGB' },
            { value: 'r', label: t('Red') },
            { value: 'g', label: t('Green') },
            { value: 'b', label: t('Blue') },
          ]}
        />
        <span className="spacer" />
        <Button size="sm" onClick={() => setPts([[0, 0], [255, 255]])}>
          {t('Reset')}
        </Button>
      </div>
      <canvas
        ref={ref}
        className="ph-curves"
        aria-label={t('Curve')}
        onPointerDown={(e) => {
          const [vx, vy] = toValue(e);
          let idx = pts.findIndex(([x, y]) => Math.abs(x - vx) <= 8 && Math.abs(y - vy) <= 12);
          let next = pts;
          if (idx < 0) {
            next = [...pts, [vx, vy] as CurvePoint].sort((a, b) => a[0] - b[0]);
            idx = next.findIndex((p) => p[0] === vx && p[1] === vy);
            setPts(next);
          }
          drag.current = idx;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const i = drag.current;
          if (i === null) return;
          const [vx, vy] = toValue(e);
          const r = e.currentTarget.getBoundingClientRect();
          const outside = e.clientY > r.bottom + 30 || e.clientY < r.top - 30;
          const copy = pts.map((p) => [...p] as CurvePoint);
          if (outside && copy.length > 2) {
            copy.splice(i, 1);
            drag.current = null;
            setPts(copy);
            return;
          }
          const lo = i > 0 ? copy[i - 1][0] + 1 : 0;
          const hi = i < copy.length - 1 ? copy[i + 1][0] - 1 : 255;
          copy[i] = [Math.max(lo, Math.min(hi, vx)), vy];
          setPts(copy);
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={(e) => {
          const [vx, vy] = toValue(e as unknown as React.PointerEvent);
          const idx = pts.findIndex(([x, y]) => Math.abs(x - vx) <= 8 && Math.abs(y - vy) <= 12);
          if (idx >= 0 && pts.length > 2) setPts(pts.filter((_, i) => i !== idx));
        }}
      />
      <div className="faint" style={{ fontSize: 11 }}>
        {t('Click to add a point, drag to move it, double-click or drag it out to remove it.')}
      </div>
    </>
  );
}

/* --------------------------------- dialog --------------------------------- */

export function AdjustDialog({ engine, def, onClose }: { engine: PhotoEngine; def: OpDef; onClose: () => void }) {
  const t = useT();
  const [params, setParams] = useState<Params>(() => def.defaults());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewOn, setPreviewOn] = useState(true);
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const preview = useRef<LivePreview | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const target = await pixelTarget(engine);
      if (cancelled) return;
      if (!target) {
        onClose();
        return;
      }
      preview.current = new LivePreview(engine, target, def.op, (b) => !closed.current && setBusy(b));
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (!closed.current) preview.current?.cancel();
      closed.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const p = preview.current;
    if (!p || !ready) return;
    p.enabled = previewOn;
    p.update(params);
  }, [params, ready, previewOn]);

  const hist = useMemo(() => (ready && preview.current ? histogram(preview.current.target.data) : null), [ready]);

  const cancel = () => {
    closed.current = true;
    preview.current?.cancel();
    onClose();
  };
  const ok = async () => {
    const p = preview.current;
    if (!p) return;
    closed.current = true;
    setBusy(true);
    await p.apply(params, def.label);
    onClose();
  };
  const set = (patch: Params) => setParams((prev) => ({ ...prev, ...patch }));

  let body: React.ReactNode = null;
  if (!ready || !hist) body = <div className="row muted"><Spinner size={14} /> {t('Preparing…')}</div>;
  else if (def.editor === 'levels') body = <LevelsEditor value={params as LevelsParams} onChange={(v) => setParams(v)} hist={hist} />;
  else if (def.editor === 'curves') body = <CurvesEditor value={params as CurvesParams} onChange={(v) => setParams(v)} hist={hist} />;
  else if (def.editor === 'hueSat')
    body = (
      <>
        <Slider label={t('Hue')} value={params.hue} min={params.colorize ? 0 : -180} max={params.colorize ? 360 : 180} onChange={(v) => set({ hue: v })} defaultValue={0} />
        <Slider label={t('Saturation')} value={params.saturation} min={params.colorize ? 0 : -100} max={100} onChange={(v) => set({ saturation: v })} defaultValue={params.colorize ? 25 : 0} />
        <Slider label={t('Lightness')} value={params.lightness} min={-100} max={100} onChange={(v) => set({ lightness: v })} defaultValue={0} />
        <Toggle checked={params.colorize} onChange={(v) => set(v ? { colorize: true, hue: 30, saturation: 25 } : { colorize: false, hue: 0, saturation: 0 })} label={t('Colorize')} />
      </>
    );
  else if (def.editor === 'colorBalance') {
    const vals = params[tone] as number[];
    const setV = (i: number, v: number) => set({ [tone]: vals.map((x, j) => (j === i ? v : x)) });
    body = (
      <>
        <Segmented
          value={tone}
          onChange={setTone}
          options={[
            { value: 'shadows', label: t('Shadows') },
            { value: 'midtones', label: t('Midtones') },
            { value: 'highlights', label: t('Highlights') },
          ]}
        />
        <Slider label={`${t('Cyan')} ↔ ${t('Red')}`} value={vals[0]} min={-100} max={100} onChange={(v) => setV(0, v)} defaultValue={0} />
        <Slider label={`${t('Magenta')} ↔ ${t('Green')}`} value={vals[1]} min={-100} max={100} onChange={(v) => setV(1, v)} defaultValue={0} />
        <Slider label={`${t('Yellow')} ↔ ${t('Blue')}`} value={vals[2]} min={-100} max={100} onChange={(v) => setV(2, v)} defaultValue={0} />
        <Toggle checked={params.preserveLuminosity} onChange={(v) => set({ preserveLuminosity: v })} label={t('Preserve luminosity')} />
      </>
    );
  } else if (def.editor === 'photoFilter')
    body = (
      <>
        <Field label={t('Filter')}>
          <div className="row">
            <Select
              value={PHOTO_FILTER_PRESETS.find((p) => p.color === params.color)?.id ?? 'custom'}
              onChange={(id) => {
                const p = PHOTO_FILTER_PRESETS.find((x) => x.id === id);
                if (p) set({ color: p.color });
              }}
              options={[...PHOTO_FILTER_PRESETS.map((p) => ({ value: p.id, label: t(p.label) })), { value: 'custom', label: t('Custom color') }]}
            />
            <ColorPicker value={params.color} alpha={false} onChange={(c) => set({ color: c })} />
          </div>
        </Field>
        <Slider label={t('Density')} value={params.density} min={1} max={100} onChange={(v) => set({ density: v })} format={(v) => `${v}%`} />
        <Toggle checked={params.preserveLuminosity} onChange={(v) => set({ preserveLuminosity: v })} label={t('Preserve luminosity')} />
      </>
    );
  else if (def.editor === 'blackWhite')
    body = (
      <>
        {(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const).map((k) => (
          <Slider key={k} label={t(k[0].toUpperCase() + k.slice(1))} value={params[k]} min={-200} max={300} onChange={(v) => set({ [k]: v })} format={(v) => `${v}%`} defaultValue={DEFAULT_BLACK_WHITE[k]} />
        ))}
        <Toggle checked={params.tint} onChange={(v) => set({ tint: v })} label={t('Tint')} />
        {params.tint && (
          <>
            <Slider label={t('Hue')} value={params.tintHue} min={0} max={360} onChange={(v) => set({ tintHue: v })} />
            <Slider label={t('Saturation')} value={params.tintSaturation} min={0} max={100} onChange={(v) => set({ tintSaturation: v })} />
          </>
        )}
      </>
    );
  else if (def.editor === 'noise')
    body = (
      <>
        <Slider label={t('Amount')} value={params.amount} min={0} max={100} onChange={(v) => set({ amount: v })} format={(v) => `${v}%`} />
        <Segmented
          value={params.distribution}
          onChange={(v) => set({ distribution: v })}
          options={[
            { value: 'uniform', label: t('Uniform') },
            { value: 'gaussian', label: t('Gaussian') },
          ]}
        />
        <Toggle checked={params.monochromatic} onChange={(v) => set({ monochromatic: v })} label={t('Monochromatic')} />
      </>
    );
  else if (def.editor === 'threshold')
    body = (
      <>
        <HistogramView hist={hist.l} marker={params.level} />
        <Slider label={t('Threshold level')} value={params.level} min={1} max={255} onChange={(v) => set({ level: v })} defaultValue={128} />
      </>
    );
  else
    body = (def.fields ?? []).map((f) => (
      <Slider
        key={f.key}
        label={t(f.label)}
        value={params[f.key]}
        min={f.min}
        max={f.max}
        step={f.step ?? 1}
        onChange={(v) => set({ [f.key]: v })}
        format={(v) => `${Math.round(v * 100) / 100}${f.suffix ?? ''}`}
        defaultValue={def.defaults()[f.key]}
      />
    ));

  return (
    <Modal
      title={t(def.title)}
      onClose={cancel}
      footer={
        <>
          {busy && <Spinner size={14} />}
          <Toggle checked={previewOn} onChange={setPreviewOn} label={t('Preview')} />
          <span className="spacer" />
          <Button onClick={() => setParams(def.defaults())}>{t('Reset')}</Button>
          <Button onClick={cancel}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void ok()} disabled={!ready}>
            {t('OK')}
          </Button>
        </>
      }
    >
      <div className="ph-adjust col">{body}</div>
      {engine.doc?.selection && <div className="faint" style={{ fontSize: 11 }}>{t('Applied inside the selection only.')}</div>}
    </Modal>
  );
}
