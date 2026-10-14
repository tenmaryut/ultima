/**
 * Creating PDFs from images and plain text (images → PDF, merge with images, text
 * handoffs from other modules).
 */
import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';
import { canvasToBlob, createCanvas, get2d } from '../../core/utils/image';
import { isEncodable, textWidth, wrapLines } from './textlayout';

export type PageSizeMode = 'fit' | 'a4' | 'letter';
export type Orientation = 'auto' | 'portrait' | 'landscape';

export interface ImagesToPdfOptions {
  size: PageSizeMode;
  orientation: Orientation;
  /** Margin in points (A4 / Letter only). */
  margin: number;
}

export const DEFAULT_IMAGE_OPTIONS: ImagesToPdfOptions = { size: 'fit', orientation: 'auto', margin: 0 };

export const PAGE_SIZES: Record<'a4' | 'letter', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** EXIF orientation (1-8) of a JPEG file, 1 when absent. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && offset + 10 < bytes.length && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > bytes.length) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 > bytes.length) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const v = view.getUint16(entry + 8, little);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda || length < 2) return 1;
    offset += 2 + length;
  }
  return 1;
}

/** Page and image placement for an image of w×h pixels (pure). */
export function imagePlacement(w: number, h: number, options: ImagesToPdfOptions): { pageW: number; pageH: number; x: number; y: number; width: number; height: number } {
  const ptW = (w * 72) / 96;
  const ptH = (h * 72) / 96;
  if (options.size === 'fit') return { pageW: ptW, pageH: ptH, x: 0, y: 0, width: ptW, height: ptH };
  let [pw, ph] = PAGE_SIZES[options.size];
  const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && w > h);
  if (landscape) [pw, ph] = [ph, pw];
  const m = Math.max(0, Math.min(options.margin, Math.min(pw, ph) / 3));
  const boxW = pw - m * 2;
  const boxH = ph - m * 2;
  const scale = Math.min(boxW / ptW, boxH / ptH);
  const width = ptW * scale;
  const height = ptH * scale;
  return { pageW: pw, pageH: ph, x: (pw - width) / 2, y: (ph - height) / 2, width, height };
}

async function decodeToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const canvas = createCanvas(bitmap.width, bitmap.height);
  get2d(canvas).drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = get2d(canvas, true);
  const step = Math.max(1, Math.floor(Math.sqrt((canvas.width * canvas.height) / 250_000)));
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) if (data[(y * canvas.width + x) * 4 + 3] < 250) return true;
  }
  return false;
}

/** Embeds any browser-decodable image into a pdf-lib document (keeping JPEG/PNG bytes when possible). */
export async function embedImageFile(doc: PDFDocument, file: Blob): Promise<{ image: PDFImage; width: number; height: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  try {
    if (isJpeg && jpegOrientation(bytes) === 1) {
      const image = await doc.embedJpg(bytes);
      return { image, width: image.width, height: image.height };
    }
    if (isPng) {
      const image = await doc.embedPng(bytes);
      return { image, width: image.width, height: image.height };
    }
  } catch {
    // fall back to re-encoding through a canvas
  }
  const canvas = await decodeToCanvas(file);
  const alpha = hasTransparency(canvas);
  const blob = await canvasToBlob(canvas, alpha ? 'image/png' : 'image/jpeg', 0.92);
  const out = new Uint8Array(await blob.arrayBuffer());
  const image = alpha ? await doc.embedPng(out) : await doc.embedJpg(out);
  const result = { image, width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0;
  return result;
}

/** One page per image. */
export async function imagesToPdf(files: Blob[], options: ImagesToPdfOptions, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let i = 0;
  for (const file of files) {
    const { image, width, height } = await embedImageFile(doc, file);
    const place = imagePlacement(width, height, options);
    const page = doc.addPage([place.pageW, place.pageH]);
    if (options.size !== 'fit') page.drawRectangle({ x: 0, y: 0, width: place.pageW, height: place.pageH, color: rgb(1, 1, 1) });
    page.drawImage(image, { x: place.x, y: place.y, width: place.width, height: place.height });
    onProgress?.(++i, files.length);
  }
  doc.setProducer('Ultima PDF Studio');
  doc.setCreator('Ultima');
  return doc.save();
}

/** Lays plain text out on A4 pages (Helvetica 11pt). */
export async function textToPdf(text: string, title = ''): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = PAGE_SIZES.a4;
  const margin = 56;
  const size = 11;
  const lineHeight = size * 1.4;
  const spec = { family: 'helvetica' as const, bold: false, italic: false, size };
  const clean = [...text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')].map((ch) => (isEncodable(ch) ? ch : '?')).join('');
  const lines = wrapLines(clean, pw - margin * 2, (s) => textWidth(s, spec));
  let page = doc.addPage([pw, ph]);
  let y = ph - margin;
  if (title.trim()) {
    const safeTitle = [...title].map((ch) => (isEncodable(ch) ? ch : '?')).join('');
    page.drawText(safeTitle, { x: margin, y: y - 16, size: 16, font: bold });
    y -= 36;
  }
  for (const line of lines) {
    if (y - lineHeight < margin) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
    if (line.trim()) page.drawText(line, { x: margin, y: y - size, size, font });
    y -= lineHeight;
  }
  if (title) doc.setTitle(title);
  doc.setProducer('Ultima PDF Studio');
  return doc.save();
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|ico)$/i.test(file.name);
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
