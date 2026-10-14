/**
 * AI image features: background removal (rembg, with a non-AI fallback), generative fill and
 * text-to-image (Stable Diffusion WebUI), and image descriptions (the user's AI connection).
 */
import { confirmDialog, toast } from '../../components/ui';
import { describeAIError, providerSupportsImages, resolveProvider, runAI } from '../../core/ai/client';
import { generateImages } from '../../core/ai/media';
import { useAISettings } from '../../core/ai/settings';
import { t } from '../../core/i18n';
import { desktop } from '../../core/platform';
import { blobToBase64 } from '../../core/utils/base64';
import { canvasToAIImage } from '../../core/utils/image';
import { uid } from '../../core/utils/id';
import type { ImageGenRequest } from '@shared/ai-types';
import { placeCanvas } from './actions';
import { canvasToBlobAsync, ctx2d, makeCanvas, readPixels, scaleCanvas, selectionCanvas } from './canvas';
import { findLayer, insertLayer, layerIndex, makeRasterLayer, updateLayer } from './doc';
import { blankDocument } from './docops';
import type { PhotoEngine } from './engine';
import { urlToCanvas } from './io';
import { clearByMask, uniformBackgroundMask } from './pixels/flood';
import { flattenToCanvas } from './render';
import { intersectRects } from './selection';
import { usePhotoStore } from './store';
import { setBusy } from './ui/StatusBar';
import type { Layer, PhotoDoc, RasterLayer } from './types';

const REMBG_HELP = 'AI background removal uses rembg, a free tool that runs on your computer. Install it with:\npip install "rembg[cpu,cli]"\nthen restart Ultima (desktop app).';

async function canvasBase64(canvas: HTMLCanvasElement): Promise<string> {
  return blobToBase64(await canvasToBlobAsync(canvas));
}

/* ----------------------------- background removal ----------------------------- */

/** New doc with the uniform-background-removed copy of `layerId` above it (original hidden). */
export function uniformBackgroundDoc(doc: PhotoDoc, layerId: string, tolerance = 32): PhotoDoc {
  const layer = findLayer(doc, layerId);
  if (!layer || layer.type !== 'raster') return doc;
  const img = readPixels(layer.canvas);
  const mask = uniformBackgroundMask(img.data, img.width, img.height, tolerance);
  clearByMask(img.data, img.width, img.height, mask);
  const c = makeCanvas(img.width, img.height);
  ctx2d(c).putImageData(img, 0, 0);
  return withCutout(doc, layer, c);
}

function withCutout(doc: PhotoDoc, layer: RasterLayer, canvas: HTMLCanvasElement): PhotoDoc {
  const cut = makeRasterLayer(`${layer.name} (no background)`, canvas, layer.x, layer.y);
  const hidden = updateLayer(doc, layer.id, { visible: false } as Partial<Layer>);
  return insertLayer(hidden, cut, layerIndex(hidden, layer.id) + 1);
}

/** Runs rembg (desktop) on a raster layer; null when the tool is not available. */
export async function rembgDoc(doc: PhotoDoc, layerId: string): Promise<{ doc: PhotoDoc } | { error: string; missing: boolean }> {
  const layer = findLayer(doc, layerId);
  if (!layer || layer.type !== 'raster') return { error: t('Select a pixel layer first'), missing: false };
  if (!desktop) return { error: t('Background removal with AI needs the desktop app.'), missing: true };
  const status = useAISettings.getState().tools.find((x) => x.id === 'rembg');
  if (status && !status.available) return { error: REMBG_HELP, missing: true };
  const res = await desktop.tools.removeBackground({ requestId: uid('rb'), pngBase64: await canvasBase64(layer.canvas) });
  if (!res.ok || !res.pngBase64) return { error: res.error || 'rembg failed', missing: /not installed|ENOENT|not found/i.test(res.error ?? '') };
  const c = await urlToCanvas(`data:image/png;base64,${res.pngBase64}`);
  const fitted = c.width === layer.canvas.width && c.height === layer.canvas.height ? c : scaleCanvas(c, layer.canvas.width, layer.canvas.height);
  return { doc: withCutout(doc, layer, fitted) };
}

/** The active pixel layer, or the topmost visible one (background removal never rasterizes text). */
function pixelLayerFor(engine: PhotoEngine): RasterLayer | null {
  const doc = engine.doc;
  if (!doc) return null;
  const active = findLayer(doc, doc.activeId);
  if (active?.type === 'raster') return engine.canEdit(active) ? active : null;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.type === 'raster' && l.visible && !l.locked) return l;
  }
  toast.info(t('Select a pixel layer first'));
  return null;
}

export async function removeBackground(engine: PhotoEngine): Promise<void> {
  const layer = pixelLayerFor(engine);
  const doc = engine.doc;
  if (!layer || !doc) return;
  setBusy(t('Removing background…'));
  try {
    const result = await rembgDoc(doc, layer.id);
    if ('doc' in result) {
      engine.commit(result.doc, 'Remove Background');
      toast.success(t('Background removed'), t('The original layer was hidden.'));
      return;
    }
    const ok = await confirmDialog({
      title: t('AI background removal is not available'),
      message: `${t(result.missing ? REMBG_HELP : result.error)}\n\n${t('Remove a uniform (plain) background without AI instead?')}`,
      confirmLabel: t('Remove uniform background'),
    });
    if (ok) {
      const current = engine.doc;
      if (current) engine.commit(uniformBackgroundDoc(current, layer.id), 'Remove Uniform Background');
    }
  } catch (error) {
    toast.error(t('Background removal failed'), error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(null);
  }
}

export function removeUniformBackground(engine: PhotoEngine): void {
  const layer = pixelLayerFor(engine);
  const doc = engine.doc;
  if (!layer || !doc) return;
  const next = uniformBackgroundDoc(doc, layer.id);
  if (next === doc) return;
  engine.commit(next, 'Remove Uniform Background');
}

/* ------------------------------ Stable Diffusion ------------------------------ */

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** Calls the user's Stable Diffusion WebUI (desktop bridge, or directly from the browser). */
export async function sdGenerate(req: Omit<ImageGenRequest, 'requestId' | 'baseUrl'>): Promise<string[]> {
  const baseUrl = useAISettings.getState().sdUrl;
  if (desktop) {
    const res = await desktop.tools.imageGenerate({ ...req, requestId: uid('sd'), baseUrl });
    if (!res.ok) throw new Error(res.error || 'Image generation failed');
    return res.images;
  }
  if (!isLocalUrl(baseUrl)) throw new Error(t('The Stable Diffusion URL must point to this computer or your local network.'));
  const common = {
    prompt: req.prompt.slice(0, 4000),
    negative_prompt: (req.negativePrompt ?? '').slice(0, 2000),
    width: req.width,
    height: req.height,
    steps: req.steps ?? 25,
    cfg_scale: req.cfgScale ?? 7,
    seed: -1,
  };
  const body = req.initImage
    ? { ...common, init_images: [req.initImage], denoising_strength: req.denoisingStrength ?? 0.75, ...(req.mask ? { mask: req.mask, inpainting_fill: 1, inpaint_full_res: true, inpaint_full_res_padding: 32, mask_blur: 4 } : {}) }
    : common;
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/sdapi/v1/${req.initImage ? 'img2img' : 'txt2img'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error(t('Could not reach Stable Diffusion WebUI at {url}. Start it with --api (and --cors-allow-origins=* for the browser version), or use the desktop app.', { url: baseUrl }));
  }
  if (!res.ok) throw new Error(`Stable Diffusion WebUI: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { images?: string[] };
  return (data.images ?? []).map((i) => i.replace(/^data:image\/\w+;base64,/, ''));
}

const snap8 = (v: number) => Math.max(64, Math.min(2048, Math.round(v / 8) * 8));

export async function generativeFill(engine: PhotoEngine, prompt: string, negative: string, strength: number): Promise<void> {
  const doc = engine.doc;
  const sel = doc?.selection;
  if (!doc || !sel) {
    toast.info(t('Make a selection first'));
    return;
  }
  const b = sel.bounds;
  const pad = Math.round(Math.max(32, Math.max(b.w, b.h) * 0.15));
  const region = intersectRects({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, { x: 0, y: 0, w: doc.width, h: doc.height })!;
  const scale = Math.min(1, 1024 / Math.max(region.w, region.h));
  const gw = snap8(region.w * scale);
  const gh = snap8(region.h * scale);
  const flat = flattenToCanvas(doc, undefined, '#ffffff');
  const init = makeCanvas(gw, gh);
  ctx2d(init).drawImage(flat, region.x, region.y, region.w, region.h, 0, 0, gw, gh);
  const maskFull = makeCanvas(region.w, region.h);
  const mc = ctx2d(maskFull);
  mc.fillStyle = '#000000';
  mc.fillRect(0, 0, region.w, region.h);
  const white = makeCanvas(b.w, b.h);
  const wc = ctx2d(white);
  wc.drawImage(selectionCanvas(sel), 0, 0);
  wc.globalCompositeOperation = 'source-in';
  wc.fillStyle = '#ffffff';
  wc.fillRect(0, 0, b.w, b.h);
  mc.drawImage(white, b.x - region.x, b.y - region.y);
  const mask = scaleCanvas(maskFull, gw, gh);
  setBusy(t('Generating…'));
  try {
    const images = await sdGenerate({
      prompt,
      negativePrompt: negative,
      width: gw,
      height: gh,
      initImage: await canvasBase64(init),
      mask: await canvasBase64(mask),
      denoisingStrength: Math.max(0.1, Math.min(1, strength)),
    });
    if (!images.length) throw new Error(t('The generator returned no image'));
    const out = await urlToCanvas(`data:image/png;base64,${images[0]}`);
    const fitted = scaleCanvas(out, region.w, region.h);
    const current = engine.doc!;
    const layer = makeRasterLayer(prompt.slice(0, 40) || 'Generative Fill', fitted, region.x, region.y);
    const maskCanvas = makeCanvas(current.width, current.height);
    ctx2d(maskCanvas).drawImage(selectionCanvas(sel), b.x, b.y);
    layer.mask = { canvas: maskCanvas, x: 0, y: 0, reveal: false, enabled: true };
    engine.commit({ ...insertLayer(current, layer), selection: null }, 'Generative Fill');
    toast.success(t('Generative fill added as a new masked layer'));
  } catch (error) {
    toast.error(t('Generative fill failed'), error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(null);
  }
}

/** Text to image with the generator from Settings → Image generation (browser: Stable Diffusion WebUI). */
export async function generateImage(engine: PhotoEngine, prompt: string, negative: string, width: number, height: number, steps: number): Promise<void> {
  setBusy(t('Generating…'));
  try {
    const request = { prompt, negativePrompt: negative, width: snap8(width), height: snap8(height), steps };
    const viaApp = desktop || useAISettings.getState().imageProvider === 'svg';
    const url = viaApp ? (await generateImages(request))[0]?.dataUrl : (await sdGenerate(request)).map((b64) => `data:image/png;base64,${b64}`)[0];
    if (!url) throw new Error(t('The generator returned no image'));
    const canvas = await urlToCanvas(url);
    if (engine.doc) placeCanvas(engine, canvas, prompt.slice(0, 40) || 'Generated', 'Generate Image');
    else {
      const store = usePhotoStore.getState();
      const doc = blankDocument(canvas.width, canvas.height, null);
      const layer = doc.layers[0] as RasterLayer;
      store.openSession({ ...doc, layers: [{ ...layer, canvas, name: prompt.slice(0, 40) || 'Generated' }] }, prompt.slice(0, 32) || store.nextUntitled(), 'Generate Image');
    }
  } catch (error) {
    toast.error(t('Image generation failed'), error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(null);
  }
}

/* ---------------------------------- describe ---------------------------------- */

export interface Description {
  alt: string;
  description: string;
}

export async function describeImage(engine: PhotoEngine, onText: (text: string) => void, signal?: AbortSignal): Promise<Description> {
  const doc = engine.doc;
  if (!doc) throw new Error(t('No document'));
  const provider = resolveProvider();
  if (!provider) throw new Error(t('Connect an AI in Settings → AI connections first.'));
  if (!providerSupportsImages(provider)) throw new Error(t('Your current AI connection cannot look at images. Choose one that supports images (for example Claude, Codex, Gemini or a vision model in Ollama).'));
  const image = await canvasToAIImage(flattenToCanvas(doc), { maxSize: 1024 });
  try {
    const { text } = await runAI({
      prompt:
        'Describe the attached image.\nFirst line: "ALT: " followed by concise alt text for accessibility (max 125 characters).\nThen an empty line, then a detailed description (2–5 sentences) of subject, setting, colors, mood and composition. Reply in the language of the user interface if it is not English: ' +
        (usePhotoStore.getState() && document.documentElement.lang === 'id' ? 'Indonesian.' : 'English.'),
      system: 'You write accurate, neutral image descriptions and alt text. Never invent details you cannot see.',
      images: [image],
      onText,
      signal,
    });
    const m = /ALT:\s*(.+)/i.exec(text);
    const alt = (m?.[1] ?? text.split('\n')[0]).trim().slice(0, 300);
    const description = text.replace(/^.*ALT:.*$/im, '').trim();
    return { alt, description: description || text.trim() };
  } catch (error) {
    throw new Error(describeAIError(error));
  }
}
