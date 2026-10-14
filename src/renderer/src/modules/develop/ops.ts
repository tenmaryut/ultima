/**
 * Develop operations on one or many photos: presets, Auto Tone / Auto White Balance,
 * copy / paste / sync settings, rotate / flip, resets. Each photo gets one undo step.
 */
import { t } from '../../core/i18n';
import { toast } from '../../components/ui/feedback';
import { solveWhiteBalance, srgbToLinear, type Vec3 } from './color';
import { bitmapPixels, getPreview, getStats } from './decode';
import { cropAfterStraighten, cropForAspect, flipCropRect, rotateCropRect } from './geometry';
import { autoTone } from './histogram';
import {
  GROUPS,
  defaultSettings,
  mergeSettings,
  pickGroups,
  resetGroups,
  type DevelopSettings,
  type GroupId,
} from './params';
import { applyPresetSettings, type Preset } from './presets';
import { applyToPhotos, getPhoto, useDevelop } from './store';
import { canDevelop } from './types';

export const DEFAULT_COPY_GROUPS: GroupId[] = GROUPS.map((g) => g.id).filter((g) => g !== 'transform');

/* --------------------------------- Presets --------------------------------- */

export async function applyPreset(ids: string[], preset: Preset): Promise<void> {
  if (preset.auto) {
    await autoToneFor(ids);
    return;
  }
  const n = applyToPhotos(ids, (s) => applyPresetSettings(s, preset), `${t('Preset')}: ${preset.builtin ? t(preset.name) : preset.name}`);
  if (ids.length > 1) toast.success(t('Applied “{name}” to {count} photo(s)', { name: preset.builtin ? t(preset.name) : preset.name, count: n }));
}

/* -------------------------------- Auto tone -------------------------------- */

export async function autoToneFor(ids: string[]): Promise<number> {
  let done = 0;
  for (const id of ids) {
    const photo = getPhoto(id);
    if (!photo || !canDevelop(photo)) continue;
    try {
      const stats = await getStats(photo);
      const patch = autoTone(stats.histogram);
      done += applyToPhotos([id], (s) => mergeSettings(s, patch), t('Auto Tone'));
    } catch (error) {
      toast.error(t('Auto Tone failed'), error instanceof Error ? error.message : String(error));
    }
  }
  return done;
}

/** Average linear color of the bright-enough, unclipped pixels (gray world). */
function grayWorld(data: Uint8ClampedArray): Vec3 {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    if (mx < 20 || mx > 250) continue;
    r += srgbToLinear(data[i] / 255);
    g += srgbToLinear(data[i + 1] / 255);
    b += srgbToLinear(data[i + 2] / 255);
    n++;
  }
  return n ? [r / n, g / n, b / n] : [1, 1, 1];
}

export async function autoWhiteBalance(ids: string[]): Promise<void> {
  for (const id of ids) {
    const photo = getPhoto(id);
    if (!photo || !canDevelop(photo)) continue;
    try {
      const preview = await getPreview(photo);
      const px = bitmapPixels(preview.bitmap, 256);
      const wb = solveWhiteBalance(grayWorld(px.data));
      applyToPhotos([id], (s) => ({ ...s, temp: wb.temp, tint: wb.tint }), t('Auto White Balance'));
    } catch (error) {
      toast.error(t('Auto White Balance failed'), error instanceof Error ? error.message : String(error));
    }
  }
}

/** White balance picker: neutralizes the color at a point of the preview bitmap (preview px). */
export async function whiteBalanceAt(id: string, px: number, py: number): Promise<boolean> {
  const photo = getPhoto(id);
  if (!photo) return false;
  const preview = await getPreview(photo);
  const size = 5;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const x = Math.max(0, Math.min(preview.bitmap.width - size, Math.round(px - size / 2)));
  const y = Math.max(0, Math.min(preview.bitmap.height - size, Math.round(py - size / 2)));
  ctx.drawImage(preview.bitmap, x, y, size, size, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += srgbToLinear(data[i] / 255);
    g += srgbToLinear(data[i + 1] / 255);
    b += srgbToLinear(data[i + 2] / 255);
  }
  const n = data.length / 4;
  if (Math.max(r, g, b) / n > 0.97 || Math.max(r, g, b) / n < 0.004) {
    toast.warning(t('Pick a neutral gray area that isn’t pure white or black'));
    return false;
  }
  const wb = solveWhiteBalance([r / n, g / n, b / n]);
  applyToPhotos([id], (s) => ({ ...s, temp: wb.temp, tint: wb.tint }), t('White Balance'));
  return true;
}

/* ----------------------------- Copy / paste ----------------------------- */

export function copySettings(groups: GroupId[] = DEFAULT_COPY_GROUPS): boolean {
  const s = useDevelop.getState();
  const photo = s.activeId ? s.photos[s.activeId] : undefined;
  if (!photo) return false;
  useDevelop.setState({ clipboard: { settings: pickGroups(photo.settings, groups), groups } });
  toast.info(t('Settings copied'), groups.length === GROUPS.length ? t('All settings') : groups.map((g) => t(GROUPS.find((x) => x.id === g)?.label ?? g)).join(', '));
  return true;
}

export function pasteSettings(ids: string[]): number {
  const clip = useDevelop.getState().clipboard;
  if (!clip) {
    toast.info(t('Copy settings first (Ctrl+Shift+C)'));
    return 0;
  }
  const n = applyToPhotos(ids, (s) => mergeSettings(s, clip.settings), t('Paste Settings'));
  if (ids.length > 1) toast.success(t('Pasted settings to {count} photo(s)', { count: n }));
  return n;
}

/** Copies the active photo's settings (selected groups) to the other selected photos. */
export function syncSettings(ids: string[], groups: GroupId[]): number {
  const s = useDevelop.getState();
  const source = s.activeId ? s.photos[s.activeId] : undefined;
  if (!source) return 0;
  const patch = pickGroups(source.settings, groups);
  const targets = ids.filter((id) => id !== source.id);
  const n = applyToPhotos(targets, (st) => mergeSettings(st, patch), t('Sync Settings'));
  toast.success(t('Synced settings to {count} photo(s)', { count: n }));
  return n;
}

/* ------------------------------ Reset / geometry ----------------------------- */

export function resetAll(ids: string[]): number {
  return applyToPhotos(ids, () => defaultSettings(), t('Reset All'));
}

export function resetSection(id: string, groups: GroupId[], label: string): void {
  applyToPhotos([id], (s) => resetGroups(s, groups), label);
}

function invertAspect(aspect: string): string {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  return m ? `${m[2]}:${m[1]}` : aspect;
}

export function rotateSettings(s: DevelopSettings, dir: 1 | -1): DevelopSettings {
  const r = rotateCropRect({ x: s.cropX, y: s.cropY, w: s.cropW, h: s.cropH }, dir);
  return { ...s, rotate: (s.rotate + dir + 4) % 4, cropX: r.x, cropY: r.y, cropW: r.w, cropH: r.h, cropAspect: invertAspect(s.cropAspect) };
}

export function flipSettings(s: DevelopSettings, axis: 'h' | 'v'): DevelopSettings {
  const r = flipCropRect({ x: s.cropX, y: s.cropY, w: s.cropW, h: s.cropH }, axis);
  return { ...s, flipH: axis === 'h' ? !s.flipH : s.flipH, flipV: axis === 'v' ? !s.flipV : s.flipV, straighten: -s.straighten, cropX: r.x, cropY: r.y, cropW: r.w, cropH: r.h };
}

export function rotatePhotos(ids: string[], dir: 1 | -1): void {
  applyToPhotos(ids, (s) => rotateSettings(s, dir), dir === 1 ? t('Rotate Right') : t('Rotate Left'));
}

export function flipPhotos(ids: string[], axis: 'h' | 'v'): void {
  applyToPhotos(ids, (s) => flipSettings(s, axis), axis === 'h' ? t('Flip Horizontal') : t('Flip Vertical'));
}

/** Settings with a new straighten angle; the crop shrinks to stay inside the rotated image. */
export function withStraighten(s: DevelopSettings, angle: number, fullW: number, fullH: number): DevelopSettings {
  const straighten = Math.round(Math.max(-45, Math.min(45, angle)) * 100) / 100;
  return { ...s, straighten, ...cropAfterStraighten(s, straighten, fullW, fullH) };
}

/** Settings with a new aspect preset (largest crop of that ratio). */
export function withAspect(s: DevelopSettings, aspect: string, fullW: number, fullH: number): DevelopSettings {
  return { ...s, cropAspect: aspect, ...cropForAspect(s, aspect, fullW, fullH) };
}
