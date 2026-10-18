import { describe, expect, it } from 'vitest';
import { placeStem, soundClipOf } from './stemsClip';
import { applyAIActions } from './ai/executor';
import { addMediaToTimeline, createProject, getClip, updateClip } from './model';
import { MIN_VOLUME_DB } from './presets';
import type { MediaRef, Project } from './types';

const song: MediaRef = { id: 'm_song', name: 'phonk.mp3', kind: 'audio', duration: 30, width: 0, height: 0, size: 1, mime: 'audio/mpeg', hasAudio: true };
const game: MediaRef = { id: 'm_game', name: 'clutch.mp4', kind: 'video', duration: 20, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true, fps: 30 };
const silent: MediaRef = { ...game, id: 'm_silent', name: 'silent.mp4', hasAudio: false };
const stem: MediaRef = { id: 'm_stem', name: 'phonk (instrumental).wav', kind: 'audio', duration: 8, width: 0, height: 0, size: 1, mime: 'audio/wav', hasAudio: true, path: '/videos/phonk (instrumental).wav' };

function project(): { p: Project; s: string; v: string; a: string; mute: string } {
  let p: Project = { ...createProject(), media: [song, game, silent] };
  const r1 = addMediaToTimeline(p, song, { start: 2, duration: 4 });
  const r2 = addMediaToTimeline(r1.project, game, { start: 10, duration: 3 });
  const r3 = addMediaToTimeline(r2.project, silent, { start: 20, duration: 3 });
  const s = r1.ids[0];
  // a fast, reversed song from 5 s in, a bit quieter, fading in and dipping under a voice
  p = updateClip(r3.project, s, (c) => ({ ...c, in: 5, speed: 2, reverse: true, volume: -3, fadeIn: 0.5, keys: { volume: [{ t: 1, v: 0, ease: 'linear' }, { t: 2, v: -12, ease: 'linear' }] } }));
  return { p, s, v: r2.ids[0], a: r2.ids[1], mute: r3.ids[0] };
}

describe('separated stems on the timeline', () => {
  it('plays the stem in sync on a free track and mutes the original', () => {
    const { p, s } = project();
    const r = placeStem(p, s, stem, 'instrumental');
    const clip = getClip(r.project, r.stemClipId!)!;
    expect(r.project.media.map((m) => m.id)).toContain('m_stem');
    // the stem file starts where the clip's part of the song starts: same timing, speed, direction and volume
    expect(clip).toMatchObject({ kind: 'audio', mediaId: 'm_stem', name: 'phonk (instrumental)', start: 2, duration: 4, in: 0, speed: 2, reverse: true, volume: -3, fadeIn: 0.5 });
    expect(clip.keys?.volume).toHaveLength(2);
    expect(clip.trackId).not.toBe(getClip(p, s)!.trackId);
    // the original stays, silent and without its volume animation
    const original = getClip(r.project, s)!;
    expect([original.volume, original.keys?.volume]).toEqual([MIN_VOLUME_DB, undefined]);
    // a second stem of the (now muted) song is not muted too
    const again = placeStem(r.project, s, { ...stem, id: 'm_drums' }, 'drums');
    expect(getClip(again.project, again.stemClipId!)!.volume).toBe(0);
    expect(placeStem(p, 'c_nope', stem, 'vocals').problem).toContain('unknown clip');
  });

  it('takes the sound of a video from its linked audio clip', () => {
    const { p, v, a } = project();
    expect(soundClipOf(p, getClip(p, v)!)?.id).toBe(a);
    const r = placeStem(p, v, stem, 'melody');
    expect(getClip(r.project, r.stemClipId!)).toMatchObject({ name: 'clutch (no drums)', start: 10, duration: 3, volume: 0 });
    expect(getClip(r.project, a)!.volume).toBe(MIN_VOLUME_DB);
  });

  it('lets the AI ask for a stem', () => {
    const { p, s, v, a, mute } = project();
    const run = (x: unknown, selection?: string[]) => applyAIActions(p, [x], { playhead: 0, selection });
    expect(run({ type: 'stems', clipId: s, stem: 'vocals' }).effects).toEqual([{ kind: 'stems', clipId: s, stem: 'vocals', engine: 'auto' }]);
    expect(run({ type: 'stems', clipId: s, keep: 'drums', engine: 'demucs' }).effects[0]).toMatchObject({ stem: 'drums', engine: 'demucs' });
    // a video and its own sound, selected together, are one clip with sound
    expect(run({ type: 'stems', clips: 'selected', stem: 'instrumental' }, [v, a]).effects).toEqual([{ kind: 'stems', clipId: v, stem: 'instrumental', engine: 'auto' }]);
    expect(run({ type: 'stems', clipId: s, stem: 'bass' }).results[0].detail).toContain('"stem" is "instrumental"');
    expect(run({ type: 'stems', clipId: s, stem: 'drums', engine: 'gpu' }).results[0].detail).toContain('"engine" is "auto"');
    expect(run({ type: 'stems', clipId: mute, stem: 'drums' }).results[0].detail).toContain('exactly one clip with sound');
    expect(run({ type: 'stems', clipIds: [s, v], stem: 'drums' }).results[0].detail).toContain('exactly one clip with sound');
  });
});
