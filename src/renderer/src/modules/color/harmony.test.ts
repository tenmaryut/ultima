import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHsv, toHex, hsvToRgb } from './colormath';
import {
  angleDiff,
  baseWheelFromMarker,
  generateHarmony,
  rgbHueToWheel,
  ruleSpecs,
  spreadFromMarker,
  wheelHueToRgb,
  HARMONY_RULES,
  type HarmonyRule,
} from './harmony';

const red = { h: 0, s: 1, v: 1 };
const hexes = (rule: HarmonyRule, base = red, n = 5, bi = 2, spread = 30, mode: 'rgb' | 'ryb' = 'rgb') =>
  generateHarmony(base, rule, n, bi, spread, mode).colors.map((c) => toHex(hsvToRgb(c)));
const hues = (rule: HarmonyRule, base = red, spread = 30, mode: 'rgb' | 'ryb' = 'rgb') =>
  generateHarmony(base, rule, 5, 2, spread, mode).colors.map((c) => Math.round(c.h) % 360);

describe('wheel mapping', () => {
  it('rgb mode is the identity', () => {
    for (let h = 0; h < 360; h += 7) {
      expect(rgbHueToWheel(h, 'rgb')).toBeCloseTo(h, 9);
      expect(wheelHueToRgb(h, 'rgb')).toBeCloseTo(h, 9);
    }
  });
  it('ryb mapping is monotonic and invertible', () => {
    let prev = -1;
    for (let a = 0; a < 360; a += 0.5) {
      const h = wheelHueToRgb(a, 'ryb');
      expect(h).toBeGreaterThan(prev);
      prev = h;
      expect(rgbHueToWheel(h, 'ryb')).toBeCloseTo(a, 6);
    }
  });
  it('places primaries like a painter wheel', () => {
    expect(wheelHueToRgb(0, 'ryb')).toBe(0); // red
    expect(wheelHueToRgb(120, 'ryb')).toBe(60); // yellow
    expect(wheelHueToRgb(180, 'ryb')).toBe(120); // green opposite red
  });
});

describe('harmony rules (rgb wheel)', () => {
  it('complementary of red contains cyan', () => {
    const list = hexes('complementary');
    expect(list[2]).toBe('#ff0000');
    expect(list).toContain('#00ffff');
  });
  it('triad uses hues 120° apart', () => {
    expect(new Set(hues('triad'))).toEqual(new Set([0, 120, 240]));
  });
  it('square uses hues 90° apart', () => {
    expect(new Set(hues('square'))).toEqual(new Set([0, 90, 180, 270]));
  });
  it('analogous spreads symmetrically around the base', () => {
    expect(hues('analogous', red, 30)).toEqual([300, 330, 0, 30, 60]);
    expect(hues('analogous', red, 15)).toEqual([330, 345, 0, 15, 30]);
  });
  it('split complementary sits around the complement', () => {
    expect(new Set(hues('split-complementary', red, 30))).toEqual(new Set([0, 150, 210]));
  });
  it('compound mixes analogous and complementary', () => {
    expect(new Set(hues('compound', red, 30))).toEqual(new Set([0, 30, 180, 150]));
  });
  it('monochromatic and shades keep the hue', () => {
    const base = { h: 210, s: 0.7, v: 0.8 };
    for (const rule of ['monochromatic', 'shades'] as const) {
      const r = generateHarmony(base, rule, 5, 2, rule === 'shades' ? 0.18 : 0.25, 'rgb');
      r.colors.forEach((c) => expect(c.h).toBeCloseTo(210, 6));
      const unique = new Set(r.colors.map((c) => toHex(hsvToRgb(c))));
      expect(unique.size).toBe(5);
    }
  });
  it('shades vary only brightness and stay in range even for a bright base', () => {
    const base = { h: 30, s: 0.6, v: 1 };
    const r = generateHarmony(base, 'shades', 7, 3, 0.2, 'rgb');
    r.colors.forEach((c) => {
      expect(c.s).toBeCloseTo(0.6, 9);
      expect(c.v).toBeGreaterThanOrEqual(0.04 - 1e-9);
      expect(c.v).toBeLessThanOrEqual(1);
    });
    expect(new Set(r.colors.map((c) => c.v.toFixed(4))).size).toBe(7);
  });
  it('a gray base in monochromatic mode stays gray', () => {
    const r = generateHarmony({ h: 0, s: 0, v: 0.5 }, 'monochromatic', 5, 2, 0.25, 'rgb');
    r.colors.forEach((c) => expect(c.s).toBe(0));
    expect(new Set(r.colors.map((c) => c.v.toFixed(3))).size).toBe(5);
  });
  it('places the base at the requested index', () => {
    const base = rgbToHsv(hexToRgb('#3366cc'));
    for (let bi = 0; bi < 5; bi++) {
      const r = generateHarmony(base, 'triad', 5, bi, 0, 'rgb');
      expect(toHex(hsvToRgb(r.colors[bi]))).toBe('#3366cc');
      expect(r.specs[bi]).toBeNull();
      expect(r.specs.filter(Boolean)).toHaveLength(4);
    }
  });
  it('supports other palette sizes', () => {
    for (const rule of HARMONY_RULES.map((r) => r.id)) {
      for (const n of [1, 2, 3, 8, 12]) {
        const r = generateHarmony({ h: 200, s: 0.6, v: 0.7 }, rule, n, Math.floor(n / 2), 30, 'ryb');
        expect(r.colors).toHaveLength(n);
        r.colors.forEach((c) => {
          expect(Number.isFinite(c.h) && Number.isFinite(c.s) && Number.isFinite(c.v)).toBe(true);
          expect(c.s).toBeGreaterThanOrEqual(0);
          expect(c.v).toBeLessThanOrEqual(1);
        });
      }
    }
  });
  it('custom produces no slots', () => {
    expect(ruleSpecs('custom', 4, 0, red)).toEqual([]);
  });
});

describe('harmony rules (ryb wheel)', () => {
  it('complement of red is green', () => {
    const r = generateHarmony(red, 'complementary', 5, 2, 0, 'ryb');
    expect(r.colors.some((c) => Math.round(c.h) === 120 && c.v === 1)).toBe(true);
  });
  it('complement of blue is orange-ish', () => {
    const blueWheel = 240;
    const comp = wheelHueToRgb(blueWheel + 180, 'ryb');
    expect(comp).toBeGreaterThan(20);
    expect(comp).toBeLessThan(45);
  });
});

describe('drag helpers', () => {
  it('angleDiff is signed and wraps', () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(180);
  });
  it('dragging an analogous marker changes the spread', () => {
    const slot = { fixed: 0, mult: 2, ds: 0, dv: 0, order: 2 };
    expect(spreadFromMarker(slot, 100, 160, 'analogous')).toBe(30);
    expect(spreadFromMarker(slot, 100, 220, 'analogous')).toBe(60); // clamped to max
  });
  it('fixed markers rotate the whole set', () => {
    const slot = { fixed: 120, mult: 0, ds: 0, dv: 0, order: -1 };
    expect(spreadFromMarker(slot, 0, 140, 'triad')).toBeNull();
    expect(baseWheelFromMarker(slot, 140, 0)).toBe(20);
  });
});
