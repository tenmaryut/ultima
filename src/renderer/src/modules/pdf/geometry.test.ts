import { describe, expect, it } from 'vitest';
import {
  applyLinear,
  applyMatrix,
  contentFrame,
  CSS_UNITS,
  fitZoom,
  frameMatrix,
  invertMatrix,
  multiplyMatrix,
  nextZoomStep,
  normalizeRotation,
  pdfToScreen,
  rectFromFrame,
  rectToScreen,
  relativeToPdf,
  screenRectToPdf,
  screenToPdf,
  viewportSize,
  viewportTransform,
  type Rect,
  type Rotation,
  type ViewBox,
} from './geometry';

const VIEW: ViewBox = [0, 0, 600, 800];

function close(a: number[], b: number[]) {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
}

describe('viewportTransform (matches pdf.js PageViewport)', () => {
  it('rotation 0 flips y', () => {
    close(viewportTransform(VIEW, 1, 0), [1, 0, 0, -1, 0, 800]);
    expect(applyMatrix(viewportTransform(VIEW, 1, 0), 0, 0)).toEqual({ x: 0, y: 800 });
  });
  it('rotation 90 / 180 / 270', () => {
    close(viewportTransform(VIEW, 1, 90), [0, 1, 1, 0, 0, 0]);
    close(viewportTransform(VIEW, 1, 180), [-1, 0, 0, 1, 600, 0]);
    close(viewportTransform(VIEW, 1, 270), [0, -1, -1, 0, 800, 600]);
  });
  it('applies scale and view box offsets', () => {
    const view: ViewBox = [10, 20, 310, 420];
    const m = viewportTransform(view, 2, 0);
    // top-left of the view box lands at the screen origin
    const p = applyMatrix(m, 10, 420);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    const q = applyMatrix(m, 310, 20);
    expect(q.x).toBeCloseTo(600);
    expect(q.y).toBeCloseTo(800);
  });
  it('normalizes negative and large rotations', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    close(viewportTransform(VIEW, 1, -90), viewportTransform(VIEW, 1, 270));
  });
  it('reports rotated sizes', () => {
    expect(viewportSize(VIEW, 1.5, 0)).toEqual({ width: 900, height: 1200 });
    expect(viewportSize(VIEW, 1.5, 90)).toEqual({ width: 1200, height: 900 });
  });
});

describe('PDF points <-> screen px', () => {
  for (const rot of [0, 90, 180, 270] as Rotation[]) {
    it(`round-trips at rotation ${rot}`, () => {
      const m = viewportTransform([5, 7, 605, 807], 1.75 * CSS_UNITS, rot);
      for (const p of [{ x: 5, y: 7 }, { x: 300.5, y: 123.25 }, { x: 605, y: 807 }]) {
        const s = pdfToScreen(m, p);
        const back = screenToPdf(m, s);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    });
  }
  it('maps every corner into the viewport', () => {
    for (const rot of [0, 90, 180, 270]) {
      const m = viewportTransform(VIEW, 2, rot);
      const size = viewportSize(VIEW, 2, rot);
      const r = rectToScreen(m, { x: 0, y: 0, w: 600, h: 800 });
      expect(r.left).toBeCloseTo(0);
      expect(r.top).toBeCloseTo(0);
      expect(r.width).toBeCloseTo(size.width);
      expect(r.height).toBeCloseTo(size.height);
    }
  });
  it('screen rect -> pdf rect is the inverse of rectToScreen', () => {
    const rect: Rect = { x: 100, y: 200, w: 50, h: 120 };
    for (const rot of [0, 90, 180, 270]) {
      const m = viewportTransform(VIEW, 1.3, rot);
      const back = screenRectToPdf(m, rectToScreen(m, rect));
      expect(back.x).toBeCloseTo(rect.x);
      expect(back.y).toBeCloseTo(rect.y);
      expect(back.w).toBeCloseTo(rect.w);
      expect(back.h).toBeCloseTo(rect.h);
    }
  });
  it('inverts and multiplies matrices', () => {
    const m = viewportTransform(VIEW, 1.2, 90);
    const id = multiplyMatrix(m, invertMatrix(m));
    close(id, [1, 0, 0, 1, 0, 0]);
  });
});

describe('content frames of upright objects', () => {
  const rect: Rect = { x: 100, y: 200, w: 50, h: 120 };
  for (const rot of [0, 90, 180, 270] as Rotation[]) {
    it(`origin is the visual top-left and axes point right/down at rotation ${rot}`, () => {
      const m = viewportTransform(VIEW, 1, rot);
      const f = contentFrame(rect, rot);
      const screen = rectToScreen(m, rect);
      const o = pdfToScreen(m, f.origin);
      expect(o.x).toBeCloseTo(screen.left);
      expect(o.y).toBeCloseTo(screen.top);
      const ax = applyLinear(m, f.ax.x, f.ax.y);
      const dn = applyLinear(m, f.dn.x, f.dn.y);
      expect(ax.x).toBeCloseTo(1);
      expect(ax.y).toBeCloseTo(0);
      expect(dn.x).toBeCloseTo(0);
      expect(dn.y).toBeCloseTo(1);
      expect(f.width).toBeCloseTo(screen.width);
      expect(f.height).toBeCloseTo(screen.height);
    });
    it(`rectFromFrame inverts contentFrame at rotation ${rot}`, () => {
      const f = contentFrame(rect, rot);
      const r = rectFromFrame(f.origin, rot, f.width, f.height);
      expect(r).toEqual(rect);
    });
  }
  it('frameMatrix maps content (u, v) into user space', () => {
    const fm = frameMatrix(rect, 0);
    expect(applyMatrix(fm, 0, 0)).toEqual({ x: 100, y: 320 });
    expect(applyMatrix(fm, 50, 120)).toEqual({ x: 150, y: 200 });
  });
});

describe('relative page positions', () => {
  it('maps (0,0) to the visual top-left corner', () => {
    expect(relativeToPdf(VIEW, 0, 0, 0)).toEqual({ x: 0, y: 800 });
    expect(relativeToPdf(VIEW, 0, 1, 1)).toEqual({ x: 600, y: 0 });
    const r90 = relativeToPdf(VIEW, 90, 1, 0);
    expect(r90.x).toBeCloseTo(0);
    expect(r90.y).toBeCloseTo(800);
  });
});

describe('zoom helpers', () => {
  it('fits width and page', () => {
    expect(fitZoom(600, 800, 800, 2000, 'width')).toBeCloseTo(800 / (600 * CSS_UNITS));
    expect(fitZoom(600, 800, 2000, 800, 'page')).toBeCloseTo(800 / (800 * CSS_UNITS));
  });
  it('steps through zoom levels', () => {
    expect(nextZoomStep(1, 1)).toBe(1.1);
    expect(nextZoomStep(1, -1)).toBe(0.9);
    expect(nextZoomStep(8, 1)).toBe(8);
  });
});
