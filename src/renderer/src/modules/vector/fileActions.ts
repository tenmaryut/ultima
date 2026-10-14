import { confirmDialog, toast } from '../../components/ui';
import { sanitizeSvg } from '../../core/ai/sanitize';
import { t } from '../../core/i18n';
import { rememberRecent } from '../../core/open';
import { pathForFile, pickFiles, saveFile } from '../../core/platform';
import { loadImage } from '../../core/utils/image';
import { fileBaseName, fileExtension } from '../../core/utils/format';
import type { EditorCore, FileInfo } from './editor';
import { bakeScale, boundsUnder } from './geometry';
import { chain, rectCenter, scale, translate, type Pt } from './matrix';
import { cloneWithNewIds, createDocument, createGroup, createImage, createText, type VDoc, type VObject } from './model';
import { extractWorldCopies, moveByIds, topLevelSelection, removeByIds } from './ops';
import { parseProject, serializeProject } from './project';
import { artboardJpg, artboardPng, artboardsPdf, safeFileName, zipBlobs } from './raster';
import { exportArtboardSvg, exportObjectsSvg } from './svgexport';
import { importSvg } from './svgimport';
import { insertObjects } from './tools/common';
import { textFill } from './tools/draw';

let clipboard: { objects: VObject[]; svg: string; pastes: number } | null = null;

export interface ExportOptions {
  format: 'svg' | 'png' | 'jpg' | 'pdf';
  scope: 'current' | 'all' | 'selection';
  scale: number;
  transparent: boolean;
  quality: number;
}

const IMAGE_RE = /^image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml)$/i;

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });
}

export function fileActions(get: () => EditorCore, resetDoc: (doc: VDoc, file?: FileInfo) => void) {
  const isDirty = () => {
    const c = get();
    return c.file.savedDoc ? c.doc !== c.file.savedDoc : c.doc.objects.length > 0;
  };

  const confirmDiscard = async (): Promise<boolean> => {
    if (!isDirty()) return true;
    return confirmDialog({
      title: t('Discard unsaved changes?'),
      message: t('The current document has changes that are not saved.'),
      confirmLabel: t('Discard'),
      danger: true,
    });
  };

  /** Fits a placed block into the active artboard (scales down large content) and centers it on `at`. */
  const placeTransform = (w: number, h: number, at?: Pt) => {
    const ab = get().activeArtboard;
    const center = at ?? { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
    const s = Math.min(1, (ab.width * 0.9) / Math.max(1, w), (ab.height * 0.9) / Math.max(1, h));
    return chain(translate(center.x - (w * s) / 2, center.y - (h * s) / 2), scale(s));
  };

  const actions = {
    isDirty,
    confirmDiscard,
    async newDocument(width: number, height: number, background: string | null, name = 'Untitled') {
      if (!(await confirmDiscard())) return;
      resetDoc(createDocument(Math.round(width), Math.round(height), background, name), { savedDoc: null });
    },
    /** Imports SVG markup: as a new document (`open`) or placed into the current one. */
    importSvgMarkup(markup: string, mode: 'open' | 'place', name = 'Imported SVG', at?: Pt): boolean {
      const clean = sanitizeSvg(markup);
      if (!clean) {
        toast.error(t('Could not read the SVG'), t('The file does not contain a valid <svg> element.'));
        return false;
      }
      let result: ReturnType<typeof importSvg>;
      try {
        result = importSvg(clean);
      } catch (error) {
        toast.error(t('Could not read the SVG'), error instanceof Error ? error.message : String(error));
        return false;
      }
      if (!result.objects.length) {
        toast.warning(t('The SVG is empty'));
        return false;
      }
      if (result.rawCount) toast.info(t('{count} unsupported element(s) were embedded as SVG content', { count: result.rawCount }));
      if (mode === 'open') {
        const doc = createDocument(Math.max(1, Math.round(result.width)), Math.max(1, Math.round(result.height)), null, name);
        doc.objects = result.objects;
        resetDoc(doc, { savedDoc: null });
        return true;
      }
      const c = get();
      const block: VObject = result.objects.length === 1 ? result.objects[0] : createGroup(result.objects, name);
      const placed = bakeScale({ ...block, m: chain(placeTransform(result.width, result.height, at), block.m) });
      c.update((d) => insertObjects(d, [placed], c.scope), 'Place SVG');
      c.setSelection([placed.id]);
      return true;
    },
    async placeImage(blob: Blob, name: string, at?: Pt): Promise<boolean> {
      try {
        const href = await readDataUrl(blob);
        const img = await loadImage(href);
        const w = img.naturalWidth || img.width || 100;
        const h = img.naturalHeight || img.height || 100;
        const o = createImage(0, 0, w, h, href, name);
        o.m = placeTransform(w, h, at);
        const c = get();
        const placed = { ...o };
        c.update((d) => insertObjects(d, [placed], c.scope), 'Place image');
        c.setSelection([placed.id]);
        return true;
      } catch (error) {
        toast.error(t('Could not place the image'), error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    /** Opens or places files (projects, SVG, images). */
    async openFiles(files: File[], mode: 'open' | 'place', at?: Pt) {
      for (const file of files) {
        const ext = fileExtension(file.name);
        try {
          if (ext === 'ultima' || ext === 'json') {
            const text = await file.text();
            const doc = parseProject(text);
            if (!(await confirmDiscard())) return;
            resetDoc(doc, { path: pathForFile(file), savedDoc: doc });
            rememberRecent(file, 'vector');
            toast.success(t('Opened {name}', { name: file.name }));
          } else if (ext === 'svg' || file.type === 'image/svg+xml') {
            const text = await file.text();
            if (mode === 'open') {
              if (!(await confirmDiscard())) return;
              if (actions.importSvgMarkup(text, 'open', fileBaseName(file.name))) rememberRecent(file, 'vector');
            } else actions.importSvgMarkup(text, 'place', fileBaseName(file.name), at);
          } else if (IMAGE_RE.test(file.type) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) {
            await actions.placeImage(file, fileBaseName(file.name), at);
          } else {
            toast.warning(t('Unsupported file type'), file.name);
          }
        } catch (error) {
          toast.error(t('Could not open {name}', { name: file.name }), error instanceof Error ? error.message : String(error));
        }
      }
    },
    async open() {
      const files = await pickFiles({ accept: '.ultima,.svg,image/svg+xml', multiple: false });
      if (files.length) await actions.openFiles(files, 'open');
    },
    async place() {
      const files = await pickFiles({ accept: '.svg,image/*', multiple: true });
      if (files.length) await actions.openFiles(files, 'place');
    },
    async save(saveAs = false) {
      const c = get();
      try {
        const doc = c.doc;
        const result = await saveFile(serializeProject(doc), {
          suggestedName: `${safeFileName(doc.name)}.ultima`,
          filters: [{ name: t('Ultima project'), extensions: ['ultima'] }],
          path: saveAs ? undefined : c.file.path,
        });
        if (!result) return;
        c.setFile({ path: result.path ?? c.file.path, savedDoc: doc });
        toast.success(t('Saved'));
      } catch (error) {
        toast.error(t('Could not save'), error instanceof Error ? error.message : String(error));
      }
    },
    async runExport(opts: ExportOptions, onProgress?: (p: number) => void): Promise<boolean> {
      const c = get();
      const doc = c.doc;
      const base = safeFileName(doc.name);
      const artboards = opts.scope === 'all' ? doc.artboards : [c.activeArtboard];
      const multi = artboards.length > 1;
      const fileFor = (abName: string, ext: string) => (multi ? `${base}-${safeFileName(abName)}.${ext}` : `${base}.${ext}`);
      try {
        if (opts.format === 'svg') {
          if (opts.scope === 'selection') {
            const ids = topLevelSelection(doc.objects, c.selection);
            if (!ids.length) {
              toast.info(t('Select an object first'));
              return false;
            }
            const svg = exportObjectsSvg(extractWorldCopies(doc.objects, ids), true);
            return Boolean(await saveFile(svg, { suggestedName: `${base}-selection.svg`, filters: [{ name: 'SVG', extensions: ['svg'] }] }));
          }
          const files = artboards.map((ab) => ({ name: fileFor(ab.name, 'svg'), data: exportArtboardSvg(doc, ab, { background: !opts.transparent }) }));
          if (!multi) return Boolean(await saveFile(files[0].data, { suggestedName: files[0].name, filters: [{ name: 'SVG', extensions: ['svg'] }] }));
          return Boolean(await saveFile(await zipBlobs(files), { suggestedName: `${base}-svg.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] }));
        }
        if (opts.format === 'pdf') {
          const bytes = await artboardsPdf(doc, artboards, onProgress);
          return Boolean(await saveFile(bytes, { suggestedName: `${base}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] }));
        }
        const ext = opts.format === 'png' ? 'png' : 'jpg';
        const files: { name: string; data: Blob }[] = [];
        for (let i = 0; i < artboards.length; i++) {
          const ab = artboards[i];
          const blob = opts.format === 'png' ? await artboardPng(doc, ab, opts.scale, opts.transparent) : await artboardJpg(doc, ab, opts.scale, opts.quality);
          const suffix = opts.scale !== 1 ? `@${opts.scale}x` : '';
          files.push({ name: fileFor(ab.name, ext).replace(`.${ext}`, `${suffix}.${ext}`), data: blob });
          onProgress?.((i + 1) / artboards.length);
        }
        if (!multi) return Boolean(await saveFile(files[0].data, { suggestedName: files[0].name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }));
        return Boolean(await saveFile(await zipBlobs(files), { suggestedName: `${base}-${ext}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] }));
      } catch (error) {
        toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    /* ------------------------------- Clipboard ------------------------------- */
    copyToClipboard(): string | null {
      const c = get();
      const ids = topLevelSelection(c.doc.objects, c.selection);
      if (!ids.length) return null;
      const objects = extractWorldCopies(c.doc.objects, ids);
      const svg = exportObjectsSvg(objects);
      clipboard = { objects, svg, pastes: 0 };
      return svg;
    },
    cut(): string | null {
      const svg = actions.copyToClipboard();
      if (!svg) return null;
      const c = get();
      const ids = topLevelSelection(c.doc.objects, c.selection);
      c.update((d) => ({ ...d, objects: removeByIds(d.objects, ids) }), 'Cut');
      c.setSelection([]);
      return svg;
    },
    /** Pastes our own objects, SVG markup, images or plain text. */
    async paste(text?: string | null, files?: File[]) {
      const c = get();
      if (files?.length) {
        await actions.openFiles(files, 'place');
        return;
      }
      const s = text?.trim() ?? '';
      if (clipboard && (!s || s === clipboard.svg.trim())) {
        clipboard.pastes++;
        const off = clipboard.pastes * 10;
        const copies = clipboard.objects.map((o) => cloneWithNewIds(o));
        const ids = copies.map((o) => o.id);
        c.update((d) => {
          const next = insertObjects(d, copies, c.scope);
          return { ...next, objects: moveByIds(next.objects, ids, off, off) };
        }, 'Paste');
        c.setSelection(ids);
        return;
      }
      if (/<svg[\s>]/i.test(s)) {
        actions.importSvgMarkup(s, 'place', t('Pasted SVG'));
        return;
      }
      if (s && s.length < 5000) {
        const ab = c.activeArtboard;
        const obj = createText(0, 0, s, { fontFamily: c.options.fontFamily, fontSize: Math.min(c.options.fontSize, 48) }, textFill(c));
        const b = boundsUnder(obj, obj.m);
        const center = rectCenter({ x: ab.x, y: ab.y, width: ab.width, height: ab.height });
        obj.m = translate(center.x - (b ? b.x + b.width / 2 : 0), center.y - (b ? b.y + b.height / 2 : 0));
        c.update((d) => insertObjects(d, [obj], c.scope), 'Paste text');
        c.setSelection([obj.id]);
      }
    },
    hasClipboard: () => Boolean(clipboard),
  };
  return actions;
}

export type FileActions = ReturnType<typeof fileActions>;
