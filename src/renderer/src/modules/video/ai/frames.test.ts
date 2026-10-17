import { describe, expect, it } from 'vitest';
import { LOOK_REGIONS, MAX_SOURCE_FRAMES, describeSourceLook, frameLabel, lookRegion, planClipFrames, planSourceLook, sheetLayout, sourceSheetLayout } from './frames';
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

describe('looking at source clips', () => {
  it('reads named and custom regions and keeps them inside the picture', () => {
    expect(lookRegion('topRight')).toEqual({ region: LOOK_REGIONS.topRight, name: 'topRight' });
    expect(lookRegion('full')).toEqual({ region: null, name: 'full' });
    expect(lookRegion(undefined).region).toBeNull();
    const r = lookRegion({ x: 0.98, y: -1, w: 0.5, h: '0.3' }).region!;
    expect(r.x).toBe(0.95);
    expect(r.y).toBe(0);
    expect(r.w).toBeCloseTo(0.05);
    expect(r.h).toBe(0.3);
    expect(lookRegion({ x: 0, y: 0, w: 1, h: 1 }).region).toBeNull();
  });

  it('plans times, even strips over a range, single frames and overviews', () => {
    expect(planSourceLook({ times: [3, 1, 1, 99] }, 30).times).toEqual([1, 3, 29.96]);
    const strip = planSourceLook({ from: 12, to: 13.4, frames: 8, region: 'topRight' }, 30);
    expect(strip.times).toHaveLength(8);
    expect(strip.times[0]).toBe(12);
    expect(strip.times[7]).toBe(13.4);
    expect(strip.strip).toBe(true);
    expect(strip.regionName).toBe('topRight');
    expect(planSourceLook({ from: 5, to: 6, frames: 99 }, 30).times).toHaveLength(MAX_SOURCE_FRAMES);
    expect(planSourceLook({ time: 7 }, 30).times).toEqual([7]);
    const overview = planSourceLook({}, 30);
    expect(overview.overview).toBe(true);
    expect(overview.times).toHaveLength(6);
    expect(planSourceLook({}, 0).times).toEqual([0]);
  });

  it('makes tiles as big as the sheet allows', () => {
    expect(sourceSheetLayout(1, 16 / 9)).toMatchObject({ cols: 1, cellWidth: 1600, frameHeight: 900 });
    const sixteen = sourceSheetLayout(16, 16 / 9);
    expect(sixteen.cols).toBe(4);
    expect(sixteen.cols * sixteen.cellWidth).toBeLessThanOrEqual(1600);
    expect(sixteen.rows * (sixteen.frameHeight + sixteen.labelHeight)).toBeLessThanOrEqual(1600);
    // a tall crop is limited by the height
    const tall = sourceSheetLayout(2, 0.5);
    expect(tall.frameHeight + tall.labelHeight).toBeLessThanOrEqual(1600);
  });

  it('describes what the pictures show', () => {
    const strip = planSourceLook({ from: 12, to: 13.4, frames: 8, region: 'topRight' }, 120);
    const text = describeSourceLook(clipMedia, strip);
    expect(text).toContain('m_v "game.mp4" (source seconds): 8 frames from 12.00 to 13.40 s, every 0.20 s in order');
    expect(text).toContain('zoomed into the topRight part of the picture at full resolution');
    expect(describeSourceLook(clipMedia, planSourceLook({}, 120))).toContain('an overview: 12 frames spread over the whole 120.0 s');
  });
});
