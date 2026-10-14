import type { EvaluatedLayer } from './evaluate';
import { pathBounds } from './geometry';
import { apply, type Mat } from './matrix';
import { layoutText } from './text-layout';
import type { Asset, Layer, SubPath } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const pathBoundsCache = new WeakMap<SubPath[], Box>();
export function cachedPathBounds(path: SubPath[]): Box {
  let b = pathBoundsCache.get(path);
  if (!b) {
    b = pathBounds(path);
    pathBoundsCache.set(path, b);
  }
  return b;
}

/** The layer's content rectangle in its own (layer) space. */
export function contentBox(layer: Layer, ev: EvaluatedLayer, assets: Record<string, Asset>): Box {
  switch (layer.type) {
    case 'text':
      return layer.text ? layoutText(layer.text, ev.letterSpacing).box : { x: 0, y: 0, w: 0, h: 0 };
    case 'shape': {
      const kind = layer.shape?.kind ?? 'rect';
      if (kind === 'path') return cachedPathBounds(layer.shape?.path ?? []);
      const [w, h] = ev.size;
      if (kind === 'line') return { x: -w / 2, y: 0, w, h: 0 };
      return { x: -w / 2, y: -h / 2, w, h };
    }
    case 'solid':
      return { x: -ev.size[0] / 2, y: -ev.size[1] / 2, w: ev.size[0], h: ev.size[1] };
    case 'image':
    case 'video': {
      const a = layer.assetId ? assets[layer.assetId] : undefined;
      const w = a?.width ?? 100;
      const h = a?.height ?? 100;
      return { x: -w / 2, y: -h / 2, w, h };
    }
    case 'null':
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** Extra room (layer units) around the content for strokes. */
export function strokeMargin(layer: Layer, ev: EvaluatedLayer): number {
  if (layer.type === 'text' && layer.text?.strokeEnabled) return ev.strokeWidth * 2;
  if (layer.type === 'shape' && layer.shape?.strokeEnabled) return ev.strokeWidth * (layer.shape.lineJoin === 'miter' ? 4 : 1);
  return 0;
}

/** Corners of a box transformed by m. */
export function boxCorners(m: Mat, b: Box): [number, number][] {
  return [apply(m, b.x, b.y), apply(m, b.x + b.w, b.y), apply(m, b.x + b.w, b.y + b.h), apply(m, b.x, b.y + b.h)];
}

/** Axis aligned bounds of a transformed box. */
export function transformedBounds(m: Mat, b: Box): Box {
  const pts = boxCorners(m, b);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function inflate(b: Box, d: number): Box {
  return { x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d };
}

/** Composition-space bounds of a layer (used by presets / AI context). */
export function worldBounds(layer: Layer, ev: EvaluatedLayer, assets: Record<string, Asset>): Box {
  return transformedBounds(ev.world, contentBox(layer, ev, assets));
}
