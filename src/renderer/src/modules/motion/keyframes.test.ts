import { describe, expect, it } from 'vitest';
import {
  adjacentTime,
  clearKeysBetween,
  evaluateProp,
  lerpValue,
  moveKeyframes,
  removeKeyframes,
  setEasing,
  setKeyframe,
  setValueAt,
  toggleStopwatch,
} from './keyframes';
import type { AnimProp, Vec2 } from './types';

const num = (value: number): AnimProp<number> => ({ value, keyframes: [] });

function animated(): AnimProp<number> {
  let p = num(0);
  p = setKeyframe(p, 0, 0, { easing: 'linear' });
  p = setKeyframe(p, 2, 100, { easing: 'linear' });
  return p;
}

describe('evaluateProp', () => {
  it('returns the static value when not animated', () => {
    expect(evaluateProp(num(42), 3)).toBe(42);
  });

  it('interpolates linearly between keyframes and clamps outside', () => {
    const p = animated();
    expect(evaluateProp(p, -1)).toBe(0);
    expect(evaluateProp(p, 0)).toBe(0);
    expect(evaluateProp(p, 0.5)).toBeCloseTo(25);
    expect(evaluateProp(p, 1)).toBeCloseTo(50);
    expect(evaluateProp(p, 2)).toBe(100);
    expect(evaluateProp(p, 10)).toBe(100);
  });

  it('applies the easing of the outgoing keyframe', () => {
    let p = num(0);
    p = setKeyframe(p, 0, 0, { easing: 'easeIn' });
    p = setKeyframe(p, 1, 100, { easing: 'linear' });
    expect(evaluateProp(p, 0.5)).toBeLessThan(50);
    p = setEasing(p, new Set([p.keyframes[0].id]), 'easeOut');
    expect(evaluateProp(p, 0.5)).toBeGreaterThan(50);
  });

  it('holds values', () => {
    let p = num(0);
    p = setKeyframe(p, 0, 10, { easing: 'hold' });
    p = setKeyframe(p, 1, 20, { easing: 'hold' });
    expect(evaluateProp(p, 0.999)).toBe(10);
    expect(evaluateProp(p, 1)).toBe(20);
  });

  it('handles three or more keyframes (binary search)', () => {
    let p = num(0);
    for (let i = 0; i <= 10; i++) p = setKeyframe(p, i, i * i, { easing: 'linear' });
    expect(evaluateProp(p, 3.5)).toBeCloseTo((9 + 16) / 2);
    expect(evaluateProp(p, 9.25)).toBeCloseTo(81 + 0.25 * 19);
  });

  it('interpolates vectors and colors', () => {
    let p: AnimProp<Vec2> = { value: [0, 0], keyframes: [] };
    p = setKeyframe(p, 0, [0, 100], { easing: 'linear' });
    p = setKeyframe(p, 1, [100, 0], { easing: 'linear' });
    expect(evaluateProp(p, 0.25)).toEqual([25, 75]);

    let c: AnimProp<string> = { value: '#000000', keyframes: [] };
    c = setKeyframe(c, 0, '#000000', { easing: 'linear' });
    c = setKeyframe(c, 1, '#ffffff', { easing: 'linear' });
    expect(evaluateProp(c, 0.5)).toBe('#808080');
    expect(lerpValue('rgba(255, 0, 0, 0)', '#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('does not overshoot colors with back easing', () => {
    expect(lerpValue('#000000', '#ffffff', 1.2)).toBe('#ffffff');
    expect(lerpValue('#000000', '#ffffff', -0.2)).toBe('#000000');
  });
});

describe('keyframe editing', () => {
  it('setKeyframe replaces a key at the same time and keeps order', () => {
    let p = animated();
    p = setKeyframe(p, 1, 7);
    expect(p.keyframes.map((k) => k.time)).toEqual([0, 1, 2]);
    p = setKeyframe(p, 1, 9);
    expect(p.keyframes).toHaveLength(3);
    expect(evaluateProp(p, 1)).toBe(9);
  });

  it('new keyframes inherit the previous easing', () => {
    let p = num(0);
    p = setKeyframe(p, 0, 0, { easing: 'bounce' });
    p = setKeyframe(p, 1, 5);
    expect(p.keyframes[1].easing).toBe('bounce');
  });

  it('setValueAt changes the static value or creates a key', () => {
    expect(setValueAt(num(1), 3, 5)).toEqual({ value: 5, keyframes: [] });
    const p = setValueAt(animated(), 1.5, 3);
    expect(p.keyframes).toHaveLength(3);
    expect(evaluateProp(p, 1.5)).toBe(3);
  });

  it('stopwatch on/off', () => {
    const on = toggleStopwatch(num(30), 2);
    expect(on.keyframes).toHaveLength(1);
    expect(on.keyframes[0]).toMatchObject({ time: 2, value: 30 });
    const off = toggleStopwatch(animated(), 1);
    expect(off.keyframes).toHaveLength(0);
    expect(off.value).toBeCloseTo(50);
  });

  it('removing all keyframes freezes the current value', () => {
    const p = animated();
    const ids = new Set(p.keyframes.map((k) => k.id));
    const r = removeKeyframes(p, ids, 0.5);
    expect(r.keyframes).toHaveLength(0);
    expect(r.value).toBeCloseTo(25);
    expect(removeKeyframes(p, new Set(['nope']), 0)).toBe(p);
  });

  it('moves keys with clamping and replaces keys it lands on', () => {
    const p = animated();
    const first = p.keyframes[0].id;
    const moved = moveKeyframes(p, new Set([first]), 0.5, { min: 0, max: 5 });
    expect(moved.keyframes.map((k) => k.time)).toEqual([0.5, 2]);
    const clamped = moveKeyframes(p, new Set([first]), -3, { min: 0, max: 5 });
    expect(clamped.keyframes[0].time).toBe(0);
    const onto = moveKeyframes(p, new Set([first]), 2, { min: 0, max: 5 });
    expect(onto.keyframes).toHaveLength(1);
    expect(onto.keyframes[0].id).toBe(first);
  });

  it('clearKeysBetween keeps the boundary keys', () => {
    let p = num(0);
    for (const t of [0, 0.5, 1, 1.5, 2]) p = setKeyframe(p, t, t);
    expect(clearKeysBetween(p, 0.5, 1.5).keyframes.map((k) => k.time)).toEqual([0, 0.5, 1.5, 2]);
  });

  it('adjacentTime finds previous / next times', () => {
    const times = [0, 1, 2.5];
    expect(adjacentTime(times, 1, 1)).toBe(2.5);
    expect(adjacentTime(times, 1, -1)).toBe(0);
    expect(adjacentTime(times, 2.5, 1)).toBeNull();
    expect(adjacentTime(times, 0.2, -1)).toBe(0);
  });
});
