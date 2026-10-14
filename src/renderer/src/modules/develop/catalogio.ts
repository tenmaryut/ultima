/**
 * Saving and opening catalogs (.ultima). Photos can be embedded as data URLs when they
 * are small enough together; otherwise the catalog keeps settings by file name and the
 * user re-imports the originals after opening it.
 */
import { saveFile } from '../../core/platform';
import { rememberRecent, guessMime } from '../../core/open';
import { t } from '../../core/i18n';
import { bytesToBase64, dataUrlToBlob } from '../../core/utils/base64';
import { uid } from '../../core/utils/id';
import { toast } from '../../components/ui/feedback';
import { EMBED_LIMIT_BYTES, parseCatalog, serializeCatalog, type CatalogRecord } from './catalog';
import { photoFromFile, releaseAll } from './library';
import { replaceLibrary, useDevelop } from './store';
import type { Photo } from './types';

export const CATALOG_FILTERS = [{ name: 'Ultima catalog', extensions: ['ultima'] }];

/** Size of the originals that would be embedded (virtual copies share their master). */
export function embeddableBytes(): { bytes: number; count: number; missing: number } {
  const s = useDevelop.getState();
  let bytes = 0;
  let count = 0;
  let missing = 0;
  for (const id of s.order) {
    const p = s.photos[id];
    if (!p || p.masterId) continue;
    if (p.file) {
      bytes += p.file.size;
      count++;
    } else missing++;
  }
  return { bytes, count, missing };
}

/** base64 text of a file as a Blob, converted in chunks (no giant strings). */
async function base64Blob(file: Blob): Promise<Blob> {
  const chunk = 3 * 1024 * 1024;
  const parts: string[] = [];
  for (let at = 0; at < file.size; at += chunk) {
    parts.push(bytesToBase64(await file.slice(at, at + chunk).arrayBuffer()));
  }
  return new Blob(parts, { type: 'text/plain' });
}

function toRecord(p: Photo, idMap: Map<string, string>): Omit<CatalogRecord, 'data'> {
  return {
    id: idMap.get(p.id)!,
    name: p.name,
    size: p.size,
    lastModified: p.lastModified,
    copyIndex: p.copyIndex,
    masterId: p.masterId ? idMap.get(p.masterId) : undefined,
    rating: p.rating,
    flag: p.flag,
    label: p.label,
    settings: p.settings,
    addedAt: p.addedAt,
  };
}

/** Writes the catalog. Returns false when cancelled. */
export async function saveCatalog(options: { saveAs?: boolean; embed: boolean; onProgress?: (v: number) => void }): Promise<boolean> {
  const s = useDevelop.getState();
  const list = s.order.map((id) => s.photos[id]).filter(Boolean);
  if (!list.length) {
    toast.info(t('The library is empty — import photos first.'));
    return false;
  }
  const { bytes } = embeddableBytes();
  const embed = options.embed && bytes <= EMBED_LIMIT_BYTES;
  // stable short ids in the file
  const idMap = new Map(list.map((p, i) => [p.id, `p${i + 1}`]));
  const records: { record: Omit<CatalogRecord, 'data'>; data?: { mime: string; base64: Blob } }[] = [];
  let done = 0;
  for (const p of list) {
    const record = toRecord(p, idMap);
    if (embed && !p.masterId && p.file) {
      records.push({ record, data: { mime: p.file.type || guessMime(p.name) || 'application/octet-stream', base64: await base64Blob(p.file) } });
    } else records.push({ record });
    done++;
    options.onProgress?.(done / list.length);
  }
  const parts = serializeCatalog<Blob>(
    { name: s.catalogName, activeId: s.activeId ? idMap.get(s.activeId) : null, selected: s.selected.map((id) => idMap.get(id)!).filter(Boolean) },
    records,
  );
  const blob = new Blob(parts, { type: 'application/json' });
  const base = s.catalogName.replace(/[<>:"/\\|?*]/g, '_') || 'catalog';
  const result = await saveFile(blob, {
    suggestedName: `${base}.ultima`,
    filters: CATALOG_FILTERS,
    path: options.saveAs ? undefined : s.catalogPath,
  });
  if (!result) return false;
  const savedName = result.path ? result.path.split(/[\\/]/).pop()!.replace(/\.ultima$/i, '') : s.catalogName;
  useDevelop.setState({ catalogPath: result.path ?? s.catalogPath, dirty: false, catalogName: savedName || s.catalogName });
  toast.success(t('Catalog saved'), embed ? t('Photos are embedded in the catalog.') : t('Photos are referenced by file name — keep the originals.'));
  return true;
}

/** Opens a catalog file, replacing the current library. Returns the number of missing photos. */
export async function openCatalog(file: File): Promise<number> {
  if (file.size > 700 * 1024 * 1024) throw new Error(t('This catalog is too large to open.'));
  const parsed = parseCatalog(await file.text());
  // masters first so copies can share their source
  const byId = new Map<string, Photo>();
  const ordered = [...parsed.records].sort((a, b) => Number(Boolean(a.masterId)) - Number(Boolean(b.masterId)));
  for (const r of ordered) {
    const master = r.masterId ? byId.get(r.masterId) : undefined;
    let photo: Photo;
    if (master) {
      photo = { ...master, id: uid('ph'), masterId: master.id, copyIndex: r.copyIndex || 1, thumb: undefined, devThumb: undefined, thumbState: master.kind === 'unsupported' ? 'error' : master.kind === 'missing' ? 'idle' : 'idle' };
    } else if (r.data) {
      const blob = dataUrlToBlob(r.data);
      const f = new File([blob], r.name, { type: blob.type, lastModified: r.lastModified || Date.now() });
      photo = await photoFromFile(f);
      r.data = undefined;
    } else {
      photo = {
        id: uid('ph'),
        name: r.name,
        copyIndex: 0,
        file: null,
        source: null,
        kind: 'missing',
        orientation: 1,
        size: r.size,
        lastModified: r.lastModified,
        width: 0,
        height: 0,
        exif: null,
        captureDate: r.lastModified,
        rating: 0,
        flag: null,
        label: null,
        settings: r.settings,
        thumbState: 'idle',
        addedAt: r.addedAt,
      };
    }
    photo = { ...photo, rating: r.rating, flag: r.flag, label: r.label, settings: r.settings, addedAt: r.addedAt, copyIndex: master ? r.copyIndex || 1 : 0 };
    byId.set(r.id, photo);
  }
  const list = parsed.records.map((r) => byId.get(r.id)!).filter(Boolean);
  releaseAll();
  replaceLibrary(list, {
    name: parsed.name,
    path: undefined,
    activeId: parsed.activeId ? byId.get(parsed.activeId)?.id : null,
    selected: parsed.selected?.map((id) => byId.get(id)?.id).filter((x): x is string => Boolean(x)),
  });
  rememberRecent(file, 'develop');
  return list.filter((p) => p.kind === 'missing' && !p.masterId).length;
}
