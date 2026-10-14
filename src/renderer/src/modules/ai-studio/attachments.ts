/**
 * Turning picked/dropped/pasted files into chat attachments (DOM).
 */
import type { AIImage } from '@shared/ai-types';
import { canvasToBlob, createCanvas, get2d, loadImage } from '../../core/utils/image';
import { blobToBase64 } from '../../core/utils/base64';
import { fileExtension } from '../../core/utils/format';
import { uid } from '../../core/utils/id';
import { t } from '../../core/i18n';
import type { Attachment } from './types';

export const ATTACH_ACCEPT = 'image/*,.txt,.md,.markdown,.csv,.tsv,.json,.srt,.vtt,.svg,.html,.css,.js,.ts,.xml,.yaml,.yml,.log,.gpl';
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'srt', 'vtt', 'svg', 'html', 'htm', 'css', 'js', 'ts', 'xml', 'yaml', 'yml', 'log', 'gpl'];
const MAX_TEXT_CHARS = 200_000;
const MAX_IMAGE_SIDE = 1568;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

async function scaledDataUrl(img: HTMLImageElement, maxSide: number, type: 'image/jpeg' | 'image/png', quality = 0.9): Promise<string> {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const canvas = createCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  const ctx = get2d(canvas);
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, type, quality);
  return `data:${type};base64,${await blobToBase64(blob)}`;
}

export function isAttachable(file: File): boolean {
  const ext = fileExtension(file.name);
  return (file.type.startsWith('image/') && ext !== 'svg') || TEXT_EXT.includes(ext) || file.type.startsWith('text/');
}

/** Reads a file as an image attachment (downscaled) or a text attachment (capped). */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const ext = fileExtension(file.name);
  if (file.type.startsWith('image/') && ext !== 'svg') {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(t('The image is too large (max 25 MB)'));
    const img = await loadImage(file);
    const keepPng = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024;
    const dataUrl = await scaledDataUrl(img, MAX_IMAGE_SIDE, keepPng ? 'image/png' : 'image/jpeg');
    const thumb = await scaledDataUrl(img, 160, 'image/jpeg', 0.7);
    return { id: uid('att'), kind: 'image', name: file.name || 'image.png', mime: keepPng ? 'image/png' : 'image/jpeg', size: file.size, dataUrl, thumb };
  }
  if (TEXT_EXT.includes(ext) || file.type.startsWith('text/')) {
    const text = await file.text();
    return {
      id: uid('att'),
      kind: 'text',
      name: file.name,
      mime: file.type || 'text/plain',
      size: file.size,
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated: text.length > MAX_TEXT_CHARS,
    };
  }
  throw new Error(t('Only images and text files (.txt, .md, .csv, .json, .srt…) can be attached'));
}

/** Image attachment from a data/object URL (handoffs from other modules). */
export async function urlToAttachment(url: string, name = 'image.png'): Promise<Attachment> {
  const img = await loadImage(url);
  const dataUrl = await scaledDataUrl(img, MAX_IMAGE_SIDE, 'image/png');
  const thumb = await scaledDataUrl(img, 160, 'image/jpeg', 0.7);
  return { id: uid('att'), kind: 'image', name, mime: 'image/png', size: Math.round((dataUrl.length * 3) / 4), dataUrl, thumb };
}

export function textAttachment(name: string, text: string): Attachment {
  return { id: uid('att'), kind: 'text', name, mime: 'text/plain', size: text.length, text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS };
}

/** AIImage payload of an image attachment (null when the image data is no longer available). */
export function attachmentToAIImage(a: Attachment): AIImage | null {
  if (a.kind !== 'image' || !a.dataUrl) return null;
  const m = /^data:([^;,]+);base64,(.*)$/.exec(a.dataUrl);
  return m ? { mime: m[1], base64: m[2], name: a.name } : null;
}
