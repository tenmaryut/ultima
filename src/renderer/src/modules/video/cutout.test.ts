import { describe, expect, it } from 'vitest';
import { setMatte, setMatteInvert, subjectInFront } from './cutout';
import { matteIndex } from './matte';
import { applyAIActions } from './ai/executor';
import { describeProject } from './ai/describe';
import { addMediaToTimeline, clipEnd, createProject, getClip, tracksOfKind } from './model';
import { parseProject, serializeProject } from './project';
import type { ClipMatte, MediaRef, Project } from './types';

const game: MediaRef = { id: 'm_game', name: 'clutch.mp4', kind: 'video', duration: 20, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true, fps: 30 };
// 1×1 transparent PNG, base64
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const matte: ClipMatte = { start: 2, fps: 30, w: 512, h: 288, frames: Array.from({ length: 90 }, () => PNG), model: 'people' };

function project(): { p: Project; v: string } {
  const p: Project = { ...createProject(), media: [game] };
  const r = addMediaToTimeline(p, game, { start: 1, duration: 3 });
  return { p: r.project, v: r.ids[0] };
}

describe('cut-out subjects', () => {
  it('finds the mask of every moment, frame by frame', () => {
    // masks from 2 s, 30 a second: 2.000–2.033 s shows the first, 2.99 s the 30th
    expect(matteIndex(matte, 2.001)).toBe(0);
    expect(matteIndex(matte, 2.034)).toBe(1);
    expect(matteIndex(matte, 2.99)).toBe(29);
    expect(matteIndex(matte, 0)).toBe(0);
    expect(matteIndex(matte, 99)).toBe(89);
  });

  it('keeps the masks with the clip, inverts them, and saves them in the project', () => {
    const { p, v } = project();
    const q = setMatteInvert(setMatte(p, v, matte), v, true);
    expect(getClip(q, v)!.matte).toMatchObject({ invert: true, frames: matte.frames });
    const back = parseProject(serializeProject(q));
    expect(getClip(back, v)!.matte).toEqual(getClip(q, v)!.matte);
    expect(describeProject(q, { playhead: 0, selection: [] })).toContain('cut-out: everything but the subject (people model, 90 masks)');
    // only base64 PNG data comes back from a file
    const raw = JSON.parse(serializeProject(q));
    raw.clips.find((c: { id: string }) => c.id === v).matte.frames[3] = '<script>';
    expect(getClip(parseProject(raw), v)!.matte).toBeUndefined();
    expect(getClip(setMatte(q, v, undefined), v)!.matte).toBeUndefined();
  });

  it('puts a silent cut-out copy above everything for text behind the player', () => {
    const { p, v } = project();
    const titled = applyAIActions(setMatte(p, v, { ...matte, invert: true }), [{ type: 'addTitle', text: 'ACE', start: 1, duration: 3 }], { playhead: 0 }).project;
    const r = subjectInFront(titled, v);
    const copy = getClip(r.project, r.copyId!)!;
    const video = tracksOfKind(r.project, 'video');
    const title = r.project.clips.find((c) => c.kind === 'title')!;
    // above the title's track, same time, only the subject, no sound of its own
    expect(video.findIndex((t) => t.id === copy.trackId)).toBeGreaterThan(video.findIndex((t) => t.id === title.trackId));
    expect([copy.start, clipEnd(copy), copy.linkId, copy.matte?.invert]).toEqual([1, 4, undefined, undefined]);
    expect(subjectInFront(p, v).problem).toContain('has no cut-out yet');
  });

  it('lets the AI ask for a cut-out', () => {
    const { p, v } = project();
    const run = (a: unknown) => applyAIActions(p, [a], { playhead: 0 });
    expect(run({ type: 'cutout', clipId: v, mode: 'front' }).effects).toEqual([{ kind: 'cutout', clipId: v, model: 'people', mode: 'front' }]);
    expect(run({ type: 'cutout', clipId: v, model: 'anything' }).effects[0]).toMatchObject({ model: 'anything', mode: 'subject' });
    expect(run({ type: 'cutout', clipId: v, model: 'cats' }).results[0].detail).toContain('"model" is "people"');
    expect(run({ type: 'cutout', clipId: v, mode: 'sideways' }).results[0].detail).toContain('"mode" is "subject"');
  });
});
