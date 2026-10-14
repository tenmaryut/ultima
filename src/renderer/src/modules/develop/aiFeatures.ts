/**
 * AI features of Photo Develop: assistant context + action executor, "AI Auto Edit" for
 * the selection, "Describe a look" and AI rating/culling suggestions. All answers are
 * validated (ai.ts) before anything is applied.
 */
import type { AIImage } from '@shared/ai-types';
import { providerSupportsImages, resolveProvider, runAIJson } from '../../core/ai/client';
import { t } from '../../core/i18n';
import { canvasToAIImage } from '../../core/utils/image';
import { LOOK_SCHEMA_HINT, parseCullAnswer, parseLookAnswer, validateActions, type AIActionInput, type AIOp, type CullSuggestion } from './ai';
import { bitmapPixels, getPreview, getStats } from './decode';
import { cameraName, formatAperture, formatFocal, formatShutter } from './exif';
import { cropToPx, fitCropToImage, geometry, orientedSize, pxToCrop } from './geometry';
import { autoTone, describeHistogram } from './histogram';
import {
  CURVE_KEYS,
  GROUPS,
  clampParam,
  defaultSettings,
  mergeSettings,
  nonDefault,
  resetGroups,
  type DevelopSettings,
  type GroupId,
  type NumericKey,
} from './params';
import { allPresets, applyPresetSettings } from './presets';
import { renderSmall } from './render';
import { applyToPhotos, getPhoto, selectedIds, setFlag, setLabel, setRating, useDevelop } from './store';
import { canDevelop, displayName, type Photo } from './types';
import { flipSettings, rotateSettings, withAspect, withStraighten } from './ops';
import { solveWhiteBalance, srgbToLinear, type Vec3 } from './color';

const LOOK_GROUPS: GroupId[] = GROUPS.map((g) => g.id).filter((g) => g !== 'transform');

export function photoDescription(p: Photo): string {
  const e = p.exif;
  const parts = [
    `"${displayName(p)}"`,
    p.width ? `${p.width}×${p.height}px` : '',
    cameraName(e),
    e?.lens,
    [e?.iso ? `ISO ${e.iso}` : '', formatShutter(e?.exposureTime), formatAperture(e?.fNumber), formatFocal(e?.focalLength)].filter(Boolean).join(' '),
    e?.dateTime,
    p.kind === 'raw' ? 'RAW (embedded JPEG preview)' : '',
  ];
  return parts.filter(Boolean).join(', ');
}

/** Snapshot of a photo rendered with `settings` (default: its current settings). */
export async function snapshot(photo: Photo, maxSize = 1024, settings: DevelopSettings = photo.settings): Promise<AIImage> {
  const preview = await getPreview(photo);
  const stats = await getStats(photo);
  const canvas = renderSmall(preview.bitmap, `snap:${preview.key}`, preview.fullW, preview.fullH, settings, stats.atmos, maxSize);
  return canvasToAIImage(canvas, { maxSize });
}

/* ---------------------------- Assistant context ---------------------------- */

export async function assistantContext(): Promise<{ summary: string; image?: AIImage | null }> {
  const s = useDevelop.getState();
  const photo = s.activeId ? s.photos[s.activeId] : undefined;
  const lines = [`Library: ${s.order.length} photo(s), ${selectedIds().length} selected. View: ${s.view}.`];
  if (!photo) {
    lines.push('No photo is open. Ask the user to import photos (drag & drop or File → Import).');
    return { summary: lines.join('\n') };
  }
  lines.push(`Current photo (id ${photo.id}): ${photoDescription(photo)}.`);
  lines.push(`Rating ${photo.rating}/5, flag ${photo.flag ?? 'none'}, color label ${photo.label ?? 'none'}.`);
  if (!canDevelop(photo)) {
    lines.push(`This photo cannot be edited: ${photo.error ?? photo.kind}.`);
    return { summary: lines.join('\n') };
  }
  if (photo.width) {
    const geo = geometry(photo.settings, photo.width, photo.height);
    lines.push(`Size after crop: ${geo.outW}×${geo.outH}px (crop aspect ${photo.settings.cropAspect}, straighten ${photo.settings.straighten}°, rotation ${photo.settings.rotate * 90}°).`);
  }
  const nd = nonDefault(photo.settings);
  lines.push(`Current settings (only values different from default): ${Object.keys(nd).length ? JSON.stringify(nd) : 'none — the photo is unedited'}.`);
  if (s.histogram) lines.push(`Histogram of the current result: ${describeHistogram(s.histogram)}.`);
  const sel = selectedIds();
  if (sel.length > 1) lines.push(`Selected photos: ${sel.slice(0, 20).map((id) => displayName(s.photos[id])).join(', ')}${sel.length > 20 ? ', …' : ''}.`);
  let image: AIImage | null = null;
  try {
    image = await snapshot(photo, 1024);
  } catch {
    image = null;
  }
  return { summary: lines.join('\n'), image };
}

/* ----------------------------- Action executor ----------------------------- */

async function averageColor(photo: Photo): Promise<Vec3> {
  const preview = await getPreview(photo);
  const px = bitmapPixels(preview.bitmap, 200).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const mx = Math.max(px[i], px[i + 1], px[i + 2]);
    if (mx < 20 || mx > 250) continue;
    r += srgbToLinear(px[i] / 255);
    g += srgbToLinear(px[i + 1] / 255);
    b += srgbToLinear(px[i + 2] / 255);
    n++;
  }
  return n ? [r / n, g / n, b / n] : [1, 1, 1];
}

async function applyOp(st: DevelopSettings, op: AIOp, photo: Photo): Promise<DevelopSettings> {
  const dims = async () => {
    if (photo.width && photo.height) return { w: photo.width, h: photo.height };
    const p = await getPreview(photo);
    return { w: p.fullW, h: p.fullH };
  };
  switch (op.type) {
    case 'set':
      return mergeSettings(st, op.params);
    case 'adjust': {
      const next = { ...st };
      for (const [key, delta] of Object.entries(op.params) as [NumericKey, number][]) next[key] = clampParam(key, st[key] + delta);
      return next;
    }
    case 'curve':
      return { ...st, [CURVE_KEYS[op.channel]]: op.points };
    case 'preset':
      if (op.preset.auto) return mergeSettings(st, autoTone((await getStats(photo)).histogram));
      return applyPresetSettings(st, op.preset);
    case 'autoTone':
      return mergeSettings(st, autoTone((await getStats(photo)).histogram));
    case 'autoWhiteBalance': {
      const wb = solveWhiteBalance(await averageColor(photo));
      return { ...st, temp: wb.temp, tint: wb.tint };
    }
    case 'crop': {
      const { w, h } = await dims();
      let next = st;
      if (op.straighten !== undefined) next = withStraighten(next, op.straighten, w, h);
      if (op.rect) {
        const { w: wo, h: ho } = orientedSize(w, h, next.rotate);
        const r = fitCropToImage(cropToPx({ cropX: op.rect.x, cropY: op.rect.y, cropW: op.rect.w, cropH: op.rect.h }, wo, ho), wo, ho, next.straighten);
        next = { ...next, ...pxToCrop(r, wo, ho), cropAspect: op.aspect ?? 'free' };
      } else if (op.aspect) next = withAspect(next, op.aspect, w, h);
      return next;
    }
    case 'rotate':
      return rotateSettings(st, op.direction);
    case 'flip':
      return flipSettings(st, op.axis);
    case 'reset':
      return resetGroups(st, op.groups);
    case 'rate':
      return st;
  }
}

/** Executes the assistant's actions: one undo step per affected photo. */
export async function executeActions(actions: AIActionInput[]): Promise<string> {
  const { ops, ignored } = validateActions(actions, allPresets());
  if (!ops.length) throw new Error(ignored.length ? t('Nothing to apply (unknown: {list})', { list: ignored.join(', ') }) : t('Nothing to apply'));
  const s = useDevelop.getState();
  const active = s.activeId;
  const selection = selectedIds();
  const targets = new Set<string>();
  for (const v of ops) (v.selected ? selection : active ? [active] : []).forEach((id) => targets.add(id));
  if (!targets.size) throw new Error(t('Open a photo first'));
  let changed = 0;
  let meta = 0;
  for (const id of targets) {
    const photo = getPhoto(id);
    if (!photo) continue;
    let st = photo.settings;
    for (const v of ops) {
      if (!(v.selected ? selection.includes(id) : id === active)) continue;
      if (v.op.type === 'rate') {
        if (v.op.rating !== undefined) setRating([id], v.op.rating);
        if (v.op.flag !== undefined) setFlag([id], v.op.flag);
        if (v.op.label !== undefined) setLabel([id], v.op.label);
        meta++;
        continue;
      }
      if (!canDevelop(photo)) continue;
      st = await applyOp(st, v.op, photo);
    }
    const final = st;
    changed += applyToPhotos([id], () => final, `AI: ${[...new Set(ops.map((o) => o.op.type))].join(', ')}`);
  }
  const parts: string[] = [];
  if (changed) parts.push(t('Edited {count} photo(s)', { count: changed }));
  if (meta) parts.push(t('Updated ratings/flags'));
  if (ignored.length) parts.push(t('Ignored: {list}', { list: ignored.join(', ') }));
  return parts.join(' · ') || t('No changes');
}

/* -------------------------------- Auto edit -------------------------------- */

const AUTO_EDIT_SYSTEM = `You are an expert photo retoucher working in a Lightroom-like non-destructive developer.
You receive one photo (unedited) with its histogram and camera data. Choose develop settings for a natural, polished, professional result: correct exposure and white balance, recover clipped highlights, open shadows when needed, set good black and white points, add moderate presence (texture/clarity/vibrance) and, only if it clearly suits the subject, a subtle color grade. Avoid extreme values unless the photo really needs them. Never crop.
${LOOK_SCHEMA_HINT}`;

export interface BatchProgress {
  done: number;
  total: number;
  current: string;
}

export async function aiAutoEdit(
  ids: string[],
  onProgress: (p: BatchProgress) => void,
  signal: AbortSignal,
): Promise<{ done: number; failed: { name: string; error: string }[] }> {
  const photos = ids.map(getPhoto).filter((p): p is Photo => Boolean(p) && canDevelop(p!));
  const failed: { name: string; error: string }[] = [];
  let done = 0;
  const vision = providerSupportsImages(resolveProvider());
  for (let i = 0; i < photos.length; i++) {
    if (signal.aborted) break;
    const p = photos[i];
    onProgress({ done: i, total: photos.length, current: displayName(p) });
    try {
      const stats = await getStats(p);
      const base = { ...defaultSettings(), ...pickTransform(p.settings) };
      const image = vision ? await snapshot(p, 768, base) : undefined;
      const prompt = [
        `Photo: ${photoDescription(p)}.`,
        `Histogram of the unedited photo: ${describeHistogram(stats.histogram)}.`,
        image ? 'The unedited photo is attached.' : 'No image is attached: decide from the histogram and camera data only, keep the edit conservative.',
        'Return the complete develop settings for this photo.',
      ].join('\n');
      const { data } = await runAIJson<unknown>({ prompt, system: AUTO_EDIT_SYSTEM, images: image ? [image] : undefined, signal });
      if (signal.aborted) break;
      const { settings } = parseLookAnswer(data);
      if (!Object.keys(settings).length) throw new Error(t('The AI returned no usable settings'));
      applyToPhotos([p.id], (s) => mergeSettings(resetGroups(s, LOOK_GROUPS), settings), t('AI Auto Edit'));
      done++;
    } catch (error) {
      if (signal.aborted) break;
      failed.push({ name: displayName(p), error: error instanceof Error ? error.message : String(error) });
    }
  }
  onProgress({ done: photos.length, total: photos.length, current: '' });
  return { done, failed };
}

function pickTransform(s: DevelopSettings): Partial<DevelopSettings> {
  const { cropX, cropY, cropW, cropH, cropAspect, rotate, flipH, flipV, straighten } = s;
  return { cropX, cropY, cropW, cropH, cropAspect, rotate, flipH, flipV, straighten };
}

/* ------------------------------ Describe a look ------------------------------ */

export async function describeLook(text: string, ids: string[], signal?: AbortSignal): Promise<{ message: string; settings: Partial<DevelopSettings>; changed: number }> {
  const active = getPhoto(useDevelop.getState().activeId) ?? getPhoto(ids[0]);
  if (!active || !canDevelop(active)) throw new Error(t('Open a photo first'));
  const vision = providerSupportsImages(resolveProvider());
  const image = vision ? await snapshot(active, 768) : undefined;
  const stats = await getStats(active);
  const system = `You are a creative photo editor working in a Lightroom-like non-destructive developer. The user describes a look in words; translate it into develop settings that create that look on their photo (consider its content and exposure). Keep the photo's exposure sensible. Never crop.
${LOOK_SCHEMA_HINT}`;
  const prompt = [
    `Requested look: "${text.trim().slice(0, 500)}"`,
    `Photo: ${photoDescription(active)}.`,
    `Current settings (non-default): ${JSON.stringify(nonDefault(active.settings))}.`,
    `Histogram of the unedited photo: ${describeHistogram(stats.histogram)}.`,
    image ? 'The photo (with its current settings) is attached.' : '',
    'Return the complete settings for the final result.',
  ]
    .filter(Boolean)
    .join('\n');
  const { data } = await runAIJson<unknown>({ prompt, system, images: image ? [image] : undefined, signal });
  const { settings, message } = parseLookAnswer(data);
  if (!Object.keys(settings).length) throw new Error(t('The AI returned no usable settings'));
  const label = `${t('Look')}: ${text.trim().slice(0, 40)}`;
  const changed = applyToPhotos(ids.length ? ids : [active.id], (s) => mergeSettings(resetGroups(s, LOOK_GROUPS), settings), label);
  return { message, settings, changed };
}

/* ------------------------------ Cull suggestions ------------------------------ */

export interface CullResult extends CullSuggestion {
  id: string;
}

const CULL_SYSTEM = `You are a professional photo editor culling a photo shoot. For each attached photo give a star rating from 0 to 5 (5 = portfolio quality, 3 = good keeper, 1 = weak, 0 = no opinion), flag the best ones "pick" and unusable ones "reject" (out of focus, motion blur, closed eyes, badly exposed beyond repair, accidental shots, obvious duplicates of a better frame), otherwise null. Judge technical quality (focus, exposure, noise) and aesthetics (composition, moment, expression, light). Keep each reason under 12 words.
Answer with JSON: {"ratings":[{"index":1,"rating":4,"flag":"pick"|"reject"|null,"reason":"…"}]} with one entry per photo, index = photo number.`;

export async function suggestRatings(
  ids: string[],
  onProgress: (p: BatchProgress) => void,
  signal: AbortSignal,
): Promise<CullResult[]> {
  if (!providerSupportsImages(resolveProvider())) throw new Error(t('Rating suggestions need an AI that understands images (for example Claude Code, Codex, Antigravity CLI or a vision model in Ollama).'));
  const photos = ids.map(getPhoto).filter((p): p is Photo => Boolean(p) && canDevelop(p!)).slice(0, 60);
  const out: CullResult[] = [];
  const batch = 6;
  for (let start = 0; start < photos.length; start += batch) {
    if (signal.aborted) break;
    const group = photos.slice(start, start + batch);
    onProgress({ done: start, total: photos.length, current: group.map((p) => displayName(p)).join(', ') });
    const images: AIImage[] = [];
    for (const p of group) images.push({ ...(await snapshot(p, 640)), name: `photo-${images.length + 1}.jpg` });
    const prompt = [
      `${group.length} photos are attached, in this order:`,
      ...group.map((p, i) => `Photo ${i + 1}: ${photoDescription(p)}`),
      'Rate every photo.',
    ].join('\n');
    const { data } = await runAIJson<unknown>({ prompt, system: CULL_SYSTEM, images, signal });
    for (const sug of parseCullAnswer(data, group.length)) out.push({ ...sug, id: group[sug.index].id });
  }
  onProgress({ done: photos.length, total: photos.length, current: '' });
  return out;
}
