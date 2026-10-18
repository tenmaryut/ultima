import { describe, expect, it } from 'vitest';
import { addMusic, generatedId, generatedName, generatedRef, musicDrops, normalizeGenerated, plannedAnalysis, withPlannedAnalysis } from './generated';
import { applyAIActions } from './ai/executor';
import { describeProject } from './ai/describe';
import { addMediaToTimeline, clipEnd, createProject, getClip, getMedia, getTrack } from './model';
import { parseProject, serializeProject } from './project';
import { renderSfx, SFX } from './library';
import { valueAt } from './keyframes';
import type { GeneratedSound, MediaRef, Project } from './types';

const game: MediaRef = { id: 'm_game', name: 'clutch.mp4', kind: 'video', duration: 30, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true, fps: 60 };
const montage = (): Project => addMediaToTimeline({ ...createProject(), media: [game] }, game, { start: 0, duration: 24 }).project;
const run = (p: Project, actions: unknown[]) => applyAIActions(p, actions, { playhead: 3 });
const riser = SFX.find((x) => x.id === 'riser')!;

describe('generated sounds', () => {
  it('keep only valid recipes, each with its own media id and name', () => {
    const music = normalizeGenerated({ type: 'music', genre: 'phonk', bpm: 131.25, root: 6, scale: 'phrygian', length: 24, dropBars: 7, seed: 2 })!;
    expect(music).toEqual({ type: 'music', genre: 'phonk', bpm: 131.25, root: 6, scale: 'phrygian', length: 24, dropBars: 7, seed: 2 });
    expect(generatedName(music)).toBe('Phonk 131 BPM F# phrygian.wav');
    const sfx = normalizeGenerated({ type: 'sfx', sound: 'riser', duration: 99, pitch: -40, brightness: 0.5, seed: 3 }) as Extract<GeneratedSound, { type: 'sfx' }>;
    expect(sfx).toEqual({ type: 'sfx', sound: 'riser', duration: 30, pitch: -24, brightness: 0.5, seed: 3 });
    expect(generatedName(sfx)).toBe('Riser (30.0 s, -24, brighter, take 4).wav');
    expect([normalizeGenerated({ type: 'sfx', sound: 'kazoo' }), normalizeGenerated({ type: 'music', genre: 'polka' }), normalizeGenerated('x')]).toEqual([undefined, undefined, undefined]);
    expect(generatedId(music)).toMatch(/^lib_gen_[0-9a-z]+$/);
    expect(generatedId(music)).toBe(generatedId({ ...music }));
    expect(generatedId({ ...music, seed: 3 })).not.toBe(generatedId(music));
    // the media reference matches the file that will be made
    const ref = generatedRef(sfx);
    expect([ref.kind, ref.duration, ref.size, ref.generated]).toEqual(['audio', 30, 44 + 30 * 48000 * 4, sfx]);
  });

  it('a custom sound effect stretches, shifts and changes with its settings', () => {
    const own = renderSfx(riser);
    const long = renderSfx(riser, { duration: 5 });
    expect(long.length).toBe(5 * 48000);
    expect(renderSfx(riser, { duration: 5 })).toEqual(long);
    expect(renderSfx(riser, { seed: 2 })).not.toEqual(own);
    // an octave up: its rising tone climbs twice as fast through the same filter
    const zeros = (x: Float32Array, a: number, b: number) => {
      let n = 0;
      for (let i = a + 1; i < b; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
      return n;
    };
    const up = renderSfx(riser, { pitch: 12 });
    expect(zeros(up, 0, 24000) / zeros(own, 0, 24000)).toBeGreaterThan(1.5);
  });

  it('survive saving and opening the project', () => {
    const r = run(montage(), [{ type: 'generateMusic', genre: 'edm', dropAt: 8 }, { type: 'addSfx', sound: 'riser', duration: 4, endAt: 8 }]);
    const back = parseProject(serializeProject(r.project));
    const made = back.media.filter((m) => m.generated);
    expect(made.map((m) => m.generated!.type).sort()).toEqual(['music', 'sfx']);
    expect(made.map((m) => m.id)).toEqual(r.project.media.filter((m) => m.generated).map((m) => m.id));
    // a recipe only belongs to its own kind of id
    const raw = JSON.parse(serializeProject(r.project));
    raw.media.push({ ...raw.media.find((m: MediaRef) => m.generated), id: 'm_other' });
    expect(getMedia(parseProject(raw), 'm_other')?.generated).toBeUndefined();
  });
});

describe('music on the timeline', () => {
  it('lands the drop exactly where asked', () => {
    // 12.8 s is 7 bars at 131.25 BPM: the tempo moves a little
    const a = addMusic(montage(), { genre: 'phonk', length: 24, start: 0, dropAt: 12.8, seed: 2 });
    expect([a.spec.bpm, a.spec.dropBars, a.trim]).toEqual([131.25, 7, 0]);
    expect(a.drops[0]).toBeCloseTo(12.8, 9);
    const clip = getClip(a.project, a.clipId)!;
    expect([clip.start, clip.duration, clip.in, getTrack(a.project, clip.trackId)?.name]).toEqual([0, 24, 0, 'A2']);
    // 12.31 s is not: the tempo stays and the start of the intro is cut
    const b = addMusic(montage(), { genre: 'phonk', bpm: 130, length: 24, start: 0, dropAt: 12.31 });
    const cb = getClip(b.project, b.clipId)!;
    expect(b.spec.bpm).toBe(130);
    expect(cb.in).toBeCloseTo(b.trim, 9);
    expect(b.drops[0]).toBeCloseTo(12.31, 9);
    expect(musicDrops(b.project, b.clipId)[0]).toBeCloseTo(12.31, 6);
    expect(clipEnd(cb)).toBeCloseTo(24, 6);
    // the parts in order on the clip
    expect(b.sections[0].start).toBe(0);
    expect(b.sections.find((s) => s.kind === 'drop')!.start).toBeCloseTo(12.31, 6);
  });

  it('knows its beats exactly, before the file exists', () => {
    const a = addMusic(montage(), { genre: 'edm', length: 30, start: 0, dropAt: 15 });
    const media = getMedia(a.project, getClip(a.project, a.clipId)!.mediaId)!;
    const an = plannedAnalysis(media.generated as Extract<GeneratedSound, { type: 'music' }>).audio!;
    expect(an.beats!.bpm).toBe(128);
    expect(an.beats!.beats.slice(0, 3)).toEqual([0, 0.469, 0.938]);
    expect(an.beats!.downbeats[1]).toBeCloseTo(1.875, 3);
    expect(an.rises[0]).toBe(15);
    const get = withPlannedAnalysis(() => a.project, () => 'pending');
    expect(get(media.id)).not.toBe('pending');
    expect(get('m_game')).toBe('pending');
  });
});

describe('the AI and generated sounds', () => {
  it('makes music for the montage, with the drop on the big moment', () => {
    const r = run(montage(), [{ type: 'generateMusic', genre: 'drift phonk', key: 'C# minor', dropAt: 9.6, variation: 5 }]);
    expect(r.results[0].ok).toBe(true);
    const detail = r.results[0].detail;
    expect(detail).toMatch(/added music c_\w+ "Phonk \d+ BPM C# minor" on A2 at 0.00 s–24.00 s/);
    expect(detail).toContain('the drop lands at 9.60 s');
    expect(detail).toMatch(/parts \(s\): intro 0\.00–[\d.]+, build [\d.]+–9\.60, drop 9\.60/);
    const music = r.project.media.find((m) => m.generated?.type === 'music')!;
    expect(music.generated).toMatchObject({ genre: 'phonk', root: 1, scale: 'minor', seed: 5 });
    expect(describeProject(r.project, { playhead: 0, selection: [] })).toMatch(/its drop lands at 9\.60 s/);
    expect(describeProject(r.project, { playhead: 0, selection: [] })).toContain('generated Phonk music');
  });

  it('follows the new music right away with beat effects', () => {
    const r = run(montage(), [
      { type: 'generateMusic', genre: 'edm', length: 'full', dropAt: 15 },
      { type: 'beatSync', effect: 'zoom', on: 'bars', from: 15 },
    ]);
    expect(r.results.map((x) => x.ok)).toEqual([true, true]);
    expect(r.results[1].detail).toMatch(/zoom pulses on \d+ bars/);
    // the first pulse peaks on the drop
    const layer = r.project.clips.find((c) => c.kind === 'adjustment')!;
    expect(valueAt(layer, 'scale', 15 - layer.start)).toBeGreaterThan(1);
  });

  it('refuses what it cannot make', () => {
    const p = montage();
    expect(run(p, [{ type: 'generateMusic', genre: 'polka' }]).results[0].detail).toContain('"genre" is one of phonk');
    expect(run(p, [{ type: 'generateMusic', key: 'H minor' }]).results[0].detail).toContain('"key" is like');
    expect(run(p, [{ type: 'generateMusic', dropAt: 40 }]).results[0].detail).toContain('"dropAt" must be');
    expect(run(p, [{ type: 'generateMusic', bpm: 900 }]).results[0].detail).toContain('"bpm" is 60–200');
  });

  it('makes custom sound effects, and ends them on a moment', () => {
    const r = run(montage(), [
      { type: 'addSfx', sound: 'riser', duration: 4.5, pitch: -3, endAt: 9.6 },
      { type: 'addSfx', sound: 'snare roll', endTimes: [1, 20] },
      { type: 'addSfx', sound: 'impact', at: 9.6 },
    ]);
    expect(r.results.every((x) => x.ok)).toBe(true);
    const [riserClip] = r.project.clips.filter((c) => c.name === 'Riser');
    expect([riserClip.start, clipEnd(riserClip)]).toEqual([5.1, 9.6]);
    expect(getMedia(r.project, riserClip.mediaId)?.generated).toMatchObject({ type: 'sfx', sound: 'riser', duration: 4.5, pitch: -3 });
    expect(r.results[0].detail).toContain('made for this project');
    // a roll that would start before 0 s is cut at its start; the library one is reused as it is
    const rolls = r.project.clips.filter((c) => c.name === 'Snare roll').sort((a, b) => a.start - b.start);
    expect(rolls.map((c) => [c.start, c.in, clipEnd(c)])).toEqual([
      [0, 1, 1],
      [18, 0, 20],
    ]);
    expect(rolls[0].mediaId).toBe('lib_sfx_snareRoll');
    expect(run(montage(), [{ type: 'addSfx', sound: 'riser', duration: 99 }]).results[0].detail).toContain('"duration" is 0.03–30 seconds');
  });
});
