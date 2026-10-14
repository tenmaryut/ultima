/**
 * Dialogs for page operations: split, images → PDF / insert images, export page images.
 */
import { useMemo, useState } from 'react';
import { FileImage, Images, Scissors } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { pickFiles } from '../../../core/platform';
import { saveFile } from '../../../core/platform';
import { fileBaseName } from '../../../core/utils/format';
import { Button, Field, Modal, NumberField, Segmented, Select, Slider, TextInput, toast } from '../../../components/ui';
import { useDoc } from '../context';
import { insertFiles, loadPdfSource, showDocument } from '../docActions';
import { imagesToPdf, type ImagesToPdfOptions } from '../imagepdf';
import { exportImages } from '../output';
import { splitToZip } from '../pageActions';
import { formatPageList, parsePageSet, parseRangeGroups, splitEvery } from '../ranges';
import { usePdfUi } from '../store';

export function SplitDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const history = useDoc();
  const total = history.present.pages.length;
  const [mode, setMode] = useState<'every' | 'ranges'>('every');
  const [n, setN] = useState(1);
  const [ranges, setRanges] = useState(total > 3 ? `1-${Math.ceil(total / 2)}, ${Math.ceil(total / 2) + 1}-${total}` : '1');
  const parsed = useMemo(() => (mode === 'every' ? { groups: splitEvery(total, n), error: undefined } : parseRangeGroups(ranges, total)), [mode, n, ranges, total]);
  return (
    <Modal
      title={t('Split document')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            icon={Scissors}
            disabled={!!parsed.error || !parsed.groups.length}
            onClick={() => {
              onClose();
              void splitToZip(history, parsed.groups);
            }}
          >
            {t('Split into {count} files', { count: parsed.groups.length })}
          </Button>
        </>
      }
    >
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'every', label: t('Every N pages') },
          { value: 'ranges', label: t('By page ranges') },
        ]}
      />
      {mode === 'every' ? (
        <Field label={t('Pages per file')}>
          <NumberField value={n} min={1} max={Math.max(1, total)} step={1} onChange={(v) => setN(Math.round(v))} />
        </Field>
      ) : (
        <Field label={t('One file per range, e.g. 1-3, 4-6, 7-')}>
          <TextInput value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3, 4-6" />
        </Field>
      )}
      {parsed.error ? (
        <div className="pd-error-text">{parsed.error}</div>
      ) : (
        <div className="faint" style={{ fontSize: 12 }}>
          {parsed.groups
            .slice(0, 8)
            .map((g, i) => `${i + 1}: ${t('pages')} ${formatPageList(g)}`)
            .join(' · ')}
          {parsed.groups.length > 8 ? ' …' : ''}
        </div>
      )}
      <div className="faint" style={{ fontSize: 12 }}>{t('The files are saved together in a ZIP archive. Annotations are included.')}</div>
    </Modal>
  );
}

function ImageOptions({ value, onChange }: { value: ImagesToPdfOptions; onChange: (v: ImagesToPdfOptions) => void }) {
  const t = useT();
  return (
    <>
      <Field label={t('Page size')}>
        <Segmented
          value={value.size}
          onChange={(size) => onChange({ ...value, size, margin: size === 'fit' ? 0 : value.margin || 28 })}
          options={[
            { value: 'fit', label: t('Fit image') },
            { value: 'a4', label: 'A4' },
            { value: 'letter', label: 'Letter' },
          ]}
        />
      </Field>
      {value.size !== 'fit' && (
        <div className="pd-grid2">
          <Field label={t('Orientation')}>
            <Select
              small
              value={value.orientation}
              onChange={(orientation) => onChange({ ...value, orientation })}
              options={[
                { value: 'auto', label: t('Automatic') },
                { value: 'portrait', label: t('Portrait') },
                { value: 'landscape', label: t('Landscape') },
              ]}
            />
          </Field>
          <Field label={t('Margin')}>
            <Select
              small
              value={String(value.margin)}
              onChange={(m) => onChange({ ...value, margin: Number(m) })}
              options={[
                { value: '0', label: t('None') },
                { value: '14', label: t('Small') },
                { value: '28', label: t('Normal') },
                { value: '56', label: t('Large') },
              ]}
            />
          </Field>
        </div>
      )}
    </>
  );
}

/** Images → new PDF, or images inserted into the open document. */
export function ImagesDialog({ onClose, insert }: { onClose: () => void; insert: boolean }) {
  const t = useT();
  const history = useDoc();
  const [files, setFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<ImagesToPdfOptions>({ size: 'a4', orientation: 'auto', margin: 28 });
  const [working, setWorking] = useState(false);
  const choose = async () => {
    const picked = await pickFiles({ accept: 'image/*', multiple: true });
    if (picked.length) setFiles((f) => [...f, ...picked]);
  };
  const run = async () => {
    if (!files.length) return;
    setWorking(true);
    try {
      if (insert) {
        await insertFiles(files, history, usePdfUi.getState().currentPage + 1, options);
      } else {
        usePdfUi.getState().set({ busy: { label: t('Creating PDF…'), progress: 0 } });
        const bytes = await imagesToPdf(files, options, (d, total) => usePdfUi.getState().set({ busy: { label: t('Creating PDF…'), progress: d / total } }));
        const name = files.length === 1 ? `${fileBaseName(files[0].name)}.pdf` : t('Images.pdf');
        const src = await loadPdfSource(bytes, name);
        await showDocument([src], name, history);
        const info = usePdfUi.getState().docInfo;
        if (info) usePdfUi.getState().set({ docInfo: { ...info, savedState: null } });
      }
      onClose();
    } catch (error) {
      toast.error(t('Could not create the PDF'), error instanceof Error ? error.message : String(error));
    } finally {
      usePdfUi.getState().set({ busy: null });
      setWorking(false);
    }
  };
  return (
    <Modal
      title={insert ? t('Insert images') : t('Images to PDF')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" icon={Images} disabled={!files.length || working} onClick={() => void run()}>
            {insert ? t('Insert {count} page(s)', { count: files.length }) : t('Create PDF ({count} pages)', { count: files.length })}
          </Button>
        </>
      }
    >
      <div className="row">
        <Button icon={Images} onClick={() => void choose()}>
          {t('Add images…')}
        </Button>
        {files.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setFiles([])}>
            {t('Clear')}
          </Button>
        )}
      </div>
      {files.length > 0 && (
        <div className="pd-list" style={{ maxHeight: 160, overflow: 'auto' }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="pd-list-item">
              <span className="faint" style={{ width: 22 }}>
                {i + 1}
              </span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
              <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <ImageOptions value={options} onChange={setOptions} />
    </Modal>
  );
}

export function ExportImagesDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const history = useDoc();
  const doc = history.present;
  const current = usePdfUi((s) => s.currentPage);
  const [which, setWhich] = useState<'current' | 'all' | 'range'>('current');
  const [range, setRange] = useState(`1-${doc.pages.length}`);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.9);
  const parsed = which === 'range' ? parsePageSet(range, doc.pages.length) : null;
  const ids =
    which === 'current'
      ? [doc.pages[current]?.id].filter((x): x is string => !!x)
      : which === 'all'
        ? doc.pages.map((p) => p.id)
        : (parsed?.pages ?? []).map((n) => doc.pages[n - 1].id);
  return (
    <Modal
      title={t('Export pages as images')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            icon={FileImage}
            disabled={!ids.length || !!parsed?.error}
            onClick={() => {
              onClose();
              void exportImages(history.present, { pageIds: ids, format, dpi, quality });
            }}
          >
            {ids.length > 1 ? t('Export {count} images (ZIP)', { count: ids.length }) : t('Export image')}
          </Button>
        </>
      }
    >
      <Segmented
        value={which}
        onChange={setWhich}
        options={[
          { value: 'current', label: t('Current page ({n})', { n: current + 1 }) },
          { value: 'all', label: t('All pages') },
          { value: 'range', label: t('Pages…') },
        ]}
      />
      {which === 'range' && (
        <Field label={t('Pages, e.g. 1-3, 5')}>
          <TextInput value={range} onChange={(e) => setRange(e.target.value)} />
        </Field>
      )}
      {parsed?.error && <div className="pd-error-text">{parsed.error}</div>}
      <div className="pd-grid2">
        <Field label={t('Format')}>
          <Segmented
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
            ]}
          />
        </Field>
        <Field label={t('Resolution')}>
          <Select
            small
            value={String(dpi)}
            onChange={(v) => setDpi(Number(v))}
            options={[72, 96, 150, 200, 300, 600].map((d) => ({ value: String(d), label: `${d} DPI` }))}
          />
        </Field>
      </div>
      {format === 'jpeg' && <Slider label={t('JPG quality')} value={quality} min={0.5} max={1} step={0.01} onChange={setQuality} format={(v) => `${Math.round(v * 100)}%`} />}
      <div className="faint" style={{ fontSize: 12 }}>{t('Annotations, signatures and filled form values are included in the images.')}</div>
    </Modal>
  );
}

/** Saves text as a .txt file (used by AI dialogs). */
export async function saveText(text: string, name: string, mime = 'text/plain;charset=utf-8', ext = 'txt'): Promise<void> {
  await saveFile(new Blob([text], { type: mime }), { suggestedName: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
}
