import { canvasToBlob, createCanvas, get2d } from '../../core/utils/image';
import { mediaKindOfName } from './media';
import type { MediaKind } from './types';

/*
 * Folders linked to the Video Editor (for example where the game recorder saves its clips): their media
 * show up in the media bin and for the AI by themselves, without importing files one by one. The browser's
 * File System Access API gives read access to the folder the user picked; the handle is kept in IndexedDB
 * so the folder stays linked after a restart.
 */

/** The parts of the File System Access API used here (not all of them are in TypeScript's DOM types). */
interface DirHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
}
type DirectoryPicker = (options?: { id?: string; mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;

export interface LinkedFolder {
  id: string;
  name: string;
  handle: DirHandle;
  /** "prompt": after a restart Ultima may need the user's OK (one click) before it can read the folder again. */
  access: PermissionState;
  scanning: boolean;
  error?: string;
}

export interface FolderEntry {
  /** "fd_…" from the folder, the path inside it and the size: the AI and the project use it as the media id. */
  id: string;
  folderId: string;
  /** Path inside the folder, e.g. "Valorant/2026-10-16 21-03-11.mp4". */
  path: string;
  name: string;
  kind: MediaKind;
  size: number;
  lastModified: number;
  handle: FileSystemFileHandle;
  /** Filled in lazily by `ensureInfo`. */
  duration?: number;
  width?: number;
  height?: number;
  thumb?: string;
  /** The file couldn't be read (still being written, or an unsupported format). */
  unreadable?: boolean;
}

/** How deep subfolders are searched and how many files are listed per folder. */
export const MAX_DEPTH = 4;
export const MAX_ENTRIES = 2000;
/** Files changed this recently are probably still being written by the recorder: they appear on a later scan. */
export const SETTLE_MS = 10_000;

/** 32-bit FNV-1a, as 7 base-36 characters. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

/** Stable id of a file in a linked folder: the same file keeps it after a restart or relinking the folder. */
export function folderEntryId(folderName: string, path: string, size: number): string {
  return `fd_${hash(`${folderName.toLowerCase()}/${path.toLowerCase()}|${size}`)}`;
}

export const isFolderId = (id: string): boolean => /^fd_[0-9a-z]{7}$/.test(id);

/** Folder ids ("fd_…") anywhere in the AI's actions (also inside lists and nested objects). */
export function folderIdsIn(value: unknown, out = new Set<string>()): string[] {
  if (typeof value === 'string') {
    if (isFolderId(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) folderIdsIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) folderIdsIn(v, out);
  }
  return [...out];
}

/** Newest first, then by name. */
export function sortEntries<T extends { lastModified: number; path: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.lastModified - a.lastModified || a.path.localeCompare(b.path));
}

/** The folder file for a missing project file: the same name and size (case-insensitive name). */
export function matchEntry<T extends { name: string; size: number }>(list: T[], name: string, size: number): T | undefined {
  const lower = name.toLowerCase();
  return list.find((e) => e.size === size && e.name.toLowerCase() === lower);
}

/* ------------------------------------ IndexedDB ------------------------------------ */

const DB = 'ultima-video';
const STORE = 'folders';

interface StoredFolder {
  id: string;
  name: string;
  handle: DirHandle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/* ------------------------------------- library ------------------------------------- */

const pickerOf = (): DirectoryPicker | null => {
  const w = globalThis as unknown as { showDirectoryPicker?: DirectoryPicker };
  return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(globalThis) : null;
};

export class FolderLibrary {
  folders: LinkedFolder[] = [];
  /** Media files of all readable folders, newest first. */
  entries: FolderEntry[] = [];
  version = 0;
  private byId = new Map<string, FolderEntry>();
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private infoQueue: Promise<unknown> = Promise.resolve();
  private infoWanted = new Set<string>();

  /** Linking folders needs the File System Access API (the desktop app and Chromium browsers). */
  static supported(): boolean {
    return pickerOf() !== null && typeof indexedDB !== 'undefined';
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get(id: string | undefined): FolderEntry | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  /** Reads the linked folders saved earlier and lists the ones Ultima may still read. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      if (!FolderLibrary.supported()) return;
      const stored = await withStore<StoredFolder[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFolder[]>).catch(() => []);
      this.folders = await Promise.all(stored.map(async (f) => ({ ...f, access: await this.access(f.handle), scanning: false })));
      this.emit();
      await this.refresh();
    })();
    return this.loading;
  }

  private async access(handle: DirHandle, ask = false): Promise<PermissionState> {
    try {
      const state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
      if (state === 'granted' || !ask) return state;
      return (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
    } catch {
      return 'denied';
    }
  }

  /** Lets the user pick a folder to link. Returns it, or null when cancelled. */
  async link(): Promise<LinkedFolder | null> {
    const pick = pickerOf();
    if (!pick) return null;
    let handle: DirHandle;
    try {
      handle = (await pick({ id: 'ultima-video-media', mode: 'read' })) as DirHandle;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
    await this.load();
    for (const f of this.folders) {
      if (await f.handle.isSameEntry(handle).catch(() => false)) {
        f.access = await this.access(f.handle, true);
        await this.scan(f);
        return f;
      }
    }
    const folder: LinkedFolder = { id: `fo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: handle.name, handle, access: 'granted', scanning: false };
    folder.access = await this.access(handle, true);
    await withStore('readwrite', (s) => s.put({ id: folder.id, name: folder.name, handle } satisfies StoredFolder)).catch(() => undefined);
    this.folders = [...this.folders, folder];
    await this.scan(folder);
    return folder;
  }

  async unlink(id: string): Promise<void> {
    this.folders = this.folders.filter((f) => f.id !== id);
    await withStore('readwrite', (s) => s.delete(id)).catch(() => undefined);
    this.rebuild();
  }

  /** Asks for read access again (after a restart); needs a click. */
  async allow(id: string): Promise<boolean> {
    const folder = this.folders.find((f) => f.id === id);
    if (!folder) return false;
    folder.access = await this.access(folder.handle, true);
    this.emit();
    if (folder.access !== 'granted') return false;
    await this.scan(folder);
    return true;
  }

  /** Lists the media of every readable folder again (new recordings appear, deleted ones go). */
  async refresh(): Promise<void> {
    for (const f of this.folders) {
      if (f.access !== 'granted') f.access = await this.access(f.handle);
      if (f.access === 'granted' && !f.scanning) await this.scan(f);
    }
    this.emit();
  }

  private async scan(folder: LinkedFolder): Promise<void> {
    if (folder.access !== 'granted') return;
    folder.scanning = true;
    this.emit();
    const found: FolderEntry[] = [];
    const now = Date.now();
    const walk = async (dir: DirHandle, prefix: string, depth: number): Promise<void> => {
      for await (const handle of dir.values()) {
        if (found.length >= MAX_ENTRIES) return;
        if (handle.name.startsWith('.')) continue;
        const path = prefix ? `${prefix}/${handle.name}` : handle.name;
        if (handle.kind === 'directory') {
          if (depth < MAX_DEPTH) await walk(handle as DirHandle, path, depth + 1);
          continue;
        }
        const kind = mediaKindOfName(handle.name);
        if (!kind) continue;
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          if (now - file.lastModified < SETTLE_MS) continue;
          const id = folderEntryId(folder.name, path, file.size);
          const old = this.byId.get(id);
          found.push({ ...(old ?? {}), id, folderId: folder.id, path, name: handle.name, kind, size: file.size, lastModified: file.lastModified, handle: handle as FileSystemFileHandle });
        } catch {
          // unreadable for now (locked or being written)
        }
      }
    };
    try {
      await walk(folder.handle, '', 0);
      folder.error = undefined;
    } catch (error) {
      folder.error = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === 'NotAllowedError') folder.access = 'prompt';
    }
    folder.scanning = false;
    this.rebuild(folder.id, found);
  }

  private rebuild(folderId?: string, found?: FolderEntry[]): void {
    const keep = this.entries.filter((e) => e.folderId !== folderId && this.folders.some((f) => f.id === e.folderId));
    const next = sortEntries([...keep, ...(found ?? [])]);
    const ids = new Set(next.map((e) => e.id));
    for (const e of this.entries) if (e.thumb && !ids.has(e.id)) URL.revokeObjectURL(e.thumb);
    this.entries = next;
    this.byId = new Map(next.map((e) => [e.id, e]));
    this.emit();
  }

  /** The file of a folder entry (read from disk when it is used, never copied). */
  async file(id: string): Promise<File> {
    const entry = this.byId.get(id);
    if (!entry) throw new Error('This file is no longer in the linked folder.');
    return entry.handle.getFile();
  }

  /** A folder file with the same name and size, for relinking a missing project file. */
  find(name: string, size: number): FolderEntry | undefined {
    return matchEntry(this.entries, name, size);
  }

  /** Length, picture size and a small poster, read once per file (one at a time, in the background). */
  ensureInfo(entry: FolderEntry): void {
    if (entry.thumb || entry.unreadable || entry.duration !== undefined || this.infoWanted.has(entry.id)) return;
    this.infoWanted.add(entry.id);
    this.infoQueue = this.infoQueue
      .then(() => readInfo(entry))
      .then((info) => Object.assign(entry, info))
      .catch(() => Object.assign(entry, { unreadable: true }))
      .finally(() => {
        this.infoWanted.delete(entry.id);
        this.emit();
      });
  }
}

/* ------------------------------- poster and duration ------------------------------- */

function once(el: HTMLMediaElement, event: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
      resolve(ok);
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    el.addEventListener(event, onOk);
    el.addEventListener('error', onErr);
  });
}

async function posterUrl(source: CanvasImageSource, w: number, h: number): Promise<string> {
  const scale = Math.min(1, 160 / Math.max(1, w), 90 / Math.max(1, h));
  const c = createCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  get2d(c).drawImage(source, 0, 0, c.width, c.height);
  return URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.8));
}

async function readInfo(entry: FolderEntry): Promise<Partial<FolderEntry>> {
  const file = await entry.handle.getFile();
  const url = URL.createObjectURL(file);
  try {
    if (entry.kind === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, thumb: await posterUrl(img, img.naturalWidth, img.naturalHeight) };
    }
    const el = document.createElement(entry.kind === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;
    el.src = url;
    if (!(await once(el, 'loadedmetadata', 15_000))) return { unreadable: true };
    const duration = Number.isFinite(el.duration) ? el.duration : undefined;
    if (entry.kind === 'audio') return { duration };
    const v = el as HTMLVideoElement;
    v.currentTime = Math.min(1, (duration ?? 1) * 0.1);
    const seeked = await once(v, 'seeked', 8000);
    const thumb = seeked && v.videoWidth ? await posterUrl(v, v.videoWidth, v.videoHeight) : undefined;
    v.removeAttribute('src');
    v.load();
    return { duration, width: v.videoWidth || undefined, height: v.videoHeight || undefined, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}
