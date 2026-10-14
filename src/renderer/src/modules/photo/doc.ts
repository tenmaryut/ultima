/**
 * Immutable document helpers (no canvas creation here, so they can be unit tested with
 * stand-in canvas objects).
 */
import { uid } from '../../core/utils/id';
import type { Layer, LayerEffects, LayerMask, PhotoDoc, RasterLayer, Selection, ShapeLayer, TextLayer } from './types';

export function findLayer(doc: PhotoDoc, id: string | null | undefined): Layer | undefined {
  return id ? doc.layers.find((l) => l.id === id) : undefined;
}

export function getActiveLayer(doc: PhotoDoc): Layer | null {
  return findLayer(doc, doc.activeId) ?? null;
}

export function layerIndex(doc: PhotoDoc, id: string | null | undefined): number {
  return id ? doc.layers.findIndex((l) => l.id === id) : -1;
}

export function updateLayer(doc: PhotoDoc, id: string, patch: Partial<Layer> | ((layer: Layer) => Layer)): PhotoDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id) return l;
    const next = typeof patch === 'function' ? patch(l) : ({ ...l, ...patch } as Layer);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

/** Inserts `layer` (default: right above the active layer) and makes it active. */
export function insertLayer(doc: PhotoDoc, layer: Layer, index?: number): PhotoDoc {
  const active = layerIndex(doc, doc.activeId);
  const at = index ?? (active >= 0 ? active + 1 : doc.layers.length);
  const layers = [...doc.layers];
  layers.splice(Math.max(0, Math.min(layers.length, at)), 0, layer);
  return { ...doc, layers, activeId: layer.id };
}

export function removeLayer(doc: PhotoDoc, id: string): PhotoDoc {
  const index = layerIndex(doc, id);
  if (index < 0) return doc;
  const layers = doc.layers.filter((l) => l.id !== id);
  let activeId = doc.activeId;
  if (activeId === id) activeId = layers[Math.min(index, layers.length - 1)]?.id ?? layers[index - 1]?.id ?? null;
  return { ...doc, layers, activeId };
}

/** Moves a layer to `index` in the bottom→top stack. */
export function moveLayerTo(doc: PhotoDoc, id: string, index: number): PhotoDoc {
  const from = layerIndex(doc, id);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(doc.layers.length - 1, index));
  if (to === from) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(from, 1);
  layers.splice(to, 0, layer);
  return { ...doc, layers };
}

export function shiftLayer(doc: PhotoDoc, id: string, delta: number): PhotoDoc {
  return moveLayerTo(doc, id, layerIndex(doc, id) + delta);
}

export function setActiveLayer(doc: PhotoDoc, id: string | null): PhotoDoc {
  return doc.activeId === id ? doc : { ...doc, activeId: id };
}

export function setSelection(doc: PhotoDoc, selection: Selection | null): PhotoDoc {
  return doc.selection === selection ? doc : { ...doc, selection };
}

export function nextLayerName(doc: PhotoDoc, base = 'Layer'): string {
  let max = 0;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  for (const l of doc.layers) {
    const m = re.exec(l.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base} ${max + 1}`;
}

export function copyName(name: string): string {
  return / copy( \d+)?$/.test(name) ? name.replace(/ copy( (\d+))?$/, (_m, _g, n) => ` copy ${n ? Number(n) + 1 : 2}`) : `${name} copy`;
}

export function anyEffect(effects: LayerEffects): boolean {
  return Boolean(effects.shadow?.enabled || effects.stroke?.enabled || effects.glow?.enabled);
}

function base(name: string) {
  return { id: uid('ly'), name, visible: true, locked: false, opacity: 1, blend: 'source-over' as const, mask: null as LayerMask | null, effects: {} as LayerEffects };
}

export function makeRasterLayer(name: string, canvas: HTMLCanvasElement, x = 0, y = 0): RasterLayer {
  return { ...base(name), type: 'raster', canvas, x, y };
}

export function makeTextLayer(props: Partial<Omit<TextLayer, 'type' | 'id'>> & { text: string; x: number; y: number }): TextLayer {
  return {
    ...base(props.name ?? (props.text.split('\n')[0].slice(0, 32) || 'Text')),
    type: 'text',
    font: 'Inter',
    size: 64,
    weight: 400,
    italic: false,
    underline: false,
    color: '#000000',
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    rotation: 0,
    ...props,
  };
}

export function makeShapeLayer(props: Partial<Omit<ShapeLayer, 'type' | 'id'>> & Pick<ShapeLayer, 'shape' | 'x' | 'y' | 'w' | 'h'>): ShapeLayer {
  const names: Record<ShapeLayer['shape'], string> = { rect: 'Rectangle', roundrect: 'Rounded Rectangle', ellipse: 'Ellipse', line: 'Line' };
  return {
    ...base(props.name ?? names[props.shape]),
    type: 'shape',
    fill: '#000000',
    stroke: null,
    strokeWidth: 4,
    radius: 24,
    rotation: 0,
    ...props,
  };
}

/** Duplicate with a new id (pixel buffers are shared — they are immutable). */
export function cloneLayer(layer: Layer): Layer {
  return { ...layer, id: uid('ly'), name: copyName(layer.name), effects: structuredCloneEffects(layer.effects), mask: layer.mask ? { ...layer.mask } : null };
}

function structuredCloneEffects(e: LayerEffects): LayerEffects {
  return {
    shadow: e.shadow ? { ...e.shadow } : undefined,
    stroke: e.stroke ? { ...e.stroke } : undefined,
    glow: e.glow ? { ...e.glow } : undefined,
  };
}

/** Big objects referenced by a document (for the history memory budget). */
export function* docMemory(doc: PhotoDoc): Iterable<[object, number]> {
  for (const l of doc.layers) {
    if (l.type === 'raster') yield [l.canvas, l.canvas.width * l.canvas.height * 4];
    if (l.mask) yield [l.mask.canvas, l.mask.canvas.width * l.mask.canvas.height * 4];
  }
  if (doc.selection) yield [doc.selection.mask, doc.selection.mask.length];
}

/** Moves a layer (and its mask) by dx, dy. */
export function offsetLayer(layer: Layer, dx: number, dy: number): Layer {
  const mask = layer.mask ? { ...layer.mask, x: layer.mask.x + dx, y: layer.mask.y + dy } : null;
  return { ...layer, x: layer.x + dx, y: layer.y + dy, mask } as Layer;
}

export function emptyDoc(width: number, height: number): PhotoDoc {
  return { width, height, layers: [], activeId: null, selection: null };
}
