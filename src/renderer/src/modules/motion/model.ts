import { cloneProp, evaluateProp, isAnimated, shiftKeys } from './keyframes';
import { decompose, invert, layerMatrix, multiply, type Mat } from './matrix';
import type {
  AnimProp,
  BlendMode,
  Composition,
  Layer,
  LayerProps,
  LayerType,
  MotionDoc,
  PropKey,
  PropKind,
  PropValue,
  ShapeKind,
  Vec2,
} from './types';

/* ------------------------------ Definitions ------------------------------ */

export interface PropDef {
  key: PropKey;
  label: string;
  kind: PropKind;
  group: 'transform' | 'content' | 'effects';
  min?: number;
  max?: number;
  step: number;
  unit?: string;
}

export const PROP_DEFS: Record<PropKey, PropDef> = {
  anchor: { key: 'anchor', label: 'Anchor Point', kind: 'vec2', group: 'transform', step: 1 },
  position: { key: 'position', label: 'Position', kind: 'vec2', group: 'transform', step: 1 },
  scale: { key: 'scale', label: 'Scale', kind: 'vec2', group: 'transform', step: 1, unit: '%' },
  rotation: { key: 'rotation', label: 'Rotation', kind: 'number', group: 'transform', step: 1, unit: '°' },
  opacity: { key: 'opacity', label: 'Opacity', kind: 'number', group: 'transform', step: 1, min: 0, max: 100, unit: '%' },
  size: { key: 'size', label: 'Size', kind: 'vec2', group: 'content', step: 1, min: 0, max: 20000 },
  fill: { key: 'fill', label: 'Fill Color', kind: 'color', group: 'content', step: 1 },
  strokeColor: { key: 'strokeColor', label: 'Stroke Color', kind: 'color', group: 'content', step: 1 },
  strokeWidth: { key: 'strokeWidth', label: 'Stroke Width', kind: 'number', group: 'content', step: 0.5, min: 0, max: 1000 },
  cornerRadius: { key: 'cornerRadius', label: 'Corner Radius', kind: 'number', group: 'content', step: 1, min: 0, max: 10000 },
  trimStart: { key: 'trimStart', label: 'Trim Start', kind: 'number', group: 'content', step: 1, min: 0, max: 100, unit: '%' },
  trimEnd: { key: 'trimEnd', label: 'Trim End', kind: 'number', group: 'content', step: 1, min: 0, max: 100, unit: '%' },
  letterSpacing: { key: 'letterSpacing', label: 'Tracking', kind: 'number', group: 'content', step: 0.5, min: -200, max: 1000 },
  reveal: { key: 'reveal', label: 'Text Reveal', kind: 'number', group: 'content', step: 1, min: 0, max: 100, unit: '%' },
  blur: { key: 'blur', label: 'Blur', kind: 'number', group: 'effects', step: 0.5, min: 0, max: 1000 },
};

export const PROP_KEYS = Object.keys(PROP_DEFS) as PropKey[];
const TRANSFORM_KEYS: PropKey[] = ['anchor', 'position', 'scale', 'rotation', 'opacity'];

/** Animatable properties shown for a layer, in display order. */
export function propsForLayer(layer: Layer): PropKey[] {
  switch (layer.type) {
    case 'text':
      return [...TRANSFORM_KEYS, 'fill', 'strokeColor', 'strokeWidth', 'letterSpacing', 'reveal', 'blur'];
    case 'shape': {
      const kind = layer.shape?.kind ?? 'rect';
      const keys: PropKey[] = [...TRANSFORM_KEYS];
      if (kind !== 'path') keys.push('size');
      if (kind === 'rect') keys.push('cornerRadius');
      if (kind !== 'line') keys.push('fill');
      keys.push('strokeColor', 'strokeWidth', 'trimStart', 'trimEnd', 'blur');
      return keys;
    }
    case 'solid':
      return [...TRANSFORM_KEYS, 'size', 'fill', 'blur'];
    case 'image':
    case 'video':
      return [...TRANSFORM_KEYS, 'blur'];
    case 'null':
      return [...TRANSFORM_KEYS];
  }
}

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'add', label: 'Add' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

export const LABEL_COLORS = ['#c084fc', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#94a3b8'];

export interface CompPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  fps?: number;
}

export const COMP_PRESETS: CompPreset[] = [
  { id: '1080p', label: 'HD 1080p (1920×1080)', width: 1920, height: 1080 },
  { id: '4k', label: '4K UHD (3840×2160)', width: 3840, height: 2160 },
  { id: 'square', label: 'Square 1080 (1080×1080)', width: 1080, height: 1080 },
  { id: 'story', label: 'Vertical story (1080×1920)', width: 1080, height: 1920 },
  { id: 'gif', label: 'GIF 480 (480×480)', width: 480, height: 480, fps: 15 },
];

export const FPS_OPTIONS = [12, 15, 23.976, 24, 25, 29.97, 30, 50, 60];

export const LIMITS = {
  minSize: 16,
  maxSize: 8192,
  minFps: 1,
  maxFps: 120,
  minDuration: 0.1,
  maxDuration: 3600,
};

/* -------------------------------- Factories ------------------------------- */

let layerSeq = 0;
export function newLayerId(): string {
  layerSeq = (layerSeq + 1) % 1_000_000;
  return `L${Date.now().toString(36)}${layerSeq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function staticProp<V extends PropValue>(value: V): AnimProp<V> {
  return { value, keyframes: [] };
}

export function defaultComposition(overrides: Partial<Composition> = {}): Composition {
  const comp: Composition = {
    name: 'Composition 1',
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    background: '#0f172a',
    transparent: false,
    workStart: 0,
    workEnd: 5,
    ...overrides,
  };
  if (overrides.duration !== undefined && overrides.workEnd === undefined) comp.workEnd = comp.duration;
  return comp;
}

export function createDoc(comp: Partial<Composition> = {}): MotionDoc {
  return { comp: defaultComposition(comp), layers: [], assets: {} };
}

function defaultProps(comp: Composition, size: Vec2, fill: string): LayerProps {
  return {
    anchor: staticProp<Vec2>([0, 0]),
    position: staticProp<Vec2>([comp.width / 2, comp.height / 2]),
    scale: staticProp<Vec2>([100, 100]),
    rotation: staticProp(0),
    opacity: staticProp(100),
    size: staticProp<Vec2>(size),
    fill: staticProp(fill),
    strokeColor: staticProp('#ffffff'),
    strokeWidth: staticProp(0),
    cornerRadius: staticProp(0),
    trimStart: staticProp(0),
    trimEnd: staticProp(100),
    letterSpacing: staticProp(0),
    reveal: staticProp(100),
    blur: staticProp(0),
  };
}

export interface CreateLayerOptions {
  name?: string;
  shapeKind?: ShapeKind;
  text?: string;
  assetId?: string;
  size?: Vec2;
  position?: Vec2;
  fill?: string;
  inPoint?: number;
  outPoint?: number;
}

const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  path: 'Path',
};

export function createLayer(type: LayerType, comp: Composition, opts: CreateLayerOptions = {}, index = 0): Layer {
  const base = Math.min(comp.width, comp.height);
  const defaultSize: Vec2 =
    type === 'solid' ? [comp.width, comp.height] : type === 'shape' ? [Math.round(base * 0.3), Math.round(base * 0.3)] : [100, 100];
  const fill = opts.fill ?? (type === 'text' ? '#ffffff' : type === 'solid' ? '#1e293b' : LABEL_COLORS[index % LABEL_COLORS.length]);
  const props = defaultProps(comp, opts.size ?? defaultSize, fill);
  if (opts.position) props.position = staticProp<Vec2>([opts.position[0], opts.position[1]]);
  const layer: Layer = {
    id: newLayerId(),
    name: opts.name ?? '',
    type,
    visible: true,
    locked: false,
    solo: false,
    inPoint: opts.inPoint ?? 0,
    outPoint: opts.outPoint ?? comp.duration,
    parentId: null,
    blendMode: 'normal',
    label: LABEL_COLORS[index % LABEL_COLORS.length],
    props,
    effects: {
      shadow: { enabled: false, color: 'rgba(0, 0, 0, 0.5)', angle: 90, distance: 8, softness: 16 },
      glow: { enabled: false, color: '#ffffff', radius: 24, intensity: 100 },
    },
    wiggles: [],
  };
  switch (type) {
    case 'text':
      layer.text = {
        text: opts.text ?? 'Your text',
        fontFamily: 'Inter',
        fontSize: Math.max(12, Math.round(comp.height / 10)),
        fontWeight: 700,
        italic: false,
        align: 'center',
        lineHeight: 1.2,
        fillEnabled: true,
        strokeEnabled: false,
        revealMode: 'chars',
        revealStyle: 'instant',
      };
      layer.props.strokeWidth = staticProp(4);
      layer.props.strokeColor = staticProp('#000000');
      layer.name = opts.name ?? (layer.text.text.split('\n')[0].slice(0, 40) || 'Text');
      break;
    case 'shape': {
      const kind = opts.shapeKind ?? 'rect';
      layer.shape = {
        kind,
        points: kind === 'star' ? 5 : 6,
        innerRadius: 45,
        fillEnabled: kind !== 'line',
        strokeEnabled: kind === 'line' || kind === 'path',
        lineCap: 'round',
        lineJoin: 'round',
      };
      if (kind === 'line') {
        layer.props.size = staticProp<Vec2>(opts.size ?? [Math.round(base * 0.4), 0]);
        layer.props.strokeColor = staticProp(fill);
      }
      if (kind === 'line' || kind === 'path') layer.props.strokeWidth = staticProp(Math.max(2, Math.round(base / 120)));
      layer.name = opts.name ?? SHAPE_NAMES[kind];
      break;
    }
    case 'solid':
      layer.name = opts.name ?? 'Solid';
      break;
    case 'null':
      layer.name = opts.name ?? 'Null';
      layer.label = '#94a3b8';
      break;
    case 'image':
    case 'video':
      layer.assetId = opts.assetId;
      layer.mediaOffset = 0;
      layer.name = opts.name ?? (type === 'image' ? 'Image' : 'Video');
      break;
  }
  return layer;
}

/** "Rectangle 2" style names that don't clash with existing ones. */
export function uniqueName(doc: MotionDoc, base: string): string {
  const names = new Set(doc.layers.map((l) => l.name));
  if (!names.has(base)) return base;
  const stem = base.replace(/\s+\d+$/, '');
  for (let i = 2; i < 10000; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
  return base;
}

/* -------------------------------- Lookups -------------------------------- */

export function layerById(doc: MotionDoc, id: string | null | undefined): Layer | undefined {
  return id ? doc.layers.find((l) => l.id === id) : undefined;
}

export function getProp(layer: Layer, key: PropKey): AnimProp {
  return layer.props[key] as AnimProp;
}

/** Keyframe times of a layer (all or some properties), sorted and de-duplicated. */
export function layerKeyTimes(layer: Layer, keys: PropKey[] = PROP_KEYS): number[] {
  const set = new Set<number>();
  for (const k of keys) for (const kf of getProp(layer, k).keyframes) set.add(Math.round(kf.time * 10000) / 10000);
  return [...set].sort((a, b) => a - b);
}

export function animatedProps(layer: Layer): PropKey[] {
  return propsForLayer(layer).filter((k) => isAnimated(getProp(layer, k)));
}

/* ------------------------------- Operations ------------------------------- */

export function updateLayer(doc: MotionDoc, id: string, fn: (layer: Layer) => Layer): MotionDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id) return l;
    const next = fn(l);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export function updateLayers(doc: MotionDoc, ids: Iterable<string>, fn: (layer: Layer) => Layer): MotionDoc {
  const set = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (!set.has(l.id)) return l;
    const next = fn(l);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export function setLayerProp<K extends PropKey>(layer: Layer, key: K, prop: LayerProps[K]): Layer {
  if (layer.props[key] === prop) return layer;
  return { ...layer, props: { ...layer.props, [key]: prop } };
}

/** Removes layers; children of removed layers are un-parented. Unused assets are dropped. */
export function removeLayers(doc: MotionDoc, ids: Iterable<string>): MotionDoc {
  const set = new Set(ids);
  if (!set.size) return doc;
  const layers = doc.layers.filter((l) => !set.has(l.id)).map((l) => (l.parentId && set.has(l.parentId) ? { ...l, parentId: null } : l));
  return pruneAssets({ ...doc, layers });
}

export function pruneAssets(doc: MotionDoc): MotionDoc {
  const used = new Set(doc.layers.map((l) => l.assetId).filter(Boolean) as string[]);
  const keys = Object.keys(doc.assets);
  if (keys.every((k) => used.has(k))) return doc;
  const assets: MotionDoc['assets'] = {};
  for (const k of keys) if (used.has(k)) assets[k] = doc.assets[k];
  return { ...doc, assets };
}

/** Copies of layers with new ids (parent links inside the copied set are remapped). */
export function cloneLayers(source: Layer[], doc: MotionDoc, rename = true): Layer[] {
  const idMap = new Map<string, string>();
  for (const l of source) idMap.set(l.id, newLayerId());
  const tmpDoc = { ...doc };
  return source.map((l) => {
    const props = {} as LayerProps;
    for (const key of PROP_KEYS) (props as unknown as Record<string, AnimProp>)[key] = cloneProp(getProp(l, key));
    const copy: Layer = {
      ...l,
      id: idMap.get(l.id)!,
      name: rename ? uniqueName(tmpDoc, l.name) : l.name,
      parentId: l.parentId ? (idMap.get(l.parentId) ?? l.parentId) : null,
      props,
      text: l.text ? { ...l.text } : undefined,
      shape: l.shape ? { ...l.shape, path: l.shape.path?.map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ ...n })) })) } : undefined,
      effects: { shadow: { ...l.effects.shadow }, glow: { ...l.effects.glow } },
      wiggles: l.wiggles.map((w) => ({ ...w, id: newLayerId() })),
    };
    tmpDoc.layers = [...tmpDoc.layers, copy];
    return copy;
  });
}

/** Duplicates layers in place (each copy goes right above its original). Returns new ids. */
export function duplicateLayers(doc: MotionDoc, ids: string[]): { doc: MotionDoc; ids: string[] } {
  const set = new Set(ids);
  const source = doc.layers.filter((l) => set.has(l.id));
  if (!source.length) return { doc, ids: [] };
  const copies = cloneLayers(source, doc);
  const layers: Layer[] = [];
  for (const l of doc.layers) {
    const i = source.indexOf(l);
    if (i >= 0) layers.push(copies[i]);
    layers.push(l);
  }
  return { doc: { ...doc, layers }, ids: copies.map((c) => c.id) };
}

/** Moves the given layers up (-1) or down (+1) one step, or to the top/bottom. */
export function reorderLayers(doc: MotionDoc, ids: string[], where: 'up' | 'down' | 'top' | 'bottom'): MotionDoc {
  const set = new Set(ids);
  const moving = doc.layers.filter((l) => set.has(l.id));
  if (!moving.length) return doc;
  let layers = [...doc.layers];
  if (where === 'top') layers = [...moving, ...layers.filter((l) => !set.has(l.id))];
  else if (where === 'bottom') layers = [...layers.filter((l) => !set.has(l.id)), ...moving];
  else if (where === 'up') {
    for (let i = 1; i < layers.length; i++) {
      if (set.has(layers[i].id) && !set.has(layers[i - 1].id)) [layers[i - 1], layers[i]] = [layers[i], layers[i - 1]];
    }
  } else {
    for (let i = layers.length - 2; i >= 0; i--) {
      if (set.has(layers[i].id) && !set.has(layers[i + 1].id)) [layers[i + 1], layers[i]] = [layers[i], layers[i + 1]];
    }
  }
  return { ...doc, layers };
}

/** Moves a layer (in/out points, keyframes, wiggles) by `delta` seconds. */
export function shiftLayer(layer: Layer, delta: number): Layer {
  if (!delta) return layer;
  const props = {} as LayerProps;
  for (const key of PROP_KEYS) (props as unknown as Record<string, AnimProp>)[key] = shiftKeys(getProp(layer, key), delta);
  return {
    ...layer,
    inPoint: layer.inPoint + delta,
    outPoint: layer.outPoint + delta,
    props,
    wiggles: layer.wiggles.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta })),
  };
}

/* ------------------------------ Transforms ------------------------------- */

/** True when `ancestorId` is `layer` itself or one of its parents (cycle check). */
export function isAncestor(doc: MotionDoc, layerId: string, ancestorId: string): boolean {
  let current: string | null = layerId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = layerById(doc, current)?.parentId ?? null;
  }
  return false;
}

/** Local matrix of a layer at time t (without parents). */
export function localMatrixAt(layer: Layer, t: number): Mat {
  return layerMatrix(
    evaluateProp(layer.props.position, t),
    evaluateProp(layer.props.anchor, t),
    evaluateProp(layer.props.scale, t),
    evaluateProp(layer.props.rotation, t),
  );
}

/** Parent chain transform (parent space → composition space) at time t. */
export function parentMatrixAt(doc: MotionDoc, layer: Layer, t: number): Mat {
  let m: Mat = [1, 0, 0, 1, 0, 0];
  const seen = new Set<string>([layer.id]);
  let parent = layerById(doc, layer.parentId);
  const chain: Layer[] = [];
  while (parent && !seen.has(parent.id)) {
    chain.push(parent);
    seen.add(parent.id);
    parent = layerById(doc, parent.parentId);
  }
  for (let i = chain.length - 1; i >= 0; i--) m = multiply(m, localMatrixAt(chain[i], t));
  return m;
}

/**
 * Parents `childId` to `parentId` (or un-parents with null) keeping the child visually in
 * place at time t when its transform is not animated. Refuses cycles.
 */
export function setParent(doc: MotionDoc, childId: string, parentId: string | null, t: number): MotionDoc {
  const child = layerById(doc, childId);
  if (!child || child.parentId === parentId) return doc;
  if (parentId && (parentId === childId || isAncestor(doc, parentId, childId))) return doc;
  const world = multiply(parentMatrixAt(doc, child, t), localMatrixAt(child, t));
  const animated = (['position', 'rotation', 'scale'] as PropKey[]).some((k) => isAnimated(getProp(child, k)));
  let next: Layer = { ...child, parentId };
  if (!animated) {
    // parentMatrixAt of a layer whose parent is `parentId` = the new parent's world matrix.
    const newParent = parentId ? parentMatrixAt(doc, { ...child, parentId }, t) : null;
    const local = newParent ? multiply(invert(newParent), world) : world;
    // local = T(p)·R·S·T(-a)  ⇒ translation part = p - R·S·a
    const d = decompose(local);
    const anchor = evaluateProp(child.props.anchor, t);
    const m = layerMatrix([0, 0], anchor, [d.scaleX, d.scaleY], d.rotation);
    const position: Vec2 = [local[4] - m[4], local[5] - m[5]];
    next = {
      ...next,
      props: {
        ...next.props,
        position: { ...next.props.position, value: position },
        rotation: { ...next.props.rotation, value: d.rotation },
        scale: { ...next.props.scale, value: [d.scaleX, d.scaleY] },
      },
    };
  }
  return updateLayer(doc, childId, () => next);
}

/** Changes the composition duration; layers that ended at the old end are extended. */
export function setDuration(doc: MotionDoc, duration: number): MotionDoc {
  const old = doc.comp.duration;
  const comp: Composition = {
    ...doc.comp,
    duration,
    workStart: Math.min(doc.comp.workStart, duration),
    workEnd: doc.comp.workEnd >= old - 1e-6 ? duration : Math.min(doc.comp.workEnd, duration),
  };
  if (comp.workEnd <= comp.workStart) {
    comp.workStart = 0;
    comp.workEnd = duration;
  }
  const layers = doc.layers.map((l) => (l.outPoint >= old - 1e-6 && duration > old ? { ...l, outPoint: duration } : l));
  return { ...doc, comp, layers };
}

export function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
