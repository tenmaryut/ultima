/**
 * Applying adjustments and filters to the active layer (or its mask) inside the selection,
 * with the heavy pixel math in a Web Worker.
 */
import { toast } from '../../components/ui';
import { t } from '../../core/i18n';
import { ctx2d, makeCanvas, readPixels } from './canvas';
import { findLayer } from './doc';
import { withPixels } from './docops';
import type { PhotoEngine } from './engine';
import type { LevelsParams } from './pixels/adjust';
import { autoColorParams, autoContrastParams, autoToneParams, histogram } from './pixels/tone';
import { alphaToGray, blendBySelection, grayToAlpha } from './pixels/filters';
import type { PixelOp } from './pixels/ops';
import { PreviewRunner, runPixelOpAsync } from './pixels/workerClient';
import type { Layer, Selection } from './types';

export interface PixelTarget {
  layerId: string;
  onMask: boolean;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Source pixels (masks converted to gray). */
  data: Uint8ClampedArray;
  selection: Selection | null;
}

/** Resolves the layer/mask the pixel operation applies to (asks to rasterize text/shape layers). */
export async function pixelTarget(engine: PhotoEngine): Promise<PixelTarget | null> {
  let layer: Layer | null = engine.activeLayer();
  if (!engine.canEdit(layer)) return null;
  const onMask = engine.store.maskEdit && Boolean(layer.mask);
  if (!onMask && layer.type !== 'raster') {
    layer = await engine.ensureRaster(layer.id);
    if (!layer) return null;
  }
  const doc = engine.doc!;
  const canvas = onMask ? layer.mask!.canvas : (layer as Extract<Layer, { type: 'raster' }>).canvas;
  const x = onMask ? layer.mask!.x : layer.x;
  const y = onMask ? layer.mask!.y : layer.y;
  const data = readPixels(canvas).data;
  if (onMask) alphaToGray(data);
  return { layerId: layer.id, onMask, canvas, x, y, w: canvas.width, h: canvas.height, data, selection: doc.selection };
}

/** Final pixels: processed output mixed into the source through the selection (masks back to alpha). */
export function finishPixels(target: PixelTarget, processed: Uint8ClampedArray): Uint8ClampedArray {
  const out = target.selection ? blendBySelection(target.data.slice(), processed, target.w, target.h, target.x, target.y, target.selection) : processed;
  if (target.onMask) grayToAlpha(out);
  return out;
}

export function commitPixels(engine: PhotoEngine, target: PixelTarget, pixels: Uint8ClampedArray, label: string): void {
  const doc = engine.doc;
  if (!doc) return;
  const layer = findLayer(doc, target.layerId);
  const current = layer ? (target.onMask ? layer.mask?.canvas : layer.type === 'raster' ? layer.canvas : null) : null;
  if (current !== target.canvas) {
    toast.warning(t('The layer changed while processing'), t('Please try again.'));
    return;
  }
  engine.setContentOverride(target.layerId, null);
  engine.setMaskOverride(target.layerId, null);
  engine.commit(withPixels(doc, target.layerId, pixels, target.w, target.h, target.onMask), label);
}

/** Applies an operation right away (no dialog). */
export async function applyPixelOp(engine: PhotoEngine, op: PixelOp, params: unknown, label: string): Promise<void> {
  const target = await pixelTarget(engine);
  if (!target) return;
  try {
    const processed = await runPixelOpAsync(op, target.data.slice(), target.w, target.h, params);
    commitPixels(engine, target, finishPixels(target, processed), label);
  } catch (error) {
    engine.reportError(error);
  }
}

export async function autoAdjust(engine: PhotoEngine, kind: 'tone' | 'contrast' | 'color'): Promise<void> {
  const target = await pixelTarget(engine);
  if (!target) return;
  const h = histogram(target.data);
  if (!h.count) {
    toast.info(t('The layer is empty'));
    return;
  }
  const params: LevelsParams = kind === 'tone' ? autoToneParams(h, 0.001) : kind === 'contrast' ? autoContrastParams(h, 0.001) : autoColorParams(h, 0.001);
  try {
    const processed = await runPixelOpAsync('levels', target.data.slice(), target.w, target.h, params);
    commitPixels(engine, target, finishPixels(target, processed), kind === 'tone' ? 'Auto Tone' : kind === 'contrast' ? 'Auto Contrast' : 'Auto Color');
  } catch (error) {
    engine.reportError(error);
  }
}

/**
 * Live preview session for adjustment/filter dialogs: recomputes in the worker (latest wins)
 * and shows the result through a render override.
 */
export class LivePreview {
  private runner = new PreviewRunner();
  private canvas: HTMLCanvasElement;
  private last: { key: string; pixels: Uint8ClampedArray } | null = null;
  enabled = true;

  constructor(
    private engine: PhotoEngine,
    readonly target: PixelTarget,
    private op: PixelOp,
    onBusy?: (busy: boolean) => void,
  ) {
    this.canvas = makeCanvas(target.w, target.h);
    this.runner.onBusy = onBusy;
  }

  update(params: unknown): void {
    const key = JSON.stringify(params);
    if (!this.enabled) {
      this.hide();
      return;
    }
    this.runner.request(
      () => runPixelOpAsync(this.op, this.target.data.slice(), this.target.w, this.target.h, params),
      (out) => {
        const pixels = finishPixels(this.target, out);
        this.last = { key, pixels };
        if (!this.enabled) return;
        const img = new ImageData(pixels.slice(), this.target.w, this.target.h);
        ctx2d(this.canvas).putImageData(img, 0, 0);
        const r = { canvas: this.canvas, x: this.target.x, y: this.target.y };
        if (this.target.onMask) this.engine.setMaskOverride(this.target.layerId, r);
        else this.engine.setContentOverride(this.target.layerId, r);
        this.engine.requestRender();
      },
      (error) => this.engine.reportError(error),
    );
  }

  hide(): void {
    this.runner.cancel();
    this.engine.setContentOverride(this.target.layerId, null);
    this.engine.setMaskOverride(this.target.layerId, null);
    this.engine.requestRender();
  }

  async apply(params: unknown, label: string): Promise<void> {
    const key = JSON.stringify(params);
    this.runner.cancel();
    let pixels = this.last?.key === key ? this.last.pixels : null;
    if (!pixels) {
      try {
        pixels = finishPixels(this.target, await runPixelOpAsync(this.op, this.target.data.slice(), this.target.w, this.target.h, params));
      } catch (error) {
        this.hide();
        this.engine.reportError(error);
        return;
      }
    }
    commitPixels(this.engine, this.target, pixels, label);
    this.engine.requestRender();
  }

  cancel(): void {
    this.hide();
  }
}
