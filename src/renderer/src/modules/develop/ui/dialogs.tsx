import { useMemo, useRef, useState } from 'react';
import { useT } from '../../../core/i18n';
import { fileBaseName, formatBytes } from '../../../core/utils/format';
import { Button, Modal, NumberField, ProgressBar, Segmented, Select, TextInput, Toggle, toast } from '../../../components/ui';
import { EMBED_LIMIT_BYTES } from '../catalog';
import { embeddableBytes, saveCatalog } from '../catalogio';
import { applyTemplate, exportSize, FORMAT_INFO, sanitizeExportOptions, type ExportFormat, type ExportOptions, type ResizeMode } from '../export-utils';
import { exportPhotos } from '../exporter';
import { geometry } from '../geometry';
import { GROUPS, type GroupId } from '../params';
import { AbortError } from '../render';
import { getPhoto, setStore, useDevelop } from '../store';
import { canDevelop, type Photo } from '../types';

const EXPORT_KEY = 'ultima-develop-export';

function loadExportOptions(): ExportOptions {
  try {
    return sanitizeExportOptions(JSON.parse(localStorage.getItem(EXPORT_KEY) ?? 'null'));
  } catch {
    return sanitizeExportOptions(null);
  }
}

/* --------------------------------- Export --------------------------------- */

export function ExportDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const t = useT();
  const [opts, setOpts] = useState<ExportOptions>(loadExportOptions);
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const photos = useMemo(() => ids.map((id) => getPhoto(id)).filter((p): p is Photo => Boolean(p) && canDevelop(p!)), [ids]);
  const skipped = ids.length - photos.length;
  const first = photos[0];
  const set = (patch: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const sample = first
    ? (() => {
        const geo = first.width ? geometry(first.settings, first.width, first.height) : null;
        const size = geo ? exportSize(geo.outW, geo.outH, opts.resize, opts.resizeValue, opts.allowEnlarge) : null;
        const name = applyTemplate(opts.template, { name: fileBaseName(first.name), n: 1, total: photos.length, date: first.captureDate, rating: first.rating, width: size?.width, height: size?.height });
        return { name: `${name}.${FORMAT_INFO[opts.format].ext}`, size };
      })()
    : null;

  const run = async () => {
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(opts));
    } catch {
      // not persisted
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ value: 0, label: t('Preparing…') });
    try {
      const result = await exportPhotos(
        photos.map((p) => p.id),
        opts,
        (p) => setProgress(p),
        ctrl.signal,
      );
      if (result.failed.length) toast.error(t('{count} photo(s) could not be exported', { count: result.failed.length }), result.failed.map((f) => `${f.name}: ${f.error}`).join('\n'));
      if (result.saved) toast.success(t('Exported {count} photo(s)', { count: result.exported }));
      onClose();
    } catch (error) {
      if (error instanceof AbortError || ctrl.signal.aborted) toast.info(t('Export cancelled'));
      else toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
      setProgress(null);
    } finally {
      abort.current = null;
    }
  };

  const tokens = ['{name}', '{n}', '{date}', '{rating}', '{width}', '{height}'];
  return (
    <Modal
      title={t('Export {count} photo(s)', { count: photos.length })}
      onClose={() => (progress ? abort.current?.abort() : onClose())}
      width={560}
      footer={
        progress ? (
          <Button variant="danger" onClick={() => abort.current?.abort()}>
            {t('Cancel')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" disabled={!photos.length} onClick={() => void run()}>
              {photos.length > 1 ? t('Export ZIP') : t('Export')}
            </Button>
          </>
        )
      }
    >
      {progress ? (
        <div className="col" style={{ gap: 10, padding: '8px 0' }}>
          <span className="muted">{progress.label}</span>
          <ProgressBar value={progress.value} />
        </div>
      ) : (
        <div className="dv-dialog-grid">
          <span className="muted">{t('Format')}</span>
          <Segmented<ExportFormat>
            value={opts.format}
            onChange={(v) => set({ format: v })}
            options={(Object.keys(FORMAT_INFO) as ExportFormat[]).map((f) => ({ value: f, label: FORMAT_INFO[f].label }))}
          />
          {opts.format !== 'png' && (
            <>
              <span className="muted">{t('Quality')}</span>
              <div className="dv-row">
                <input type="range" className="dv-range" min={10} max={100} value={opts.quality} onChange={(e) => set({ quality: Number(e.target.value) })} style={{ flex: 1, '--lo': '0%', '--hi': `${((opts.quality - 10) / 90) * 100}%` } as React.CSSProperties} aria-label={t('Quality')} />
                <span style={{ width: 32, textAlign: 'right' }}>{opts.quality}</span>
              </div>
            </>
          )}
          <span className="muted">{t('Resize')}</span>
          <div className="dv-row">
            <Select<ResizeMode>
              small
              value={opts.resize}
              onChange={(v) => set({ resize: v, resizeValue: v === 'megapixels' ? (opts.resizeValue > 400 ? 12 : opts.resizeValue) : opts.resizeValue < 64 ? 2048 : opts.resizeValue })}
              options={[
                { value: 'none', label: t('Full size') },
                { value: 'long', label: t('Long edge') },
                { value: 'short', label: t('Short edge') },
                { value: 'megapixels', label: t('Megapixels') },
              ]}
              style={{ width: 130 }}
            />
            {opts.resize !== 'none' && (
              <NumberField small value={opts.resizeValue} min={opts.resize === 'megapixels' ? 0.1 : 16} max={opts.resize === 'megapixels' ? 400 : 32768} step={opts.resize === 'megapixels' ? 1 : 64} suffix={opts.resize === 'megapixels' ? 'MP' : 'px'} style={{ width: 110 }} onChange={(v) => set({ resizeValue: v })} />
            )}
          </div>
          {opts.resize !== 'none' && (
            <>
              <span />
              <Toggle checked={opts.allowEnlarge} onChange={(v) => set({ allowEnlarge: v })} label={t('Allow enlarging')} />
            </>
          )}
          <span className="muted">{t('File name')}</span>
          <div className="col" style={{ gap: 4 }}>
            <TextInput small value={opts.template} onChange={(e) => set({ template: e.target.value })} aria-label={t('File name template')} />
            <div className="dv-row" style={{ gap: 4 }}>
              {tokens.map((tk) => (
                <button key={tk} type="button" className="dv-token" onClick={() => set({ template: `${opts.template}${opts.template.endsWith('-') || !opts.template ? '' : '-'}${tk}` })}>
                  {tk}
                </button>
              ))}
            </div>
          </div>
          {opts.format === 'jpeg' && (
            <>
              <span className="muted">{t('Metadata')}</span>
              <Toggle checked={opts.keepMetadata} onChange={(v) => set({ keepMetadata: v })} label={t('Keep camera EXIF data')} />
            </>
          )}
          <span className="muted">{t('Result')}</span>
          <span className="dv-hint" style={{ color: 'var(--text-1)' }}>
            {sample ? `${sample.name}${sample.size ? ` — ${sample.size.width} × ${sample.size.height} px` : ''}` : '—'}
            {photos.length > 1 ? ` · ${t('{count} files in one ZIP', { count: photos.length })}` : ''}
            {skipped > 0 ? ` · ${t('{count} skipped (missing or unsupported)', { count: skipped })}` : ''}
          </span>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------- Save catalog ------------------------------- */

export function SaveCatalogDialog({ saveAs, onClose }: { saveAs: boolean; onClose: () => void }) {
  const t = useT();
  const currentName = useDevelop((s) => s.catalogName);
  const lastEmbed = useDevelop((s) => s.catalogEmbed);
  const [name, setName] = useState(currentName);
  const info = embeddableBytes();
  const canEmbed = info.count > 0 && info.bytes <= EMBED_LIMIT_BYTES;
  const [embed, setEmbed] = useState(canEmbed && lastEmbed);
  const [progress, setProgress] = useState<number | null>(null);
  const save = async () => {
    setStore({ catalogName: name.trim() || 'Catalog', catalogEmbed: embed });
    setProgress(0);
    try {
      const ok = await saveCatalog({ saveAs, embed, onProgress: setProgress });
      if (ok) onClose();
    } catch (error) {
      toast.error(t('Could not save the catalog'), error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
    }
  };
  return (
    <Modal
      title={saveAs ? t('Save catalog as') : t('Save catalog')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={progress !== null}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <label className="field">
          <span className="field-label">{t('Catalog name')}</span>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} autoFocus />
        </label>
        <Toggle checked={embed} disabled={!canEmbed} onChange={setEmbed} label={t('Embed the photos in the catalog ({size})', { size: formatBytes(info.bytes) })} />
        <span className="dv-hint">
          {canEmbed
            ? embed
              ? t('The catalog is self-contained: it opens anywhere, with the photos inside.')
              : t('Only settings, ratings, flags and labels are saved. When you open the catalog, re-import the original files and the edits are matched by file name.')
            : info.count === 0
              ? t('No original files are available to embed.')
              : t('The photos are larger than {limit} together, so they can’t be embedded. Keep the original files: after opening the catalog you re-import them and the edits are matched by file name.', { limit: formatBytes(EMBED_LIMIT_BYTES) })}
        </span>
        {progress !== null && <ProgressBar value={progress} />}
      </div>
    </Modal>
  );
}

/* --------------------------- Settings groups picker --------------------------- */

export function GroupsDialog({
  title,
  confirmLabel,
  initial,
  nameLabel,
  defaultName,
  onConfirm,
  onClose,
}: {
  title: string;
  confirmLabel: string;
  initial: GroupId[];
  nameLabel?: string;
  defaultName?: string;
  onConfirm: (groups: GroupId[], name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [groups, setGroups] = useState<GroupId[]>(initial);
  const [name, setName] = useState(defaultName ?? '');
  const toggle = (g: GroupId) => setGroups((list) => (list.includes(g) ? list.filter((x) => x !== g) : [...list, g]));
  const ok = groups.length > 0 && (!nameLabel || name.trim().length > 0);
  const confirm = () => {
    if (!ok) return;
    onConfirm(groups, name.trim());
    onClose();
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => setGroups(GROUPS.map((g) => g.id))}>
            {t('Check all')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setGroups([])}>
            {t('Check none')}
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={!ok} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        {nameLabel && (
          <label className="field">
            <span className="field-label">{nameLabel}</span>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm()} autoFocus />
          </label>
        )}
        <div className="dv-check-grid">
          {GROUPS.map((g) => (
            <label key={g.id} className="dv-check">
              <input type="checkbox" checked={groups.includes(g.id)} onChange={() => toggle(g.id)} />
              {t(g.label)}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
