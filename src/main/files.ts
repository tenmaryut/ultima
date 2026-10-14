import { BrowserWindow, dialog, ipcMain, session } from 'electron';
import { mkdtemp, open, readFile, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { IPC, type FileFilter, type RecentFile, type SaveFileOptions } from '@shared/ipc';
import { JsonStore } from './config-store';

const MAX_RECENT = 20;
const MAX_RECENT_READ_BYTES = 1024 * 1024 * 1024; // 1 GB

/** Extensions Ultima can open; reading recent files is restricted to these. */
const OPENABLE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.psd', '.ico', '.tif', '.tiff',
  '.mp4', '.webm', '.mov', '.mkv', '.m4v', '.ogv',
  '.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.weba',
  '.pdf', '.ultima', '.json', '.txt', '.md', '.srt', '.vtt', '.cube', '.ase', '.gpl',
  '.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.raf', '.orf', '.rw2', '.pef', '.srw', '.raw', '.rwl',
]);

const recentStore = new JsonStore<{ files: RecentFile[] }>('recent', { files: [] });

/** Paths the user explicitly chose in a save dialog during this session. */
const writablePaths = new Set<string>();
/**
 * Files the user actually handed to Ultima this session: picked in a file dialog or dropped
 * (reported by the preload from real File objects), saved, or opened through the OS.
 * Only these can be added to the recent list, which is what `readRecent` may read.
 */
const grantedPaths = new Set<string>();

export function grantPath(path: string): void {
  if (path) grantedPaths.add(resolve(path));
}
const writers = new Map<string, { handle: FileHandle; path: string }>();

function toBuffer(data: SaveFileOptions['data']): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(new Uint8Array(data));
}

async function askSavePath(win: BrowserWindow | null, suggestedName: string, filters?: FileFilter[]) {
  const options: Electron.SaveDialogOptions = {
    defaultPath: suggestedName,
    filters: filters?.length ? [...filters, { name: 'All Files', extensions: ['*'] }] : undefined,
  };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  const path = resolve(result.filePath);
  writablePaths.add(path);
  grantedPaths.add(path);
  return path;
}

/** Keeps only existing files Ultima can open (used for paths handed over by the OS). */
export async function filterOpenablePaths(paths: string[], cwd = process.cwd()): Promise<{ path: string; name: string }[]> {
  const out: { path: string; name: string }[] = [];
  for (const raw of paths) {
    if (!raw || raw.startsWith('-')) continue;
    const path = resolve(cwd, raw);
    if (!OPENABLE_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
    } catch {
      continue;
    }
    grantedPaths.add(path);
    addRecent({ path, name: basename(path) }); // allows the renderer to read it via readRecent
    out.push({ path, name: basename(path) });
  }
  return out;
}

export function addRecent(entry: Omit<RecentFile, 'openedAt'>): void {
  if (!entry.path) return;
  const path = resolve(entry.path);
  const files = recentStore.get().files.filter((f) => f.path !== path);
  files.unshift({ ...entry, path, name: entry.name || basename(path), openedAt: Date.now() });
  recentStore.update({ files: files.slice(0, MAX_RECENT) });
}

/**
 * Renders HTML to a vector PDF in a hidden window with JavaScript disabled, in a separate
 * session that may load only the generated document itself plus data:/blob: URLs — no
 * network and no other local files.
 */
async function printHtmlToPdf(options: { html: string; widthIn: number; heightIn: number }): Promise<Uint8Array> {
  const html = String(options?.html ?? '');
  if (html.length > 200 * 1024 * 1024) throw new Error('Document is too large to print');
  const widthIn = Math.min(200, Math.max(1, Number(options.widthIn) || 8.27));
  const heightIn = Math.min(200, Math.max(1, Number(options.heightIn) || 11.69));
  const dir = await mkdtemp(join(tmpdir(), 'ultima-print-'));
  const file = join(dir, 'document.html');
  const documentUrl = pathToFileURL(file).href;
  const printSession = session.fromPartition('ultima-print');
  printSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === documentUrl || /^(data|blob):/i.test(details.url);
    callback({ cancel: !allowed });
  });
  printSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, session: printSession },
  });
  try {
    await writeFile(file, html, 'utf8');
    await win.loadFile(file);
    await new Promise((r) => setTimeout(r, 400)); // let web fonts settle
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: { width: widthIn, height: heightIn },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  } finally {
    win.destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerFileIpc(): void {
  ipcMain.handle(IPC.printToPdf, (_event, options: { html: string; widthIn: number; heightIn: number }) => printHtmlToPdf(options));

  ipcMain.handle(IPC.fileSave, async (event, options: SaveFileOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    let path = options.path ? resolve(options.path) : null;
    if (path && !writablePaths.has(path)) path = null; // never write to a path the user did not pick
    if (!path) path = await askSavePath(win, options.suggestedName, options.filters);
    if (!path) return null;
    await writeFile(path, toBuffer(options.data));
    return { path };
  });

  ipcMain.handle(IPC.fileWriterOpen, async (event, options: { suggestedName: string; filters?: FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const path = await askSavePath(win, options.suggestedName, options.filters);
    if (!path) return null;
    const handle = await open(path, 'w');
    const id = randomUUID();
    writers.set(id, { handle, path });
    return { id, path };
  });

  ipcMain.handle(IPC.fileWriterWrite, async (_event, id: string, chunk: Uint8Array, position?: number) => {
    const writer = writers.get(id);
    if (!writer) throw new Error('Writer is closed');
    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    await writer.handle.write(buffer, 0, buffer.byteLength, typeof position === 'number' ? position : null);
  });

  ipcMain.handle(IPC.fileWriterClose, async (_event, id: string, abort?: boolean) => {
    const writer = writers.get(id);
    if (!writer) return;
    writers.delete(id);
    await writer.handle.close();
    if (abort) {
      const { unlink } = await import('node:fs/promises');
      await unlink(writer.path).catch(() => undefined);
    }
  });

  ipcMain.handle(IPC.fileRecentList, () => recentStore.get().files);

  // Sent by the preload with paths of genuine File objects (file picker / drag and drop).
  ipcMain.on(IPC.grantPath, (_event, path: string) => {
    if (typeof path === 'string') grantPath(path);
  });

  ipcMain.handle(IPC.fileRecentAdd, (_event, entry: Omit<RecentFile, 'openedAt'>) => {
    if (!entry || typeof entry.path !== 'string') return;
    const path = resolve(entry.path);
    if (!OPENABLE_EXTENSIONS.has(extname(path).toLowerCase())) return;
    const known = recentStore.get().files.some((f) => f.path === path);
    if (!grantedPaths.has(path) && !known) return; // never trust arbitrary renderer-supplied paths
    addRecent({ ...entry, path });
  });

  ipcMain.handle(IPC.fileRecentRead, async (_event, path: string) => {
    const target = resolve(String(path));
    const known = recentStore.get().files.some((f) => f.path === target);
    if (!known || !OPENABLE_EXTENSIONS.has(extname(target).toLowerCase())) return null;
    try {
      const info = await stat(target);
      if (!info.isFile() || info.size > MAX_RECENT_READ_BYTES) return null;
      const data = await readFile(target);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.fileRecentClear, () => {
    recentStore.update({ files: [] });
  });
}

export async function closeAllWriters(): Promise<void> {
  for (const [id, writer] of writers) {
    writers.delete(id);
    await writer.handle.close().catch(() => undefined);
  }
}
