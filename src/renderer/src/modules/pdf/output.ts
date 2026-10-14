/**
 * Output that goes through a rendered copy of the final PDF: page images (PNG/JPG),
 * printing, and plain text extraction.
 */
import JSZip from 'jszip';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { t } from '../../core/i18n';
import { saveFile } from '../../core/platform';
import { fileBaseName } from '../../core/utils/format';
import { canvasToBlob } from '../../core/utils/image';
import { toast } from '../../components/ui';
import { buildCurrentPdf, suggestedPdfName } from './docActions';
import { openPdfjs } from './engine';
import { documentText } from './find';
import { usePdfUi } from './store';
import type { DocState } from './types';

function busy(label: string | null, progress: number | null = null) {
  usePdfUi.getState().set({ busy: label ? { label, progress } : null });
}

async function withFinalPdf<T>(doc: DocState, pageIds: string[] | undefined, fn: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const bytes = await buildCurrentPdf(doc, { pageIds });
  const { pdf } = await openPdfjs(bytes, 'output');
  try {
    return await fn(pdf);
  } finally {
    void pdf.loadingTask.destroy();
  }
}

async function renderPage(pdf: PDFDocumentProxy, n: number, dpi: number, background = '#ffffff'): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(n);
  let scale = dpi / 72;
  let viewport = page.getViewport({ scale });
  const maxPixels = 120_000_000;
  if (viewport.width * viewport.height > maxPixels) {
    scale *= Math.sqrt(maxPixels / (viewport.width * viewport.height));
    viewport = page.getViewport({ scale });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvas, viewport, background }).promise;
  page.cleanup();
  return canvas;
}

export interface ImageExportOptions {
  pageIds: string[];
  format: 'png' | 'jpeg';
  dpi: number;
  quality: number;
}

export async function exportImages(doc: DocState, options: ImageExportOptions): Promise<void> {
  const ids = options.pageIds.filter((id) => doc.pages.some((p) => p.id === id));
  if (!ids.length) return;
  const base = fileBaseName(suggestedPdfName());
  const ext = options.format === 'png' ? 'png' : 'jpg';
  const mime = options.format === 'png' ? 'image/png' : 'image/jpeg';
  busy(t('Rendering pages…'), 0);
  try {
    await withFinalPdf(doc, ids, async (pdf) => {
      const numbers = ids.map((id) => doc.pages.findIndex((p) => p.id === id) + 1);
      if (ids.length === 1) {
        const canvas = await renderPage(pdf, 1, options.dpi);
        const blob = await canvasToBlob(canvas, mime, options.quality);
        canvas.width = canvas.height = 0;
        await saveFile(blob, { suggestedName: `${base}-p${numbers[0]}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
        return;
      }
      const zip = new JSZip();
      for (let i = 0; i < pdf.numPages; i++) {
        const canvas = await renderPage(pdf, i + 1, options.dpi);
        const blob = await canvasToBlob(canvas, mime, options.quality);
        canvas.width = canvas.height = 0;
        zip.file(`${base}-p${String(numbers[i]).padStart(3, '0')}.${ext}`, blob);
        busy(t('Rendering pages…'), (i + 1) / pdf.numPages);
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      await saveFile(blob, { suggestedName: `${base}-${ext}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
    });
  } catch (error) {
    toast.error(t('Could not export images'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

export async function extractAllText(doc: DocState): Promise<void> {
  busy(t('Extracting text…'), 0);
  try {
    const pages = await documentText(doc.pages, (d, total) => busy(t('Extracting text…'), d / total));
    const text = pages.map((p) => `--- ${t('Page {n}', { n: p.page })} ---\n${p.text.trim()}\n`).join('\n');
    if (!pages.some((p) => p.text.trim())) toast.warning(t('No text found'), t('This PDF may contain scanned images only.'));
    await saveFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), {
      suggestedName: `${fileBaseName(suggestedPdfName())}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
  } catch (error) {
    toast.error(t('Could not extract text'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

/** Renders every page into a hidden iframe and opens the system print dialog. */
export async function printDocument(doc: DocState, dpi = 150): Promise<void> {
  busy(t('Preparing to print…'), 0);
  const urls: string[] = [];
  try {
    const pages: { url: string; w: number; h: number }[] = [];
    await withFinalPdf(doc, undefined, async (pdf) => {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPage(pdf, i, dpi);
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        canvas.width = canvas.height = 0;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        pages.push({ url, w: vp.width, h: vp.height });
        busy(t('Preparing to print…'), i / pdf.numPages);
      }
    });
    const sizes = [...new Set(pages.map((p) => `${p.w.toFixed(2)}x${p.h.toFixed(2)}`))];
    const css = [
      'html,body{margin:0;padding:0;background:#fff}',
      'img{display:block;break-after:page;page-break-after:always}',
      'img:last-child{break-after:auto;page-break-after:auto}',
      ...sizes.map((s, i) => {
        const [w, h] = s.split('x');
        return `@page s${i}{size:${w}pt ${h}pt;margin:0}.s${i}{page:s${i};width:${w}pt;height:${h}pt}`;
      }),
      `@page{margin:0}`,
    ].join('\n');
    const body = pages.map((p) => `<img class="s${sizes.indexOf(`${p.w.toFixed(2)}x${p.h.toFixed(2)}`)}" src="${p.url}" alt="">`).join('');
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const cleanup = () => {
      frame.remove();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    const win = frame.contentWindow;
    const fdoc = frame.contentDocument;
    if (!win || !fdoc) throw new Error('Printing is not available');
    fdoc.open();
    fdoc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${suggestedPdfName().replace(/[<>&"]/g, '')}</title><style>${css}</style></head><body>${body}</body></html>`);
    fdoc.close();
    await Promise.all(Array.from(fdoc.images).map((img) => (img.complete ? Promise.resolve() : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
    busy(null);
    win.addEventListener('afterprint', () => setTimeout(cleanup, 500), { once: true });
    win.focus();
    win.print();
    setTimeout(cleanup, 120_000);
  } catch (error) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    toast.error(t('Could not print'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}
