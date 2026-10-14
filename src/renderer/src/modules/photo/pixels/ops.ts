/**
 * Dispatcher for all pixel operations (adjustments + filters) by id, shared by the Web
 * Worker and the main-thread fallback. Pure: no DOM.
 */
import {
  basicAdjust,
  blackWhite,
  brightnessContrast,
  colorBalance,
  curves,
  desaturate,
  exposure,
  hueSaturation,
  invert,
  levels,
  photoFilter,
  posterize,
  sepia,
  threshold,
  vibrance,
  type BasicAdjustParams,
  type BlackWhiteParams,
  type BrightnessContrastParams,
  type ColorBalanceParams,
  type CurvesParams,
  type ExposureParams,
  type HueSatParams,
  type LevelsParams,
  type PhotoFilterParams,
  type VibranceParams,
} from './adjust';
import { addNoise, emboss, findEdges, gaussianBlur, grain, highPass, median, motionBlur, oilPaint, pixelate, sharpen, unsharpMask, vignette } from './filters';

export type AdjustmentOp =
  | 'brightnessContrast'
  | 'levels'
  | 'curves'
  | 'hueSaturation'
  | 'colorBalance'
  | 'vibrance'
  | 'exposure'
  | 'blackWhite'
  | 'photoFilter'
  | 'invert'
  | 'threshold'
  | 'posterize'
  | 'desaturate'
  | 'sepia'
  | 'basic';

export type FilterOp =
  | 'gaussianBlur'
  | 'motionBlur'
  | 'sharpen'
  | 'unsharpMask'
  | 'highPass'
  | 'addNoise'
  | 'median'
  | 'pixelate'
  | 'emboss'
  | 'findEdges'
  | 'vignette'
  | 'grain'
  | 'oilPaint';

export type PixelOp = AdjustmentOp | FilterOp;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function runPixelOp(op: PixelOp, data: Uint8ClampedArray, w: number, h: number, params: any): Uint8ClampedArray {
  const p = params ?? {};
  switch (op) {
    case 'brightnessContrast':
      brightnessContrast(data, p as BrightnessContrastParams);
      return data;
    case 'levels':
      levels(data, p as LevelsParams);
      return data;
    case 'curves':
      curves(data, p as CurvesParams);
      return data;
    case 'hueSaturation':
      hueSaturation(data, p as HueSatParams);
      return data;
    case 'colorBalance':
      colorBalance(data, p as ColorBalanceParams);
      return data;
    case 'vibrance':
      vibrance(data, p as VibranceParams);
      return data;
    case 'exposure':
      exposure(data, p as ExposureParams);
      return data;
    case 'blackWhite':
      blackWhite(data, p as BlackWhiteParams);
      return data;
    case 'photoFilter':
      photoFilter(data, p as PhotoFilterParams);
      return data;
    case 'invert':
      invert(data);
      return data;
    case 'threshold':
      threshold(data, Number(p.level ?? 128));
      return data;
    case 'posterize':
      posterize(data, Number(p.levels ?? 4));
      return data;
    case 'desaturate':
      desaturate(data);
      return data;
    case 'sepia':
      sepia(data, Number(p.amount ?? 1));
      return data;
    case 'basic':
      basicAdjust(data, p as BasicAdjustParams);
      return data;
    case 'gaussianBlur':
      return gaussianBlur(data, w, h, p);
    case 'motionBlur':
      return motionBlur(data, w, h, p);
    case 'sharpen':
      return sharpen(data, w, h);
    case 'unsharpMask':
      return unsharpMask(data, w, h, p);
    case 'highPass':
      return highPass(data, w, h, p);
    case 'addNoise':
      return addNoise(data, w, h, p);
    case 'median':
      return median(data, w, h, p);
    case 'pixelate':
      return pixelate(data, w, h, p);
    case 'emboss':
      return emboss(data, w, h, p);
    case 'findEdges':
      return findEdges(data, w, h);
    case 'vignette':
      return vignette(data, w, h, p);
    case 'grain':
      return grain(data, w, h, p);
    case 'oilPaint':
      return oilPaint(data, w, h, p);
    default:
      throw new Error(`Unknown operation ${String(op)}`);
  }
}
