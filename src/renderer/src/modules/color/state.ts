/**
 * Color Studio document model and immutable operations (pure — unit tested).
 */
import { uid } from '../../core/utils/id';
import { hexToRgb, hsvToRgb, normalizeHex, rgbToHsv, toHex, lightness, rgbToHsl, type HSV } from './colormath';
import { clampSpread, generateHarmony, isRule, ruleInfo, type HarmonyRule, type WheelMode } from './harmony';
import { defaultGradient, evenStops, isGradientType, makeStop, type GradientDoc } from './gradient';
import { isMood, type Mood } from './extract';

export const MAX_SWATCHES = 12;

export interface Swatch {
  id: string;
  hex: string;
  name: string;
  locked: boolean;
  /** Picker point in the extraction image (normalised 0–1), if the color came from it. */
  point?: { x: number; y: number };
}

export interface ColorDoc {
  name: string;
  tags: string[];
  swatches: Swatch[];
  baseId: string;
  rule: HarmonyRule;
  wheel: WheelMode;
  /** Spread per rule (angle in degrees or S/B amount). */
  spreads: Partial<Record<HarmonyRule, number>>;
  gradient: GradientDoc;
  mood: Mood;
  extractCount: number;
}

export function makeSwatch(hex: string, name = '', locked = false): Swatch {
  return { id: uid('sw'), hex: normalizeHex(hex) ?? '#000000', name, locked };
}

export function baseIndex(doc: ColorDoc): number {
  const i = doc.swatches.findIndex((s) => s.id === doc.baseId);
  return i >= 0 ? i : Math.min(doc.swatches.length - 1, 2);
}

export function baseSwatch(doc: ColorDoc): Swatch {
  return doc.swatches[baseIndex(doc)];
}

export function spreadOf(doc: ColorDoc, rule: HarmonyRule = doc.rule): number {
  return clampSpread(rule, doc.spreads[rule]);
}

export function hexToHsv(hex: string): HSV {
  return rgbToHsv(hexToRgb(hex));
}

export function hsvToHex(hsv: HSV): string {
  return toHex(hsvToRgb(hsv));
}

/**
 * Re-applies the harmony rule from the base color (or `base` when given — keeps float
 * precision while dragging). Locked swatches and the 'custom' rule keep their colors.
 */
export function regenerate(doc: ColorDoc, base?: HSV): ColorDoc {
  const bi = baseIndex(doc);
  const baseHsv = base ?? hexToHsv(doc.swatches[bi].hex);
  const baseHex = base ? hsvToHex(base) : doc.swatches[bi].hex;
  if (doc.rule === 'custom') {
    if (!base) return doc;
    return { ...doc, swatches: doc.swatches.map((s, i) => (i === bi ? { ...s, hex: baseHex } : s)) };
  }
  const { colors } = generateHarmony(baseHsv, doc.rule, doc.swatches.length, bi, spreadOf(doc), doc.wheel);
  return {
    ...doc,
    swatches: doc.swatches.map((s, i) => {
      if (i === bi) return s.hex === baseHex ? s : { ...s, hex: baseHex };
      if (s.locked) return s;
      const hex = hsvToHex(colors[i]);
      return hex === s.hex ? s : { ...s, hex, point: undefined };
    }),
  };
}

export function createDefaultDoc(): ColorDoc {
  const swatches = Array.from({ length: 5 }, () => makeSwatch('#2f6fde'));
  const doc: ColorDoc = {
    name: 'Untitled palette',
    tags: [],
    swatches,
    baseId: swatches[2].id,
    rule: 'analogous',
    wheel: 'ryb',
    spreads: {},
    gradient: defaultGradient(),
    mood: 'balanced',
    extractCount: 5,
  };
  const generated = regenerate(doc);
  return { ...generated, gradient: { ...generated.gradient, stops: evenStops([generated.swatches[0].hex, generated.swatches[2].hex, generated.swatches[4].hex]) } };
}

/** Sets one swatch's color. Editing a non-base swatch switches the rule to Custom (like Adobe Color). */
export function setSwatchHex(doc: ColorDoc, index: number, hex: string): ColorDoc {
  const s = doc.swatches[index];
  const norm = normalizeHex(hex);
  if (!s || !norm) return doc;
  const bi = baseIndex(doc);
  const swatches = doc.swatches.map((x, i) => (i === index ? { ...x, hex: norm } : x));
  const next = { ...doc, swatches };
  if (index === bi) return doc.rule === 'custom' ? next : regenerate(next);
  return doc.rule === 'custom' ? next : { ...next, rule: 'custom' };
}

export function setBaseIndex(doc: ColorDoc, index: number): ColorDoc {
  const s = doc.swatches[index];
  if (!s) return doc;
  return regenerate({ ...doc, baseId: s.id });
}

export function setRule(doc: ColorDoc, rule: HarmonyRule): ColorDoc {
  return regenerate({ ...doc, rule });
}

export function setSpread(doc: ColorDoc, value: number, rule: HarmonyRule = doc.rule): ColorDoc {
  if (!ruleInfo(rule).spread) return doc;
  return regenerate({ ...doc, spreads: { ...doc.spreads, [rule]: clampSpread(rule, value) } });
}

export function setWheel(doc: ColorDoc, wheel: WheelMode): ColorDoc {
  return regenerate({ ...doc, wheel });
}

export function toggleLock(doc: ColorDoc, index: number, locked?: boolean): ColorDoc {
  return { ...doc, swatches: doc.swatches.map((s, i) => (i === index ? { ...s, locked: locked ?? !s.locked } : s)) };
}

export function renameSwatch(doc: ColorDoc, index: number, name: string): ColorDoc {
  return { ...doc, swatches: doc.swatches.map((s, i) => (i === index ? { ...s, name: name.slice(0, 80) } : s)) };
}

export function moveSwatch(doc: ColorDoc, from: number, to: number): ColorDoc {
  if (from === to || !doc.swatches[from] || to < 0 || to >= doc.swatches.length) return doc;
  const list = [...doc.swatches];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return { ...doc, swatches: list };
}

export function addSwatch(doc: ColorDoc, hex?: string, at?: number): ColorDoc {
  if (doc.swatches.length >= MAX_SWATCHES) return doc;
  const index = at ?? doc.swatches.length;
  const ref = doc.swatches[Math.min(doc.swatches.length - 1, Math.max(0, index - 1))];
  const sw = makeSwatch(hex ?? ref?.hex ?? '#808080');
  const list = [...doc.swatches];
  list.splice(index, 0, sw);
  const next = { ...doc, swatches: list };
  return hex ? (doc.rule === 'custom' ? next : { ...next, rule: 'custom' }) : regenerate(next);
}

export function removeSwatch(doc: ColorDoc, index: number): ColorDoc {
  if (doc.swatches.length <= 1 || !doc.swatches[index]) return doc;
  const removed = doc.swatches[index];
  const list = doc.swatches.filter((_, i) => i !== index);
  const baseId = removed.id === doc.baseId ? list[Math.min(list.length - 1, Math.floor(list.length / 2))].id : doc.baseId;
  return regenerate({ ...doc, swatches: list, baseId });
}

/** Replaces the palette colors (keeping locked swatches at their index). */
export function replaceColors(doc: ColorDoc, colors: { hex: string; name?: string; point?: { x: number; y: number } }[], options: { keepLocked?: boolean } = {}): ColorDoc {
  const valid = colors
    .map((c) => ({ ...c, hex: normalizeHex(c.hex) }))
    .filter((c): c is { hex: string; name?: string; point?: { x: number; y: number } } => Boolean(c.hex))
    .slice(0, MAX_SWATCHES);
  if (!valid.length) return doc;
  const keep = options.keepLocked ?? true;
  const swatches = valid.map((c, i) => {
    const old = doc.swatches[i];
    if (old && keep && old.locked) return old;
    return old ? { ...old, hex: c.hex, name: c.name ?? '', point: c.point } : { ...makeSwatch(c.hex, c.name ?? ''), point: c.point };
  });
  const baseId = swatches.some((s) => s.id === doc.baseId) ? doc.baseId : swatches[Math.min(swatches.length - 1, Math.floor(swatches.length / 2))].id;
  return { ...doc, swatches, baseId, rule: 'custom' };
}

export type SortKey = 'lightness' | 'hue' | 'saturation';

export function sortSwatches(doc: ColorDoc, by: SortKey, direction: 'asc' | 'desc' = 'asc'): ColorDoc {
  const key = (hex: string) => {
    if (by === 'lightness') return lightness(hex);
    const hsl = rgbToHsl(hexToRgb(hex));
    return by === 'hue' ? (hsl.s < 0.05 ? 400 + hsl.l : hsl.h) : hsl.s;
  };
  const list = [...doc.swatches].sort((a, b) => (key(a.hex) - key(b.hex)) * (direction === 'asc' ? 1 : -1));
  return { ...doc, swatches: list };
}

export function reverseSwatches(doc: ColorDoc): ColorDoc {
  return { ...doc, swatches: [...doc.swatches].reverse() };
}

export function hexList(doc: ColorDoc): string[] {
  return doc.swatches.map((s) => s.hex);
}

export function paletteData(doc: ColorDoc): { name: string; colors: { hex: string; name?: string }[] } {
  return { name: doc.name, colors: doc.swatches.map((s) => ({ hex: s.hex, name: s.name || undefined })) };
}

/* ------------------------------ Project files ------------------------------ */

export interface ColorProject {
  app: 'ultima';
  module: 'color';
  version: 1;
  doc: ColorDoc;
  /** Optional extraction image (JPEG data URL, downscaled). */
  image?: string;
}

export function serializeProject(doc: ColorDoc, image?: string | null): string {
  const project: ColorProject = { app: 'ultima', module: 'color', version: 1, doc, ...(image ? { image } : {}) };
  return JSON.stringify(project);
}

/** Validates a parsed project/doc object, filling defaults for anything missing or invalid. */
export function sanitizeDoc(input: unknown): ColorDoc {
  const fallback = createDefaultDoc();
  if (!input || typeof input !== 'object') return fallback;
  const o = input as Record<string, unknown>;
  const rawSwatches = Array.isArray(o.swatches) ? o.swatches : [];
  const swatches: Swatch[] = rawSwatches
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const hex = normalizeHex(r.hex);
      if (!hex) return null;
      const p = r.point as { x?: unknown; y?: unknown } | undefined;
      const point =
        p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
          ? { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }
          : undefined;
      return {
        id: typeof r.id === 'string' && r.id ? r.id : uid('sw'),
        hex,
        name: typeof r.name === 'string' ? r.name.slice(0, 80) : '',
        locked: r.locked === true,
        point,
      } as Swatch;
    })
    .filter((s): s is Swatch => Boolean(s))
    .slice(0, MAX_SWATCHES);
  if (!swatches.length) return fallback;
  // ids must be unique
  const seen = new Set<string>();
  for (const s of swatches) {
    if (seen.has(s.id)) s.id = uid('sw');
    seen.add(s.id);
  }
  const baseId = typeof o.baseId === 'string' && swatches.some((s) => s.id === o.baseId) ? o.baseId : swatches[Math.min(swatches.length - 1, 2)].id;
  const g = (o.gradient ?? {}) as Partial<GradientDoc>;
  const stops = Array.isArray(g.stops)
    ? g.stops
        .filter((s) => s && typeof s.color === 'string' && typeof s.position === 'number')
        .map((s) => makeStop(s.color, s.position))
    : [];
  const gradient: GradientDoc = {
    ...fallback.gradient,
    type: isGradientType(g.type) ? g.type : 'linear',
    angle: typeof g.angle === 'number' && Number.isFinite(g.angle) ? g.angle : 90,
    shape: g.shape === 'ellipse' ? 'ellipse' : 'circle',
    cx: typeof g.cx === 'number' && Number.isFinite(g.cx) ? Math.max(0, Math.min(100, g.cx)) : 50,
    cy: typeof g.cy === 'number' && Number.isFinite(g.cy) ? Math.max(0, Math.min(100, g.cy)) : 50,
    interpolation: g.interpolation === 'oklab' ? 'oklab' : 'srgb',
    stops: stops.length >= 2 ? stops : fallback.gradient.stops,
  };
  const spreads: Partial<Record<HarmonyRule, number>> = {};
  if (o.spreads && typeof o.spreads === 'object') {
    for (const [k, v] of Object.entries(o.spreads as Record<string, unknown>)) {
      if (isRule(k) && typeof v === 'number') spreads[k] = clampSpread(k, v);
    }
  }
  return {
    name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 120) : fallback.name,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 40)).slice(0, 20) : [],
    swatches,
    baseId,
    rule: isRule(o.rule) ? o.rule : 'custom',
    wheel: o.wheel === 'rgb' ? 'rgb' : 'ryb',
    spreads,
    gradient,
    mood: isMood(o.mood) ? o.mood : 'balanced',
    extractCount: typeof o.extractCount === 'number' ? Math.max(1, Math.min(MAX_SWATCHES, Math.round(o.extractCount))) : 5,
  };
}

export function parseProject(text: string): { doc: ColorDoc; image?: string } {
  const data = JSON.parse(text) as Partial<ColorProject> & Record<string, unknown>;
  if (data.app !== 'ultima' || data.module !== 'color') throw new Error('This is not a Color Studio project');
  const image = typeof data.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data.image) ? data.image : undefined;
  return { doc: sanitizeDoc(data.doc), image };
}
