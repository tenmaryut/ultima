/**
 * Develop settings model: every adjustment a photo can carry, its range, default and
 * grouping. Pure data + helpers (no DOM) so presets, catalogs, AI actions and history
 * can all validate against the same table.
 */

export const BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'] as const;
export type Band = (typeof BANDS)[number];
/** Hue centers (degrees) of the 8 HSL bands, in BANDS order. */
export const BAND_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300] as const;

export type Treatment = 'color' | 'bw';
/** Tone curve control point [x, y], both 0..1. */
export type CurvePoint = [number, number];
export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue';
export const CURVE_KEYS = { rgb: 'curveRgb', red: 'curveRed', green: 'curveGreen', blue: 'curveBlue' } as const;
export type CurveKey = (typeof CURVE_KEYS)[CurveChannel];

type HslKey = `hue${Band}` | `sat${Band}` | `lum${Band}`;
type GradeRange = 'Shadow' | 'Mid' | 'High' | 'Global';
type GradeKey = `grade${GradeRange}${'Hue' | 'Sat' | 'Lum'}` | 'gradeBlending' | 'gradeBalance';

export type NumericKey =
  | 'temp'
  | 'tint'
  | 'exposure'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'texture'
  | 'clarity'
  | 'dehaze'
  | 'vibrance'
  | 'saturation'
  | HslKey
  | GradeKey
  | 'sharpenAmount'
  | 'sharpenRadius'
  | 'sharpenDetail'
  | 'sharpenMasking'
  | 'nrLuminance'
  | 'nrDetail'
  | 'nrColor'
  | 'vignetteAmount'
  | 'vignetteMidpoint'
  | 'vignetteRoundness'
  | 'vignetteFeather'
  | 'grainAmount'
  | 'grainSize'
  | 'grainRoughness'
  | 'straighten'
  | 'cropX'
  | 'cropY'
  | 'cropW'
  | 'cropH'
  | 'rotate';

export type DevelopSettings = Record<NumericKey, number> & {
  treatment: Treatment;
  curveRgb: CurvePoint[];
  curveRed: CurvePoint[];
  curveGreen: CurvePoint[];
  curveBlue: CurvePoint[];
  /** Crop aspect lock: 'free', 'original' or 'w:h'. */
  cropAspect: string;
  flipH: boolean;
  flipV: boolean;
};

export type SettingsKey = keyof DevelopSettings;
export type PartialSettings = Partial<DevelopSettings>;

/** Copy/paste, preset and reset groups (like Lightroom's "Copy Settings" dialog). */
export type GroupId =
  | 'treatment'
  | 'wb'
  | 'tone'
  | 'presence'
  | 'curve'
  | 'hsl'
  | 'grading'
  | 'detail'
  | 'effects'
  | 'transform';

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'treatment', label: 'Treatment (Color / B&W)' },
  { id: 'wb', label: 'White Balance' },
  { id: 'tone', label: 'Basic Tone' },
  { id: 'presence', label: 'Presence' },
  { id: 'curve', label: 'Tone Curve' },
  { id: 'hsl', label: 'HSL / Color' },
  { id: 'grading', label: 'Color Grading' },
  { id: 'detail', label: 'Detail' },
  { id: 'effects', label: 'Effects' },
  { id: 'transform', label: 'Transform & Crop' },
];

/** Right-panel sections and the groups they reset. */
export type SectionId = 'basic' | 'curve' | 'hsl' | 'grading' | 'detail' | 'effects' | 'transform';
export const SECTION_GROUPS: Record<SectionId, GroupId[]> = {
  basic: ['treatment', 'wb', 'tone', 'presence'],
  curve: ['curve'],
  hsl: ['hsl'],
  grading: ['grading'],
  detail: ['detail'],
  effects: ['effects'],
  transform: ['transform'],
};

export interface ParamDef {
  min: number;
  max: number;
  step: number;
  def: number;
  /** English label (translated in the UI). */
  label: string;
  group: GroupId;
  /** Number of decimals shown. */
  decimals?: number;
  unit?: string;
  /** Hidden from generic slider UIs (crop rect, rotation). */
  hidden?: boolean;
}

const p = (label: string, group: GroupId, min: number, max: number, def = 0, step = 1, extra: Partial<ParamDef> = {}): ParamDef => ({
  label,
  group,
  min,
  max,
  def,
  step,
  ...extra,
});

function hslParams(): Record<HslKey, ParamDef> {
  const out = {} as Record<HslKey, ParamDef>;
  for (const band of BANDS) {
    out[`hue${band}`] = p(`${band} Hue`, 'hsl', -100, 100);
    out[`sat${band}`] = p(`${band} Saturation`, 'hsl', -100, 100);
    out[`lum${band}`] = p(`${band} Luminance`, 'hsl', -100, 100);
  }
  return out;
}

function gradeParams(): Record<GradeKey, ParamDef> {
  const names: Record<GradeRange, string> = { Shadow: 'Shadows', Mid: 'Midtones', High: 'Highlights', Global: 'Global' };
  const out = {} as Record<GradeKey, ParamDef>;
  for (const range of Object.keys(names) as GradeRange[]) {
    out[`grade${range}Hue`] = p(`${names[range]} Hue`, 'grading', 0, 360, 0, 1, { unit: '°' });
    out[`grade${range}Sat`] = p(`${names[range]} Saturation`, 'grading', 0, 100);
    out[`grade${range}Lum`] = p(`${names[range]} Luminance`, 'grading', -100, 100);
  }
  out.gradeBlending = p('Blending', 'grading', 0, 100, 50);
  out.gradeBalance = p('Balance', 'grading', -100, 100);
  return out;
}

export const PARAMS: Record<NumericKey, ParamDef> = {
  temp: p('Temp', 'wb', -100, 100),
  tint: p('Tint', 'wb', -100, 100),
  exposure: p('Exposure', 'tone', -5, 5, 0, 0.01, { decimals: 2, unit: 'EV' }),
  contrast: p('Contrast', 'tone', -100, 100),
  highlights: p('Highlights', 'tone', -100, 100),
  shadows: p('Shadows', 'tone', -100, 100),
  whites: p('Whites', 'tone', -100, 100),
  blacks: p('Blacks', 'tone', -100, 100),
  texture: p('Texture', 'presence', -100, 100),
  clarity: p('Clarity', 'presence', -100, 100),
  dehaze: p('Dehaze', 'presence', -100, 100),
  vibrance: p('Vibrance', 'presence', -100, 100),
  saturation: p('Saturation', 'presence', -100, 100),
  ...hslParams(),
  ...gradeParams(),
  sharpenAmount: p('Amount', 'detail', 0, 150),
  sharpenRadius: p('Radius', 'detail', 0.5, 3, 1, 0.1, { decimals: 1, unit: 'px' }),
  sharpenDetail: p('Detail', 'detail', 0, 100, 25),
  sharpenMasking: p('Masking', 'detail', 0, 100),
  nrLuminance: p('Luminance', 'detail', 0, 100),
  nrDetail: p('Luminance Detail', 'detail', 0, 100, 50),
  nrColor: p('Color', 'detail', 0, 100),
  vignetteAmount: p('Amount', 'effects', -100, 100),
  vignetteMidpoint: p('Midpoint', 'effects', 0, 100, 50),
  vignetteRoundness: p('Roundness', 'effects', -100, 100),
  vignetteFeather: p('Feather', 'effects', 0, 100, 50),
  grainAmount: p('Amount', 'effects', 0, 100),
  grainSize: p('Size', 'effects', 0, 100, 25),
  grainRoughness: p('Roughness', 'effects', 0, 100, 50),
  straighten: p('Straighten', 'transform', -45, 45, 0, 0.1, { decimals: 1, unit: '°' }),
  cropX: p('Crop X', 'transform', 0, 1, 0, 0.001, { hidden: true, decimals: 3 }),
  cropY: p('Crop Y', 'transform', 0, 1, 0, 0.001, { hidden: true, decimals: 3 }),
  cropW: p('Crop Width', 'transform', 0.01, 1, 1, 0.001, { hidden: true, decimals: 3 }),
  cropH: p('Crop Height', 'transform', 0.01, 1, 1, 0.001, { hidden: true, decimals: 3 }),
  rotate: p('Rotate', 'transform', 0, 3, 0, 1, { hidden: true }),
};

export const NUMERIC_KEYS = Object.keys(PARAMS) as NumericKey[];

/** Keys of the non-numeric settings and their group. */
const OTHER_GROUPS: Record<Exclude<SettingsKey, NumericKey>, GroupId> = {
  treatment: 'treatment',
  curveRgb: 'curve',
  curveRed: 'curve',
  curveGreen: 'curve',
  curveBlue: 'curve',
  cropAspect: 'transform',
  flipH: 'transform',
  flipV: 'transform',
};

export const ALL_KEYS: SettingsKey[] = [...NUMERIC_KEYS, ...(Object.keys(OTHER_GROUPS) as SettingsKey[])];

export function groupOf(key: SettingsKey): GroupId {
  return (PARAMS as Record<string, ParamDef>)[key]?.group ?? OTHER_GROUPS[key as Exclude<SettingsKey, NumericKey>];
}

export function keysOfGroups(groups: GroupId[]): SettingsKey[] {
  const set = new Set(groups);
  return ALL_KEYS.filter((k) => set.has(groupOf(k)));
}

export function isNumericKey(key: string): key is NumericKey {
  return Object.prototype.hasOwnProperty.call(PARAMS, key);
}

export function identityCurve(): CurvePoint[] {
  return [
    [0, 0],
    [1, 1],
  ];
}

export function defaultSettings(): DevelopSettings {
  const out = {} as DevelopSettings;
  for (const key of NUMERIC_KEYS) out[key] = PARAMS[key].def;
  out.treatment = 'color';
  out.curveRgb = identityCurve();
  out.curveRed = identityCurve();
  out.curveGreen = identityCurve();
  out.curveBlue = identityCurve();
  out.cropAspect = 'original';
  out.flipH = false;
  out.flipV = false;
  return out;
}

export const DEFAULT_SETTINGS: Readonly<DevelopSettings> = Object.freeze(defaultSettings());

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Clamps (and rounds to the slider step where sensible) a numeric parameter. */
export function clampParam(key: NumericKey, value: number): number {
  const def = PARAMS[key];
  if (!Number.isFinite(value)) return def.def;
  if (key === 'rotate') return ((Math.round(value) % 4) + 4) % 4;
  let v = clamp(value, def.min, def.max);
  if (def.step >= 1) v = Math.round(v);
  else v = Math.round(v * 1000) / 1000;
  return v;
}

/** Validates a list of curve points (sorted by x, clamped, 2..16 points, unique x). */
export function sanitizeCurve(input: unknown): CurvePoint[] {
  if (!Array.isArray(input)) return identityCurve();
  const pts: CurvePoint[] = [];
  for (const item of input) {
    let x: number;
    let y: number;
    if (Array.isArray(item) && item.length >= 2) {
      x = Number(item[0]);
      y = Number(item[1]);
    } else if (item && typeof item === 'object') {
      x = Number((item as { x?: unknown }).x);
      y = Number((item as { y?: unknown }).y);
    } else continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push([clamp(x, 0, 1), clamp(y, 0, 1)]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const unique: CurvePoint[] = [];
  for (const pt of pts) {
    const last = unique[unique.length - 1];
    if (last && Math.abs(last[0] - pt[0]) < 1e-4) unique[unique.length - 1] = pt;
    else unique.push(pt);
  }
  if (unique.length < 2) return identityCurve();
  return unique.slice(0, 16);
}

export function curveIsIdentity(points: CurvePoint[]): boolean {
  return points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 1 && points[1][1] === 1;
}

/** Keeps the crop rectangle inside the frame and at least 1% in size. */
export function sanitizeCrop(s: DevelopSettings): void {
  s.cropW = clamp(s.cropW, 0.01, 1);
  s.cropH = clamp(s.cropH, 0.01, 1);
  s.cropX = clamp(s.cropX, 0, 1 - s.cropW);
  s.cropY = clamp(s.cropY, 0, 1 - s.cropH);
}

export const ASPECT_PRESETS = ['original', 'free', '1:1', '4:5', '5:7', '2:3', '3:4', '16:9', '9:16', '4:3', '3:2', '5:4', '7:5'] as const;

export function sanitizeAspect(value: unknown): string {
  if (typeof value !== 'string') return 'original';
  const v = value.trim().toLowerCase();
  if (v === 'original' || v === 'free' || v === 'as shot') return v === 'as shot' ? 'original' : v;
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(v);
  if (!m) return 'original';
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (!(a > 0 && b > 0) || a / b > 20 || b / a > 20) return 'original';
  return `${+a.toFixed(3)}:${+b.toFixed(3)}`;
}

/** Applies a partial settings object (preset, paste, AI) after validating every field. */
export function mergeSettings(base: DevelopSettings, patch: unknown): DevelopSettings {
  const out: DevelopSettings = { ...base };
  if (!patch || typeof patch !== 'object') return out;
  const src = patch as Record<string, unknown>;
  for (const [key, value] of Object.entries(src)) {
    if (isNumericKey(key)) {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
      if (Number.isFinite(n)) out[key] = clampParam(key, n);
    } else if (key === 'treatment') {
      if (value === 'color' || value === 'bw') out.treatment = value;
      else if (value === 'blackAndWhite' || value === 'monochrome' || value === 'black & white') out.treatment = 'bw';
    } else if (key === 'curveRgb' || key === 'curveRed' || key === 'curveGreen' || key === 'curveBlue') {
      out[key] = sanitizeCurve(value);
    } else if (key === 'cropAspect') {
      out.cropAspect = sanitizeAspect(value);
    } else if (key === 'flipH' || key === 'flipV') {
      if (typeof value === 'boolean') out[key] = value;
    }
  }
  sanitizeCrop(out);
  return out;
}

/** Builds complete, valid settings from anything (catalog file, storage). */
export function sanitizeSettings(input: unknown): DevelopSettings {
  return mergeSettings(defaultSettings(), input);
}

function valueEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => valueEqual(v, b[i]));
  }
  return a === b;
}

/** Keys whose values differ between two settings objects. */
export function diffKeys(a: DevelopSettings, b: DevelopSettings): SettingsKey[] {
  return ALL_KEYS.filter((k) => !valueEqual(a[k], b[k]));
}

export function settingsEqual(a: DevelopSettings, b: DevelopSettings): boolean {
  return a === b || diffKeys(a, b).length === 0;
}

/** True when the photo has any develop adjustment (geometry included). */
export function isEdited(s: DevelopSettings): boolean {
  return diffKeys(s, DEFAULT_SETTINGS as DevelopSettings).length > 0;
}

/** Only the settings that differ from the defaults (compact form for AI context / presets). */
export function nonDefault(s: DevelopSettings): PartialSettings {
  const out: Record<string, unknown> = {};
  for (const key of diffKeys(s, DEFAULT_SETTINGS as DevelopSettings)) out[key] = s[key];
  return out as PartialSettings;
}

/** Subset of `s` limited to the given groups. */
export function pickGroups(s: DevelopSettings, groups: GroupId[]): PartialSettings {
  const out: Record<string, unknown> = {};
  for (const key of keysOfGroups(groups)) {
    const v = s[key];
    out[key] = Array.isArray(v) ? v.map((pt) => [...pt]) : v;
  }
  return out as PartialSettings;
}

/** Resets the given groups to their defaults. */
export function resetGroups(s: DevelopSettings, groups: GroupId[]): DevelopSettings {
  return mergeSettings(s, pickGroups(defaultSettings(), groups));
}

export function paramLabel(key: SettingsKey): string {
  if (isNumericKey(key)) return PARAMS[key].label;
  switch (key) {
    case 'treatment':
      return 'Treatment';
    case 'curveRgb':
    case 'curveRed':
    case 'curveGreen':
    case 'curveBlue':
      return 'Tone Curve';
    case 'cropAspect':
      return 'Aspect';
    case 'flipH':
    case 'flipV':
      return 'Flip';
    default:
      return String(key);
  }
}

/** History label for a change ("Exposure", "Crop", or "Edit" when many groups changed). */
export function describeChange(before: DevelopSettings, after: DevelopSettings): string {
  const keys = diffKeys(before, after);
  if (!keys.length) return 'Edit';
  if (keys.length === 1) return paramLabel(keys[0]);
  const groups = new Set(keys.map(groupOf));
  if (groups.size === 1) {
    const g = [...groups][0];
    if (g === 'transform') return keys.some((k) => k.startsWith('crop')) ? 'Crop' : 'Transform';
    return GROUPS.find((x) => x.id === g)?.label ?? 'Edit';
  }
  return 'Edit';
}

export function formatParam(key: NumericKey, value: number): string {
  const def = PARAMS[key];
  if (def.decimals) {
    const s = value.toFixed(def.decimals);
    return def.min < 0 && value > 0 ? `+${s}` : s;
  }
  const r = Math.round(value);
  if (def.unit === '°') return `${r}°`;
  return def.min < 0 && r > 0 ? `+${r}` : String(r);
}

/** Pixel aspect ratio for an aspect preset ('original' uses the image's own ratio). */
export function aspectRatioOf(aspect: string, imageW: number, imageH: number): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return imageW > 0 && imageH > 0 ? imageW / imageH : null;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  if (!m) return null;
  return parseFloat(m[1]) / parseFloat(m[2]);
}
