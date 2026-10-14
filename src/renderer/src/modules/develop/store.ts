/**
 * Photo Develop state: the library (photos, selection, filters), per-photo settings with
 * undo history, the settings clipboard and view options. A module-level zustand store —
 * the module stays mounted, so its state survives switching modules.
 */
import { create } from 'zustand';
import { commitHistory, jumpHistory, newHistory, redoHistory, undoHistory, type PhotoHistory } from './history';
import { describeChange, settingsEqual, type DevelopSettings, type GroupId, type PartialSettings } from './params';
import type { Preset } from './presets';
import { DEFAULT_FILTER, nextSelection, visiblePhotos, type ColorLabel, type Flag, type LibraryFilter, type Photo, type SortKey } from './types';
import type { Histogram } from './histogram';

export type ViewMode = 'library' | 'develop';
export type CompareMode = 'off' | 'before' | 'split';
export type OverlayGrid = 'thirds' | 'grid' | 'golden' | 'none';
/** Pointer tools of the develop view. */
export type ViewTool = 'none' | 'wb' | 'level';

export interface DevelopState {
  photos: Record<string, Photo>;
  /** Import order. */
  order: string[];
  selected: string[];
  /** Shift-click anchor. */
  anchor: string | null;
  activeId: string | null;
  view: ViewMode;
  filter: LibraryFilter;
  sort: SortKey;
  sortDesc: boolean;
  thumbSize: number;
  histories: Record<string, PhotoHistory>;
  clipboard: { settings: PartialSettings; groups: GroupId[] } | null;
  /** Preset being hovered (temporary preview, never stored). */
  hoverPreset: Preset | null;
  catalogName: string;
  catalogPath?: string;
  /** Embed photos when saving (remembered for Ctrl+S). */
  catalogEmbed: boolean;
  dirty: boolean;
  cropMode: boolean;
  compare: CompareMode;
  splitPos: number;
  showClipping: boolean;
  overlay: OverlayGrid;
  tool: ViewTool;
  histogram: Histogram | null;
  /** Develop view zoom (for the status bar). */
  zoom: number;
}

export const useDevelop = create<DevelopState>(() => ({
  photos: {},
  order: [],
  selected: [],
  anchor: null,
  activeId: null,
  view: 'library',
  filter: DEFAULT_FILTER,
  sort: 'name',
  sortDesc: false,
  thumbSize: 168,
  histories: {},
  clipboard: null,
  hoverPreset: null,
  catalogName: 'Untitled catalog',
  catalogEmbed: true,
  dirty: false,
  cropMode: false,
  compare: 'off',
  splitPos: 0.5,
  showClipping: false,
  overlay: 'thirds',
  tool: 'none',
  histogram: null,
  zoom: 1,
}));

const get = () => useDevelop.getState();
const set = (patch: Partial<DevelopState> | ((s: DevelopState) => Partial<DevelopState>)) => useDevelop.setState(patch);

/* --------------------------------- Library --------------------------------- */

export function getPhoto(id: string | null | undefined): Photo | undefined {
  return id ? get().photos[id] : undefined;
}

export function activePhoto(): Photo | undefined {
  return getPhoto(get().activeId);
}

/** Filtered + sorted photos (the grid / filmstrip order). */
export function getVisible(s: DevelopState = get()): Photo[] {
  return visiblePhotos(
    s.order.map((id) => s.photos[id]).filter(Boolean),
    s.filter,
    s.sort,
    s.sortDesc,
  );
}

export function addPhotos(list: Photo[], select = true): void {
  if (!list.length) return;
  set((s) => {
    const photos = { ...s.photos };
    const histories = { ...s.histories };
    for (const p of list) {
      photos[p.id] = p;
      histories[p.id] = newHistory(p.settings);
    }
    const ids = list.map((p) => p.id);
    return {
      photos,
      histories,
      order: [...s.order, ...ids.filter((id) => !s.order.includes(id))],
      selected: select ? ids : s.selected,
      anchor: select ? ids[0] : s.anchor,
      activeId: select || !s.activeId ? ids[0] : s.activeId,
      dirty: true,
    };
  });
}

export function patchPhoto(id: string, patch: Partial<Photo>): void {
  set((s) => (s.photos[id] ? { photos: { ...s.photos, [id]: { ...s.photos[id], ...patch } } } : {}));
}

/** Replaces the whole library (opening a catalog). */
export function replaceLibrary(list: Photo[], meta: { name: string; path?: string; activeId?: string | null; selected?: string[] }): void {
  const photos: Record<string, Photo> = {};
  const histories: Record<string, PhotoHistory> = {};
  for (const p of list) {
    photos[p.id] = p;
    histories[p.id] = newHistory(p.settings);
  }
  const activeId = meta.activeId && photos[meta.activeId] ? meta.activeId : (list[0]?.id ?? null);
  set({
    photos,
    histories,
    order: list.map((p) => p.id),
    selected: (meta.selected ?? []).filter((id) => photos[id]).length ? meta.selected!.filter((id) => photos[id]) : activeId ? [activeId] : [],
    anchor: activeId,
    activeId,
    catalogName: meta.name,
    catalogPath: meta.path,
    dirty: false,
    cropMode: false,
    histogram: null,
  });
}

/** Removes photos; returns the removed ones (so callers can free their resources). */
export function removePhotos(ids: string[]): Photo[] {
  const s = get();
  const drop = new Set(ids);
  // removing a master also removes its virtual copies
  for (const id of s.order) {
    const p = s.photos[id];
    if (p?.masterId && drop.has(p.masterId)) drop.add(id);
  }
  const removed = [...drop].map((id) => s.photos[id]).filter(Boolean);
  if (!removed.length) return [];
  const visible = getVisible(s).map((p) => p.id);
  const photos = { ...s.photos };
  const histories = { ...s.histories };
  for (const id of drop) {
    delete photos[id];
    delete histories[id];
  }
  let activeId = s.activeId;
  if (activeId && drop.has(activeId)) {
    const idx = visible.indexOf(activeId);
    activeId = visible.slice(idx + 1).find((id) => !drop.has(id)) ?? visible.slice(0, Math.max(0, idx)).reverse().find((id) => !drop.has(id)) ?? null;
  }
  set({
    photos,
    histories,
    order: s.order.filter((id) => !drop.has(id)),
    selected: activeId ? [activeId] : [],
    anchor: activeId,
    activeId,
    dirty: true,
    cropMode: activeId ? s.cropMode : false,
  });
  return removed;
}

/* -------------------------------- Selection -------------------------------- */

export function selectPhoto(id: string, mode: 'single' | 'toggle' | 'range' = 'single'): void {
  const s = get();
  const order = getVisible(s).map((p) => p.id);
  const selected = nextSelection(order, s.selected, s.anchor, id, mode);
  set({
    selected: selected.length ? selected : [id],
    anchor: mode === 'range' ? s.anchor : id,
    activeId: mode === 'toggle' && !selected.includes(id) ? (selected[selected.length - 1] ?? id) : id,
  });
}

export function setActive(id: string | null): void {
  const s = get();
  if (!id) return set({ activeId: null });
  set({ activeId: id, selected: s.selected.includes(id) ? s.selected : [id], anchor: s.selected.includes(id) ? s.anchor : id });
}

export function selectAll(): void {
  const ids = getVisible().map((p) => p.id);
  set((s) => ({ selected: ids, activeId: s.activeId && ids.includes(s.activeId) ? s.activeId : (ids[0] ?? null) }));
}

export function selectNone(): void {
  set((s) => ({ selected: s.activeId ? [s.activeId] : [] }));
}

/** Selected photo ids in grid order (falls back to the active photo). */
export function selectedIds(): string[] {
  const s = get();
  const order = getVisible(s).map((p) => p.id);
  const sel = order.filter((id) => s.selected.includes(id));
  if (sel.length) return sel;
  return s.activeId ? [s.activeId] : [];
}

/** Moves the active photo by `delta` within the visible list. */
export function stepActive(delta: number): void {
  const order = getVisible().map((p) => p.id);
  if (!order.length) return;
  const idx = order.indexOf(get().activeId ?? '');
  const next = order[Math.max(0, Math.min(order.length - 1, (idx < 0 ? 0 : idx) + delta))];
  set({ activeId: next, selected: [next], anchor: next, cropMode: false });
}

/* ------------------------------- Metadata ------------------------------- */

function patchMany(ids: string[], fn: (p: Photo) => Partial<Photo>): void {
  set((s) => {
    const photos = { ...s.photos };
    for (const id of ids) if (photos[id]) photos[id] = { ...photos[id], ...fn(photos[id]) };
    return { photos, dirty: true };
  });
}

export function setRating(ids: string[], rating: number): void {
  patchMany(ids, () => ({ rating: Math.max(0, Math.min(5, Math.round(rating))) }));
}

export function setFlag(ids: string[], flag: Flag): void {
  patchMany(ids, () => ({ flag }));
}

export function setLabel(ids: string[], label: ColorLabel | null): void {
  patchMany(ids, (p) => ({ label: p.label === label && ids.length === 1 ? null : label }));
}

/* --------------------------- Settings + history --------------------------- */

/**
 * Changes a photo's develop settings. `record: false` is a live update (slider drag);
 * call commitSettings when it ends.
 */
export function setSettings(id: string, next: DevelopSettings, options: { record?: boolean; label?: string } = {}): void {
  const s = get();
  const photo = s.photos[id];
  if (!photo || photo.settings === next) return;
  const record = options.record ?? true;
  const history = s.histories[id] ?? newHistory(photo.settings);
  set({
    photos: { ...s.photos, [id]: { ...photo, settings: next } },
    histories: record ? { ...s.histories, [id]: commitHistory(history, next, options.label ?? describeChange(history.anchor, next)) } : s.histories,
    dirty: true,
  });
}

let lastCommit = { id: '', label: '', time: 0 };

/** Records live changes as one undo step; quick repeats with the same label merge into one step. */
export function commitSettings(id: string, label?: string): void {
  const s = get();
  const photo = s.photos[id];
  const history = s.histories[id];
  if (!photo || !history) return;
  if (settingsEqual(history.anchor, photo.settings)) return;
  const text = label ?? describeChange(history.anchor, photo.settings);
  const now = Date.now();
  const merge = lastCommit.id === id && lastCommit.label === text && now - lastCommit.time < 1200;
  lastCommit = { id, label: text, time: now };
  set({ histories: { ...s.histories, [id]: commitHistory(history, photo.settings, text, merge) } });
}

/** Applies `fn` to each photo's settings, recording one undo step per photo. */
export function applyToPhotos(ids: string[], fn: (settings: DevelopSettings, photo: Photo) => DevelopSettings, label: string): number {
  const s = get();
  const photos = { ...s.photos };
  const histories = { ...s.histories };
  let changed = 0;
  for (const id of ids) {
    const photo = photos[id];
    if (!photo) continue;
    const next = fn(photo.settings, photo);
    if (settingsEqual(next, photo.settings)) continue;
    photos[id] = { ...photo, settings: next };
    histories[id] = commitHistory(histories[id] ?? newHistory(photo.settings), next, label);
    changed++;
  }
  if (changed) set({ photos, histories, dirty: true });
  return changed;
}

function historyMove(id: string | null, fn: typeof undoHistory): boolean {
  if (!id) return false;
  const s = get();
  const photo = s.photos[id];
  const history = s.histories[id];
  if (!photo || !history) return false;
  const r = fn(history, photo.settings);
  if (!r) return false;
  set({ photos: { ...s.photos, [id]: { ...photo, settings: r.settings } }, histories: { ...s.histories, [id]: r.history }, dirty: true });
  return true;
}

export const undo = (id = get().activeId) => historyMove(id, undoHistory);
export const redo = (id = get().activeId) => historyMove(id, redoHistory);

export function jumpToHistory(id: string, index: number): void {
  const s = get();
  const photo = s.photos[id];
  const history = s.histories[id];
  if (!photo || !history) return;
  const r = jumpHistory(history, photo.settings, index);
  set({ photos: { ...s.photos, [id]: { ...photo, settings: r.settings } }, histories: { ...s.histories, [id]: r.history }, dirty: true });
}

/* --------------------------------- View --------------------------------- */

export function setView(view: ViewMode): void {
  set((s) => ({ view, cropMode: view === 'develop' ? s.cropMode : false, hoverPreset: null, tool: 'none' }));
}

export function setFilter(patch: Partial<LibraryFilter>): void {
  set((s) => ({ filter: { ...s.filter, ...patch } }));
}

export function setStore(patch: Partial<DevelopState>): void {
  set(patch);
}
