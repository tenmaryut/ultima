import { useState } from 'react';
import JSZip from 'jszip';
import { Download, Printer } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { desktop, saveFile } from '../../../core/platform';
import { Button, Field, Modal, ProgressBar, Segmented, Select, Slider, TextInput, Toggle, toast } from '../../../components/ui';
import { exportImages, exportPdf, printPages } from '../exporting';
import type { LayoutDoc } from '../types';
import { parsePageRange } from '../units';
import type { FlowMap } from '../vnode';

export type ExportFormat = 'pdf' | 'png' | 'jpeg' | 'print';
type Range = 'all' | 'current' | 'custom';

function safeName(name: string): string {
  return (name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';
}

export function ExportDialog({
  doc,
  flows,
  currentPage,
  initialFormat = 'pdf',
  onClose,
}: {
  doc: LayoutDoc;
  flows: FlowMap;
  currentPage: number;
  initialFormat?: ExportFormat;
  onClose: () => void;
}) {
  const t = useT();
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [range, setRange] = useState<Range>(doc.pages.length > 1 && initialFormat !== 'pdf' && initialFormat !== 'print' ? 'current' : 'all');
  const [custom, setCustom] = useState(`1-${doc.pages.length}`);
  const [bleed, setBleed] = useState(false);
  const [marks, setMarks] = useState(false);
  const [raster, setRaster] = useState(2);
  const pixelDoc = doc.unit === 'px';
  const [dpi, setDpi] = useState(pixelDoc ? 96 : 300);
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const pages = range === 'all' ? doc.pages.map((_, i) => i) : range === 'current' ? [Math.max(0, currentPage)] : parsePageRange(custom, doc.pages.length);
  const scale = dpi / 96;
  const p0 = doc.pages[pages?.[0] ?? 0];
  const outW = Math.round(p0.width * scale);
  const outH = Math.round(p0.height * scale);
  const base = safeName(doc.name);

  const run = async () => {
    if (!pages?.length) {
      toast.error(t('Invalid page range'), t('Use page numbers like 1-3, 5'));
      return;
    }
    setBusy(true);
    setProgress(0);
    const onProgress = (done: number, total: number) => setProgress(total ? done / total : 0);
    try {
      if (format === 'print') {
        await printPages(doc, flows, pages);
        onClose();
        return;
      }
      if (format === 'pdf') {
        const { bytes, vector } = await exportPdf(doc, flows, pages, { bleed, cropMarks: marks, rasterScale: raster }, onProgress);
        const saved = await saveFile(new Blob([bytes as BlobPart], { type: 'application/pdf' }), {
          suggestedName: `${base}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (saved) toast.success(t('PDF exported'), vector ? t('Vector PDF with selectable text') : t('Pages were rendered as images (browser version)'));
        onClose();
        return;
      }
      const ext = format === 'png' ? 'png' : 'jpg';
      const blobs = await exportImages(doc, flows, pages, format, scale, quality / 100, onProgress);
      if (blobs.length === 1) {
        const saved = await saveFile(blobs[0], {
          suggestedName: `${base}${doc.pages.length > 1 ? `-${pages[0] + 1}` : ''}.${ext}`,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        if (saved) toast.success(t('Image exported'));
      } else {
        const zip = new JSZip();
        blobs.forEach((b, i) => zip.file(`${base}-${String(pages[i] + 1).padStart(2, '0')}.${ext}`, b));
        const data = await zip.generateAsync({ type: 'blob' });
        const saved = await saveFile(data, { suggestedName: `${base}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
        if (saved) toast.success(t('{n} images exported as ZIP', { n: blobs.length }));
      }
      onClose();
    } catch (error) {
      toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('Export')}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon={format === 'print' ? Printer : Download} onClick={() => void run()} disabled={busy || !pages?.length}>
            {format === 'print' ? t('Print…') : t('Export')}
          </Button>
        </>
      }
    >
      <Segmented<ExportFormat>
        value={format}
        onChange={setFormat}
        options={[
          { value: 'pdf', label: 'PDF' },
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPG' },
          { value: 'print', label: t('Print') },
        ]}
      />
      <Field label={t('Pages')}>
        <div className="row">
          <Select<Range>
            value={range}
            onChange={setRange}
            options={[
              { value: 'all', label: t('All pages ({n})', { n: doc.pages.length }) },
              { value: 'current', label: t('Current page ({n})', { n: Math.max(0, currentPage) + 1 }) },
              { value: 'custom', label: t('Page range') },
            ]}
          />
          {range === 'custom' && <TextInput value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="1-3, 5" aria-label={t('Page range')} />}
        </div>
      </Field>
      {format === 'pdf' && (
        <>
          {doc.bleed > 0 && <Toggle checked={bleed} onChange={setBleed} label={t('Include bleed')} />}
          <Toggle checked={marks} onChange={setMarks} label={t('Crop marks')} />
          {desktop ? (
            <div className="faint ly-hint">{t('Vector PDF: text stays selectable and sharp at any size.')}</div>
          ) : (
            <>
              <Field label={t('Quality')}>
                <Select<number>
                  value={raster}
                  onChange={setRaster}
                  options={[
                    { value: 1.5, label: t('Draft (144 dpi)') },
                    { value: 2, label: t('Good (192 dpi)') },
                    { value: 3, label: t('High (288 dpi)') },
                  ]}
                />
              </Field>
              <div className="ly-warn">{t('In the browser version PDF pages are images. Use the desktop app for a vector PDF with selectable text.')}</div>
            </>
          )}
        </>
      )}
      {(format === 'png' || format === 'jpeg') && (
        <>
          <Field label={pixelDoc ? t('Scale') : t('Resolution')}>
            <Select<number>
              value={dpi}
              onChange={setDpi}
              options={
                pixelDoc
                  ? [
                      { value: 96, label: '1× (100%)' },
                      { value: 144, label: '1.5×' },
                      { value: 192, label: '2×' },
                      { value: 288, label: '3×' },
                      { value: 48, label: '0.5×' },
                    ]
                  : [
                      { value: 72, label: t('72 dpi (screen)') },
                      { value: 150, label: t('150 dpi (good)') },
                      { value: 300, label: t('300 dpi (print)') },
                      { value: 600, label: t('600 dpi') },
                    ]
              }
            />
          </Field>
          <div className="faint ly-hint">
            {t('Output size: {w} × {h} px', { w: outW, h: outH })}
            {(pages?.length ?? 0) > 1 ? ` · ${t('{n} images in a ZIP file', { n: pages?.length ?? 0 })}` : ''}
          </div>
          {format === 'jpeg' && <Slider label={t('JPG quality')} min={40} max={100} value={quality} format={(v) => `${v}%`} onChange={setQuality} />}
        </>
      )}
      {format === 'print' && <div className="faint ly-hint">{t('Opens the system print dialog. Choose “Save as PDF” there to create a PDF too.')}</div>}
      {busy && <ProgressBar value={progress} />}
    </Modal>
  );
}
