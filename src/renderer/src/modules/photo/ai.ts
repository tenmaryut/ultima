/**
 * AI assistant integration: instructions (every action documented), document context with a
 * snapshot, and a validating executor that applies all actions of one reply as ONE undo step.
 */
import type { AIAction, AIContext } from '../../components/ai/AIAssistantPanel';
import { stripHtml } from '../../core/ai/sanitize';
import { t } from '../../core/i18n';
import { parseColor, toHex } from '../../core/utils/color';
import { canvasToAIImage } from '../../core/utils/image';
import { canvasFromPixels, readPixels } from './canvas';
import { findLayer, insertLayer, makeTextLayer, nextLayerName } from './doc';
import { cropDoc, fillLayer, flipDoc, rasterizeLayer, resizeImage, rotateDoc90, rotateDocArbitrary, addEmptyLayer } from './docops';
import { rembgDoc, uniformBackgroundDoc } from './aiTools';
import type { PhotoEngine } from './engine';
import { autoToneParams, histogram } from './pixels/tone';
import { blendBySelection } from './pixels/filters';
import type { PixelOp } from './pixels/ops';
import { runPixelOpAsync } from './pixels/workerClient';
import { flattenToCanvas, layoutText } from './render';
import { usePhotoStore } from './store';
import { BLEND_MODES, type Layer, type PhotoDoc, type RasterLayer, type TextAlign } from './types';

export const PHOTO_AI_INSTRUCTIONS = `You edit raster images in a Photoshop-like editor with layers.
Coordinates in actions are RELATIVE (0..1 of the image width/height) unless stated otherwise.
Pixel edits ("adjust", "filter", "fill") apply to the ACTIVE pixel layer (or the topmost visible pixel layer when the active one is text/shape) and only inside the current selection when there is one.

ACTIONS (JSON objects inside "actions"):
1. {"type":"adjust", "brightness"?: -100..100, "contrast"?: -100..100, "saturation"?: -100..100, "exposure"?: -3..3 (photographic stops), "temperature"?: -100..100 (negative = cooler/blue, positive = warmer/yellow), "tint"?: -100..100 (negative = green, positive = magenta), "vibrance"?: -100..100, "hue"?: -180..180 (degrees)}
   Omit fields you do not change. Subtle edits use values around 5-25.
2. {"type":"filter", "name": "blur"|"motionBlur"|"sharpen"|"unsharpMask"|"noise"|"denoise"|"pixelate"|"emboss"|"findEdges"|"vignette"|"grain"|"oilPaint"|"invert"|"grayscale"|"sepia"|"posterize"|"threshold"|"highPass", "amount"?: 0..100 (strength, default 50)}
3. {"type":"addText", "text": string (max 500 chars, use \\n for new lines), "x": 0..1, "y": 0..1, "size"?: font size in px (4..1000, default 8% of the image height), "color"?: "#rrggbb", "font"?: one of the AVAILABLE FONTS, "weight"?: 100..900, "align"?: "left"|"center"|"right"}
   x is the left edge / center / right edge of the text block depending on "align"; y is the vertical center of the block.
4. {"type":"crop", "x": 0..1, "y": 0..1, "width": 0..1, "height": 0..1}  OR  {"type":"crop", "aspect": "16:9"} (largest centered crop with that ratio, e.g. "1:1", "4:5", "9:16")
5. {"type":"resize", "width"?: px, "height"?: px} (1..16000; give only one to keep the aspect ratio)
6. {"type":"rotate", "degrees": -360..360} (clockwise; multiples of 90 are lossless, other angles enlarge the canvas)
7. {"type":"flip", "axis": "horizontal"|"vertical"}
8. {"type":"fill", "color": "#rrggbb", "opacity"?: 0..1, "asNewLayer"?: boolean} (fills the selection, or the whole layer when nothing is selected; asNewLayer=true puts the fill on a new layer above the active one)
9. {"type":"newLayer", "name"?: string}
10. {"type":"autoEnhance"} (automatic tone correction plus a little vibrance)
11. {"type":"removeBackground"} (cuts the subject out of the active layer into a new layer; the original is hidden)

EXAMPLES
User: "make it warmer and a bit brighter" → {"message":"Warmed it up and brightened it slightly.","actions":[{"type":"adjust","temperature":25,"brightness":12}]}
User: "square crop and add the title SUMMER at the top" → {"message":"Cropped to a square and added the title.","actions":[{"type":"crop","aspect":"1:1"},{"type":"addText","text":"SUMMER","x":0.5,"y":0.12,"size":120,"color":"#ffffff","weight":800,"align":"center"}]}`;

/* ---------------------------------- context ---------------------------------- */

const blendLabel = (b: string) => BLEND_MODES.find((m) => m.value === b)?.label ?? b;

export function describeDocument(doc: PhotoDoc, name: string): string {
  const store = usePhotoStore.getState();
  const lines: string[] = [];
  lines.push(`Image "${name}": ${doc.width}×${doc.height} px, ${doc.layers.length} layer(s) listed bottom → top:`);
  for (const l of doc.layers) {
    let extra = '';
    if (l.type === 'raster') extra = `pixels ${l.canvas.width}×${l.canvas.height} at (${Math.round(l.x)},${Math.round(l.y)})`;
    else if (l.type === 'text') extra = `text "${l.text.slice(0, 80).replace(/\n/g, ' ')}" font ${l.font} ${Math.round(l.size)}px ${l.color} at (${Math.round(l.x)},${Math.round(l.y)})`;
    else extra = `${l.shape} ${Math.round(l.w)}×${Math.round(l.h)} at (${Math.round(l.x)},${Math.round(l.y)})`;
    lines.push(
      `- id "${l.id}" "${l.name}" ${l.type} ${extra}, ${l.visible ? 'visible' : 'hidden'}, opacity ${Math.round(l.opacity * 100)}%, blend ${blendLabel(l.blend)}${l.mask ? ', has mask' : ''}${l.locked ? ', locked' : ''}${l.id === doc.activeId ? ' [ACTIVE]' : ''}`,
    );
  }
  const s = doc.selection?.bounds;
  lines.push(s ? `Selection: ${s.w}×${s.h} px at (${s.x},${s.y}) = relative x ${(s.x / doc.width).toFixed(3)}, y ${(s.y / doc.height).toFixed(3)}, width ${(s.w / doc.width).toFixed(3)}, height ${(s.h / doc.height).toFixed(3)}` : 'Selection: none');
  lines.push(`Foreground color ${store.fg}, background color ${store.bg}.`);
  const fonts = store.fonts.length ? store.fonts : ['Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact'];
  lines.push(`AVAILABLE FONTS: ${fonts.slice(0, 60).join(', ')}`);
  return lines.join('\n');
}

export async function photoAIContext(engine: PhotoEngine): Promise<AIContext> {
  const doc = engine.doc;
  const session = engine.session;
  if (!doc || !session) return { summary: 'No image is open. Ask the user to create or open an image first (actions cannot be applied).' };
  let image: AIContext['image'] = null;
  try {
    image = await canvasToAIImage(flattenToCanvas(doc), { maxSize: 1024 });
  } catch {
    image = null;
  }
  return { summary: describeDocument(doc, session.name), image };
}

/* --------------------------------- validation --------------------------------- */

function num(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function hex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const c = parseColor(v.slice(0, 40));
  return c ? toHex(c) : undefined;
}

function pixelLayer(doc: PhotoDoc): RasterLayer | null {
  const active = findLayer(doc, doc.activeId);
  if (active?.type === 'raster' && !active.locked) return active;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.type === 'raster' && l.visible && !l.locked) return l;
  }
  return null;
}

async function pixelOpOnDoc(doc: PhotoDoc, op: PixelOp, params: unknown): Promise<PhotoDoc | null> {
  const layer = pixelLayer(doc);
  if (!layer) return null;
  const src = readPixels(layer.canvas).data;
  const out = await runPixelOpAsync(op, src.slice(), layer.canvas.width, layer.canvas.height, params);
  const result = doc.selection ? blendBySelection(src, out, layer.canvas.width, layer.canvas.height, layer.x, layer.y, doc.selection) : out;
  const canvas = canvasFromPixels(result, layer.canvas.width, layer.canvas.height);
  return { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? { ...layer, canvas } : l)) };
}

const FILTERS: Record<string, (a: number) => { op: PixelOp; params: unknown }> = {
  blur: (a) => ({ op: 'gaussianBlur', params: { radius: 0.5 + a * 0.3 } }),
  motionBlur: (a) => ({ op: 'motionBlur', params: { angle: 0, distance: 2 + a * 1.2 } }),
  sharpen: (a) => ({ op: 'unsharpMask', params: { amount: 40 + a * 2, radius: 1.2, threshold: 2 } }),
  unsharpMask: (a) => ({ op: 'unsharpMask', params: { amount: 50 + a * 2.5, radius: 1.5, threshold: 0 } }),
  noise: (a) => ({ op: 'addNoise', params: { amount: a * 0.4, distribution: 'gaussian', monochromatic: true, seed: 3 } }),
  denoise: (a) => ({ op: 'median', params: { radius: Math.max(1, Math.round(a / 25)) } }),
  pixelate: (a) => ({ op: 'pixelate', params: { size: Math.max(2, Math.round(a / 2)) } }),
  emboss: (a) => ({ op: 'emboss', params: { angle: 135, height: 3, amount: 50 + a * 2 } }),
  findEdges: () => ({ op: 'findEdges', params: {} }),
  vignette: (a) => ({ op: 'vignette', params: { amount: a, size: 50, feather: 60 } }),
  grain: (a) => ({ op: 'grain', params: { amount: a * 0.6, size: 1.5, seed: 9 } }),
  oilPaint: (a) => ({ op: 'oilPaint', params: { radius: Math.max(1, Math.round(a / 15)), levels: 24 } }),
  invert: () => ({ op: 'invert', params: {} }),
  grayscale: () => ({ op: 'desaturate', params: {} }),
  sepia: (a) => ({ op: 'sepia', params: { amount: a / 100 } }),
  posterize: (a) => ({ op: 'posterize', params: { levels: Math.max(2, Math.round(12 - a / 10)) } }),
  threshold: (a) => ({ op: 'threshold', params: { level: Math.round(28 + a * 2) } }),
  highPass: (a) => ({ op: 'highPass', params: { radius: 1 + a / 5 } }),
};

/* ---------------------------------- executor ---------------------------------- */

export async function executeAIActions(engine: PhotoEngine, actions: AIAction[]): Promise<string> {
  const start = engine.doc;
  if (!start) throw new Error('Open or create an image first.');
  let doc: PhotoDoc = start;
  const done: string[] = [];
  const skipped: string[] = [];
  const store = usePhotoStore.getState();
  for (const a of actions.slice(0, 30)) {
    const type = typeof a?.type === 'string' ? a.type : '';
    try {
      switch (type) {
        case 'adjust': {
          const params = {
            brightness: num(a.brightness, -100, 100),
            contrast: num(a.contrast, -100, 100),
            saturation: num(a.saturation, -100, 100),
            exposure: num(a.exposure, -3, 3),
            temperature: num(a.temperature, -100, 100),
            tint: num(a.tint, -100, 100),
            vibrance: num(a.vibrance, -100, 100),
            hue: num(a.hue, -180, 180),
          };
          const next = await pixelOpOnDoc(doc, 'basic', params);
          if (next) {
            doc = next;
            done.push('adjust');
          } else skipped.push('adjust (no pixel layer)');
          break;
        }
        case 'filter': {
          const name = typeof a.name === 'string' ? a.name : '';
          const f = FILTERS[name];
          if (!f) {
            skipped.push(`filter "${name.slice(0, 20)}"`);
            break;
          }
          const { op, params } = f(num(a.amount, 0, 100) ?? 50);
          const next = await pixelOpOnDoc(doc, op, params);
          if (next) {
            doc = next;
            done.push(name);
          } else skipped.push(`${name} (no pixel layer)`);
          break;
        }
        case 'addText': {
          const text = stripHtml(typeof a.text === 'string' ? a.text : '').slice(0, 500);
          if (!text.trim()) {
            skipped.push('addText (empty)');
            break;
          }
          const align: TextAlign = a.align === 'left' || a.align === 'right' ? a.align : 'center';
          const size = num(a.size, 4, 1000) ?? Math.max(12, Math.round(doc.height * 0.08));
          const fonts = store.fonts;
          const font = typeof a.font === 'string' && (fonts.includes(a.font) || ['Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Verdana', 'sans-serif', 'serif', 'monospace'].includes(a.font)) ? a.font : store.opts.text.font;
          const layer = makeTextLayer({
            text,
            x: (num(a.x, 0, 1) ?? 0.5) * doc.width,
            y: 0,
            size,
            color: hex(a.color) ?? store.fg,
            font,
            weight: Math.round((num(a.weight, 100, 900) ?? 700) / 100) * 100,
            align,
          });
          const lay = layoutText(layer);
          layer.y = (num(a.y, 0, 1) ?? 0.5) * doc.height - lay.height / 2;
          doc = insertLayer(doc, layer, doc.layers.length);
          done.push('text');
          break;
        }
        case 'crop': {
          const aspect = typeof a.aspect === 'string' ? /^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/.exec(a.aspect.trim()) : null;
          let rect: { x: number; y: number; w: number; h: number } | null = null;
          if (aspect) {
            const ratio = Number(aspect[1]) / Number(aspect[2]);
            if (ratio > 0 && Number.isFinite(ratio)) {
              let w = doc.width;
              let h = w / ratio;
              if (h > doc.height) {
                h = doc.height;
                w = h * ratio;
              }
              rect = { x: (doc.width - w) / 2, y: (doc.height - h) / 2, w, h };
            }
          } else {
            const x = num(a.x, 0, 1);
            const y = num(a.y, 0, 1);
            const w = num(a.width, 0.01, 1);
            const h = num(a.height, 0.01, 1);
            if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
              rect = { x: x * doc.width, y: y * doc.height, w: Math.min(w, 1 - x) * doc.width, h: Math.min(h, 1 - y) * doc.height };
            }
          }
          if (rect && rect.w >= 1 && rect.h >= 1) {
            doc = cropDoc(doc, { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) });
            done.push('crop');
          } else skipped.push('crop (invalid)');
          break;
        }
        case 'resize': {
          let w = num(a.width, 1, 16000);
          let h = num(a.height, 1, 16000);
          if (w && !h) h = (w * doc.height) / doc.width;
          if (h && !w) w = (h * doc.width) / doc.height;
          if (w && h && w * h <= 120_000_000) {
            doc = resizeImage(doc, Math.round(w), Math.round(h));
            done.push('resize');
          } else skipped.push('resize (invalid size)');
          break;
        }
        case 'rotate': {
          const deg = num(a.degrees, -360, 360);
          if (!deg) {
            skipped.push('rotate');
            break;
          }
          doc = Number.isInteger(deg / 90) ? rotateDoc90(doc, deg / 90) : rotateDocArbitrary(doc, deg);
          done.push('rotate');
          break;
        }
        case 'flip':
          if (a.axis === 'horizontal' || a.axis === 'vertical') {
            doc = flipDoc(doc, a.axis);
            done.push('flip');
          } else skipped.push('flip (axis)');
          break;
        case 'fill': {
          const color = hex(a.color);
          if (!color) {
            skipped.push('fill (color)');
            break;
          }
          const opacity = num(a.opacity, 0, 1) ?? 1;
          if (a.asNewLayer === true) {
            doc = addEmptyLayer(doc, 'Color Fill');
            doc = fillLayer(doc, doc.activeId!, color, { opacity });
          } else {
            const layer = pixelLayer(doc);
            if (!layer) {
              doc = addEmptyLayer(doc, 'Color Fill');
              doc = fillLayer(doc, doc.activeId!, color, { opacity });
            } else doc = fillLayer(doc, layer.id, color, { opacity });
          }
          done.push('fill');
          break;
        }
        case 'newLayer': {
          const name = stripHtml(typeof a.name === 'string' ? a.name : '').slice(0, 100).trim();
          doc = addEmptyLayer(doc, name || nextLayerName(doc));
          done.push('new layer');
          break;
        }
        case 'autoEnhance': {
          const layer = pixelLayer(doc);
          if (!layer) {
            skipped.push('autoEnhance (no pixel layer)');
            break;
          }
          const h = histogram(readPixels(layer.canvas).data);
          const toned = await pixelOpOnDoc(doc, 'levels', autoToneParams(h, 0.002));
          if (toned) doc = (await pixelOpOnDoc(toned, 'basic', { vibrance: 15 })) ?? toned;
          done.push('auto-enhance');
          break;
        }
        case 'removeBackground': {
          let layer: Layer | undefined = findLayer(doc, doc.activeId);
          if (layer && layer.type !== 'raster') {
            doc = rasterizeLayer(doc, layer.id);
            layer = findLayer(doc, layer.id);
          }
          if (!layer || layer.type !== 'raster') {
            skipped.push('removeBackground (no layer)');
            break;
          }
          const r = await rembgDoc(doc, layer.id);
          if ('doc' in r) {
            doc = r.doc;
            done.push('background removed (AI)');
          } else {
            doc = uniformBackgroundDoc(doc, layer.id);
            done.push('uniform background removed (rembg not available)');
          }
          break;
        }
        default:
          skipped.push(type ? `unknown action "${type.slice(0, 24)}"` : 'invalid action');
      }
    } catch (error) {
      skipped.push(`${type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (doc !== start) {
    if (engine.doc !== start) throw new Error('The image changed while the AI edit was running. Please try again.');
    engine.commit(doc, 'AI Edit');
  }
  const summary = done.length ? t('Applied: {steps}', { steps: done.map((d) => t(d)).join(', ') }) : t('Nothing was changed');
  return skipped.length ? `${summary}. ${t('Skipped: {reasons}', { reasons: skipped.join('; ') })}` : summary;
}
