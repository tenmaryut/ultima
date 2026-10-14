/**
 * Geometry of a developed photo: quarter-turn rotation, flips, straighten angle and the
 * crop rectangle. Everything is expressed as affine maps between
 *   output space   (cropped, straightened result, full-resolution px)
 *   oriented space (source after rotate/flip, before straighten)
 *   source space   (decoded image, full-resolution px).
 */
import type { DevelopSettings } from './params';
import { aspectRatioOf, clamp } from './params';

/** x' = a·x + c·y + e ; y' = b·x + d·y + f */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** m1 ∘ m2 (apply m2 first). */
export function compose(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export const translate = (x: number, y: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
export const scale = (sx: number, sy = sx): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
/** Rotation by `rad` (clockwise on screen, y axis pointing down). */
export const rotation = (rad: number): Affine => {
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  return { a: cs, b: sn, c: -sn, d: cs, e: 0, f: 0 };
};

/** Bounding box of a rectangle transformed by m. */
export function transformedBounds(m: Affine, r: Rect): Rect {
  const pts = [
    applyAffine(m, r.x, r.y),
    applyAffine(m, r.x + r.w, r.y),
    applyAffine(m, r.x, r.y + r.h),
    applyAffine(m, r.x + r.w, r.y + r.h),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** Size of the source after the quarter-turn rotation. */
export function orientedSize(srcW: number, srcH: number, rotate: number): { w: number; h: number } {
  return rotate % 2 === 1 ? { w: srcH, h: srcW } : { w: srcW, h: srcH };
}

/** Oriented → source map (undo flips, then undo the quarter turns). */
export function orientedToSource(srcW: number, srcH: number, rotate: number, flipH: boolean, flipV: boolean): Affine {
  const { w: wo, h: ho } = orientedSize(srcW, srcH, rotate);
  // undo flips in oriented space
  const flip: Affine = { a: flipH ? -1 : 1, b: 0, c: 0, d: flipV ? -1 : 1, e: flipH ? wo : 0, f: flipV ? ho : 0 };
  let rot: Affine;
  switch (((rotate % 4) + 4) % 4) {
    case 1: // source (x,y) -> oriented (H - y, x); inverse x = v, y = H - u
      rot = { a: 0, b: -1, c: 1, d: 0, e: 0, f: srcH };
      break;
    case 2:
      rot = { a: -1, b: 0, c: 0, d: -1, e: srcW, f: srcH };
      break;
    case 3: // source (x,y) -> oriented (y, W - x); inverse x = W - v, y = u
      rot = { a: 0, b: 1, c: -1, d: 0, e: srcW, f: 0 };
      break;
    default:
      rot = IDENTITY;
  }
  return compose(rot, flip);
}

/** Straightened screen space (same frame as oriented) → oriented space. */
export function unstraighten(wo: number, ho: number, angleDeg: number): Affine {
  if (!angleDeg) return IDENTITY;
  const rad = (-angleDeg * Math.PI) / 180;
  return compose(translate(wo / 2, ho / 2), compose(rotation(rad), translate(-wo / 2, -ho / 2)));
}

export interface Geometry {
  /** Oriented frame size (full res). */
  wo: number;
  ho: number;
  /** Output size (full res, after crop). */
  outW: number;
  outH: number;
  /** Output px → source px. */
  outToSrc: Affine;
}

/**
 * Geometry for full-resolution source size srcW×srcH. With `uncropped` the output is the
 * whole straightened oriented frame (used while editing the crop).
 */
export function geometry(s: Pick<DevelopSettings, 'rotate' | 'flipH' | 'flipV' | 'straighten' | 'cropX' | 'cropY' | 'cropW' | 'cropH'>, srcW: number, srcH: number, uncropped = false): Geometry {
  const { w: wo, h: ho } = orientedSize(srcW, srcH, s.rotate);
  const toSrc = compose(orientedToSource(srcW, srcH, s.rotate, s.flipH, s.flipV), unstraighten(wo, ho, s.straighten));
  if (uncropped) return { wo, ho, outW: wo, outH: ho, outToSrc: toSrc };
  const x0 = s.cropX * wo;
  const y0 = s.cropY * ho;
  return {
    wo,
    ho,
    outW: Math.max(1, Math.round(s.cropW * wo)),
    outH: Math.max(1, Math.round(s.cropH * ho)),
    outToSrc: compose(toSrc, translate(x0, y0)),
  };
}

/* ------------------------------- Crop rectangle ------------------------------ */

/** Crop rect (normalized, oriented frame) after rotating the photo 90° clockwise (dir 1) or counter-clockwise (-1). */
export function rotateCropRect(r: Rect, dir: 1 | -1): Rect {
  return dir === 1 ? { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w } : { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
}

export function flipCropRect(r: Rect, axis: 'h' | 'v'): Rect {
  return axis === 'h' ? { ...r, x: 1 - r.x - r.w } : { ...r, y: 1 - r.y - r.h };
}

/** True when the crop (px, oriented frame) lies inside the image rotated by angleDeg. */
export function cropInsideImage(r: Rect, wo: number, ho: number, angleDeg: number, eps = 0.5): boolean {
  if (!angleDeg) return r.x >= -eps && r.y >= -eps && r.x + r.w <= wo + eps && r.y + r.h <= ho + eps;
  const m = unstraighten(wo, ho, angleDeg);
  const corners: [number, number][] = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ];
  return corners.every(([x, y]) => {
    const p = applyAffine(m, x, y);
    return p.x >= -eps && p.y >= -eps && p.x <= wo + eps && p.y <= ho + eps;
  });
}

/** Largest rect with pixel aspect `aspect` centered in a wo×ho image rotated by angleDeg. */
export function maxCenteredCrop(wo: number, ho: number, angleDeg: number, aspect: number): Rect {
  const rad = (Math.abs(angleDeg) * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  const b = Math.min(wo / 2 / (aspect * cs + sn), ho / 2 / (aspect * sn + cs));
  const a = aspect * b;
  return { x: wo / 2 - a, y: ho / 2 - b, w: 2 * a, h: 2 * b };
}

/**
 * Shrinks a crop (px, oriented frame) about its center until it fits inside the rotated
 * image; if its center is outside the image it is first moved towards the image center.
 */
export function fitCropToImage(r: Rect, wo: number, ho: number, angleDeg: number): Rect {
  if (cropInsideImage(r, wo, ho, angleDeg, 0.01)) return r;
  const rad = (-angleDeg * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  // center of the crop relative to the image center, in image (unrotated) coordinates
  let cx = r.x + r.w / 2 - wo / 2;
  let cy = r.y + r.h / 2 - ho / 2;
  const toImage = (x: number, y: number) => ({ x: x * cs - y * sn, y: x * sn + y * cs });
  let c = toImage(cx, cy);
  if (Math.abs(c.x) > wo / 2 * 0.98 || Math.abs(c.y) > ho / 2 * 0.98) {
    cx = 0;
    cy = 0;
    c = { x: 0, y: 0 };
  }
  let k = 1;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const u = toImage((sx * r.w) / 2, (sy * r.h) / 2);
      if (u.x > 1e-9) k = Math.min(k, (wo / 2 - c.x) / u.x);
      if (u.x < -1e-9) k = Math.min(k, (-wo / 2 - c.x) / u.x);
      if (u.y > 1e-9) k = Math.min(k, (ho / 2 - c.y) / u.y);
      if (u.y < -1e-9) k = Math.min(k, (-ho / 2 - c.y) / u.y);
    }
  }
  k = Math.max(0.01, Math.min(1, k) * 0.9999);
  const w = r.w * k;
  const h = r.h * k;
  return { x: wo / 2 + cx - w / 2, y: ho / 2 + cy - h / 2, w, h };
}

/**
 * Moves from `from` towards `to` as far as possible while staying inside the image
 * (bisection). Used while dragging crop handles.
 */
export function constrainCropMove(from: Rect, to: Rect, wo: number, ho: number, angleDeg: number): Rect {
  if (cropInsideImage(to, wo, ho, angleDeg)) return to;
  if (!cropInsideImage(from, wo, ho, angleDeg)) return fitCropToImage(to, wo, ho, angleDeg);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (cropInsideImage(lerpRect(from, to, mid), wo, ho, angleDeg)) lo = mid;
    else hi = mid;
  }
  return lerpRect(from, to, lo);
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

/** Normalized crop rect ↔ pixels in the oriented frame. */
export function cropToPx(s: Pick<DevelopSettings, 'cropX' | 'cropY' | 'cropW' | 'cropH'>, wo: number, ho: number): Rect {
  return { x: s.cropX * wo, y: s.cropY * ho, w: s.cropW * wo, h: s.cropH * ho };
}

export function pxToCrop(r: Rect, wo: number, ho: number): Pick<DevelopSettings, 'cropX' | 'cropY' | 'cropW' | 'cropH'> {
  const cropW = clamp(r.w / wo, 0.01, 1);
  const cropH = clamp(r.h / ho, 0.01, 1);
  return {
    cropX: clamp(r.x / wo, 0, 1 - cropW),
    cropY: clamp(r.y / ho, 0, 1 - cropH),
    cropW,
    cropH,
  };
}

/**
 * Crop for a new aspect preset (or after a straighten change): the largest rect of that
 * aspect centered on the current crop center that fits in the rotated image.
 */
export function cropForAspect(
  s: Pick<DevelopSettings, 'rotate' | 'straighten' | 'cropX' | 'cropY' | 'cropW' | 'cropH'>,
  aspect: string,
  srcW: number,
  srcH: number,
): Pick<DevelopSettings, 'cropX' | 'cropY' | 'cropW' | 'cropH'> {
  const { w: wo, h: ho } = orientedSize(srcW, srcH, s.rotate);
  const ratio = aspectRatioOf(aspect, srcW > 0 ? wo : 1, srcW > 0 ? ho : 1);
  const current = cropToPx(s, wo, ho);
  if (ratio === null) return pxToCrop(fitCropToImage(current, wo, ho, s.straighten), wo, ho);
  const max = maxCenteredCrop(wo, ho, s.straighten, ratio);
  // keep the current center when possible
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  const candidate = fitCropToImage({ x: cx - max.w / 2, y: cy - max.h / 2, w: max.w, h: max.h }, wo, ho, s.straighten);
  return pxToCrop(candidate, wo, ho);
}

/**
 * Crop after the straighten angle changes: a crop that was as large as possible stays
 * as large as possible for the new angle (keeping its aspect); a smaller, hand-made crop
 * is kept and only shrinks when it would leave the rotated image.
 */
export function cropAfterStraighten(
  s: Pick<DevelopSettings, 'rotate' | 'straighten' | 'cropX' | 'cropY' | 'cropW' | 'cropH'>,
  newAngle: number,
  srcW: number,
  srcH: number,
): Pick<DevelopSettings, 'cropX' | 'cropY' | 'cropW' | 'cropH'> {
  const { w: wo, h: ho } = orientedSize(srcW, srcH, s.rotate);
  const current = cropToPx(s, wo, ho);
  const ratio = current.w / current.h;
  const oldMax = maxCenteredCrop(wo, ho, s.straighten, ratio);
  const wasMax = current.w >= oldMax.w * 0.985;
  if (wasMax) {
    const max = maxCenteredCrop(wo, ho, newAngle, ratio);
    const cx = current.x + current.w / 2;
    const cy = current.y + current.h / 2;
    return pxToCrop(fitCropToImage({ x: cx - max.w / 2, y: cy - max.h / 2, w: max.w, h: max.h }, wo, ho, newAngle), wo, ho);
  }
  return pxToCrop(fitCropToImage(current, wo, ho, newAngle), wo, ho);
}

/** Angle (degrees) that makes a line drawn from (x1,y1) to (x2,y2) level or plumb. */
export function straightenFromLine(x1: number, y1: number, x2: number, y2: number): number {
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  // nearest multiple of 90 → rotate the remainder away
  const nearest = Math.round(angle / 90) * 90;
  return clamp(-(angle - nearest), -45, 45);
}
