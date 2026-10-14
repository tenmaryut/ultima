/**
 * Turns develop settings into the parameters of the GPU passes, plus a CPU reference
 * implementation of the final per-pixel pass (`processPixel`) that mirrors the GLSL
 * `final` shader step by step. Pure (no DOM): unit tested.
 */
import type { DevelopSettings } from './params';
import {
  applyGrading,
  applyHsl,
  applyLuminance,
  applyVignette,
  dehazePixel,
  detailBoost,
  fitGamut,
  fromPerceptual,
  globalTone,
  gradingUniforms,
  hslUniforms,
  linearToSrgb,
  localToneStops,
  luma,
  mix,
  mulMat3,
  srgbToLinear,
  toPerceptual,
  vibranceSaturation,
  vignetteMask,
  wbMatrix,
  type GradingUniforms,
  type HslUniforms,
  type Mat3,
  type Vec3,
} from './color';
import { buildCurveLut, curvesActive, lutSample } from './curve';

/** Large-radius blur (clarity, dehaze, local tone) as a fraction of the image's long edge. */
export const CLARITY_SIGMA = 0.012;
/** Medium-detail blur (texture) as a fraction of the image's long edge. */
export const TEXTURE_SIGMA = 0.0012;

export interface FinalUniforms {
  wb: Mat3;
  exposureGain: number;
  dehaze: number;
  atmos: Vec3;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  clarity: number;
  texture: number;
  vibrance: number;
  saturation: number;
  bw: boolean;
  hsl: HslUniforms;
  grading: GradingUniforms;
  curveActive: boolean;
  lut: Float32Array;
  vignette: { amount: number; midpoint: number; roundness: number; feather: number };
  grain: { amount: number; size: number; roughness: number };
}

export function finalUniforms(s: DevelopSettings, atmos: Vec3 = [1, 1, 1]): FinalUniforms {
  return {
    wb: wbMatrix(s.temp, s.tint),
    exposureGain: Math.pow(2, s.exposure),
    dehaze: s.dehaze / 100,
    atmos,
    contrast: s.contrast / 100,
    highlights: s.highlights / 100,
    shadows: s.shadows / 100,
    whites: s.whites / 100,
    blacks: s.blacks / 100,
    clarity: s.clarity / 100,
    texture: s.texture / 100,
    vibrance: s.vibrance / 100,
    saturation: s.saturation / 100,
    bw: s.treatment === 'bw',
    hsl: hslUniforms(s),
    grading: gradingUniforms(s),
    curveActive: curvesActive(s),
    lut: buildCurveLut(s),
    vignette: {
      amount: s.vignetteAmount / 100,
      midpoint: s.vignetteMidpoint / 100,
      roundness: s.vignetteRoundness / 100,
      feather: s.vignetteFeather / 100,
    },
    grain: { amount: s.grainAmount / 100, size: s.grainSize / 100, roughness: s.grainRoughness / 100 },
  };
}

/** Neighborhood inputs of the final pass (blurred textures sampled at the pixel). */
export interface LocalInputs {
  /** Encoded luminance of the (denoised/sharpened) source pixel. */
  lumEnc: number;
  /** Large-radius blurred encoded luminance. */
  clarityBlurEnc: number;
  /** Medium-radius blurred encoded luminance. */
  textureBlurEnc: number;
  /** Large-radius blurred dark channel (encoded). */
  darkBlurEnc: number;
  /** Normalized output position (0..1) and output aspect (w/h) for the vignette. */
  nx: number;
  ny: number;
  aspect: number;
}

/** CPU twin of the GLSL final pass (minus grain, clipping overlay and dithering). */
export function processPixel(srcEnc: Vec3, u: FinalUniforms, local: Partial<LocalInputs> = {}): Vec3 {
  const lumEnc = local.lumEnc ?? luma(srcEnc);
  const clarityBlur = local.clarityBlurEnc ?? lumEnc;
  const textureBlur = local.textureBlurEnc ?? lumEnc;
  const darkBlur = local.darkBlurEnc ?? Math.min(srcEnc[0], srcEnc[1], srcEnc[2]);

  let lin: Vec3 = [srgbToLinear(srcEnc[0]), srgbToLinear(srcEnc[1]), srgbToLinear(srcEnc[2])];
  if (u.dehaze !== 0) lin = dehazePixel(lin, srgbToLinear(darkBlur), u.dehaze, u.atmos);
  lin = mulMat3(u.wb, lin);
  lin = [lin[0] * u.exposureGain, lin[1] * u.exposureGain, lin[2] * u.exposureGain];

  if (u.shadows !== 0 || u.highlights !== 0) {
    const y = luma(lin);
    const yb = srgbToLinear(clarityBlur) * u.exposureGain;
    const stops = localToneStops(toPerceptual(mix(y, yb, 0.6)), u.shadows, u.highlights);
    const g = Math.pow(2, stops);
    lin = [lin[0] * g, lin[1] * g, lin[2] * g];
  }

  const y = luma(lin);
  const p = toPerceptual(y);
  const p2 = detailBoost(globalTone(p, u.contrast, u.whites, u.blacks), lumEnc - clarityBlur, lumEnc - textureBlur, u.clarity, u.texture);
  if (p2 !== p) lin = applyLuminance(lin, y, fromPerceptual(p2));
  lin = fitGamut(lin);

  let enc: Vec3 = [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
  if (u.curveActive) {
    enc = [
      lutSample(u.lut, 0, lutSample(u.lut, 3, enc[0])),
      lutSample(u.lut, 1, lutSample(u.lut, 3, enc[1])),
      lutSample(u.lut, 2, lutSample(u.lut, 3, enc[2])),
    ];
  }
  enc = applyHsl(enc, u.hsl, u.bw);
  if (!u.bw) enc = vibranceSaturation(enc, u.vibrance, u.saturation);
  enc = applyGrading(enc, u.grading);
  if (u.vignette.amount !== 0) {
    const m = vignetteMask(local.nx ?? 0.5, local.ny ?? 0.5, local.aspect ?? 1.5, u.vignette.midpoint, u.vignette.roundness, u.vignette.feather);
    enc = applyVignette(enc, m, u.vignette.amount);
  }
  return [Math.min(1, Math.max(0, enc[0])), Math.min(1, Math.max(0, enc[1])), Math.min(1, Math.max(0, enc[2]))];
}

/* ------------------------------- Source passes ------------------------------ */

export interface PassParams {
  /** Luminance noise reduction: spatial sigma (texture px), range sigma, blend amount. */
  nrLumaSigma: number;
  nrRangeSigma: number;
  nrLumaAmount: number;
  /** Color noise reduction: spatial sigma (texture px), blend amount. */
  nrChromaSigma: number;
  nrChromaAmount: number;
  /** Unsharp mask on luminance. */
  sharpenSigma: number;
  sharpenAmount: number;
  sharpenDetail: number;
  sharpenMasking: number;
  /** Medium detail blur (texture). 0 = pass not needed. */
  textureSigma: number;
  /** Large blur (clarity/dehaze/local tone) in texture px. 0 = pass not needed. */
  claritySigma: number;
  /** Downsampling factor of the large blur. */
  lowFactor: number;
}

/**
 * Pass parameters for a working texture at `srcScale` texture px per full-resolution px.
 * Sharpening/NR radii are absolute (full-res px); clarity/texture radii are relative to
 * the image so the look matches between preview and export.
 */
export function passParams(s: DevelopSettings, srcScale: number, fullLongEdge: number): PassParams {
  const nrA = s.nrLuminance / 100;
  const nrC = s.nrColor / 100;
  const nrLumaSigma = nrA > 0 ? (0.8 + 2.2 * nrA) * srcScale : 0;
  const nrChromaSigma = nrC > 0 ? (1 + 7 * nrC) * srcScale : 0;
  const sharpenSigma = s.sharpenAmount > 0 ? s.sharpenRadius * srcScale : 0;
  const needLow = s.clarity !== 0 || s.dehaze !== 0 || s.highlights !== 0 || s.shadows !== 0;
  const claritySigma = needLow ? Math.max(0.75, CLARITY_SIGMA * fullLongEdge * srcScale) : 0;
  return {
    nrLumaSigma: nrLumaSigma >= 0.25 ? nrLumaSigma : 0,
    nrRangeSigma: mix(0.012, 0.1, nrA) * mix(1.3, 0.6, s.nrDetail / 100),
    nrLumaAmount: Math.min(1, nrA * 1.6),
    nrChromaSigma: nrChromaSigma >= 0.25 ? nrChromaSigma : 0,
    nrChromaAmount: Math.min(1, nrC * 2),
    sharpenSigma: sharpenSigma >= 0.3 ? sharpenSigma : 0,
    sharpenAmount: (s.sharpenAmount / 100) * 1.5,
    sharpenDetail: s.sharpenDetail / 100,
    sharpenMasking: s.sharpenMasking / 100,
    textureSigma: s.texture !== 0 ? Math.max(0.6, TEXTURE_SIGMA * fullLongEdge * srcScale) : 0,
    claritySigma,
    lowFactor: claritySigma ? Math.max(1, Math.floor(claritySigma / 4)) : 1,
  };
}

/** Context (in full-resolution px) a tile needs around it so blurs match the full image. */
export function tilePadding(s: DevelopSettings, fullLongEdge: number): number {
  const pp = passParams(s, 1, fullLongEdge);
  return Math.ceil(3 * (pp.claritySigma + pp.lowFactor) + 3 * pp.textureSigma + 3 * Math.max(pp.nrLumaSigma, pp.nrChromaSigma) + 3 * pp.sharpenSigma + 4);
}

/** Cache key for the source passes (they only depend on these settings). */
export function sourcePassKey(pp: PassParams): string {
  return [
    pp.nrLumaSigma,
    pp.nrRangeSigma,
    pp.nrLumaAmount,
    pp.nrChromaSigma,
    pp.nrChromaAmount,
    pp.sharpenSigma,
    pp.sharpenAmount,
    pp.sharpenDetail,
    pp.sharpenMasking,
    pp.textureSigma,
    pp.claritySigma,
  ]
    .map((v) => v.toFixed(4))
    .join('|');
}
