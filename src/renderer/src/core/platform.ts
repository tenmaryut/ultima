import type { FileFilter, UltimaDesktopAPI } from '@shared/ipc';

/**
 * Platform abstraction. Everything here works both in the desktop app (Electron,
 * `window.ultima` present) and in a plain browser (web build / tests).
 */

export const desktop: UltimaDesktopAPI | undefined = typeof window !== 'undefined' ? window.ultima : undefined;
export const isDesktop = Boolean(desktop);
export const isMac =
  typeof navigator !== 'undefined' && /mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform);

/** Shows the native file picker. `accept` uses the HTML accept syntax, e.g. "image/*,.psd". */
export function pickFiles(options: { accept?: string; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options.accept) input.accept = options.accept;
    input.multiple = Boolean(options.multiple);
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** Absolute path of a picked/dropped file (desktop only). */
export function pathForFile(file: File): string | undefined {
  return desktop?.files.getPathForFile(file) || undefined;
}

export type SaveData = Blob | ArrayBuffer | Uint8Array | string;

export interface SaveOptions {
  suggestedName: string;
  filters?: FileFilter[];
  /** Save to this path without asking (desktop; only for paths picked earlier in this session). */
  path?: string;
  /** An export: desktop saves it in the export folder without asking (unless the user wants a dialog); the browser downloads it. */
  toExportFolder?: boolean;
}

async function toArrayBuffer(data: SaveData): Promise<ArrayBuffer | Uint8Array | string> {
  if (data instanceof Blob) return data.arrayBuffer();
  return data;
}

/**
 * Saves data to disk. Desktop: native save dialog. Browser: File System Access API when
 * available, otherwise a regular download. Returns null when the user cancelled.
 */
export async function saveFile(data: SaveData, options: SaveOptions): Promise<{ path?: string } | null> {
  if (desktop) {
    const result = await desktop.files.save({ ...options, data: await toArrayBuffer(data) });
    return result ? { path: result.path } : null;
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker;
  if (picker && !options.toExportFolder) {
    try {
      const handle = await picker({
        suggestedName: options.suggestedName,
        types: options.filters?.map((f) => ({
          description: f.name,
          accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) },
        })),
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return {};
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return null;
      // fall through to download
    }
  }
  downloadBlob(blob, options.suggestedName);
  return {};
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Streaming writer for very large exports (video). Falls back to memory + download in the browser. */
export interface FileWriter {
  path?: string;
  write(chunk: Uint8Array, position?: number): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export async function createFileWriter(options: { suggestedName: string; filters?: FileFilter[]; toExportFolder?: boolean }): Promise<FileWriter | null> {
  if (desktop) {
    const opened = await desktop.files.openWriter(options);
    if (!opened) return null;
    return {
      path: opened.path,
      write: (chunk, position) => desktop.files.write(opened.id, chunk, position),
      close: () => desktop.files.closeWriter(opened.id),
      abort: () => desktop.files.closeWriter(opened.id, true),
    };
  }
  // Browser: keep chunks (with positions) in memory and download on close.
  const parts: { data: Uint8Array; position: number }[] = [];
  let cursor = 0;
  let size = 0;
  return {
    write: async (chunk, position) => {
      const pos = typeof position === 'number' ? position : cursor;
      parts.push({ data: chunk.slice(), position: pos });
      cursor = pos + chunk.byteLength;
      size = Math.max(size, cursor);
    },
    close: async () => {
      const out = new Uint8Array(size);
      for (const p of parts) out.set(p.data, p.position);
      downloadBlob(new Blob([out]), options.suggestedName);
    },
    abort: async () => {
      parts.length = 0;
    },
  };
}

export function openExternal(url: string): void {
  if (desktop) void desktop.app.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function setWindowTitle(title: string): void {
  if (desktop) desktop.app.setTitle(title);
  document.title = title;
}

/** Fonts installed on the system (Local Font Access API), with a safe fallback list. */
export async function listSystemFonts(): Promise<string[]> {
  const fallback = [
    'Inter',
    'Arial',
    'Helvetica',
    'Times New Roman',
    'Georgia',
    'Courier New',
    'Verdana',
    'Trebuchet MS',
    'Impact',
    'Comic Sans MS',
    'system-ui',
    'serif',
    'sans-serif',
    'monospace',
  ];
  const query = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
  if (!query) return fallback;
  try {
    const fonts = await query();
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    return families.length ? families : fallback;
  } catch {
    return fallback;
  }
}
