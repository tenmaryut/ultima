import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { desktop } from '../../core/platform';
import { canvasToBlob, createCanvas, get2d, loadImage } from '../../core/utils/image';
import type { Artboard, VDoc } from './model';
import { exportArtboardSvg, printableHtml } from './svgexport';

/** Max canvas side to stay within browser limits. */
const MAX_SIDE = 16384;
const MAX_AREA = 120_000_000;

export function clampScale(width: number, height: number, scale: number): number {
  let s = scale;
  if (width * s > MAX_SIDE) s = MAX_SIDE / width;
  if (height * s > MAX_SIDE) s = MAX_SIDE / height;
  if (width * height * s * s > MAX_AREA) s = Math.sqrt(MAX_AREA / (width * height));
  return Math.max(0.01, s);
}

/** Renders SVG markup into a canvas (fonts installed on the system are used). */
export async function svgToCanvas(svg: string, width: number, height: number, scale = 1, background?: string | null): Promise<HTMLCanvasElement> {
  const s = clampScale(width, height, scale);
  const canvas = createCanvas(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)));
  const ctx = get2d(canvas);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const img = await loadImage(blob);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderArtboard(doc: VDoc, ab: Artboard, scale: number, transparent: boolean, forceBackground?: string): Promise<HTMLCanvasElement> {
  const svg = exportArtboardSvg(doc, ab, { background: !transparent, pretty: false });
  return svgToCanvas(svg, ab.width, ab.height, scale, forceBackground ?? null);
}

export async function artboardPng(doc: VDoc, ab: Artboard, scale: number, transparent: boolean): Promise<Blob> {
  return canvasToBlob(await renderArtboard(doc, ab, scale, transparent), 'image/png');
}

export async function artboardJpg(doc: VDoc, ab: Artboard, scale: number, quality: number): Promise<Blob> {
  // JPG has no transparency: transparent artboards are flattened on white
  const canvas = await renderArtboard(doc, ab, scale, false, ab.background ? undefined : '#ffffff');
  return canvasToBlob(canvas, 'image/jpeg', quality);
}

/**
 * Builds a PDF: vector output through the desktop app's print engine, or high-resolution
 * raster pages in the browser.
 */
export async function artboardsPdf(doc: VDoc, artboards: Artboard[], onProgress?: (p: number) => void): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(doc.name);
  out.setCreator('Ultima Vector Designer');
  let i = 0;
  for (const ab of artboards) {
    if (desktop) {
      const svg = exportArtboardSvg(doc, ab, { background: true, pretty: false });
      const bytes = await desktop.files.printToPdf({ html: printableHtml(svg, ab.width, ab.height), widthIn: ab.width / 96, heightIn: ab.height / 96 });
      const src = await PDFDocument.load(bytes);
      const pages = await out.copyPages(src, src.getPageIndices().slice(0, 1));
      pages.forEach((p) => out.addPage(p));
    } else {
      const scale = clampScale(ab.width, ab.height, Math.max(1, Math.min(4, 3000 / Math.max(ab.width, ab.height))));
      const canvas = await renderArtboard(doc, ab, scale, false, ab.background ? undefined : '#ffffff');
      const png = await canvasToBlob(canvas, 'image/png');
      const image = await out.embedPng(new Uint8Array(await png.arrayBuffer()));
      const page = out.addPage([ab.width * 0.75, ab.height * 0.75]);
      page.drawImage(image, { x: 0, y: 0, width: ab.width * 0.75, height: ab.height * 0.75 });
    }
    i++;
    onProgress?.(i / artboards.length);
  }
  return out.save();
}

export async function zipBlobs(files: { name: string; data: Blob | string }[]): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    let k = 2;
    while (used.has(name)) name = f.name.replace(/(\.[^.]+)$/, `-${k++}$1`);
    used.add(name);
    zip.file(name, f.data);
  }
  return zip.generateAsync({ type: 'blob' });
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'artwork';
}
