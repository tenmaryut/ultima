import { sanitizeSvg } from '../../core/ai/sanitize';
import { saveFile } from '../../core/platform';
import { bytesToBase64 } from '../../core/utils/base64';
import { fileBaseName, fileExtension } from '../../core/utils/format';
import { uid } from '../../core/utils/id';
import { canvasToBlob, createCanvas, get2d, loadImage } from '../../core/utils/image';
import { cloneFrames } from './ops';
import { createImageFrame, normFrame, parseProject, serializeDoc } from './model';
import type { Frame, ImageAsset, ImageFrame, LayoutDoc, Page, Point } from './types';

/** Largest image side kept in a project (bigger photos are downscaled once on import). */
const MAX_SIDE = 6000;

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'];

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(fileExtension(file.name));
}

export function isProjectFile(file: File): boolean {
  return fileExtension(file.name) === 'ultima';
}

async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return `data:${mime};base64,${bytesToBase64(await blob.arrayBuffer())}`;
}

function mimeFor(file: File): string {
  if (file.type.startsWith('image/')) return file.type;
  const ext = fileExtension(file.name);
  return ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext || 'png'}`;
}

/** Reads an image file into a document asset (data URL + natural size). */
export async function fileToAsset(file: File): Promise<ImageAsset> {
  const mime = mimeFor(file);
  let blob: Blob = file;
  if (mime === 'image/svg+xml') {
    const clean = sanitizeSvg(await file.text());
    if (!clean) throw new Error('This SVG file could not be read');
    blob = new Blob([clean], { type: 'image/svg+xml' });
  }
  const img = await loadImage(blob);
  let width = img.naturalWidth || 300;
  let height = img.naturalHeight || 150;
  let src: string;
  if (Math.max(width, height) > MAX_SIDE && mime !== 'image/svg+xml') {
    const s = MAX_SIDE / Math.max(width, height);
    width = Math.round(width * s);
    height = Math.round(height * s);
    const canvas = createCanvas(width, height);
    const ctx = get2d(canvas);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    const type = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    src = await blobToDataUrl(await canvasToBlob(canvas, type, 0.92), type);
  } else {
    src = await blobToDataUrl(blob, mime);
  }
  return { id: uid('a'), name: file.name, src, width, height };
}

/** Asset from a data:/blob: URL (handoffs from other modules). */
export async function urlToAsset(url: string, name = 'image'): Promise<ImageAsset> {
  const res = await fetch(url);
  const blob = await res.blob();
  const type = blob.type || 'image/png';
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png';
  return fileToAsset(new File([blob], `${fileBaseName(name) || 'image'}.${ext}`, { type }));
}

/** A frame for an asset: fitted inside the page margins (max 70% of the page), centered on `at`. */
export function frameForAsset(asset: ImageAsset, page: Page, at?: Point): ImageFrame {
  const maxW = Math.max(40, (page.width - page.margins.left - page.margins.right) * 0.9);
  const maxH = Math.max(40, (page.height - page.margins.top - page.margins.bottom) * 0.7);
  const s = Math.min(1, maxW / asset.width, maxH / asset.height);
  const w = Math.max(8, asset.width * s);
  const h = Math.max(8, asset.height * s);
  const cx = at?.x ?? page.width / 2;
  const cy = at?.y ?? page.height / 2;
  return createImageFrame({ x: cx - w / 2, y: cy - h / 2, w, h, assetId: asset.id, fit: 'fill', name: fileBaseName(asset.name) || 'Image' });
}

export async function readProjectFile(file: File): Promise<LayoutDoc> {
  return parseProject(await file.text());
}

export async function saveProject(doc: LayoutDoc, path?: string): Promise<{ path?: string } | null> {
  const name = `${(doc.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-')}.ultima`;
  return saveFile(new Blob([serializeDoc(doc)], { type: 'application/json' }), {
    suggestedName: name,
    filters: [{ name: 'Ultima project', extensions: ['ultima'] }],
    path,
  });
}

/* --------------------------------- Clipboard -------------------------------- */

const CLIP_MARK = 'ultima-layout-clipboard';

export interface ClipboardData {
  frames: Frame[];
  assets: Record<string, ImageAsset>;
  sourcePage: string;
}

let internalClipboard: ClipboardData | null = null;

export function setClipboard(data: ClipboardData): string {
  internalClipboard = data;
  // text form for the system clipboard (assets are kept in memory only, to keep it small)
  return JSON.stringify({ [CLIP_MARK]: 1, frames: data.frames });
}

export function getInternalClipboard(): ClipboardData | null {
  return internalClipboard;
}

/** Parses frames copied from Ultima Layout (possibly in another window/session). */
export function parseClipboardText(text: string): Frame[] | null {
  if (!text.includes(CLIP_MARK)) return null;
  try {
    const data = JSON.parse(text) as { frames?: unknown[] };
    if (!Array.isArray(data.frames)) return null;
    const frames = data.frames.map((f) => normFrame(f)).filter((f): f is Frame => Boolean(f));
    return frames.length ? frames : null;
  } catch {
    return null;
  }
}

/** Frames + assets ready to insert into `doc` (fresh ids; missing assets dropped). */
export function prepareFramesForPaste(doc: LayoutDoc, data: ClipboardData, offset: number): { frames: Frame[]; assets: Record<string, ImageAsset> } {
  const { frames } = cloneFrames(data.frames);
  const assets: Record<string, ImageAsset> = {};
  const out = frames.map((f) => {
    const moved = { ...f, x: f.x + offset, y: f.y + offset };
    if (moved.type === 'image' && moved.assetId) {
      const a = doc.assets[moved.assetId] ?? data.assets[moved.assetId];
      if (a) assets[a.id] = a;
      else return { ...moved, assetId: null };
    }
    return moved;
  });
  return { frames: out, assets };
}
