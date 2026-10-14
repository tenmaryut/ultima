/**
 * Built-in looks + user presets (stored in localStorage). A preset is a partial
 * settings object; applying it only touches the parameters it contains.
 */
import { create } from 'zustand';
import {
  defaultSettings,
  keysOfGroups,
  mergeSettings,
  sanitizeSettings,
  type CurvePoint,
  type DevelopSettings,
  type GroupId,
  type PartialSettings,
} from './params';

export interface Preset {
  id: string;
  /** English name for built-ins (translated in the UI), user text for user presets. */
  name: string;
  category: 'Color' | 'B&W' | 'Creative' | 'User';
  settings: PartialSettings;
  /** "Auto" runs Auto Tone on the photo instead of fixed values. */
  auto?: boolean;
  builtin?: boolean;
}

const curve = (...pts: CurvePoint[]): CurvePoint[] => pts;

/** Completes a look: color treatment by default, and whole groups for curves / grading. */
function look(partial: PartialSettings): PartialSettings {
  const out: PartialSettings = { treatment: 'color', ...partial };
  const defaults = defaultSettings();
  const fill = (group: GroupId) => {
    const keys = keysOfGroups([group]);
    if (keys.some((k) => k in partial)) for (const k of keys) if (!(k in out)) (out as Record<string, unknown>)[k] = defaults[k];
  };
  fill('curve');
  fill('grading');
  return out;
}

function builtin(id: string, name: string, category: Preset['category'], settings: PartialSettings, auto = false): Preset {
  return { id: `builtin:${id}`, name, category, settings: look(settings), auto, builtin: true };
}

export const BUILTIN_PRESETS: Preset[] = [
  builtin('auto', 'Auto', 'Color', {}, true),
  builtin('vivid', 'Vivid', 'Color', {
    contrast: 20,
    highlights: -10,
    shadows: 10,
    whites: 10,
    blacks: -10,
    clarity: 10,
    dehaze: 5,
    vibrance: 35,
    saturation: 10,
  }),
  builtin('matte', 'Matte', 'Creative', {
    contrast: -15,
    highlights: -15,
    saturation: -10,
    curveRgb: curve([0, 0.08], [0.25, 0.25], [0.75, 0.77], [1, 0.94]),
  }),
  builtin('bw-classic', 'B&W Classic', 'B&W', {
    treatment: 'bw',
    contrast: 15,
    highlights: -10,
    shadows: 10,
    clarity: 10,
    lumRed: 10,
    lumOrange: 15,
    lumYellow: 5,
    lumAqua: -10,
    lumBlue: -15,
  }),
  builtin('bw-high-contrast', 'B&W High Contrast', 'B&W', {
    treatment: 'bw',
    contrast: 50,
    highlights: -20,
    shadows: -10,
    whites: 25,
    blacks: -30,
    clarity: 30,
    lumOrange: 20,
    lumYellow: 10,
    lumAqua: -30,
    lumBlue: -40,
    curveRgb: curve([0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]),
    grainAmount: 15,
  }),
  builtin('film-warm', 'Film Warm', 'Creative', {
    temp: 18,
    tint: 4,
    contrast: 10,
    highlights: -15,
    shadows: 10,
    vibrance: 10,
    saturation: -5,
    curveRgb: curve([0, 0.05], [0.3, 0.28], [0.7, 0.74], [1, 0.96]),
    gradeShadowHue: 30,
    gradeShadowSat: 12,
    gradeHighHue: 45,
    gradeHighSat: 15,
    grainAmount: 20,
    grainSize: 30,
    vignetteAmount: -12,
  }),
  builtin('film-cool', 'Film Cool', 'Creative', {
    temp: -15,
    tint: -4,
    contrast: 8,
    saturation: -10,
    curveRgb: curve([0, 0.05], [0.5, 0.5], [1, 0.95]),
    gradeShadowHue: 200,
    gradeShadowSat: 15,
    gradeHighHue: 50,
    gradeHighSat: 6,
    grainAmount: 15,
  }),
  builtin('teal-orange', 'Cinematic Teal & Orange', 'Creative', {
    contrast: 20,
    highlights: -20,
    shadows: 15,
    vibrance: 15,
    hueOrange: -5,
    satOrange: 15,
    lumOrange: 10,
    hueGreen: 35,
    satGreen: -20,
    satAqua: 15,
    satBlue: 10,
    curveRgb: curve([0, 0.02], [0.25, 0.22], [0.75, 0.78], [1, 1]),
    gradeShadowHue: 195,
    gradeShadowSat: 35,
    gradeMidHue: 200,
    gradeMidSat: 6,
    gradeHighHue: 35,
    gradeHighSat: 30,
    gradeBlending: 60,
    gradeBalance: -10,
    vignetteAmount: -15,
  }),
  builtin('vintage-fade', 'Vintage Fade', 'Creative', {
    temp: 10,
    contrast: -20,
    saturation: -25,
    curveRgb: curve([0, 0.12], [0.25, 0.28], [0.75, 0.72], [1, 0.9]),
    curveBlue: curve([0, 0.12], [1, 0.88]),
    gradeShadowHue: 220,
    gradeShadowSat: 10,
    gradeHighHue: 50,
    gradeHighSat: 20,
    grainAmount: 25,
    grainSize: 40,
    vignetteAmount: -20,
  }),
  builtin('portrait-soft', 'Portrait Soft', 'Color', {
    temp: 5,
    highlights: -10,
    shadows: 15,
    texture: -25,
    clarity: -15,
    vibrance: 10,
    saturation: -5,
    lumOrange: 10,
    satOrange: -10,
  }),
  builtin('landscape-punch', 'Landscape Punch', 'Color', {
    contrast: 15,
    highlights: -40,
    shadows: 35,
    whites: 15,
    blacks: -15,
    clarity: 25,
    dehaze: 15,
    vibrance: 30,
    satGreen: 10,
    satBlue: 10,
    lumBlue: -15,
    sharpenAmount: 40,
  }),
  builtin('moody-dark', 'Moody Dark', 'Creative', {
    temp: -5,
    exposure: -0.35,
    contrast: 15,
    highlights: -30,
    shadows: -10,
    whites: -10,
    blacks: -20,
    clarity: 10,
    vibrance: -5,
    saturation: -20,
    curveRgb: curve([0, 0.04], [0.5, 0.47], [1, 0.95]),
    gradeShadowHue: 210,
    gradeShadowSat: 15,
    gradeHighHue: 40,
    gradeHighSat: 10,
    vignetteAmount: -30,
    vignetteMidpoint: 40,
  }),
  builtin('bright-airy', 'Bright & Airy', 'Color', {
    temp: 4,
    tint: 3,
    exposure: 0.45,
    contrast: -15,
    highlights: -25,
    shadows: 35,
    whites: 15,
    blacks: 10,
    clarity: -10,
    vibrance: 10,
    saturation: -10,
    lumOrange: 10,
    lumYellow: 10,
    lumBlue: 10,
    gradeHighHue: 45,
    gradeHighSat: 6,
  }),
  builtin('sepia', 'Sepia', 'B&W', {
    treatment: 'bw',
    contrast: 10,
    curveRgb: curve([0, 0.04], [1, 0.97]),
    gradeShadowHue: 30,
    gradeShadowSat: 35,
    gradeMidHue: 35,
    gradeMidSat: 25,
    gradeHighHue: 45,
    gradeHighSat: 20,
    grainAmount: 10,
    vignetteAmount: -15,
  }),
  builtin('golden-hour', 'Golden Hour', 'Creative', {
    temp: 25,
    tint: 6,
    highlights: -15,
    shadows: 10,
    vibrance: 15,
    gradeShadowHue: 20,
    gradeShadowSat: 10,
    gradeHighHue: 40,
    gradeHighSat: 25,
  }),
  builtin('crisp-clean', 'Crisp & Clean', 'Color', {
    contrast: 10,
    texture: 15,
    clarity: 15,
    vibrance: 10,
    sharpenAmount: 50,
    sharpenRadius: 1,
    nrColor: 25,
  }),
  builtin('cross-process', 'Cross Process', 'Creative', {
    vibrance: 20,
    curveRed: curve([0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]),
    curveGreen: curve([0, 0], [0.25, 0.22], [0.75, 0.8], [1, 1]),
    curveBlue: curve([0, 0.18], [1, 0.8]),
  }),
];

/* ------------------------------- User presets ------------------------------ */

const STORAGE_KEY = 'ultima-develop-presets';

function readStorage(): Preset[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return parseUserPresets(list);
  } catch {
    return [];
  }
}

/** Validates presets read from storage or a catalog. */
export function parseUserPresets(list: unknown): Preset[] {
  if (!Array.isArray(list)) return [];
  const out: Preset[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { id, name, settings } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || !settings || typeof settings !== 'object') continue;
    // keep only valid keys that were present in the stored preset
    const clean = sanitizeSettings(settings);
    const partial: Record<string, unknown> = {};
    for (const key of Object.keys(settings as object)) if (key in clean) partial[key] = clean[key as keyof DevelopSettings];
    out.push({
      id: typeof id === 'string' && id.startsWith('user:') ? id : `user:${Date.now().toString(36)}${out.length}`,
      name: name.trim().slice(0, 80),
      category: 'User',
      settings: partial as PartialSettings,
    });
  }
  return out;
}

function writeStorage(list: Preset[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map(({ id, name, settings }) => ({ id, name, settings }))));
    return true;
  } catch {
    return false;
  }
}

interface PresetStore {
  user: Preset[];
  add: (name: string, settings: PartialSettings) => Preset;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  replace: (list: Preset[]) => void;
}

export const usePresetStore = create<PresetStore>((set, get) => ({
  user: readStorage(),
  add: (name, settings) => {
    const preset: Preset = { id: `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 80), category: 'User', settings };
    const user = [...get().user, preset];
    writeStorage(user);
    set({ user });
    return preset;
  },
  rename: (id, name) => {
    const user = get().user.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 80) || p.name } : p));
    writeStorage(user);
    set({ user });
  },
  remove: (id) => {
    const user = get().user.filter((p) => p.id !== id);
    writeStorage(user);
    set({ user });
  },
  replace: (list) => {
    writeStorage(list);
    set({ user: list });
  },
}));

export function allPresets(): Preset[] {
  return [...BUILTIN_PRESETS, ...usePresetStore.getState().user];
}

/** Finds a preset by id or (case-insensitive, punctuation-insensitive) name. */
export function findPreset(nameOrId: string, list: Preset[] = allPresets()): Preset | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const n = norm(nameOrId);
  return list.find((p) => p.id === nameOrId) ?? list.find((p) => norm(p.name) === n) ?? list.find((p) => n.length >= 3 && norm(p.name).includes(n));
}

/** Applies a (non-auto) preset to settings. */
export function applyPresetSettings(settings: DevelopSettings, preset: Preset): DevelopSettings {
  return mergeSettings(settings, preset.settings);
}
