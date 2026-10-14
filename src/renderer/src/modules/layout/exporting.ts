import { PDFDocument } from 'pdf-lib';
import { desktop } from '../../core/platform';
import { canvasToBlob, createCanvas, get2d } from '../../core/utils/image';
import { buildDom } from './measure';
import { assetDisplayUrl } from './PageView';
import type { LayoutDoc } from './types';
import { fromUnit } from './units';
import { pageNode, toHtml, type FlowMap, type VNode } from './vnode';

/**
 * Exports: vector PDF through the desktop app's printToPdf (one standalone HTML document,
 * text as real text), raster PDF/PNG/JPG through SVG foreignObject rendering, and printing.
 */

export interface SheetOptions {
  /** Include the bleed area. */
  bleed: boolean;
  /** Draw crop marks (adds a slug around the bleed). */
  cropMarks: boolean;
}

const MARK_LEN = fromUnit(5, 'mm');
const MARK_GAP = fromUnit(2, 'mm');

/** Geometry of the printed sheet for a page. */
export function sheetGeometry(doc: LayoutDoc, index: number, o: SheetOptions) {
  const p = doc.pages[index];
  const bleed = o.bleed || o.cropMarks ? doc.bleed : 0;
  const extra = o.cropMarks ? bleed + MARK_GAP + MARK_LEN + fromUnit(1, 'mm') : bleed;
  return { width: p.width + 2 * extra, height: p.height + 2 * extra, extra, bleed, page: p };
}

function px(n: number): string {
  return `${Math.round(n * 1000) / 1000}px`;
}

function cropMarks(w: number, h: number, extra: number, bleed: number): VNode[] {
  const t = 0.5;
  const gap = bleed + MARK_GAP;
  const len = MARK_LEN;
  const line = (x: number, y: number, lw: number, lh: number): VNode => ({
    tag: 'div',
    style: { position: 'absolute', left: px(x), top: px(y), width: px(lw), height: px(lh), backgroundColor: '#000000' },
  });
  const x0 = extra;
  const y0 = extra;
  const x1 = extra + w;
  const y1 = extra + h;
  return [
    line(x0 - gap - len, y0 - t / 2, len, t),
    line(x0 - t / 2, y0 - gap - len, t, len),
    line(x1 + gap, y0 - t / 2, len, t),
    line(x1 - t / 2, y0 - gap - len, t, len),
    line(x0 - gap - len, y1 - t / 2, len, t),
    line(x0 - t / 2, y1 + gap, t, len),
    line(x1 + gap, y1 - t / 2, len, t),
    line(x1 - t / 2, y1 + gap, t, len),
  ];
}

/** One printed sheet: page (+ bleed) positioned inside the sheet, plus crop marks. */
export function sheetNode(doc: LayoutDoc, index: number, flows: FlowMap, o: SheetOptions, assetSrc?: (a: LayoutDoc['assets'][string]) => string): VNode {
  const g = sheetGeometry(doc, index, o);
  const node = pageNode({ doc, page: g.page, pageIndex: index, flows, bleed: g.bleed, withMaster: true, assetSrc, idPrefix: `p${index}` });
  node.style = { ...node.style, position: 'absolute', left: px(g.extra - g.bleed), top: px(g.extra - g.bleed) };
  const children: VNode[] = [node];
  if (o.cropMarks) children.push(...cropMarks(g.page.width, g.page.height, g.extra, g.bleed));
  return {
    tag: 'div',
    style: { position: 'relative', width: px(g.width), height: px(g.height), overflow: 'hidden', backgroundColor: '#ffffff', margin: '0' },
    children,
  };
}

/** Standalone HTML document (no scripts, images as data URLs) for printToPdf. */
export function buildPrintHtml(doc: LayoutDoc, flows: FlowMap, pages: number[], o: SheetOptions): { html: string; widthIn: number; heightIn: number } {
  const sizes = new Map<string, string>();
  const sheets: string[] = [];
  let first: { w: number; h: number } | null = null;
  pages.forEach((index, i) => {
    const g = sheetGeometry(doc, index, o);
    const key = `${(g.width / 96).toFixed(5)}in ${(g.height / 96).toFixed(5)}in`;
    if (!sizes.has(key)) sizes.set(key, `s${sizes.size}`);
    first ??= { w: g.width, h: g.height };
    const node = sheetNode(doc, index, flows, o);
    node.attrs = { class: `sheet ${sizes.get(key)}${i === pages.length - 1 ? ' last' : ''}` };
    sheets.push(toHtml(node));
  });
  const named = [...sizes].map(([size, name]) => `@page ${name} { size: ${size}; margin: 0 } .${name} { page: ${name} }`).join('\n');
  const f = first ?? { w: 816, h: 1056 };
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${toHtml(doc.name)}</title>
<style>
@page { size: ${(f.w / 96).toFixed(5)}in ${(f.h / 96).toFixed(5)}in; margin: 0 }
${named}
html, body { margin: 0; padding: 0; background: #ffffff; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { break-after: page; page-break-after: always; break-inside: avoid; }
.sheet.last { break-after: auto; page-break-after: auto; }
</style></head><body>${sheets.join('\n')}</body></html>`;
  return { html, widthIn: f.w / 96, heightIn: f.h / 96 };
}

/** Largest scale that keeps the canvas within browser limits. */
export function safeScale(w: number, h: number, scale: number): number {
  const maxSide = 16000;
  const maxArea = 200_000_000;
  let s = Math.min(scale, maxSide / w, maxSide / h);
  if (w * h * s * s > maxArea) s = Math.sqrt(maxArea / (w * h));
  return Math.max(0.01, s);
}

/** Renders a page (as a sheet) to a canvas at `scale` via SVG foreignObject. */
export async function renderPageCanvas(doc: LayoutDoc, flows: FlowMap, index: number, scale: number, o: SheetOptions = { bleed: false, cropMarks: false }): Promise<HTMLCanvasElement> {
  const g = sheetGeometry(doc, index, o);
  const s = safeScale(g.width, g.height, scale);
  const W = Math.max(1, Math.round(g.width * s));
  const H = Math.max(1, Math.round(g.height * s));
  const inner = toHtml(sheetNode(doc, index, flows, o)).replace(/^<div /, '<div xmlns="http://www.w3.org/1999/xhtml" ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${g.width} ${g.height}"><foreignObject x="0" y="0" width="${g.width}" height="${g.height}">${inner}</foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    throw new Error('The page could not be rendered (an image may be damaged)');
  }
  const canvas = createCanvas(W, H);
  const ctx = get2d(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  return canvas;
}

export type Progress = (done: number, total: number) => void;

/** PDF bytes: vector on desktop, raster pages (pdf-lib) in the browser. */
export async function exportPdf(doc: LayoutDoc, flows: FlowMap, pages: number[], o: SheetOptions & { rasterScale: number }, progress?: Progress): Promise<{ bytes: Uint8Array; vector: boolean }> {
  if (desktop) {
    const { html, widthIn, heightIn } = buildPrintHtml(doc, flows, pages, o);
    progress?.(0, 1);
    const bytes = await desktop.files.printToPdf({ html, widthIn, heightIn });
    progress?.(1, 1);
    return { bytes, vector: true };
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.name);
  pdf.setCreator('Ultima Layout & Publishing');
  pdf.setProducer('Ultima');
  for (let i = 0; i < pages.length; i++) {
    progress?.(i, pages.length);
    const g = sheetGeometry(doc, pages[i], o);
    const canvas = await renderPageCanvas(doc, flows, pages[i], o.rasterScale, o);
    const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const image = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const page = pdf.addPage([g.width * 0.75, g.height * 0.75]);
    page.drawImage(image, { x: 0, y: 0, width: g.width * 0.75, height: g.height * 0.75 });
    await new Promise((r) => setTimeout(r, 0));
  }
  progress?.(pages.length, pages.length);
  return { bytes: await pdf.save(), vector: false };
}

/** PNG/JPG blobs for pages. */
export async function exportImages(
  doc: LayoutDoc,
  flows: FlowMap,
  pages: number[],
  format: 'png' | 'jpeg',
  scale: number,
  quality: number,
  progress?: Progress,
): Promise<Blob[]> {
  const out: Blob[] = [];
  for (let i = 0; i < pages.length; i++) {
    progress?.(i, pages.length);
    const canvas = await renderPageCanvas(doc, flows, pages[i], scale);
    out.push(await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', quality));
    await new Promise((r) => setTimeout(r, 0));
  }
  progress?.(pages.length, pages.length);
  return out;
}

/** Prints the pages with the system print dialog (rendered as real DOM, then removed). */
export async function printPages(doc: LayoutDoc, flows: FlowMap, pages: number[]): Promise<void> {
  const o = { bleed: false, cropMarks: false };
  const root = document.createElement('div');
  root.className = 'ly-print-root';
  const sizes = new Map<string, string>();
  for (const index of pages) {
    const g = sheetGeometry(doc, index, o);
    const key = `${(g.width / 96).toFixed(5)}in ${(g.height / 96).toFixed(5)}in`;
    if (!sizes.has(key)) sizes.set(key, `ly-print-s${sizes.size}`);
    const el = buildDom(sheetNode(doc, index, flows, o, assetDisplayUrl)) as HTMLElement;
    el.classList.add('ly-print-sheet', sizes.get(key)!);
    root.appendChild(el);
  }
  const first = [...sizes.keys()][0] ?? '8.5in 11in';
  const style = document.createElement('style');
  style.textContent = `
@page { size: ${first}; margin: 0 }
${[...sizes].map(([size, name]) => `@page ${name} { size: ${size}; margin: 0 } .${name} { page: ${name} }`).join('\n')}
@media screen { .ly-print-root { position: fixed; left: -100000px; top: 0; } }
@media print {
  html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.ly-print-root) { display: none !important; }
  .ly-print-root { display: block !important; }
  .ly-print-sheet { break-after: page; page-break-after: always; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ly-print-sheet:last-child { break-after: auto; page-break-after: auto; }
}`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const cleanup = () => {
    root.remove();
    style.remove();
  };
  try {
    await Promise.all(Array.from(root.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));
    await document.fonts?.ready;
    await new Promise((r) => setTimeout(r, 50));
    window.print();
  } finally {
    // window.print() blocks until the dialog closes in Chromium; afterprint covers other engines
    setTimeout(cleanup, 500);
  }
}
