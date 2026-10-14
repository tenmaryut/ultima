import { parseColor, toCss } from '../../core/utils/color';
import { parseEasing } from './easing';
import { namedColor } from './named-colors';
import { newKeyId } from './keyframes';
import { BLEND_MODES, clampNumber, createLayer, defaultComposition, LIMITS, newLayerId, PROP_DEFS, PROP_KEYS } from './model';
import type {
  AnimProp,
  Asset,
  Composition,
  Keyframe,
  Layer,
  LayerProps,
  LayerType,
  MotionDoc,
  PathNode,
  PropKey,
  PropValue,
  ShapeKind,
  SubPath,
  Vec2,
} from './types';

/** Project file (.ultima) serialization and defensive validation (pure). */

export const PROJECT_VERSION = 1;

export interface SerializedAsset {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mime: string;
  width: number;
  height: number;
  duration?: number;
  /** data: URL */
  data: string;
}

export interface ProjectFile {
  app: 'ultima';
  module: 'motion';
  version: number;
  name: string;
  comp: Composition;
  layers: Layer[];
  assets: SerializedAsset[];
}

/** JSON text of a project. `assetData` maps asset ids to data URLs. */
export function serializeProject(doc: MotionDoc, assetData: Record<string, string>): string {
  const assets: SerializedAsset[] = Object.values(doc.assets)
    .filter((a) => assetData[a.id])
    .map((a: Asset) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      mime: a.mime,
      width: a.width,
      height: a.height,
      ...(a.duration !== undefined ? { duration: a.duration } : {}),
      data: assetData[a.id],
    }));
  const file: ProjectFile = {
    app: 'ultima',
    module: 'motion',
    version: PROJECT_VERSION,
    name: doc.comp.name,
    comp: doc.comp,
    layers: doc.layers,
    assets,
  };
  return JSON.stringify(file);
}

export interface ParsedProject {
  comp: Composition;
  layers: Layer[];
  assets: SerializedAsset[];
}

/** Parses and validates a project file. Throws a readable Error for files that aren't ours. */
export function parseProject(text: string): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The file is not a valid Ultima project (invalid JSON).');
  }
  return parseProjectObject(raw);
}

export function parseProjectObject(raw: unknown): ParsedProject {
  const o = raw as Partial<ProjectFile> | null;
  if (!o || typeof o !== 'object' || o.app !== 'ultima') throw new Error('The file is not an Ultima project.');
  if (o.module !== 'motion') throw new Error(`This project belongs to another module (${String(o.module)}).`);
  if (typeof o.version === 'number' && o.version > PROJECT_VERSION) {
    throw new Error('This project was saved by a newer version of Ultima.');
  }
  const comp = sanitizeComposition(o.comp);
  const assets = (Array.isArray(o.assets) ? o.assets : [])
    .map(sanitizeAsset)
    .filter((a): a is SerializedAsset => Boolean(a));
  const assetIds = new Set(assets.map((a) => a.id));
  const layers = (Array.isArray(o.layers) ? o.layers : [])
    .slice(0, 2000)
    .map((l, i) => sanitizeLayer(l, comp, i))
    .filter((l): l is Layer => Boolean(l))
    .filter((l) => (l.type === 'image' || l.type === 'video' ? Boolean(l.assetId && assetIds.has(l.assetId)) : true));
  // Unique ids + valid parents.
  const seen = new Set<string>();
  for (const l of layers) {
    if (seen.has(l.id)) l.id = newLayerId();
    seen.add(l.id);
  }
  for (const l of layers) if (l.parentId && (!seen.has(l.parentId) || l.parentId === l.id)) l.parentId = null;
  breakParentCycles(layers);
  dedupeKeyIds(layers);
  return { comp, layers, assets };
}

function breakParentCycles(layers: Layer[]): void {
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const l of layers) {
    const seen = new Set<string>([l.id]);
    let p = l.parentId ? byId.get(l.parentId) : undefined;
    while (p) {
      if (seen.has(p.id)) {
        l.parentId = null;
        break;
      }
      seen.add(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
  }
}

/* ------------------------------- Sanitizers ------------------------------ */

export function cleanText(v: unknown, max = 5000): string {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '';
}

export function cleanColor(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const c = parseColor(namedColor(v) ?? v);
  return c ? toCss(c) : fallback;
}

export function sanitizeComposition(raw: unknown): Composition {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Composition>;
  const def = defaultComposition();
  const duration = clampNumber(o.duration, LIMITS.minDuration, LIMITS.maxDuration, def.duration);
  const comp: Composition = {
    name: cleanText(o.name, 120) || def.name,
    width: Math.round(clampNumber(o.width, LIMITS.minSize, LIMITS.maxSize, def.width)),
    height: Math.round(clampNumber(o.height, LIMITS.minSize, LIMITS.maxSize, def.height)),
    fps: clampNumber(o.fps, LIMITS.minFps, LIMITS.maxFps, def.fps),
    duration,
    background: cleanColor(o.background, def.background),
    transparent: Boolean(o.transparent),
    workStart: clampNumber(o.workStart, 0, duration, 0),
    workEnd: clampNumber(o.workEnd, 0, duration, duration),
  };
  if (comp.workEnd <= comp.workStart) {
    comp.workStart = 0;
    comp.workEnd = duration;
  }
  return comp;
}

function sanitizeAsset(raw: unknown): SerializedAsset | null {
  const o = raw as Partial<SerializedAsset> | null;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.id !== 'string' || !o.id || typeof o.data !== 'string') return null;
  const kind = o.kind === 'video' ? 'video' : 'image';
  const prefix = kind === 'image' ? /^data:image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml);base64,/i : /^data:video\/[a-z0-9.+-]+;base64,/i;
  if (!prefix.test(o.data)) return null;
  return {
    id: o.id.slice(0, 64),
    kind,
    name: cleanText(o.name, 200) || (kind === 'image' ? 'Image' : 'Video'),
    mime: cleanText(o.mime, 100) || (kind === 'image' ? 'image/png' : 'video/mp4'),
    width: Math.round(clampNumber(o.width, 1, 16384, 100)),
    height: Math.round(clampNumber(o.height, 1, 16384, 100)),
    ...(kind === 'video' ? { duration: clampNumber(o.duration, 0, 360000, 0) } : {}),
    data: o.data,
  };
}

const LAYER_TYPES: LayerType[] = ['text', 'shape', 'image', 'solid', 'null', 'video'];
const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'polygon', 'star', 'line', 'path'];

function sanitizeValue(kind: 'number' | 'vec2' | 'color', v: unknown, fallback: PropValue, key: PropKey): PropValue {
  const def = PROP_DEFS[key];
  if (kind === 'color') return cleanColor(v, fallback as string);
  if (kind === 'vec2') {
    const fb = fallback as Vec2;
    let pair: unknown[] | null = null;
    if (Array.isArray(v)) pair = v;
    else if (v && typeof v === 'object') pair = [(v as { x?: unknown }).x, (v as { y?: unknown }).y];
    else if (typeof v === 'number') pair = [v, v];
    if (!pair) return [fb[0], fb[1]];
    const min = def.min ?? -1e6;
    const max = def.max ?? 1e6;
    return [clampNumber(pair[0], min, max, fb[0]), clampNumber(pair[1] ?? pair[0], min, max, fb[1])];
  }
  return clampNumber(v, def.min ?? -1e6, def.max ?? 1e6, fallback as number);
}

export function sanitizeProp(raw: unknown, key: PropKey, fallback: AnimProp): AnimProp {
  const def = PROP_DEFS[key];
  const o = raw as Partial<AnimProp> | null;
  if (!o || typeof o !== 'object') return fallback;
  const value = sanitizeValue(def.kind, o.value, fallback.value, key);
  const keyframes: Keyframe[] = [];
  if (Array.isArray(o.keyframes)) {
    for (const k of o.keyframes.slice(0, 5000)) {
      if (!k || typeof k !== 'object') continue;
      const time = clampNumber((k as Keyframe).time, 0, LIMITS.maxDuration, NaN);
      if (!Number.isFinite(time)) continue;
      const easing = parseEasing((k as Keyframe).easing === 'bezier' ? { bezier: (k as Keyframe).bezier } : (k as Keyframe).easing) ?? {
        easing: 'linear' as const,
      };
      const id = typeof (k as Keyframe).id === 'string' && (k as Keyframe).id ? (k as Keyframe).id.slice(0, 64) : newKeyId();
      if (keyframes.some((e) => Math.abs(e.time - time) < 1e-4)) continue;
      keyframes.push({ id, time, value: sanitizeValue(def.kind, (k as Keyframe).value, value, key), ...easing });
    }
  }
  keyframes.sort((a, b) => a.time - b.time);
  // Keyframe ids must be unique within the document; duplicates get new ids.
  return { value, keyframes };
}

function sanitizeNodes(raw: unknown): SubPath[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SubPath[] = [];
  for (const sp of raw.slice(0, 2000)) {
    if (!sp || typeof sp !== 'object' || !Array.isArray((sp as SubPath).nodes)) continue;
    const nodes: PathNode[] = [];
    for (const n of (sp as SubPath).nodes.slice(0, 20000)) {
      if (!n || typeof n !== 'object') continue;
      const num = (v: unknown) => clampNumber(v, -1e6, 1e6, 0);
      nodes.push({ x: num(n.x), y: num(n.y), inX: num(n.inX), inY: num(n.inY), outX: num(n.outX), outY: num(n.outY) });
    }
    if (nodes.length) out.push({ closed: Boolean((sp as SubPath).closed), nodes });
  }
  return out;
}

/** Validates a layer from a file (or AI) and fills in anything missing. */
export function sanitizeLayer(raw: unknown, comp: Composition, index = 0): Layer | null {
  const o = raw as Partial<Layer> | null;
  if (!o || typeof o !== 'object') return null;
  const type = LAYER_TYPES.includes(o.type as LayerType) ? (o.type as LayerType) : null;
  if (!type) return null;
  const shapeKind = SHAPE_KINDS.includes(o.shape?.kind as ShapeKind) ? (o.shape!.kind as ShapeKind) : 'rect';
  const base = createLayer(type, comp, { shapeKind }, index);
  const props = {} as LayerProps;
  for (const key of PROP_KEYS) {
    (props as unknown as Record<string, AnimProp>)[key] = sanitizeProp(
      (o.props as Record<string, unknown> | undefined)?.[key],
      key,
      base.props[key] as AnimProp,
    );
  }
  const inPoint = clampNumber(o.inPoint, 0, LIMITS.maxDuration, 0);
  const layer: Layer = {
    ...base,
    id: typeof o.id === 'string' && /^[\w-]{1,64}$/.test(o.id) ? o.id : base.id,
    name: cleanText(o.name, 200) || base.name,
    visible: o.visible !== false,
    locked: Boolean(o.locked),
    solo: Boolean(o.solo),
    inPoint,
    outPoint: Math.max(inPoint + 1 / 120, clampNumber(o.outPoint, 0, LIMITS.maxDuration, comp.duration)),
    parentId: typeof o.parentId === 'string' ? o.parentId : null,
    blendMode: BLEND_MODES.some((b) => b.value === o.blendMode) ? o.blendMode! : 'normal',
    label: cleanColor(o.label, base.label),
    props,
    effects: {
      shadow: {
        enabled: Boolean(o.effects?.shadow?.enabled),
        color: cleanColor(o.effects?.shadow?.color, base.effects.shadow.color),
        angle: clampNumber(o.effects?.shadow?.angle, -360, 360, base.effects.shadow.angle),
        distance: clampNumber(o.effects?.shadow?.distance, 0, 2000, base.effects.shadow.distance),
        softness: clampNumber(o.effects?.shadow?.softness, 0, 500, base.effects.shadow.softness),
      },
      glow: {
        enabled: Boolean(o.effects?.glow?.enabled),
        color: cleanColor(o.effects?.glow?.color, base.effects.glow.color),
        radius: clampNumber(o.effects?.glow?.radius, 0, 500, base.effects.glow.radius),
        intensity: clampNumber(o.effects?.glow?.intensity, 0, 300, base.effects.glow.intensity),
      },
    },
    wiggles: (Array.isArray(o.wiggles) ? o.wiggles : []).slice(0, 20).flatMap((w, i) => {
      if (!w || typeof w !== 'object') return [];
      const property = ['position', 'rotation', 'scale', 'opacity'].includes(w.property) ? w.property : 'position';
      const start = clampNumber(w.start, 0, LIMITS.maxDuration, 0);
      return [
        {
          id: typeof w.id === 'string' ? w.id.slice(0, 64) : `w${i}`,
          property,
          frequency: clampNumber(w.frequency, 0.01, 60, 2),
          amplitude: clampNumber(w.amplitude, -10000, 10000, 20),
          seed: Math.round(clampNumber(w.seed, 0, 1e9, i + 1)),
          start,
          end: Math.max(start, clampNumber(w.end, 0, LIMITS.maxDuration, comp.duration)),
        },
      ];
    }),
  };
  if (type === 'text') {
    const tx = (o.text ?? {}) as Partial<NonNullable<Layer['text']>>;
    const d = base.text!;
    layer.text = {
      text: typeof tx.text === 'string' ? cleanText(tx.text, 5000) : d.text,
      fontFamily: cleanText(tx.fontFamily, 120).replace(/["';{}<>]/g, '') || d.fontFamily,
      fontSize: clampNumber(tx.fontSize, 1, 2000, d.fontSize),
      fontWeight: Math.round(clampNumber(tx.fontWeight, 100, 900, d.fontWeight) / 100) * 100,
      italic: Boolean(tx.italic),
      align: tx.align === 'left' || tx.align === 'right' ? tx.align : 'center',
      lineHeight: clampNumber(tx.lineHeight, 0.5, 5, d.lineHeight),
      fillEnabled: tx.fillEnabled !== false,
      strokeEnabled: Boolean(tx.strokeEnabled),
      revealMode: tx.revealMode === 'words' || tx.revealMode === 'lines' ? tx.revealMode : 'chars',
      revealStyle: tx.revealStyle === 'fade' || tx.revealStyle === 'rise' ? tx.revealStyle : 'instant',
    };
  }
  if (type === 'shape') {
    const sh = (o.shape ?? {}) as Partial<NonNullable<Layer['shape']>>;
    const d = base.shape!;
    layer.shape = {
      kind: shapeKind,
      points: Math.round(clampNumber(sh.points, 3, 100, d.points)),
      innerRadius: clampNumber(sh.innerRadius, 1, 100, d.innerRadius),
      path: shapeKind === 'path' ? (sanitizeNodes(sh.path) ?? []) : undefined,
      fillEnabled: sh.fillEnabled !== undefined ? Boolean(sh.fillEnabled) : d.fillEnabled,
      strokeEnabled: sh.strokeEnabled !== undefined ? Boolean(sh.strokeEnabled) : d.strokeEnabled,
      lineCap: sh.lineCap === 'butt' || sh.lineCap === 'square' ? sh.lineCap : 'round',
      lineJoin: sh.lineJoin === 'miter' || sh.lineJoin === 'bevel' ? sh.lineJoin : 'round',
    };
  }
  if (type === 'image' || type === 'video') {
    layer.assetId = typeof o.assetId === 'string' ? o.assetId : undefined;
    layer.mediaOffset = clampNumber(o.mediaOffset, 0, 360000, 0);
  }
  return layer;
}

/** Ensures keyframe ids are unique across the document (files edited by hand / AI). */
export function dedupeKeyIds(layers: Layer[]): void {
  const seen = new Set<string>();
  for (const l of layers) {
    for (const key of PROP_KEYS) {
      const prop = l.props[key] as AnimProp;
      for (const k of prop.keyframes) {
        if (seen.has(k.id)) k.id = newKeyId();
        seen.add(k.id);
      }
    }
  }
}
