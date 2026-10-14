import { describe, expect, it } from 'vitest';
import {
  applyGrading,
  bandSegment,
  contrastCurve,
  estimateAtmosphere,
  fitGamut,
  globalTone,
  gradeWeights,
  gradingUniforms,
  hslBandWeights,
  hsvToRgb,
  linearToSrgb,
  luma,
  mulMat3,
  rgbToHsv,
  solveWhiteBalance,
  srgbToLinear,
  vignetteMask,
  wbMatrix,
  type Vec3,
} from './color';
import { buildCurve, buildCurveLut, lutSample, sampleCurve } from './curve';
import { defaultSettings, mergeSettings } from './params';
import { finalUniforms, passParams, processPixel, tilePadding } from './pipeline';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('transfer functions', () => {
  it('round-trips sRGB', () => {
    for (let i = 0; i <= 20; i++) close(linearToSrgb(srgbToLinear(i / 20)), i / 20, 1e-9);
  });
});

describe('white balance', () => {
  it('is the identity at 0/0', () => {
    expect(wbMatrix(0, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it('warms with positive temp and keeps neutral luminance', () => {
    const warm = mulMat3(wbMatrix(50, 0), [1, 1, 1]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    close(luma(warm), 1, 1e-6);
    const cool = mulMat3(wbMatrix(-50, 0), [1, 1, 1]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });
  it('adds magenta with positive tint', () => {
    const m = mulMat3(wbMatrix(0, 60), [1, 1, 1]);
    expect(m[1]).toBeLessThan(m[0]);
    expect(m[1]).toBeLessThan(m[2]);
  });
  it('solves a color cast back to neutral', () => {
    // a neutral seen under a warm light
    const cast = mulMat3(wbMatrix(40, -20), [0.3, 0.3, 0.3]);
    const wb = solveWhiteBalance(cast);
    const fixed = mulMat3(wbMatrix(wb.temp, wb.tint), cast);
    const s = fixed[0] + fixed[1] + fixed[2];
    for (const c of fixed) close(c / s, 1 / 3, 0.01);
  });
});

describe('tone', () => {
  it('contrast curve is monotonic, fixes the pivot and is identity at 0', () => {
    for (const c of [-1, -0.5, 0.5, 1]) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const v = contrastCurve(i / 100, c);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      close(contrastCurve(0.46, c), 0.46, 1e-9);
    }
    expect(contrastCurve(0.3, 0)).toBe(0.3);
  });
  it('global tone stays monotonic for extreme whites/blacks', () => {
    for (const [w, b] of [
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      let prev = -Infinity;
      for (let i = 0; i <= 200; i++) {
        const v = globalTone(i / 200, 0.5, w, b);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    }
  });
  it('fitGamut keeps in-range colors and maps out-of-range ones into 0..1 keeping luminance', () => {
    expect(fitGamut([0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
    const c: Vec3 = [1.4, 0.5, 0.2];
    const f = fitGamut(c);
    for (const v of f) expect(v).toBeLessThanOrEqual(1);
    close(luma(f), luma(c), 1e-6);
  });
});

describe('HSL bands', () => {
  it('weights sum to 1 and peak at the band centers', () => {
    for (let h = 0; h < 360; h += 7) close(hslBandWeights(h).reduce((a, b) => a + b, 0), 1);
    expect(hslBandWeights(0)[0]).toBe(1);
    expect(hslBandWeights(240)[5]).toBeCloseTo(1, 9);
    const mid = hslBandWeights(15);
    close(mid[0], 0.5, 1e-9);
    close(mid[1], 0.5, 1e-9);
  });
  it('wraps around 360', () => {
    const seg = bandSegment(330);
    expect(seg.i).toBe(7);
    expect(seg.j).toBe(0);
  });
  it('hsv round trip', () => {
    for (const c of [
      [0.9, 0.2, 0.1],
      [0.1, 0.7, 0.3],
      [0.2, 0.3, 0.95],
    ] as Vec3[]) {
      const [h, s, v] = rgbToHsv(c);
      hsvToRgb(h, s, v).forEach((x, i) => close(x, c[i], 1e-9));
    }
  });
});

describe('color grading', () => {
  it('weights partition the range and follow balance', () => {
    const [s, m, h] = gradeWeights(0.5, 2.5, 1);
    close(s + m + h, 1);
    expect(gradeWeights(0, 2.5, 1)[0]).toBe(1);
    expect(gradeWeights(1, 2.5, 1)[2]).toBe(1);
    expect(gradeWeights(0.5, 2.5, 0.5)[2]).toBeGreaterThan(h);
  });
  it('is a no-op without saturation/luminance', () => {
    const g = gradingUniforms(defaultSettings());
    expect(g.active).toBe(false);
    expect(applyGrading([0.3, 0.5, 0.7], g)).toEqual([0.3, 0.5, 0.7]);
  });
  it('tints shadows towards the chosen hue', () => {
    const g = gradingUniforms(mergeSettings(defaultSettings(), { gradeShadowHue: 220, gradeShadowSat: 60 }));
    const out = applyGrading([0.1, 0.1, 0.1], g);
    expect(out[2]).toBeGreaterThan(out[0]);
  });
});

describe('vignette', () => {
  it('is 0 in the center and 1 in the corners', () => {
    expect(vignetteMask(0.5, 0.5, 1.5, 0.5, 0, 0.5)).toBe(0);
    expect(vignetteMask(0, 0, 1.5, 0.5, 0, 0.5)).toBe(1);
  });
});

describe('curves', () => {
  it('identity points give an identity curve', () => {
    const lut = sampleCurve(
      [
        [0, 0],
        [1, 1],
      ],
      11,
    );
    lut.forEach((v, i) => close(v, i / 10, 1e-6));
  });
  it('monotone data stays monotone (no overshoot)', () => {
    const fn = buildCurve([
      [0, 0],
      [0.25, 0.1],
      [0.3, 0.8],
      [1, 1],
    ]);
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const v = fn(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v).toBeLessThanOrEqual(1 + 1e-12);
      prev = v;
    }
  });
  it('passes through the control points and holds the ends flat', () => {
    const fn = buildCurve([
      [0.1, 0.2],
      [0.5, 0.7],
      [0.9, 0.85],
    ]);
    close(fn(0.5), 0.7, 1e-9);
    expect(fn(0)).toBe(0.2);
    expect(fn(1)).toBe(0.85);
  });
  it('LUT sampling interpolates', () => {
    const s = mergeSettings(defaultSettings(), { curveRgb: [[0, 0.5], [1, 0.5]] });
    const lut = buildCurveLut(s);
    close(lutSample(lut, 3, 0.37), 0.5, 1e-6);
    close(lutSample(lut, 0, 0.37), 0.37, 1e-3);
  });
});

describe('processPixel (CPU twin of the shader)', () => {
  it('leaves pixels untouched with default settings', () => {
    const u = finalUniforms(defaultSettings());
    for (const c of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.5, 0.8],
      [0.9, 0.1, 0.4],
    ] as Vec3[]) {
      processPixel(c, u).forEach((v, i) => close(v, c[i], 1e-6));
    }
  });
  it('exposure brightens, black & white desaturates', () => {
    const c: Vec3 = [0.3, 0.4, 0.5];
    const brighter = processPixel(c, finalUniforms(mergeSettings(defaultSettings(), { exposure: 1 })));
    expect(luma(brighter)).toBeGreaterThan(luma(c));
    const bw = processPixel([0.8, 0.2, 0.1], finalUniforms(mergeSettings(defaultSettings(), { treatment: 'bw' })));
    close(bw[0], bw[1], 1e-9);
    close(bw[1], bw[2], 1e-9);
  });
  it('saturation -100 removes color', () => {
    const out = processPixel([0.8, 0.3, 0.2], finalUniforms(mergeSettings(defaultSettings(), { saturation: -100 })));
    close(out[0], out[2], 1e-6);
  });
});

describe('pass parameters', () => {
  it('scale with the working resolution and need padding for tiles', () => {
    const s = mergeSettings(defaultSettings(), { clarity: 40, sharpenAmount: 60, nrColor: 30 });
    const full = passParams(s, 1, 6000);
    const preview = passParams(s, 2048 / 6000, 6000);
    expect(preview.claritySigma).toBeCloseTo(full.claritySigma * (2048 / 6000), 6);
    expect(full.sharpenSigma).toBe(1);
    expect(tilePadding(s, 6000)).toBeGreaterThan(3 * full.claritySigma);
    const none = passParams(defaultSettings(), 1, 6000);
    expect(none.claritySigma + none.textureSigma + none.sharpenSigma + none.nrLumaSigma + none.nrChromaSigma).toBe(0);
  });
});

describe('airlight', () => {
  it('averages the brightest dark-channel pixels', () => {
    const px = new Uint8Array(100 * 4);
    for (let i = 0; i < 100; i++) px.set(i === 7 ? [240, 245, 250, 255] : [20, 30, 40, 255], i * 4);
    const a = estimateAtmosphere(px, 10, 10);
    expect(a[2]).toBeGreaterThan(0.8);
  });
});
