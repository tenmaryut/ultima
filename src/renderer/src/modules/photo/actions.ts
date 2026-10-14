/**
 * Document actions used by menus, shortcuts, panels and the AI executor. They work on the
 * active document through the engine, record one undo step each and report errors with toasts.
 */
import { confirmDialog, promptDialog, toast } from '../../components/ui';
import { t } from '../../core/i18n';
import { rememberRecent } from '../../core/open';
import { pickFiles, saveFile } from '../../core/platform';
import { fileBaseName } from '../../core/utils/format';
import { canvasToBlobAsync, scaleCanvas } from './canvas';
import { cloneLayer, findLayer, getActiveLayer, insertLayer, layerIndex, makeRasterLayer, makeTextLayer, moveLayerTo, nextLayerName, removeLayer, setSelection, updateLayer } from './doc';
import {
  addEmptyLayer,
  addMask,
  applyMask,
  blankDocument,
  canvasSize,
  clearSelected,
  copyPixels,
  cropDoc,
  deleteMask,
  fillLayer,
  flattenImage,
  flipDoc,
  flipLayer,
  invertLayerMask,
  mergeDown,
  mergeVisible,
  pasteAsLayer,
  rasterizeLayer,
  resizeImage,
  rotateDoc90,
  rotateDocArbitrary,
  selectLayerPixels,
  trimBounds,
  type ClipboardImage,
} from './docops';
import type { PhotoEngine } from './engine';
import { documentToProject, documentToPsd, exportImage, OPEN_ACCEPT, readFileAsCanvas, readFileAsDocument, checkDocSize, type ExportFormat } from './io';
import { contractMask, expandMask, featherMask, invertMask, selectAll as selectAllMask, selectionFromMask } from './selection';
import { activeSession, isDirty, usePhotoStore } from './store';
import type { Layer, PhotoDoc } from './types';

/** Runs a document transformation as one undo step. */
export function change(engine: PhotoEngine, label: string, fn: (doc: PhotoDoc) => PhotoDoc | null | undefined): boolean {
  const doc = engine.doc;
  if (!doc) return false;
  try {
    const next = fn(doc);
    if (!next || next === doc) return false;
    engine.commit(next, label);
    return true;
  } catch (error) {
    engine.reportError(error);
    return false;
  }
}

/* ----------------------------------- files ----------------------------------- */

export function newDocument(width: number, height: number, background: string | null, name?: string): void {
  try {
    checkDocSize(width, height);
    const store = usePhotoStore.getState();
    store.openSession(blankDocument(Math.round(width), Math.round(height), background), name?.trim() || store.nextUntitled(), 'New');
  } catch (error) {
    toast.error(t('Could not create the document'), error instanceof Error ? error.message : String(error));
  }
}

export async function openFiles(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      const opened = await readFileAsDocument(file);
      const store = usePhotoStore.getState();
      store.openSession(opened.doc, opened.name, 'Open');
      if (opened.project) {
        const s = activeSession();
        if (s) store.markSaved(s.id, undefined, opened.name);
        if (opened.project.fg || opened.project.bg) store.setColors(opened.project.fg, opened.project.bg);
      }
      rememberRecent(file, 'photo');
    } catch (error) {
      toast.error(t('Could not open {name}', { name: file.name }), error instanceof Error ? error.message : String(error));
    }
  }
}

export async function pickAndOpen(): Promise<void> {
  const files = await pickFiles({ accept: OPEN_ACCEPT, multiple: true });
  if (files.length) await openFiles(files);
}

/** Adds images as new layers of the active document (scaled down to fit when larger). */
export async function placeFiles(engine: PhotoEngine, files: File[]): Promise<void> {
  for (const file of files) {
    try {
      const canvas = await readFileAsCanvas(file);
      placeCanvas(engine, canvas, fileBaseName(file.name) || nextLayerName(engine.doc!));
      rememberRecent(file, 'photo');
    } catch (error) {
      toast.error(t('Could not place {name}', { name: file.name }), error instanceof Error ? error.message : String(error));
    }
  }
}

export function placeCanvas(engine: PhotoEngine, canvas: HTMLCanvasElement, name: string, label = 'Place'): void {
  const doc = engine.doc;
  if (!doc) return;
  let c = canvas;
  const scale = Math.min(1, doc.width / c.width, doc.height / c.height);
  if (scale < 1) c = scaleCanvas(c, c.width * scale, c.height * scale);
  const layer = makeRasterLayer(name.slice(0, 120), c, Math.round((doc.width - c.width) / 2), Math.round((doc.height - c.height) / 2));
  engine.commit(insertLayer({ ...doc, selection: null }, layer), label);
}

export async function pickAndPlace(engine: PhotoEngine): Promise<void> {
  if (!engine.doc) return;
  const files = await pickFiles({ accept: 'image/*,.svg,.psd', multiple: true });
  if (files.length) await placeFiles(engine, files);
}

export async function saveProject(engine: PhotoEngine, saveAs: boolean): Promise<void> {
  const session = activeSession();
  const doc = engine.doc;
  if (!session || !doc) return;
  try {
    const store = usePhotoStore.getState();
    const json = documentToProject(doc, session.name, store.fg, store.bg);
    const name = fileBaseName(session.name) || 'Untitled';
    const result = await saveFile(json, {
      suggestedName: `${name}.ultima`,
      filters: [{ name: 'Ultima Photo project', extensions: ['ultima'] }],
      path: saveAs ? undefined : session.path,
    });
    if (!result) return;
    const savedName = result.path ? fileBaseName(result.path.split(/[\\/]/).pop() ?? name) : name;
    store.markSaved(session.id, result.path, savedName);
    toast.success(t('Project saved'));
  } catch (error) {
    toast.error(t('Could not save the project'), error instanceof Error ? error.message : String(error));
  }
}

export async function exportDocument(engine: PhotoEngine, options: { format: ExportFormat; quality: number; scale: number; background?: string }): Promise<boolean> {
  const session = activeSession();
  const doc = engine.doc;
  if (!session || !doc) return false;
  try {
    const blob = await exportImage(doc, options);
    const ext = options.format === 'jpeg' ? 'jpg' : options.format;
    const result = await saveFile(blob, {
      suggestedName: `${fileBaseName(session.name) || 'image'}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result) toast.success(t('Exported'));
    return Boolean(result);
  } catch (error) {
    toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function exportPsd(engine: PhotoEngine): Promise<void> {
  const session = activeSession();
  const doc = engine.doc;
  if (!session || !doc) return;
  try {
    const bytes = await documentToPsd(doc);
    const result = await saveFile(bytes, { suggestedName: `${fileBaseName(session.name) || 'image'}.psd`, filters: [{ name: 'Photoshop', extensions: ['psd'] }] });
    if (result) toast.success(t('Exported'));
  } catch (error) {
    toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
  }
}

export async function closeDocument(id: string): Promise<void> {
  const store = usePhotoStore.getState();
  const session = store.sessions.find((s) => s.id === id);
  if (!session) return;
  if (isDirty(session)) {
    const ok = await confirmDialog({ title: t('Close {name}?', { name: session.name }), message: t('Your unsaved changes will be lost.'), confirmLabel: t('Close'), danger: true });
    if (!ok) return;
  }
  store.closeSession(id);
}

/* --------------------------------- clipboard --------------------------------- */

let clipboard: (ClipboardImage & { at: number }) | null = null;

export function internalClipboard(): ClipboardImage | null {
  return clipboard;
}

async function writeSystemClipboard(canvas: HTMLCanvasElement): Promise<void> {
  try {
    const ClipboardItemCtor = (window as unknown as { ClipboardItem?: new (items: Record<string, Promise<Blob> | Blob>) => ClipboardItem }).ClipboardItem;
    if (!ClipboardItemCtor || !navigator.clipboard?.write) return;
    await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': canvasToBlobAsync(canvas) })]);
  } catch {
    // the system clipboard is optional (permissions, focus…)
  }
}

export function copy(engine: PhotoEngine, merged: boolean): boolean {
  const doc = engine.doc;
  if (!doc) return false;
  try {
    const clip = copyPixels(doc, merged);
    if (!clip) {
      toast.info(t('Nothing to copy'), t('The selected area is empty.'));
      return false;
    }
    clipboard = { ...clip, at: Date.now() };
    void writeSystemClipboard(clip.canvas);
    return true;
  } catch (error) {
    engine.reportError(error);
    return false;
  }
}

export function cut(engine: PhotoEngine): void {
  const layer = engine.activeLayer();
  if (!engine.canEdit(layer)) return;
  if (!engine.doc?.selection) {
    toast.info(t('Make a selection first'));
    return;
  }
  if (layer.type !== 'raster') {
    void engine.ensureRaster();
    return;
  }
  if (copy(engine, false)) change(engine, 'Cut', (doc) => clearSelected(doc, layer.id, false));
}

/** Pastes an image (from the system clipboard or the internal one) as a new layer. */
export function pasteCanvas(engine: PhotoEngine, canvas: HTMLCanvasElement, x?: number, y?: number): void {
  if (!engine.doc) {
    usePhotoStore.getState().openSession(blankDocument(canvas.width, canvas.height, null), usePhotoStore.getState().nextUntitled(), 'New');
  }
  change(engine, 'Paste', (doc) => pasteAsLayer(doc, { canvas, x, y }, nextLayerName(doc)));
}

export function pasteInternal(engine: PhotoEngine): boolean {
  if (!clipboard) return false;
  pasteCanvas(engine, clipboard.canvas, clipboard.x, clipboard.y);
  return true;
}

/* --------------------------------- selection --------------------------------- */

export function selectAll(engine: PhotoEngine): void {
  change(engine, 'Select All', (doc) => setSelection(doc, selectAllMask(doc.width, doc.height)));
}

export function deselect(engine: PhotoEngine): void {
  change(engine, 'Deselect', (doc) => (doc.selection ? setSelection(doc, null) : doc));
}

export function inverseSelection(engine: PhotoEngine): void {
  change(engine, 'Inverse', (doc) => {
    const mask = doc.selection ? invertMask(doc.selection.mask) : new Uint8Array(doc.width * doc.height).fill(255);
    return setSelection(doc, selectionFromMask(mask, doc.width, doc.height));
  });
}

export async function modifySelection(engine: PhotoEngine, kind: 'feather' | 'expand' | 'contract'): Promise<void> {
  if (!engine.doc?.selection) {
    toast.info(t('Make a selection first'));
    return;
  }
  const titles = { feather: t('Feather Selection'), expand: t('Expand Selection'), contract: t('Contract Selection') };
  const value = await promptDialog({ title: titles[kind], message: t('Radius in pixels'), defaultValue: kind === 'feather' ? '10' : '5', confirmLabel: t('OK') });
  if (value === null) return;
  const px = Math.max(0, Math.min(500, parseFloat(value)));
  if (!Number.isFinite(px) || px <= 0) return;
  const labels = { feather: 'Feather', expand: 'Expand', contract: 'Contract' };
  change(engine, labels[kind], (doc) => {
    if (!doc.selection) return doc;
    const fn = kind === 'feather' ? featherMask : kind === 'expand' ? expandMask : contractMask;
    return setSelection(doc, selectionFromMask(fn(doc.selection.mask, doc.width, doc.height, px), doc.width, doc.height));
  });
}

export function selectPixelsOf(engine: PhotoEngine, layerId: string): void {
  change(engine, 'Load Selection', (doc) => selectLayerPixels(doc, layerId));
}

/* ----------------------------------- edit ----------------------------------- */

/** Delete key: clears the selected pixels, or deletes the layer when nothing is selected. */
export async function deleteAction(engine: PhotoEngine): Promise<void> {
  const doc = engine.doc;
  const layer = engine.activeLayer();
  if (!doc || !layer) return;
  if (!doc.selection) {
    deleteLayer(engine, layer.id);
    return;
  }
  if (!engine.canEdit(layer)) return;
  const onMask = engine.store.maskEdit && Boolean(layer.mask);
  if (!onMask && layer.type !== 'raster') {
    const raster = await engine.ensureRaster(layer.id);
    if (!raster) return;
  }
  change(engine, 'Clear', (d) => clearSelected(d, layer.id, onMask));
}

export async function fillAction(engine: PhotoEngine, color: string, opacity = 1, blend: GlobalCompositeOperation = 'source-over'): Promise<void> {
  const layer = engine.activeLayer();
  if (!engine.canEdit(layer)) return;
  const onMask = engine.store.maskEdit && Boolean(layer.mask);
  if (!onMask && layer.type !== 'raster') {
    const raster = await engine.ensureRaster(layer.id);
    if (!raster) return;
  }
  change(engine, 'Fill', (doc) => fillLayer(doc, layer.id, color, { opacity, blend, onMask }));
}

/* ----------------------------------- layers ----------------------------------- */

export function newLayer(engine: PhotoEngine): void {
  change(engine, 'New Layer', (doc) => addEmptyLayer(doc));
}

export function newTextLayer(engine: PhotoEngine, text = 'Text'): void {
  const store = usePhotoStore.getState();
  const o = store.opts.text;
  change(engine, 'New Text Layer', (doc) => {
    const size = Math.max(12, Math.round(Math.min(doc.width, doc.height) / 10));
    return insertLayer(doc, makeTextLayer({ text, x: doc.width / 2, y: doc.height / 2 - size / 2, size, font: o.font, weight: o.weight, italic: o.italic, align: 'center', color: store.fg }));
  });
}

export function duplicateLayer(engine: PhotoEngine, id?: string): void {
  change(engine, 'Duplicate Layer', (doc) => {
    const layer = findLayer(doc, id ?? doc.activeId);
    if (!layer) return doc;
    return insertLayer(doc, cloneLayer(layer), layerIndex(doc, layer.id) + 1);
  });
}

export function deleteLayer(engine: PhotoEngine, id?: string): void {
  change(engine, 'Delete Layer', (doc) => {
    const layer = findLayer(doc, id ?? doc.activeId);
    if (!layer) return doc;
    return removeLayer(doc, layer.id);
  });
}

export function setActive(engine: PhotoEngine, id: string): void {
  const doc = engine.doc;
  if (!doc || doc.activeId === id) return;
  // selecting a layer is not an undo step on its own
  engine.live({ ...doc, activeId: id });
  usePhotoStore.getState().setMaskEdit(false);
}

export function updateLayerProps(engine: PhotoEngine, id: string, patch: Partial<Layer>, label: string | null): void {
  const doc = engine.doc;
  if (!doc) return;
  const next = updateLayer(doc, id, patch);
  if (next === doc) return;
  if (label) engine.commit(next, label);
  else engine.live(next);
}

export function moveLayer(engine: PhotoEngine, id: string, to: number | 'up' | 'down' | 'top' | 'bottom'): void {
  change(engine, 'Arrange Layers', (doc) => {
    const i = layerIndex(doc, id);
    if (i < 0) return doc;
    const target = to === 'up' ? i + 1 : to === 'down' ? i - 1 : to === 'top' ? doc.layers.length - 1 : to === 'bottom' ? 0 : to;
    return moveLayerTo(doc, id, target);
  });
}

export function mergeDownAction(engine: PhotoEngine): void {
  const doc = engine.doc;
  if (!doc) return;
  if (layerIndex(doc, doc.activeId) <= 0) {
    toast.info(t('There is no layer below to merge with'));
    return;
  }
  change(engine, 'Merge Down', (d) => mergeDown(d, d.activeId!));
}

export function mergeVisibleAction(engine: PhotoEngine): void {
  change(engine, 'Merge Visible', (doc) => mergeVisible(doc));
}

export async function flattenAction(engine: PhotoEngine): Promise<void> {
  const doc = engine.doc;
  if (!doc) return;
  if (doc.layers.some((l) => !l.visible)) {
    const ok = await confirmDialog({ title: t('Flatten Image'), message: t('Discard hidden layers?'), confirmLabel: t('Flatten') });
    if (!ok) return;
  }
  change(engine, 'Flatten Image', (d) => flattenImage(d));
}

export async function rasterizeAction(engine: PhotoEngine): Promise<void> {
  const layer = engine.activeLayer();
  if (!layer || layer.type === 'raster') return;
  change(engine, 'Rasterize Layer', (doc) => rasterizeLayer(doc, layer.id));
}

export function maskAction(engine: PhotoEngine, kind: 'reveal' | 'hide' | 'selection' | 'delete' | 'apply' | 'invert' | 'toggle'): void {
  const doc = engine.doc;
  const layer = doc ? getActiveLayer(doc) : null;
  if (!doc || !layer) return;
  const store = usePhotoStore.getState();
  if (kind === 'reveal' || kind === 'hide' || kind === 'selection') {
    if (kind === 'selection' && !doc.selection) {
      toast.info(t('Make a selection first'));
      return;
    }
    const added = change(engine, 'Add Layer Mask', (d) => {
      const withMask = addMask(d, layer.id, kind);
      return kind === 'selection' ? setSelection(withMask, null) : withMask;
    });
    if (added) store.setMaskEdit(true);
    return;
  }
  if (!layer.mask) return;
  if (kind === 'delete') {
    change(engine, 'Delete Layer Mask', (d) => deleteMask(d, layer.id));
    store.setMaskEdit(false);
  } else if (kind === 'apply') {
    change(engine, 'Apply Layer Mask', (d) => applyMask(d, layer.id));
    store.setMaskEdit(false);
  } else if (kind === 'invert') change(engine, 'Invert Mask', (d) => invertLayerMask(d, layer.id));
  else change(engine, layer.mask.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask', (d) => updateLayer(d, layer.id, { mask: { ...layer.mask!, enabled: !layer.mask!.enabled } } as Partial<Layer>));
}

/* ----------------------------------- image ----------------------------------- */

export function rotateImage(engine: PhotoEngine, degrees: number): void {
  const q = degrees / 90;
  if (Number.isInteger(q)) change(engine, 'Image Rotation', (doc) => rotateDoc90(doc, q));
  else change(engine, 'Rotate Canvas', (doc) => rotateDocArbitrary(doc, degrees));
}

export async function rotateArbitraryPrompt(engine: PhotoEngine): Promise<void> {
  const v = await promptDialog({ title: t('Rotate Canvas'), message: t('Angle in degrees (clockwise, negative for counter-clockwise)'), defaultValue: '15', confirmLabel: t('Rotate') });
  if (v === null) return;
  const deg = parseFloat(v);
  if (!Number.isFinite(deg) || !deg) return;
  rotateImage(engine, Math.max(-360, Math.min(360, deg)));
}

export function flipImage(engine: PhotoEngine, axis: 'horizontal' | 'vertical'): void {
  change(engine, axis === 'horizontal' ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical', (doc) => flipDoc(doc, axis));
}

export function flipActiveLayer(engine: PhotoEngine, axis: 'horizontal' | 'vertical'): void {
  const layer = engine.activeLayer();
  if (!engine.canEdit(layer)) return;
  change(engine, axis === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical', (doc) => flipLayer(doc, layer.id, axis));
}

export function cropToSelection(engine: PhotoEngine): void {
  const doc = engine.doc;
  if (!doc?.selection) {
    toast.info(t('Make a selection first'));
    return;
  }
  change(engine, 'Crop', (d) => ({ ...cropDoc(d, d.selection!.bounds), selection: null }));
}

export function trimTransparent(engine: PhotoEngine): void {
  const doc = engine.doc;
  if (!doc) return;
  const b = trimBounds(doc);
  if (!b) {
    toast.info(t('The image is fully transparent'));
    return;
  }
  if (b.x === 0 && b.y === 0 && b.w === doc.width && b.h === doc.height) {
    toast.info(t('Nothing to trim'));
    return;
  }
  change(engine, 'Trim', (d) => cropDoc(d, b));
}

export function resizeAction(engine: PhotoEngine, w: number, h: number, quality: ImageSmoothingQuality | 'nearest'): void {
  try {
    checkDocSize(w, h);
  } catch (error) {
    toast.error(t('Invalid size'), error instanceof Error ? error.message : String(error));
    return;
  }
  change(engine, 'Image Size', (doc) => resizeImage(doc, w, h, quality));
}

export function canvasSizeAction(engine: PhotoEngine, w: number, h: number, ax: number, ay: number, fill?: string): void {
  try {
    checkDocSize(w, h);
  } catch (error) {
    toast.error(t('Invalid size'), error instanceof Error ? error.message : String(error));
    return;
  }
  change(engine, 'Canvas Size', (doc) => canvasSize(doc, w, h, ax, ay, fill));
}
