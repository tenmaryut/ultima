import { describe, expect, it } from 'vitest';
import { applyAIActions, describeProject, formatChapters, parseRoughCut, parseVideoMeta, plainText } from './aiActions';
import { addMediaToTimeline, clipEnd, createProject, tracksOfKind } from './model';
import type { MediaRef } from './types';

const media: MediaRef = { id: 'm1', name: 'beach.mp4', kind: 'video', duration: 10, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true };

function base() {
  const r = addMediaToTimeline({ ...createProject(), media: [media] }, media, { start: 0 });
  return { p: r.project, videoId: r.ids[0], audioId: r.ids[1] };
}

describe('AI context', () => {
  it('describes clips with ids, tracks and times', () => {
    const { p, videoId } = base();
    const text = describeProject(p, { playhead: 1.5, selection: [videoId] });
    expect(text).toContain(videoId);
    expect(text).toContain('V1');
    expect(text).toContain('0.00–10.00 s');
    expect(text).toContain('Playhead at 1.50 s');
    expect(text).toContain(`Selected clips: ${videoId}`);
  });
});

describe('AI actions', () => {
  it('adds titles, captions and markers', () => {
    const { p } = base();
    const r = applyAIActions(
      p,
      [
        { type: 'addTitle', text: '<b>Summer</b>', start: 1, duration: 3, style: 'big', position: 'top' },
        { type: 'addTitle', text: 'Custom', style: { preset: 'lowerThird', color: '#ff0000', size: 9999 }, position: { x: 2, y: 0.5 } },
        { type: 'addCaption', text: 'Hello', start: 0, end: 2 },
        { type: 'addMarker', time: 4, label: 'Beat' },
      ],
      { playhead: 5 },
    );
    expect(r.applied).toBe(4);
    const titles = r.project.clips.filter((c) => c.kind === 'title');
    expect(titles[0].title?.text).toBe('Summer');
    expect(titles[0].title?.y).toBeCloseTo(0.15);
    expect(titles[0].start).toBe(1);
    expect(titles[1].start).toBe(5);
    expect(titles[1].title?.color).toBe('#ff0000');
    expect(titles[1].title?.size).toBe(1080);
    expect(titles[1].title?.x).toBe(1);
    expect(r.project.clips.some((c) => c.kind === 'caption' && c.text === 'Hello')).toBe(true);
    expect(r.project.markers[0]).toMatchObject({ time: 4, label: 'Beat' });
  });

  it('splits, trims, moves and deletes', () => {
    const { p, videoId } = base();
    let r = applyAIActions(p, [{ type: 'split', time: 4 }], { playhead: 0 });
    expect(r.project.clips).toHaveLength(4);
    r = applyAIActions(p, [{ type: 'trim', clipId: videoId, start: 2, end: 8 }], { playhead: 0 });
    const v = r.project.clips.find((c) => c.id === videoId)!;
    expect([v.start, clipEnd(v), v.in]).toEqual([2, 8, 2]);
    r = applyAIActions(p, [{ type: 'move', clipId: videoId, start: 3, track: 'V2' }], { playhead: 0 });
    const moved = r.project.clips.find((c) => c.id === videoId)!;
    expect(moved.start).toBe(3);
    expect(moved.trackId).toBe(tracksOfKind(r.project, 'video')[1].id);
    r = applyAIActions(p, [{ type: 'move', clipId: videoId, start: 0, track: 'V3' }], { playhead: 0 });
    expect(tracksOfKind(r.project, 'video')).toHaveLength(3);
    r = applyAIActions(p, [{ type: 'delete', clipIds: [videoId] }], { playhead: 0 });
    expect(r.project.clips).toHaveLength(0);
  });

  it('sets clip properties with clamping', () => {
    const { p, videoId, audioId } = base();
    const r = applyAIActions(
      p,
      [{ type: 'setClip', clipId: videoId, props: { opacity: 50, scale: 150, saturation: -500, volume: 40, speed: 2, fadeOut: 1, x: 'left' } }],
      { playhead: 0 },
    );
    const v = r.project.clips.find((c) => c.id === videoId)!;
    expect(v.visual?.opacity).toBe(0.5);
    expect(v.visual?.scale).toBe(1.5);
    expect(v.visual?.saturation).toBe(-100);
    expect(v.visual?.x).toBe(0);
    expect(v.speed).toBe(2);
    expect(v.duration).toBe(5);
    expect(v.fadeOut).toBe(1);
    expect(r.project.clips.find((c) => c.id === audioId)!.volume).toBe(12);
  });

  it('adds transitions and changes project settings', () => {
    const { p, videoId } = base();
    const r = applyAIActions(
      p,
      [
        { type: 'addTransition', clipId: videoId, kind: 'dissolve', duration: 99 },
        { type: 'setProject', width: 1079, height: 1920, fps: 29.97, background: 'url(evil)' },
      ],
      { playhead: 0 },
    );
    expect(r.project.clips.find((c) => c.id === videoId)!.transition).toEqual({ kind: 'dissolve', duration: 5 });
    expect(r.project.settings).toEqual({ width: 1080, height: 1920, fps: 30, background: '#000000' });
  });

  it('ignores unknown actions, unknown clips and bad input', () => {
    const { p } = base();
    const r = applyAIActions(p, [{ type: 'explode' }, { type: 'setClip', clipId: 'nope', props: {} }, null, 'x', { type: 'addTitle', text: '' }], { playhead: 0 });
    expect(r.applied).toBe(0);
    expect(r.project).toBe(p);
    expect(r.notes.length).toBeGreaterThan(1);
  });

  it('refuses edits on locked tracks', () => {
    const { p, videoId } = base();
    const locked = { ...p, tracks: p.tracks.map((t) => ({ ...t, locked: true })) };
    const r = applyAIActions(locked, [{ type: 'delete', clipIds: [videoId] }, { type: 'setClip', clipId: videoId, props: { opacity: 0 } }], { playhead: 0 });
    expect(r.project.clips).toHaveLength(2);
    expect(r.project.clips[0].visual?.opacity).toBe(1);
  });
});

describe('AI feature parsing', () => {
  it('validates titles, description and chapters', () => {
    const meta = parseVideoMeta(
      {
        titles: ['A <script>x</script>great video', 3],
        description: 'Desc',
        chapters: [{ time: 30, title: 'Part 2' }, { time: 5, title: 'Intro' }, { time: 5.5, title: 'Dupe' }, { time: 'x', title: 'bad' }],
        tags: ['travel'],
      },
      120,
    );
    expect(meta.titles).toEqual(['A xgreat video']);
    expect(meta.chapters).toEqual([
      { time: 0, title: 'Intro' },
      { time: 30, title: 'Part 2' },
    ]);
    expect(formatChapters(meta.chapters)).toBe('0:00 Intro\n0:30 Part 2');
    expect(formatChapters([{ time: 3725, title: 'Late' }])).toBe('1:02:05 Late');
  });

  it('validates rough cut indices', () => {
    expect(parseRoughCut({ remove: [3, 1, 1, 99, -1, 'x'], reason: 'fillers' }, 5)).toEqual({ remove: [1, 3], reason: 'fillers' });
  });

  it('strips markup and control characters', () => {
    expect(plainText('<i>hi</i>\u0007 there')).toBe('hi there');
  });
});
