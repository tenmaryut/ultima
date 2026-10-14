/**
 * True redaction: every page with redaction marks is rendered to an image at high
 * resolution (with its annotations), the marked areas are painted black and the page
 * is replaced by that image, so the text underneath is really gone.
 */
import { degrees, PDFDocument } from 'pdf-lib';
import type { HistoryState } from '../../core/history';
import { t } from '../../core/i18n';
import { canvasToBlob } from '../../core/utils/image';
import { confirmDialog, toast } from '../../components/ui';
import { newAnnotId } from './annots';
import { buildCurrentPdf, loadPdfSource } from './docActions';
import { engine, openPdfjs } from './engine';
import { searchDocument } from './find';
import { rectsIntersect, rectToScreen, viewportTransform, type Rect } from './geometry';
import { usePdfUi } from './store';
import type { Annot, DocState, PageEntry } from './types';

type History = HistoryState<DocState>;

function busy(label: string | null, progress: number | null = null) {
  usePdfUi.getState().set({ busy: label ? { label, progress } : null });
}

async function rasterizePage(doc: DocState, entry: PageEntry, marks: Rect[], dpi: number): Promise<Uint8Array> {
  const info = engine.info(entry);
  if (!info) throw new Error('Missing page');
  // flatten everything on the page (except notes and the marks themselves) into a one-page PDF
  const pageDoc: DocState = { ...doc, annots: doc.annots.filter((a) => a.page === entry.id && a.type !== 'redact' && a.type !== 'note') };
  const flattened = await buildCurrentPdf(pageDoc, { pageIds: [entry.id], flattenForms: true, notesAsComments: false });
  const { pdf } = await openPdfjs(flattened, 'redact');
  try {
    const page = await pdf.getPage(1);
    let scale = dpi / 72;
    const area = (info.view[2] - info.view[0]) * (info.view[3] - info.view[1]) * scale * scale;
    if (area > 80_000_000) scale *= Math.sqrt(80_000_000 / area);
    const viewport = page.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    const m = viewportTransform(info.view, scale, 0);
    ctx.fillStyle = '#000000';
    for (const r of marks) {
      const s = rectToScreen(m, r);
      ctx.fillRect(Math.floor(s.left) - 1, Math.floor(s.top) - 1, Math.ceil(s.width) + 2, Math.ceil(s.height) + 2);
    }
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    canvas.width = canvas.height = 0;
    const out = await PDFDocument.create();
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const [x0, y0, x1, y1] = info.view;
    const p = out.addPage([x1 - x0, y1 - y0]);
    p.setMediaBox(x0, y0, x1 - x0, y1 - y0);
    p.drawImage(img, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    p.setRotation(degrees(info.rotate));
    out.setProducer('Ultima PDF Studio');
    return out.save();
  } finally {
    void pdf.loadingTask.destroy();
  }
}

export async function applyRedactions(history: History, dpi = 200): Promise<void> {
  const doc = history.present;
  const marked = doc.pages.filter((p) => doc.annots.some((a) => a.page === p.id && a.type === 'redact'));
  if (!marked.length) {
    toast.info(t('Nothing to redact'), t('Mark areas with the Redact tool (or select text and choose "Mark for redaction") first.'));
    return;
  }
  const ok = await confirmDialog({
    title: t('Apply redactions?'),
    message: t(
      'The marked areas on {count} page(s) will be blacked out permanently. To make sure the hidden text is really removed, these pages are converted into images: their text can no longer be selected or searched, and annotations on them become part of the image. You can still undo this until you close the document.',
      { count: marked.length },
    ),
    confirmLabel: t('Apply redactions'),
    danger: true,
  });
  if (!ok) return;
  busy(t('Applying redactions…'), 0);
  try {
    const replaced = new Map<string, PageEntry>();
    for (let i = 0; i < marked.length; i++) {
      const entry = marked[i];
      const marks = doc.annots.filter((a): a is Extract<Annot, { type: 'redact' }> => a.page === entry.id && a.type === 'redact').map((a) => a.rect);
      const bytes = await rasterizePage(doc, entry, marks, dpi);
      const src = await loadPdfSource(bytes, t('Redacted page'));
      replaced.set(entry.id, { ...entry, src: src.id, index: 0 });
      busy(t('Applying redactions…'), (i + 1) / marked.length);
    }
    history.set(
      (d) => {
        const markRects = new Map<string, Rect[]>();
        for (const a of d.annots) if (a.type === 'redact' && replaced.has(a.page)) markRects.set(a.page, [...(markRects.get(a.page) ?? []), a.rect]);
        return {
          ...d,
          pages: d.pages.map((p) => replaced.get(p.id) ?? p),
          // everything on a redacted page is now part of the image; notes survive unless they sit on a mark
          annots: d.annots.filter((a) => {
            if (!replaced.has(a.page)) return true;
            if (a.type !== 'note') return false;
            return !(markRects.get(a.page) ?? []).some((r) => rectsIntersect(r, a.rect));
          }),
        };
      },
      { label: 'Apply redactions' },
    );
    usePdfUi.getState().set({ selection: [] });
    toast.success(t('Redactions applied to {count} page(s)', { count: marked.length }), t('Save the PDF to keep the result.'));
  } catch (error) {
    toast.error(t('Could not apply redactions'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

/** Marks every occurrence of a text for redaction. Returns the number of marks. */
export async function markTextForRedaction(history: History, query: string, options: { caseSensitive?: boolean; wholeWord?: boolean } = {}): Promise<number> {
  if (!query.trim()) return 0;
  busy(t('Searching…'), 0);
  try {
    const matches = await searchDocument(history.present.pages, query, options, (d, total) => busy(t('Searching…'), d / total));
    const marks: Annot[] = matches.flatMap((m) =>
      m.rects.map((r) => ({ id: newAnnotId(), page: m.page, type: 'redact' as const, rect: { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 } })),
    );
    if (marks.length) history.set((d) => ({ ...d, annots: [...d.annots, ...marks] }), { label: 'Mark for redaction' });
    return matches.length;
  } finally {
    busy(null);
  }
}
