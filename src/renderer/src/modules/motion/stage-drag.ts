import { evaluateProp, isAnimated, setValueAt } from './keyframes';
import { apply, applyVector, invert, layerMatrix, multiply, rotation, type Mat } from './matrix';
import { getProp, layerById, parentMatrixAt, setLayerProp, updateLayer } from './model';
import { setPropAt } from './ops';
import { HANDLE_AXES, type HandleId } from './stage-math';
import type { AnimProp, Layer, MotionDoc, PathNode, Vec2 } from './types';

/**
 * Direct manipulation on the stage. Each drag captures what it needs at pointer-down and
 * recomputes the document from the drag's start state on every move (so the result never
 * drifts and the whole drag becomes one undo step).
 */

export interface MoveItem {
  id: string;
  start: Vec2;
  /** Inverse of the parent's linear transform (composition delta → parent delta). */
  inv: Mat;
}

export function moveItems(doc: MotionDoc, ids: string[], t: number): MoveItem[] {
  return ids
    .map((id) => layerById(doc, id))
    .filter((l): l is Layer => Boolean(l && !l.locked))
    .map((l) => {
      const p = parentMatrixAt(doc, l, t);
      return { id: l.id, start: evaluateProp(l.props.position, t), inv: invert([p[0], p[1], p[2], p[3], 0, 0]) };
    });
}

export function applyMove(doc: MotionDoc, items: MoveItem[], dx: number, dy: number, t: number): MotionDoc {
  let next = doc;
  for (const it of items) {
    const [px, py] = applyVector(it.inv, dx, dy);
    next = setPropAt(next, it.id, 'position', [it.start[0] + px, it.start[1] + py], t);
  }
  return next;
}

export interface ScaleDrag {
  id: string;
  handle: HandleId;
  /** Parent space → composition space. */
  parent: Mat;
  pos: Vec2;
  rot: number;
  scale: Vec2;
  /** Handle offset from the anchor in content units. */
  v0: Vec2;
}

export function startScale(doc: MotionDoc, layer: Layer, handle: HandleId, lx: number, ly: number, t: number): ScaleDrag {
  const anchor = evaluateProp(layer.props.anchor, t);
  return {
    id: layer.id,
    handle,
    parent: parentMatrixAt(doc, layer, t),
    pos: evaluateProp(layer.props.position, t),
    rot: evaluateProp(layer.props.rotation, t),
    scale: evaluateProp(layer.props.scale, t),
    v0: [lx - anchor[0], ly - anchor[1]],
  };
}

/** New scale (%) for the pointer at composition point (x, y). */
export function scaleFor(d: ScaleDrag, x: number, y: number, uniform: boolean): Vec2 {
  const inParent = apply(invert(d.parent), x, y);
  const q = applyVector(rotation(-d.rot), inParent[0] - d.pos[0], inParent[1] - d.pos[1]);
  const [ax, ay] = HANDLE_AXES[d.handle];
  if (uniform) {
    const cur: Vec2 = [(d.scale[0] / 100) * d.v0[0], (d.scale[1] / 100) * d.v0[1]];
    const len2 = cur[0] * cur[0] + cur[1] * cur[1];
    if (len2 < 1e-9) return d.scale;
    const f = (q[0] * cur[0] + q[1] * cur[1]) / len2;
    return [d.scale[0] * f, d.scale[1] * f];
  }
  return [
    ax && Math.abs(d.v0[0]) > 1e-6 ? (q[0] / d.v0[0]) * 100 : d.scale[0],
    ay && Math.abs(d.v0[1]) > 1e-6 ? (q[1] / d.v0[1]) * 100 : d.scale[1],
  ];
}

export interface RotateDrag {
  id: string;
  center: [number, number];
  a0: number;
  rot0: number;
}

export function startRotate(layer: Layer, world: Mat, x: number, y: number, t: number): RotateDrag {
  const anchor = evaluateProp(layer.props.anchor, t);
  const center = apply(world, anchor[0], anchor[1]);
  return { id: layer.id, center, a0: Math.atan2(y - center[1], x - center[0]), rot0: evaluateProp(layer.props.rotation, t) };
}

export function rotationFor(d: RotateDrag, x: number, y: number, snap: boolean): number {
  let delta = ((Math.atan2(y - d.center[1], x - d.center[0]) - d.a0) * 180) / Math.PI;
  // Unwrap so dragging across ±180° keeps going smoothly.
  delta = ((delta + 540) % 360) - 180;
  let r = d.rot0 + delta;
  if (snap) r = Math.round(r / 15) * 15;
  return r;
}

export interface AnchorDrag {
  id: string;
  invWorld: Mat;
  /** Rotation · scale of the layer (content delta → parent delta). */
  rs: Mat;
  a0: Vec2;
  pos0: Vec2;
}

export function startAnchor(layer: Layer, world: Mat, t: number): AnchorDrag {
  const pos0 = evaluateProp(layer.props.position, t);
  const a0 = evaluateProp(layer.props.anchor, t);
  const local = layerMatrix(pos0, a0, evaluateProp(layer.props.scale, t), evaluateProp(layer.props.rotation, t));
  return { id: layer.id, invWorld: invert(world), rs: [local[0], local[1], local[2], local[3], 0, 0], a0, pos0 };
}

/** Moves the anchor point to the composition point (x, y) while keeping the layer in place. */
export function applyAnchor(doc: MotionDoc, d: AnchorDrag, x: number, y: number, t: number): MotionDoc {
  const a = apply(d.invWorld, x, y);
  const delta = applyVector(d.rs, a[0] - d.a0[0], a[1] - d.a0[1]);
  return updateLayer(doc, d.id, (l) => {
    let next = setLayerProp(l, 'anchor', setValueAt(l.props.anchor, t, [a[0], a[1]]));
    const pos = next.props.position;
    if (isAnimated(pos)) {
      // Shift the whole motion path so the animation stays where it was.
      next = setLayerProp(next, 'position', {
        ...pos,
        keyframes: pos.keyframes.map((k) => ({ ...k, value: [k.value[0] + delta[0], k.value[1] + delta[1]] as Vec2 })),
      });
    } else next = setLayerProp(next, 'position', { ...pos, value: [d.pos0[0] + delta[0], d.pos0[1] + delta[1]] });
    return next;
  });
}

/** Drags one position keyframe on the motion path. */
export function applyMotionKey(doc: MotionDoc, layerId: string, keyId: string, start: Vec2, inv: Mat, dx: number, dy: number): MotionDoc {
  const [px, py] = applyVector(inv, dx, dy);
  return updateLayer(doc, layerId, (l) => {
    const prop = l.props.position;
    return setLayerProp(l, 'position', {
      ...prop,
      keyframes: prop.keyframes.map((k) => (k.id === keyId ? { ...k, value: [start[0] + px, start[1] + py] as Vec2 } : k)),
    } as AnimProp<Vec2>);
  });
}

/** Moves a path node or one of its handles to content point (x, y). */
export function applyPathEdit(
  doc: MotionDoc,
  layerId: string,
  sub: number,
  index: number,
  part: 'node' | 'in' | 'out',
  x: number,
  y: number,
  breakHandles: boolean,
): MotionDoc {
  return updateLayer(doc, layerId, (l) => {
    const path = l.shape?.path;
    if (!l.shape || !path?.[sub]?.nodes[index]) return l;
    const nodes = path[sub].nodes.map((n): PathNode => ({ ...n }));
    const n = nodes[index];
    if (part === 'node') {
      n.x = x;
      n.y = y;
    } else {
      const hx = x - n.x;
      const hy = y - n.y;
      if (part === 'out') {
        n.outX = hx;
        n.outY = hy;
        if (!breakHandles) {
          const len = Math.hypot(n.inX, n.inY) || Math.hypot(hx, hy);
          const k = len / (Math.hypot(hx, hy) || 1);
          n.inX = -hx * k;
          n.inY = -hy * k;
        }
      } else {
        n.inX = hx;
        n.inY = hy;
        if (!breakHandles) {
          const len = Math.hypot(n.outX, n.outY) || Math.hypot(hx, hy);
          const k = len / (Math.hypot(hx, hy) || 1);
          n.outX = -hx * k;
          n.outY = -hy * k;
        }
      }
    }
    const nextPath = path.map((sp, i) => (i === sub ? { ...sp, nodes } : sp));
    return { ...l, shape: { ...l.shape, path: nextPath } };
  });
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: { x?: number; y?: number }[];
}

/**
 * Snaps a moving box (composition space, before the move) to the composition's edges and
 * center lines. `threshold` is in composition px.
 */
export function snapMove(box: { x: number; y: number; w: number; h: number }, dx: number, dy: number, compW: number, compH: number, threshold: number): SnapResult {
  const xs = [0, compW / 2, compW];
  const ys = [0, compH / 2, compH];
  const bx = [box.x + dx, box.x + box.w / 2 + dx, box.x + box.w + dx];
  const by = [box.y + dy, box.y + box.h / 2 + dy, box.y + box.h + dy];
  let bestX: { d: number; target: number } | null = null;
  let bestY: { d: number; target: number } | null = null;
  for (const target of xs) for (const v of bx) if (Math.abs(target - v) <= threshold && (!bestX || Math.abs(target - v) < Math.abs(bestX.d))) bestX = { d: target - v, target };
  for (const target of ys) for (const v of by) if (Math.abs(target - v) <= threshold && (!bestY || Math.abs(target - v) < Math.abs(bestY.d))) bestY = { d: target - v, target };
  const guides: { x?: number; y?: number }[] = [];
  if (bestX) guides.push({ x: bestX.target });
  if (bestY) guides.push({ y: bestY.target });
  return { dx: dx + (bestX?.d ?? 0), dy: dy + (bestY?.d ?? 0), guides };
}

/** World matrix (layer → composition) at time t, without wiggles. */
export function worldMatrixAt(doc: MotionDoc, layer: Layer, t: number): Mat {
  return multiply(
    parentMatrixAt(doc, layer, t),
    layerMatrix(evaluateProp(layer.props.position, t), evaluateProp(layer.props.anchor, t), evaluateProp(layer.props.scale, t), evaluateProp(layer.props.rotation, t)),
  );
}

export function propIsAnimated(layer: Layer, key: 'position' | 'scale' | 'rotation' | 'anchor'): boolean {
  return isAnimated(getProp(layer, key));
}
