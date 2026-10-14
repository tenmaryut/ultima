import { useState } from 'react';
import { Button, ColorPicker, Field, Modal, NumberField, ProgressBar, Segmented, Select, Slider, TextInput, Toggle } from '../../components/ui';
import { useT } from '../../core/i18n';
import { isDesktop } from '../../core/platform';
import type { ExportOptions } from './fileActions';
import { ARTBOARD_PRESETS } from './model';

export function NewDocumentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (width: number, height: number, background: string | null, name: string) => void;
}) {
  const t = useT();
  const [preset, setPreset] = useState('square');
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1080);
  const [bgMode, setBgMode] = useState<'white' | 'transparent' | 'color'>('white');
  const [bg, setBg] = useState('#f4f1ea');
  const [name, setName] = useState('');
  const pick = (id: string) => {
    setPreset(id);
    const p = ARTBOARD_PRESETS.find((x) => x.id === id);
    if (p) {
      setW(p.width);
      setH(p.height);
    }
  };
  const create = () => onCreate(w, h, bgMode === 'transparent' ? null : bgMode === 'white' ? '#ffffff' : bg, name.trim() || 'Untitled');
  return (
    <Modal
      title={t('New document')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={create}>
            {t('Create')}
          </Button>
        </>
      }
    >
      <div className="vc-presets">
        {ARTBOARD_PRESETS.map((p) => {
          const scale = 54 / Math.max(p.width, p.height);
          return (
            <button key={p.id} type="button" className={`vc-preset ${preset === p.id ? 'active' : ''}`} onClick={() => pick(p.id)}>
              <span className="vc-preset-shape" style={{ width: Math.max(8, p.width * scale), height: Math.max(8, p.height * scale) }} />
              <span className="vc-preset-name">{t(p.label)}</span>
              <span className="faint">
                {p.width} × {p.height}
              </span>
            </button>
          );
        })}
        <button type="button" className={`vc-preset ${preset === 'custom' ? 'active' : ''}`} onClick={() => setPreset('custom')}>
          <span className="vc-preset-shape dashed" style={{ width: 40, height: 30 }} />
          <span className="vc-preset-name">{t('Custom')}</span>
          <span className="faint">
            {w} × {h}
          </span>
        </button>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <Field label={t('Name')}>
          <TextInput value={name} placeholder={t('Untitled')} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('Width')}>
          <NumberField value={w} min={1} max={100000} suffix="px" onChange={(v) => (setW(Math.round(v)), setPreset('custom'))} />
        </Field>
        <Field label={t('Height')}>
          <NumberField value={h} min={1} max={100000} suffix="px" onChange={(v) => (setH(Math.round(v)), setPreset('custom'))} />
        </Field>
      </div>
      <Field label={t('Background')}>
        <div className="row">
          <Segmented<'white' | 'transparent' | 'color'>
            value={bgMode}
            options={[
              { value: 'white', label: t('White') },
              { value: 'transparent', label: t('Transparent') },
              { value: 'color', label: t('Color') },
            ]}
            onChange={setBgMode}
          />
          {bgMode === 'color' && <ColorPicker value={bg} alpha={false} onChange={setBg} />}
        </div>
      </Field>
    </Modal>
  );
}

export function ExportDialog({
  onClose,
  onExport,
  artboardCount,
  hasSelection,
}: {
  onClose: () => void;
  onExport: (opts: ExportOptions, onProgress: (p: number) => void) => Promise<boolean>;
  artboardCount: number;
  hasSelection: boolean;
}) {
  const t = useT();
  const [opts, setOpts] = useState<ExportOptions>({ format: 'png', scope: 'current', scale: 2, transparent: false, quality: 0.92 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const set = (patch: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const scopes = [
    { value: 'current' as const, label: t('Current artboard') },
    ...(artboardCount > 1 ? [{ value: 'all' as const, label: t('All artboards ({count})', { count: artboardCount }) }] : []),
    ...(opts.format === 'svg' && hasSelection ? [{ value: 'selection' as const, label: t('Selection only') }] : []),
  ];
  const scope = scopes.some((s) => s.value === opts.scope) ? opts.scope : 'current';
  const run = async () => {
    setBusy(true);
    setProgress(0);
    const ok = await onExport({ ...opts, scope }, setProgress);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('Export')}
      onClose={() => !busy && onClose()}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy}>
            {busy ? t('Exporting…') : t('Export')}
          </Button>
        </>
      }
    >
      <Field label={t('Format')}>
        <Segmented<ExportOptions['format']>
          value={opts.format}
          options={[
            { value: 'svg', label: 'SVG' },
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
            { value: 'pdf', label: 'PDF' },
          ]}
          onChange={(format) => set({ format })}
        />
      </Field>
      <Field label={t('What to export')}>
        <Select<ExportOptions['scope']> value={scope} options={scopes} onChange={(v) => set({ scope: v })} />
      </Field>
      {(opts.format === 'png' || opts.format === 'jpg') && (
        <Field label={t('Scale')}>
          <Segmented<'1' | '2' | '4'>
            value={String(opts.scale) as '1' | '2' | '4'}
            options={[
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
              { value: '4', label: '4×' },
            ]}
            onChange={(v) => set({ scale: Number(v) })}
          />
        </Field>
      )}
      {(opts.format === 'png' || opts.format === 'svg') && (
        <Toggle label={t('Transparent background')} checked={opts.transparent} onChange={(v) => set({ transparent: v })} />
      )}
      {opts.format === 'jpg' && (
        <Slider label={t('Quality')} min={40} max={100} value={Math.round(opts.quality * 100)} format={(v) => `${v}%`} onChange={(v) => set({ quality: v / 100 })} />
      )}
      {opts.format === 'pdf' && (
        <div className="faint" style={{ fontSize: 12 }}>
          {isDesktop ? t('Vector PDF, one page per artboard.') : t('In the browser, PDF pages are high-resolution images. The desktop app exports vector PDFs.')}
        </div>
      )}
      {scope === 'all' && opts.format !== 'pdf' && <div className="faint" style={{ fontSize: 12 }}>{t('Several artboards are saved together as a ZIP file.')}</div>}
      {busy && <ProgressBar value={progress} />}
    </Modal>
  );
}
