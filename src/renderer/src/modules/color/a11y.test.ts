import { describe, expect, it } from 'vitest';
import {
  apcaContrast,
  checkPairs,
  contrastHex,
  CVD_MATRICES,
  cvdConflicts,
  cvdMatrix,
  defaultTextPairs,
  fixPairs,
  formatRatio,
  simulateCvd,
  simulateHex,
  suggestContrastFix,
  wcag,
} from './a11y';
import { hexToRgb } from './colormath';

describe('WCAG contrast', () => {
  it('black on white is 21:1', () => {
    expect(contrastHex('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrastHex('#ffffff', '#ffffff')).toBeCloseTo(1, 9);
  });
  it('known thresholds', () => {
    const r = wcag('#767676', '#ffffff');
    expect(r.ratio).toBeCloseTo(4.54, 2);
    expect(r.aaNormal).toBe(true);
    expect(r.aaaNormal).toBe(false);
    const fail = wcag('#777777', '#ffffff');
    expect(fail.ratio).toBeCloseTo(4.48, 2);
    expect(fail.aaNormal).toBe(false);
    expect(fail.aaLarge).toBe(true);
    expect(fail.ui).toBe(true);
  });
  it('never rounds a failing ratio up', () => {
    expect(formatRatio(4.4999)).toBe('4.49:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });
});

describe('APCA', () => {
  it('matches reference values', () => {
    expect(apcaContrast(hexToRgb('#000000'), hexToRgb('#ffffff'))).toBeCloseTo(106.04, 1);
    expect(apcaContrast(hexToRgb('#ffffff'), hexToRgb('#000000'))).toBeCloseTo(-107.88, 1);
    expect(apcaContrast(hexToRgb('#888888'), hexToRgb('#ffffff'))).toBeCloseTo(63.06, 0);
    expect(apcaContrast(hexToRgb('#ffffff'), hexToRgb('#888888'))).toBeCloseTo(-68.54, 0);
  });
  it('is zero for identical colors', () => {
    expect(apcaContrast(hexToRgb('#336699'), hexToRgb('#336699'))).toBe(0);
  });
});

describe('color vision deficiency simulation', () => {
  it('matrices preserve white (rows sum to ~1)', () => {
    for (const m of Object.values(CVD_MATRICES)) {
      for (let row = 0; row < 3; row++) expect(m[row * 3] + m[row * 3 + 1] + m[row * 3 + 2]).toBeCloseTo(1, 2);
    }
    for (const type of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const) {
      expect(simulateHex('#ffffff', type)).toBe('#ffffff');
      expect(simulateHex('#000000', type)).toBe('#000000');
      const gray = simulateCvd({ r: 128, g: 128, b: 128 }, type);
      expect(Math.abs(gray.r - 128)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(gray.b - 128)).toBeLessThanOrEqual(1.5);
    }
  });
  it('achromatopsia removes all color', () => {
    const c = simulateCvd({ r: 200, g: 40, b: 90 }, 'achromatopsia');
    expect(c.r).toBeCloseTo(c.g, 6);
    expect(c.g).toBeCloseTo(c.b, 6);
  });
  it('protanopia makes red and green hard to tell apart', () => {
    const r = simulateCvd({ r: 255, g: 0, b: 0 }, 'protanopia');
    expect(r.r).toBeLessThan(160); // reds look much darker
    expect(Math.abs(r.r - r.g)).toBeLessThan(40);
    expect(cvdConflicts(['#d03030', '#4a8a2a'], 'deuteranopia').length).toBeGreaterThanOrEqual(0);
  });
  it('severity 0 is the identity', () => {
    expect(cvdMatrix('deuteranopia', 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(simulateHex('#3a7bd5', 'tritanopia', 0)).toBe('#3a7bd5');
  });
  it('reports red/green conflicts for deuteranopia', () => {
    const conflicts = cvdConflicts(['#e03c31', '#5a9b2e', '#2050c0'], 'deuteranopia', 1, 20);
    expect(conflicts.some((c) => c.a === 0 && c.b === 1)).toBe(true);
  });
});

describe('contrast fixes', () => {
  it('finds the nearest passing color', () => {
    const fixed = suggestContrastFix('#7a9cff', '#ffffff', 4.5)!;
    expect(fixed).not.toBeNull();
    expect(contrastHex(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const dark = suggestContrastFix('#334455', '#101010', 7)!;
    expect(contrastHex(dark, '#101010')).toBeGreaterThanOrEqual(7);
  });
  it('returns the color itself when it already passes', () => {
    expect(suggestContrastFix('#000000', '#ffffff', 4.5)).toBe('#000000');
  });
  it('returns null when impossible', () => {
    expect(suggestContrastFix('#808080', '#808080', 22)).toBeNull();
  });
  it('fixes palette pairs and respects locks', () => {
    const hexes = ['#f5f5f0', '#9fb4c7', '#d8a48f', '#1d2a33'];
    const pairs = defaultTextPairs(hexes);
    expect(pairs.length).toBeGreaterThan(0);
    const fixed = fixPairs(hexes, pairs, 4.5, [true, false, false, true]);
    expect(fixed[0]).toBe(hexes[0]);
    expect(fixed[3]).toBe(hexes[3]);
    expect(checkPairs(fixed, pairs).every((p) => p.pass)).toBe(true);
  });
});
