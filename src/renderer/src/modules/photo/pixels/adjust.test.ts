import { describe, expect, it } from 'vitest';
import {
  basicAdjust,
  blackWhiteGray,
  brightnessContrastLut,
  colorBalance,
  curveLut,
  DEFAULT_BLACK_WHITE,
  defaultLevels,
  exposureLut,
  hslToRgb,
  hueSaturation,
  invert,
  levels,
  levelsLut,
  photoFilter,
  posterizeLut,
  rgbToHsl,
  threshold,
  vibrance,
} from './adjust';
import { autoColorParams, autoContrastParams, autoToneParams, clipPoints, histogram } from './tone';

function px(...values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

describe('LUT adjustments', () => {
  it('brightness/contrast neutral is identity and monotone', () => {
    const lut = brightnessContrastLut({ brightness: 0, contrast: 0 });
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    const up = brightnessContrastLut({ brightness: 60, contrast: 0 });
    expect(up[128]).toBeGreaterThan(160);
    expect(up[255]).toBe(255);
    for (let i = 1; i < 256; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]);
    const contrast = brightnessContrastLut({ brightness: 0, contrast: 50 });
    expect(contrast[64]).toBeLessThan(64);
    expect(contrast[192]).toBeGreaterThan(192);
  });
  it('levels maps input range and gamma', () => {
    const lut = levelsLut({ inBlack: 50, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 });
    expect(lut[50]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[125]).toBe(128);
    const g = levelsLut({ inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 });
    expect(g[64]).toBeGreaterThan(110);
    const out = levelsLut({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 20, outWhite: 220 });
    expect(out[0]).toBe(20);
    expect(out[255]).toBe(220);
  });
  it('per channel levels apply before the composite', () => {
    const p = defaultLevels();
    p.r = { inBlack: 0, inWhite: 128, gamma: 1, outBlack: 0, outWhite: 255 };
    const d = px(64, 64, 64, 255);
    levels(d, p);
    expect(d[0]).toBe(128);
    expect(d[1]).toBe(64);
  });
  it('curves pass through points and stay monotone', () => {
    const lut = curveLut([
      [0, 0],
      [64, 100],
      [255, 255],
    ]);
    expect(lut[0]).toBe(0);
    expect(lut[64]).toBe(100);
    expect(lut[255]).toBe(255);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    const inverted = curveLut([
      [0, 255],
      [255, 0],
    ]);
    expect(inverted[0]).toBe(255);
    expect(inverted[255]).toBe(0);
    expect(inverted[128]).toBe(127);
  });
  it('exposure +1 stop doubles linear light', () => {
    const lut = exposureLut({ exposure: 1, offset: 0, gamma: 1 });
    expect(lut[0]).toBe(0);
    expect(lut[118]).toBeGreaterThan(155);
    expect(lut[118]).toBeLessThan(165);
    expect(lut[255]).toBe(255);
  });
  it('posterize to 2 levels gives black/white', () => {
    const lut = posterizeLut(2);
    expect(lut[100]).toBe(0);
    expect(lut[200]).toBe(255);
  });
});

describe('color adjustments', () => {
  it('hsl round trips', () => {
    const hsl = rgbToHsl(0.2, 0.6, 0.4, [0, 0, 0]);
    const rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
    expect(rgb[0]).toBeCloseTo(0.2, 5);
    expect(rgb[1]).toBeCloseTo(0.6, 5);
    expect(rgb[2]).toBeCloseTo(0.4, 5);
  });
  it('hue shift of 120 turns red into green', () => {
    const d = px(255, 0, 0, 255);
    hueSaturation(d, { hue: 120, saturation: 0, lightness: 0, colorize: false });
    expect([d[0], d[1], d[2]]).toEqual([0, 255, 0]);
  });
  it('saturation -100 makes gray, lightness +100 makes white', () => {
    const d = px(200, 50, 50, 255);
    hueSaturation(d, { hue: 0, saturation: -100, lightness: 0, colorize: false });
    expect(d[0]).toBe(d[1]);
    const e = px(10, 50, 90, 255);
    hueSaturation(e, { hue: 0, saturation: 0, lightness: 100, colorize: false });
    expect([e[0], e[1], e[2]]).toEqual([255, 255, 255]);
  });
  it('colorize uses the given hue', () => {
    const d = px(128, 128, 128, 255);
    hueSaturation(d, { hue: 240, saturation: 50, lightness: 0, colorize: true });
    expect(d[2]).toBeGreaterThan(d[0]);
  });
  it('invert, threshold and alpha preservation', () => {
    const d = px(0, 100, 255, 77);
    invert(d);
    expect([d[0], d[1], d[2], d[3]]).toEqual([255, 155, 0, 77]);
    const t = px(200, 200, 200, 255, 20, 20, 20, 255);
    threshold(t, 128);
    expect(t[0]).toBe(255);
    expect(t[4]).toBe(0);
  });
  it('black & white uses the Photoshop mixer weights', () => {
    expect(Math.round(blackWhiteGray(255, 0, 0, DEFAULT_BLACK_WHITE))).toBe(102);
    expect(Math.round(blackWhiteGray(255, 255, 0, DEFAULT_BLACK_WHITE))).toBe(153);
    expect(blackWhiteGray(200, 200, 200, DEFAULT_BLACK_WHITE)).toBe(200);
  });
  it('color balance shifts midtones towards red', () => {
    const d = px(128, 128, 128, 255);
    colorBalance(d, { shadows: [0, 0, 0], midtones: [60, 0, 0], highlights: [0, 0, 0], preserveLuminosity: false });
    expect(d[0]).toBeGreaterThan(150);
    expect(d[1]).toBe(128);
  });
  it('vibrance boosts muted colors more than saturated ones', () => {
    const muted = px(140, 120, 120, 255);
    const vivid = px(250, 20, 20, 255);
    vibrance(muted, { vibrance: 80, saturation: 0 });
    vibrance(vivid, { vibrance: 80, saturation: 0 });
    expect(muted[0] - muted[1]).toBeGreaterThan(20 * 1.5);
    expect(vivid[0]).toBe(255);
  });
  it('photo filter warms and keeps luminosity', () => {
    const d = px(128, 128, 128, 255);
    photoFilter(d, { color: '#ec8a00', density: 50, preserveLuminosity: true });
    expect(d[0]).toBeGreaterThan(d[2]);
    const l = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
    expect(Math.abs(l - 128)).toBeLessThan(4);
  });
  it('basic adjust does nothing with zeros and warms with temperature', () => {
    const d = px(100, 120, 140, 255);
    basicAdjust(d, {});
    expect([d[0], d[1], d[2]]).toEqual([100, 120, 140]);
    basicAdjust(d, { temperature: 50 });
    expect(d[0]).toBeGreaterThan(100);
    expect(d[2]).toBeLessThan(140);
  });
});

describe('histogram & auto', () => {
  const data = new Uint8ClampedArray(4 * 100);
  for (let i = 0; i < 100; i++) {
    data[i * 4] = 50 + i; // r 50..149
    data[i * 4 + 1] = 80 + i / 2; // g 80..129
    data[i * 4 + 2] = 60 + i; // b
    data[i * 4 + 3] = 255;
  }
  const h = histogram(data);
  it('counts visible pixels', () => {
    expect(h.count).toBe(100);
    expect(clipPoints(h.r, h.count, 0)).toEqual([50, 149]);
  });
  it('auto tone stretches each channel', () => {
    const p = autoToneParams(h, 0);
    expect(p.r.inBlack).toBe(50);
    expect(p.r.inWhite).toBe(149);
    expect(p.g.inBlack).toBe(80);
  });
  it('auto contrast uses one range for all channels', () => {
    const p = autoContrastParams(h, 0);
    expect(p.rgb.inBlack).toBe(50);
    expect(p.rgb.inWhite).toBe(159);
  });
  it('auto color neutralizes the means with gamma', () => {
    const p = autoColorParams(h, 0);
    expect(p.r.gamma).toBeGreaterThan(0.59);
    expect(p.r.gamma).toBeLessThan(1.61);
  });
});

describe('tone brushes', () => {
  it('dodge lightens midtones more than shadows', async () => {
    const { toneBrush } = await import('./tone');
    const mid = new Uint8ClampedArray([128, 128, 128, 255]);
    const dark = new Uint8ClampedArray([10, 10, 10, 255]);
    toneBrush(mid, 'dodge', 'midtones', 1);
    toneBrush(dark, 'dodge', 'midtones', 1);
    expect(mid[0] - 128).toBeGreaterThan(dark[0] - 10);
    const burn = new Uint8ClampedArray([200, 200, 200, 255]);
    toneBrush(burn, 'burn', 'highlights', 1);
    expect(burn[0]).toBeLessThan(120);
    const sp = new Uint8ClampedArray([200, 100, 100, 255]);
    toneBrush(sp, 'sponge', 'midtones', 1, 'desaturate');
    expect(sp[0] - sp[1]).toBeLessThan(40);
  });
});
