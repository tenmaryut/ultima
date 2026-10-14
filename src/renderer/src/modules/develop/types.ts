/** Library data model + pure filtering/sorting helpers. */
import type { ExifInfo } from './exif';
import type { DevelopSettings } from './params';
import { isEdited } from './params';

export type Flag = 'pick' | 'reject' | null;
export type ColorLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export const LABELS: ColorLabel[] = ['red', 'yellow', 'green', 'blue', 'purple'];
/** Display colors of the color labels (content colors, same in both themes). */
export const LABEL_COLORS: Record<ColorLabel, string> = {
  red: '#e5484d',
  yellow: '#f5c518',
  green: '#30a46c',
  blue: '#3e8ef7',
  purple: '#9b59d0',
};

/**
 * image       – decodable by the browser (JPEG, PNG, WebP, AVIF, GIF, BMP)
 * tiff        – decoded by our TIFF decoder
 * raw         – RAW file; `source` is its embedded JPEG preview
 * unsupported – can't be decoded (RAW without preview, HEIC, …)
 * missing     – listed in a catalog, file not re-imported yet
 */
export type SourceKind = 'image' | 'tiff' | 'raw' | 'unsupported' | 'missing';

export interface Photo {
  id: string;
  name: string;
  /** 0 = master, n = virtual copy number. */
  copyIndex: number;
  masterId?: string;
  file: File | null;
  /** What gets decoded: the file itself or the embedded JPEG of a RAW file. */
  source: Blob | null;
  kind: SourceKind;
  /** Orientation (EXIF 1–8) to apply after decoding (RAW/TIFF containers only). */
  orientation: number;
  size: number;
  lastModified: number;
  /** Pixel size of the decoded (oriented) image; 0 while unknown. */
  width: number;
  height: number;
  exif: ExifInfo | null;
  /** Capture time (EXIF) or file date, ms. */
  captureDate: number;
  rating: number;
  flag: Flag;
  label: ColorLabel | null;
  settings: DevelopSettings;
  /** Object URL of the unedited thumbnail. */
  thumb?: string;
  /** Object URL of the thumbnail rendered with the develop settings. */
  devThumb?: string;
  thumbState: 'idle' | 'loading' | 'ready' | 'error';
  /** Friendly problem description (unsupported format, decode failure). */
  error?: string;
  /** Extra info, e.g. "Embedded JPEG preview". */
  note?: string;
  addedAt: number;
}

export function displayName(p: Pick<Photo, 'name' | 'copyIndex'>): string {
  return p.copyIndex > 0 ? `${p.name} (${p.copyIndex})` : p.name;
}

export function canDevelop(p: Photo): boolean {
  return Boolean(p.source) && (p.kind === 'image' || p.kind === 'tiff' || p.kind === 'raw');
}

export type FlagFilter = 'all' | 'picked' | 'unflagged' | 'rejected' | 'notRejected';
export type LabelFilter = 'any' | 'none' | ColorLabel;
export type SortKey = 'name' | 'date' | 'rating' | 'added' | 'size';

export interface LibraryFilter {
  /** Minimum/exact/maximum star rating (0 = no rating filter when op is '>='). */
  rating: number;
  ratingOp: '>=' | '=' | '<=';
  flag: FlagFilter;
  label: LabelFilter;
  text: string;
  edited: 'all' | 'edited' | 'unedited';
}

export const DEFAULT_FILTER: LibraryFilter = { rating: 0, ratingOp: '>=', flag: 'all', label: 'any', text: '', edited: 'all' };

export function filterActive(f: LibraryFilter): boolean {
  return !(f.rating === 0 && f.ratingOp === '>=') || f.flag !== 'all' || f.label !== 'any' || f.text.trim() !== '' || f.edited !== 'all';
}

export function matchesFilter(p: Photo, f: LibraryFilter): boolean {
  if (f.ratingOp === '>=' && p.rating < f.rating) return false;
  if (f.ratingOp === '=' && p.rating !== f.rating) return false;
  if (f.ratingOp === '<=' && p.rating > f.rating) return false;
  switch (f.flag) {
    case 'picked':
      if (p.flag !== 'pick') return false;
      break;
    case 'unflagged':
      if (p.flag !== null) return false;
      break;
    case 'rejected':
      if (p.flag !== 'reject') return false;
      break;
    case 'notRejected':
      if (p.flag === 'reject') return false;
      break;
  }
  if (f.label === 'none' && p.label !== null) return false;
  if (f.label !== 'any' && f.label !== 'none' && p.label !== f.label) return false;
  const text = f.text.trim().toLowerCase();
  if (text) {
    const hay = [p.name, p.exif?.make, p.exif?.model, p.exif?.lens].filter(Boolean).join(' ').toLowerCase();
    if (!text.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  if (f.edited !== 'all' && isEdited(p.settings) !== (f.edited === 'edited')) return false;
  return true;
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;

export function comparePhotos(a: Photo, b: Photo, key: SortKey): number {
  let r = 0;
  switch (key) {
    case 'name':
      r = collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name);
      break;
    case 'date':
      r = a.captureDate - b.captureDate;
      break;
    case 'rating':
      r = a.rating - b.rating;
      break;
    case 'added':
      r = a.addedAt - b.addedAt;
      break;
    case 'size':
      r = a.size - b.size;
      break;
  }
  if (r === 0 && key !== 'name') r = collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name);
  if (r === 0) r = a.copyIndex - b.copyIndex;
  return r;
}

export function visiblePhotos(photos: Photo[], filter: LibraryFilter, sort: SortKey, descending: boolean): Photo[] {
  const list = photos.filter((p) => matchesFilter(p, filter));
  list.sort((a, b) => (descending ? -1 : 1) * comparePhotos(a, b, sort));
  return list;
}

/** Selection after a click: plain = only this, toggle = Ctrl/Cmd, range = Shift (from anchor). */
export function nextSelection(
  order: string[],
  selected: string[],
  anchor: string | null,
  id: string,
  mode: 'single' | 'toggle' | 'range',
): string[] {
  if (mode === 'single') return [id];
  if (mode === 'toggle') return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  const a = anchor ? order.indexOf(anchor) : -1;
  const b = order.indexOf(id);
  if (a < 0 || b < 0) return [id];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const range = order.slice(lo, hi + 1);
  const set = new Set([...selected, ...range]);
  return order.filter((x) => set.has(x));
}
