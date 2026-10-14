import { describe, expect, it } from 'vitest';
import { contrastRatio, hslToRgb, hsvToRgb, parseColor, readableTextColor, rgbToHsl, rgbToHsv, toCss, toHex } from './color';

describe('color utils', () => {
  it('parses hex, rgb and hsl', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#00ff0080')?.a).toBeCloseTo(0.5, 2);
    expect(parseColor('rgba(10, 20, 30, 0.25)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(toHex(parseColor('hsl(240, 100%, 50%)')!)).toBe('#0000ff');
    expect(parseColor('nonsense')).toBeNull();
  });

  it('round-trips HSV and HSL', () => {
    for (const hex of ['#123456', '#ff8800', '#7c5cff', '#ffffff', '#000000']) {
      const c = parseColor(hex)!;
      expect(toHex(hsvToRgb(rgbToHsv(c)))).toBe(hex);
      expect(toHex(hslToRgb(rgbToHsl(c)))).toBe(hex);
    }
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
    expect(readableTextColor('#ffff00')).toBe('#000000');
    expect(readableTextColor('#1a1a40')).toBe('#ffffff');
  });

  it('formats css', () => {
    expect(toCss({ r: 255, g: 0, b: 0, a: 1 })).toBe('#ff0000');
    expect(toCss({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('rgba(255, 0, 0, 0.5)');
  });
});

import { formatTime } from './format';

describe('formatTime', () => {
  it('carries rounding into the next minute/hour', () => {
    expect(formatTime(59.996)).toBe('01:00.00');
    expect(formatTime(3599.999)).toBe('1:00:00.00');
    expect(formatTime(75.5)).toBe('01:15.50');
    expect(formatTime(61.9, false)).toBe('01:01');
  });
});
