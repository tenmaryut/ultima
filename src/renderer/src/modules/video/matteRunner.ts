import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { ClipMatte, MediaRef } from './types';
import { desktop } from '../../core/platform';
import { uid } from '../../core/utils/id';

/* Cuts the subject out of a video: its frames (at most 512 px) go to rembg on this computer in batches; the grey
 * masks that come back become the alpha of small PNGs, one per source frame. */

export interface MatteJob {
  file: File;
  media: MediaRef;
  /** Source seconds to cut out. */
  from: number;
  to: number;
  model: ClipMatte['model'];
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** 30 s at 30 fps. */
export const MAX_MATTE_FRAMES = 900;
const BATCH = 30;
const abortError = () => new DOMException('Cut-out cancelled', 'AbortError');

async function pngOf(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode a frame');
  return new Uint8Array(await blob.arrayBuffer());
}

/** A grey mask (white = subject) as a base64 PNG whose alpha is the mask. */
async function alphaPng(mask: Uint8Array, w: number, h: number, scratch: HTMLCanvasElement): Promise<string> {
  const bmp = await createImageBitmap(new Blob([mask as BlobPart], { type: 'image/png' }));
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i];
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return scratch.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

export async function makeMatte(job: MatteJob): Promise<ClipMatte> {
  const api = desktop?.tools;
  if (!api) throw new Error('Cutting out needs the desktop app with rembg installed.');
  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('This video cannot be decoded here.');
    const sw = job.media.width || track.displayWidth || 1280;
    const sh = job.media.height || track.displayHeight || 720;
    const k = Math.min(1, 512 / Math.max(sw, sh));
    const w = Math.max(16, Math.round(sw * k));
    const h = Math.max(16, Math.round(sh * k));
    const fps = Math.min(30, job.media.fps || 30);
    const first = Math.max(0, Math.floor(job.from * fps + 1e-3));
    const last = Math.max(first, Math.min(first + MAX_MATTE_FRAMES - 1, Math.floor(job.to * fps - 1e-3)));
    const times = Array.from({ length: last - first + 1 }, (_, i) => (first + i + 0.5) / fps);
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
    const frame = document.createElement('canvas');
    frame.width = w;
    frame.height = h;
    const fctx = frame.getContext('2d')!;
    const scratch = document.createElement('canvas');
    const masks: string[] = [];
    let batch: Uint8Array[] = [];
    const send = async () => {
      if (!batch.length) return;
      if (job.signal?.aborted) throw abortError();
      const requestId = uid('mt_');
      const stop = () => void api.cancelMatte(requestId);
      job.signal?.addEventListener('abort', stop, { once: true });
      const res = await api.matte({ requestId, model: job.model, frames: batch }).finally(() => job.signal?.removeEventListener('abort', stop));
      if (job.signal?.aborted) throw abortError();
      if (!res.ok || !res.masks) throw new Error(res.error || 'rembg failed');
      for (const m of res.masks) masks.push(await alphaPng(m, w, h, scratch));
      batch = [];
      job.onProgress?.(masks.length / times.length);
    };
    let decoded = false;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (job.signal?.aborted) throw abortError();
      // a frame that can't be decoded repeats the one before (still in `frame`), so masks stay in step with time
      if (wc) {
        fctx.clearRect(0, 0, w, h);
        fctx.drawImage(wc.canvas as CanvasImageSource, 0, 0, w, h);
        decoded = true;
      }
      if (!decoded) fctx.clearRect(0, 0, w, h);
      batch.push(await pngOf(frame));
      if (batch.length >= BATCH) await send();
    }
    await send();
    job.onProgress?.(1);
    return { start: first / fps, fps, w, h, frames: masks, model: job.model };
  } finally {
    input.dispose();
  }
}
