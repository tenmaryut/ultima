import { describe, expect, it } from 'vitest';
import {
  animatedVisual,
  animatedVolume,
  ease,
  keyTimes,
  keyValue,
  rampPreset,
  removeKeyAt,
  setEaseAt,
  setValueAt,
  shiftKeys,
  sourceAt,
  sourceOffset,
  sourceSpan,
  speedAt,
  timeOfSource,
  toggleKeyAt,
  upsertKey,
} from './keyframes';
import { addMediaToTimeline, createProject, freezeFrameAt, getClip, setClipSpeed, splitAt, sourceOut, trimClip, updateClip } from './model';
import { parseProject, serializeProject } from './project';
import { remapPcm } from './mix';
import type { Clip, Keyframe, MediaRef, Project } from './types';

const k = (t: number, v: number, e: Keyframe['ease'] = 'linear'): Keyframe => ({ t, v, ease: e });
const media: MediaRef = { id: 'm1', name: 'a.mp4', kind: 'video', duration: 30, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true };

function clipProject(patch: Partial<Clip> = {}): { p: Project; id: string } {
  const r = addMediaToTimeline({ ...createProject(), media: [media] }, media, { start: 2, duration: 4 });
  const id = r.ids[0];
  return { p: updateClip(r.project, id, (c) => ({ ...c, in: 5, ...patch })), id };
}

describe('keyframe values', () => {
  it('interpolates with easing and holds outside the keys', () => {
    const keys = [k(1, 0), k(3, 100, 'easeIn'), k(5, 0, 'hold'), k(6, 50)];
    expect(keyValue(keys, 0, 7)).toBe(0);
    expect(keyValue(keys, 2, 7)).toBe(50);
    expect(keyValue(keys, 4, 7)).toBeCloseTo(100 - 100 * ease('easeIn', 0.5));
    expect(keyValue(keys, 5.5, 7)).toBe(0);
    expect(keyValue(keys, 9, 7)).toBe(50);
    expect(keyValue(undefined, 9, 7)).toBe(7);
    expect([ease('easeOut', 0), ease('easeInOut', 0.5), ease('easeInOut', 1)]).toEqual([0, 0.5, 1]);
  });

  it('adds, replaces and removes keyframes', () => {
    let keys = upsertKey(undefined, 2, 1);
    keys = upsertKey(keys, 1, 0, 'easeOut');
    keys = upsertKey(keys, 2.004, 5);
    expect(keys).toEqual([k(1, 0, 'easeOut'), { t: 2.004, v: 5, ease: 'easeInOut' }]);
    expect(removeKeyAt(keys, 1)).toHaveLength(1);
  });

  it('keeps the values at the new edges when keys are shifted out', () => {
    const keys = [k(0, 0), k(4, 100)];
    expect(shiftKeys(keys, -1, 3)).toEqual([k(0, 25), k(3, 100)]);
    expect(shiftKeys(keys, 0, 2)).toEqual([k(0, 0), k(2, 50)]);
  });

  it('animates visual props and volume', () => {
    const c = { visual: { opacity: 1, scale: 1 }, volume: -3, keys: { scale: [k(0, 1), k(2, 2)], volume: [k(0, -20), k(1, 0)] } } as unknown as Clip;
    expect(animatedVisual(c, 1).scale).toBe(1.5);
    expect(animatedVisual(c, 1).opacity).toBe(1);
    expect(animatedVolume(c, 0.5)).toBe(-10);
  });
});

describe('editing in the inspector', () => {
  it('auto-keys animated properties and changes plain ones', () => {
    const { p, id } = clipProject();
    let c = getClip(p, id)!;
    c = setValueAt(c, 'scale', 1, 2);
    expect([c.visual!.scale, c.keys]).toEqual([2, undefined]);
    c = toggleKeyAt(c, 'scale', 0);
    c = setValueAt(c, 'scale', 3, 1);
    expect(c.keys!.scale!.map((x) => [x.t, x.v])).toEqual([[0, 2], [3, 1]]);
    expect(c.visual!.scale).toBe(2);
    c = setEaseAt(c, 0, 'hold');
    expect(c.keys!.scale![0].ease).toBe('hold');
    expect(keyTimes(toggleKeyAt(c, 'opacity', 3))).toEqual([0, 3]);
  });

  it('keeps the value of the last keyframe when it is removed', () => {
    const { p, id } = clipProject();
    let c = toggleKeyAt(setValueAt(getClip(p, id)!, 'volume', 0, -6), 'volume', 2);
    c = setValueAt(c, 'volume', 2, -12);
    c = toggleKeyAt(c, 'volume', 2);
    expect([c.keys, c.volume]).toEqual([undefined, -12]);
  });
});

describe('time mapping', () => {
  it('integrates speed ramps', () => {
    const c = { in: 0, speed: 1, duration: 2, speedKeys: [k(0, 1), k(2, 3)] } as Clip;
    expect(sourceOffset(c, 2)).toBeCloseTo(4, 2);
    expect(sourceSpan(c)).toBeCloseTo(4, 2);
    expect(speedAt(c, 1)).toBe(2);
    expect(sourceOffset({ ...c, speedKeys: undefined, speed: 2 } as Clip, 1.5)).toBe(3);
  });

  it('plays reversed and frozen clips', () => {
    const c = { in: 2, speed: 1, duration: 3 } as Clip;
    expect([sourceAt({ ...c, reverse: true }, 0), sourceAt({ ...c, reverse: true }, 3)]).toEqual([5, 2]);
    expect(sourceAt({ ...c, freeze: true }, 2)).toBe(2);
    expect(speedAt({ ...c, freeze: true }, 1)).toBe(0);
  });

  it('finds when a source moment is shown, through ramps and reverse', () => {
    const c = { start: 10, in: 2, speed: 1, duration: 2, speedKeys: [k(0, 1), k(2, 3)] } as Clip;
    expect(timeOfSource(c, 2 + sourceOffset(c, 1.5))).toBeCloseTo(11.5, 4);
    expect(timeOfSource(c, 1)).toBeNull();
    const r = { start: 10, in: 2, speed: 2, duration: 2, reverse: true } as Clip;
    expect([timeOfSource(r, 6), timeOfSource(r, 2), timeOfSource(r, 5)]).toEqual([10, 12, 10.5]);
    expect(timeOfSource({ ...r, freeze: true }, 2)).toBeNull();
  });

  it('builds ramp presets that start and end where expected', () => {
    const hit = rampPreset('hit', 2);
    expect(hit[0]).toEqual(k(0, 2, 'easeInOut'));
    expect(hit[hit.length - 1].t).toBe(2);
    expect(rampPreset('slowToFast', 1)).toEqual([k(0, 0.35, 'easeIn'), k(1, 2)]);
  });
});

describe('editing keeps keyframes and ramps right', () => {
  it('trims and splits keyed clips without jumps', () => {
    const { p, id } = clipProject({ keys: { opacity: [k(0, 0), k(4, 1)] } });
    const trimmed = trimClip(p, id, 'start', 3);
    expect(getClip(trimmed, id)!.keys!.opacity).toEqual([k(0, 0.25), k(3, 1)]);
    const r = splitAt(p, 4, [id]);
    const left = getClip(r.project, id)!;
    const right = r.project.clips.find((c) => c.id === r.created.find((x) => getClip(r.project, x)?.kind === 'video'))!;
    expect(left.keys!.opacity).toEqual([k(0, 0), k(2, 0.5)]);
    expect(right.keys!.opacity).toEqual([k(0, 0.5), k(2, 1)]);
  });

  it('keeps eased curves and ramps continuous across a split', () => {
    const { p, id } = clipProject({ keys: { scale: [k(0, 1, 'easeOut'), k(4, 2)] }, speedKeys: rampPreset('hit', 4) });
    const before = getClip(p, id)!;
    const r = splitAt(p, 3, [id]);
    const left = getClip(r.project, id)!;
    const right = r.project.clips.find((c) => c.id === r.created.find((x) => getClip(r.project, x)?.kind === 'video'))!;
    for (const t of [2.2, 2.5, 2.9]) expect(animatedVisual(left, t - left.start).scale).toBeCloseTo(animatedVisual(before, t - before.start).scale, 2);
    for (const t of [3.1, 3.5, 5.9]) expect(animatedVisual(right, t - right.start).scale).toBeCloseTo(animatedVisual(before, t - before.start).scale, 2);
    // the left part ends on the frame the right part starts with
    expect(Math.abs(sourceOut(left) - right.in)).toBeLessThan(0.005);
    expect(sourceOut(right)).toBeCloseTo(sourceOut(before), 2);
  });

  it('moves the in-point by the ramped source when trimming the start', () => {
    const { p, id } = clipProject({ speedKeys: [k(0, 1), k(4, 1)] , speed: 1 });
    const ramp = updateClip(p, id, (c) => ({ ...c, speedKeys: [k(0, 2), k(4, 2)] }));
    const t = getClip(trimClip(ramp, id, 'start', 3), id)!;
    expect(t.in).toBeCloseTo(7, 2);
  });

  it('trims reversed clips from the right end of the source', () => {
    const { p, id } = clipProject({ reverse: true });
    const a = getClip(trimClip(p, id, 'start', 3), id)!;
    expect([a.in, sourceOut(a)]).toEqual([5, 8]);
    const b = getClip(trimClip(p, id, 'end', 5), id)!;
    expect([b.in, sourceOut(b)]).toEqual([6, 9]);
  });

  it('replaces a ramp with a constant speed and stretches keyframes', () => {
    const { p, id } = clipProject({ speedKeys: [k(0, 1), k(4, 1)], keys: { scale: [k(0, 1), k(4, 2)] } });
    const c = getClip(setClipSpeed(p, id, 2), id)!;
    expect([c.speed, +c.duration.toFixed(6), c.speedKeys]).toEqual([2, 2, undefined]);
    expect(c.keys!.scale!.map((x) => [+x.t.toFixed(6), x.v])).toEqual([[0, 1], [2, 2]]);
  });
});

describe('freeze frames', () => {
  it('holds the animated frame of the moment and makes room for it', () => {
    const { p, id } = clipProject({ keys: { scale: [k(0, 1), k(4, 2)] } });
    const r = freezeFrameAt(p, id, 4, 2);
    const still = getClip(r.project, r.id!)!;
    expect([still.start, still.duration, still.in, still.freeze, still.visual!.scale]).toEqual([4, 2, 7, true, 1.5]);
    const after = r.project.clips.filter((c) => c.kind === 'video' && c.start === 6);
    expect(after).toHaveLength(1);
    expect(after[0].in).toBe(7);
    expect(freezeFrameAt(p, id, 1, 2).id).toBeNull();
  });
});

describe('project files', () => {
  it('keeps keyframes, ramps and flags, and drops nonsense', () => {
    const { p, id } = clipProject({ keys: { scale: [k(0, 1), k(1, 99)], volume: [k(0, -5)] }, speedKeys: [k(0, 9), k(1, 1, 'easeIn')], reverse: true, frameBlend: true });
    const raw = JSON.parse(serializeProject(p));
    raw.clips.find((c: Clip) => c.id === id).keys.bogus = [k(0, 1)];
    const back = getClip(parseProject(raw), id)!;
    expect(back.keys).toEqual({ scale: [k(0, 1), k(1, 10)] });
    expect(back.speedKeys).toEqual([k(0, 4), k(1, 1, 'easeIn')]);
    expect([back.reverse, back.freeze, back.frameBlend]).toEqual([true, undefined, true]);
  });
});

describe('remapped audio', () => {
  it('reads the source backwards for reversed clips', () => {
    const sr = 10;
    const src = { sampleRate: sr, channels: [Float32Array.from({ length: 30 }, (_, i) => i)] };
    const clip = { start: 0, in: 0, duration: 3, speed: 1, reverse: true } as Clip;
    const out = remapPcm(clip, src, 0, 0, 1);
    expect(out.channels[0][1]).toBeCloseTo(29);
    expect(out.channels[0][5]).toBeCloseTo(25);
    expect(out.channels[0]).toHaveLength(10);
  });
});
