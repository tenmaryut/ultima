import { describe, expect, it } from 'vitest';
import { activeRanges, duckKeys, noiseFloor, type Envelope } from './ducking';
import { audioFxActive, fxTail, impulseResponse } from './audiofx';
import { applyAIActions } from './ai/executor';
import { describeProject } from './ai/describe';
import { addMediaToTimeline, createProject, getClip, updateClip } from './model';
import { parseProject, serializeProject } from './project';
import { keyValue } from './keyframes';
import type { Clip, MediaRef, Project } from './types';
import type { MediaAnalysis } from './analysisStore';

/** 20 values per second: quiet (−60 dB) except loud (−15 dB) during the given seconds. */
function envelope(seconds: number, loud: [number, number][]): Envelope {
  const db = new Float32Array(seconds * 20).fill(-60);
  for (const [a, b] of loud) for (let i = Math.round(a * 20); i < Math.round(b * 20); i++) db[i] = -15;
  return { rate: 20, db };
}

const clip = (start: number, duration: number, extra: Partial<Clip> = {}) =>
  ({ id: 'c', kind: 'audio', trackId: 't', name: 'x', start, duration, in: 0, speed: 1, keepPitch: true, volume: 0, fadeIn: 0, fadeOut: 0, ...extra }) as Clip;

describe('finding where the other sound is loud', () => {
  it('maps loud stretches to the timeline and bridges short gaps', () => {
    const env = envelope(20, [
      [2, 3],
      [3.2, 4],
      [10, 10.05],
      [12, 14],
    ]);
    expect(noiseFloor(env)).toBe(-60);
    const ranges = activeRanges([{ clip: clip(5, 15), env }]);
    expect(ranges.map((r) => [+r.start.toFixed(2), +r.end.toFixed(2)])).toEqual([
      [7, 9],
      [17, 19],
    ]);
  });

  it('follows the trigger clip’s in-point and volume', () => {
    const env = envelope(20, [[6, 8]]);
    // the clip starts 5 s into its file: the loud part plays at 1–3 s on the timeline
    expect(activeRanges([{ clip: clip(0, 10, { in: 5 }), env }]).map((r) => [+r.start.toFixed(2), +r.end.toFixed(2)])).toEqual([[1, 3]]);
    // turned down by 30 dB it is no longer loud enough for a fixed threshold
    expect(activeRanges([{ clip: clip(0, 10, { volume: -30 }), env }], { threshold: -30 })).toEqual([]);
  });
});

describe('ducking keyframes', () => {
  it('dips the music around each range and joins dips that would overlap', () => {
    const music = clip(0, 30, { volume: -3 });
    const keys = duckKeys(music, [
      { start: 5, end: 8 },
      { start: 8.5, end: 9 },
      { start: 20, end: 22 },
    ], { amount: -12, attack: 0.2, release: 0.5 })!;
    expect(keys.map((k) => [+k.t.toFixed(2), k.v])).toEqual([
      [4.8, -3],
      [5, -15],
      [9, -15],
      [9.5, -3],
      [19.8, -3],
      [20, -15],
      [22, -15],
      [22.5, -3],
    ]);
    expect(keyValue(keys, 7, -3)).toBe(-15);
    expect(duckKeys(music, [{ start: 40, end: 41 }])).toBeUndefined();
  });
});

describe('sound effects', () => {
  it('knows when a chain is needed and how long its tail is', () => {
    expect(audioFxActive(clip(0, 1))).toBe(false);
    expect(audioFxActive(clip(0, 1, { audioFx: { highPass: 0, lowPass: 600, eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0, reverbSize: 1 } }))).toBe(true);
    expect(fxTail(clip(0, 1, { audioFx: { highPass: 0, lowPass: 0, eqLow: 0, eqMid: 0, eqHigh: 0, reverb: 0.3, reverbSize: 2 } }))).toBeCloseTo(2.1);
    expect(audioFxActive(clip(0, 1, { keys: { lowPass: [{ t: 0, v: 500, ease: 'linear' }] } }))).toBe(true);
  });

  it('builds the same decaying reverb every time', () => {
    const a = impulseResponse(1000, 2);
    expect(a).toHaveLength(2);
    expect(a[0]).toEqual(impulseResponse(1000, 2)[0]);
    const energy = (from: number, to: number) => a[0].slice(from, to).reduce((s, v) => s + v * v, 0);
    expect(energy(1800, 2000)).toBeLessThan(energy(100, 300) / 50);
  });
});

describe('the AI and sound', () => {
  const video: MediaRef = { id: 'm_v', name: 'game.mp4', kind: 'video', duration: 20, width: 1280, height: 720, size: 1, mime: 'video/mp4', hasAudio: true };
  const song: MediaRef = { id: 'm_s', name: 'song.mp3', kind: 'audio', duration: 60, width: 0, height: 0, size: 1, mime: 'audio/mpeg', hasAudio: true };
  function project(): { p: Project; v: string; music: string } {
    const r1 = addMediaToTimeline({ ...createProject(), media: [video, song] }, video, { start: 0, duration: 20 });
    const music = r1.project.tracks.find((t) => t.name === 'A2')!;
    const r2 = addMediaToTimeline(r1.project, song, { start: 0, duration: 20, trackId: music.id });
    return { p: r2.project, v: r1.ids[0], music: r2.ids[0] };
  }
  const analysis = (id: string): MediaAnalysis | null =>
    id === 'm_v' ? { audio: { duration: 20, beats: null, hits: [], loud: [], bursts: [], rises: [], envelope: envelope(20, [[4, 6]]) }, scenes: null, analysedSeconds: 20 } : null;
  const run = (p: Project, actions: unknown[]) => applyAIActions(p, actions, { playhead: 0, analysis });

  it('puts a sound preset on a video’s linked audio and animates the muffle', () => {
    const { p, v } = project();
    const r = run(p, [
      { type: 'setClip', clipId: v, props: { audioPreset: 'Phone call', reverb: 30 } },
      { type: 'keyframes', clipId: v, prop: 'lowPass', keys: [{ t: 1, v: 20000 }, { t: 1.2, v: 500 }] },
    ]);
    const sound = r.project.clips.find((c) => c.kind === 'audio' && c.linkId === getClip(p, v)!.linkId)!;
    expect(sound.audioFx).toMatchObject({ highPass: 450, lowPass: 3200, eqMid: 6, reverb: 0.3 });
    expect(sound.keys?.lowPass).toHaveLength(2);
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(describeProject(r.project, { playhead: 0, selection: [] })).toContain('sound: low cut 450 Hz, high cut 3200 Hz, mids +6 dB, reverb 30% 1.5s');
    const back = getClip(parseProject(serializeProject(r.project)), sound.id)!;
    expect(back.audioFx).toEqual(sound.audioFx);
    expect(back.keys?.lowPass).toEqual(sound.keys?.lowPass);
  });

  it('ducks the music under the game sound', () => {
    const { p, music } = project();
    const r = run(p, [{ type: 'duck', clipId: music, amount: 10 }]);
    expect(r.results[0].ok).toBe(true);
    expect(r.results[0].detail).toContain('lowered 1 clip(s) by 10 dB');
    const keys = getClip(r.project, music)!.keys!.volume!;
    expect(keyValue(keys, 5, 0)).toBe(-10);
    expect(keyValue(keys, 10, 0)).toBe(0);
    // still analysing
    const pending = applyAIActions(p, [{ type: 'duck', clipId: music }], { playhead: 0, analysis: () => 'pending' });
    expect(pending.results[0].detail).toContain('still being analysed');
    expect(run(updateClip(p, music, (c) => c), [{ type: 'duck', clipId: music, trigger: 'A2' }]).results[0].ok).toBe(false);
  });
});
