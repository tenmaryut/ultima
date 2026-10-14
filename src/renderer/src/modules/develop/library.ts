/**
 * Library operations with side effects: importing files, the lazy thumbnail queue
 * (plain + "developed" thumbnails), relinking missing originals, virtual copies and
 * removing photos (freeing object URLs and decoded bitmaps).
 */
import { rememberRecent } from '../../core/open';
import { t } from '../../core/i18n';
import { uid } from '../../core/utils/id';
import { fileExtension } from '../../core/utils/format';
import { toast } from '../../components/ui/feedback';
import { matchFiles } from './catalog';
import { estimateAtmosphere } from './color';
import { bitmapPixels, forgetSources, inspectFile, makeThumbnail, peekStats, sourceKeyOf } from './decode';
import { defaultSettings, isEdited, type DevelopSettings } from './params';
import { getRenderer, renderSmall } from './render';
import { addPhotos, getPhoto, patchPhoto, removePhotos, useDevelop } from './store';
import { canDevelop, type Photo } from './types';

/* ---------------------------------- Import ---------------------------------- */

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function photoFromFile(file: File, settings: DevelopSettings = defaultSettings()): Promise<Photo> {
  const info = await inspectFile(file).catch((error: unknown) => ({
    kind: 'unsupported' as const,
    source: null,
    orientation: 1,
    width: 0,
    height: 0,
    exif: null,
    error: error instanceof Error ? error.message : String(error),
    note: undefined,
  }));
  return {
    id: uid('ph'),
    name: file.name,
    copyIndex: 0,
    file,
    source: info.source,
    kind: info.kind,
    orientation: info.orientation,
    size: file.size,
    lastModified: file.lastModified,
    width: info.width,
    height: info.height,
    exif: info.exif,
    captureDate: info.exif?.date ?? file.lastModified,
    rating: 0,
    flag: null,
    label: null,
    settings,
    thumbState: info.kind === 'unsupported' ? 'error' : 'idle',
    error: info.error,
    note: info.note,
    addedAt: Date.now(),
  };
}

/** Imports image files (links them to missing catalog entries with the same name first). */
export async function importFiles(files: File[]): Promise<number> {
  const images = files.filter((f) => fileExtension(f.name) !== 'ultima');
  if (!images.length) return 0;
  const linked = await relinkFiles(images, true);
  const remaining = images.filter((f) => !linked.has(f));
  const s = useDevelop.getState();
  const existing = new Set(s.order.map((id) => s.photos[id]).filter((p) => p && p.file).map((p) => `${p.name}|${p.size}|${p.lastModified}`));
  const fresh = remaining.filter((f) => !existing.has(`${f.name}|${f.size}|${f.lastModified}`));
  const skipped = remaining.length - fresh.length;
  const toastId = fresh.length > 8 ? (toast.info(t('Importing {count} photos…', { count: fresh.length })), 1) : 0;
  void toastId;
  const photos = await mapLimit(fresh, 4, (f) => photoFromFile(f));
  addPhotos(photos);
  photos.slice(0, 10).forEach((p) => p.file && rememberRecent(p.file, 'develop'));
  const bad = photos.filter((p) => p.kind === 'unsupported');
  const raw = photos.filter((p) => p.kind === 'raw');
  if (photos.length) toast.success(t('Imported {count} photo(s)', { count: photos.length }), skipped ? t('{count} already in the library', { count: skipped }) : undefined);
  else if (skipped) toast.info(t('{count} already in the library', { count: skipped }));
  if (raw.length) toast.info(t('{count} RAW file(s): using the embedded JPEG previews', { count: raw.length }), t('For full RAW quality, export them to JPEG or TIFF from your camera software first.'));
  if (bad.length) toast.warning(t('{count} file(s) can’t be edited', { count: bad.length }), bad[0].error ? `${bad[0].name}: ${bad[0].error}` : undefined);
  return photos.length + linked.size;
}

/**
 * Re-attaches files to "missing" photos (catalog opened without embedded photos), by
 * file name. Returns the files that were used.
 */
export async function relinkFiles(files: File[], quiet = false): Promise<Set<File>> {
  const s = useDevelop.getState();
  const missing = s.order.map((id) => s.photos[id]).filter((p) => p && p.kind === 'missing' && !p.masterId);
  const used = new Set<File>();
  if (!missing.length) return used;
  const matches = matchFiles(missing, files);
  await mapLimit([...matches.entries()], 4, async ([ri, fi]) => {
    const target = missing[ri];
    const file = files[fi];
    const fresh = await photoFromFile(file, target.settings);
    used.add(file);
    const patch: Partial<Photo> = {
      file,
      source: fresh.source,
      kind: fresh.kind,
      orientation: fresh.orientation,
      size: file.size,
      lastModified: file.lastModified,
      width: fresh.width,
      height: fresh.height,
      exif: fresh.exif,
      captureDate: fresh.captureDate,
      error: fresh.error,
      note: fresh.note,
      thumbState: fresh.kind === 'unsupported' ? 'error' : 'idle',
    };
    patchPhoto(target.id, patch);
    // virtual copies share the original
    const now = useDevelop.getState();
    const ids = [target.id];
    for (const id of now.order)
      if (now.photos[id]?.masterId === target.id) {
        patchPhoto(id, patch);
        ids.push(id);
      }
    requestThumbs(ids);
  });
  if (used.size) {
    useDevelop.setState({ dirty: true });
    if (!quiet || used.size) toast.success(t('Relinked {count} photo(s)', { count: used.size }));
  }
  return used;
}

export function missingCount(): number {
  const s = useDevelop.getState();
  return s.order.filter((id) => s.photos[id]?.kind === 'missing' && !s.photos[id]?.masterId).length;
}

/* ------------------------------ Virtual copies ------------------------------ */

export function createVirtualCopy(id: string): string | null {
  const s = useDevelop.getState();
  const photo = s.photos[id];
  if (!photo) return null;
  const masterId = photo.masterId ?? photo.id;
  const copyIndex = 1 + Math.max(0, ...s.order.map((pid) => s.photos[pid]).filter((p) => p && (p.masterId ?? p.id) === masterId).map((p) => p.copyIndex));
  const blob = thumbBlobs.get(sourceKeyOf(photo));
  const copy: Photo = {
    ...photo,
    id: uid('ph'),
    masterId,
    copyIndex,
    thumb: blob ? URL.createObjectURL(blob) : undefined,
    devThumb: undefined,
    thumbState: blob ? 'ready' : photo.thumbState === 'error' ? 'error' : 'idle',
    addedAt: Date.now(),
  };
  addPhotos([copy]);
  // keep it next to its original in import order
  useDevelop.setState((st) => {
    const order = st.order.filter((x) => x !== copy.id);
    const at = order.lastIndexOf(order.filter((x) => (st.photos[x]?.masterId ?? x) === masterId).pop() ?? id);
    order.splice(at + 1, 0, copy.id);
    return { order };
  });
  scheduleDevThumb(copy.id);
  return copy.id;
}

/* ---------------------------------- Remove ---------------------------------- */

export function removeFromLibrary(ids: string[]): number {
  const removed = removePhotos(ids);
  const s = useDevelop.getState();
  const stillUsed = new Set(s.order.map((id) => sourceKeyOf(s.photos[id])));
  for (const p of removed) {
    if (p.thumb) URL.revokeObjectURL(p.thumb);
    if (p.devThumb) URL.revokeObjectURL(p.devThumb);
    devTimers.get(p.id) && clearTimeout(devTimers.get(p.id));
  }
  const gone = [...new Set(removed.map(sourceKeyOf))].filter((k) => !stillUsed.has(k));
  gone.forEach((k) => thumbBlobs.delete(k));
  forgetSources(gone);
  return removed.length;
}

/** Frees every thumbnail URL (before replacing the whole library). */
export function releaseAll(): void {
  const s = useDevelop.getState();
  for (const id of s.order) {
    const p = s.photos[id];
    if (p?.thumb) URL.revokeObjectURL(p.thumb);
    if (p?.devThumb) URL.revokeObjectURL(p.devThumb);
  }
  forgetSources(s.order.map((id) => sourceKeyOf(s.photos[id])));
  thumbBlobs.clear();
  queue.length = 0;
}

/* -------------------------------- Thumbnails -------------------------------- */

/** Unedited thumbnail JPEG per source (shared by virtual copies). */
const thumbBlobs = new Map<string, Blob>();
const thumbSize = new Map<string, { w: number; h: number }>();
const queue: string[] = [];
let running = 0;
const MAX_PARALLEL = 2;

/** Asks for thumbnails of these photos (most urgent first). */
export function requestThumbs(ids: string[]): void {
  for (const id of [...ids].reverse()) {
    const p = getPhoto(id);
    if (!p || p.thumbState !== 'idle' || !canDevelop(p)) continue;
    const at = queue.indexOf(id);
    if (at >= 0) queue.splice(at, 1);
    queue.unshift(id);
  }
  if (queue.length > 400) queue.length = 400;
  pump();
}

function pump(): void {
  while (running < MAX_PARALLEL && queue.length) {
    const id = queue.shift()!;
    const p = getPhoto(id);
    if (!p || p.thumbState !== 'idle' || !canDevelop(p)) continue;
    running++;
    void buildThumb(p).finally(() => {
      running--;
      pump();
    });
  }
}

async function buildThumb(photo: Photo): Promise<void> {
  patchPhoto(photo.id, { thumbState: 'loading' });
  const key = sourceKeyOf(photo);
  try {
    let blob = thumbBlobs.get(key);
    let size = thumbSize.get(key);
    if (!blob || !size) {
      const made = await makeThumbnail(photo);
      made.thumb.close();
      blob = made.blob;
      size = { w: made.fullW, h: made.fullH };
      thumbBlobs.set(key, blob);
      thumbSize.set(key, size);
    }
    const current = getPhoto(photo.id);
    if (!current) return;
    // every photo sharing this source gets its own URL
    const s = useDevelop.getState();
    for (const id of s.order) {
      const p = s.photos[id];
      if (!p || sourceKeyOf(p) !== key || (p.thumb && p.thumbState === 'ready')) continue;
      patchPhoto(id, { thumb: URL.createObjectURL(blob), thumbState: 'ready', width: size.w, height: size.h });
      if (isEdited(p.settings)) scheduleDevThumb(id, 50);
    }
  } catch (error) {
    patchPhoto(photo.id, { thumbState: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

const devTimers = new Map<string, ReturnType<typeof setTimeout>>();
let devChain: Promise<void> = Promise.resolve();

/** Re-renders the "developed" thumbnail of a photo after its settings settle. */
export function scheduleDevThumb(id: string, delay = 600): void {
  const old = devTimers.get(id);
  if (old) clearTimeout(old);
  devTimers.set(
    id,
    setTimeout(() => {
      devTimers.delete(id);
      devChain = devChain.then(() => buildDevThumb(id)).catch(() => undefined);
    }, delay),
  );
}

async function buildDevThumb(id: string): Promise<void> {
  const photo = getPhoto(id);
  if (!photo || photo.thumbState !== 'ready') return;
  if (!isEdited(photo.settings)) {
    if (photo.devThumb) {
      URL.revokeObjectURL(photo.devThumb);
      patchPhoto(id, { devThumb: undefined });
    }
    return;
  }
  const key = sourceKeyOf(photo);
  const blob = thumbBlobs.get(key);
  const size = thumbSize.get(key);
  if (!blob || !size || !getRenderer()) return;
  const settings = photo.settings;
  const bitmap = await createImageBitmap(blob);
  try {
    const atmos = peekStats(photo)?.atmos ?? (() => {
      const px = bitmapPixels(bitmap, 160);
      return estimateAtmosphere(px.data, px.width, px.height);
    })();
    const canvas = renderSmall(bitmap, `thumb:${key}`, size.w, size.h, settings, atmos, 360);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    const latest = getPhoto(id);
    if (!out || !latest) return;
    if (latest.settings !== settings) {
      scheduleDevThumb(id, 100);
      return;
    }
    if (latest.devThumb) URL.revokeObjectURL(latest.devThumb);
    patchPhoto(id, { devThumb: URL.createObjectURL(out) });
  } finally {
    bitmap.close();
  }
}

/** Watches settings changes and refreshes developed thumbnails. */
let unsubscribe: (() => void) | null = null;
export function startThumbnailWatcher(): () => void {
  if (unsubscribe) return unsubscribe;
  const off = useDevelop.subscribe((s, prev) => {
    if (s.photos === prev.photos) return;
    for (const id of s.order) {
      const a = s.photos[id];
      const b = prev.photos[id];
      if (a && b && a.settings !== b.settings && a.thumbState === 'ready') scheduleDevThumb(id);
    }
  });
  unsubscribe = () => {
    off();
    unsubscribe = null;
  };
  return unsubscribe;
}
