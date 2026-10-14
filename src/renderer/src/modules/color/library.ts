/**
 * Saved palettes (localStorage). The search/filter helpers are pure and unit tested.
 */
import { uid } from '../../core/utils/id';
import { normalizeHex } from './colormath';

export interface SavedPalette {
  id: string;
  name: string;
  tags: string[];
  colors: { hex: string; name?: string }[];
  createdAt: number;
  updatedAt: number;
}

const KEY = 'ultima-color-library';
export const LIBRARY_LIMIT = 500;

export function sanitizeLibrary(input: unknown): SavedPalette[] {
  if (!Array.isArray(input)) return [];
  const out: SavedPalette[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const colors = Array.isArray(r.colors)
      ? r.colors
          .map((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            const hex = normalizeHex(o.hex);
            return hex ? { hex, name: typeof o.name === 'string' && o.name ? o.name : undefined } : null;
          })
          .filter((c): c is { hex: string; name: string | undefined } => Boolean(c))
      : [];
    if (!colors.length) continue;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : uid('pal'),
      name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 120) : 'Palette',
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').slice(0, 20) : [],
      colors,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    });
  }
  return out.slice(0, LIBRARY_LIMIT);
}

export function loadLibrary(): SavedPalette[] {
  try {
    return sanitizeLibrary(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

/** Returns false when the browser storage is full. */
export function storeLibrary(list: SavedPalette[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIBRARY_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,#\n]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .map((t) => t.slice(0, 40)),
    ),
  ].slice(0, 20);
}

/**
 * Filters palettes by a free text query: every word must match the name, a tag, a color
 * name or a hex code ("#1e5" style prefixes work too). Most recently updated first.
 */
export function searchLibrary(list: SavedPalette[], query: string): SavedPalette[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!words.length) return sorted;
  return sorted.filter((p) => {
    const hay = [p.name, ...p.tags, ...p.colors.map((c) => c.name ?? '')].join(' ').toLowerCase();
    const hexes = p.colors.map((c) => c.hex.toLowerCase());
    return words.every((w) => {
      if (/^#?[0-9a-f]{3,6}$/.test(w) && hexes.some((h) => h.startsWith(w.startsWith('#') ? w : `#${w}`))) return true;
      return hay.includes(w.replace(/^#/, ''));
    });
  });
}

export function duplicatePalette(p: SavedPalette, copySuffix = 'copy'): SavedPalette {
  const now = Date.now();
  return { ...p, id: uid('pal'), name: `${p.name} ${copySuffix}`.slice(0, 120), colors: p.colors.map((c) => ({ ...c })), tags: [...p.tags], createdAt: now, updatedAt: now };
}
