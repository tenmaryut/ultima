import { describe, expect, it } from 'vitest';
import type { MediaRef, Project } from './types';
import {
  addCaptionCues,
  addMarker,
  addMediaToTimeline,
  addTrack,
  changeSettings,
  clearRange,
  clipEnd,
  clipsOnTrack,
  copyClips,
  createProject,
  deleteClips,
  displayTracks,
  duplicateClips,
  expandLinked,
  findFreeAudioTrack,
  findFreeVideoTrack,
  insertClips,
  linkClips,
  makeClip,
  moveClips,
  pasteClips,
  removeTrack,
  rippleDeleteRanges,
  setClipSpeed,
  snapPoints,
  splitAt,
  timelineDuration,
  tracksOfKind,
  trimClip,
  unlinkClips,
} from './model';
import { defaultTitle } from './presets';
import { fitPps, formatTimecode, mergeRanges, parseTimecode, pxToTime, quantize, rulerStep, snapRange, snapValue, timeToPx, zoomScroll } from './time';

const video: MediaRef = { id: 'm1', name: 'clip.mp4', kind: 'video', duration: 10, width: 1920, height: 1080, size: 1000, mime: 'video/mp4', hasAudio: true };
const silentVideo: MediaRef = { ...video, id: 'm2', name: 'silent.webm', hasAudio: false };
const song: MediaRef = { id: 'm3', name: 'song.mp3', kind: 'audio', duration: 30, width: 0, height: 0, size: 10, mime: 'audio/mpeg', hasAudio: true };

function withMedia(): Project {
  return { ...createProject(), media: [video, silentVideo, song] };
}

const V = (p: Project, i: number) => tracksOfKind(p, 'video')[i].id;
const A = (p: Project, i: number) => tracksOfKind(p, 'audio')[i].id;

describe('project & tracks', () => {
  it('creates a default project with two video and two audio tracks', () => {
    const p = createProject();
    expect(p.settings).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    expect(tracksOfKind(p, 'video').map((t) => t.name)).toEqual(['V1', 'V2']);
    expect(tracksOfKind(p, 'audio').map((t) => t.name)).toEqual(['A1', 'A2']);
  });

  it('orders tracks for display: captions, video top-down, audio', () => {
    let p = createProject();
    p = addTrack(p, 'caption').project;
    expect(displayTracks(p).map((t) => t.name)).toEqual(['C1', 'V2', 'V1', 'A1', 'A2']);
  });

  it('adds and removes tracks', () => {
    let p = createProject();
    const r = addTrack(p, 'video');
    p = r.project;
    expect(r.track.name).toBe('V3');
    p = insertClips(p, [makeClip('title', r.track.id, 0, 2)]);
    p = removeTrack(p, r.track.id);
    expect(p.clips).toHaveLength(0);
    expect(tracksOfKind(p, 'video')).toHaveLength(2);
  });
});

describe('adding media', () => {
  it('adds a video with a linked audio clip', () => {
    const { project, ids } = addMediaToTimeline(withMedia(), video, { start: 2 });
    expect(ids).toHaveLength(2);
    const [v, a] = ids.map((id) => project.clips.find((c) => c.id === id)!);
    expect(v.kind).toBe('video');
    expect(a.kind).toBe('audio');
    expect(v.linkId).toBeDefined();
    expect(v.linkId).toBe(a.linkId);
    expect(v.trackId).toBe(V(project, 0));
    expect(a.trackId).toBe(A(project, 0));
    expect(v.start).toBe(2);
    expect(v.duration).toBe(10);
    expect(timelineDuration(project)).toBe(12);
  });

  it('adds a silent video without audio and audio files on audio tracks', () => {
    let p = addMediaToTimeline(withMedia(), silentVideo, { start: 0 }).project;
    expect(p.clips).toHaveLength(1);
    p = addMediaToTimeline(p, song, { start: 0 }).project;
    expect(p.clips.find((c) => c.kind === 'audio')?.trackId).toBe(A(p, 0));
  });

  it('places video dropped on V2 with its audio on A2', () => {
    const p0 = withMedia();
    const { project, ids } = addMediaToTimeline(p0, video, { start: 0, trackId: V(p0, 1) });
    const a = project.clips.find((c) => c.id === ids[1])!;
    expect(a.trackId).toBe(A(project, 1));
  });

  it('finds a free track for titles or creates one', () => {
    let p = withMedia();
    const r1 = findFreeVideoTrack(p, 0, 5);
    expect(r1.trackId).toBe(V(p, 1));
    p = insertClips(p, [makeClip('title', r1.trackId, 0, 5)]);
    const r2 = findFreeVideoTrack(p, 1, 3);
    expect(tracksOfKind(r2.project, 'video')).toHaveLength(3);
  });

  it('puts a voice-over on a free audio track instead of over existing sound', () => {
    let p = withMedia();
    p = insertClips(p, [makeClip('audio', A(p, 0), 0, 30, { mediaId: 'm3' })]);
    const r1 = findFreeAudioTrack(p, 5, 8);
    expect(r1.trackId).toBe(A(p, 1));
    p = insertClips(p, [makeClip('audio', r1.trackId, 5, 3)]);
    const r2 = findFreeAudioTrack(p, 6, 9);
    expect(tracksOfKind(r2.project, 'audio')).toHaveLength(3);
    expect(findFreeAudioTrack(p, 9, 12).trackId).toBe(A(p, 1));
  });
});

describe('overwrite', () => {
  it('clearRange trims, splits and removes clips', () => {
    const p = withMedia();
    const c = makeClip('video', V(p, 0), 0, 10, { mediaId: 'm2' });
    const parts = clearRange([c], V(p, 0), 3, 5);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ start: 0, duration: 3, in: 0 });
    expect(parts[1]).toMatchObject({ start: 5, duration: 5, in: 5 });
    expect(clearRange([c], V(p, 0), -1, 11)).toHaveLength(0);
    expect(clearRange([c], V(p, 0), 8, 12)[0]).toMatchObject({ start: 0, duration: 8 });
  });

  it('inserting over a linked clip unlinks the cut pair', () => {
    let p = addMediaToTimeline(withMedia(), video, { start: 0 }).project;
    p = insertClips(p, [makeClip('image', V(p, 0), 2, 1, { mediaId: 'm2' })]);
    expect(p.clips.filter((c) => c.linkId)).toHaveLength(0);
  });
});

describe('split', () => {
  it('splits a clip and its linked audio, keeping them linked', () => {
    const base = addMediaToTimeline(withMedia(), video, { start: 1 });
    const { project, created } = splitAt(base.project, 4, [base.ids[0]]);
    expect(created).toHaveLength(2);
    const v = clipsOnTrack(project, V(project, 0));
    const a = clipsOnTrack(project, A(project, 0));
    expect(v.map((c) => [c.start, c.duration, c.in])).toEqual([
      [1, 3, 0],
      [4, 7, 3],
    ]);
    expect(a.map((c) => [c.start, c.duration, c.in])).toEqual([
      [1, 3, 0],
      [4, 7, 3],
    ]);
    expect(v[1].linkId).toBeDefined();
    expect(v[1].linkId).toBe(a[1].linkId);
    expect(v[0].linkId).toBe(a[0].linkId);
    expect(v[0].linkId).not.toBe(v[1].linkId);
  });

  it('accounts for speed when splitting', () => {
    let p = addMediaToTimeline(withMedia(), song, { start: 0 }).project;
    const id = p.clips[0].id;
    p = setClipSpeed(p, id, 2);
    expect(p.clips[0].duration).toBe(15);
    const r = splitAt(p, 5);
    const right = r.project.clips.find((c) => c.start === 5)!;
    expect(right.in).toBe(10);
    expect(right.duration).toBe(10);
  });

  it('splits everything under the playhead when nothing is selected, but not at clip edges', () => {
    let p = addMediaToTimeline(withMedia(), video, { start: 0 }).project;
    expect(splitAt(p, 0).created).toHaveLength(0);
    expect(splitAt(p, 10).created).toHaveLength(0);
    p = splitAt(p, 5).project;
    expect(p.clips).toHaveLength(4);
  });

  it('moves fades and transitions to the right halves sensibly', () => {
    const p0 = withMedia();
    const c = makeClip('video', V(p0, 0), 0, 10, { mediaId: 'm2', fadeIn: 1, fadeOut: 2, transition: { kind: 'dissolve', duration: 1 } });
    const p = splitAt(insertClips(p0, [c]), 5).project;
    const [l, r] = clipsOnTrack(p, V(p, 0));
    expect([l.fadeIn, l.fadeOut, l.transition?.kind]).toEqual([1, 0, 'dissolve']);
    expect([r.fadeIn, r.fadeOut, r.transition]).toEqual([0, 2, undefined]);
  });
});

describe('trim', () => {
  it('cannot extend beyond the source media', () => {
    const base = addMediaToTimeline(withMedia(), video, { start: 2 });
    let p = trimClip(base.project, base.ids[0], 'start', 0);
    expect(p).toBe(base.project); // in = 0 already: nothing to reveal
    p = trimClip(p, base.ids[0], 'start', 4);
    let v = p.clips.find((c) => c.id === base.ids[0])!;
    expect([v.start, v.duration, v.in]).toEqual([4, 8, 2]);
    p = trimClip(p, base.ids[0], 'start', 0);
    v = p.clips.find((c) => c.id === base.ids[0])!;
    expect([v.start, v.duration, v.in]).toEqual([2, 10, 0]);
    p = trimClip(p, base.ids[0], 'end', 100);
    v = p.clips.find((c) => c.id === base.ids[0])!;
    expect(clipEnd(v)).toBe(12);
    // linked audio follows
    const a = p.clips.find((c) => c.id === base.ids[1])!;
    expect([a.start, a.duration, a.in]).toEqual([2, 10, 0]);
  });

  it('stops at neighbouring clips and keeps a minimum length', () => {
    let p = withMedia();
    const a = makeClip('image', V(p, 0), 0, 5, { mediaId: 'm2' });
    const b = makeClip('image', V(p, 0), 7, 5, { mediaId: 'm2' });
    p = insertClips(p, [a, b]);
    p = trimClip(p, a.id, 'end', 20);
    expect(clipEnd(p.clips.find((c) => c.id === a.id)!)).toBe(7);
    p = trimClip(p, b.id, 'start', 1);
    expect(p.clips.find((c) => c.id === b.id)!.start).toBe(7);
    p = trimClip(p, a.id, 'end', -5);
    expect(p.clips.find((c) => c.id === a.id)!.duration).toBeCloseTo(1 / 30, 6);
  });

  it('images and titles can be stretched freely', () => {
    let p = withMedia();
    const t = makeClip('title', V(p, 1), 0, 2);
    p = insertClips(p, [t]);
    p = trimClip(p, t.id, 'end', 60);
    expect(p.clips[0].duration).toBe(60);
  });
});

describe('move', () => {
  it('moves linked clips together and overwrites the destination', () => {
    let p = withMedia();
    const first = addMediaToTimeline(p, video, { start: 0 });
    p = addMediaToTimeline(first.project, silentVideo, { start: 10 }).project;
    p = moveClips(p, [first.ids[0]], 5, 0, 'video');
    const v1 = clipsOnTrack(p, V(p, 0));
    expect(v1.map((c) => [c.start, c.duration])).toEqual([
      [5, 10],
      [15, 5],
    ]);
    expect(clipsOnTrack(p, A(p, 0))[0].start).toBe(5);
  });

  it('shifts tracks within the same kind and never before 0', () => {
    let p = withMedia();
    const r = addMediaToTimeline(p, video, { start: 1 });
    p = moveClips(r.project, [r.ids[0]], -10, 1, 'video');
    const v = p.clips.find((c) => c.id === r.ids[0])!;
    expect(v.trackId).toBe(V(p, 1));
    expect(v.start).toBe(0);
    const a = p.clips.find((c) => c.id === r.ids[1])!;
    expect(a.trackId).toBe(A(p, 0)); // partner stays on its track
    expect(a.start).toBe(0);
    // can't move above the last track
    expect(moveClips(p, [r.ids[0]], 0, 5, 'video').clips.find((c) => c.id === r.ids[0])!.trackId).toBe(V(p, 1));
  });

  it('does not move clips on locked tracks', () => {
    const r = addMediaToTimeline(withMedia(), silentVideo, { start: 0 });
    const locked = { ...r.project, tracks: r.project.tracks.map((t) => (t.kind === 'video' ? { ...t, locked: true } : t)) };
    expect(moveClips(locked, r.ids, 3)).toBe(locked);
  });
});

describe('delete', () => {
  it('ripple delete closes the gap on the affected tracks', () => {
    let p = withMedia();
    const a = addMediaToTimeline(p, video, { start: 0 });
    const b = addMediaToTimeline(a.project, video, { start: 10 });
    p = deleteClips(b.project, [a.ids[0]], { ripple: true });
    expect(p.clips).toHaveLength(2);
    expect(p.clips.every((c) => c.start === 0)).toBe(true);
  });

  it('plain delete leaves the gap and can skip linked partners', () => {
    const a = addMediaToTimeline(withMedia(), video, { start: 0 });
    const b = addMediaToTimeline(a.project, video, { start: 10 });
    let p = deleteClips(b.project, [a.ids[0]]);
    expect(p.clips.map((c) => c.start)).toEqual([10, 10]);
    p = deleteClips(b.project, [a.ids[1]], { linked: false });
    expect(p.clips).toHaveLength(3);
    expect(p.clips.find((c) => c.id === a.ids[0])!.linkId).toBeUndefined();
  });

  it('ripple deletes time ranges across tracks keeping links', () => {
    let p = addMediaToTimeline(withMedia(), video, { start: 0 }).project;
    p = addMarker(p, 3).project;
    p = addMarker(p, 6).project;
    p = rippleDeleteRanges(p, [{ start: 2, end: 4 }]);
    const v = clipsOnTrack(p, V(p, 0));
    expect(v.map((c) => [c.start, c.duration, c.in])).toEqual([
      [0, 2, 0],
      [2, 6, 4],
    ]);
    const a = clipsOnTrack(p, A(p, 0));
    expect(a.map((c) => [c.start, c.duration, c.in])).toEqual([
      [0, 2, 0],
      [2, 6, 4],
    ]);
    expect(v[0].linkId).toBe(a[0].linkId);
    expect(v[1].linkId).toBe(a[1].linkId);
    expect(p.markers.map((m) => m.time)).toEqual([4]);
    expect(timelineDuration(p)).toBe(8);
  });

  it('ripple deletes several ranges', () => {
    let p = addMediaToTimeline(withMedia(), song, { start: 0 }).project;
    p = rippleDeleteRanges(p, [
      { start: 1, end: 2 },
      { start: 5, end: 7 },
      { start: 6, end: 8 },
    ]);
    expect(timelineDuration(p)).toBe(26);
    expect(clipsOnTrack(p, A(p, 0)).map((c) => [c.start, c.in])).toEqual([
      [0, 0],
      [1, 2],
      [4, 8],
    ]);
  });
});

describe('duplicate, copy & paste, links, speed', () => {
  it('duplicates right after the selection', () => {
    const r = addMediaToTimeline(withMedia(), video, { start: 1 });
    const d = duplicateClips(r.project, [r.ids[0]]);
    expect(d.ids).toHaveLength(2);
    const copies = d.project.clips.filter((c) => d.ids.includes(c.id));
    expect(copies.every((c) => c.start === 11)).toBe(true);
    expect(copies[0].linkId).toBe(copies[1].linkId);
    expect(copies[0].linkId).not.toBe(r.project.clips[0].linkId);
  });

  it('copies and pastes at a time', () => {
    const r = addMediaToTimeline(withMedia(), video, { start: 3 });
    const data = copyClips(r.project, [r.ids[1]])!;
    expect(data.clips).toHaveLength(2);
    const pasted = pasteClips(r.project, data, 20);
    expect(pasted.ids).toHaveLength(2);
    expect(pasted.project.clips.filter((c) => pasted.ids.includes(c.id)).map((c) => c.start)).toEqual([20, 20]);
    // paste into an empty project brings the media reference along
    const empty = createProject();
    const into = pasteClips(empty, data, 0);
    expect(into.project.media.map((m) => m.id)).toEqual(['m1']);
  });

  it('links and unlinks clips', () => {
    let p = withMedia();
    const a = makeClip('image', V(p, 0), 0, 3, { mediaId: 'm2' });
    const b = makeClip('audio', A(p, 0), 0, 3, { mediaId: 'm3' });
    p = insertClips(p, [a, b]);
    p = linkClips(p, [a.id, b.id]);
    expect([...expandLinked(p, [a.id])].sort()).toEqual([a.id, b.id].sort());
    p = unlinkClips(p, [a.id]);
    expect(p.clips.every((c) => !c.linkId)).toBe(true);
  });

  it('changes speed and respects the next clip', () => {
    let p = withMedia();
    const r = addMediaToTimeline(p, song, { start: 0, duration: 10 });
    p = insertClips(r.project, [makeClip('audio', A(r.project, 0), 12, 2, { mediaId: 'm3' })]);
    p = setClipSpeed(p, r.ids[0], 0.5);
    expect(p.clips.find((c) => c.id === r.ids[0])!.duration).toBe(12);
    p = setClipSpeed(p, r.ids[0], 4);
    expect(p.clips.find((c) => c.id === r.ids[0])!.duration).toBe(1.5);
  });
});

describe('captions, markers, settings', () => {
  it('adds caption cues on a caption track', () => {
    const r = addCaptionCues(createProject(), [
      { start: 0, end: 2, text: 'Hello' },
      { start: 2, end: 4, text: 'World' },
      { start: 5, end: 6, text: '   ' },
    ]);
    expect(r.ids).toHaveLength(2);
    expect(tracksOfKind(r.project, 'caption')).toHaveLength(1);
    const again = addCaptionCues(r.project, [{ start: 0, end: 1, text: 'New' }], { trackId: r.trackId, replace: true });
    expect(again.project.clips).toHaveLength(1);
  });

  it('collects snap points', () => {
    let p = addMediaToTimeline(withMedia(), video, { start: 2 }).project;
    p = addMarker(p, 7, 'm').project;
    const pts = snapPoints(p, { playhead: 1.5 });
    expect(pts).toEqual(expect.arrayContaining([0, 1.5, 2, 12, 7]));
  });

  it('rescales positions when the resolution changes', () => {
    let p = withMedia();
    const t = makeClip('title', V(p, 1), 0, 2, { title: { ...defaultTitle(1080), size: 100 } });
    p = insertClips(p, [{ ...t, visual: { ...t.visual!, x: 100, y: 50 } }]);
    p = changeSettings(p, { ...p.settings, width: 960, height: 540 });
    expect(p.clips[0].visual).toMatchObject({ x: 50, y: 25 });
    expect(p.clips[0].title?.size).toBe(50);
    expect(p.captionStyle.size).toBe(Math.round(createProject().captionStyle.size / 2));
  });
});

describe('time math', () => {
  it('formats and parses timecode', () => {
    expect(formatTimecode(83.5, 30)).toBe('00:01:23:15');
    expect(formatTimecode(3600 + 1 / 25, 25)).toBe('01:00:00:01');
    expect(parseTimecode('00:01:23:15', 30)).toBeCloseTo(83.5);
    expect(parseTimecode('1:30', 30)).toBe(90);
    expect(parseTimecode('12.5', 30)).toBe(12.5);
    expect(parseTimecode('abc', 30)).toBeNull();
  });

  it('converts time and pixels and keeps the zoom anchor', () => {
    expect(timeToPx(2.5, 100)).toBe(250);
    expect(pxToTime(250, 100)).toBe(2.5);
    // anchor time 10 s under x=300 after zooming to 50 px/s => scrollLeft 200
    expect(zoomScroll(10, 300, 50)).toBe(200);
    expect(fitPps(100, 1000)).toBeCloseTo(9.5);
    expect(quantize(1.01, 30)).toBeCloseTo(1);
    const step = rulerStep(100, 30);
    expect(step.major * 100).toBeGreaterThanOrEqual(80);
  });

  it('snaps values and ranges', () => {
    expect(snapValue(4.95, [0, 5, 10], 0.1)).toEqual({ value: 5, target: 5 });
    expect(snapValue(4.5, [0, 5, 10], 0.1)).toEqual({ value: 4.5, target: null });
    // the end of a 2 s clip starting at 7.97 snaps to 10
    expect(snapRange(7.97, 2, [0, 10], 0.05)).toEqual({ value: 8, target: 10 });
    expect(snapRange(0.02, 2, [0, 10], 0.05)).toEqual({ value: 0, target: 0 });
  });

  it('merges ranges', () => {
    expect(mergeRanges([{ start: 5, end: 6 }, { start: 1, end: 3 }, { start: 2, end: 4 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 6 },
    ]);
  });
});
