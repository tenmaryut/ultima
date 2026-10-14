/**
 * Draws annotation objects into PDF pages with pdf-lib ("flattening"). Coordinates of
 * the objects are PDF user space of the page, so they are drawn as they are; upright
 * objects (text, images, stamps) are rotated by their `rot` so they read correctly
 * when the page is displayed with its /Rotate.
 */
import {
  BlendMode,
  degrees,
  LineCapStyle,
  LineJoinStyle,
  PDFHexString,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
  rectangle,
  fill,
  setFillingColor,
  moveTo,
  lineTo,
  closePath,
  setStrokingColor,
  setLineWidth,
  stroke,
} from 'pdf-lib';
import { arrowHead, arrowShaftEnd, inkPathD } from './annots';
import { contentFrame, type Point, type Rect } from './geometry';
import { layoutText, standardFontFor, TEXT_PAD, textWidth, unsupportedCharacters, type FontFamily } from './textlayout';
import type { Annot, ImageAnnot, NoteAnnot, StampAnnot, TextAnnot } from './types';

export function hexToRgb(color: string): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color.trim());
  if (!m) return rgb(0, 0, 0);
  let hex = m[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Decodes a data: URL into bytes and mime type (no DOM needed). */
export function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (head.includes(';base64')) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(body)), mime };
}

export interface FlattenHooks {
  /** Renders a text box whose characters the standard fonts can't write (PNG bytes, upright). */
  rasterizeText?: (a: TextAnnot) => Promise<Uint8Array>;
  /** Write sticky notes as real PDF comments (default) instead of drawing them. */
  notesAsComments?: boolean;
}

/** Per-document cache of embedded fonts and images. */
export class FlattenResources {
  private fonts = new Map<string, Promise<PDFFont>>();
  private images = new Map<string, Promise<PDFImage>>();
  constructor(readonly doc: PDFDocument) {}

  font(family: FontFamily, bold: boolean, italic: boolean): Promise<PDFFont> {
    const name = standardFontFor(family, bold, italic);
    let f = this.fonts.get(name);
    if (!f) {
      f = this.doc.embedFont(name);
      this.fonts.set(name, f);
    }
    return f;
  }

  image(dataUrl: string): Promise<PDFImage> {
    let p = this.images.get(dataUrl);
    if (!p) {
      const { bytes, mime } = dataUrlBytes(dataUrl);
      p = mime === 'image/jpeg' || mime === 'image/jpg' ? this.doc.embedJpg(bytes) : this.doc.embedPng(bytes);
      this.images.set(dataUrl, p);
    }
    return p;
  }

  imageBytes(bytes: Uint8Array): Promise<PDFImage> {
    return this.doc.embedPng(bytes);
  }
}

function frameAt(rect: Rect, rot: TextAnnot['rot'], u: number, v: number): Point {
  const f = contentFrame(rect, rot);
  return { x: f.origin.x + u * f.ax.x + v * f.dn.x, y: f.origin.y + u * f.ax.y + v * f.dn.y };
}

async function drawText(page: PDFPage, a: TextAnnot, res: FlattenResources, hooks: FlattenHooks): Promise<void> {
  const frame = contentFrame(a.rect, a.rot);
  if (a.background) {
    page.drawRectangle({ x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h, color: hexToRgb(a.background) });
  }
  if (a.border) {
    page.drawRectangle({ x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h, borderColor: hexToRgb(a.border), borderWidth: 1 });
  }
  if (!a.text.trim()) return;
  if (unsupportedCharacters(a.text).length && hooks.rasterizeText) {
    const png = await hooks.rasterizeText(a);
    const img = await res.imageBytes(png);
    const bottomLeft = frameAt(a.rect, a.rot, 0, frame.height);
    page.drawImage(img, { x: bottomLeft.x, y: bottomLeft.y, width: frame.width, height: frame.height, rotate: degrees(a.rot) });
    return;
  }
  const font = await res.font(a.font, a.bold, a.italic);
  const spec = { family: a.font, bold: a.bold, italic: a.italic, size: a.size };
  const layout = layoutText(a.text, spec, frame.width, a.autoWidth, a.align);
  const color = hexToRgb(a.color);
  layout.lines.forEach((line, i) => {
    const safe = [...line].map((ch) => (unsupportedCharacters(ch).length ? '?' : ch)).join('');
    if (!safe.trim()) return;
    const p = frameAt(a.rect, a.rot, layout.offsets[i], TEXT_PAD + i * layout.lineHeight + layout.ascent);
    page.drawText(safe, { x: p.x, y: p.y, size: a.size, font, color, rotate: degrees(a.rot) });
  });
}

function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return [
    `M${rr} 0`,
    `L${w - rr} 0`,
    `Q${w} 0 ${w} ${rr}`,
    `L${w} ${h - rr}`,
    `Q${w} ${h} ${w - rr} ${h}`,
    `L${rr} ${h}`,
    `Q0 ${h} 0 ${h - rr}`,
    `L0 ${rr}`,
    `Q0 0 ${rr} 0`,
    'Z',
  ].join(' ');
}

/** Stamp geometry in content space (shared with the on-screen renderer). */
export function stampLayout(label: string, w: number, h: number) {
  const widthAt1 = textWidth(label, { family: 'helvetica', bold: true, italic: false, size: 1 });
  const border = Math.max(1, h * 0.07);
  const pad = h * 0.22;
  const size = Math.max(4, Math.min(h * 0.55, (w - pad * 2) / Math.max(0.01, widthAt1)));
  const labelWidth = widthAt1 * size;
  return { border, size, x: (w - labelWidth) / 2, baseline: h / 2 + size * 0.35, radius: h * 0.18, inset: border / 2 + h * 0.05 };
}

async function drawStamp(page: PDFPage, a: StampAnnot, res: FlattenResources): Promise<void> {
  const f = contentFrame(a.rect, a.rot);
  const font = await res.font('helvetica', true, false);
  const label = a.label.replace(/[^\x20-\x7e -ÿ]/g, '?');
  const lay = stampLayout(label, f.width, f.height);
  const color = hexToRgb(a.color);
  const ins = lay.inset;
  page.drawSvgPath(roundedRectPath(f.width - ins * 2, f.height - ins * 2, lay.radius), {
    x: f.origin.x + ins * (f.ax.x + f.dn.x),
    y: f.origin.y + ins * (f.ax.y + f.dn.y),
    rotate: degrees(a.rot),
    borderColor: color,
    borderWidth: lay.border,
    borderOpacity: 0.9,
  });
  const p = frameAt(a.rect, a.rot, lay.x, lay.baseline);
  page.drawText(label, { x: p.x, y: p.y, size: lay.size, font, color, rotate: degrees(a.rot), opacity: 0.9 });
}

async function drawImage(page: PDFPage, a: ImageAnnot, res: FlattenResources): Promise<void> {
  const f = contentFrame(a.rect, a.rot);
  const img = await res.image(a.src);
  const bottomLeft = frameAt(a.rect, a.rot, 0, f.height);
  page.drawImage(img, { x: bottomLeft.x, y: bottomLeft.y, width: f.width, height: f.height, rotate: degrees(a.rot), opacity: a.opacity < 1 ? a.opacity : undefined });
}

/** Note icon (speech bubble) path in content coordinates for a w×h box. */
export function noteIconPath(w: number, h: number): string {
  const r = Math.min(w, h) * 0.18;
  const bh = h * 0.78;
  return [
    `M${r} 0`,
    `L${w - r} 0`,
    `Q${w} 0 ${w} ${r}`,
    `L${w} ${bh - r}`,
    `Q${w} ${bh} ${w - r} ${bh}`,
    `L${w * 0.45} ${bh}`,
    `L${w * 0.22} ${h}`,
    `L${w * 0.26} ${bh}`,
    `L${r} ${bh}`,
    `Q0 ${bh} 0 ${bh - r}`,
    `L0 ${r}`,
    `Q0 0 ${r} 0`,
    'Z',
  ].join(' ');
}

function drawNoteIcon(page: PDFPage, a: NoteAnnot): void {
  const f = contentFrame(a.rect, a.rot);
  page.drawSvgPath(noteIconPath(f.width, f.height), {
    x: f.origin.x,
    y: f.origin.y,
    rotate: degrees(a.rot),
    color: hexToRgb(a.color),
    borderColor: rgb(0.25, 0.25, 0.25),
    borderWidth: 0.6,
  });
}

/** Adds a sticky note as a PDF Text annotation (comment) with its own appearance. */
function addNoteComment(doc: PDFDocument, page: PDFPage, a: NoteAnnot): void {
  const { context } = doc;
  const c = hexToRgb(a.color);
  const w = 20;
  const h = 20;
  const ops = [
    pushGraphicsState(),
    setFillingColor(c),
    setStrokingColor(rgb(0.25, 0.25, 0.25)),
    setLineWidth(0.6),
    rectangle(1, 4, w - 2, h - 5),
    fill(),
    moveTo(5, 4),
    lineTo(4, 0.5),
    lineTo(9, 4),
    closePath(),
    fill(),
    setStrokingColor(rgb(0.2, 0.2, 0.2)),
    moveTo(4, 14),
    lineTo(16, 14),
    moveTo(4, 11),
    lineTo(16, 11),
    moveTo(4, 8),
    lineTo(12, 8),
    stroke(),
    popGraphicsState(),
  ];
  const ap = context.formXObject(ops, { BBox: [0, 0, w, h] });
  const apRef = context.register(ap);
  const r = a.rect;
  const annot = context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [r.x, r.y, r.x + r.w, r.y + r.h],
    Contents: PDFHexString.fromText(a.text),
    T: PDFHexString.fromText(a.author || 'Ultima'),
    M: PDFString.fromDate(new Date(a.createdAt || Date.now())),
    Name: 'Comment',
    C: [c.red, c.green, c.blue],
    F: 4 | 8 | 16,
    Open: false,
    AP: { N: apRef },
  });
  page.node.addAnnot(context.register(annot));
}

/** Draws one object into a page. */
export async function drawAnnot(doc: PDFDocument, page: PDFPage, a: Annot, res: FlattenResources, hooks: FlattenHooks = {}): Promise<void> {
  switch (a.type) {
    case 'text':
      return drawText(page, a, res, hooks);
    case 'ink': {
      page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
      for (const s of a.strokes) {
        const d = inkPathD(s, true);
        if (!d) continue;
        page.drawSvgPath(d, {
          x: 0,
          y: 0,
          borderColor: hexToRgb(a.color),
          borderWidth: a.width,
          borderOpacity: a.opacity < 1 ? a.opacity : undefined,
          borderLineCap: LineCapStyle.Round,
        });
      }
      page.pushOperators(popGraphicsState());
      return;
    }
    case 'highlight':
      for (const r of a.rects) {
        page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: hexToRgb(a.color), opacity: a.opacity, blendMode: BlendMode.Multiply });
      }
      return;
    case 'underline':
    case 'strike':
      for (const r of a.rects) {
        const vertical = r.h > r.w * 3;
        const thickness = Math.max(0.6, (vertical ? r.w : r.h) * 0.07);
        const t = a.type === 'underline' ? 0.14 : 0.45;
        const start = vertical ? { x: r.x + r.w * (1 - t), y: r.y } : { x: r.x, y: r.y + r.h * t };
        const end = vertical ? { x: r.x + r.w * (1 - t), y: r.y + r.h } : { x: r.x + r.w, y: r.y + r.h * t };
        page.drawLine({ start, end, thickness, color: hexToRgb(a.color), opacity: a.opacity < 1 ? a.opacity : undefined });
      }
      return;
    case 'rect':
      page.drawRectangle({
        x: a.rect.x,
        y: a.rect.y,
        width: a.rect.w,
        height: a.rect.h,
        borderColor: a.width > 0 ? hexToRgb(a.stroke) : undefined,
        borderWidth: a.width,
        color: a.fill ? hexToRgb(a.fill) : undefined,
        opacity: a.fill ? a.opacity : undefined,
        borderOpacity: a.opacity < 1 ? a.opacity : undefined,
      });
      return;
    case 'ellipse':
      page.drawEllipse({
        x: a.rect.x + a.rect.w / 2,
        y: a.rect.y + a.rect.h / 2,
        xScale: a.rect.w / 2,
        yScale: a.rect.h / 2,
        borderColor: a.width > 0 ? hexToRgb(a.stroke) : undefined,
        borderWidth: a.width,
        color: a.fill ? hexToRgb(a.fill) : undefined,
        opacity: a.fill ? a.opacity : undefined,
        borderOpacity: a.opacity < 1 ? a.opacity : undefined,
      });
      return;
    case 'line':
    case 'arrow': {
      const end = a.type === 'arrow' ? arrowShaftEnd(a) : { x: a.x2, y: a.y2 };
      page.drawLine({
        start: { x: a.x1, y: a.y1 },
        end,
        thickness: a.width,
        color: hexToRgb(a.color),
        opacity: a.opacity < 1 ? a.opacity : undefined,
        lineCap: LineCapStyle.Round,
      });
      if (a.type === 'arrow') {
        const [p0, p1, p2] = arrowHead(a.x1, a.y1, a.x2, a.y2, a.width);
        page.drawSvgPath(`M${p0.x} ${-p0.y} L${p1.x} ${-p1.y} L${p2.x} ${-p2.y} Z`, {
          x: 0,
          y: 0,
          color: hexToRgb(a.color),
          opacity: a.opacity < 1 ? a.opacity : undefined,
        });
      }
      return;
    }
    case 'image':
      return drawImage(page, a, res);
    case 'stamp':
      return drawStamp(page, a, res);
    case 'whiteout':
      page.drawRectangle({ x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h, color: hexToRgb(a.color || '#ffffff') });
      return;
    case 'note':
      if (hooks.notesAsComments !== false) addNoteComment(doc, page, a);
      else drawNoteIcon(page, a);
      return;
    case 'redact':
      // pending marks are applied with "Apply redactions" (rasterization), never here
      return;
  }
}
