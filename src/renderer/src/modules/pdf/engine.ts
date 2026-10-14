/**
 * pdf.js integration: loading source documents (with password prompts), page
 * geometry, rendering, text extraction and thumbnails. Every page of the edited
 * document points at a page of one of these sources (see types.ts).
 */
// pdf.js v6 "legacy" build: same API as pdfjs-dist/build, but it ships the polyfills
// (Map#getOrInsertComputed, ...) the modern build needs in very recent browsers only.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { uid } from '../../core/utils/id';
import { normalizeRotation, type Rotation, type ViewBox } from './geometry';
import { buildPageText, type MeasureFn, type PageTextIndex, type TextItemLike } from './textgeom';
import type { OutlineNode, PageEntry, PageInfo } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Binary assets pdf.js needs (CMaps for CJK text, standard fonts, image decoders),
// bundled as hashed asset URLs and handed to pdf.js through our own data factory.
const CMAPS = import.meta.glob('../../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const FONTS = import.meta.glob('../../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const WASM = import.meta.glob('../../../../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

function byFileName(map: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, url] of Object.entries(map)) out.set(path.slice(path.lastIndexOf('/') + 1), url);
  return out;
}
const ASSETS: Record<string, Map<string, string>> = {
  cMapUrl: byFileName(CMAPS),
  standardFontDataUrl: byFileName(FONTS),
  wasmUrl: byFileName(WASM),
};

class UltimaBinaryDataFactory {
  constructor(_options: unknown) {
    void _options;
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = ASSETS[kind]?.get(filename);
    if (!url) throw new Error(`Missing PDF resource ${filename}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${filename}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export interface PageText {
  /** Raw pdf.js text content (for the selectable text layer). */
  content: TextContent;
  items: TextItemLike[];
  index: PageTextIndex;
  styles: Record<string, { fontFamily: string; ascent: number; descent: number }>;
}

export interface SourceDoc {
  id: string;
  name: string;
  /** Bytes as loaded (may be encrypted). */
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  pages: PageInfo[];
  password: string | null;
  /** Unencrypted bytes for pdf-lib (computed lazily). */
  plain?: Promise<Uint8Array>;
}

export class PasswordCancelled extends Error {
  constructor() {
    super('Password entry cancelled');
  }
}

export type PasswordPrompt = (fileName: string, incorrect: boolean) => Promise<string | null>;

/** Simple priority queue limiting concurrent render jobs. */
class RenderQueue {
  private running = 0;
  private queue: { priority: number; run: () => Promise<void> }[] = [];
  constructor(private limit: number) {}
  push<T>(priority: number, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        priority,
        run: () => job().then(resolve, reject),
      });
      this.queue.sort((a, b) => a.priority - b.priority);
      this.pump();
    });
  }
  private pump() {
    while (this.running < this.limit && this.queue.length) {
      const next = this.queue.shift()!;
      this.running++;
      void next.run().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }
}

let sharedWorker: pdfjs.PDFWorker | null = null;
function worker(): pdfjs.PDFWorker {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjs.PDFWorker();
  return sharedWorker;
}

function docParams(bytes: Uint8Array, password?: string) {
  return {
    data: bytes.slice(), // pdf.js transfers the buffer to its worker; keep ours intact
    password,
    worker: worker(),
    useWorkerFetch: false,
    BinaryDataFactory: UltimaBinaryDataFactory,
    cMapUrl: 'pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'pdfjs/standard_fonts/',
    wasmUrl: 'pdfjs/wasm/',
    enableXfa: false,
    // The app's Content-Security-Policy forbids eval; tell pdf.js not to try it.
    isEvalSupported: false,
    verbosity: 0,
  };
}

/** Loads a pdf.js document, asking for a password when needed. */
export async function openPdfjs(bytes: Uint8Array, name: string, askPassword?: PasswordPrompt, password?: string): Promise<{ pdf: PDFDocumentProxy; password: string | null }> {
  const task = pdfjs.getDocument(docParams(bytes, password));
  let used: string | null = password ?? null;
  let cancelled = false;
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    if (!askPassword) {
      cancelled = true;
      void task.destroy();
      return;
    }
    void askPassword(name, reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((pw) => {
      if (pw === null) {
        cancelled = true;
        void task.destroy();
      } else {
        used = pw;
        update(pw);
      }
    });
  };
  try {
    const pdf = await task.promise;
    return { pdf, password: used };
  } catch (error) {
    if (cancelled) throw new PasswordCancelled();
    throw error;
  }
}

async function readPageInfos(pdf: PDFDocumentProxy): Promise<PageInfo[]> {
  const out: PageInfo[] = new Array(pdf.numPages);
  const batch = 64;
  for (let start = 0; start < pdf.numPages; start += batch) {
    const end = Math.min(pdf.numPages, start + batch);
    const pages = await Promise.all(Array.from({ length: end - start }, (_, i) => pdf.getPage(start + i + 1)));
    pages.forEach((page, i) => {
      const v = page.view;
      out[start + i] = {
        view: [v[0], v[1], v[2], v[3]] as ViewBox,
        rotate: normalizeRotation(page.rotate),
        userUnit: page.userUnit || 1,
      };
    });
  }
  return out;
}

class Engine {
  sources = new Map<string, SourceDoc>();
  private pageCache = new Map<string, Promise<PDFPageProxy>>();
  private textCache = new Map<string, Promise<PageText>>();
  private thumbs = new Map<string, Promise<string>>();
  readonly renderQueue = new RenderQueue(2);
  private thumbQueue = new RenderQueue(1);

  /** Loads PDF bytes as a new source. */
  async addPdf(bytes: Uint8Array, name: string, askPassword?: PasswordPrompt): Promise<SourceDoc> {
    const { pdf, password } = await openPdfjs(bytes, name, askPassword);
    const pages = await readPageInfos(pdf);
    const src: SourceDoc = { id: uid('src'), name, bytes, pdf, pages, password };
    this.sources.set(src.id, src);
    return src;
  }

  get(id: string): SourceDoc | undefined {
    return this.sources.get(id);
  }

  require(id: string): SourceDoc {
    const s = this.sources.get(id);
    if (!s) throw new Error('A page source is missing');
    return s;
  }

  info(entry: Pick<PageEntry, 'src' | 'index'>): PageInfo | undefined {
    return this.sources.get(entry.src)?.pages[entry.index];
  }

  /** Display rotation of a page: its own /Rotate + user rotation + view rotation. */
  rotation(entry: PageEntry, viewRotation = 0): Rotation {
    return normalizeRotation((this.info(entry)?.rotate ?? 0) + entry.rotate + viewRotation);
  }

  page(src: string, index: number): Promise<PDFPageProxy> {
    const key = `${src}:${index}`;
    let p = this.pageCache.get(key);
    if (!p) {
      p = this.require(src).pdf.getPage(index + 1);
      this.pageCache.set(key, p);
      p.catch(() => this.pageCache.delete(key));
    }
    return p;
  }

  /** Text items + searchable text of a source page (cached). */
  text(src: string, index: number) {
    const key = `${src}:${index}`;
    let p = this.textCache.get(key);
    if (!p) {
      p = this.page(src, index).then(async (page) => {
        const content = await page.getTextContent();
        const items: TextItemLike[] = [];
        for (const it of content.items) {
          if ('str' in it) items.push({ str: it.str, transform: it.transform as number[], width: it.width, height: it.height, hasEOL: it.hasEOL, fontName: it.fontName });
        }
        return { content, items, index: buildPageText(items), styles: content.styles as PageText['styles'] };
      });
      this.textCache.set(key, p);
      p.catch(() => this.textCache.delete(key));
    }
    return p;
  }

  async pageText(src: string, index: number): Promise<string> {
    try {
      return (await this.text(src, index)).index.text;
    } catch {
      return '';
    }
  }

  /** Renders a page into a new canvas at `scale` (device px per PDF point). */
  async renderCanvas(
    src: string,
    index: number,
    scale: number,
    rotation: number,
    options: { signal?: AbortSignal; priority?: number; annotationMode?: number; background?: string; maxPixels?: number } = {},
  ): Promise<HTMLCanvasElement> {
    return this.renderQueue.push(options.priority ?? 0, async () => {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await this.page(src, index);
      let viewport = page.getViewport({ scale, rotation });
      const maxPixels = options.maxPixels ?? 16_777_216;
      if (viewport.width * viewport.height > maxPixels) {
        viewport = page.getViewport({ scale: scale * Math.sqrt(maxPixels / (viewport.width * viewport.height)), rotation });
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const task = page.render({
        canvas,
        viewport,
        annotationMode: options.annotationMode ?? pdfjs.AnnotationMode.ENABLE,
        background: options.background,
      });
      const abort = () => task.cancel();
      options.signal?.addEventListener('abort', abort);
      try {
        await task.promise;
      } catch (error) {
        canvas.width = canvas.height = 0;
        throw error;
      } finally {
        options.signal?.removeEventListener('abort', abort);
      }
      return canvas;
    });
  }

  /** Small rendered image of a page (object URL, cached). */
  thumbnail(src: string, index: number, rotation: number, width: number): Promise<string> {
    const key = `${src}:${index}:${rotation}:${width}`;
    let p = this.thumbs.get(key);
    if (!p) {
      p = this.thumbQueue.push(1, async () => {
        const info = this.require(src).pages[index];
        const w = rotation % 180 === 0 ? info.view[2] - info.view[0] : info.view[3] - info.view[1];
        const scale = width / Math.max(1, w * (info.userUnit || 1));
        const canvas = await this.renderCanvas(src, index, scale, rotation, { priority: 5 });
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('thumbnail'))), 'image/png'));
        canvas.width = canvas.height = 0;
        return URL.createObjectURL(blob);
      });
      this.thumbs.set(key, p);
      p.catch(() => this.thumbs.delete(key));
    }
    return p;
  }

  /** Outline (bookmarks) resolved to page indices of the source. */
  async outline(src: string): Promise<OutlineNode[]> {
    const pdf = this.require(src).pdf;
    const raw = await pdf.getOutline().catch(() => null);
    if (!raw?.length) return [];
    type RawNode = (typeof raw)[number];
    const resolve = async (dest: RawNode['dest']): Promise<number | null> => {
      try {
        const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
        if (!Array.isArray(explicit) || !explicit.length) return null;
        const ref = explicit[0] as unknown;
        if (typeof ref === 'number') return ref;
        if (ref && typeof ref === 'object' && 'num' in ref) return await pdf.getPageIndex(ref as { num: number; gen: number });
      } catch {
        // broken destination
      }
      return null;
    };
    let budget = 3000;
    const walk = async (nodes: RawNode[]): Promise<OutlineNode[]> => {
      const out: OutlineNode[] = [];
      for (const n of nodes) {
        if (budget-- <= 0) break;
        out.push({
          title: (n.title ?? '').trim() || '—',
          srcIndex: n.dest ? await resolve(n.dest) : null,
          url: n.url ?? null,
          bold: !!n.bold,
          italic: !!n.italic,
          items: n.items?.length ? await walk(n.items as RawNode[]) : [],
        });
      }
      return out;
    };
    return walk(raw);
  }

  /** Bytes pdf-lib can read (decrypts password protected sources via pdf.js). */
  plainBytes(src: string): Promise<Uint8Array> {
    const s = this.require(src);
    if (!s.plain) {
      s.plain = (async () => {
        try {
          await PDFDocument.load(s.bytes, { updateMetadata: false });
          return s.bytes;
        } catch (error) {
          if (!/encrypt/i.test(String((error as Error)?.message ?? error))) throw error;
          return decryptWithPdfjs(s);
        }
      })();
      s.plain.catch(() => (s.plain = undefined));
    }
    return s.plain;
  }

  /** Measure function for highlight rects using the page's font families. */
  measureFor(styles: Record<string, { fontFamily: string }>): MeasureFn {
    const ctx = measureContext();
    return (item, s, e) => {
      const n = item.str.length;
      if (!ctx || !n) return [s / Math.max(1, n), e / Math.max(1, n)];
      ctx.font = `100px ${styles[item.fontName ?? '']?.fontFamily ?? 'sans-serif'}`;
      const total = ctx.measureText(item.str).width || 1;
      return [ctx.measureText(item.str.slice(0, s)).width / total, ctx.measureText(item.str.slice(0, e)).width / total];
    };
  }

  /** Destroys every source (new document). */
  reset(keep: Iterable<string> = []): void {
    const keepSet = new Set(keep);
    for (const [id, s] of this.sources) {
      if (keepSet.has(id)) continue;
      void s.pdf.loadingTask.destroy().catch(() => undefined);
      this.sources.delete(id);
      for (const key of [...this.pageCache.keys()]) if (key.startsWith(`${id}:`)) this.pageCache.delete(key);
      for (const key of [...this.textCache.keys()]) if (key.startsWith(`${id}:`)) this.textCache.delete(key);
      for (const [key, url] of [...this.thumbs]) {
        if (!key.startsWith(`${id}:`)) continue;
        this.thumbs.delete(key);
        void url.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
      }
    }
  }
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/**
 * pdf-lib can't read encrypted files. pdf.js' page extraction writes a fresh,
 * unencrypted file when pages of two documents are combined, so we add a blank page
 * from a helper document and remove it again.
 */
async function decryptWithPdfjs(s: SourceDoc): Promise<Uint8Array> {
  const helper = await PDFDocument.create();
  helper.addPage([100, 100]);
  const helperBytes = await helper.save();
  const merged = await s.pdf.extractPages([{ document: null }, { document: helperBytes }]);
  const doc = await PDFDocument.load(merged, { updateMetadata: false });
  if (doc.getPageCount() > s.pages.length) doc.removePage(doc.getPageCount() - 1);
  return doc.save();
}

export const engine = new Engine();

export const PDF_ANNOTATION_MODE = pdfjs.AnnotationMode;
export { pdfjs };
