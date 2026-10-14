import { KAPPA } from './bezier';
import {
  IDENTITY,
  apply,
  applyXY,
  compose,
  decompose,
  invert,
  matrixScale,
  multiply,
  rectContainsPoint,
  rectsIntersect,
  transformRect,
  unionRects,
  type Matrix,
  type Pt,
  type Rect,
} from './matrix';
import type { Effects, GroupObject, PathGeom, PathNode, TextObject, VObject } from './model';
import { flattenGeom, geomBounds, mapGeom, transformGeom, type Polyline } from './path';
import { textBounds } from './text';

/* ----------------------------- Shape geometry ----------------------------- */

export function rectGeom(w: number, h: number, radius = 0): PathGeom {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r <= 1e-9) {
    return {
      subpaths: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }],
    };
  }
  const k = r * KAPPA;
  const nodes: PathNode[] = [
    { x: r, y: 0, in: { x: r - k, y: 0 } },
    { x: w - r, y: 0, out: { x: w - r + k, y: 0 } },
    { x: w, y: r, in: { x: w, y: r - k } },
    { x: w, y: h - r, out: { x: w, y: h - r + k } },
    { x: w - r, y: h, in: { x: w - r + k, y: h } },
    { x: r, y: h, out: { x: r - k, y: h } },
    { x: 0, y: h - r, in: { x: 0, y: h - r + k } },
    { x: 0, y: r, out: { x: 0, y: r - k } },
  ];
  return { subpaths: [{ closed: true, nodes }] };
}

export function ellipseGeom(w: number, h: number): PathGeom {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const nodes: PathNode[] = [
    { x: rx, y: 0, in: { x: rx - kx, y: 0 }, out: { x: rx + kx, y: 0 }, smooth: true },
    { x: w, y: ry, in: { x: w, y: ry - ky }, out: { x: w, y: ry + ky }, smooth: true },
    { x: rx, y: h, in: { x: rx + kx, y: h }, out: { x: rx - kx, y: h }, smooth: true },
    { x: 0, y: ry, in: { x: 0, y: ry + ky }, out: { x: 0, y: ry - ky }, smooth: true },
  ];
  return { subpaths: [{ closed: true, nodes }] };
}

/** Fits unit-circle vertices into the 0,0,w,h box. */
function fitVertices(vertices: Pt[], w: number, h: number): PathGeom {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const v of vertices) {
    x0 = Math.min(x0, v.x);
    y0 = Math.min(y0, v.y);
    x1 = Math.max(x1, v.x);
    y1 = Math.max(y1, v.y);
  }
  const sx = x1 - x0 || 1;
  const sy = y1 - y0 || 1;
  return {
    subpaths: [{ closed: true, nodes: vertices.map((v) => ({ x: ((v.x - x0) / sx) * w, y: ((v.y - y0) / sy) * h })) }],
  };
}

export function polygonGeom(w: number, h: number, sides: number): PathGeom {
  const n = Math.max(3, Math.round(sides));
  const vertices: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    vertices.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return fitVertices(vertices, w, h);
}

export function starGeom(w: number, h: number, points: number, inner: number): PathGeom {
  const n = Math.max(3, Math.round(points));
  const vertices: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? 1 : Math.max(0.01, Math.min(0.99, inner));
    vertices.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return fitVertices(vertices, w, h);
}

export function boxGeom(x: number, y: number, w: number, h: number): PathGeom {
  return {
    subpaths: [{ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] }],
  };
}

/** Local path geometry of an object (text/images/raw content use their box). Null for groups. */
export function objectGeom(o: VObject): PathGeom | null {
  switch (o.type) {
    case 'rect':
      return rectGeom(o.width, o.height, o.radius);
    case 'ellipse':
      return ellipseGeom(o.width, o.height);
    case 'polygon':
      return polygonGeom(o.width, o.height, o.sides);
    case 'star':
      return starGeom(o.width, o.height, o.points, o.inner);
    case 'line':
      return { subpaths: [{ closed: false, nodes: [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }] }] };
    case 'path':
      return o.geom;
    case 'text': {
      const b = textBounds(o);
      return boxGeom(b.x, b.y, b.width, b.height);
    }
    case 'image':
    case 'raw':
      return boxGeom(0, 0, o.width, o.height);
    case 'group':
      return null;
  }
}

/* --------------------------------- Bounds --------------------------------- */

const geomCache = new WeakMap<VObject, PathGeom | null>();
function cachedGeom(o: VObject): PathGeom | null {
  if (geomCache.has(o)) return geomCache.get(o) ?? null;
  const g = objectGeom(o);
  geomCache.set(o, g);
  return g;
}

/** Geometric bounds in the object's own coordinates. */
export function localBounds(o: VObject): Rect {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'star':
    case 'image':
    case 'raw':
      return { x: 0, y: 0, width: o.width, height: o.height };
    case 'text':
      return textBounds(o);
    case 'group':
      return unionRects(o.children.map((c) => boundsUnder(c, c.m))) ?? { x: 0, y: 0, width: 0, height: 0 };
    default: {
      const g = cachedGeom(o);
      return (g && geomBounds(g)) ?? { x: 0, y: 0, width: 0, height: 0 };
    }
  }
}

const boundsCache = new WeakMap<VObject, Map<string, Rect | null>>();

/** Tight axis-aligned bounds of the object's geometry under `m` (local → target space). */
export function boundsUnder(o: VObject, m: Matrix): Rect | null {
  const key = m.join(',');
  let perObj = boundsCache.get(o);
  if (perObj?.has(key)) return perObj.get(key) ?? null;
  let r: Rect | null;
  if (o.type === 'group') r = unionRects(o.children.map((c) => boundsUnder(c, multiply(m, c.m))));
  else if (o.type === 'text' || o.type === 'image' || o.type === 'raw') r = transformRect(m, localBounds(o));
  else {
    const g = cachedGeom(o);
    r = g ? geomBounds(transformGeom(g, m)) : null;
  }
  if (!perObj) {
    perObj = new Map();
    boundsCache.set(o, perObj);
  }
  if (perObj.size > 16) perObj.clear();
  perObj.set(key, r);
  return r;
}

/** Half the visible stroke extent (0 when there is no stroke). */
export function strokeExtent(o: VObject): number {
  if (o.type === 'group' || o.type === 'image' || o.type === 'raw') return 0;
  if (o.stroke.paint.type === 'none' || o.stroke.width <= 0) return 0;
  const w = o.stroke.align === 'center' ? o.stroke.width / 2 : o.stroke.align === 'outside' ? o.stroke.width : 0;
  if (o.type === 'ellipse' || o.type === 'text') return w;
  if (o.type === 'rect' || o.type === 'line') return o.stroke.join === 'miter' || o.stroke.cap === 'square' ? w * Math.SQRT2 : w;
  return o.stroke.join === 'miter' ? w * Math.min(o.stroke.miterLimit, 4) : w;
}

/** Bounds including stroke and effects (for export cropping and filter regions). */
export function visualBounds(o: VObject, m: Matrix): Rect | null {
  if (o.type === 'group') {
    const inner = unionRects(o.children.filter((c) => c.visible).map((c) => visualBounds(c, multiply(m, c.m))));
    return inner ? expandForEffects(o, inner) : null;
  }
  const b = boundsUnder(o, m);
  if (!b) return null;
  const s = strokeExtent(o) * matrixScale(m);
  return expandForEffects(o, { x: b.x - s, y: b.y - s, width: b.width + 2 * s, height: b.height + 2 * s });
}

function expandForEffects(o: VObject, r: Rect): Rect {
  let { x, y, width, height } = r;
  const blur = o.effects.blur ?? 0;
  if (blur > 0) {
    x -= blur * 3;
    y -= blur * 3;
    width += blur * 6;
    height += blur * 6;
  }
  const sh = o.effects.shadow;
  if (sh) {
    const pad = sh.blur * 3;
    const x0 = Math.min(x, x + sh.x - pad);
    const y0 = Math.min(y, y + sh.y - pad);
    const x1 = Math.max(x + width, x + width + sh.x + pad);
    const y1 = Math.max(y + height, y + height + sh.y + pad);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  return { x, y, width, height };
}

/* ------------------------------ World matrices ----------------------------- */

/** Matrix mapping the object's parent space to world space (product of the ancestors). */
export function parentMatrix(objects: VObject[], id: string): Matrix | null {
  const walk = (list: VObject[], m: Matrix): Matrix | null => {
    for (const o of list) {
      if (o.id === id) return m;
      if (o.type === 'group') {
        const found = walk(o.children, multiply(m, o.m));
        if (found) return found;
      }
    }
    return null;
  };
  return walk(objects, IDENTITY);
}

export function worldMatrix(objects: VObject[], id: string): Matrix | null {
  const walk = (list: VObject[], m: Matrix): Matrix | null => {
    for (const o of list) {
      const om = multiply(m, o.m);
      if (o.id === id) return om;
      if (o.type === 'group') {
        const found = walk(o.children, om);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(objects, IDENTITY);
}

export function worldBounds(objects: VObject[], id: string): Rect | null {
  const pm = parentMatrix(objects, id);
  if (!pm) return null;
  const o = findIn(objects, id);
  return o ? boundsUnder(o, multiply(pm, o.m)) : null;
}

function findIn(objects: VObject[], id: string): VObject | null {
  for (const o of objects) {
    if (o.id === id) return o;
    if (o.type === 'group') {
      const f = findIn(o.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function selectionBounds(objects: VObject[], ids: string[]): Rect | null {
  return unionRects(ids.map((id) => worldBounds(objects, id)));
}

/* ------------------------------ Normalization ------------------------------ */

const near1 = (v: number) => Math.abs(v - 1) < 1e-9;

/**
 * Folds the scale part of `o.m` into the geometry so strokes keep their width and
 * sizes stay readable. Groups keep a rigid matrix and pass the scale to their children.
 * Text keeps non-uniform scale in its matrix (uniform scale becomes a font size change).
 */
export function normalizeObject(o: VObject): VObject {
  const d = decompose(o.m);
  const { sx, sy } = d;
  if (near1(sx) && near1(sy)) return o;
  const unscaled = (k1: number, k2: number): Matrix => multiply(o.m, [1 / k1, 0, 0, 1 / k2, 0, 0]);
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'star':
    case 'image':
    case 'raw':
      return { ...o, width: o.width * sx, height: o.height * sy, m: unscaled(sx, sy) };
    case 'line':
      return { ...o, x1: o.x1 * sx, y1: o.y1 * sy, x2: o.x2 * sx, y2: o.y2 * sy, m: unscaled(sx, sy) };
    case 'path':
      return { ...o, geom: mapGeom(o.geom, (p) => ({ x: p.x * sx, y: p.y * sy })), m: unscaled(sx, sy) };
    case 'text': {
      if (Math.abs(sx / sy - 1) > 0.01) return o;
      const s = Math.sqrt(sx * sy);
      const t: TextObject = {
        ...o,
        fontSize: o.fontSize * s,
        letterSpacing: o.letterSpacing * s,
        m: unscaled(s, s),
      };
      if (o.onPath) t.onPath = { ...o.onPath, geom: mapGeom(o.onPath.geom, (p) => ({ x: p.x * s, y: p.y * s })) };
      return t;
    }
    case 'group': {
      const rigid = compose({ ...d, sx: 1, sy: 1, skew: 0 });
      const c = multiply(invert(rigid), o.m);
      const children = o.children.map((ch) => normalizeObject({ ...ch, m: multiply(c, ch.m) }));
      return { ...o, m: rigid, children } as GroupObject;
    }
  }
}

/** Scales stroke widths, dashes and effects of an object tree by `k` (used when artwork is scaled as a whole). */
export function scaleStrokes(o: VObject, k: number): VObject {
  if (Math.abs(k - 1) < 1e-9) return o;
  const fx: Effects = { ...o.effects };
  if (fx.blur) fx.blur *= k;
  if (fx.shadow) fx.shadow = { ...fx.shadow, x: fx.shadow.x * k, y: fx.shadow.y * k, blur: fx.shadow.blur * k };
  if (o.type === 'group') return { ...o, effects: fx, children: o.children.map((c) => scaleStrokes(c, k)) };
  return { ...o, effects: fx, stroke: { ...o.stroke, width: o.stroke.width * k, dash: o.stroke.dash.map((d) => d * k) } } as VObject;
}

/**
 * Makes every matrix in the tree rigid by folding scale into geometry (like normalizeObject)
 * while scaling strokes along, so the artwork looks exactly the same afterwards.
 */
export function bakeScale(o: VObject): VObject {
  const d = decompose(o.m);
  const scaled = !near1(d.sx) || !near1(d.sy);
  if (o.type === 'group') {
    if (!scaled) return { ...o, children: o.children.map(bakeScale) };
    const rigid = compose({ ...d, sx: 1, sy: 1, skew: 0 });
    const c = multiply(invert(rigid), o.m);
    return { ...o, m: rigid, children: o.children.map((ch) => bakeScale({ ...ch, m: multiply(c, ch.m) })) };
  }
  if (!scaled) return o;
  let n = normalizeObject(o);
  if (n === o) return o;
  if (n.type === 'rect') n = { ...n, radius: n.radius * Math.min(d.sx, d.sy) };
  return scaleStrokes(n, Math.sqrt(d.sx * d.sy));
}

/** Applies `a` (in the object's parent space) and normalizes. */
export function transformObject(o: VObject, a: Matrix): VObject {
  return normalizeObject({ ...o, m: multiply(a, o.m) });
}

/* ------------------------------- Hit testing ------------------------------- */

const outlineCache = new WeakMap<VObject, Polyline[]>();

/** Flattened local outline (cached per immutable object). */
export function outlineOf(o: VObject): Polyline[] {
  let polys = outlineCache.get(o);
  if (!polys) {
    const g = o.type === 'text' && o.onPath ? o.onPath.geom : cachedGeom(o);
    polys = g ? flattenGeom(g, 0.2) : [];
    outlineCache.set(o, polys);
  }
  return polys;
}

/** Winding number test against polylines treated as closed (SVG fills open sub paths too). */
export function pointInPolylines(polys: Polyline[], p: Pt, rule: 'nonzero' | 'evenodd' = 'nonzero'): boolean {
  let winding = 0;
  let crossings = 0;
  for (const poly of polys) {
    const pts = poly.pts;
    const n = pts.length / 2;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = pts[i * 2];
      const y0 = pts[i * 2 + 1];
      const x1 = pts[j * 2];
      const y1 = pts[j * 2 + 1];
      if (y0 <= p.y) {
        if (y1 > p.y && (x1 - x0) * (p.y - y0) - (p.x - x0) * (y1 - y0) > 0) {
          winding++;
          crossings++;
        }
      } else if (y1 <= p.y && (x1 - x0) * (p.y - y0) - (p.x - x0) * (y1 - y0) < 0) {
        winding--;
        crossings++;
      }
    }
  }
  return rule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

export function distToSegment(p: Pt, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - x0) * dx + (p.y - y0) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (x0 + t * dx), p.y - (y0 + t * dy));
}

export function distToPolylines(polys: Polyline[], p: Pt): number {
  let best = Infinity;
  for (const poly of polys) {
    const pts = poly.pts;
    const n = pts.length / 2;
    if (n === 1) best = Math.min(best, Math.hypot(p.x - pts[0], p.y - pts[1]));
    const count = poly.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n;
      best = Math.min(best, distToSegment(p, pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]));
    }
  }
  return best;
}

/** Hit test of one leaf object; `p` and `tol` are in its local coordinates. */
export function hitLeaf(o: VObject, p: Pt, tol: number): boolean {
  switch (o.type) {
    case 'group':
      return false;
    case 'text':
      if (o.onPath) return distToPolylines(outlineOf(o), p) <= o.fontSize * 0.6 + tol;
      return rectContainsPoint(textBounds(o), p, tol);
    case 'image':
    case 'raw':
      return rectContainsPoint({ x: 0, y: 0, width: o.width, height: o.height }, p, tol);
    default: {
      const polys = outlineOf(o);
      const filled = o.fill.type !== 'none' && o.type !== 'line';
      if (filled && pointInPolylines(polys, p, o.type === 'path' ? (o.geom.fillRule ?? 'nonzero') : 'nonzero')) return true;
      const stroked = o.stroke.paint.type !== 'none' && o.stroke.width > 0;
      const half = stroked ? (o.stroke.align === 'center' ? o.stroke.width / 2 : o.stroke.width) : 0;
      return distToPolylines(polys, p) <= half + tol;
    }
  }
}

export interface HitOptions {
  includeLocked?: boolean;
  includeHidden?: boolean;
}

/**
 * Finds the topmost object under `p` (world coordinates). Returns the chain from the
 * top-level object down to the hit leaf, or null.
 */
export function hitTest(objects: VObject[], p: Pt, tol: number, parentM: Matrix = IDENTITY, opts: HitOptions = {}): VObject[] | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!o.visible && !opts.includeHidden) continue;
    if (o.locked && !opts.includeLocked) continue;
    const m = multiply(parentM, o.m);
    if (o.type === 'group') {
      const sub = hitTest(o.children, p, tol, m, opts);
      if (sub) return [o, ...sub];
      continue;
    }
    const b = boundsUnder(o, m);
    if (!b) continue;
    const pad = tol + strokeExtent(o) * matrixScale(m) + (o.type === 'text' && o.onPath ? o.fontSize : 0);
    if (!rectContainsPoint(b, p, pad)) continue;
    const local = apply(invert(m), p);
    if (hitLeaf(o, local, tol / matrixScale(m))) return [o];
  }
  return null;
}

function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when the object's outline or (filled) area touches the world-space rectangle. */
export function objectIntersectsRect(o: VObject, m: Matrix, rect: Rect): boolean {
  if (!o.visible) return false;
  if (o.type === 'group') return o.children.some((c) => objectIntersectsRect(c, multiply(m, c.m), rect));
  const b = boundsUnder(o, m);
  if (!b || !rectsIntersect(b, rect)) return false;
  if (rect.x <= b.x && rect.y <= b.y && rect.x + rect.width >= b.x + b.width && rect.y + rect.height >= b.y + b.height) return true;
  // rectangle corners in local space
  const inv = invert(m);
  const quad = [
    applyXY(inv, rect.x, rect.y),
    applyXY(inv, rect.x + rect.width, rect.y),
    applyXY(inv, rect.x + rect.width, rect.y + rect.height),
    applyXY(inv, rect.x, rect.y + rect.height),
  ];
  const quadPoly: Polyline[] = [{ pts: quad.flatMap((q) => [q.x, q.y]), closed: true }];
  const polys = o.type === 'text' || o.type === 'image' || o.type === 'raw' ? flattenGeom(objectGeom(o) as PathGeom, 1) : outlineOf(o);
  for (const poly of polys) {
    const pts = poly.pts;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) if (pointInPolylines(quadPoly, { x: pts[i * 2], y: pts[i * 2 + 1] })) return true;
    const count = poly.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n;
      for (let k = 0; k < 4; k++) {
        const q0 = quad[k];
        const q1 = quad[(k + 1) % 4];
        if (segmentsIntersect(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], q0.x, q0.y, q1.x, q1.y)) return true;
      }
    }
  }
  const filled = o.type === 'text' || o.type === 'image' || o.type === 'raw' || (o.fill.type !== 'none' && o.type !== 'line');
  return filled && quad.some((q) => pointInPolylines(polys, q));
}

/** Top-level ids (within `objects`) whose shapes touch the rectangle. */
export function objectsInRect(objects: VObject[], rect: Rect, parentM: Matrix = IDENTITY): string[] {
  return objects.filter((o) => !o.locked && objectIntersectsRect(o, multiply(parentM, o.m), rect)).map((o) => o.id);
}
