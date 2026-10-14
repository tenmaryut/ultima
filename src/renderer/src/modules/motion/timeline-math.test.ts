import { describe, expect, it } from 'vitest';
import {
  fitScale,
  formatRulerLabel,
  formatTimecode,
  frameCount,
  lastFrameTime,
  parseTimeInput,
  pickTickStep,
  quantize,
  rulerTicks,
  snapTime,
  timeToX,
  xToTime,
  zoomAround,
} from './timeline-math';

const scale = { pxPerSec: 100, pad: 12 };

describe('time ↔ pixel', () => {
  it('converts both ways', () => {
    expect(timeToX(0, scale)).toBe(12);
    expect(timeToX(2.5, scale)).toBe(262);
    expect(xToTime(262, scale)).toBeCloseTo(2.5);
    for (const t of [0, 0.033, 1.7, 12.25]) expect(xToTime(timeToX(t, scale), scale)).toBeCloseTo(t, 9);
  });

  it('quantizes to frames', () => {
    expect(quantize(0.51, 30)).toBeCloseTo(15 / 30);
    expect(quantize(1.02, 24)).toBeCloseTo(1);
    expect(lastFrameTime(5, 30)).toBeCloseTo(149 / 30);
    expect(frameCount(0, 2, 30)).toBe(60);
  });

  it('snaps only within the pixel threshold', () => {
    expect(snapTime(1.03, [1, 2], 100, 6)).toEqual({ time: 1, snapped: 1 });
    expect(snapTime(1.1, [1, 2], 100, 6)).toEqual({ time: 1.1, snapped: null });
    // picks the closest candidate
    expect(snapTime(1.98, [1.95, 2], 100, 6).time).toBe(2);
  });

  it('zooms around an anchor keeping its time fixed', () => {
    const anchorX = 300;
    const scrollLeft = 150;
    const before = xToTime(scrollLeft + anchorX, scale);
    const z = zoomAround(scale, scrollLeft, 2, anchorX);
    expect(z.scale.pxPerSec).toBe(200);
    expect(xToTime(z.scrollLeft + anchorX, z.scale)).toBeCloseTo(before, 9);
  });

  it('fits a duration in a width', () => {
    expect(fitScale(10, 1024, 12)).toBeCloseTo(100);
  });
});

describe('ruler', () => {
  it('chooses label spacing that fits', () => {
    expect(pickTickStep(100, 30).major).toBe(1);
    expect(pickTickStep(1000, 30).major).toBeCloseTo(2 / 30);
    expect(pickTickStep(10, 30).major).toBe(10);
  });

  it('labels frame-based steps (e.g. every 10 frames at 30 fps)', () => {
    const sc = { pxPerSec: 201, pad: 14 };
    const step = pickTickStep(sc.pxPerSec, 30);
    expect(step.major).toBeCloseTo(1 / 3);
    const majors = rulerTicks(sc, 14, 14 + 201 * 2, 30, 4).filter((t) => t.major);
    expect(majors.map((t) => Math.round(t.time * 30))).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it('lists ticks in the visible range only', () => {
    const ticks = rulerTicks(scale, 12, 312, 30, 10);
    expect(ticks[0].time).toBe(0);
    expect(ticks.filter((t) => t.major).map((t) => t.time)).toEqual([0, 1, 2, 3]);
    expect(ticks.every((t) => t.x >= 12 - 1e-9 && t.x <= 312 + 30)).toBe(true);
  });

  it('formats timecodes and labels', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00');
    expect(formatTimecode(1.5, 30)).toBe('00:01:15');
    expect(formatTimecode(61 + 2 / 30, 30)).toBe('01:01:02');
    expect(formatTimecode(3723, 25)).toBe('1:02:03:00');
    expect(formatRulerLabel(2, 30, 1)).toBe('2s');
    expect(formatRulerLabel(75, 30, 5)).toBe('1:15');
    expect(formatRulerLabel(1 + 10 / 30, 30, 2 / 30)).toBe('10f');
  });

  it('parses typed times', () => {
    expect(parseTimeInput('1.5', 30)).toBe(1.5);
    expect(parseTimeInput('2s', 30)).toBe(2);
    expect(parseTimeInput('45f', 30)).toBe(1.5);
    expect(parseTimeInput('00:01:15', 30)).toBeCloseTo(1.5);
    expect(parseTimeInput('abc', 30)).toBeNull();
  });
});
