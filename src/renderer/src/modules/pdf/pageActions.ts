/**
 * Page level commands used by the viewer, thumbnails, organize grid, menus and AI:
 * rotate, delete, duplicate, insert blank pages, extract and split.
 */
import JSZip from 'jszip';
import type { HistoryState } from '../../core/history';
import { t } from '../../core/i18n';
import { saveFile } from '../../core/platform';
import { fileBaseName } from '../../core/utils/format';
import { confirmDialog, toast } from '../../components/ui';
import { buildCurrentPdf, loadPdfSource, suggestedPdfName } from './docActions';
import { engine } from './engine';
import { blankPdf } from './exporter';
import { deletePages, duplicatePages, insertPages, makePages, movePages, rotatePages } from './organize';
import { groupLabel } from './ranges';
import { usePdfUi } from './store';
import type { DocState, PageEntry } from './types';

type History = HistoryState<DocState>;

function busy(label: string | null, progress: number | null = null) {
  usePdfUi.getState().set({ busy: label ? { label, progress } : null });
}

/** Pages the page commands act on: organize selection, else the current page. */
export function targetPages(doc: DocState): string[] {
  const ui = usePdfUi.getState();
  if (ui.mode === 'organize' && ui.pageSelection.length) return ui.pageSelection.filter((id) => doc.pages.some((p) => p.id === id));
  const current = doc.pages[ui.currentPage];
  return current ? [current.id] : [];
}

export function rotate(history: History, ids: string[], degrees: number): void {
  if (!ids.length) return;
  history.set((d) => ({ ...d, pages: rotatePages(d.pages, ids, degrees) }), { label: 'Rotate pages' });
}

export async function remove(history: History, ids: string[], ask = true): Promise<void> {
  const doc = history.present;
  if (!ids.length) return;
  if (ids.length >= doc.pages.length) {
    toast.warning(t('A PDF needs at least one page'));
    return;
  }
  if (ask && ids.length > 1) {
    const ok = await confirmDialog({ title: t('Delete {count} pages?', { count: ids.length }), confirmLabel: t('Delete'), danger: true });
    if (!ok) return;
  }
  const ui = usePdfUi.getState();
  history.set((d) => deletePages(d, ids), { label: 'Delete pages' });
  ui.set({ pageSelection: [], currentPage: Math.min(ui.currentPage, doc.pages.length - ids.length - 1) });
}

export function duplicate(history: History, ids: string[]): void {
  if (!ids.length) return;
  const { doc, newIds } = duplicatePages(history.present, ids);
  history.set(doc, { label: 'Duplicate pages' });
  if (usePdfUi.getState().mode === 'organize') usePdfUi.getState().set({ pageSelection: newIds });
}

export function move(history: History, ids: string[], toIndex: number): void {
  const next = movePages(history.present.pages, ids, toIndex);
  if (next !== history.present.pages) history.set((d) => ({ ...d, pages: next }), { label: 'Move pages' });
}

/** Inserts a blank page with the size (as displayed) of its neighbour. */
export async function insertBlank(history: History, at: number): Promise<void> {
  const doc = history.present;
  const neighbour = doc.pages[Math.max(0, Math.min(doc.pages.length - 1, at - 1))];
  let w = 595.28;
  let h = 841.89;
  if (neighbour) {
    const info = engine.info(neighbour);
    if (info) {
      const rot = engine.rotation(neighbour);
      const vw = (info.view[2] - info.view[0]) * (info.userUnit || 1);
      const vh = (info.view[3] - info.view[1]) * (info.userUnit || 1);
      [w, h] = rot % 180 === 0 ? [vw, vh] : [vh, vw];
    }
  }
  try {
    const src = await loadPdfSource(await blankPdf(w, h), t('Blank page'));
    const entries = makePages(src.id, 1);
    history.set((d) => insertPages(d, entries, at), { label: 'Insert blank page' });
    usePdfUi.getState().goToPage(at);
  } catch (error) {
    toast.error(t('Could not insert a page'), error instanceof Error ? error.message : String(error));
  }
}

/** Saves the given pages (with their annotations) as a new PDF. */
export async function extractToFile(history: History, ids: string[]): Promise<void> {
  const doc = history.present;
  const ordered = doc.pages.filter((p) => ids.includes(p.id));
  if (!ordered.length) {
    toast.info(t('Select the pages to extract first'));
    return;
  }
  busy(t('Extracting pages…'));
  try {
    const bytes = await buildCurrentPdf(doc, { pageIds: ordered.map((p) => p.id) });
    const numbers = ordered.map((p) => doc.pages.indexOf(p) + 1);
    await saveFile(bytes, {
      suggestedName: `${fileBaseName(suggestedPdfName())}-${t('pages')}-${groupLabel(numbers)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  } catch (error) {
    toast.error(t('Could not extract pages'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

/** Splits the document into several PDFs (one per group of 1-based page numbers) in a ZIP. */
export async function splitToZip(history: History, groups: number[][]): Promise<void> {
  const doc = history.present;
  if (!groups.length) return;
  busy(t('Splitting…'), 0);
  try {
    const zip = new JSZip();
    const base = fileBaseName(suggestedPdfName());
    for (let i = 0; i < groups.length; i++) {
      const pageIds = groups[i].map((n) => doc.pages[n - 1]?.id).filter((id): id is string => !!id);
      if (!pageIds.length) continue;
      const bytes = await buildCurrentPdf(doc, { pageIds });
      zip.file(`${base}-${String(i + 1).padStart(2, '0')}-p${groupLabel(groups[i])}.pdf`, bytes);
      busy(t('Splitting…'), (i + 1) / groups.length);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    await saveFile(blob, { suggestedName: `${base}-split.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
    toast.success(t('{count} PDF files created', { count: groups.length }));
  } catch (error) {
    toast.error(t('Could not split the document'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

/** 1-based page numbers of page ids. */
export function pageNumbers(pages: PageEntry[], ids: string[]): number[] {
  return ids.map((id) => pages.findIndex((p) => p.id === id) + 1).filter((n) => n > 0);
}
