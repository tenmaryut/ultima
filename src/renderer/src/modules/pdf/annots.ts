/**
 * Pure operations on annotation objects: bounds, hit testing, move/resize, text
 * re-layout, ink path smoothing. All coordinates are PDF user space (points).
 */
import { uid } from '../../core/utils/id';
import {
  boundsOfPoints,
  contentFrame,
  distanceToSegment,
  normRect,
  rectContains,
  rectFromFrame,
  unionRects,
  type Point,
  type Rect,
  type Rotation,
} from './geometry';
import { layoutText } from './textlayout';
import type { Annot, ImageAnnot, InkAnnot, StampAnnot, TextAnnot } from './types';

export function newAnnotId(): string {
  return uid('a');
}

export function inkPoints(stroke: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < stroke.length; i += 2) out.push({ x: stroke[i], y: stroke[i + 1] });
  return out;
}

/** Bounding box of an object in user space. */
export function annotBounds(a: Annot): Rect {
  switch (a.type) {
    case 'ink': {
      const b = boundsOfPoints(a.strokes.flatMap(inkPoints));
      const pad = a.width / 2;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    case 'highlight':
    case 'underline':
    case 'strike':
      return unionRects(a.rects);
    case 'line':
    case 'arrow': {
      const pad = Math.max(a.width, a.type === 'arrow' ? a.width * 3 + 4 : 0) / 2;
      const r = normRect(a.x1, a.y1, a.x2, a.y2);
      return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    }
    default:
      return a.rect;
  }
}

/** True when the point (user space) hits the object; `tol` in points. */
export function hitTest(a: Annot, p: Point, tol: number): boolean {
  switch (a.type) {
    case 'ink':
      return a.strokes.some((s) => {
        const pts = inkPoints(s);
        if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol + a.width / 2;
        for (let i = 1; i < pts.length; i++) if (distanceToSegment(p, pts[i - 1], pts[i]) <= tol + a.width / 2) return true;
        return false;
      });
    case 'line':
    case 'arrow':
      return distanceToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= tol + a.width / 2;
    case 'highlight':
    case 'underline':
    case 'strike':
      return a.rects.some((r) => rectContains(r, p, tol));
    case 'rect':
    case 'ellipse':
      if (a.fill) return rectContains(a.rect, p, tol);
      // outline only: hit near the border
      return rectContains(a.rect, p, tol + a.width / 2) && !rectContains(shrink(a.rect, tol + a.width / 2), p);
    default:
      return rectContains(annotBounds(a), p, tol);
  }
}

function shrink(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: Math.max(0, r.w - by * 2), h: Math.max(0, r.h - by * 2) };
}

function moveRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

export function moveAnnot(a: Annot, dx: number, dy: number): Annot {
  switch (a.type) {
    case 'ink':
      return { ...a, strokes: a.strokes.map((s) => s.map((v, i) => v + (i % 2 === 0 ? dx : dy))) };
    case 'highlight':
    case 'underline':
    case 'strike':
      return { ...a, rects: a.rects.map((r) => moveRect(r, dx, dy)) };
    case 'line':
    case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    default:
      return { ...a, rect: moveRect(a.rect, dx, dy) };
  }
}

function mapPoint(x: number, y: number, from: Rect, to: Rect): Point {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  return { x: to.x + (x - from.x) * sx, y: to.y + (y - from.y) * sy };
}

function mapRect(r: Rect, from: Rect, to: Rect): Rect {
  const a = mapPoint(r.x, r.y, from, to);
  const b = mapPoint(r.x + r.w, r.y + r.h, from, to);
  return normRect(a.x, a.y, b.x, b.y);
}

/** Re-computes a text box's size from its content, keeping its visual top-left corner. */
export function relayoutText(a: TextAnnot): TextAnnot {
  const frame = contentFrame(a.rect, a.rot);
  const layout = layoutText(a.text || ' ', { family: a.font, bold: a.bold, italic: a.italic, size: a.size }, frame.width, a.autoWidth, a.align);
  const rect = rectFromFrame(frame.origin, a.rot, a.autoWidth ? layout.width : frame.width, layout.height);
  return { ...a, rect };
}

/**
 * Resizes an object from its current bounds to `to` (user space). Text boxes change
 * their wrap width (height follows the text); other objects scale.
 */
export function resizeAnnot(a: Annot, to: Rect): Annot {
  const from = annotBounds(a);
  const target: Rect = { x: to.x, y: to.y, w: Math.max(1, to.w), h: Math.max(1, to.h) };
  switch (a.type) {
    case 'text': {
      const frame = contentFrame(target, a.rot);
      const minW = a.size * 1.2;
      const next: TextAnnot = {
        ...a,
        autoWidth: false,
        rect: rectFromFrame(contentFrame(target, a.rot).origin, a.rot, Math.max(minW, frame.width), frame.height),
      };
      return relayoutText(next);
    }
    case 'ink':
      return {
        ...a,
        strokes: a.strokes.map((s) => {
          const out: number[] = [];
          for (let i = 0; i + 1 < s.length; i += 2) {
            const p = mapPoint(s[i], s[i + 1], from, target);
            out.push(p.x, p.y);
          }
          return out;
        }),
      };
    case 'highlight':
    case 'underline':
    case 'strike':
      return { ...a, rects: a.rects.map((r) => mapRect(r, from, target)) };
    case 'line':
    case 'arrow': {
      const p1 = mapPoint(a.x1, a.y1, from, target);
      const p2 = mapPoint(a.x2, a.y2, from, target);
      return { ...a, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    default:
      return { ...a, rect: target };
  }
}

/** Objects whose aspect ratio is kept when resized from a corner. */
export function keepsAspect(a: Annot): a is ImageAnnot | StampAnnot {
  return a.type === 'image' || a.type === 'stamp';
}

export function duplicateAnnot(a: Annot, pageId: string, offset = 12): Annot {
  const moved = moveAnnot({ ...a, id: newAnnotId(), page: pageId } as Annot, offset, -offset);
  return moved;
}

/** Removes points closer than `minDist` to the previous kept point. */
export function simplifyStroke(stroke: number[], minDist = 0.6): number[] {
  if (stroke.length <= 4) return stroke.slice();
  const out = [stroke[0], stroke[1]];
  for (let i = 2; i + 1 < stroke.length; i += 2) {
    const lx = out[out.length - 2];
    const ly = out[out.length - 1];
    if (Math.hypot(stroke[i] - lx, stroke[i + 1] - ly) >= minDist) out.push(stroke[i], stroke[i + 1]);
  }
  const n = stroke.length;
  if (out[out.length - 2] !== stroke[n - 2] || out[out.length - 1] !== stroke[n - 1]) out.push(stroke[n - 2], stroke[n - 1]);
  return out;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Smooth SVG path through a stroke (quadratic curves through midpoints).
 * `flipY` negates y (pdf-lib's drawSvgPath uses a y-down SVG coordinate system).
 */
export function inkPathD(stroke: number[], flipY = false): string {
  const pts = inkPoints(stroke).map((p) => ({ x: p.x, y: flipY ? -p.y : p.y }));
  if (!pts.length) return '';
  if (pts.length === 1) return `M${fmt(pts[0].x)} ${fmt(pts[0].y)} L${fmt(pts[0].x + 0.01)} ${fmt(pts[0].y)}`;
  if (pts.length === 2) return `M${fmt(pts[0].x)} ${fmt(pts[0].y)} L${fmt(pts[1].x)} ${fmt(pts[1].y)}`;
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${fmt(pts[i].x)} ${fmt(pts[i].y)} ${fmt(mx)} ${fmt(my)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

/** Arrow head triangle (user space) for a line from (x1,y1) to (x2,y2). */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): Point[] {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const size = Math.max(6, width * 3.5);
  const bx = x2 - ux * size;
  const by = y2 - uy * size;
  const half = size * 0.45;
  return [
    { x: x2, y: y2 },
    { x: bx - uy * half, y: by + ux * half },
    { x: bx + uy * half, y: by - ux * half },
  ];
}

/** Line end shortened so the stroke does not poke through the arrow tip. */
export function arrowShaftEnd(a: { x1: number; y1: number; x2: number; y2: number; width: number }): Point {
  const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) || 1;
  const size = Math.max(6, a.width * 3.5) * 0.8;
  const t = Math.max(0, (len - size) / len);
  return { x: a.x1 + (a.x2 - a.x1) * t, y: a.y1 + (a.y2 - a.y1) * t };
}

/** Builds a new text annotation laid out at a content origin. */
export function makeTextAnnot(
  page: string,
  origin: Point,
  rot: Rotation,
  props: Pick<TextAnnot, 'text' | 'font' | 'bold' | 'italic' | 'size' | 'color'> & Partial<Pick<TextAnnot, 'align' | 'autoWidth' | 'background' | 'border'>>,
  width = 200,
): TextAnnot {
  const base: TextAnnot = {
    id: newAnnotId(),
    page,
    type: 'text',
    rect: rectFromFrame(origin, rot, width, props.size * 1.2 + 4),
    rot,
    text: props.text,
    font: props.font,
    bold: props.bold,
    italic: props.italic,
    size: props.size,
    color: props.color,
    align: props.align ?? 'left',
    autoWidth: props.autoWidth ?? true,
    background: props.background ?? null,
    border: props.border ?? null,
  };
  return relayoutText(base);
}

/** Natural size (pt) of a stamp label: wide rounded box around bold text. */
export function stampSize(label: string): { w: number; h: number } {
  const chars = Math.max(2, label.length);
  return { w: Math.max(60, chars * 13 + 24), h: 34 };
}

export function isInk(a: Annot): a is InkAnnot {
  return a.type === 'ink';
}

/** Human readable label for an object type (English, translate with t()). */
export function annotLabel(a: Annot): string {
  switch (a.type) {
    case 'text':
      return 'Text';
    case 'ink':
      return 'Drawing';
    case 'highlight':
      return 'Highlight';
    case 'underline':
      return 'Underline';
    case 'strike':
      return 'Strikethrough';
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'arrow':
      return 'Arrow';
    case 'image':
      return a.kind === 'signature' ? 'Signature' : 'Image';
    case 'stamp':
      return 'Stamp';
    case 'whiteout':
      return 'Whiteout';
    case 'note':
      return 'Note';
    case 'redact':
      return 'Redaction mark';
  }
}
