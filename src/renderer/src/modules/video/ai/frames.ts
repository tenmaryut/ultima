import type { AIImage } from '@shared/ai-types';
import { canvasToAIImage, createCanvas, get2d } from '../../../core/utils/image';
import { Compositor, frameNeeds, type FrameProvider } from '../compositor';
import { getMedia } from '../model';
import { sourceAt } from '../keyframes';
import type { Clip, MediaRef, Project } from '../types';

/* Lets the AI assistant see the timeline: frames from every clip, and the final picture at chosen times. */

export interface FrameSample {
  clipId: string;
  mediaId: string;
  /** Timeline time of the frame (seconds). */
  time: number;
  /** Time in the source media (seconds; 0 for stills). */
  sourceTime: number;
}

export interface FramePlan {
  samples: FrameSample[];
  /** Clips with at least one frame. */
  clipsShown: number;
  /** All clips that have pictures (video and image clips). */
  clipsTotal: number;
}

/** Tiles in all sheets of one request. */
export const MAX_FRAME_TILES = 36;
/** Most moments one "look" can ask for. */
export const MAX_LOOK_TIMES = 12;

/** Frames a clip deserves by its length: one for short clips, up to three for long ones. */
function framesWanted(c: Clip): number {
  if (c.kind === 'image') return 1;
  return c.duration < 1.5 ? 1 : c.duration < 6 ? 2 : 3;
}

/**
 * Picks the frames to show: every video and image clip in timeline order gets one, and tiles left
 * over go to the longest clips. Past `maxTiles` clips, the later clips are left out.
 */
export function planClipFrames(p: Project, maxTiles = MAX_FRAME_TILES): FramePlan {
  const trackIndex = (c: Clip) => p.tracks.findIndex((t) => t.id === c.trackId);
  const clips = p.clips
    .filter((c) => (c.kind === 'video' || c.kind === 'image') && getMedia(p, c.mediaId))
    .sort((a, b) => a.start - b.start || trackIndex(a) - trackIndex(b));
  const shown = clips.slice(0, Math.max(0, maxTiles));
  const counts = shown.map(() => 1);
  let spare = maxTiles - shown.length;
  for (let round = 2; round <= 3 && spare > 0; round++) {
    const longest = shown
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => framesWanted(c) >= round)
      .sort((a, b) => b.c.duration - a.c.duration);
    for (const { i } of longest) {
      if (spare <= 0) break;
      counts[i]++;
      spare--;
    }
  }
  const samples: FrameSample[] = [];
  shown.forEach((c, i) => {
    const media = getMedia(p, c.mediaId)!;
    for (let k = 0; k < counts[i]; k++) {
      const time = c.start + (c.duration * (k + 0.5)) / counts[i];
      // speed curves, reverse and freeze frames decide which source frame is shown
      const sourceTime = c.kind === 'image' ? 0 : Math.min(Math.max(0, sourceAt(c, time - c.start)), Math.max(0, media.duration - 0.05));
      samples.push({ clipId: c.id, mediaId: media.id, time, sourceTime });
    }
  });
  return { samples, clipsShown: shown.length, clipsTotal: clips.length };
}

export interface SheetLayout {
  cols: number;
  rows: number;
  cellWidth: number;
  frameHeight: number;
  labelHeight: number;
}

/** Tiles shaped like the project frame, about `rowWidth` px per row. */
export function sheetLayout(aspect: number, frameHeight = 180, rowWidth = 1440, rows = 3): SheetLayout {
  const cellWidth = Math.round(frameHeight * Math.min(21 / 9, Math.max(9 / 16, aspect || 16 / 9)));
  const cols = Math.min(8, Math.max(2, Math.floor(rowWidth / cellWidth)));
  return { cols, rows, cellWidth, frameHeight, labelHeight: 22 };
}

/** One label per tile, matching the ids and seconds of the project summary. */
export const frameLabel = (s: FrameSample) => `${s.clipId} · ${s.time.toFixed(1)} s`;

interface Tile {
  frame: CanvasImageSource | null;
  label: string;
}

function drawSheet(tiles: Tile[], layout: SheetLayout): HTMLCanvasElement {
  const { cellWidth, frameHeight, labelHeight } = layout;
  const cols = Math.min(layout.cols, Math.max(1, tiles.length));
  const rows = Math.ceil(tiles.length / cols);
  const cellHeight = frameHeight + labelHeight;
  const canvas = createCanvas(cols * cellWidth, rows * cellHeight);
  const ctx = get2d(canvas);
  ctx.fillStyle = '#16171b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';
  tiles.forEach(({ frame, label }, i) => {
    const x = (i % cols) * cellWidth;
    const y = Math.floor(i / cols) * cellHeight;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 1, y + 1, cellWidth - 2, frameHeight - 1);
    if (frame) {
      const fw = (frame as HTMLCanvasElement).width || cellWidth;
      const fh = (frame as HTMLCanvasElement).height || frameHeight;
      const scale = Math.min((cellWidth - 2) / fw, (frameHeight - 1) / fh);
      const w = fw * scale;
      const h = fh * scale;
      ctx.drawImage(frame, x + (cellWidth - w) / 2, y + 1 + (frameHeight - 1 - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#8a8f98';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('no frame', x + cellWidth / 2, y + frameHeight / 2);
    }
    ctx.fillStyle = '#26282e';
    ctx.fillRect(x + 1, y + frameHeight, cellWidth - 2, labelHeight - 1);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 6, y + frameHeight + labelHeight / 2, cellWidth - 12);
  });
  return canvas;
}

/** Fetches frames: `times` are source seconds of one media item, answered in the same order. */
export type FrameSource = (media: MediaRef, times: number[], height: number) => Promise<(CanvasImageSource | null)[]>;

/** Fetches many (media, source time) frames, one request per media item. */
async function fetchFrames(p: Project, wanted: { mediaId: string; sourceTime: number }[], frames: FrameSource, height: number): Promise<Map<string, CanvasImageSource | null>> {
  const key = (mediaId: string, t: number) => `${mediaId}|${t.toFixed(3)}`;
  const byMedia = new Map<string, number[]>();
  for (const w of wanted) {
    const list = byMedia.get(w.mediaId) ?? [];
    if (!list.some((t) => key(w.mediaId, t) === key(w.mediaId, w.sourceTime))) list.push(w.sourceTime);
    byMedia.set(w.mediaId, list);
  }
  const out = new Map<string, CanvasImageSource | null>();
  for (const [mediaId, times] of byMedia) {
    const media = getMedia(p, mediaId);
    if (!media) continue;
    const sorted = [...times].sort((a, b) => a - b);
    const got = await frames(media, sorted, height).catch(() => []);
    sorted.forEach((t, i) => out.set(key(mediaId, t), got[i] ?? null));
  }
  return out;
}

/**
 * Frame sheets of the whole timeline for AIs that understand images, with the sentence that
 * explains them. Null when the timeline has no video or image clips.
 */
export async function clipFrameSheets(p: Project, frames: FrameSource): Promise<{ images: AIImage[]; note: string } | null> {
  const plan = planClipFrames(p);
  if (!plan.samples.length) return null;
  const layout = sheetLayout(p.settings.width / p.settings.height);
  const found = await fetchFrames(p, plan.samples, frames, layout.frameHeight);
  const perSheet = layout.cols * layout.rows;
  const images: AIImage[] = [];
  for (let i = 0; i < plan.samples.length; i += perSheet) {
    const tiles = plan.samples.slice(i, i + perSheet).map((s) => ({ frame: found.get(`${s.mediaId}|${s.sourceTime.toFixed(3)}`) ?? null, label: frameLabel(s) }));
    images.push(await canvasToAIImage(drawSheet(tiles, layout), { maxSize: 1600 }));
  }
  const left = plan.clipsTotal - plan.clipsShown;
  const note =
    'frame sheets of the timeline, in timeline order. Each tile is a frame from one video or image clip, labelled "<clip id> · <timeline time> s"; ' +
    'longer clips get up to three tiles.' +
    (left ? ` The last ${left} clip(s) are not shown.` : '');
  return { images, note };
}

/**
 * The final picture (all tracks, titles, effects and transitions) at timeline times, drawn by the
 * same compositor as the export, `height` px tall.
 */
export async function programFrames(
  p: Project,
  times: number[],
  frames: FrameSource,
  still: (mediaId: string) => CanvasImageSource | null,
  height = 300,
): Promise<HTMLCanvasElement[]> {
  const scale = height / p.settings.height;
  const w = Math.max(16, Math.round(p.settings.width * scale));
  const h = Math.max(16, Math.round(height));
  const needs = times.map((t) => frameNeeds(p, t));
  const wanted = needs.flat().map((n) => ({ mediaId: n.clip.mediaId ?? '', sourceTime: n.sourceTime }));
  const found = await fetchFrames(p, wanted, frames, h);
  const provider: FrameProvider = {
    video: (clip, sourceTime) => found.get(`${clip.mediaId ?? ''}|${sourceTime.toFixed(3)}`) ?? null,
    image: (mediaId) => still(mediaId),
  };
  const compositor = new Compositor();
  return times.map((t) => {
    const canvas = createCanvas(w, h);
    compositor.render(get2d(canvas), p, t, provider, { scale, captions: true });
    return canvas;
  });
}

/** The pictures for a "look" request, as one labelled sheet, and the sentence that explains it. */
export async function lookSheet(
  p: Project,
  times: number[],
  frames: FrameSource,
  still: (mediaId: string) => CanvasImageSource | null,
): Promise<{ images: AIImage[]; note: string }> {
  const list = [...new Set(times.filter((t) => Number.isFinite(t)).map((t) => Math.max(0, +t.toFixed(3))))].slice(0, MAX_LOOK_TIMES).sort((a, b) => a - b);
  if (!list.length) return { images: [], note: 'no valid times to look at' };
  const pictures = await programFrames(p, list, frames, still, 300);
  const layout = sheetLayout(p.settings.width / p.settings.height, 300, 1600, Math.ceil(list.length / 3));
  const sheet = drawSheet(
    pictures.map((frame, i) => ({ frame, label: `t = ${list[i].toFixed(2)} s` })),
    { ...layout, cols: Math.min(layout.cols, 3) },
  );
  return {
    images: [await canvasToAIImage(sheet, { maxSize: 1600 })],
    note: `the final picture at ${list.map((t) => `${t.toFixed(2)} s`).join(', ')} (each tile is labelled with its time).`,
  };
}
