/**
 * Catalog (.ultima) format: per-photo develop settings, ratings, flags and labels keyed
 * by file name, optionally with the photos embedded as data URLs. Pure helpers; the
 * catalog is assembled as string parts so large embedded photos never have to be
 * concatenated into one giant string.
 */
import { nonDefault, sanitizeSettings, type DevelopSettings } from './params';
import { LABELS, type ColorLabel, type Flag } from './types';

export const CATALOG_VERSION = 1;
/** Photos are embedded only when their total size is below this. */
export const EMBED_LIMIT_BYTES = 300 * 1024 * 1024;

export interface CatalogRecord {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  copyIndex: number;
  masterId?: string;
  rating: number;
  flag: Flag;
  label: ColorLabel | null;
  settings: DevelopSettings;
  addedAt: number;
  /** data: URL of the embedded photo (masters only). */
  data?: string;
}

export interface CatalogHeader {
  name: string;
  activeId?: string | null;
  selected?: string[];
}

export interface ParsedCatalog extends CatalogHeader {
  embedded: boolean;
  records: CatalogRecord[];
}

type RecordMeta = Omit<CatalogRecord, 'data' | 'settings'> & { settings: Partial<DevelopSettings> };

export function recordMeta(r: Omit<CatalogRecord, 'data'>): RecordMeta {
  const meta: RecordMeta = {
    id: r.id,
    name: r.name,
    size: r.size,
    lastModified: r.lastModified,
    copyIndex: r.copyIndex,
    rating: r.rating,
    flag: r.flag,
    label: r.label,
    settings: nonDefault(r.settings),
    addedAt: r.addedAt,
  };
  if (r.masterId) meta.masterId = r.masterId;
  return meta;
}

/**
 * JSON text of a catalog as a list of parts (strings or Blobs). An embedded photo's
 * base64 text is passed through untouched (it may be a Blob of base64 text) so huge
 * photos never have to be concatenated into one string.
 */
export function serializeCatalog<B = never>(
  header: CatalogHeader,
  records: { record: Omit<CatalogRecord, 'data'>; data?: { mime: string; base64: string | B } }[],
): (string | B)[] {
  const embedded = records.some((r) => r.data);
  const head = JSON.stringify({
    app: 'ultima',
    module: 'develop',
    version: CATALOG_VERSION,
    name: header.name,
    savedAt: new Date().toISOString(),
    embedded,
    activeId: header.activeId ?? null,
    selected: header.selected ?? [],
  });
  const parts: (string | B)[] = [head.slice(0, -1), ',"photos":['];
  records.forEach((item, i) => {
    const meta = JSON.stringify(recordMeta(item.record));
    if (i > 0) parts.push(',');
    if (item.data && /^[\w.+-]+\/[\w.+-]+$/.test(item.data.mime)) {
      parts.push(meta.slice(0, -1), `,"data":"data:${item.data.mime};base64,`, item.data.base64, '"}');
    } else {
      parts.push(meta);
    }
  });
  parts.push(']}');
  return parts;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** Parses and validates catalog JSON. Throws on anything that isn't a develop catalog. */
export function parseCatalog(input: unknown): ParsedCatalog {
  const doc = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!doc || typeof doc !== 'object') throw new Error('Not an Ultima catalog');
  const d = doc as Record<string, unknown>;
  if (d.app !== 'ultima' || d.module !== 'develop') throw new Error('This file is not a Photo Develop catalog');
  if (typeof d.version === 'number' && d.version > CATALOG_VERSION) throw new Error('This catalog was made by a newer version of Ultima');
  const list = Array.isArray(d.photos) ? d.photos : [];
  const records: CatalogRecord[] = [];
  const ids = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const name = str(p.name).trim();
    if (!name) continue;
    let id = str(p.id) || `p${records.length}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    const flag: Flag = p.flag === 'pick' || p.flag === 'reject' ? p.flag : null;
    const label = LABELS.includes(p.label as ColorLabel) ? (p.label as ColorLabel) : null;
    const data = typeof p.data === 'string' && p.data.startsWith('data:') ? p.data : undefined;
    records.push({
      id,
      name: name.slice(0, 260),
      size: Math.max(0, num(p.size, 0)),
      lastModified: num(p.lastModified, 0),
      copyIndex: Math.max(0, Math.round(num(p.copyIndex, 0))),
      masterId: typeof p.masterId === 'string' ? p.masterId : undefined,
      rating: Math.max(0, Math.min(5, Math.round(num(p.rating, 0)))),
      flag,
      label,
      settings: sanitizeSettings(p.settings),
      addedAt: num(p.addedAt, Date.now()),
      data,
    });
  }
  // virtual copies must point at a master that exists
  for (const r of records) if (r.masterId && !ids.has(r.masterId)) delete r.masterId;
  return {
    name: str(d.name, 'Catalog').slice(0, 120) || 'Catalog',
    embedded: Boolean(d.embedded) || records.some((r) => r.data),
    activeId: typeof d.activeId === 'string' ? d.activeId : null,
    selected: Array.isArray(d.selected) ? d.selected.filter((s): s is string => typeof s === 'string') : [],
    records,
  };
}

/**
 * Pairs re-imported files with catalog records by file name (case-insensitive),
 * preferring an exact size match. Returns record index → file index.
 */
export function matchFiles(records: { name: string; size: number }[], files: { name: string; size: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  const used = new Set<number>();
  const key = (n: string) => n.trim().toLowerCase();
  // exact name + size first, then name only
  for (const pass of [true, false]) {
    records.forEach((r, ri) => {
      if (out.has(ri)) return;
      const fi = files.findIndex((f, i) => !used.has(i) && key(f.name) === key(r.name) && (!pass || !r.size || f.size === r.size));
      if (fi >= 0) {
        out.set(ri, fi);
        used.add(fi);
      }
    });
  }
  return out;
}
