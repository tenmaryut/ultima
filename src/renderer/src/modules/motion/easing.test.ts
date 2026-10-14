import { describe, expect, it } from 'vitest';
import { backOut, bezierFor, bounceOut, cubicBezier, ease, elasticOut, parseEasing, sanitizeBezier } from './easing';

describe('cubicBezier solver', () => {
  it('matches the CSS "ease" curve at known points', () => {
    const e = cubicBezier(0.25, 0.1, 0.25, 1);
    // Reference values from a high-precision bisection of the parametric curve.
    expect(e(0.5)).toBeCloseTo(0.802403, 5);
    expect(e(0.25)).toBeCloseTo(0.408511, 5);
    expect(e(0.75)).toBeCloseTo(0.960459, 5);
  });

  it('hits the end points exactly', () => {
    const e = cubicBezier(0.42, 0, 0.58, 1);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    expect(e(-1)).toBe(0);
    expect(e(2)).toBe(1);
  });

  it('is symmetric for ease-in-out', () => {
    const e = cubicBezier(0.42, 0, 0.58, 1);
    for (const u of [0.1, 0.2, 0.3, 0.4]) expect(e(u) + e(1 - u)).toBeCloseTo(1, 6);
    expect(e(0.5)).toBeCloseTo(0.5, 6);
  });

  it('is linear for diagonal control points', () => {
    const e = cubicBezier(0.3, 0.3, 0.7, 0.7);
    for (const u of [0.1, 0.33, 0.9]) expect(e(u)).toBeCloseTo(u, 9);
  });

  it('solves x precisely (x(t) inverse round trip)', () => {
    const [x1, y1, x2, y2] = [0.1, 0.9, 0.2, 1];
    const e = cubicBezier(x1, y1, x2, y2);
    // sample the parametric curve and compare to the solver output
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      const mt = 1 - t;
      const x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
      const y = 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
      expect(e(x)).toBeCloseTo(y, 5);
    }
  });

  it('allows overshooting y values', () => {
    const e = cubicBezier(0.34, 1.56, 0.64, 1);
    const max = Math.max(...Array.from({ length: 99 }, (_, i) => e((i + 1) / 100)));
    expect(max).toBeGreaterThan(1.05);
  });

  it('is monotonic in u for steep curves (bisection fallback)', () => {
    const e = cubicBezier(0, 1, 0, 1);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = e(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('named easings', () => {
  it('start at 0 and end at 1', () => {
    for (const type of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'back', 'elastic', 'bounce'] as const) {
      expect(ease(type, 0)).toBeCloseTo(0, 6);
      expect(ease(type, 1)).toBeCloseTo(1, 6);
    }
  });

  it('ease in is slow at the start, ease out is fast at the start', () => {
    expect(ease('easeIn', 0.25)).toBeLessThan(0.25);
    expect(ease('easeOut', 0.25)).toBeGreaterThan(0.25);
  });

  it('hold stays at the start value until the end', () => {
    expect(ease('hold', 0.99)).toBe(0);
    expect(ease('hold', 1)).toBe(1);
  });

  it('back overshoots, bounce stays within [0,1], elastic oscillates', () => {
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(backOut))).toBeGreaterThan(1);
    for (let i = 0; i <= 100; i++) {
      const v = bounceOut(i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.000001);
    }
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => elasticOut(i / 50)))).toBeGreaterThan(1);
  });

  it('uses custom bezier control points', () => {
    expect(ease('bezier', 0.5, [0.42, 0, 0.58, 1])).toBeCloseTo(0.5, 5);
    expect(ease('bezier', 0.5)).toBe(0.5); // missing points → linear
  });
});

describe('parseEasing', () => {
  it('accepts many spellings', () => {
    expect(parseEasing('ease-out')).toEqual({ easing: 'easeOut' });
    expect(parseEasing('EaseInOut')).toEqual({ easing: 'easeInOut' });
    expect(parseEasing('ease_in')).toEqual({ easing: 'easeIn' });
    expect(parseEasing('bounce')).toEqual({ easing: 'bounce' });
    expect(parseEasing('step')).toEqual({ easing: 'hold' });
    expect(parseEasing('spring')).toEqual({ easing: 'elastic' });
  });

  it('parses cubic-bezier strings, arrays and objects', () => {
    expect(parseEasing('cubic-bezier(0.2, 0.8, 0.2, 1)')).toEqual({ easing: 'bezier', bezier: [0.2, 0.8, 0.2, 1] });
    expect(parseEasing([0.1, 0, 0.3, 1])).toEqual({ easing: 'bezier', bezier: [0.1, 0, 0.3, 1] });
    expect(parseEasing({ type: 'bezier', bezier: [0.5, 0, 0.5, 1] })).toEqual({ easing: 'bezier', bezier: [0.5, 0, 0.5, 1] });
    expect(parseEasing({ type: 'linear' })).toEqual({ easing: 'linear' });
  });

  it('clamps x control points into [0,1] and rejects junk', () => {
    expect(sanitizeBezier([-1, 0, 2, 1])).toEqual([0, 0, 1, 1]);
    expect(parseEasing('wobbly')).toBeNull();
    expect(parseEasing(42)).toBeNull();
    expect(parseEasing([1, 2])).toBeNull();
    expect(parseEasing('cubic-bezier(a,b,c,d)')).toBeNull();
  });

  it('bezierFor gives editable starting points', () => {
    expect(bezierFor('easeIn')).toEqual([0.42, 0, 1, 1]);
    expect(bezierFor('bezier', [0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(bezierFor('bounce')).toHaveLength(4);
  });
});
