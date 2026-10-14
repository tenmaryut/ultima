import { describe, expect, it } from 'vitest';
import { applyChromaKey, applyTemperature, clipLayout, fadeFactor, hitLayout, layoutCorners, titleAnimState, transitionFx } from './fx';
import { DEFAULT_VISUAL } from './presets';

describe('layout', () => {
  it('fits media inside the frame', () => {
    const l = clipLayout(1280, 720, 1920, 1080, DEFAULT_VISUAL);
    expect([l.cx, l.cy, l.dw, l.dh]).toEqual([960, 540, 1920, 1080]);
    const portrait = clipLayout(1080, 1920, 1920, 1080, DEFAULT_VISUAL);
    expect(portrait.dh).toBe(1080);
    expect(portrait.dw).toBeCloseTo(607.5);
  });

  it('applies position, scale and crop', () => {
    const l = clipLayout(1920, 1080, 1920, 1080, { ...DEFAULT_VISUAL, x: 100, y: -50, scale: 0.5, cropLeft: 0.25 });
    expect([l.cx, l.cy]).toEqual([1060, 490]);
    expect(l.dw).toBeCloseTo(720);
    expect(l.dx).toBeCloseTo(-480 + 240);
    expect(l.sx).toBe(0.25);
    expect(l.sw).toBe(0.75);
  });

  it('hit tests rotated layouts', () => {
    const l = clipLayout(100, 100, 1000, 1000, { ...DEFAULT_VISUAL, scale: 0.1, rotation: 45 });
    expect(hitLayout(l, 500, 500)).toBe(true);
    expect(hitLayout(l, 548, 500)).toBe(true); // within the rotated diagonal
    expect(hitLayout(l, 548, 548)).toBe(false);
    expect(layoutCorners(l)).toHaveLength(4);
  });
});

describe('fades, transitions and title animations', () => {
  it('computes fade factors', () => {
    expect(fadeFactor(0.5, 10, 1, 2)).toBe(0.5);
    expect(fadeFactor(5, 10, 1, 2)).toBe(1);
    expect(fadeFactor(9, 10, 1, 2)).toBe(0.5);
    expect(fadeFactor(3, 10, 0, 0)).toBe(1);
  });

  it('describes each transition', () => {
    expect(transitionFx('dissolve', 0.25).bAlpha).toBe(0.25);
    const dipStart = transitionFx('dipBlack', 0.25);
    expect([dipStart.showA, dipStart.showB, dipStart.dip?.alpha]).toEqual([true, false, 0.5]);
    const dipEnd = transitionFx('dipWhite', 0.75);
    expect([dipEnd.showA, dipEnd.showB, dipEnd.dip?.alpha, dipEnd.dip?.color]).toEqual([false, true, 0.5, '#ffffff']);
    expect(transitionFx('wipeLeft', 0.3).bClip).toEqual({ x0: 0.7, x1: 1 });
    expect(transitionFx('wipeRight', 0.3).bClip).toEqual({ x0: 0, x1: 0.3 });
    expect(transitionFx('slide', 0).bOffsetX).toBe(1);
    expect(transitionFx('slide', 1).bOffsetX).toBe(0);
    expect(transitionFx('zoom', 1).bScale).toBe(1);
  });

  it('animates titles', () => {
    expect(titleAnimState('fade', 0, 4, 0.5).alpha).toBe(0);
    expect(titleAnimState('fade', 2, 4, 0.5).alpha).toBe(1);
    expect(titleAnimState('slideUp', 0, 4, 0.5).dy).toBeCloseTo(0.05);
    expect(titleAnimState('pop', 0.5, 4, 0.5).scale).toBeCloseTo(1);
    expect(titleAnimState('typewriter', 0.75, 4, 1.5).reveal).toBeCloseTo(0.5);
    expect(titleAnimState('none', 0, 4, 0.5)).toEqual({ alpha: 1, dy: 0, scale: 1, reveal: 1 });
  });
});

describe('pixel effects', () => {
  it('warms and cools', () => {
    const px = new Uint8ClampedArray([100, 100, 100, 255]);
    applyTemperature(px, 100);
    expect(px[0]).toBeGreaterThan(100);
    expect(px[2]).toBeLessThan(100);
    const cool = new Uint8ClampedArray([100, 100, 100, 255]);
    applyTemperature(cool, -100);
    expect(cool[2]).toBeGreaterThan(100);
  });

  it('keys out the key color and keeps other colors', () => {
    const px = new Uint8ClampedArray([0, 255, 0, 255, 220, 40, 40, 255, 30, 200, 40, 255]);
    applyChromaKey(px, { r: 0, g: 255, b: 0 }, 0.3, 0.1);
    expect(px[3]).toBe(0); // pure green gone
    expect(px[7]).toBe(255); // red kept
    expect(px[11]).toBeLessThan(80); // near-green mostly gone
  });
});
