/**
 * Coordinate math for PDF Studio (pure, unit tested).
 *
 * Three spaces are involved:
 *  - PDF user space: points (1/72 in), origin at the bottom-left of the page, y up.
 *    Annotation objects are stored in this space (of their *source* page, unrotated).
 *  - Viewport (screen) space: CSS pixels of the rendered page, origin top-left, y down,
 *    including the page/view rotation and zoom.
 *  - Content space of "upright" objects (text, images, stamps): origin at the visual
 *    top-left corner of the object, u to the right, v down, in points.
 *
 * `viewportTransform` reproduces pdf.js' PageViewport transform exactly so the overlay
 * lines up with the canvas rendered by pdf.js.
 */

export type Matrix = [number, number, number, number, number, number];
/** [xMin, yMin, xMax, yMax] of the visible page area (pdf.js `page.view`). */
export type ViewBox = [number, number, number, number];
export type Rotation = 0 | 90 | 180 | 270;
export interface Point {
  x: number;
  y: number;
}
/** Axis aligned rectangle in PDF user space: (x, y) is the minimum corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** CSS pixels per PDF point at 100% zoom (real size, like Acrobat). */
export const CSS_UNITS = 96 / 72;

export function normalizeRotation(deg: number): Rotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

/** Same math as pdf.js `new PageViewport({ viewBox, scale, rotation })`. */
export function viewportTransform(view: ViewBox, scale: number, rotation: number, userUnit = 1): Matrix {
  const s = scale * userUnit;
  const centerX = (view[2] + view[0]) / 2;
  const centerY = (view[3] + view[1]) / 2;
  let a: number, b: number, c: number, d: number;
  switch (normalizeRotation(rotation)) {
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  let offX: number;
  let offY: number;
  if (a === 0) {
    offX = Math.abs(centerY - view[1]) * s;
    offY = Math.abs(centerX - view[0]) * s;
  } else {
    offX = Math.abs(centerX - view[0]) * s;
    offY = Math.abs(centerY - view[1]) * s;
  }
  return [a * s, b * s, c * s, d * s, offX - a * s * centerX - c * s * centerY, offY - b * s * centerX - d * s * centerY];
}

/** Size of the rendered page (CSS px) for a view box at a scale and rotation. */
export function viewportSize(view: ViewBox, scale: number, rotation: number, userUnit = 1): { width: number; height: number } {
  const w = (view[2] - view[0]) * scale * userUnit;
  const h = (view[3] - view[1]) * scale * userUnit;
  return normalizeRotation(rotation) % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

export function applyMatrix(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Applies only the linear part (for direction vectors / deltas). */
export function applyLinear(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y };
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [1, 0, 0, 1, 0, 0];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/** m1 × m2: first apply m2, then m1. */
export function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function pdfToScreen(m: Matrix, p: Point): Point {
  return applyMatrix(m, p.x, p.y);
}

export function screenToPdf(m: Matrix, p: Point): Point {
  return applyMatrix(invertMatrix(m), p.x, p.y);
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function boundsOfPoints(points: Point[]): Rect {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** User-space rect → axis aligned screen rect (rotations are multiples of 90°). */
export function rectToScreen(m: Matrix, r: Rect): ScreenRect {
  const b = boundsOfPoints(rectCorners(r).map((p) => applyMatrix(m, p.x, p.y)));
  return { left: b.x, top: b.y, width: b.w, height: b.h };
}

export function screenRectToPdf(m: Matrix, s: ScreenRect): Rect {
  const inv = invertMatrix(m);
  const a = applyMatrix(inv, s.left, s.top);
  const b = applyMatrix(inv, s.left + s.width, s.top + s.height);
  return normRect(a.x, a.y, b.x, b.y);
}

export function unionRects(rects: Rect[]): Rect {
  return boundsOfPoints(rects.flatMap(rectCorners));
}

export function rectContains(r: Rect, p: Point, tolerance = 0): boolean {
  return p.x >= r.x - tolerance && p.x <= r.x + r.w + tolerance && p.y >= r.y - tolerance && p.y <= r.y + r.h + tolerance;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Frame of an upright object whose content reads correctly when the page is displayed
 * with rotation `rot`. Content point (u, v) maps to user space `origin + u·ax + v·dn`.
 * `width`/`height` are the upright (content) dimensions.
 */
export interface ContentFrame {
  origin: Point;
  ax: Point;
  dn: Point;
  width: number;
  height: number;
}

export function contentFrame(r: Rect, rot: Rotation): ContentFrame {
  switch (rot) {
    case 90:
      return { origin: { x: r.x, y: r.y }, ax: { x: 0, y: 1 }, dn: { x: 1, y: 0 }, width: r.h, height: r.w };
    case 180:
      return { origin: { x: r.x + r.w, y: r.y }, ax: { x: -1, y: 0 }, dn: { x: 0, y: 1 }, width: r.w, height: r.h };
    case 270:
      return { origin: { x: r.x + r.w, y: r.y + r.h }, ax: { x: 0, y: -1 }, dn: { x: -1, y: 0 }, width: r.h, height: r.w };
    default:
      return { origin: { x: r.x, y: r.y + r.h }, ax: { x: 1, y: 0 }, dn: { x: 0, y: -1 }, width: r.w, height: r.h };
  }
}

/** Matrix mapping content coordinates (u, v down) to user space. */
export function frameMatrix(r: Rect, rot: Rotation): Matrix {
  const f = contentFrame(r, rot);
  return [f.ax.x, f.ax.y, f.dn.x, f.dn.y, f.origin.x, f.origin.y];
}

/** Rect of an upright object with content size (uw × uh) whose content origin stays at `origin`. */
export function rectFromFrame(origin: Point, rot: Rotation, uw: number, uh: number): Rect {
  const probe = contentFrame({ x: 0, y: 0, w: 0, h: 0 }, rot);
  const p1 = { x: origin.x + probe.ax.x * uw + probe.dn.x * uh, y: origin.y + probe.ax.y * uw + probe.dn.y * uh };
  return normRect(origin.x, origin.y, p1.x, p1.y);
}

/** Rect of an upright object of content size uw × uh centred on a user-space point. */
export function rectCenteredAt(center: Point, rot: Rotation, uw: number, uh: number): Rect {
  const w = rot % 180 === 0 ? uw : uh;
  const h = rot % 180 === 0 ? uh : uw;
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}

/**
 * Converts a point given relative to the displayed page (0..1, origin top-left, as seen
 * with `rotation`) to PDF user space.
 */
export function relativeToPdf(view: ViewBox, rotation: number, rx: number, ry: number): Point {
  const m = viewportTransform(view, 1, rotation);
  const size = viewportSize(view, 1, rotation);
  return screenToPdf(m, { x: rx * size.width, y: ry * size.height });
}

/** Clamps a rect so it stays inside the view box (keeps size when possible). */
export function clampRectToView(r: Rect, view: ViewBox): Rect {
  const w = Math.min(r.w, view[2] - view[0]);
  const h = Math.min(r.h, view[3] - view[1]);
  const x = Math.min(Math.max(r.x, view[0]), view[2] - w);
  const y = Math.min(Math.max(r.y, view[1]), view[3] - h);
  return { x, y, w, h };
}

/** Rotation (deg, clockwise on screen) of content created for `rot` shown under display rotation `display`. */
export function screenAngle(rot: Rotation, display: number): number {
  return normalizeRotation(display - rot);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from point p to segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Zoom factor (1 = 100%) that fits a page of `pageW × pageH` points into a box of CSS px. */
export function fitZoom(pageW: number, pageH: number, boxW: number, boxH: number, mode: 'width' | 'page'): number {
  if (pageW <= 0 || pageH <= 0 || boxW <= 0) return 1;
  const zw = boxW / (pageW * CSS_UNITS);
  if (mode === 'width' || boxH <= 0) return zw;
  return Math.min(zw, boxH / (pageH * CSS_UNITS));
}

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((s) => s > zoom * 1.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom * 0.999) ?? MIN_ZOOM;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
