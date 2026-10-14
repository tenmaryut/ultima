import { ClipboardCopy, ClipboardPaste, Copy, Sparkles, Star, Wand } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { formatBytes } from '../../../core/utils/format';
import { Button, Panel, Select } from '../../../components/ui';
import { cameraName, formatAperture, formatFocal, formatShutter } from '../exif';
import { clampParam } from '../params';
import { applyPreset, autoToneFor, autoWhiteBalance, pasteSettings, resetAll } from '../ops';
import { allPresets, usePresetStore } from '../presets';
import { applyToPhotos, selectedIds, setFlag, setLabel, setRating, useDevelop } from '../store';
import type { Photo } from '../types';
import { FlagButtons, LabelButtons, Stars } from './common';

export function QuickDevelopPanel({ onSync, onAIAutoEdit, onAICull, onCopy }: { onSync: () => void; onAIAutoEdit: () => void; onAICull: () => void; onCopy: () => void }) {
  const t = useT();
  const count = useDevelop((s) => s.selected.length);
  const hasClipboard = useDevelop((s) => Boolean(s.clipboard));
  usePresetStore((s) => s.user);
  const presets = allPresets();
  const exposure = (delta: number) =>
    applyToPhotos(selectedIds(), (s) => ({ ...s, exposure: clampParam('exposure', s.exposure + delta) }), `${t('Exposure')} ${delta > 0 ? '+' : ''}${delta.toFixed(2)}`);
  const n = Math.max(count, 1);
  return (
    <Panel title={t('Quick Develop')}>
      <span className="dv-hint">{t('Applies to {count} selected photo(s).', { count: n })}</span>
      <Select
        small
        value=""
        aria-label={t('Apply preset')}
        options={[{ value: '', label: t('Apply preset…') }, ...presets.map((p) => ({ value: p.id, label: p.builtin ? t(p.name) : p.name }))]}
        onChange={(id) => {
          const p = presets.find((x) => x.id === id);
          if (p) void applyPreset(selectedIds(), p);
        }}
      />
      <div className="dv-row">
        <span className="dv-subhead" style={{ margin: 0, minWidth: 62 }}>
          {t('Exposure')}
        </span>
        {[-1, -1 / 3, 1 / 3, 1].map((d) => (
          <Button key={d} size="sm" onClick={() => exposure(d)} title={`${d > 0 ? '+' : ''}${d.toFixed(2)} EV`}>
            {d === -1 ? '−1' : d === 1 ? '+1' : d < 0 ? '−⅓' : '+⅓'}
          </Button>
        ))}
      </div>
      <div className="dv-row">
        <Button size="sm" icon={Wand} onClick={() => void autoToneFor(selectedIds())}>
          {t('Auto Tone')}
        </Button>
        <Button size="sm" onClick={() => void autoWhiteBalance(selectedIds())}>
          {t('Auto WB')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => resetAll(selectedIds())}>
          {t('Reset')}
        </Button>
      </div>
      <div className="dv-row">
        <Button size="sm" icon={ClipboardCopy} onClick={onCopy} title="Ctrl+Shift+C">
          {t('Copy')}
        </Button>
        <Button size="sm" icon={ClipboardPaste} disabled={!hasClipboard} onClick={() => pasteSettings(selectedIds())} title="Ctrl+Shift+V">
          {t('Paste')}
        </Button>
        <Button size="sm" icon={Copy} disabled={count < 2} onClick={onSync}>
          {t('Sync…')}
        </Button>
      </div>
      <span className="dv-subhead">{t('AI')}</span>
      <div className="dv-row">
        <Button size="sm" icon={Sparkles} onClick={onAIAutoEdit}>
          {t('AI Auto Edit')}
        </Button>
        <Button size="sm" icon={Star} onClick={onAICull}>
          {t('AI ratings')}
        </Button>
      </div>
    </Panel>
  );
}

export function MetadataPanel({ photo }: { photo?: Photo }) {
  const t = useT();
  if (!photo) {
    return (
      <Panel title={t('Metadata')}>
        <span className="dv-hint">{t('Select a photo to see its details.')}</span>
      </Panel>
    );
  }
  const e = photo.exif;
  const rows: [string, string | undefined][] = [
    [t('File'), photo.name],
    [t('Size'), photo.width ? `${photo.width} × ${photo.height} px (${((photo.width * photo.height) / 1e6).toFixed(1)} MP)` : undefined],
    [t('File size'), photo.size ? formatBytes(photo.size) : undefined],
    [t('Captured'), e?.date ? new Date(e.date).toLocaleString() : undefined],
    [t('Modified'), photo.lastModified ? new Date(photo.lastModified).toLocaleString() : undefined],
    [t('Camera'), cameraName(e)],
    [t('Lens'), e?.lens],
    [t('Exposure'), [formatShutter(e?.exposureTime), formatAperture(e?.fNumber), e?.iso ? `ISO ${e.iso}` : undefined].filter(Boolean).join('  ·  ') || undefined],
    [t('Focal length'), e?.focalLength ? `${formatFocal(e.focalLength)}${e.focalLength35 && e.focalLength35 !== e.focalLength ? ` (${e.focalLength35} mm eq.)` : ''}` : undefined],
    [t('Exposure bias'), e?.exposureBias ? `${e.exposureBias > 0 ? '+' : ''}${e.exposureBias.toFixed(1)} EV` : undefined],
    [t('Flash'), e?.flash === undefined ? undefined : e.flash ? t('Fired') : t('Did not fire')],
    [t('Software'), e?.software],
    [t('Artist'), e?.artist],
    [t('Copyright'), e?.copyright],
    [t('GPS'), e?.gps ? `${e.gps.lat.toFixed(5)}, ${e.gps.lon.toFixed(5)}` : undefined],
  ];
  return (
    <Panel title={t('Metadata')}>
      <div className="dv-row" style={{ justifyContent: 'space-between' }}>
        <Stars value={photo.rating} onChange={(v) => setRating(selectedIds(), v)} size={15} />
        <FlagButtons value={photo.flag} onChange={(f) => setFlag(selectedIds(), f)} />
      </div>
      <LabelButtons value={photo.label} onChange={(l) => setLabel(selectedIds(), l)} />
      <dl className="dv-meta">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd title={v}>{v}</dd>
            </div>
          ))}
      </dl>
      {photo.note && <span className="dv-hint">{photo.note}</span>}
      {photo.error && <span className="dv-hint" style={{ color: 'var(--warning)' }}>{photo.error}</span>}
    </Panel>
  );
}
