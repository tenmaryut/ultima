import { describe, expect, it } from 'vitest';
import {
  cmykToRgb,
  formatColor,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  labToRgb,
  normalizeHex,
  parseColorValue,
  parseHex,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
  rgbToLab,
  textOn,
  toHex,
  COLOR_FORMATS,
  type RGB,
} from './colormath';
import { mulberry32 } from './extract';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const randomColors = (n: number): RGB[] => {
  const rnd = mulberry32(42);
  return Array.from({ length: n }, () => ({ r: Math.floor(rnd() * 256), g: Math.floor(rnd() * 256), b: Math.floor(rnd() * 256) }));
};

describe('hex', () => {
  it('parses short and long forms', () => {
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('00FF7f')).toEqual({ r: 0, g: 255, b: 127 });
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('nope')).toBeNull();
  });
  it('formats with rounding and clamping', () => {
    expect(toHex({ r: 255.4, g: -3, b: 300 })).toBe('#ff00ff');
    expect(toHex({ r: 17, g: 34, b: 51 })).toBe('#112233');
  });
  it('normalizes CSS colors', () => {
    expect(normalizeHex('rgb(255, 128, 0)')).toBe('#ff8000');
    expect(normalizeHex('hsl(120, 100%, 50%)')).toBe('#00ff00');
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(42)).toBeNull();
  });
});

describe('HSV / HSL', () => {
  it('known values', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    const c = rgbToHsv({ r: 0, g: 128, b: 255 });
    close(c.h, 209.88, 0.01);
    close(c.s, 1);
    close(c.v, 1);
    const hsl = rgbToHsl({ r: 255, g: 255, b: 0 });
    close(hsl.h, 60);
    close(hsl.s, 1);
    close(hsl.l, 0.5);
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });
  it('round-trips random colors', () => {
    for (const c of randomColors(500)) {
      const hsv = hsvToRgb(rgbToHsv(c));
      close(hsv.r, c.r, 1e-6);
      close(hsv.g, c.g, 1e-6);
      close(hsv.b, c.b, 1e-6);
      const hsl = hslToRgb(rgbToHsl(c));
      close(hsl.r, c.r, 1e-6);
      close(hsl.g, c.g, 1e-6);
      close(hsl.b, c.b, 1e-6);
    }
  });
  it('wraps hue', () => {
    expect(toHex(hsvToRgb({ h: 360, s: 1, v: 1 }))).toBe('#ff0000');
    expect(toHex(hsvToRgb({ h: -120, s: 1, v: 1 }))).toBe('#0000ff');
  });
});

describe('CMYK', () => {
  it('known values', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    const c = rgbToCmyk({ r: 255, g: 0, b: 0 });
    expect([c.c, c.m, c.y, c.k]).toEqual([0, 1, 1, 0]);
    const t = rgbToCmyk({ r: 0, g: 128, b: 128 });
    close(t.c, 1);
    close(t.k, 1 - 128 / 255);
  });
  it('round-trips', () => {
    for (const c of randomColors(300)) {
      const back = cmykToRgb(rgbToCmyk(c));
      close(back.r, c.r, 1e-6);
      close(back.g, c.g, 1e-6);
      close(back.b, c.b, 1e-6);
    }
  });
});

describe('Lab (D50)', () => {
  it('white, black and gray', () => {
    const w = rgbToLab({ r: 255, g: 255, b: 255 });
    close(w.l, 100, 0.01);
    close(w.a, 0, 0.01);
    close(w.b, 0, 0.01);
    const k = rgbToLab({ r: 0, g: 0, b: 0 });
    close(k.l, 0, 1e-9);
    const g = rgbToLab({ r: 119, g: 119, b: 119 });
    close(g.a, 0, 0.01);
    close(g.b, 0, 0.01);
  });
  it('matches CSS Color 4 reference values', () => {
    const red = rgbToLab({ r: 255, g: 0, b: 0 });
    close(red.l, 54.29, 0.05);
    close(red.a, 80.8, 0.1);
    close(red.b, 69.9, 0.1);
    const blue = rgbToLab({ r: 0, g: 0, b: 255 });
    close(blue.l, 29.57, 0.05);
    close(blue.a, 68.29, 0.15);
    close(blue.b, -112.03, 0.15);
  });
  it('round-trips random colors', () => {
    for (const c of randomColors(400)) {
      const back = labToRgb(rgbToLab(c));
      close(back.r, c.r, 1e-6);
      close(back.g, c.g, 1e-6);
      close(back.b, c.b, 1e-6);
    }
  });
});

describe('formatting and parsing', () => {
  it('formats every model', () => {
    expect(formatColor('#ff0000', 'hex')).toBe('#FF0000');
    expect(formatColor('#ff0000', 'rgb')).toBe('255, 0, 0');
    expect(formatColor('#ff0000', 'hsb')).toBe('0°, 100%, 100%');
    expect(formatColor('#ff0000', 'hsl')).toBe('0°, 100%, 50%');
    expect(formatColor('#ff0000', 'cmyk')).toBe('0%, 100%, 100%, 0%');
    expect(formatColor('#ff0000', 'lab')).toMatch(/^54\.\d+, 80\.\d+, 69\.\d+$/);
  });
  it('parses back what it formats (within rounding)', () => {
    for (const c of randomColors(120)) {
      const hex = toHex(c);
      for (const f of COLOR_FORMATS) {
        const parsed = parseColorValue(formatColor(hex, f.id), f.id);
        expect(parsed, `${f.id} ${hex}`).not.toBeNull();
        const back = parsed!;
        const tol = f.id === 'hex' || f.id === 'rgb' || f.id === 'lab' ? 1 : 4;
        expect(Math.abs(back.r - c.r)).toBeLessThanOrEqual(tol);
        expect(Math.abs(back.g - c.g)).toBeLessThanOrEqual(tol);
        expect(Math.abs(back.b - c.b)).toBeLessThanOrEqual(tol);
      }
    }
  });
  it('rejects out of range values', () => {
    expect(parseColorValue('300, 0, 0', 'rgb')).toBeNull();
    expect(parseColorValue('10, 20', 'rgb')).toBeNull();
    expect(parseColorValue('0, 120%, 50%', 'hsl')).toBeNull();
    expect(parseColorValue('zzz', 'hex')).toBeNull();
  });
  it('picks readable text', () => {
    expect(textOn('#ffffff')).toBe('#000000');
    expect(textOn('#101010')).toBe('#ffffff');
    expect(hexToRgb('#bad')).toEqual({ r: 0xbb, g: 0xaa, b: 0xdd });
  });
});
