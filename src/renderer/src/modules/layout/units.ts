import type { Unit } from './types';

/** Page px per unit (CSS reference: 96 px per inch). */
export const PX_PER_UNIT: Record<Unit, number> = {
  px: 1,
  in: 96,
  mm: 96 / 25.4,
  pt: 96 / 72,
};

export const UNITS: Unit[] = ['mm', 'in', 'pt', 'px'];

export function toUnit(px: number, unit: Unit): number {
  return px / PX_PER_UNIT[unit];
}

export function fromUnit(value: number, unit: Unit): number {
  return value * PX_PER_UNIT[unit];
}

export function convert(value: number, from: Unit, to: Unit): number {
  return toUnit(fromUnit(value, from), to);
}

/** Sensible number of decimals for a unit. */
export function unitDecimals(unit: Unit): number {
  return unit === 'in' ? 3 : unit === 'px' ? 1 : unit === 'pt' ? 1 : 2;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Displays a px length in `unit`, e.g. 793.7 → "210 mm". */
export function formatLength(px: number, unit: Unit, withUnit = true): string {
  const v = roundTo(toUnit(px, unit), unitDecimals(unit));
  const text = String(Object.is(v, -0) ? 0 : v);
  return withUnit ? `${text} ${unit}` : text;
}

/**
 * Parses user input such as "12", "12.5mm", "2 in", "36pt", "1/2in" or "10+2" into px.
 * Numbers without a unit use `defaultUnit`. Returns null for invalid input.
 */
export function parseLength(text: string, defaultUnit: Unit): number | null {
  const s = text.trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  const m = /^(-?[\d.]+(?:\s*[/+\-*]\s*[\d.]+)?)\s*(mm|cm|in|"|pt|px)?$/.exec(s);
  if (!m) return null;
  const value = evalSimple(m[1]);
  if (value === null || !Number.isFinite(value)) return null;
  const unitText = m[2];
  if (unitText === 'cm') return fromUnit(value * 10, 'mm');
  const unit: Unit = unitText === '"' ? 'in' : ((unitText as Unit | undefined) ?? defaultUnit);
  return fromUnit(value, unit);
}

/** Evaluates "a", "a/b", "a+b", "a-b", "a*b" (no eval). */
function evalSimple(expr: string): number | null {
  const m = /^(-?[\d.]+)\s*(?:([/+\-*])\s*([\d.]+))?$/.exec(expr.trim());
  if (!m) return null;
  const a = parseFloat(m[1]);
  if (Number.isNaN(a)) return null;
  if (!m[2]) return a;
  const b = parseFloat(m[3]);
  if (Number.isNaN(b)) return null;
  switch (m[2]) {
    case '/':
      return b === 0 ? null : a / b;
    case '+':
      return a + b;
    case '-':
      return a - b;
    default:
      return a * b;
  }
}

/** Font sizes are shown in pt for print units and in px for pixel documents. */
export function fontUnit(unit: Unit): 'pt' | 'px' {
  return unit === 'px' ? 'px' : 'pt';
}

export function fontSizeToDisplay(px: number, unit: Unit): number {
  return roundTo(fontUnit(unit) === 'pt' ? px * 0.75 : px, 1);
}

export function fontSizeFromDisplay(value: number, unit: Unit): number {
  return fontUnit(unit) === 'pt' ? value / 0.75 : value;
}

/* --------------------------------- Presets -------------------------------- */

export type PresetGroup = 'print' | 'social' | 'screen';

export interface PagePreset {
  id: string;
  name: string;
  group: PresetGroup;
  /** Size in `unit` (portrait / as published). */
  w: number;
  h: number;
  unit: Unit;
}

export const PAGE_PRESETS: PagePreset[] = [
  { id: 'a4', name: 'A4', group: 'print', w: 210, h: 297, unit: 'mm' },
  { id: 'a5', name: 'A5', group: 'print', w: 148, h: 210, unit: 'mm' },
  { id: 'a3', name: 'A3', group: 'print', w: 297, h: 420, unit: 'mm' },
  { id: 'letter', name: 'Letter', group: 'print', w: 8.5, h: 11, unit: 'in' },
  { id: 'legal', name: 'Legal', group: 'print', w: 8.5, h: 14, unit: 'in' },
  { id: 'tabloid', name: 'Tabloid', group: 'print', w: 11, h: 17, unit: 'in' },
  { id: 'poster', name: 'Poster 18 × 24 in', group: 'print', w: 18, h: 24, unit: 'in' },
  { id: 'business-card', name: 'Business card', group: 'print', w: 85, h: 55, unit: 'mm' },
  { id: 'flyer', name: 'Flyer 5.5 × 8.5 in', group: 'print', w: 5.5, h: 8.5, unit: 'in' },
  { id: 'card-5x7', name: 'Card 5 × 7 in', group: 'print', w: 5, h: 7, unit: 'in' },
  { id: 'instagram-post', name: 'Instagram post', group: 'social', w: 1080, h: 1080, unit: 'px' },
  { id: 'instagram-portrait', name: 'Instagram portrait', group: 'social', w: 1080, h: 1350, unit: 'px' },
  { id: 'instagram-story', name: 'Instagram story', group: 'social', w: 1080, h: 1920, unit: 'px' },
  { id: 'facebook-cover', name: 'Facebook cover', group: 'social', w: 1640, h: 624, unit: 'px' },
  { id: 'facebook-post', name: 'Facebook post', group: 'social', w: 1200, h: 630, unit: 'px' },
  { id: 'youtube-thumbnail', name: 'YouTube thumbnail', group: 'social', w: 1280, h: 720, unit: 'px' },
  { id: 'linkedin-banner', name: 'LinkedIn banner', group: 'social', w: 1584, h: 396, unit: 'px' },
  { id: 'x-post', name: 'X post', group: 'social', w: 1600, h: 900, unit: 'px' },
  { id: 'presentation', name: 'Presentation 16:9', group: 'screen', w: 1920, h: 1080, unit: 'px' },
  { id: 'presentation-4-3', name: 'Presentation 4:3', group: 'screen', w: 1440, h: 1080, unit: 'px' },
];

export function getPreset(id: string): PagePreset | undefined {
  return PAGE_PRESETS.find((p) => p.id === id);
}

/** Preset size in page px (portrait as defined). */
export function presetSizePx(preset: PagePreset): { width: number; height: number } {
  return { width: fromUnit(preset.w, preset.unit), height: fromUnit(preset.h, preset.unit) };
}

/** Finds a preset by id or (case-insensitive) name, e.g. "A4", "instagram story". */
export function findPreset(nameOrId: string): PagePreset | undefined {
  const key = nameOrId.trim().toLowerCase().replace(/[_\s]+/g, '-');
  return (
    PAGE_PRESETS.find((p) => p.id === key) ??
    PAGE_PRESETS.find((p) => p.name.toLowerCase().replace(/[_\s]+/g, '-') === key) ??
    PAGE_PRESETS.find((p) => key.length >= 3 && (p.id.startsWith(key) || p.name.toLowerCase().startsWith(nameOrId.trim().toLowerCase())))
  );
}

/** Which preset (if any) matches a page size in either orientation. */
export function matchPreset(width: number, height: number, tolerancePx = 1.5): PagePreset | undefined {
  return PAGE_PRESETS.find((p) => {
    const s = presetSizePx(p);
    return (
      (Math.abs(s.width - width) <= tolerancePx && Math.abs(s.height - height) <= tolerancePx) ||
      (Math.abs(s.width - height) <= tolerancePx && Math.abs(s.height - width) <= tolerancePx)
    );
  });
}

export function orientationOf(width: number, height: number): 'portrait' | 'landscape' {
  return width > height ? 'landscape' : 'portrait';
}

/** The unit a document made from this preset shows by default. */
export function defaultUnitFor(preset: PagePreset | undefined): Unit {
  if (!preset) return 'mm';
  return preset.unit;
}

/** Default margins for a page of this size: ~6% of the short side, clamped. */
export function defaultMargin(width: number, height: number): number {
  const short = Math.min(width, height);
  if (short < 400) return roundTo(fromUnit(4, 'mm'), 2);
  if (short <= 1300 && short >= 600 && Number.isInteger(width) && Number.isInteger(height)) return Math.round(short * 0.06);
  return roundTo(fromUnit(12.7, 'mm'), 2);
}

/** Default bleed: 3 mm for print-size pages, none for screen/social pages. */
export function defaultBleed(preset: PagePreset | undefined): number {
  if (!preset) return 0;
  return preset.group === 'print' ? roundTo(fromUnit(3, 'mm'), 3) : 0;
}

/** "210 × 297 mm" */
export function describeSize(width: number, height: number, unit: Unit): string {
  return `${formatLength(width, unit, false)} × ${formatLength(height, unit, false)} ${unit}`;
}

/** Parses "1-3, 5, 8-" into 0-based page indexes (sorted, unique). Null when invalid. */
export function parsePageRange(text: string, count: number): number[] | null {
  const out = new Set<number>();
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : count;
      if (a < 1 || b < a) return null;
      for (let i = a; i <= Math.min(b, count); i++) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n < 1 || n > count) return null;
      out.add(n - 1);
    } else return null;
  }
  const list = [...out].sort((x, y) => x - y);
  return list.length ? list : null;
}
