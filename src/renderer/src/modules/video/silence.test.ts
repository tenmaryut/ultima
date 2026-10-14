import { describe, expect, it } from 'vitest';
import { detectSilences, invertRanges, rmsDb, totalLength } from './silence';
import { timeStretch } from './stretch';

const RATE = 8000;

function tone(seconds: number, amp = 0.5, freq = 440): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE);
  return out;
}
function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const silence = (s: number) => new Float32Array(Math.round(s * RATE));

describe('silence detection', () => {
  it('measures RMS in dBFS', () => {
    const db = rmsDb(tone(0.1, 1), RATE, 0.02);
    expect(db[1]).toBeCloseTo(-3.01, 1);
    expect(rmsDb(silence(0.1), RATE)[0]).toBe(-120);
  });

  it('finds a silent gap between two sounds with padding', () => {
    const samples = concat(tone(1), silence(1), tone(1));
    const ranges = detectSilences(samples, RATE, { thresholdDb: -40, minDuration: 0.5, padding: 0.1 });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeCloseTo(1.1, 1);
    expect(ranges[0].end).toBeCloseTo(1.9, 1);
  });

  it('ignores short pauses and quiet-but-audible parts', () => {
    const samples = concat(tone(1), silence(0.3), tone(1), tone(1, 0.05));
    expect(detectSilences(samples, RATE, { minDuration: 0.5 })).toHaveLength(0);
  });

  it('keeps leading/trailing silence up to the edges and applies an offset', () => {
    const samples = concat(silence(1), tone(1), silence(1));
    const ranges = detectSilences(samples, RATE, { minDuration: 0.5, padding: 0.1 }, 10);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBe(10);
    expect(ranges[0].end).toBeCloseTo(10.9, 1);
    expect(ranges[1].start).toBeCloseTo(12.1, 1);
    expect(ranges[1].end).toBeCloseTo(13, 5);
    expect(totalLength(ranges)).toBeCloseTo(1.8, 1);
  });

  it('inverts ranges', () => {
    expect(invertRanges([{ start: 1, end: 2 }, { start: 4, end: 5 }], 6)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 4 },
      { start: 5, end: 6 },
    ]);
  });
});

function zeroCrossRate(x: Float32Array): number {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] < 0)) n++;
  return n / 2 / (x.length / RATE);
}

describe('time stretch (keep pitch)', () => {
  it('halves the duration at 2x and keeps the frequency', () => {
    const input = tone(2, 0.5, 300);
    const [out] = timeStretch([input], 2, RATE);
    expect(out.length).toBe(Math.round(input.length / 2));
    const mid = out.subarray(Math.round(out.length * 0.2), Math.round(out.length * 0.8));
    expect(zeroCrossRate(mid)).toBeGreaterThan(280);
    expect(zeroCrossRate(mid)).toBeLessThan(320);
  });

  it('doubles the duration at 0.5x for every channel', () => {
    const input = tone(1, 0.5, 250);
    const out = timeStretch([input, input], 0.5, RATE);
    expect(out).toHaveLength(2);
    expect(out[0].length).toBe(input.length * 2);
    const mid = out[1].subarray(Math.round(out[1].length * 0.2), Math.round(out[1].length * 0.8));
    expect(zeroCrossRate(mid)).toBeGreaterThan(230);
    expect(zeroCrossRate(mid)).toBeLessThan(270);
  });

  it('returns copies for rate 1', () => {
    const input = tone(0.1);
    const [out] = timeStretch([input], 1, RATE);
    expect(out).not.toBe(input);
    expect(Array.from(out)).toEqual(Array.from(input));
  });
});
