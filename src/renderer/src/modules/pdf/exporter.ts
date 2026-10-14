/**
 * Builds the output PDF with pdf-lib: applies the page organisation (order, rotation,
 * deletions, inserted pages from other sources), flattens annotation objects, writes
 * form values and metadata. Pure of DOM (unit tested in node); DOM-only work such as
 * rasterizing exotic text is passed in through hooks.
 */
import { degrees, PDFDocument, type PDFPage } from 'pdf-lib';
import { normalizeRotation } from './geometry';
import { drawAnnot, FlattenResources, type FlattenHooks } from './flatten';
import { applyFieldValues, flattenFormSafely, removeOrphanFields, updateAppearancesSafely } from './forms';
import type { Annot, DocMeta, DocState, FieldValue, PageEntry, PageInfo } from './types';

export interface ExportSource {
  /** Unencrypted bytes of the source PDF. */
  bytes: () => Promise<Uint8Array>;
  pages: PageInfo[];
}

export interface ExportContext {
  /** The originally opened document: kept as the base so forms, outline and metadata survive. */
  mainSrc: string | null;
  source: (id: string) => ExportSource | undefined;
  initialFields: Record<string, FieldValue>;
}

export interface ExportOptions extends FlattenHooks {
  /** Export only these pages (in this order). Default: every page. */
  pageIds?: string[];
  flattenForms?: boolean;
  /** Draw annotation objects (default true). */
  includeAnnotations?: boolean;
  meta?: DocMeta;
  producer?: string;
  onProgress?: (done: number, total: number) => void;
}

export function applyMeta(doc: PDFDocument, meta: DocMeta, producer = 'Ultima PDF Studio'): void {
  doc.setTitle(meta.title || '');
  doc.setAuthor(meta.author || '');
  doc.setSubject(meta.subject || '');
  // one entry keeps the user's own separators ("a, b") instead of pdf-lib's space-joined list
  doc.setKeywords(meta.keywords?.trim() ? [meta.keywords.trim()] : []);
  doc.setCreator(meta.creator || 'Ultima');
  doc.setProducer(producer);
  doc.setModificationDate(new Date());
}

/** Builds the PDF for a document state. */
export async function buildPdf(state: DocState, ctx: ExportContext, options: ExportOptions = {}): Promise<Uint8Array> {
  const wanted = options.pageIds ? new Set(options.pageIds) : null;
  const entries: PageEntry[] = options.pageIds
    ? options.pageIds.map((id) => state.pages.find((p) => p.id === id)).filter((p): p is PageEntry => !!p)
    : state.pages.filter((p) => !wanted || wanted.has(p.id));
  if (!entries.length) throw new Error('There are no pages to export');

  const loaded = new Map<string, Promise<PDFDocument>>();
  const load = (src: string): Promise<PDFDocument> => {
    let p = loaded.get(src);
    if (!p) {
      const s = ctx.source(src);
      if (!s) throw new Error('A page source is missing');
      p = s.bytes().then((b) => PDFDocument.load(b, { updateMetadata: false }));
      loaded.set(src, p);
    }
    return p;
  };

  const usesMain = !!ctx.mainSrc && entries.some((e) => e.src === ctx.mainSrc);
  const base = usesMain ? await load(ctx.mainSrc!) : await PDFDocument.create();
  if (!usesMain) loaded.set('__base__', Promise.resolve(base));

  // Collect the final page objects in order.
  const originals = usesMain ? base.getPages() : [];
  const usedOriginal = new Set<number>();
  const finalPages: PDFPage[] = [];
  let done = 0;
  for (const entry of entries) {
    if (usesMain && entry.src === ctx.mainSrc) {
      if (!usedOriginal.has(entry.index) && originals[entry.index]) {
        usedOriginal.add(entry.index);
        finalPages.push(originals[entry.index]);
      } else {
        const [copy] = await base.copyPages(base, [entry.index]);
        finalPages.push(copy);
      }
    } else {
      const srcDoc = await load(entry.src);
      const [copy] = await base.copyPages(srcDoc, [entry.index]);
      finalPages.push(copy);
    }
    options.onProgress?.(++done, entries.length * 2);
  }

  // Rebuild the page tree in the new order.
  for (let i = base.getPageCount() - 1; i >= 0; i--) base.removePage(i);
  for (const page of finalPages) base.addPage(page);
  const hasForm = usesMain && !!base.catalog.getAcroForm();
  if (hasForm) removeOrphanFields(base);

  // Rotation + annotations.
  const res = new FlattenResources(base);
  const byPage = new Map<string, Annot[]>();
  for (const a of state.annots) {
    const list = byPage.get(a.page);
    if (list) list.push(a);
    else byPage.set(a.page, [a]);
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const page = finalPages[i];
    const info = ctx.source(entry.src)?.pages[entry.index];
    const rotation = normalizeRotation((info?.rotate ?? page.getRotation().angle) + entry.rotate);
    page.setRotation(degrees(rotation));
    if (options.includeAnnotations !== false) {
      for (const a of byPage.get(entry.id) ?? []) await drawAnnot(base, page, a, res, options);
    }
    options.onProgress?.(++done, entries.length * 2);
  }

  // Forms and metadata.
  if (hasForm) {
    applyFieldValues(base, state.fields, ctx.initialFields);
    if (options.flattenForms) flattenFormSafely(base);
    else updateAppearancesSafely(base);
  }
  applyMeta(base, options.meta ?? state.meta, options.producer);
  return base.save({ updateFieldAppearances: false });
}

/** Creates a one-page (or more) blank PDF of the given size in points. */
export async function blankPdf(width: number, height: number, count = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([width, height]);
  return doc.save();
}
