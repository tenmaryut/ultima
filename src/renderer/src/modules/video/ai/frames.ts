import { matteAtAsync } from '../matte';
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
  /** Draw a coordinate grid; the tile shows this part of the whole picture (fractions). */
  grid?: LookRegion;
}

/** Lines every tenth of the tile, labelled with the position in the whole picture (0-1), so places can be read exactly. */
function drawGrid(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, r: LookRegion) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const label = (text: string, x: number, y: number) => {
    const tw = ctx.measureText(text).width + 6;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x, y, tw, 14);
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(text, x + 3, y + 1);
  };
  for (let i = 1; i < 10; i++) {
    const gx = Math.round(x0 + (w * i) / 10) + 0.5;
    const gy = Math.round(y0 + (h * i) / 10) + 0.5;
    ctx.strokeStyle = i === 5 ? 'rgba(255, 225, 77, 0.55)' : 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(gx, y0);
    ctx.lineTo(gx, y0 + h);
    ctx.moveTo(x0, gy);
    ctx.lineTo(x0 + w, gy);
    ctx.stroke();
  }
  for (let i = 1; i < 10; i++) {
    const fx = r.x + (r.w * i) / 10;
    const fy = r.y + (r.h * i) / 10;
    const digits = r.w < 1 || r.h < 1 ? 2 : 1;
    label(fx.toFixed(digits), x0 + (w * i) / 10 + 2, y0 + 2);
    label(fy.toFixed(digits), x0 + 2, y0 + (h * i) / 10 + 2);
  }
  ctx.restore();
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
  tiles.forEach(({ frame, label, grid }, i) => {
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
      if (grid) drawGrid(ctx, x + (cellWidth - w) / 2, y + 1 + (frameHeight - 1 - h) / 2, w, h, grid);
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
  // cut-out masks, decoded before drawing
  const mattes = new Map<string, CanvasImageSource | null>();
  for (const [i, t] of times.entries()) for (const n of needs[i]) if (n.clip.matte) mattes.set(`${n.clip.id}|${t}`, await matteAtAsync(n.clip, t));
  let now = 0;
  const provider: FrameProvider = {
    video: (clip, sourceTime) => found.get(`${clip.mediaId ?? ''}|${sourceTime.toFixed(3)}`) ?? null,
    image: (mediaId) => still(mediaId),
    matte: (clip) => mattes.get(`${clip.id}|${now}`) ?? null,
  };
  const compositor = new Compositor();
  return times.map((t) => {
    const canvas = createCanvas(w, h);
    now = t;
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
  grid = false,
): Promise<{ images: AIImage[]; note: string }> {
  const list = [...new Set(times.filter((t) => Number.isFinite(t)).map((t) => Math.max(0, +t.toFixed(3))))].slice(0, MAX_LOOK_TIMES).sort((a, b) => a - b);
  if (!list.length) return { images: [], note: 'no valid times to look at' };
  const pictures = await programFrames(p, list, frames, still, 300);
  const layout = sheetLayout(p.settings.width / p.settings.height, 300, 1600, Math.ceil(list.length / 3));
  const sheet = drawSheet(
    pictures.map((frame, i) => ({ frame, label: `t = ${list[i].toFixed(2)} s`, grid: grid ? WHOLE : undefined })),
    { ...layout, cols: Math.min(layout.cols, 3) },
  );
  return {
    images: [await canvasToAIImage(sheet, { maxSize: 1600 })],
    note: `the final picture at ${list.map((t) => `${t.toFixed(2)} s`).join(', ')} (each tile is labelled with its time${grid ? '; the yellow numbers on the grid are x (top) and y (left) as fractions of the picture' : ''}).`,
  };
}

/* ------------------------------ looking at source clips ------------------------------ */

/** A part of the picture, as fractions of its width and height (x, y: top-left corner). */
export interface LookRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WHOLE: LookRegion = { x: 0, y: 0, w: 1, h: 1 };

/** Named parts of the picture: the corners where games put their HUD (kill feed, score, minimap) and the crosshair. */
export const LOOK_REGIONS: Record<string, LookRegion> = {
  center: { x: 0.3, y: 0.25, w: 0.4, h: 0.5 },
  topLeft: { x: 0, y: 0, w: 0.4, h: 0.34 },
  topCenter: { x: 0.3, y: 0, w: 0.4, h: 0.2 },
  topRight: { x: 0.6, y: 0, w: 0.4, h: 0.34 },
  bottomLeft: { x: 0, y: 0.66, w: 0.4, h: 0.34 },
  bottomCenter: { x: 0.3, y: 0.62, w: 0.4, h: 0.38 },
  bottomRight: { x: 0.6, y: 0.66, w: 0.4, h: 0.34 },
};

/** Most frames one look at a source clip shows (a strip over a short range shows the motion). */
export const MAX_SOURCE_FRAMES = 16;

export interface SourceLook {
  /** Source seconds, in order. */
  times: number[];
  /** null: the whole picture. */
  region: LookRegion | null;
  regionName: string;
  /** No times were given: frames spread over the whole clip. */
  overview: boolean;
  /** Frames evenly spaced from the first to the last time (a "from"/"to" strip). */
  strip: boolean;
  /** A coordinate grid over the pictures. */
  grid: boolean;
}

const numberOf = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The region of a look: a name from LOOK_REGIONS or {"x","y","w","h"} (0-1); anything else is the whole picture. */
export function lookRegion(v: unknown): { region: LookRegion | null; name: string } {
  if (typeof v === 'string' && LOOK_REGIONS[v]) return { region: LOOK_REGIONS[v], name: v };
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const x = clampTo(numberOf(o.x) ?? 0, 0, 0.95);
    const y = clampTo(numberOf(o.y) ?? 0, 0, 0.95);
    const w = clampTo(numberOf(o.w) ?? 1 - x, 0.05, 1 - x);
    const h = clampTo(numberOf(o.h) ?? 1 - y, 0.05, 1 - y);
    if (w > 0.999 && h > 0.999) return { region: null, name: 'full' };
    const f = (n: number) => +n.toFixed(2);
    return { region: { x, y, w, h }, name: `x ${f(x)} y ${f(y)} w ${f(w)} h ${f(h)}` };
  }
  return { region: null, name: 'full' };
}

/**
 * Which source frames a look at a clip shows: "times" (up to 16), or "from"/"to" with "frames" (2-16, default 8,
 * evenly spaced: the motion in between), or "time" for one frame; nothing: an overview of the whole clip.
 */
export function planSourceLook(a: Record<string, unknown>, duration: number): SourceLook {
  const { region, name } = lookRegion(a.region);
  const last = Math.max(0, duration - 0.04);
  const at = (t: number) => clampTo(t, 0, last);
  let times: number[] = [];
  let overview = false;
  let strip = false;
  const from = numberOf(a.from);
  const to = numberOf(a.to);
  if (Array.isArray(a.times) && a.times.length) {
    times = a.times.map(numberOf).filter((t): t is number => t !== undefined).map(at);
  } else if (from !== undefined || to !== undefined) {
    const start = at(from ?? Math.max(0, (to ?? 0) - 2));
    let end = at(to ?? start + 2);
    if (end <= start) end = at(start + 1);
    const n = Math.round(clampTo(numberOf(a.frames) ?? 8, 2, MAX_SOURCE_FRAMES));
    times = end > start ? Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1)) : [start];
    strip = times.length > 1;
  } else if (numberOf(a.time) !== undefined) {
    times = [at(numberOf(a.time)!)];
  } else {
    overview = true;
    const n = Math.round(clampTo(duration / 5, 4, 12));
    times = duration > 0 ? Array.from({ length: n }, (_, i) => at(((i + 0.5) / n) * duration)) : [0];
  }
  times = [...new Set(times.map((t) => +t.toFixed(3)))].sort((x, y) => x - y).slice(0, MAX_SOURCE_FRAMES);
  return { times, region, regionName: name, overview, strip, grid: a.grid === true };
}

/** Tiles for `n` frames of this aspect: as big as a 1600 × 1600 px sheet allows (a single frame fills it). */
export function sourceSheetLayout(n: number, aspect: number): SheetLayout {
  const a = clampTo(aspect || 16 / 9, 0.2, 5);
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(n / cols));
  const labelHeight = 22;
  let cellWidth = Math.floor(1600 / cols);
  let frameHeight = Math.round(cellWidth / a);
  const maxHeight = Math.floor(1600 / rows) - labelHeight;
  if (frameHeight > maxHeight) {
    frameHeight = maxHeight;
    cellWidth = Math.min(cellWidth, Math.round(frameHeight * a));
  }
  return { cols, rows, cellWidth, frameHeight, labelHeight };
}

/** The region of a frame as its own canvas (the frame itself when the region is the whole picture). */
function cropFrame(frame: CanvasImageSource, r: LookRegion | null): CanvasImageSource {
  if (!r) return frame;
  const fw = (frame as HTMLCanvasElement).width || 1;
  const fh = (frame as HTMLCanvasElement).height || 1;
  const sw = Math.max(1, Math.round(r.w * fw));
  const sh = Math.max(1, Math.round(r.h * fh));
  const c = createCanvas(sw, sh);
  get2d(c).drawImage(frame, Math.round(r.x * fw), Math.round(r.y * fh), sw, sh, 0, 0, sw, sh);
  return c;
}

/** What a source look shows, in words for the AI. */
export function describeSourceLook(media: MediaRef, look: SourceLook): string {
  const list = look.times;
  const what = look.overview
    ? `an overview: ${list.length} frames spread over the whole ${media.duration.toFixed(1)} s`
    : look.strip
      ? `${list.length} frames from ${list[0].toFixed(2)} to ${list[list.length - 1].toFixed(2)} s, every ${((list[list.length - 1] - list[0]) / (list.length - 1)).toFixed(2)} s in order (read them as motion)`
      : `frames at ${list.map((t) => `${t.toFixed(2)} s`).join(', ')}`;
  const zoom = look.region ? `, zoomed into the ${look.regionName} part of the picture at full resolution` : '';
  const grid = look.grid ? '; the yellow numbers on the grid are x (top) and y (left) as fractions of the whole picture' : '';
  return `${media.id} "${media.name}" (source seconds): ${what}${zoom}; each tile is labelled "<id> · <source s>"${grid}`;
}

/** The pictures of a look at a source clip (bin or linked folder), as one sheet. */
export async function sourceLookSheet(media: MediaRef, look: SourceLook, frames: FrameSource): Promise<{ image: AIImage; note: string } | null> {
  if (!look.times.length || (media.kind !== 'video' && media.kind !== 'image')) return null;
  const r = look.region;
  const srcW = Math.max(1, media.width || 16);
  const srcH = Math.max(1, media.height || 9);
  const layout = sourceSheetLayout(look.times.length, (srcW * (r?.w ?? 1)) / (srcH * (r?.h ?? 1)));
  // enough pixels for the region to fill its tile, never more than the source has
  const height = Math.round(clampTo(layout.frameHeight / (r?.h ?? 1), 90, Math.min(srcH, 2160)));
  const got = await frames(media, look.times, height);
  const tiles = got.map((f, i) => ({ frame: f ? cropFrame(f, r) : null, label: `${media.id} · ${look.times[i].toFixed(2)} s`, grid: look.grid ? (r ?? WHOLE) : undefined }));
  const sheet = drawSheet(tiles, layout);
  return { image: await canvasToAIImage(sheet, { maxSize: 1600 }), note: describeSourceLook(media, look) };
}
