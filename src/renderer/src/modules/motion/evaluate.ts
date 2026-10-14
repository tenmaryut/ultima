import { evaluateProp } from './keyframes';
import { layerMatrix, multiply, type Mat } from './matrix';
import { wiggleOffset } from './noise';
import type { Layer, MotionDoc, Vec2 } from './types';

/** All property values of a layer at one moment, plus its transforms. */
export interface EvaluatedLayer {
  layer: Layer;
  anchor: Vec2;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
  size: Vec2;
  fill: string;
  strokeColor: string;
  strokeWidth: number;
  cornerRadius: number;
  trimStart: number;
  trimEnd: number;
  letterSpacing: number;
  reveal: number;
  blur: number;
  /** Layer space → parent space. */
  local: Mat;
  /** Layer space → composition space (includes parents). */
  world: Mat;
}

export function isLayerActive(layer: Layer, t: number): boolean {
  return t >= layer.inPoint - 1e-9 && t < layer.outPoint - 1e-9;
}

/** Evaluates one layer (without parents: `world` equals `local`). Wiggles are applied. */
export function evaluateLayer(layer: Layer, t: number): EvaluatedLayer {
  const p = layer.props;
  let position = evaluateProp(p.position, t);
  let rotation = evaluateProp(p.rotation, t);
  let scale = evaluateProp(p.scale, t);
  let opacity = evaluateProp(p.opacity, t);
  for (const w of layer.wiggles) {
    switch (w.property) {
      case 'position':
        position = [
          position[0] + wiggleOffset(t, w.frequency, w.amplitude, w.seed, w.start, w.end, 0),
          position[1] + wiggleOffset(t, w.frequency, w.amplitude, w.seed, w.start, w.end, 1),
        ];
        break;
      case 'rotation':
        rotation += wiggleOffset(t, w.frequency, w.amplitude, w.seed, w.start, w.end, 2);
        break;
      case 'scale': {
        const d = wiggleOffset(t, w.frequency, w.amplitude, w.seed, w.start, w.end, 3);
        scale = [scale[0] + d, scale[1] + d];
        break;
      }
      case 'opacity':
        opacity += wiggleOffset(t, w.frequency, w.amplitude, w.seed, w.start, w.end, 4);
        break;
    }
  }
  const anchor = evaluateProp(p.anchor, t);
  const local = layerMatrix(position, anchor, scale, rotation);
  return {
    layer,
    anchor,
    position,
    scale,
    rotation,
    opacity: Math.max(0, Math.min(100, opacity)),
    size: evaluateProp(p.size, t),
    fill: evaluateProp(p.fill, t),
    strokeColor: evaluateProp(p.strokeColor, t),
    strokeWidth: Math.max(0, evaluateProp(p.strokeWidth, t)),
    cornerRadius: Math.max(0, evaluateProp(p.cornerRadius, t)),
    trimStart: evaluateProp(p.trimStart, t),
    trimEnd: evaluateProp(p.trimEnd, t),
    letterSpacing: evaluateProp(p.letterSpacing, t),
    reveal: Math.max(0, Math.min(100, evaluateProp(p.reveal, t))),
    blur: Math.max(0, evaluateProp(p.blur, t)),
    local,
    world: local,
  };
}

/** Evaluates every layer at time t and resolves parent transforms (cycle safe). */
export function evaluateDoc(doc: MotionDoc, t: number): Map<string, EvaluatedLayer> {
  const out = new Map<string, EvaluatedLayer>();
  for (const layer of doc.layers) out.set(layer.id, evaluateLayer(layer, t));
  const resolved = new Map<string, Mat>();
  const resolve = (id: string, depth: number): Mat => {
    const cached = resolved.get(id);
    if (cached) return cached;
    const ev = out.get(id)!;
    const parent = ev.layer.parentId ? out.get(ev.layer.parentId) : undefined;
    // Depth guard protects against corrupted files with parent cycles.
    const world = parent && depth < 64 ? multiply(resolve(parent.layer.id, depth + 1), ev.local) : ev.local;
    resolved.set(id, world);
    return world;
  };
  for (const ev of out.values()) ev.world = resolve(ev.layer.id, 0);
  return out;
}

/** Layers to draw at time t, bottom-most first. Honors visibility, solo and in/out points. */
export function renderOrder(doc: MotionDoc, t: number): Layer[] {
  const anySolo = doc.layers.some((l) => l.solo && l.type !== 'null');
  const out: Layer[] = [];
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.type === 'null' || !l.visible || !isLayerActive(l, t)) continue;
    if (anySolo && !l.solo) continue;
    out.push(l);
  }
  return out;
}
