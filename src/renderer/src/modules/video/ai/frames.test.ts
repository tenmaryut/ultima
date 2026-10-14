import { describe, expect, it } from 'vitest';
import { frameLabel, planClipFrames, sheetLayout } from './frames';
import { addMediaToTimeline, createProject, makeClip, insertClips, tracksOfKind } from '../model';
import type { MediaRef, Project } from '../types';

const clipMedia: MediaRef = { id: 'm_v', name: 'game.mp4', kind: 'video', duration: 120, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true };
const still: MediaRef = { id: 'm_i', name: 'logo.png', kind: 'image', duration: 0, width: 100, height: 100, size: 1, mime: 'image/png', hasAudio: false };

function withClips(lengths: number[]): Project {
  let p: Project = { ...createProject(), media: [clipMedia, still] };
  let at = 0;
  for (const len of lengths) {
    p = addMediaToTimeline(p, clipMedia, { start: at, duration: len }).project;
    at += len;
  }
  return p;
}

describe('frame sheets', () => {
  it('gives every clip a frame and longer clips more, in timeline order', () => {
    const p = withClips([1, 4, 10]);
    const plan = planClipFrames(p);
    expect(plan.clipsShown).toBe(3);
    expect(plan.samples.map((s) => +s.time.toFixed(2))).toEqual([0.5, 2, 4, 6.67, 10, 13.33]);
    // source times follow the in-point and speed
    expect(plan.samples[0].sourceTime).toBeCloseTo(0.5);
  });

  it('keeps to the tile budget and says how many clips are left out', () => {
    const p = withClips(Array.from({ length: 10 }, () => 8));
    const plan = planClipFrames(p, 6);
    expect(plan.samples).toHaveLength(6);
    expect(plan.clipsShown).toBe(6);
    expect(plan.clipsTotal).toBe(10);
  });

  it('includes stills, skips titles and audio, and labels tiles like the summary', () => {
    let p = withClips([2]);
    const v2 = tracksOfKind(p, 'video')[1]?.id ?? tracksOfKind(p, 'video')[0].id;
    p = insertClips({ ...p }, [makeClip('image', v2, 0, 2, { mediaId: 'm_i' }), makeClip('title', v2, 3, 2, { title: undefined })]);
    const plan = planClipFrames(p);
    expect(plan.samples.map((s) => s.mediaId).sort()).toEqual(['m_i', 'm_v', 'm_v']);
    expect(frameLabel(plan.samples[0])).toMatch(/^c_\w+ · 0\.5 s$/);
  });

  it('lays out tiles like the project frame', () => {
    expect(sheetLayout(16 / 9)).toMatchObject({ cols: 4, rows: 3, cellWidth: 320 });
    expect(sheetLayout(9 / 16).cols).toBe(8);
  });
});
