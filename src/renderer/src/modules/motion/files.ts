import { saveFile } from '../../core/platform';
import { fileBaseName, fileExtension } from '../../core/utils/format';
import { luminance, parseColor } from '../../core/utils/color';
import { assetsToDataUrls, createAsset, isImageFile, isVideoFile, restoreAssets } from './media';
import { createLayer, uniqueName } from './model';
import { insertLayers } from './ops';
import { cleanColor, parseProject, parseProjectObject, serializeProject, type ParsedProject } from './project';
import { importSvg } from './svg-import';
import type { Asset, Layer, MotionDoc, Vec2 } from './types';

/** Opening, importing and saving (DOM + async). Results are applied by the caller as one undo step. */

export interface ImportResult {
  doc: MotionDoc;
  added: string[];
  errors: string[];
}

export function isProjectFile(file: File): boolean {
  return fileExtension(file.name) === 'ultima';
}

function fitScale(doc: MotionDoc, w: number, h: number): number {
  return Math.min(100, (doc.comp.width / w) * 100, (doc.comp.height / h) * 100);
}

/** Adds an asset + layer for an image or video blob. */
export async function addMediaLayer(doc: MotionDoc, blob: Blob, name: string, kind: 'image' | 'video', selected: string[], at?: Vec2): Promise<{ doc: MotionDoc; layer: Layer }> {
  const asset: Asset = await createAsset(blob, name, kind);
  const layer = createLayer(kind, doc.comp, { assetId: asset.id, name: uniqueName(doc, fileBaseName(name) || (kind === 'image' ? 'Image' : 'Video')), position: at }, doc.layers.length);
  const s = fitScale(doc, asset.width, asset.height);
  layer.props.scale = { value: [s, s], keyframes: [] };
  if (kind === 'video' && asset.duration) layer.outPoint = Math.min(doc.comp.duration, layer.inPoint + asset.duration);
  const next = insertLayers({ ...doc, assets: { ...doc.assets, [asset.id]: asset } }, [layer], selected);
  return { doc: next, layer };
}

/** SVG text → editable path layers (or a raster image when it uses unsupported features). */
export async function addSvg(doc: MotionDoc, svg: string, name: string, selected: string[]): Promise<{ doc: MotionDoc; ids: string[] }> {
  const res = await importSvg(svg, doc.comp, name, doc.layers.length);
  if (res.raster) {
    const r = await addMediaLayer(doc, res.raster.blob, res.raster.name, 'image', selected);
    return { doc: r.doc, ids: [r.layer.id] };
  }
  const layers = res.layers.map((l) => ({ ...l, name: uniqueName(doc, l.name) }));
  return { doc: insertLayers(doc, layers, selected), ids: layers.map((l) => l.id) };
}

/** Imports media files (images, SVG, video) as new layers. Project files are not handled here. */
export async function importMediaFiles(doc: MotionDoc, files: File[], selected: string[]): Promise<ImportResult> {
  let next = doc;
  const added: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      if (fileExtension(file.name) === 'svg' || file.type === 'image/svg+xml') {
        const r = await addSvg(next, await file.text(), fileBaseName(file.name), selected);
        next = r.doc;
        added.push(...r.ids);
      } else if (isImageFile(file)) {
        const r = await addMediaLayer(next, file, file.name, 'image', selected);
        next = r.doc;
        added.push(r.layer.id);
      } else if (isVideoFile(file)) {
        const r = await addMediaLayer(next, file, file.name, 'video', selected);
        next = r.doc;
        added.push(r.layer.id);
      } else errors.push(`${file.name}: unsupported file type`);
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { doc: next, added, errors };
}

/** Reads a project (file or already-parsed JSON) and restores its embedded media. */
export async function loadProject(source: File | unknown): Promise<{ doc: MotionDoc; failed: string[] }> {
  const parsed: ParsedProject = source instanceof File ? parseProject(await source.text()) : parseProjectObject(source);
  const { assets, failed } = await restoreAssets(parsed.assets);
  const layers = parsed.layers.filter((l) => (l.type === 'image' || l.type === 'video' ? Boolean(l.assetId && assets[l.assetId]) : true));
  return { doc: { comp: parsed.comp, layers, assets }, failed };
}

export async function saveProject(doc: MotionDoc, name: string, path?: string): Promise<{ path?: string } | null> {
  const json = serializeProject(doc, await assetsToDataUrls(doc));
  const base = name.replace(/\.ultima$/i, '') || 'Motion';
  return saveFile(new Blob([json], { type: 'application/json' }), {
    suggestedName: `${base}.ultima`,
    filters: [{ name: 'Ultima motion project', extensions: ['ultima'] }],
    path,
  });
}

/**
 * Applies a palette. Applied to the whole composition (no selection), the darkest color
 * becomes the background and the others are spread over the fills of text / shape / solid
 * layers; with a selection only the selected layers are recolored.
 */
export function applyPalette(doc: MotionDoc, colors: string[], targetIds: string[]): { doc: MotionDoc; count: number } {
  const valid = [...new Set(colors.map((c) => cleanColor(c, '')).filter(Boolean))];
  if (!valid.length) return { doc, count: 0 };
  const wholeComp = !targetIds.length && valid.length > 1 && !doc.comp.transparent;
  const background = wholeComp ? [...valid].sort((a, b) => luminance(parseColor(a)!) - luminance(parseColor(b)!))[0] : null;
  const fills = background ? valid.filter((c) => c !== background) : valid;
  const targets = doc.layers.filter((l) => (targetIds.length ? targetIds.includes(l.id) : true) && (l.type === 'text' || l.type === 'shape' || l.type === 'solid'));
  let i = 0;
  const layers = doc.layers.map((l) => {
    if (!targets.includes(l)) return l;
    const color = fills[i++ % fills.length];
    const props = { ...l.props };
    if (props.fill.keyframes.length) props.fill = { ...props.fill, keyframes: props.fill.keyframes.map((k) => ({ ...k, value: color })) };
    else props.fill = { value: color, keyframes: [] };
    if (l.type === 'shape' && l.shape?.kind === 'line') props.strokeColor = { value: color, keyframes: [] };
    return { ...l, props };
  });
  const comp = background ? { ...doc.comp, background } : doc.comp;
  return { doc: { ...doc, comp, layers }, count: targets.length };
}
