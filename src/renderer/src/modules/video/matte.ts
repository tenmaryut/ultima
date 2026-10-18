import type { Clip, ClipMatte } from './types';
import { sourceAt } from './keyframes';

/*
 * Cut-out subjects: decoding the masks of a clip's matte (once, shared by the preview, the export and the AI's looks)
 * and finding the mask for a moment of the clip.
 */

type Slot = ImageBitmap | Promise<ImageBitmap | null> | null;
const decoded = new WeakMap<ClipMatte, Slot[]>();
const listeners = new Set<() => void>();

/** Called whenever a mask finished decoding (the preview draws again). */
export function onMatteReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The mask shown at `sourceTime` (the nearest one). */
export function matteIndex(m: ClipMatte, sourceTime: number): number {
  return Math.min(m.frames.length - 1, Math.max(0, Math.round((sourceTime - m.start) * m.fps - 0.5)));
}

function decode(m: ClipMatte, i: number): Promise<ImageBitmap | null> {
  const bin = atob(m.frames[i]);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return createImageBitmap(new Blob([bytes], { type: 'image/png' })).catch(() => null);
}

function slotsOf(m: ClipMatte): Slot[] {
  let slots = decoded.get(m);
  if (!slots) {
    slots = new Array<Slot>(m.frames.length).fill(null);
    decoded.set(m, slots);
  }
  return slots;
}

/** The decoded mask `i`, or null while it is being decoded (it starts decoding, and tells the listeners when ready). */
export function matteFrame(m: ClipMatte, i: number): ImageBitmap | null {
  const slots = slotsOf(m);
  const s = slots[i];
  if (s instanceof ImageBitmap) return s;
  if (!s) {
    slots[i] = decode(m, i).then((bmp) => {
      slots[i] = bmp;
      for (const cb of listeners) cb();
      return bmp;
    });
    // decode the next ones too, playback is about to need them
    for (let k = i + 1; k < Math.min(m.frames.length, i + 8); k++) if (!slots[k]) void matteFrameAsync(m, k);
  }
  return null;
}

/** The decoded mask `i` (waits for it). */
export async function matteFrameAsync(m: ClipMatte, i: number): Promise<ImageBitmap | null> {
  const slots = slotsOf(m);
  const s = slots[i];
  if (s instanceof ImageBitmap) return s;
  if (s) return s;
  slots[i] = decode(m, i).then((bmp) => (slots[i] = bmp));
  return slots[i] as Promise<ImageBitmap | null>;
}

/** The mask for a clip at timeline time `t` (null without a matte or while decoding). */
export function matteAt(clip: Clip, t: number): ImageBitmap | null {
  const m = clip.matte;
  if (!m) return null;
  return matteFrame(m, matteIndex(m, sourceAt(clip, Math.min(Math.max(0, t - clip.start), clip.duration))));
}

/** The same, waiting for the decode (export, looks). */
export async function matteAtAsync(clip: Clip, t: number): Promise<ImageBitmap | null> {
  const m = clip.matte;
  if (!m) return null;
  return matteFrameAsync(m, matteIndex(m, sourceAt(clip, Math.min(Math.max(0, t - clip.start), clip.duration))));
}
