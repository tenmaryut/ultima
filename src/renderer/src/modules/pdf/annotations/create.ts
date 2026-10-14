/**
 * Creating annotation objects from tool gestures (user-space points).
 */
import { makeTextAnnot, newAnnotId, simplifyStroke, stampSize } from '../annots';
import { normRect, rectCenteredAt, rectFromFrame, type Point, type Rect, type Rotation, type ViewBox } from '../geometry';
import { stampText, type Annot, type ImageAnnot, type NoteAnnot, type StampAnnot, type TextAnnot, type ToolId, type ToolStyle } from '../types';

export const DRAG_TOOLS: ToolId[] = ['rect', 'ellipse', 'line', 'arrow', 'whiteout', 'redact', 'highlight', 'underline', 'strike'];
export const MARKUP_TOOLS: ToolId[] = ['highlight', 'underline', 'strike'];
export const CLICK_TOOLS: ToolId[] = ['text', 'note', 'stamp', 'image', 'signature', 'date'];

export function formatDate(format: ToolStyle['dateFormat'], date = new Date(), locale?: string): string {
  if (format === 'iso') {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  if (format === 'long') return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  return date.toLocaleDateString(locale);
}

/** Constrains b relative to a: squares for boxes, 45° steps for lines (shift key). */
export function constrain(tool: ToolId, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (tool === 'line' || tool === 'arrow') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * size, y: a.y + Math.sign(dy || 1) * size };
}

/** Object for a drag gesture from a to b (user space). Null when the drag is too small. */
export function createFromDrag(tool: ToolId, style: ToolStyle, page: string, a: Point, b: Point): Annot | null {
  const r = normRect(a.x, a.y, b.x, b.y);
  const id = newAnnotId();
  switch (tool) {
    case 'rect':
    case 'ellipse':
      if (r.w < 2 || r.h < 2) return null;
      return { id, page, type: tool, rect: r, stroke: style.color, fill: style.fill, width: style.strokeWidth, opacity: style.opacity };
    case 'line':
    case 'arrow':
      if (Math.hypot(b.x - a.x, b.y - a.y) < 3) return null;
      return { id, page, type: tool, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: style.color, width: style.strokeWidth, opacity: style.opacity };
    case 'whiteout':
      if (r.w < 2 || r.h < 2) return null;
      return { id, page, type: 'whiteout', rect: r, color: '#ffffff' };
    case 'redact':
      if (r.w < 2 || r.h < 2) return null;
      return { id, page, type: 'redact', rect: r };
    case 'highlight':
    case 'underline':
    case 'strike':
      if (r.w < 2 || r.h < 2) return null;
      return markupFromRects(tool, style, page, [r]);
    default:
      return null;
  }
}

export function markupFromRects(tool: 'highlight' | 'underline' | 'strike', style: ToolStyle, page: string, rects: Rect[]): Annot {
  const color = tool === 'highlight' ? style.highlightColor : style.color;
  return { id: newAnnotId(), page, type: tool, rects, color, opacity: tool === 'highlight' ? 1 : style.opacity };
}

export function createInk(style: ToolStyle, page: string, points: number[]): Annot | null {
  if (points.length < 2) return null;
  const stroke = simplifyStroke(points, Math.max(0.3, style.strokeWidth * 0.25));
  return { id: newAnnotId(), page, type: 'ink', strokes: [stroke], color: style.color, width: style.strokeWidth, opacity: style.opacity };
}

export function createText(style: ToolStyle, page: string, origin: Point, rot: Rotation, text = '', width?: number): TextAnnot {
  return makeTextAnnot(
    page,
    origin,
    rot,
    { text, font: style.font, bold: style.bold, italic: style.italic, size: style.fontSize, color: style.textColor, autoWidth: width === undefined },
    width ?? 200,
  );
}

export function createDate(style: ToolStyle, page: string, origin: Point, rot: Rotation, locale?: string): TextAnnot {
  return makeTextAnnot(page, origin, rot, {
    text: formatDate(style.dateFormat, new Date(), locale),
    font: style.font,
    bold: true,
    italic: false,
    size: style.fontSize,
    color: '#1d4ed8',
    border: '#1d4ed8',
  });
}

export function createNote(style: ToolStyle, page: string, origin: Point, rot: Rotation, author: string): NoteAnnot {
  return { id: newAnnotId(), page, type: 'note', rect: rectFromFrame(origin, rot, 20, 20), rot, text: '', color: style.noteColor, author, createdAt: Date.now() };
}

export function createStamp(style: ToolStyle, page: string, center: Point, rot: Rotation, translate: (text: string) => string = (s) => s): StampAnnot {
  const label = stampText(style.stamp, translate) || stampText('APPROVED', translate);
  const size = stampSize(label);
  return { id: newAnnotId(), page, type: 'stamp', rect: rectCenteredAt(center, rot, size.w, size.h), rot, label, color: style.stampColor };
}

/** Places an image centred on a point, scaled down to fit half the page. */
export function createImage(
  page: string,
  center: Point,
  rot: Rotation,
  view: ViewBox,
  img: { src: string; width: number; height: number; kind: 'image' | 'signature' },
): ImageAnnot {
  const pageW = rot % 180 === 0 ? view[2] - view[0] : view[3] - view[1];
  const pageH = rot % 180 === 0 ? view[3] - view[1] : view[2] - view[0];
  const maxW = pageW * (img.kind === 'signature' ? 0.3 : 0.5);
  const maxH = pageH * 0.5;
  const scale = Math.min(1, maxW / Math.max(1, img.width), maxH / Math.max(1, img.height));
  const w = Math.max(8, img.width * scale);
  const h = Math.max(8, img.height * scale);
  return { id: newAnnotId(), page, type: 'image', rect: rectCenteredAt(center, rot, w, h), rot, src: img.src, kind: img.kind, opacity: 1 };
}
