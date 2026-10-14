import { parseEasing } from './easing';
import { evaluateProp, isAnimated, setEasing, setKeyframe, setValueAt } from './keyframes';
import { centerSubpaths } from './geometry';
import {
  BLEND_MODES,
  clampNumber,
  createLayer,
  getProp,
  isAncestor,
  layerById,
  LIMITS,
  PROP_DEFS,
  removeLayers,
  setDuration,
  setLayerProp,
  uniqueName,
  updateLayer,
} from './model';
import { applyPreset, normalizePresetId, presetInfo } from './presets';
import { cleanColor, cleanText } from './project';
import { parsePathData } from './svgpath';
import type { AnimProp, Composition, Layer, LayerType, MotionDoc, PropKey, PropValue, ShapeKind, Vec2 } from './types';

/**
 * Executes AI actions on the document (pure). Every field is validated and clamped;
 * unknown action types are ignored. The caller applies the result as ONE undo step.
 */

export interface AIApplyContext {
  /** Current playhead (s); used when an animated property is changed without a time. */
  time: number;
  /** Composition-space bounds of a layer (needed by slide presets). */
  bounds: (doc: MotionDoc, layer: Layer, time: number) => { x: number; y: number; w: number; h: number };
  /** Composition → parent space conversion for parented layers. */
  toParentDelta?: (doc: MotionDoc, layer: Layer, time: number) => ((dx: number, dy: number) => [number, number]) | undefined;
}

export interface AIApplyResult {
  doc: MotionDoc;
  created: string[];
  changedLayers: number;
  keyframes: number;
  presets: number;
  deleted: number;
  compositionChanged: boolean;
  /** Problems worth telling the user about (English). */
  notes: string[];
  /** Map of ids the AI chose → real layer ids. */
  idMap: Record<string, string>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const PROP_ALIASES: Record<string, PropKey> = {
  anchor: 'anchor',
  anchorpoint: 'anchor',
  position: 'position',
  pos: 'position',
  scale: 'scale',
  rotation: 'rotation',
  rotate: 'rotation',
  angle: 'rotation',
  opacity: 'opacity',
  alpha: 'opacity',
  size: 'size',
  fill: 'fill',
  fillcolor: 'fill',
  color: 'fill',
  stroke: 'strokeColor',
  strokecolor: 'strokeColor',
  strokewidth: 'strokeWidth',
  cornerradius: 'cornerRadius',
  radius: 'cornerRadius',
  roundness: 'cornerRadius',
  trimstart: 'trimStart',
  trimend: 'trimEnd',
  letterspacing: 'letterSpacing',
  tracking: 'letterSpacing',
  reveal: 'reveal',
  textreveal: 'reveal',
  blur: 'blur',
};

export function normalizePropKey(input: unknown): PropKey | null {
  if (typeof input !== 'string') return null;
  return PROP_ALIASES[input.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'polygon', 'star', 'line', 'path'];
const SHAPE_ALIASES: Record<string, ShapeKind> = {
  rect: 'rect',
  rectangle: 'rect',
  square: 'rect',
  box: 'rect',
  ellipse: 'ellipse',
  circle: 'ellipse',
  oval: 'ellipse',
  polygon: 'polygon',
  triangle: 'polygon',
  hexagon: 'polygon',
  star: 'star',
  line: 'line',
  path: 'path',
};

/** Value of the right kind for a property, or null when invalid. */
export function coerceValue(key: PropKey, v: unknown): PropValue | null {
  const def = PROP_DEFS[key];
  if (def.kind === 'color') {
    if (typeof v !== 'string') return null;
    const c = cleanColor(v, '');
    return c || null;
  }
  if (def.kind === 'vec2') {
    let pair: unknown[] | null = null;
    if (Array.isArray(v) && v.length >= 1) pair = v.length === 1 ? [v[0], v[0]] : v;
    else if (isObj(v)) pair = [v.x ?? v.width ?? v[0], v.y ?? v.height ?? v[1]];
    else if (typeof v === 'number' && (key === 'scale' || key === 'size')) pair = [v, v];
    if (!pair) return null;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const min = def.min ?? -100000;
    const max = def.max ?? 100000;
    return [Math.min(max, Math.max(min, x)), Math.min(max, Math.max(min, y))];
  }
  let n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return null;
  if (key === 'opacity' && n > 0 && n < 1) n *= 100; // 0..1 fractions
  return Math.min(def.max ?? 100000, Math.max(def.min ?? -100000, n));
}

function layerTypeOf(input: unknown): { type: LayerType; shape?: ShapeKind } | null {
  if (typeof input !== 'string') return null;
  const key = input.toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'text' || key === 'title' || key === 'label') return { type: 'text' };
  if (key === 'solid' || key === 'background') return { type: 'solid' };
  if (key === 'null' || key === 'group' || key === 'nullobject') return { type: 'null' };
  if (key === 'shape') return { type: 'shape', shape: 'rect' };
  const shape = SHAPE_ALIASES[key];
  return shape ? { type: 'shape', shape } : null;
}

function setPropAt(layer: Layer, key: PropKey, value: PropValue, time: number): Layer {
  const prop = getProp(layer, key);
  return setLayerProp(layer, key, setValueAt(prop as AnimProp<PropValue>, time, value) as never);
}

/** Applies a props object (see AI instructions) to a layer. */
export function applyLayerProps(layer: Layer, props: Obj, time: number, doc: MotionDoc, idMap: Record<string, string>, notes: string[]): Layer {
  let l = layer;
  const set = (key: PropKey, raw: unknown) => {
    const v = coerceValue(key, raw);
    if (v !== null) l = setPropAt(l, key, v, time);
  };
  if (typeof props.name === 'string' && props.name.trim()) l = { ...l, name: cleanText(props.name, 120) };

  // Text
  if (l.type === 'text' && l.text) {
    const tx = { ...l.text };
    if (typeof props.text === 'string') tx.text = cleanText(props.text, 2000);
    const font = props.fontFamily ?? props.font;
    if (typeof font === 'string' && font.trim()) tx.fontFamily = cleanText(font, 80).replace(/["';{}<>\\]/g, '');
    if (props.fontSize !== undefined) tx.fontSize = clampNumber(props.fontSize, 4, 2000, tx.fontSize);
    if (props.fontWeight !== undefined) {
      const w = props.fontWeight === 'bold' ? 700 : props.fontWeight === 'normal' ? 400 : clampNumber(props.fontWeight, 100, 900, tx.fontWeight);
      tx.fontWeight = Math.round(w / 100) * 100;
    }
    if (typeof props.italic === 'boolean') tx.italic = props.italic;
    if (props.align === 'left' || props.align === 'center' || props.align === 'right') tx.align = props.align;
    if (props.lineHeight !== undefined) tx.lineHeight = clampNumber(props.lineHeight, 0.5, 5, tx.lineHeight);
    if (props.revealMode === 'chars' || props.revealMode === 'words' || props.revealMode === 'lines') tx.revealMode = props.revealMode;
    if (props.revealStyle === 'instant' || props.revealStyle === 'fade' || props.revealStyle === 'rise') tx.revealStyle = props.revealStyle;
    if (props.stroke === 'none' || props.strokeColor === 'none') tx.strokeEnabled = false;
    else if (props.stroke !== undefined || props.strokeColor !== undefined || (props.strokeWidth !== undefined && Number(props.strokeWidth) > 0)) tx.strokeEnabled = true;
    if (props.fill === 'none') tx.fillEnabled = false;
    l = { ...l, text: tx };
    if (typeof props.text === 'string' && typeof props.name !== 'string') l = { ...l, name: tx.text.split('\n')[0].slice(0, 40) || l.name };
  }

  // Shape
  if (l.type === 'shape' && l.shape) {
    const sh = { ...l.shape };
    const kind = typeof props.shape === 'string' ? SHAPE_ALIASES[props.shape.toLowerCase()] : undefined;
    if (kind && SHAPE_KINDS.includes(kind)) sh.kind = kind;
    if (props.points !== undefined) sh.points = Math.round(clampNumber(props.points, 3, 100, sh.points));
    if (props.innerRadius !== undefined) sh.innerRadius = clampNumber(props.innerRadius, 1, 100, sh.innerRadius);
    if (props.lineCap === 'butt' || props.lineCap === 'round' || props.lineCap === 'square') sh.lineCap = props.lineCap;
    if (props.lineJoin === 'miter' || props.lineJoin === 'round' || props.lineJoin === 'bevel') sh.lineJoin = props.lineJoin;
    if (props.fill === 'none') sh.fillEnabled = false;
    else if (props.fill !== undefined || props.color !== undefined) sh.fillEnabled = sh.kind !== 'line';
    if (props.stroke === 'none' || props.strokeColor === 'none') sh.strokeEnabled = false;
    else if (props.stroke !== undefined || props.strokeColor !== undefined || (props.strokeWidth !== undefined && Number(props.strokeWidth) > 0)) sh.strokeEnabled = true;
    if (typeof props.path === 'string' && props.path.trim()) {
      try {
        const parsed = parsePathData(props.path.slice(0, 20000));
        if (parsed.length) {
          const c = centerSubpaths(parsed);
          sh.kind = 'path';
          sh.path = c.subpaths;
          if (props.x === undefined && props.y === undefined && props.position === undefined) {
            l = setPropAt(l, 'position', [c.cx, c.cy], time);
          }
        }
      } catch {
        notes.push('An SVG path from the AI could not be parsed.');
      }
    }
    if (sh.kind === 'path' && !sh.path) sh.path = [];
    l = { ...l, shape: sh };
  }

  // Colors & strokes
  const fill = props.fill ?? props.color;
  if (fill !== undefined && fill !== 'none') set('fill', fill);
  const stroke = props.strokeColor ?? props.stroke;
  if (stroke !== undefined && stroke !== 'none') set('strokeColor', stroke);
  if (props.strokeWidth !== undefined) set('strokeWidth', props.strokeWidth);

  // Geometry & transform
  if (props.size !== undefined) set('size', props.size);
  if (props.width !== undefined || props.height !== undefined) {
    const cur = getProp(l, 'size').value as Vec2;
    set('size', [props.width ?? cur[0], props.height ?? (l.shape?.kind === 'line' ? 0 : cur[1])]);
  }
  if (props.position !== undefined) set('position', props.position);
  if (props.x !== undefined || props.y !== undefined) {
    const cur = getProp(l, 'position').value as Vec2;
    set('position', [props.x ?? cur[0], props.y ?? cur[1]]);
  }
  if (props.anchor !== undefined) set('anchor', props.anchor);
  if (props.scale !== undefined) set('scale', props.scale);
  if (props.rotation !== undefined) set('rotation', props.rotation);
  if (props.opacity !== undefined) set('opacity', props.opacity);
  const radius = props.cornerRadius ?? props.radius;
  if (radius !== undefined) set('cornerRadius', radius);
  const spacing = props.letterSpacing ?? props.tracking;
  if (spacing !== undefined) set('letterSpacing', spacing);
  for (const key of ['reveal', 'trimStart', 'trimEnd', 'blur'] as PropKey[]) if (props[key] !== undefined) set(key, props[key]);

  // Layer settings
  if (typeof props.blendMode === 'string' && BLEND_MODES.some((b) => b.value === props.blendMode)) l = { ...l, blendMode: props.blendMode as Layer['blendMode'] };
  if (typeof props.visible === 'boolean') l = { ...l, visible: props.visible };
  if (typeof props.locked === 'boolean') l = { ...l, locked: props.locked };
  if (typeof props.solo === 'boolean') l = { ...l, solo: props.solo };
  if (props.inPoint !== undefined || props.outPoint !== undefined) {
    const inP = clampNumber(props.inPoint, 0, LIMITS.maxDuration, l.inPoint);
    const outP = clampNumber(props.outPoint, 0, LIMITS.maxDuration, l.outPoint);
    if (outP > inP) l = { ...l, inPoint: inP, outPoint: outP };
    else notes.push('Ignored an out point that was before the in point.');
  }
  if (props.parentId !== undefined) {
    const ref = typeof props.parentId === 'string' ? (idMap[props.parentId] ?? props.parentId) : null;
    if (ref === null || props.parentId === 'none') l = { ...l, parentId: null };
    else if (layerById(doc, ref) && ref !== l.id && !isAncestor(doc, ref, l.id)) l = { ...l, parentId: ref };
  }
  if (props.shadow !== undefined) {
    const s = props.shadow;
    const cur = l.effects.shadow;
    const shadow = s === false || s === null ? { ...cur, enabled: false } : !isObj(s) ? { ...cur, enabled: Boolean(s) } : {
      enabled: s.enabled !== false,
      color: cleanColor(s.color, cur.color),
      angle: clampNumber(s.angle, -360, 360, cur.angle),
      distance: clampNumber(s.distance, 0, 2000, cur.distance),
      softness: clampNumber(s.softness ?? s.blur, 0, 500, cur.softness),
    };
    l = { ...l, effects: { ...l.effects, shadow } };
  }
  if (props.glow !== undefined) {
    const g = props.glow;
    const cur = l.effects.glow;
    const glow = g === false || g === null ? { ...cur, enabled: false } : !isObj(g) ? { ...cur, enabled: Boolean(g) } : {
      enabled: g.enabled !== false,
      color: cleanColor(g.color, cur.color),
      radius: clampNumber(g.radius, 0, 500, cur.radius),
      intensity: clampNumber(g.intensity, 0, 300, cur.intensity),
    };
    l = { ...l, effects: { ...l.effects, glow } };
  }
  return l;
}

function resolveLayerRef(doc: MotionDoc, ref: unknown, idMap: Record<string, string>): Layer | undefined {
  if (typeof ref !== 'string' || !ref) return undefined;
  const mapped = idMap[ref];
  if (mapped) return layerById(doc, mapped);
  const direct = layerById(doc, ref);
  if (direct) return direct;
  const lower = ref.toLowerCase();
  return doc.layers.find((l) => l.name.toLowerCase() === lower);
}

const MAX_LAYERS = 300;

export function applyAIActions(input: MotionDoc, actions: unknown[], ctx: AIApplyContext): AIApplyResult {
  let doc = input;
  const res: AIApplyResult = { doc, created: [], changedLayers: 0, keyframes: 0, presets: 0, deleted: 0, compositionChanged: false, notes: [], idMap: {} };
  const changed = new Set<string>();
  const list = Array.isArray(actions) ? actions.slice(0, 500) : [];

  for (const raw of list) {
    if (!isObj(raw) || typeof raw.type !== 'string') continue;
    switch (raw.type) {
      case 'setComposition': {
        const c = doc.comp;
        const next: Composition = { ...c };
        if (raw.width !== undefined) next.width = Math.round(clampNumber(raw.width, LIMITS.minSize, LIMITS.maxSize, c.width));
        if (raw.height !== undefined) next.height = Math.round(clampNumber(raw.height, LIMITS.minSize, LIMITS.maxSize, c.height));
        if (raw.fps !== undefined) next.fps = clampNumber(raw.fps, LIMITS.minFps, LIMITS.maxFps, c.fps);
        if (typeof raw.name === 'string' && raw.name.trim()) next.name = cleanText(raw.name, 120);
        if (raw.background === 'transparent' || raw.transparent === true) next.transparent = true;
        else if (typeof raw.background === 'string') {
          const bg = cleanColor(raw.background, '');
          if (bg) {
            next.background = bg;
            next.transparent = false;
          }
        }
        doc = { ...doc, comp: next };
        if (raw.duration !== undefined) doc = setDuration(doc, clampNumber(raw.duration, LIMITS.minDuration, LIMITS.maxDuration, c.duration));
        res.compositionChanged = true;
        break;
      }
      case 'addLayer': {
        if (doc.layers.length >= MAX_LAYERS) {
          res.notes.push('Layer limit reached; some layers were not added.');
          break;
        }
        const kind = layerTypeOf(raw.layerType ?? (isObj(raw.props) ? raw.props.layerType : undefined));
        if (!kind) {
          res.notes.push(`Unknown layer type "${String(raw.layerType)}".`);
          break;
        }
        const props = isObj(raw.props) ? raw.props : {};
        let layer = createLayer(kind.type, doc.comp, { shapeKind: kind.shape }, doc.layers.length);
        const wanted = typeof raw.id === 'string' ? raw.id : typeof props.id === 'string' ? props.id : null;
        if (wanted && /^[A-Za-z][\w-]{0,40}$/.test(wanted) && !layerById(doc, wanted)) layer = { ...layer, id: wanted };
        if (wanted) res.idMap[wanted] = layer.id;
        layer = applyLayerProps(layer, props, ctx.time, doc, res.idMap, res.notes);
        if (typeof props.name !== 'string') layer = { ...layer, name: uniqueName(doc, layer.name) };
        doc = { ...doc, layers: [layer, ...doc.layers] };
        res.created.push(layer.id);
        break;
      }
      case 'setProps': {
        const layer = resolveLayerRef(doc, raw.layerId, res.idMap);
        if (!layer || !isObj(raw.props)) break;
        const before = doc;
        doc = updateLayer(doc, layer.id, (l) => applyLayerProps(l, raw.props as Obj, ctx.time, before, res.idMap, res.notes));
        if (doc !== before) changed.add(layer.id);
        break;
      }
      case 'addKeyframes': {
        const layer = resolveLayerRef(doc, raw.layerId, res.idMap);
        const key = normalizePropKey(raw.property);
        if (!layer || !key || !Array.isArray(raw.keyframes)) {
          if (layer && !key) res.notes.push(`Unknown property "${String(raw.property)}".`);
          break;
        }
        let prop = getProp(layer, key) as AnimProp<PropValue>;
        if (raw.replace === true) prop = { value: prop.value, keyframes: [] };
        let added = 0;
        for (const k of raw.keyframes.slice(0, 200)) {
          if (!isObj(k)) continue;
          const time = clampNumber(k.time, 0, doc.comp.duration, NaN);
          const value = coerceValue(key, k.value);
          if (!Number.isFinite(time) || value === null) continue;
          const easing = parseEasing(k.easing) ?? { easing: 'easeInOut' as const };
          prop = setKeyframe(prop, time, value, easing);
          added++;
        }
        if (added) {
          doc = updateLayer(doc, layer.id, (l) => {
            let next = setLayerProp(l, key, prop as never);
            // Animating text reveal / trim makes sure the feature is visible.
            if (key === 'strokeWidth' && next.shape) next = { ...next, shape: { ...next.shape, strokeEnabled: true } };
            return next;
          });
          res.keyframes += added;
          changed.add(layer.id);
        }
        break;
      }
      case 'setEasing': {
        const layer = resolveLayerRef(doc, raw.layerId, res.idMap);
        const easing = parseEasing(raw.easing);
        if (!layer || !easing) break;
        const keys = raw.property === 'all' || raw.property === undefined ? null : normalizePropKey(raw.property);
        if (raw.property !== undefined && raw.property !== 'all' && !keys) break;
        doc = updateLayer(doc, layer.id, (l) => {
          let next = l;
          for (const k of keys ? [keys] : (Object.keys(PROP_DEFS) as PropKey[])) {
            const prop = getProp(next, k);
            if (!isAnimated(prop)) continue;
            next = setLayerProp(next, k, setEasing(prop, new Set(prop.keyframes.map((kf) => kf.id)), easing.easing, easing.bezier) as never);
          }
          return next;
        });
        changed.add(layer.id);
        break;
      }
      case 'clearKeyframes': {
        const layer = resolveLayerRef(doc, raw.layerId, res.idMap);
        if (!layer) break;
        const keys = raw.property === 'all' || raw.property === undefined ? (Object.keys(PROP_DEFS) as PropKey[]) : [normalizePropKey(raw.property)].filter(Boolean) as PropKey[];
        doc = updateLayer(doc, layer.id, (l) => {
          let next = l;
          for (const k of keys) {
            const prop = getProp(next, k);
            if (isAnimated(prop)) next = setLayerProp(next, k, { value: evaluateProp(prop, ctx.time), keyframes: [] } as never);
          }
          return keys.length === Object.keys(PROP_DEFS).length ? { ...next, wiggles: [] } : next;
        });
        changed.add(layer.id);
        break;
      }
      case 'applyPreset': {
        const layer = resolveLayerRef(doc, raw.layerId, res.idMap);
        const id = normalizePresetId(raw.preset);
        if (!layer || !id) {
          if (layer && !id) res.notes.push(`Unknown preset "${String(raw.preset)}".`);
          break;
        }
        const time = clampNumber(raw.time, 0, doc.comp.duration, ctx.time);
        const duration = clampNumber(raw.duration, 1 / doc.comp.fps, LIMITS.maxDuration, presetInfo(id).duration);
        const current = doc;
        const r = applyPreset(layer, id, {
          time,
          duration,
          comp: doc.comp,
          bounds: ctx.bounds(current, layer, time + duration),
          toParentDelta: ctx.toParentDelta?.(current, layer, time),
          frequency: raw.frequency !== undefined ? clampNumber(raw.frequency, 0.1, 30, 2) : undefined,
          amplitude: raw.amplitude !== undefined ? clampNumber(raw.amplitude, 0, 5000, 20) : undefined,
        });
        if (!r.ok) {
          res.notes.push(`${layer.name}: ${r.reason ?? 'preset not applied'}`);
          break;
        }
        doc = updateLayer(doc, layer.id, () => r.layer);
        res.presets++;
        changed.add(layer.id);
        break;
      }
      case 'deleteLayer': {
        const refs = Array.isArray(raw.layerIds) ? raw.layerIds : [raw.layerId];
        const ids = refs.map((r) => resolveLayerRef(doc, r, res.idMap)?.id).filter(Boolean) as string[];
        if (!ids.length) break;
        doc = removeLayers(doc, ids);
        res.deleted += ids.length;
        break;
      }
      default:
        break; // unknown action types are ignored
    }
  }
  for (const id of res.created) changed.delete(id);
  res.changedLayers = [...changed].filter((id) => layerById(doc, id)).length;
  res.doc = doc;
  return res;
}

/** Short English summary of what an AI reply changed. */
export function summarizeAIResult(r: AIApplyResult): string {
  const parts: string[] = [];
  if (r.compositionChanged) parts.push('composition updated');
  if (r.created.length) parts.push(`${r.created.length} layer(s) added`);
  if (r.changedLayers) parts.push(`${r.changedLayers} layer(s) changed`);
  if (r.keyframes) parts.push(`${r.keyframes} keyframe(s)`);
  if (r.presets) parts.push(`${r.presets} preset(s)`);
  if (r.deleted) parts.push(`${r.deleted} layer(s) deleted`);
  return parts.length ? parts.join(' · ') : 'Nothing to change';
}

/* ------------------------- "Animate from description" ------------------------ */

export interface SceneSpec {
  composition?: Obj;
  layers?: unknown[];
}

/**
 * Converts the scene JSON of "Animate from description" into regular actions so it goes
 * through the same validation as the assistant. Layers are listed bottom → top.
 */
export function sceneToActions(scene: unknown): Obj[] {
  if (!isObj(scene)) return [];
  const actions: Obj[] = [];
  if (isObj(scene.composition)) actions.push({ ...scene.composition, type: 'setComposition' });
  const layers = Array.isArray(scene.layers) ? scene.layers.slice(0, 60) : [];
  layers.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : `layer${i + 1}`;
    actions.push({ type: 'addLayer', id, layerType: raw.layerType ?? raw.type, props: isObj(raw.props) ? raw.props : {} });
  });
  // Keyframes and presets after every layer exists (parents may be declared later).
  layers.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : `layer${i + 1}`;
    if (isObj(raw.keyframes)) {
      for (const [property, keyframes] of Object.entries(raw.keyframes)) {
        if (Array.isArray(keyframes)) actions.push({ type: 'addKeyframes', layerId: id, property, keyframes });
      }
    } else if (Array.isArray(raw.keyframes)) {
      // [{property, keyframes}] form
      for (const entry of raw.keyframes) {
        if (isObj(entry) && Array.isArray(entry.keyframes)) actions.push({ type: 'addKeyframes', layerId: id, property: entry.property, keyframes: entry.keyframes });
      }
    }
    if (Array.isArray(raw.presets)) {
      for (const p of raw.presets.slice(0, 10)) if (isObj(p)) actions.push({ ...p, type: 'applyPreset', layerId: id });
    }
  });
  return actions;
}
