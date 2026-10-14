import { describe, expect, it } from 'vitest';
import { applyAIActions, formatResults } from './executor';
import { describeProject } from './describe';
import { findTrack, resolveClips } from './targets';
import { addMarker, addMediaToTimeline, clipEnd, createProject, getClip, tracksOfKind, updateClip } from '../model';
import { sourceSpan } from '../keyframes';
import type { MediaRef, Project } from '../types';

const beach: MediaRef = { id: 'm_beach', name: 'beach.mp4', kind: 'video', duration: 20, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true };
const logo: MediaRef = { id: 'm_logo', name: 'logo.png', kind: 'image', duration: 0, width: 400, height: 200, size: 1, mime: 'image/png', hasAudio: false };
const song: MediaRef = { id: 'm_song', name: 'song.mp3', kind: 'audio', duration: 60, width: 0, height: 0, size: 1, mime: 'audio/mpeg', hasAudio: true };

/** V1: beach 0–5 (+A1), gap, beach 8–12 (+A1). */
function project(): { p: Project; a: string; b: string } {
  let p: Project = { ...createProject(), media: [beach, logo, song] };
  const r1 = addMediaToTimeline(p, beach, { start: 0, duration: 5 });
  p = r1.project;
  const r2 = addMediaToTimeline(p, beach, { start: 8, duration: 4 });
  return { p: r2.project, a: r1.ids[0], b: r2.ids[0] };
}
const run = (p: Project, actions: unknown[], selection: string[] = []) => applyAIActions(p, actions, { playhead: 0, selection, fonts: ['Inter', 'Roboto'] });

describe('targets', () => {
  it('resolves ids, tracks, "all", "selected" and ranges, leaving locked tracks out', () => {
    const { p, a, b } = project();
    expect(resolveClips(p, { clips: 'V1' }).ids.sort()).toEqual([a, b].sort());
    expect(resolveClips(p, { clips: 'all' }).ids).toHaveLength(4);
    expect(resolveClips(p, { clips: 'selected' }, { selection: [b] }).ids).toEqual([b]);
    expect(resolveClips(p, { clips: { track: 'V1', from: 6 } }).ids).toEqual([b]);
    expect(resolveClips(p, { clipIds: [a, 'nope'] }).notes).toContain('unknown clip nope');
    const locked = { ...p, tracks: p.tracks.map((t) => (t.kind === 'video' ? { ...t, locked: true } : t)) };
    expect(() => resolveClips(locked, { clips: 'V1' })).toThrow(/locked/);
    expect(findTrack(p, 'a1')?.kind).toBe('audio');
    expect(findTrack(p, 2, 'video')).toBe(tracksOfKind(p, 'video')[1] ?? null);
  });
});

describe('results', () => {
  it('reports what happened to every action', () => {
    const { p, a } = project();
    const r = run(p, [{ type: 'setClip', clipId: a, props: { opacity: 0.5 } }, { type: 'explode' }, { type: 'setClip', clipId: 'c_missing', props: { opacity: 1 } }, { type: 'undo' }, { type: 'look', times: [1] }]);
    expect(r.applied).toBe(1);
    expect(r.results.map((x) => x.ok)).toEqual([true, false, false, false, false]);
    expect(r.results[1].detail).toContain('unsupported action "explode"');
    expect(r.results[2].detail).toContain('unknown clip c_missing');
    expect(r.results[3].detail).toContain('first action');
    expect(formatResults(r.results)).toMatch(/^1\. setClip: done — 1 clip\(s\): opacity\n2\. explode: SKIPPED/);
  });

  it('calls a no-op a skip, not a success', () => {
    const { p, a } = project();
    const r = run(p, [{ type: 'setClip', clipId: a, props: { opacity: 1 } }]);
    expect(r.applied).toBe(0);
    expect(r.results[0].detail).toContain('nothing changed');
  });
});

describe('media and arrangement', () => {
  it('adds bin media by id or name with a source range, and stills for the whole timeline', () => {
    const { p } = project();
    const r = run(p, [
      { type: 'addClip', media: 'm_beach', start: 12, sourceStart: 3, sourceEnd: 7 },
      { type: 'addClip', media: 'song.mp3', start: 0, track: 'A2', duration: 10 },
      { type: 'addClip', media: 'logo', track: 'V2', start: 0, duration: 'full' },
      { type: 'addClip', media: 'nothing' },
    ]);
    expect(r.applied).toBe(3);
    const added = r.project.clips.filter((c) => c.start === 12 && c.kind === 'video');
    expect(added).toHaveLength(1);
    expect([added[0].in, added[0].duration]).toEqual([3, 4]);
    expect(r.project.clips.find((c) => c.mediaId === 'm_song')).toMatchObject({ duration: 10, trackId: tracksOfKind(r.project, 'audio')[1].id });
    const still = r.project.clips.find((c) => c.mediaId === 'm_logo')!;
    expect(clipEnd(still)).toBeCloseTo(16);
    expect(r.results[3].detail).toContain('unknown media');
  });

  it('shifts clips without running into the ones that stay, and closes gaps', () => {
    const { p, a, b } = project();
    let r = run(p, [{ type: 'shift', from: 6, by: -10 }]);
    expect(getClip(r.project, b)!.start).toBeCloseTo(5);
    expect(r.results[0].detail).toContain('limited');
    r = run(p, [{ type: 'shift', clipIds: [a], by: 1 }]);
    expect(getClip(r.project, a)!.start).toBe(1);
    r = run(p, [{ type: 'closeGaps', track: 'V1' }]);
    expect(getClip(r.project, b)!.start).toBeCloseTo(5);
    expect(r.project.clips.filter((c) => c.kind === 'audio').map((c) => c.start).sort()).toEqual([0, 5]);
    expect(run(r.project, [{ type: 'closeGaps', track: 'V1' }]).results[0].ok).toBe(false);
  });

  it('removes a time range with or without ripple', () => {
    const { p, b } = project();
    let r = run(p, [{ type: 'removeRange', from: 2, to: 4 }]);
    expect(getClip(r.project, b)!.start).toBeCloseTo(6);
    r = run(p, [{ type: 'removeRange', from: 2, to: 4, ripple: false, tracks: ['V1'] }]);
    expect(getClip(r.project, b)!.start).toBe(8);
    expect(r.project.clips.filter((c) => c.kind === 'video')).toHaveLength(3);
  });

  it('deletes, duplicates, links and unlinks', () => {
    const { p, a, b } = project();
    expect(run(p, [{ type: 'delete', clips: 'V1' }]).project.clips).toHaveLength(0);
    const d = run(p, [{ type: 'duplicate', clipId: b, start: 20 }]);
    expect(d.project.clips.filter((c) => c.start === 20)).toHaveLength(2);
    const u = run(p, [{ type: 'unlink', clipId: a }]);
    expect(u.project.clips.filter((c) => c.linkId)).toHaveLength(2);
    const audioOfA = p.clips.find((c) => c.linkId === getClip(p, a)!.linkId && c.kind === 'audio')!;
    const l = run(u.project, [{ type: 'link', clipIds: [a, audioOfA.id] }]);
    expect(getClip(l.project, a)!.linkId).toBeTruthy();
  });
});

describe('properties', () => {
  it('sets crop, chroma key, volume and speed on many clips at once', () => {
    const { p, a, b } = project();
    const r = run(p, [{ type: 'setClip', clips: 'V1', props: { crop: { left: 0.1, top: 20 }, chromaKey: { color: '#0000ff', similarity: 0.5 }, volume: -6, speed: 2 } }]);
    for (const id of [a, b]) {
      const v = getClip(r.project, id)!.visual!;
      expect([v.cropLeft, v.cropTop, v.chromaKey, v.chromaColor, v.chromaSimilarity]).toEqual([0.1, 0.2, true, '#0000ff', 0.5]);
    }
    expect(getClip(r.project, a)!.duration).toBeCloseTo(2.5);
    expect(r.project.clips.filter((c) => c.kind === 'audio').every((c) => c.volume === -6)).toBe(true);
    expect(r.results[0].detail).toContain('length = source span ÷ speed');
  });

  it('restyles and moves an existing title', () => {
    const { p } = project();
    const t = run(p, [{ type: 'addTitle', text: 'Hello', start: 0, duration: 'full', style: 'basic' }]);
    const title = t.project.clips.find((c) => c.kind === 'title')!;
    expect(clipEnd(title)).toBeCloseTo(12);
    const r = run(t.project, [{ type: 'setClip', clipId: title.id, props: { color: '#ff0000', size: 40, position: 'lower-right', animation: 'pop', font: 'Comic Nope' } }]);
    const s = getClip(r.project, title.id)!.title!;
    expect([s.text, s.color, s.size, s.x, s.y, s.align, s.animation, s.font]).toEqual(['Hello', '#ff0000', 40, 0.93, 0.85, 'right', 'pop', 'Comic Nope']);
    expect(r.results[0].detail).toContain('not installed');
  });

  it('puts transitions between clips only', () => {
    const { p, a, b } = project();
    const moved = run(p, [{ type: 'closeGaps' }]).project;
    const r = run(moved, [{ type: 'addTransition', clips: 'V1', kind: 'dissolve', duration: 0.5 }]);
    expect(getClip(r.project, a)!.transition).toBeUndefined();
    expect(getClip(r.project, b)!.transition).toEqual({ kind: 'dissolve', duration: 0.5 });
    expect(r.results[0].detail).toContain('left alone');
    expect(run(p, [{ type: 'addTransition', clips: 'V1', kind: 'dissolve' }]).results[0].ok).toBe(false);
    expect(run(p, [{ type: 'addTransition', clipId: a, kind: 'swirl' }]).results[0].detail).toContain('unknown transition');
  });
});

describe('markers, tracks and the editor', () => {
  it('updates and deletes markers, also the ones after the end', () => {
    let { p } = project();
    const m1 = addMarker(p, 3, 'drop');
    p = addMarker(m1.project, 110, 'old').project;
    expect(describeProject(p, { playhead: 0, selection: [] })).toContain('"old" (after the end of the timeline)');
    let r = run(p, [{ type: 'updateMarker', id: m1.id, label: 'Drop!', time: 4 }, { type: 'deleteMarker', id: 'afterEnd' }]);
    expect(r.project.markers).toEqual([{ id: m1.id, time: 4, label: 'Drop!' }]);
    r = run(r.project, [{ type: 'deleteMarker', id: 'all' }]);
    expect(r.project.markers).toHaveLength(0);
  });

  it('adds, changes and deletes tracks with guards', () => {
    const { p } = project();
    let r = run(p, [{ type: 'addTrack', kind: 'audio', name: 'SFX' }, { type: 'setTrack', track: 'SFX', muted: true }]);
    const sfx = r.project.tracks.find((t) => t.name === 'SFX')!;
    expect(sfx.muted).toBe(true);
    expect(run(r.project, [{ type: 'deleteTrack', track: 'V1' }]).results[0].detail).toContain('withClips');
    r = run(r.project, [{ type: 'deleteTrack', track: 'SFX' }]);
    expect(r.project.tracks.some((t) => t.name === 'SFX')).toBe(false);
  });

  it('asks the editor to seek, select and open the export dialog', () => {
    const { p, b } = project();
    const r = run(p, [{ type: 'seek', time: 99 }, { type: 'select', clipId: b }, { type: 'export', format: 'social' }, { type: 'setWorkArea', start: 1, end: 4 }]);
    expect(r.effects).toEqual([{ kind: 'seek', time: 12 }, { kind: 'select', ids: [b] }, { kind: 'export', exportKind: 'social' }]);
    expect(r.project.workArea).toEqual({ start: 1, end: 4 });
  });
});

describe('motion and time', () => {
  const linkedAudio = (p: Project, id: string) => p.clips.find((c) => c.kind === 'audio' && c.linkId === getClip(p, id)!.linkId)!;

  it('sets keyframes in clip or timeline seconds, in setClip units, and on the sound of a video', () => {
    const { p, b } = project();
    let r = run(p, [
      { type: 'keyframes', clipId: b, prop: 'scale', keys: [{ at: 8, v: 100 }, { t: 1, v: 130, ease: 'easeOut' }, { t: 99, v: 1 }] },
      { type: 'keyframes', clipId: b, prop: 'volume', keys: [{ t: 0, v: 0 }, { t: 2, v: -20 }] },
      { type: 'keyframes', clipId: b, prop: 'wobble', keys: [] },
    ]);
    expect(getClip(r.project, b)!.keys!.scale).toEqual([
      { t: 0, v: 1, ease: 'easeInOut' },
      { t: 1, v: 1.3, ease: 'easeOut' },
      { t: 4, v: 1, ease: 'easeInOut' },
    ]);
    expect(linkedAudio(r.project, b).keys!.volume).toHaveLength(2);
    expect(r.results[2].detail).toContain('"prop" must be one of');
    // "replace": false keeps the other keys
    r = run(r.project, [{ type: 'keyframes', clipId: b, prop: 'scale', replace: false, keys: [{ t: 2, v: 2 }] }]);
    expect(getClip(r.project, b)!.keys!.scale!.map((k) => k.t)).toEqual([0, 1, 2, 4]);
  });

  it('clears keyframes, and setClip on a keyframed property replaces its keyframes', () => {
    const { p, a } = project();
    const keyed = run(p, [{ type: 'keyframes', clipId: a, prop: 'opacity', keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, { type: 'keyframes', clipId: a, prop: 'x', keys: [{ t: 0, v: 50 }] }]).project;
    let r = run(keyed, [{ type: 'setClip', clipId: a, props: { opacity: 1 } }]);
    expect(r.applied).toBe(1);
    expect(getClip(r.project, a)!.keys).toEqual({ x: [{ t: 0, v: 50, ease: 'easeInOut' }] });
    expect(r.results[0].detail).toContain('removed the opacity keyframes');
    r = run(keyed, [{ type: 'clearKeyframes', clipId: a }]);
    expect(getClip(r.project, a)!.keys).toBeUndefined();
  });

  it('ramps the speed of a clip and its sound, keeping its length', () => {
    const { p, a } = project();
    const r = run(p, [{ type: 'speedRamp', clipId: a, preset: 'hit' }]);
    const c = getClip(r.project, a)!;
    expect(c.duration).toBe(5);
    expect(c.speedKeys!.map((k) => k.v)).toEqual([2, 0.35, 0.35, 2]);
    expect(linkedAudio(r.project, a).speedKeys).toEqual(c.speedKeys);
    // near the end of the file the clip gets shorter instead of running out of source
    const late = updateClip(p, a, (x) => ({ ...x, in: 16 }));
    const short = run(late, [{ type: 'speedRamp', clipId: a, keys: [{ t: 0, v: 2 }, { t: 5, v: 2 }] }]);
    expect(getClip(short.project, a)!.duration).toBeCloseTo(2, 2);
    expect(short.results[0].detail).toContain('got shorter');
    expect(run(p, [{ type: 'speedRamp', clipId: a, preset: 'zigzag' }]).results[0].detail).toContain('unknown preset');
    expect(run(r.project, [{ type: 'clearKeyframes', clipId: a, prop: 'speed' }]).project.clips.every((x) => !x.speedKeys)).toBe(true);
  });

  it('keeps the content of a ramped clip and moves the clips after it', () => {
    const { p, a, b } = project();
    const r = run(p, [{ type: 'speedRamp', clipId: a, preset: 'fastSlowFast', keep: 'content' }]);
    const c = getClip(r.project, a)!;
    expect(sourceSpan(c)).toBeCloseTo(5, 2);
    expect(c.duration).toBeGreaterThan(7);
    expect(linkedAudio(r.project, a).duration).toBe(c.duration);
    expect(getClip(r.project, b)!.start).toBeCloseTo(8 + c.duration - 5, 6);
    expect(linkedAudio(r.project, b).start).toBeCloseTo(getClip(r.project, b)!.start, 6);
  });

  it('freezes a frame and pushes everything after it', () => {
    let { p, a, b } = project();
    p = addMarker(p, 9, 'later').project;
    const r = run(p, [{ type: 'freezeFrame', clipId: a, time: 2, duration: 1.5 }]);
    const still = r.project.clips.find((c) => c.freeze)!;
    expect([still.start, still.duration, still.in, still.kind]).toEqual([2, 1.5, 2, 'video']);
    expect(clipEnd(getClip(r.project, a)!)).toBe(2);
    const right = r.project.clips.filter((c) => c.kind === 'video' && c.start === 3.5);
    expect(right).toHaveLength(1);
    expect(getClip(r.project, b)!.start).toBe(9.5);
    expect(r.project.markers[0].time).toBe(10.5);
    expect(run(p, [{ type: 'freezeFrame', clipId: a, time: 7 }]).results[0].ok).toBe(false);
  });

  it('reverses a video with its sound and turns on smooth slow motion', () => {
    const { p, a } = project();
    const r = run(p, [{ type: 'setClip', clipId: a, props: { reverse: true, frameBlend: true } }]);
    expect([getClip(r.project, a)!.reverse, getClip(r.project, a)!.frameBlend, linkedAudio(r.project, a).reverse]).toEqual([true, true, true]);
    expect(r.results[0].detail).toContain('reverse, frameBlend');
  });

  it('describes keyframes, ramps, reversed and frozen clips', () => {
    const { p, a, b } = project();
    const r = run(p, [
      { type: 'keyframes', clipId: a, prop: 'scale', keys: [{ t: 0, v: 1, ease: 'linear' }, { t: 2, v: 1.3 }] },
      { type: 'speedRamp', clipId: b, preset: 'slowToFast' },
      { type: 'setClip', clipId: a, props: { reverse: true } },
      { type: 'freezeFrame', clipId: a, time: 4, duration: 1 },
    ]);
    const text = describeProject(r.project, { playhead: 0, selection: [] });
    expect(text).toContain('keyframes (clip seconds=value): scale 0=1 (linear) → 2=1.3');
    expect(text).toContain('speed ramp (clip seconds=speed) 0=0.35 (easeIn) → 4=2');
    expect(text).toMatch(/source 1\.00–5\.00 s of 20\.00 s \(played backwards\) \(end can extend 1\.00 s\)/);
    expect(text).toContain('holds the frame at source 1.00 s');
    expect(text).toContain('freeze frame (still)');
  });
});

describe('effects, color and compositing', () => {
  it('sets effects (percentages and ratios too), blend modes and masks', () => {
    const { p, a } = project();
    const r = run(p, [{ type: 'setClip', clipId: a, props: { glow: 50, shake: 30, letterbox: '2.39:1', blendMode: 'color-dodge', mask: { shape: 'ellipse', x: 50, w: 40, feather: 10 }, zoomBlur: 0.4 } }]);
    const c = getClip(r.project, a)!;
    expect([c.visual!.glow, c.visual!.shake, c.visual!.zoomBlur, c.blend]).toEqual([0.5, 30, 0.4, 'colorDodge']);
    expect(c.visual!.letterbox).toBeCloseTo((1 - 16 / 9 / 2.39) / 2, 4);
    expect(c.mask).toMatchObject({ shape: 'ellipse', x: 0.5, w: 0.4, feather: 0.1 });
    const removed = run(r.project, [{ type: 'setClip', clipId: a, props: { mask: 'none', blendMode: 'normal' } }]);
    expect([getClip(removed.project, a)!.mask, getClip(removed.project, a)!.blend]).toEqual([undefined, undefined]);
    expect(run(p, [{ type: 'setClip', clipId: a, props: { blendMode: 'sparkle' } }]).results[0].detail).toContain('unknown blend mode sparkle');
  });

  it('grades with looks by name, curves and HSL that merge', () => {
    const { p, a } = project();
    let r = run(p, [{ type: 'setClip', clipId: a, props: { look: 'Teal & orange', lookAmount: 70, curves: { master: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] }, hsl: { blue: { s: 30 } } } }]);
    expect(getClip(r.project, a)!.grade).toEqual({ look: 'tealOrange', lookAmount: 0.7, lutAmount: 1, curves: { master: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] }, hsl: { blue: { h: 0, s: 30, l: 0 } } });
    r = run(r.project, [{ type: 'setClip', clipId: a, props: { hsl: { blue: { l: -10 }, orange: { h: 5 } }, look: 'none' } }]);
    const g = getClip(r.project, a)!.grade!;
    expect([g.look, g.hsl]).toEqual([undefined, { blue: { h: 0, s: 30, l: -10 }, orange: { h: 5, s: 0, l: 0 } }]);
    const bad = run(p, [{ type: 'setClip', clipId: a, props: { look: 'rainbow', lut: 'film' } }]);
    expect(bad.results[0].detail).toMatch(/unknown look rainbow.*unknown LUT film/);
  });

  it('animates effect amounts and adds out-animations', () => {
    const { p, a, b } = project();
    const r = run(p, [
      { type: 'keyframes', clipId: a, prop: 'zoomBlur', keys: [{ t: 0, v: 80 }, { t: 0.2, v: 0 }] },
      { type: 'addTransition', clips: 'V1', kind: 'whipLeft', duration: 0.4, position: 'out' },
    ]);
    expect(getClip(r.project, a)!.keys!.zoomBlur!.map((k) => k.v)).toEqual([0.8, 0]);
    expect([getClip(r.project, a)!.transitionOut, getClip(r.project, b)!.transitionOut]).toEqual([{ kind: 'whipLeft', duration: 0.4 }, { kind: 'whipLeft', duration: 0.4 }]);
    expect(r.results[1].detail).toContain('whipLeft out of 2 clip(s)');
  });

  it('adds adjustment layers above the pictures they change', () => {
    const { p } = project();
    const withTitle = run(p, [{ type: 'addTitle', text: 'Hi', start: 0, duration: 3 }]).project;
    const r = run(withTitle, [{ type: 'addAdjustment', start: 0, duration: 'full', name: 'Grade', props: { look: 'cinematic', shake: 10 } }]);
    const adj = r.project.clips.find((c) => c.kind === 'adjustment')!;
    const order = tracksOfKind(r.project, 'video').map((t) => t.id);
    const titleTrack = r.project.clips.find((c) => c.kind === 'title')!.trackId;
    expect(order.indexOf(adj.trackId)).toBeGreaterThan(order.indexOf(titleTrack));
    expect([adj.name, adj.grade?.look, adj.visual?.shake, clipEnd(adj)]).toEqual(['Grade', 'cinematic', 10, 12]);
    expect(r.results[0].detail).toContain('it changes tracks V1–V');
    const text = describeProject(r.project, { playhead: 0, selection: [] });
    expect(text).toContain('adjustment "Grade" (changes the tracks below it)');
    expect(text).toContain('shake 10, look cinematic');
  });
});

describe('summary', () => {
  it('lists analysis in timeline seconds for the part of the source that is used', () => {
    const { p, a } = project();
    // clip a uses source 0–5 s from timeline 0; move the in-point to 2 s at 2× speed
    const q = { ...p, clips: p.clips.map((c) => (c.id === a ? { ...c, in: 2, speed: 2, duration: 2.5 } : c)) };
    const analysis = () => ({
      audio: { duration: 20, beats: { bpm: 120, period: 0.5, beats: [1, 2.5, 3, 3.5, 6.9, 7.5], downbeats: [3], confidence: 0.8 }, hits: [3], loud: [{ time: 4, db: -3, prominence: 20 }], bursts: [], rises: [] },
      scenes: { cuts: [5], busiest: [] },
      analysedSeconds: 20,
    });
    const text = describeProject(q, { playhead: 0, selection: [], analysis });
    const line = text.split('\n').find((l) => l.startsWith(`- ${a} video`))!;
    expect(line).toContain('≈240 BPM (a beat every 0.250 s');
    expect(line).toContain('beats: 0.25, 0.50, 0.75, 2.45');
    expect(line).toContain('loud moments: 1.00 (+20 dB)');
    expect(line).toContain('scene changes: 1.50');
  });

  it('lists media ids, how far clips can grow and the fonts', () => {
    const { p, a } = project();
    const text = describeProject(p, { playhead: 0, selection: [], fonts: ['Inter', 'Roboto'] });
    expect(text).toContain('- m_beach | video "beach.mp4" 1920×1080, 20.0 s, with sound | on the timeline 2×');
    expect(text).toContain(`${a} | video "beach.mp4" | V1 | 0.00–5.00 s | media m_beach, source 0.00–5.00 s of 20.00 s (end can extend 15.00 s)`);
    expect(text).toContain('Fonts for titles: Inter, Roboto.');
  });
});
