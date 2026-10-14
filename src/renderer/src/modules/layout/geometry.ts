import type { FitMode, Point, Rect } from './types';

/** Geometry helpers. Frames are axis-aligned rects (x, y, w, h) rotated around their center. */

export const DEG = Math.PI / 180;

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Object.is(a, -0) ? 0 : a;
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rotatePoint(p: Point, center: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const a = deg * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** The 4 corners of a rotated rect (tl, tr, br, bl). */
export function rectCorners(r: Rect, rotation = 0): Point[] {
  const c = rectCenter(r);
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ].map((p) => rotatePoint(p, c, rotation));
}

/** Axis-aligned bounding box of a rotated rect. */
export function boundingBox(r: Rect, rotation = 0): Rect {
  if (!rotation) return { x: r.x, y: r.y, w: r.w, h: r.h };
  const pts = rectCorners(r, rotation);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Is a point inside a rotated rect? */
export function pointInRect(p: Point, r: Rect, rotation = 0, tolerance = 0): boolean {
  const local = rotation ? rotatePoint(p, rectCenter(r), -rotation) : p;
  return (
    local.x >= r.x - tolerance && local.x <= r.x + r.w + tolerance && local.y >= r.y - tolerance && local.y <= r.y + r.h + tolerance
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Rect from two corner points (any order). */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/* ----------------------------- Resize handles ----------------------------- */

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Unit position of a handle in the rect: (0..1, 0..1). */
export function handleAnchor(h: Handle): { u: number; v: number } {
  return {
    u: h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5,
    v: h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5,
  };
}

export function handlePosition(r: Rect, rotation: number, h: Handle): Point {
  const { u, v } = handleAnchor(h);
  return rotatePoint({ x: r.x + r.w * u, y: r.y + r.h * v }, rectCenter(r), rotation);
}

/** CSS cursor for a handle, taking the frame rotation into account. */
export function handleCursor(h: Handle, rotation: number): string {
  const order = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const idx = order.indexOf(h);
  const steps = Math.round(normalizeAngle(rotation) / 45);
  const rotated = order[(((idx + steps) % 8) + 8) % 8];
  const map: Record<string, string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
  };
  return map[rotated];
}

export interface ResizeOptions {
  keepAspect?: boolean;
  fromCenter?: boolean;
  minSize?: number;
}

/**
 * New rect when dragging `handle` of a (possibly rotated) rect to `pointer` (world coords).
 * The opposite handle (or the center with fromCenter) stays fixed in world space.
 */
export function resizeRect(r: Rect, rotation: number, handle: Handle, pointer: Point, opts: ResizeOptions = {}): Rect {
  const min = opts.minSize ?? 1;
  const center = rectCenter(r);
  const local = rotatePoint(pointer, center, -rotation);
  const { u, v } = handleAnchor(handle);
  const movesX = u !== 0.5;
  const movesY = v !== 0.5;
  // fixed point in local (unrotated) coordinates
  const fixed = opts.fromCenter ? center : { x: r.x + r.w * (1 - u), y: r.y + r.h * (1 - v) };
  const factor = opts.fromCenter ? 2 : 1;
  let w = r.w;
  let h = r.h;
  if (movesX) w = Math.max(min, (u === 1 ? local.x - fixed.x : fixed.x - local.x) * factor);
  if (movesY) h = Math.max(min, (v === 1 ? local.y - fixed.y : fixed.y - local.y) * factor);
  if (opts.keepAspect && r.w > 0 && r.h > 0) {
    const ratio = r.w / r.h;
    if (movesX && movesY) {
      if (w / r.w > h / r.h) h = w / ratio;
      else w = h * ratio;
    } else if (movesX) h = w / ratio;
    else w = h * ratio;
  }
  // position of the new rect in local space
  let nx: number;
  let ny: number;
  if (opts.fromCenter) {
    nx = center.x - w / 2;
    ny = center.y - h / 2;
  } else {
    nx = movesX ? (u === 1 ? fixed.x : fixed.x - w) : opts.keepAspect ? center.x - w / 2 : r.x;
    ny = movesY ? (v === 1 ? fixed.y : fixed.y - h) : opts.keepAspect ? center.y - h / 2 : r.y;
  }
  if (!rotation || opts.fromCenter) return { x: nx, y: ny, w, h };
  // keep the fixed anchor in place in world space: the new rect rotates around its own center
  const fixedLocalNew = { x: nx + w * (1 - u), y: ny + h * (1 - v) };
  const newCenter = { x: nx + w / 2, y: ny + h / 2 };
  const fixedWorldOld = rotatePoint(fixed, center, rotation);
  const fixedWorldNew = rotatePoint(fixedLocalNew, newCenter, rotation);
  return { x: nx + fixedWorldOld.x - fixedWorldNew.x, y: ny + fixedWorldOld.y - fixedWorldNew.y, w, h };
}

/** Angle (deg) for the rotation handle: 0 when the pointer is straight above the center. */
export function rotationFromPointer(center: Point, pointer: Point, snap = false): number {
  const a = Math.atan2(pointer.y - center.y, pointer.x - center.x) / DEG + 90;
  const n = normalizeAngle(a);
  return snap ? normalizeAngle(Math.round(n / 15) * 15) : n;
}

/** Scales `r` from the `from` box into the `to` box (multi-selection resize). */
export function mapRect(r: Rect, from: Rect, to: Rect): Rect {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, w: r.w * sx, h: r.h * sy };
}

/* ----------------------------- Align/distribute ----------------------------- */

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface Boxed {
  id: string;
  /** Axis-aligned bounds used for alignment (bounding box of the rotated frame). */
  box: Rect;
}

/** Returns dx/dy per id to align boxes to `target` (selection bounds or page). */
export function alignOffsets(items: Boxed[], kind: AlignKind, target: Rect): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const it of items) {
    const b = it.box;
    let dx = 0;
    let dy = 0;
    switch (kind) {
      case 'left':
        dx = target.x - b.x;
        break;
      case 'hcenter':
        dx = target.x + target.w / 2 - (b.x + b.w / 2);
        break;
      case 'right':
        dx = target.x + target.w - (b.x + b.w);
        break;
      case 'top':
        dy = target.y - b.y;
        break;
      case 'vcenter':
        dy = target.y + target.h / 2 - (b.y + b.h / 2);
        break;
      case 'bottom':
        dy = target.y + target.h - (b.y + b.h);
        break;
    }
    out.set(it.id, { x: dx, y: dy });
  }
  return out;
}

/**
 * Distributes boxes so the gaps between them are equal (axis 'x' or 'y').
 * The first and last box (in position order) stay where they are.
 */
export function distributeOffsets(items: Boxed[], axis: 'x' | 'y'): Map<string, Point> {
  const out = new Map<string, Point>();
  if (items.length < 3) {
    items.forEach((it) => out.set(it.id, { x: 0, y: 0 }));
    return out;
  }
  const pos = (b: Rect) => (axis === 'x' ? b.x : b.y);
  const size = (b: Rect) => (axis === 'x' ? b.w : b.h);
  const sorted = [...items].sort((a, b) => pos(a.box) - pos(b.box));
  const first = sorted[0].box;
  const last = sorted[sorted.length - 1].box;
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((s, it) => s + size(it.box), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = pos(first);
  for (const it of sorted) {
    const d = cursor - pos(it.box);
    out.set(it.id, axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d });
    cursor += size(it.box) + gap;
  }
  return out;
}

/* ------------------------------ Image placement ----------------------------- */

/**
 * Where an image (natural size iw × ih) is drawn inside a frame (fw × fh), in frame
 * coordinates. `focal` (0..1) aligns the image when it is larger or smaller than the frame.
 * `zoom` scales on top of the fit mode. 'none' = original size at 96 ppi × zoom.
 */
export function imagePlacement(
  fw: number,
  fh: number,
  iw: number,
  ih: number,
  fit: FitMode,
  focalX = 0.5,
  focalY = 0.5,
  zoom = 1,
): Rect {
  if (iw <= 0 || ih <= 0 || fw <= 0 || fh <= 0) return { x: 0, y: 0, w: fw, h: fh };
  if (fit === 'stretch') {
    const w = fw * zoom;
    const h = fh * zoom;
    return { x: (fw - w) * focalX || 0, y: (fh - h) * focalY || 0, w, h };
  }
  let scale: number;
  if (fit === 'fill') scale = Math.max(fw / iw, fh / ih);
  else if (fit === 'fit') scale = Math.min(fw / iw, fh / ih);
  else scale = 1;
  scale *= zoom;
  const w = iw * scale;
  const h = ih * scale;
  return { x: (fw - w) * focalX || 0, y: (fh - h) * focalY || 0, w, h };
}

/** Focal change for dragging the image content by (dx, dy) frame px. */
export function panFocal(
  placement: Rect,
  fw: number,
  fh: number,
  focalX: number,
  focalY: number,
  dx: number,
  dy: number,
): { focalX: number; focalY: number } {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const spanX = fw - placement.w;
  const spanY = fh - placement.h;
  return {
    focalX: Math.abs(spanX) < 0.5 ? focalX : clamp01(focalX + dx / spanX),
    focalY: Math.abs(spanY) < 0.5 ? focalY : clamp01(focalY + dy / spanY),
  };
}

/* ------------------------------- Shape points ------------------------------- */

/** Polygon points for shape kinds drawn as SVG, in frame coordinates, inset by `inset`. */
export function shapePolygon(kind: 'triangle' | 'diamond' | 'star', w: number, h: number, inset = 0): Point[] {
  const x0 = inset;
  const y0 = inset;
  const x1 = Math.max(x0, w - inset);
  const y1 = Math.max(y0, h - inset);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (kind === 'triangle') {
    return [
      { x: cx, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }
  if (kind === 'diamond') {
    return [
      { x: cx, y: y0 },
      { x: x1, y: cy },
      { x: cx, y: y1 },
      { x: x0, y: cy },
    ];
  }
  const pts: Point[] = [];
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 === 0 ? 1 : 0.42;
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k + ry * 0.06 });
  }
  return pts;
}
