import { describe, expect, it } from 'vitest';
import { addMotionTrack, findMotionTrack, followTrack, frameToSource, removeMotionTrack, simplifyKeys, sourceToFrame, trackAtSource, trackPointAt, trackSpan, trackSureness } from './tracking';
import { applyAIActions } from './ai/executor';
import { describeProject } from './ai/describe';
import { addMediaToTimeline, createProject, getClip, updateClip } from './model';
import { parseProject, serializeProject } from './project';
import { valueAt } from './keyframes';
import type { MediaRef, MotionTrack, Project } from './types';

const game: MediaRef = { id: 'm_game', name: 'clutch.mp4', kind: 'video', duration: 20, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: false, fps: 30 };

/** A 1920×1080 project with the gameplay at 1–7 s on V1, from 2 s into the file. */
function project(): { p: Project; v: string } {
  let p: Project = { ...createProject(), media: [game] };
  p = { ...p, settings: { ...p.settings, width: 1920, height: 1080, fps: 30 } };
  const r = addMediaToTimeline(p, game, { start: 1, duration: 6 });
  return { p: updateClip(r.project, r.ids[0], (c) => ({ ...c, in: 2 })), v: r.ids[0] };
}

/** The target walks right across the picture between 2 and 8 s of the file; lost around 5 s. */
const walk: Pick<MotionTrack, 'points' | 'w' | 'h'> = {
  points: Array.from({ length: 61 }, (_, i) => ({ t: 2 + i * 0.1, x: 0.2 + i * 0.01, y: 0.5, s: Math.abs(2 + i * 0.1 - 5) < 0.15 ? 0 : 0.95 })),
  w: 0.05,
  h: 0.1,
};

describe('placing tracked points', () => {
  it('maps the source picture to the frame through zoom, position and rotation, and back', () => {
    const { p, v } = project();
    const moved = updateClip(p, v, (c) => ({ ...c, visual: { ...c.visual!, scale: 1.5, x: 100, y: -40, rotation: 30 } }));
    const c = getClip(moved, v)!;
    expect(sourceToFrame(p, getClip(p, v)!, 0, 0.5, 0.5)).toEqual({ x: 960, y: 540 });
    expect(sourceToFrame(p, getClip(p, v)!, 0, 0, 0)).toEqual({ x: 0, y: 0 });
    const f = sourceToFrame(moved, c, 0, 0.3, 0.7)!;
    const back = frameToSource(moved, c, 0, f.x, f.y)!;
    expect(back.u).toBeCloseTo(0.3, 9);
    expect(back.v).toBeCloseTo(0.7, 9);
  });

  it('reads a track between its points, in source time, where the clip shows it', () => {
    const { p, v } = project();
    const { project: q, track } = addMotionTrack(p, v, walk);
    expect(trackAtSource(track, 2.05)).toMatchObject({ x: 0.205, y: 0.5 });
    expect(trackAtSource(track, 1.9)).toBeNull();
    const c = getClip(q, v)!;
    // timeline 2 s = 1 s into the clip = 3 s into the file: x 0.30 of 1920
    const here = trackPointAt(q, c, track, 2)!;
    expect(here.x).toBeCloseTo(576, 6);
    expect(here).toMatchObject({ y: 540, sure: 0.95 });
    expect(trackPointAt(q, c, track, 0.5)).toBeNull();
    expect(trackSpan(c, track)).toEqual({ start: 1, end: 7 });
    // twice as fast: the same 6 s of the file in 3 s
    const fast = updateClip(q, v, (x) => ({ ...x, speed: 2, duration: 3 }));
    expect(trackSpan(getClip(fast, v)!, track)).toEqual({ start: 1, end: 4 });
    expect(trackSureness(track)).toBeCloseTo(58 / 61, 5);
    expect(findMotionTrack(c)?.id).toBe(track.id);
    expect(removeMotionTrack(q, v, track.id).clips.find((x) => x.id === v)!.tracks).toBeUndefined();
  });
});

describe('following a track', () => {
  it('pins a sticker on the target and a label above it, holding still where the target was lost', () => {
    const { p, v } = project();
    let q = addMotionTrack(p, v, walk).project;
    const added = applyAIActions(q, [{ type: 'addGraphic', graphic: 'crosshair', start: 1, duration: 6 }, { type: 'addTitle', text: 'ENEMY', start: 1, duration: 6 }], { playhead: 0 });
    q = added.project;
    const [cross, label] = q.clips.filter((c) => c.kind === 'image' || c.kind === 'title').map((c) => c.id);
    const r = followTrack(q, v, undefined, [cross], { mode: 'center' });
    expect(r.followers).toEqual([cross]);
    const at = (id: string, t: number) => {
      const c = getClip(r.project, id)!;
      return { x: 960 + valueAt(c, 'x', t - c.start), y: 540 + valueAt(c, 'y', t - c.start) };
    };
    for (const t of [1, 2.5, 4, 6.5]) {
      const want = trackPointAt(r.project, getClip(r.project, v)!, getClip(r.project, v)!.tracks![0], t)!;
      expect(Math.hypot(at(cross, t).x - want.x, at(cross, t).y - want.y)).toBeLessThan(0.5);
    }
    // a straight walk needs only a few keyframes
    expect(getClip(r.project, cross)!.keys!.x!.length).toBeLessThan(6);
    // the title's anchor sits 80 px above the target
    const titled = followTrack(q, v, undefined, [label], { mode: 'center', shift: { x: 0, y: -80 } });
    const tc = getClip(titled.project, label)!;
    const anchorY = 540 + valueAt(tc, 'y', 2) + (tc.title!.y - 0.5) * 1080;
    expect(anchorY).toBeCloseTo(540 - 80, 0);
  });

  it('keeps a follower where it is relative to the target, and says what could not follow', () => {
    const { p, v } = project();
    let q = addMotionTrack(p, v, walk).project;
    q = applyAIActions(q, [{ type: 'addGraphic', graphic: 'circle', start: 3, duration: 2, position: { x: 0.5, y: 0.25 } }], { playhead: 0 }).project;
    const circle = q.clips.find((c) => c.kind === 'image')!.id;
    const before = getClip(q, circle)!.visual!;
    const r = followTrack(q, v, undefined, [circle, 'c_nope', v], { mode: 'offset', at: 3 });
    expect(r.followers).toEqual([circle]);
    expect(r.problem).toContain('c_nope (unknown)');
    const c = getClip(r.project, circle)!;
    // at 3 s it is where it was; one second later the target moved 0.1 of 1920 px to the right, and so did the circle
    expect(valueAt(c, 'x', 0)).toBeCloseTo(before.x, 0);
    expect(valueAt(c, 'x', 1) - valueAt(c, 'x', 0)).toBeCloseTo(192, 0);
    expect(followTrack(q, v, 'tk_nope', [circle], { mode: 'center' }).problem).toContain('has no track tk_nope');
    expect(followTrack(p, v, undefined, [circle], { mode: 'center' }).problem).toContain('no motion track yet');
  });

  it('simplifies a path to the keyframes that matter', () => {
    const line = Array.from({ length: 30 }, (_, i) => ({ t: i / 30, v: i * 4 }));
    expect(simplifyKeys(line, 0.35)).toEqual([line[0], line[29]]);
    const corner = [...line.slice(0, 15), ...Array.from({ length: 14 }, (_, i) => ({ t: (15 + i) / 30, v: 52 - i * 4 }))];
    expect(simplifyKeys(corner, 0.35).map((k) => k.v)).toEqual([0, 56, 0]);
  });
});

describe('tracks in the project and for the AI', () => {
  it('saves and loads tracks, and lists them for the AI', () => {
    const { p, v } = project();
    const q = addMotionTrack(p, v, { ...walk, name: 'Enemy' }).project;
    const back = parseProject(serializeProject(q));
    expect(getClip(back, v)!.tracks).toEqual(getClip(q, v)!.tracks);
    const text = describeProject(q, { playhead: 0, selection: [] });
    expect(text).toMatch(/motion tracks: tk_\w+ "Enemy" 1\.00–7\.00 s, found 95%/);
    // bad points are dropped on load
    const raw = JSON.parse(serializeProject(q));
    raw.clips.find((c: { id: string }) => c.id === v).tracks[0].points.splice(1, 0, { t: 'x', x: 1, y: 1 });
    expect(getClip(parseProject(raw), v)!.tracks![0].points).toHaveLength(61);
  });

  it('asks the editor to track, with a new crosshair or the clips added just before', () => {
    const { p, v } = project();
    const run = (actions: unknown[]) => applyAIActions(p, actions, { playhead: 2 });
    const r = run([{ type: 'track', clipId: v, at: 2, x: 0.3, y: 0.5, follow: 'crosshair' }]);
    expect(r.effects).toEqual([{ kind: 'track', clipId: v, at: 2, x: 0.3, y: 0.5, size: 0.08, follow: [], sticker: 'crosshair', text: undefined, mode: undefined, name: undefined }]);
    expect(r.results[0].detail).toContain('runs after the other actions; then a new crosshair follows it');
    const last = run([{ type: 'addTitle', text: 'TARGET', start: 1, duration: 6 }, { type: 'track', clipId: v, at: 3, x: 0.5, y: 0.4, size: 0.2, follow: 'last', mode: 'center' }]);
    const title = last.project.clips.find((c) => c.kind === 'title')!.id;
    expect(last.effects[0]).toMatchObject({ kind: 'track', follow: [title], size: 0.2, mode: 'center' });
    expect(run([{ type: 'track', clipId: v, at: 9, x: 0.5, y: 0.5 }]).results[0].detail).toContain('outside');
    expect(run([{ type: 'track', clipId: v, at: 2 }]).results[0].detail).toContain('"x" and "y" are needed');
    expect(run([{ type: 'track', clipId: v, at: 2, x: 0.5, y: 0.5, follow: 'last' }]).results[0].detail).toContain('no title or picture was added');
    expect(run([{ type: 'track', clipId: v, at: 2, x: 0.5, y: 0.5, follow: ['c_nope'] }]).results[0].detail).toContain('unknown clip(s) to follow: c_nope');
  });
});
