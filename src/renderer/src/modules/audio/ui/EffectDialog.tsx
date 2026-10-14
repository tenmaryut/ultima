import { useEffect, useRef, useState } from 'react';
import { Headphones, Square } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Badge, Button, Modal, NumberField, Select, Slider, Spinner, Toggle } from '../../../components/ui';
import { defaultParams, getEffect, type EffectId, type EffectParams, type ParamDef } from '../dsp/effects';
import type { EqBand } from '../dsp/filters';
import { audio } from '../controller';
import { setUI, useAudioUI, type Sel } from '../state';
import { analyze, applyEffect, captureNoisePrint, clearNoisePrint, previewEffect, stopPreview } from '../ops';
import { gainToDb } from '../dsp/basic';
import { formatClock } from './draw';
import { EqEditor } from './EqEditor';

/** Last used parameters per effect (kept while the app runs). */
const lastParams = new Map<EffectId, EffectParams>();

function formatValue(def: Extract<ParamDef, { type: 'number' }>, v: number): string {
  const decimals = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : 2;
  return `${v.toFixed(decimals)}${def.unit ? ` ${def.unit}` : ''}`;
}

function ParamControl({ def, value, onChange }: { def: ParamDef; value: unknown; onChange: (v: unknown) => void }) {
  const t = useT();
  if (def.type === 'number') {
    const v = typeof value === 'number' ? value : def.default;
    return (
      <div className="au-param">
        <div className="au-param-top">
          <span>{t(def.label)}</span>
          <NumberField small value={v} min={def.min} max={def.max} step={def.step} precision={def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : 2} suffix={def.unit} onChange={onChange} style={{ width: 110 }} />
        </div>
        <Slider value={v} min={def.min} max={def.max} step={def.step} defaultValue={def.default} onChange={onChange} format={(x) => formatValue(def, x)} />
      </div>
    );
  }
  if (def.type === 'select') {
    return (
      <div className="au-param au-param-inline">
        <span>{t(def.label)}</span>
        <Select small value={String(value ?? def.default)} options={def.options.map((o) => ({ value: o.value, label: t(o.label) }))} onChange={onChange} style={{ maxWidth: 200 }} />
      </div>
    );
  }
  if (def.type === 'boolean') {
    return (
      <div className="au-param au-param-inline">
        <Toggle checked={Boolean(value ?? def.default)} onChange={onChange} label={t(def.label)} />
      </div>
    );
  }
  return null;
}

export function EffectDialog({ effect, onClose }: { effect: EffectId; onClose: () => void }) {
  const t = useT();
  const def = getEffect(effect);
  const [params, setParams] = useState<EffectParams>(() => ({ ...defaultParams(effect), ...(lastParams.get(effect) ?? {}) }));
  const [previewOn, setPreviewOn] = useState(false);
  const [rendering, setRendering] = useState(false);
  const selection = useAudioUI((s) => s.selection);
  const noisePrint = useAudioUI((s) => s.noisePrint);
  const [scope, setScope] = useState<'selection' | 'all'>(selection && !def.changesChannels ? 'selection' : 'all');
  const [measure, setMeasure] = useState<{ peak: number; loudness: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewing = useAudioUI((s) => s.previewing);

  const range: Sel = scope === 'selection' && selection ? selection : { start: 0, end: audio.length };
  const sr = audio.sampleRate;

  // keep the preview in sync with the parameters (debounced)
  useEffect(() => {
    lastParams.set(effect, params);
    if (!previewOn) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setRendering(true);
      void previewEffect(effect, params).finally(() => setRendering(false));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [params, previewOn, effect]);

  // stop preview when it ends elsewhere (e.g. Space) and on close
  useEffect(() => {
    if (previewOn && !previewing && !rendering) setPreviewOn(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing]);
  useEffect(() => () => stopPreview(), []);

  // measurements for normalize
  useEffect(() => {
    if (effect !== 'normalize') return;
    let cancelled = false;
    void analyze(scope === 'selection' && selection ? 'selection' : 'all').then((stats) => {
      if (!cancelled && stats) setMeasure({ peak: stats.peak, loudness: stats.loudness });
    });
    return () => {
      cancelled = true;
    };
  }, [effect, scope, selection]);

  const set = (key: string, value: unknown) => setParams((p) => ({ ...p, [key]: value as EffectParams[string] }));

  const togglePreview = () => {
    if (previewOn) {
      setPreviewOn(false);
      stopPreview();
    } else {
      if (audio.player.playing) audio.stop();
      setPreviewOn(true);
    }
  };

  const apply = async () => {
    stopPreview();
    setPreviewOn(false);
    onClose();
    await applyEffect(effect, params, { range: def.changesChannels ? null : range });
  };

  const visible = def.params.filter((p) => {
    if (effect === 'normalize') {
      if (p.key === 'peakDb' || p.key === 'perChannel') return params.mode !== 'loudness';
      if (p.key === 'lufs' || p.key === 'limit') return params.mode === 'loudness';
    }
    return true;
  });
  const factor = Number(params.factor ?? 1);

  return (
    <Modal title={t(def.name)} onClose={onClose} wide={effect === 'eq'} width={effect === 'eq' ? undefined : 480}>
      <div className="muted" style={{ fontSize: 12.5 }}>
        {t(def.description)}
      </div>
      {effect === 'eq' ? (
        <EqEditor bands={params.bands as EqBand[]} sampleRate={sr} onChange={(bands) => set('bands', bands)} />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {visible.map((p) => (
            <ParamControl key={p.key} def={p} value={params[p.key]} onChange={(v) => set(p.key, v)} />
          ))}
        </div>
      )}
      {effect === 'speed' && (
        <div className="faint" style={{ fontSize: 12 }}>
          {t('New duration: {d}', { d: formatClock((range.end - range.start) / sr / Math.max(0.01, factor)) })}
        </div>
      )}
      {effect === 'normalize' && measure && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Badge>{t('Peak now: {v} dBFS', { v: Number.isFinite(gainToDb(measure.peak)) ? gainToDb(measure.peak).toFixed(1) : '-∞' })}</Badge>
          <Badge>{t('Loudness now: {v} LUFS', { v: Number.isFinite(measure.loudness) ? measure.loudness.toFixed(1) : '-∞' })}</Badge>
        </div>
      )}
      {def.usesNoiseProfile && (
        <div className="card au-noiseprint">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{t('Noise print')}</strong>
            {noisePrint ? <Badge tone="ok">{t('Captured ({s} s)', { s: noisePrint.duration.toFixed(2) })}</Badge> : <Badge tone="warn">{t('Automatic')}</Badge>}
          </div>
          <div className="faint" style={{ fontSize: 12 }}>
            {noisePrint
              ? t('The captured background noise is removed from the audio.')
              : t('No noise print captured: the quietest parts of the file are used. For best results select a few seconds of pure background noise and capture it.')}
          </div>
          <div className="row">
            <Button size="sm" disabled={!selection} onClick={() => captureNoisePrint() && setScope('all')}>
              {t('Capture from selection')}
            </Button>
            {noisePrint && (
              <Button size="sm" variant="ghost" onClick={() => clearNoisePrint()}>
                {t('Use automatic')}
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="row au-effect-scope">
        <span className="faint">{t('Apply to')}</span>
        {selection && !def.changesChannels ? (
          <Select<'selection' | 'all'>
            small
            value={scope}
            onChange={setScope}
            options={[
              { value: 'selection', label: t('Selection ({a} – {b})', { a: formatClock(selection.start / sr), b: formatClock(selection.end / sr) }) },
              { value: 'all', label: t('Whole file') },
            ]}
            style={{ maxWidth: 280 }}
          />
        ) : (
          <span>{t('Whole file')}</span>
        )}
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        {!def.changesChannels && (
          <Button icon={previewOn ? Square : Headphones} onClick={togglePreview} disabled={!audio.length}>
            {previewOn ? t('Stop preview') : t('Preview')}
          </Button>
        )}
        {rendering && <Spinner size={14} />}
        {previewOn && !rendering && <span className="faint" style={{ fontSize: 11.5 }}>{t('Looping the selection (max 20 s) with the effect')}</span>}
        <span className="spacer" />
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="primary" onClick={() => void apply()} disabled={!audio.length}>
          {t('Apply')}
        </Button>
      </div>
    </Modal>
  );
}

export function closeDialog(): void {
  setUI({ dialog: null });
}
