/**
 * Document level actions: opening (PDFs, images, projects; combine / insert),
 * saving PDFs and Ultima project files, closing.
 */
import type { HistoryState } from '../../core/history';
import { t } from '../../core/i18n';
import { rememberRecent } from '../../core/open';
import { desktop, pathForFile, saveFile } from '../../core/platform';
import { bytesToBase64, base64ToBytes } from '../../core/utils/base64';
import { fileBaseName, fileExtension } from '../../core/utils/format';
import { canvasToBlob, createCanvas, get2d } from '../../core/utils/image';
import { confirmDialog, toast } from '../../components/ui';
import { askOpenChoice, askPassword } from './dialogs/dialogStore';
import { engine, PasswordCancelled, type SourceDoc } from './engine';
import { blankPdf, buildPdf, type ExportContext, type ExportOptions } from './exporter';
import { detectFields } from './forms';
import { DEFAULT_IMAGE_OPTIONS, imagesToPdf, isImageFile, isPdfFile, textToPdf, type ImagesToPdfOptions } from './imagepdf';
import { insertPages, makePages } from './organize';
import { usePdfUi, type DocInfo } from './store';
import { contentFrame } from './geometry';
import { cssFontFamily, layoutText, TEXT_PAD } from './textlayout';
import { EMPTY_META, type DocMeta, type DocState, type FieldDef, type FieldValue, type OutlineNode, type TextAnnot } from './types';
import { PDFDocument } from 'pdf-lib';

type History = HistoryState<DocState>;

export function isDirty(doc: DocState): boolean {
  const info = usePdfUi.getState().docInfo;
  return !!info && info.savedState !== doc;
}

async function confirmDiscard(doc: DocState): Promise<boolean> {
  if (!isDirty(doc) || !doc.pages.length) return true;
  return confirmDialog({
    title: t('Discard unsaved changes?'),
    message: t('The current document has changes that are not saved.'),
    confirmLabel: t('Discard'),
    danger: true,
  });
}

function busy(label: string | null, progress: number | null = null) {
  usePdfUi.getState().set({ busy: label ? { label, progress } : null });
}

/** Loads one PDF file as a source (asks for a password when needed). */
export async function loadPdfSource(bytes: Uint8Array, name: string): Promise<SourceDoc> {
  return engine.addPdf(bytes, name, askPassword);
}

/** Turns files into sources: PDFs as they are, runs of consecutive images into one PDF each. */
export async function filesToSources(files: File[], imageOptions: ImagesToPdfOptions = DEFAULT_IMAGE_OPTIONS): Promise<SourceDoc[]> {
  const out: SourceDoc[] = [];
  let images: File[] = [];
  const flushImages = async () => {
    if (!images.length) return;
    const bytes = await imagesToPdf(images, imageOptions);
    out.push(await loadPdfSource(bytes, images.length === 1 ? `${fileBaseName(images[0].name)}.pdf` : t('Images')));
    images = [];
  };
  for (const file of files) {
    if (isImageFile(file)) {
      images.push(file);
      continue;
    }
    await flushImages();
    if (isPdfFile(file)) {
      try {
        out.push(await loadPdfSource(new Uint8Array(await file.arrayBuffer()), file.name));
      } catch (error) {
        if (error instanceof PasswordCancelled) continue;
        throw new Error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await flushImages();
  return out;
}

async function readMeta(src: SourceDoc): Promise<DocMeta> {
  try {
    const { info } = (await src.pdf.getMetadata()) as { info: Record<string, unknown> };
    const s = (k: string) => (typeof info?.[k] === 'string' ? (info[k] as string) : '');
    return { title: s('Title'), author: s('Author'), subject: s('Subject'), keywords: s('Keywords'), creator: s('Creator') };
  } catch {
    return { ...EMPTY_META };
  }
}

async function readForms(src: SourceDoc): Promise<{ defs: FieldDef[]; values: Record<string, FieldValue> }> {
  try {
    const objects: unknown = await src.pdf.getFieldObjects();
    const count = objects instanceof Map ? objects.size : objects && typeof objects === 'object' ? Object.keys(objects).length : 0;
    if (!count) return { defs: [], values: {} };
    const doc = await PDFDocument.load(await engine.plainBytes(src.id), { updateMetadata: false });
    return detectFields(doc);
  } catch (error) {
    console.warn('[pdf] form detection failed', error);
    return { defs: [], values: {} };
  }
}

/** Shows sources as a new document (the first one is the "main" document). */
export async function showDocument(
  sources: SourceDoc[],
  name: string,
  history: History,
  extra: { file?: File; path?: string; fileSize?: number; state?: DocState; info?: Partial<DocInfo> } = {},
): Promise<void> {
  if (!sources.length) throw new Error(t('Nothing to open'));
  const main = sources[0];
  const [meta, forms, outline] = await Promise.all([
    extra.state ? Promise.resolve(extra.state.meta) : readMeta(main),
    extra.info?.fieldDefs ? Promise.resolve({ defs: extra.info.fieldDefs, values: extra.info.initialFields ?? {} }) : readForms(main),
    extra.info?.outline ? Promise.resolve(extra.info.outline) : engine.outline(main.id).catch((): OutlineNode[] => []),
  ]);
  const state: DocState = extra.state ?? {
    pages: sources.flatMap((s) => makePages(s.id, s.pages.length)),
    annots: [],
    fields: forms.values,
    meta,
  };
  engine.reset(sources.map((s) => s.id));
  const info: DocInfo = {
    name,
    mainSrc: main.id,
    originalPath: extra.path,
    fieldDefs: forms.defs,
    initialFields: extra.info?.initialFields ?? forms.values,
    outline,
    fileSize: extra.fileSize ?? main.bytes.byteLength,
    encrypted: !!main.password,
    savedState: state,
    savePath: undefined,
  };
  history.reset(state);
  usePdfUi.getState().set({
    docInfo: info,
    mode: 'view',
    selection: [],
    pageSelection: [],
    editing: null,
    currentPage: 0,
    zoomMode: 'fit-width',
    viewRotation: 0,
    pending: null,
    find: { ...usePdfUi.getState().find, matches: [], active: -1 },
    scrollRequest: { index: 0, nonce: Date.now() },
    rightTab: forms.defs.length ? 'forms' : usePdfUi.getState().rightTab === 'forms' ? 'edit' : usePdfUi.getState().rightTab,
  });
  if (extra.file) rememberRecent(extra.file, 'pdf');
}

/** Opens files picked, dropped or handed over by another module. */
export async function openFiles(files: File[], history: History): Promise<void> {
  const usable = files.filter((f) => isPdfFile(f) || isImageFile(f) || fileExtension(f.name) === 'ultima');
  if (!usable.length) {
    toast.warning(t('Unsupported file type'), files.map((f) => f.name).join(', '));
    return;
  }
  const project = usable.find((f) => fileExtension(f.name) === 'ultima');
  if (project) {
    if (!(await confirmDiscard(history.present))) return;
    await loadProject(project, history);
    return;
  }
  const hasDoc = history.present.pages.length > 0;
  let choice: 'new' | 'combine' | 'insert-end' | 'insert-after' | 'first' | null = 'new';
  if (usable.length > 1 || hasDoc) choice = await askOpenChoice(usable.map((f) => f.name), hasDoc);
  if (!choice) return;
  if (choice === 'insert-end' || choice === 'insert-after') {
    const at = choice === 'insert-end' ? history.present.pages.length : usePdfUi.getState().currentPage + 1;
    await insertFiles(usable, history, at);
    return;
  }
  if (!(await confirmDiscard(history.present))) return;
  const list = choice === 'first' ? [usable[0]] : usable;
  busy(t('Opening…'));
  try {
    const sources = await filesToSources(list);
    if (!sources.length) return;
    const single = list.length === 1;
    const name = single ? (isPdfFile(list[0]) ? list[0].name : `${fileBaseName(list[0].name)}.pdf`) : choice === 'combine' ? t('Combined.pdf') : list[0].name;
    await showDocument(sources, name, history, {
      file: single && isPdfFile(list[0]) ? list[0] : undefined,
      path: single && isPdfFile(list[0]) ? pathForFile(list[0]) : undefined,
      fileSize: list.reduce((s, f) => s + f.size, 0),
    });
    if (!single || !isPdfFile(list[0])) {
      // a combined / converted document is new: mark it unsaved
      const info = usePdfUi.getState().docInfo;
      if (info) usePdfUi.getState().set({ docInfo: { ...info, savedState: null } });
    }
    list.filter(isPdfFile).forEach((f) => rememberRecent(f, 'pdf'));
  } catch (error) {
    toast.error(t('Could not open file'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

/** Inserts the pages of PDFs / images at a position (one undo step). */
export async function insertFiles(files: File[], history: History, at: number, imageOptions?: ImagesToPdfOptions): Promise<number> {
  busy(t('Inserting pages…'));
  try {
    const sources = await filesToSources(files, imageOptions);
    const entries = sources.flatMap((s) => makePages(s.id, s.pages.length));
    if (!entries.length) return 0;
    if (!history.present.pages.length) {
      await showDocument(sources, files.length === 1 ? files[0].name : t('Combined.pdf'), history);
      return entries.length;
    }
    history.set((d) => insertPages(d, entries, at), { label: 'Insert pages' });
    toast.success(t('{count} page(s) inserted', { count: entries.length }));
    return entries.length;
  } catch (error) {
    toast.error(t('Could not insert pages'), error instanceof Error ? error.message : String(error));
    return 0;
  } finally {
    busy(null);
  }
}

/** New document with one blank A4 page. */
export async function newBlankDocument(history: History): Promise<void> {
  if (!(await confirmDiscard(history.present))) return;
  const src = await loadPdfSource(await blankPdf(595.28, 841.89), t('Untitled.pdf'));
  await showDocument([src], t('Untitled.pdf'), history);
  const info = usePdfUi.getState().docInfo;
  if (info) usePdfUi.getState().set({ docInfo: { ...info, savedState: null } });
}

/** Creates a document from plain text (handoff from other modules). */
export async function openText(text: string, title: string, history: History): Promise<void> {
  if (!(await confirmDiscard(history.present))) return;
  const src = await loadPdfSource(await textToPdf(text, title), `${title || t('Text')}.pdf`);
  await showDocument([src], `${title || t('Text')}.pdf`, history);
  const info = usePdfUi.getState().docInfo;
  if (info) usePdfUi.getState().set({ docInfo: { ...info, savedState: null } });
}

export async function closeDocument(history: History): Promise<void> {
  if (!(await confirmDiscard(history.present))) return;
  engine.reset();
  history.reset({ pages: [], annots: [], fields: {}, meta: EMPTY_META });
  usePdfUi.getState().set({ docInfo: null, selection: [], pageSelection: [], editing: null, currentPage: 0, find: { ...usePdfUi.getState().find, open: false, matches: [], active: -1 } });
}

/* --------------------------------- Saving --------------------------------- */

/** Renders a text box with browser fonts (for characters the standard PDF fonts lack). */
export async function rasterizeText(a: TextAnnot): Promise<Uint8Array> {
  const f = contentFrame(a.rect, a.rot);
  const scale = 4;
  const canvas = createCanvas(Math.ceil(f.width * scale), Math.ceil(f.height * scale));
  const ctx = get2d(canvas);
  const layout = layoutText(a.text, { family: a.font, bold: a.bold, italic: a.italic, size: a.size }, f.width, a.autoWidth, a.align);
  ctx.scale(scale, scale);
  if (a.background) {
    ctx.fillStyle = a.background;
    ctx.fillRect(0, 0, f.width, f.height);
  }
  ctx.fillStyle = a.color;
  ctx.font = `${a.italic ? 'italic ' : ''}${a.bold ? '700 ' : ''}${a.size}px ${cssFontFamily(a.font)}`;
  ctx.textBaseline = 'alphabetic';
  layout.lines.forEach((line, i) => ctx.fillText(line, layout.offsets[i], TEXT_PAD + i * layout.lineHeight + layout.ascent));
  const blob = await canvasToBlob(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

export function exportContext(): ExportContext {
  const info = usePdfUi.getState().docInfo;
  return {
    mainSrc: info?.mainSrc ?? null,
    initialFields: info?.initialFields ?? {},
    source: (id) => {
      const s = engine.get(id);
      return s ? { bytes: () => engine.plainBytes(id), pages: s.pages } : undefined;
    },
  };
}

/** Builds the PDF of the current document with the user's save options. */
export function buildCurrentPdf(doc: DocState, options: ExportOptions = {}): Promise<Uint8Array> {
  const ui = usePdfUi.getState();
  return buildPdf(doc, exportContext(), {
    flattenForms: ui.flattenForms,
    notesAsComments: ui.notesAsComments,
    rasterizeText,
    ...options,
  });
}

export function suggestedPdfName(): string {
  const info = usePdfUi.getState().docInfo;
  const name = info?.name || 'document.pdf';
  return /\.pdf$/i.test(name) ? name : `${fileBaseName(name)}.pdf`;
}

export async function savePdf(history: History, saveAs = false): Promise<boolean> {
  const doc = history.present;
  const info = usePdfUi.getState().docInfo;
  if (!info || !doc.pages.length) return false;
  const marks = doc.annots.filter((a) => a.type === 'redact').length;
  if (marks) {
    const go = await confirmDialog({
      title: t('Redactions are not applied yet'),
      message: t('{count} area(s) are marked for redaction but not applied. Saved files only remove content after you click "Apply redactions". Save anyway without removing them?', { count: marks }),
      confirmLabel: t('Save anyway'),
    });
    if (!go) return false;
  }
  busy(t('Saving PDF…'), 0);
  try {
    const bytes = await buildCurrentPdf(doc, { onProgress: (d, total) => busy(t('Saving PDF…'), d / total) });
    const usePath = saveAs ? undefined : info.savePath;
    const suggestedName = desktop && info.originalPath && !saveAs ? info.originalPath : suggestedPdfName();
    const result = await saveFile(bytes, { suggestedName, filters: [{ name: 'PDF', extensions: ['pdf'] }], path: usePath });
    if (!result) return false;
    const fresh = usePdfUi.getState().docInfo;
    if (fresh) usePdfUi.getState().set({ docInfo: { ...fresh, savePath: result.path ?? fresh.savePath, savedState: doc } });
    toast.success(t('PDF saved'), result.path);
    return true;
  } catch (error) {
    toast.error(t('Could not save the PDF'), error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    busy(null);
  }
}

/* ------------------------------ Project files ----------------------------- */

interface ProjectFile {
  app: 'ultima';
  module: 'pdf';
  version: 1;
  name: string;
  mainSrc: string | null;
  sources: { id: string; name: string; data: string }[];
  state: DocState;
  fieldDefs: FieldDef[];
  initialFields: Record<string, FieldValue>;
  outline: OutlineNode[];
}

export async function saveProject(history: History): Promise<void> {
  const doc = history.present;
  const info = usePdfUi.getState().docInfo;
  if (!info || !doc.pages.length) return;
  busy(t('Saving project…'));
  try {
    const used = [...new Set(doc.pages.map((p) => p.src))];
    if (info.mainSrc && !used.includes(info.mainSrc)) used.unshift(info.mainSrc);
    const sources = used.map((id) => {
      const s = engine.require(id);
      return { id, name: s.name, data: bytesToBase64(s.bytes) };
    });
    const project: ProjectFile = {
      app: 'ultima',
      module: 'pdf',
      version: 1,
      name: info.name,
      mainSrc: info.mainSrc,
      sources,
      state: doc,
      fieldDefs: info.fieldDefs,
      initialFields: info.initialFields,
      outline: info.outline,
    };
    const result = await saveFile(JSON.stringify(project), {
      suggestedName: `${fileBaseName(info.name)}.ultima`,
      filters: [{ name: 'Ultima project', extensions: ['ultima'] }],
    });
    if (result) toast.success(t('Project saved'), result.path);
  } catch (error) {
    toast.error(t('Could not save the project'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

export async function loadProject(file: File, history: History): Promise<void> {
  busy(t('Opening…'));
  try {
    const data = JSON.parse(await file.text()) as Partial<ProjectFile>;
    if (data.app !== 'ultima' || data.module !== 'pdf' || !Array.isArray(data.sources) || !data.state) throw new Error(t('This is not a PDF Studio project'));
    await restoreProject(data as ProjectFile, history, file);
  } catch (error) {
    toast.error(t('Could not open file'), error instanceof Error ? error.message : String(error));
  } finally {
    busy(null);
  }
}

export async function restoreProject(data: ProjectFile, history: History, file?: File): Promise<void> {
  const idMap = new Map<string, string>();
  const sources: SourceDoc[] = [];
  for (const s of data.sources) {
    const src = await loadPdfSource(base64ToBytes(s.data), s.name);
    idMap.set(s.id, src.id);
    sources.push(src);
  }
  const mainId = data.mainSrc ? idMap.get(data.mainSrc) : undefined;
  if (mainId) sources.sort((a, b) => (a.id === mainId ? -1 : b.id === mainId ? 1 : 0));
  const state: DocState = {
    ...data.state,
    meta: { ...EMPTY_META, ...data.state.meta },
    pages: data.state.pages.filter((p) => idMap.has(p.src)).map((p) => ({ ...p, src: idMap.get(p.src)! })),
  };
  await showDocument(sources, data.name || file?.name || t('Untitled.pdf'), history, {
    file,
    state,
    info: { fieldDefs: data.fieldDefs ?? [], initialFields: data.initialFields ?? {}, outline: data.outline ?? [] },
  });
}

export function isProjectJson(value: unknown): value is ProjectFile {
  const v = value as Partial<ProjectFile> | null;
  return !!v && v.app === 'ultima' && v.module === 'pdf' && Array.isArray(v.sources);
}
