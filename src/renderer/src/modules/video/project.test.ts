import { describe, expect, it } from 'vitest';
import { addCaptionCues, addMarker, addMediaToTimeline, createProject, insertClips, makeClip, tracksOfKind } from './model';
import { looksLikeVideoProject, parseProject, serializeProject } from './project';
import { titlePreset } from './presets';
import type { MediaRef } from './types';

const media: MediaRef = { id: 'm1', name: 'a.webm', kind: 'video', duration: 8, width: 1280, height: 720, size: 5, mime: 'video/webm', hasAudio: true, path: '/tmp/a.webm' };

function sample() {
  let p = { ...createProject({ width: 1280, height: 720, fps: 25 }, 'Trip'), media: [media] };
  p = addMediaToTimeline(p, media, { start: 1 }).project;
  const v2 = tracksOfKind(p, 'video')[1].id;
  p = insertClips(p, [makeClip('title', v2, 0, 3, { title: titlePreset('lowerThird', 1280, 720), transition: { kind: 'dissolve', duration: 0.5 } })]);
  p = addCaptionCues(p, [{ start: 0, end: 2, text: 'Hi' }]).project;
  p = addMarker(p, 2, 'Beat').project;
  return { ...p, workArea: { start: 1, end: 5 } };
}

describe('project files', () => {
  it('round-trips through JSON', () => {
    const p = sample();
    const text = serializeProject(p);
    expect(looksLikeVideoProject(text)).toBe(true);
    expect(text.indexOf('"module"')).toBeLessThan(100);
    const back = parseProject(text);
    expect(back).toEqual(JSON.parse(JSON.stringify(p)));
  });

  it('rejects other files', () => {
    expect(() => parseProject('{')).toThrow(/broken JSON/);
    expect(() => parseProject('{"app":"other"}')).toThrow(/not an Ultima project/);
    expect(() => parseProject({ app: 'ultima', module: 'photo' })).toThrow(/another module/);
  });

  it('sanitizes values and drops invalid clips', () => {
    const p = sample();
    const raw = JSON.parse(serializeProject(p));
    raw.settings.width = 99999;
    raw.settings.fps = 'fast';
    raw.clips[0].speed = 100;
    raw.clips[0].visual.opacity = 7;
    raw.clips[1].trackId = 'nope';
    raw.clips.push({ id: 'x', kind: 'video', trackId: raw.tracks[0].id, start: 0, duration: 1 }); // no media
    raw.clips.push({ id: 'y', kind: 'title', trackId: raw.tracks[0].id, start: 0, duration: 1, title: { font: 'Evil"; }', align: 'sideways' } });
    const back = parseProject(raw);
    expect(back.settings.width).toBe(7680);
    expect(back.settings.fps).toBe(30);
    expect(back.clips[0].speed).toBe(4);
    expect(back.clips[0].visual?.opacity).toBe(1);
    expect(back.clips.some((c) => c.id === 'x')).toBe(false);
    const y = back.clips.find((c) => c.id === 'y')!;
    expect(y.title?.font).toBe('Evil ');
    expect(y.title?.align).toBe('center');
    // the audio clip lost its track, so its video partner is no longer linked
    expect(back.clips.find((c) => c.kind === 'video')?.linkId).toBeUndefined();
  });

  it('falls back to default tracks', () => {
    const back = parseProject({ app: 'ultima', module: 'video', version: 1 });
    expect(back.tracks.length).toBe(4);
    expect(back.clips).toEqual([]);
  });
});
