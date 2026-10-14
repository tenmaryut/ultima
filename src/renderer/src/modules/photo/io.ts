/**
 * File input/output: decoding images (incl. sanitized SVG and PSD), the .ultima project
 * format, and PNG/JPG/WebP/PSD export.
 */
import { sanitizeSvg } from '../../core/ai/sanitize';
import { fileBaseName, fileExtension } from '../../core/utils/format';
import { canvasToBlobAsync, canvasToDataUrl, ctx2d, makeCanvas, readPixels, scaleCanvas, selectionCanvas } from './canvas';
import { makeRasterLayer } from './doc';
import { flattenToCanvas, layerContent, drawLayer } from './render';
import { selectionFromMask } from './selection';
import {
  isBlendMode,
  MAX_DOC_PIXELS,
  MAX_DOC_SIDE,
  type BlendMode,
  type Layer,
  type LayerEffects,
  type LayerMask,
  type PhotoDoc,
  type ShapeKind,
  type TextAlign,
} from './types';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico', 'svg', 'psd'];
export const OPEN_ACCEPT = 'image/*,.psd,.svg,.ultima,.avif,.ico';

export function checkDocSize(w: number, h: number): void {
  if (!(w >= 1 && h >= 1)) throw new Error('The image has no size');
  if (w > MAX_DOC_SIDE || h > MAX_DOC_SIDE || w * h > MAX_DOC_PIXELS) {
    throw new Error(`The image is too large (${w}×${h}). The limit is ${MAX_DOC_SIDE} px per side and ${Math.round(MAX_DOC_PIXELS / 1e6)} megapixels.`);
  }
}

/* --------------------------------- decoding --------------------------------- */

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  try {
    const bitmap = await createImageBitmap(blob);
    checkDocSize(bitmap.width, bitmap.height);
    const c = makeCanvas(bitmap.width, bitmap.height);
    ctx2d(c).drawImage(bitmap, 0, 0);
    bitmap.close();
    return c;
  } catch (error) {
    if (error instanceof Error && /too large/.test(error.message)) throw error;
    return urlToCanvas(URL.createObjectURL(blob), true);
  }
}

export function urlToCanvas(url: string, revoke = false): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (revoke) URL.revokeObjectURL(url);
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        checkDocSize(w, h);
        const c = makeCanvas(w, h);
        ctx2d(c).drawImage(img, 0, 0, w, h);
        resolve(c);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => {
      if (revoke) URL.revokeObjectURL(url);
      reject(new Error('Could not decode the image (unsupported or damaged file)'));
    };
    img.src = url;
  });
}

/** Rasterizes SVG markup (sanitized first). Small icons are scaled up to `minSide`. */
export async function svgToCanvas(svgText: string, minSide = 1024): Promise<HTMLCanvasElement> {
  const clean = sanitizeSvg(svgText);
  if (!clean) throw new Error('The SVG could not be read');
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const root = doc.documentElement;
  const num = (v: string | null) => {
    const n = v ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n > 0 && !/%$/.test(v ?? '') ? n : NaN;
  };
  let w = num(root.getAttribute('width'));
  let h = num(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w && !h) h = (w * vb[3]) / vb[2];
    else if (h && !w) w = (h * vb[2]) / vb[3];
    else {
      w = vb[2];
      h = vb[3];
    }
  }
  if (!w || !h) {
    w = 1024;
    h = 1024;
  }
  const scale = Math.max(w, h) < minSide ? minSide / Math.max(w, h) : Math.max(w, h) > 8000 ? 8000 / Math.max(w, h) : 1;
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  root.setAttribute('width', String(W));
  root.setAttribute('height', String(H));
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const markup = new XMLSerializer().serializeToString(root);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  const img = await urlToCanvas(url, true);
  if (img.width === W && img.height === H) return img;
  return scaleCanvas(img, W, H);
}

/* ------------------------------------ PSD ------------------------------------ */

const PSD_TO_BLEND: Record<string, BlendMode> = {
  normal: 'source-over',
  'pass through': 'source-over',
  dissolve: 'source-over',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  'linear burn': 'multiply',
  'darker color': 'darken',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  'linear dodge': 'lighter',
  'lighter color': 'lighten',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  'vivid light': 'hard-light',
  'linear light': 'hard-light',
  'pin light': 'hard-light',
  'hard mix': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  subtract: 'difference',
  divide: 'color-dodge',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

const BLEND_TO_PSD: Record<BlendMode, string> = {
  'source-over': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  'hard-light': 'hard light',
  'soft-light': 'soft light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  lighter: 'linear dodge',
};

interface PixelDataLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

function pixelDataToRgba(p: PixelDataLike): Uint8ClampedArray {
  const src = p.data;
  const n = p.width * p.height * 4;
  if (src instanceof Uint8ClampedArray && src.length === n) return src;
  const out = new Uint8ClampedArray(n);
  if (src instanceof Uint16Array) for (let i = 0; i < n; i++) out[i] = src[i] / 257;
  else if (src instanceof Float32Array) {
    for (let i = 0; i < n; i++) out[i] = (i & 3) === 3 ? src[i] * 255 : Math.pow(Math.max(0, src[i]), 1 / 2.2) * 255;
  } else for (let i = 0; i < n; i++) out[i] = src[i];
  return out;
}

function pixelDataToCanvas(p: PixelDataLike): HTMLCanvasElement {
  const c = makeCanvas(p.width, p.height);
  if (p.width && p.height) ctx2d(c).putImageData(new ImageData(pixelDataToRgba(p) as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return c;
}

/** Mask pixels (gray) → mask canvas (alpha). */
function psdMaskCanvas(p: PixelDataLike): HTMLCanvasElement {
  const rgba = pixelDataToRgba(p);
  const out = new Uint8ClampedArray(p.width * p.height * 4);
  for (let i = 0; i < p.width * p.height; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255;
    out[i * 4 + 3] = rgba[i * 4];
  }
  const c = makeCanvas(p.width, p.height);
  if (p.width && p.height) ctx2d(c).putImageData(new ImageData(out, p.width, p.height), 0, 0);
  return c;
}

interface PsdNode {
  name?: string;
  left?: number;
  top?: number;
  opacity?: number;
  hidden?: boolean;
  blendMode?: string;
  imageData?: PixelDataLike;
  children?: PsdNode[];
  mask?: { left?: number; top?: number; defaultColor?: number; disabled?: boolean; imageData?: PixelDataLike };
}

export async function psdToDocument(buffer: ArrayBuffer): Promise<PhotoDoc> {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true }) as unknown as PsdNode & { width: number; height: number };
  checkDocSize(psd.width, psd.height);
  const layers: Layer[] = [];
  const walk = (nodes: PsdNode[] | undefined, groupOpacity: number, groupHidden: boolean) => {
    for (const node of nodes ?? []) {
      if (node.children) {
        walk(node.children, groupOpacity * (node.opacity ?? 1), groupHidden || Boolean(node.hidden));
        continue;
      }
      if (!node.imageData || !node.imageData.width || !node.imageData.height) continue;
      const layer = makeRasterLayer(node.name || `Layer ${layers.length + 1}`, pixelDataToCanvas(node.imageData), node.left ?? 0, node.top ?? 0);
      layer.opacity = Math.max(0, Math.min(1, (node.opacity ?? 1) * groupOpacity));
      layer.visible = !node.hidden && !groupHidden;
      layer.blend = PSD_TO_BLEND[node.blendMode ?? 'normal'] ?? 'source-over';
      const m = node.mask;
      if (m?.imageData && m.imageData.width && m.imageData.height) {
        layer.mask = { canvas: psdMaskCanvas(m.imageData), x: m.left ?? 0, y: m.top ?? 0, reveal: (m.defaultColor ?? 255) > 127, enabled: !m.disabled };
      }
      layers.push(layer);
    }
  };
  walk(psd.children, 1, false);
  if (!layers.length && psd.imageData) layers.push(makeRasterLayer('Background', pixelDataToCanvas(psd.imageData)));
  if (!layers.length) throw new Error('The PSD file has no readable layers');
  return { width: psd.width, height: psd.height, layers, activeId: layers[layers.length - 1].id, selection: null };
}

/** Rasterized layer canvases + masks → PSD file bytes. */
export async function documentToPsd(doc: PhotoDoc): Promise<Uint8Array> {
  const { writePsdUint8Array } = await import('ag-psd');
  const children = doc.layers.map((layer) => {
    let content = layerContent(layer);
    if (layer.effects.shadow?.enabled || layer.effects.stroke?.enabled || layer.effects.glow?.enabled) {
      // bake effects into the pixels so every app shows them
      const c = makeCanvas(doc.width, doc.height);
      const ctx = ctx2d(c);
      drawLayer(ctx, { ...layer, visible: true, opacity: 1, blend: 'source-over', mask: null }, { x: 0, y: 0, w: doc.width, h: doc.height });
      content = { canvas: c, x: 0, y: 0 };
    }
    const canvas = content?.canvas ?? makeCanvas(1, 1);
    const node: Record<string, unknown> = {
      name: layer.name,
      left: Math.round(content?.x ?? 0),
      top: Math.round(content?.y ?? 0),
      canvas,
      opacity: layer.opacity,
      blendMode: BLEND_TO_PSD[layer.blend] ?? 'normal',
      hidden: !layer.visible,
    };
    if (layer.mask) {
      const m = layer.mask;
      const a = readPixels(m.canvas).data;
      const gray = new ImageData(m.canvas.width, m.canvas.height);
      for (let i = 0; i < a.length; i += 4) {
        gray.data[i] = gray.data[i + 1] = gray.data[i + 2] = a[i + 3];
        gray.data[i + 3] = 255;
      }
      node.mask = { left: Math.round(m.x), top: Math.round(m.y), defaultColor: m.reveal ? 255 : 0, disabled: !m.enabled, imageData: gray };
    }
    return node;
  });
  const psd = { width: doc.width, height: doc.height, children, canvas: flattenToCanvas(doc) };
  return writePsdUint8Array(psd as never, { noBackground: true, generateThumbnail: false });
}

/* ------------------------------- project files ------------------------------- */

export interface ProjectData {
  doc: PhotoDoc;
  name: string;
  fg?: string;
  bg?: string;
}

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number, min = -1e7, max = 1e7) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(v.trim()) ? v.trim() : d);

function serializeEffects(e: LayerEffects): LayerEffects {
  return JSON.parse(JSON.stringify(e)) as LayerEffects;
}

function parseEffects(v: unknown): LayerEffects {
  const e = (v && typeof v === 'object' ? v : {}) as Record<string, Record<string, unknown> | undefined>;
  const out: LayerEffects = {};
  if (e.shadow) out.shadow = { enabled: bool(e.shadow.enabled, false), color: color(e.shadow.color, '#000000'), opacity: num(e.shadow.opacity, 0.6, 0, 1), angle: num(e.shadow.angle, 120, -360, 360), distance: num(e.shadow.distance, 8, 0, 1000), size: num(e.shadow.size, 10, 0, 500) };
  if (e.stroke) {
    const pos = e.stroke.position;
    out.stroke = { enabled: bool(e.stroke.enabled, false), color: color(e.stroke.color, '#000000'), size: num(e.stroke.size, 3, 0, 500), opacity: num(e.stroke.opacity, 1, 0, 1), position: pos === 'inside' || pos === 'center' ? pos : 'outside' };
  }
  if (e.glow) out.glow = { enabled: bool(e.glow.enabled, false), color: color(e.glow.color, '#ffff99'), opacity: num(e.glow.opacity, 0.75, 0, 1), size: num(e.glow.size, 16, 0, 500), spread: num(e.glow.spread, 0, 0, 100) };
  return out;
}

export function documentToProject(doc: PhotoDoc, name: string, fg: string, bg: string): string {
  const layers = doc.layers.map((l) => {
    const common = {
      id: l.id,
      name: l.name,
      type: l.type,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blend: l.blend,
      effects: serializeEffects(l.effects),
      mask: l.mask ? { png: canvasToDataUrl(l.mask.canvas), x: l.mask.x, y: l.mask.y, reveal: l.mask.reveal, enabled: l.mask.enabled } : null,
    };
    if (l.type === 'raster') return { ...common, x: l.x, y: l.y, png: canvasToDataUrl(l.canvas) };
    if (l.type === 'text') {
      const { text, x, y, font, size, weight, italic, underline, color: c, align, lineHeight, letterSpacing, rotation } = l;
      return { ...common, text, x, y, font, size, weight, italic, underline, color: c, align, lineHeight, letterSpacing, rotation };
    }
    const { shape, x, y, w, h, fill, stroke, strokeWidth, radius, rotation } = l;
    return { ...common, shape, x, y, w, h, fill, stroke, strokeWidth, radius, rotation };
  });
  let selection: string | null = null;
  if (doc.selection) {
    const c = makeCanvas(doc.width, doc.height);
    ctx2d(c).drawImage(selectionCanvas(doc.selection), doc.selection.bounds.x, doc.selection.bounds.y);
    selection = canvasToDataUrl(c);
  }
  return JSON.stringify({ app: 'ultima', module: 'photo', version: 1, name, width: doc.width, height: doc.height, activeId: doc.activeId, colors: { fg, bg }, layers, selection });
}

export async function projectToDocument(json: unknown): Promise<ProjectData> {
  const p = json as Record<string, unknown>;
  if (!p || p.app !== 'ultima' || p.module !== 'photo') throw new Error('This is not a Photo Editor project');
  if (typeof p.version === 'number' && p.version > 1) throw new Error('This project was saved by a newer version of Ultima');
  const width = Math.round(num(p.width, 0, 1, MAX_DOC_SIDE));
  const height = Math.round(num(p.height, 0, 1, MAX_DOC_SIDE));
  checkDocSize(width, height);
  const rawLayers = Array.isArray(p.layers) ? (p.layers as Record<string, unknown>[]) : [];
  const decode = async (v: unknown): Promise<HTMLCanvasElement | null> => (typeof v === 'string' && v.startsWith('data:image/') ? urlToCanvas(v) : null);
  const layers: Layer[] = [];
  for (const r of rawLayers) {
    if (!r || typeof r !== 'object') continue;
    const blend = isBlendMode(r.blend) ? r.blend : 'source-over';
    let mask: LayerMask | null = null;
    const rm = r.mask as Record<string, unknown> | null | undefined;
    if (rm && typeof rm === 'object') {
      const mc = await decode(rm.png);
      if (mc) mask = { canvas: mc, x: num(rm.x, 0), y: num(rm.y, 0), reveal: bool(rm.reveal, true), enabled: bool(rm.enabled, true) };
    }
    const common = {
      id: str(r.id, `ly${layers.length}${Date.now().toString(36)}`),
      name: str(r.name, `Layer ${layers.length + 1}`).slice(0, 200),
      visible: bool(r.visible, true),
      locked: bool(r.locked, false),
      opacity: num(r.opacity, 1, 0, 1),
      blend,
      mask,
      effects: parseEffects(r.effects),
    };
    if (r.type === 'raster') {
      const canvas = await decode(r.png);
      if (!canvas) continue;
      layers.push({ ...common, type: 'raster', canvas, x: num(r.x, 0), y: num(r.y, 0) });
    } else if (r.type === 'text') {
      const align = r.align === 'center' || r.align === 'right' ? (r.align as TextAlign) : 'left';
      layers.push({
        ...common,
        type: 'text',
        text: str(r.text, '').slice(0, 20000),
        x: num(r.x, 0),
        y: num(r.y, 0),
        font: str(r.font, 'Inter').slice(0, 120),
        size: num(r.size, 48, 1, 4000),
        weight: num(r.weight, 400, 100, 900),
        italic: bool(r.italic, false),
        underline: bool(r.underline, false),
        color: color(r.color, '#000000'),
        align,
        lineHeight: num(r.lineHeight, 1.2, 0.5, 5),
        letterSpacing: num(r.letterSpacing, 0, -200, 1000),
        rotation: num(r.rotation, 0, -360, 360),
      });
    } else if (r.type === 'shape') {
      const kinds: ShapeKind[] = ['rect', 'roundrect', 'ellipse', 'line'];
      const shape = kinds.includes(r.shape as ShapeKind) ? (r.shape as ShapeKind) : 'rect';
      layers.push({
        ...common,
        type: 'shape',
        shape,
        x: num(r.x, 0),
        y: num(r.y, 0),
        w: num(r.w, 100),
        h: num(r.h, 100),
        fill: r.fill === null ? null : color(r.fill, '#000000'),
        stroke: r.stroke === null || r.stroke === undefined ? null : color(r.stroke, '#000000'),
        strokeWidth: num(r.strokeWidth, 4, 0, 1000),
        radius: num(r.radius, 0, 0, 10000),
        rotation: num(r.rotation, 0, -360, 360),
      });
    }
  }
  if (!layers.length) layers.push(makeRasterLayer('Layer 1', makeCanvas(width, height)));
  let selection = null;
  const selCanvas = await decode(p.selection);
  if (selCanvas && selCanvas.width === width && selCanvas.height === height) {
    const d = readPixels(selCanvas).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3];
    selection = selectionFromMask(mask, width, height);
  }
  const activeId = typeof p.activeId === 'string' && layers.some((l) => l.id === p.activeId) ? p.activeId : layers[layers.length - 1].id;
  const colors = (p.colors ?? {}) as Record<string, unknown>;
  return {
    doc: { width, height, layers, activeId, selection },
    name: str(p.name, 'Untitled'),
    fg: typeof colors.fg === 'string' ? color(colors.fg, '#000000') : undefined,
    bg: typeof colors.bg === 'string' ? color(colors.bg, '#ffffff') : undefined,
  };
}

/* ---------------------------------- opening ---------------------------------- */

export interface OpenedFile {
  doc: PhotoDoc;
  name: string;
  project?: ProjectData;
}

export function isProjectFile(file: File): boolean {
  return fileExtension(file.name) === 'ultima';
}

export async function readFileAsDocument(file: File): Promise<OpenedFile> {
  const ext = fileExtension(file.name);
  const name = fileBaseName(file.name) || 'Untitled';
  if (ext === 'ultima' || file.type === 'application/json') {
    const project = await projectToDocument(JSON.parse(await file.text()));
    return { doc: project.doc, name: project.name || name, project };
  }
  if (ext === 'psd' || file.type === 'image/vnd.adobe.photoshop') return { doc: await psdToDocument(await file.arrayBuffer()), name };
  if (ext === 'svg' || file.type === 'image/svg+xml') return { doc: canvasDoc(await svgToCanvas(await file.text())), name };
  return { doc: canvasDoc(await blobToCanvas(file)), name };
}

/** Decodes a file into a canvas (for Place / drag & drop as a layer). */
export async function readFileAsCanvas(file: File): Promise<HTMLCanvasElement> {
  const ext = fileExtension(file.name);
  if (ext === 'svg' || file.type === 'image/svg+xml') return svgToCanvas(await file.text(), 512);
  if (ext === 'psd') return flattenToCanvas(await psdToDocument(await file.arrayBuffer()));
  return blobToCanvas(file);
}

function canvasDoc(canvas: HTMLCanvasElement): PhotoDoc {
  const layer = makeRasterLayer('Background', canvas);
  return { width: canvas.width, height: canvas.height, layers: [layer], activeId: layer.id, selection: null };
}

/* ---------------------------------- export ---------------------------------- */

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export async function exportImage(doc: PhotoDoc, options: { format: ExportFormat; quality: number; scale: number; background?: string }): Promise<Blob> {
  let canvas = flattenToCanvas(doc, undefined, options.format === 'jpeg' ? (options.background ?? '#ffffff') : options.background);
  if (options.scale !== 1) canvas = scaleCanvas(canvas, Math.max(1, Math.round(doc.width * options.scale)), Math.max(1, Math.round(doc.height * options.scale)));
  const mime = options.format === 'png' ? 'image/png' : options.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  return canvasToBlobAsync(canvas, mime, options.format === 'png' ? undefined : Math.max(0.05, Math.min(1, options.quality)));
}
