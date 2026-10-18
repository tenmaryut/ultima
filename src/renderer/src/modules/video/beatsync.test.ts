import { describe, expect, it } from 'vitest';
import { applyBeatSync, beatTimes, pulseKeys } from './beatsync';
import { applyAIActions } from './ai/executor';
import { VIDEO_AI_INSTRUCTIONS } from './ai/instructions';
import { addMediaToTimeline, clipEnd, createProject, getClip, tracksOfKind, updateClip } from './model';
import { keyValue, valueAt } from './keyframes';
import type { MediaRef, Project } from './types';
import type { MediaAnalysis } from './analysisStore';
import type { AudioAnalysis } from './analysis';

const game: MediaRef = { id: 'm_game', name: 'clutch.mp4', kind: 'video', duration: 30, width: 1920, height: 1080, size: 1, mime: 'video/mp4', hasAudio: true };
const song: MediaRef = { id: 'm_song', name: 'phonk.mp3', kind: 'audio', duration: 60, width: 0, height: 0, size: 1, mime: 'audio/mpeg', hasAudio: true };

function audio(extra: Partial<AudioAnalysis>): MediaAnalysis {
  return {
    audio: { duration: 60, beats: null, hits: [], loud: [], bursts: [], rises: [], envelope: { rate: 20, db: new Float32Array(0) }, ...extra },
    scenes: null,
    analysedSeconds: 60,
  };
}

/** A song beating every 0.5 s (bars every 2 s) and gameplay with two shots and a kill. */
const ANALYSIS: Record<string, MediaAnalysis> = {
  m_song: audio({ beats: { bpm: 120, period: 0.5, beats: Array.from({ length: 120 }, (_, i) => i * 0.5), downbeats: Array.from({ length: 30 }, (_, i) => i * 2), confidence: 0.9 }, hits: [4, 8] }),
  m_game: audio({
    beats: { bpm: 97, period: 0.62, beats: [1, 1.6, 2.3], downbeats: [1], confidence: 0.2 },
    hits: [3.05],
    loud: [
      { time: 3, db: -4, prominence: 18 },
      { time: 5.5, db: -2, prominence: 22 },
    ],
  }),
};
const analysis = (id: string): MediaAnalysis | null => ANALYSIS[id] ?? null;

/** V1: gameplay 0–10 s (from 2 s into the file, +A1); A2: the song 0–10 s. */
function project(): { p: Project; v: string; music: string } {
  let p: Project = { ...createProject(), media: [game, song] };
  const r1 = addMediaToTimeline(p, game, { start: 0, duration: 10 });
  p = updateClip(r1.project, r1.ids[0], (c) => ({ ...c, in: 2 }));
  const linked = r1.ids.find((id) => getClip(p, id)?.kind === 'audio')!;
  p = updateClip(p, linked, (c) => ({ ...c, in: 2 }));
  const a2 = tracksOfKind(p, 'audio')[1].id;
  const r2 = addMediaToTimeline(p, song, { start: 0, duration: 10, trackId: a2 });
  return { p: r2.project, v: r1.ids[0], music: r2.ids[0] };
}

describe('beat times', () => {
  it('follows the steadiest music for beats and bars, in timeline seconds', () => {
    const { p, music } = project();
    const beats = beatTimes(p, analysis, { effect: 'impact', on: 'beats', from: 1, to: 3 });
    expect(beats.sourceClipIds).toEqual([music]);
    expect(beats.times).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(beatTimes(p, analysis, { effect: 'impact', on: 'beats', from: 1, to: 3, every: 2 }).times).toEqual([1, 2, 3]);
    expect(beatTimes(p, analysis, { effect: 'impact', on: 'bars' }).times).toEqual([0, 2, 4, 6, 8, 10]);
    // a song that starts later on the timeline, 1 s into its file: its bars move with it
    const later = updateClip(p, music, (c) => ({ ...c, start: 3, in: 1, duration: 6 }));
    expect(beatTimes(later, analysis, { effect: 'impact', on: 'bars' }).times).toEqual([4, 6, 8]);
  });

  it('follows every clip with sound for hits and loud moments, once per moment', () => {
    const { p, v } = project();
    // the gameplay starts 2 s into its file: its shots at 3 and 5.5 s play at 1 and 3.5 s
    const loud = beatTimes(p, analysis, { effect: 'shake', on: 'loud' });
    expect(loud.times).toEqual([1, 3.5]);
    expect(loud.sourceClipIds).toContain(v);
    // the gameplay's hit (1.05 s) falls on the same moment as its shot sound: the song's hits stay
    const hits = beatTimes(p, analysis, { effect: 'shake', on: 'hits', sourceClipId: v });
    expect(hits.times).toEqual([1.05]);
    expect(beatTimes(p, analysis, { effect: 'shake', on: 'hits' }).times).toEqual([1.05, 4, 8]);
  });

  it('a video’s linked sound stands for the video, and it says why nothing was found', () => {
    const { p, v } = project();
    const linked = p.clips.find((c) => c.kind === 'audio' && c.linkId === getClip(p, v)!.linkId)!;
    expect(beatTimes(p, analysis, { effect: 'flash', on: 'loud', sourceClipId: linked.id }).times).toEqual([1, 3.5]);
    expect(beatTimes(p, () => 'pending', { effect: 'flash', on: 'beats' }).reason).toBe('noSound');
    expect(beatTimes(p, (id) => (id === 'm_game' ? audio({}) : undefined), { effect: 'flash', on: 'beats' }).reason).toBe('noBeat');
    expect(beatTimes(p, analysis, { effect: 'flash', on: 'beats', sourceClipId: 'c_nope' }).reason).toBe('source');
    const none = beatTimes(p, analysis, { effect: 'flash', on: 'loud', from: 6, to: 9 });
    expect(none.reason).toBe('none');
    expect(none.problem).toBe('no loud found in 6.00–9.00 s');
  });
});

describe('pulses', () => {
  const shake = { prop: 'shake' as const, rest: 0, peak: 70, attack: 0.02, decay: 0.28 };

  it('rises into each beat, peaks on it and settles before the next one', () => {
    const keys = pulseKeys(shake, [1, 1.2, 1.21, 3], 1, 10);
    // the beat 0.01 s after another gets no pulse; the decay is cut short before the next beat
    expect(keys.filter((k) => k.v === 70).map((k) => k.t)).toEqual([1, 1.2, 3]);
    // a beat right at the start peaks at once
    expect(pulseKeys(shake, [0, 1], 1, 10).slice(0, 2)).toEqual([
      { t: 0, v: 70, ease: 'easeOut' },
      { t: 0.28, v: 0, ease: 'linear' },
    ]);
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
    expect(keyValue(keys, 1.17, 0)).toBeLessThan(5);
    expect(keyValue(keys, 2, 0)).toBe(0);
    expect(pulseKeys(shake, [1], 2, 10)[1].v).toBe(140);
    // never past the property's range nor outside the clip
    expect(pulseKeys({ ...shake, peak: 300 }, [1], 2, 10)[1].v).toBe(400);
    expect(pulseKeys(shake, [-1, 11], 1, 10)).toEqual([]);
  });
});

describe('applying', () => {
  it('adds an adjustment layer over the footage, so everything below reacts', () => {
    const { p } = project();
    const r = applyBeatSync(p, analysis, { effect: 'impact', on: 'beats', from: 2, to: 4 });
    expect(r.count).toBe(5);
    const layer = getClip(r.project, r.clipIds[0])!;
    expect(layer.kind).toBe('adjustment');
    expect(layer.name).toBe('Beat FX: Impact');
    expect(tracksOfKind(r.project, 'video').findIndex((t) => t.id === layer.trackId)).toBeGreaterThan(0);
    expect(layer.start).toBeCloseTo(1.9);
    expect(clipEnd(layer)).toBeCloseTo(4.5);
    // on a beat: zoomed in, shaking, brighter and split; between beats back to normal
    const at = (t: number) => (prop: 'scale' | 'shake' | 'brightness' | 'rgbSplit') => valueAt(layer, prop, t - layer.start);
    expect(at(3)('scale')).toBeCloseTo(1.12);
    expect(at(3)('shake')).toBe(45);
    expect(at(3)('brightness')).toBe(35);
    expect(at(3)('rgbSplit')).toBe(14);
    expect(at(3.45)('scale')).toBe(1);
    expect(at(3.45)('shake')).toBe(0);
  });

  it('rides on a clip’s own zoom and animation, keeping its shape between beats', () => {
    const { p, v } = project();
    const zoomed = updateClip(p, v, (c) => ({ ...c, visual: { ...c.visual!, scale: 1.3, brightness: 10 } }));
    const r = applyBeatSync(zoomed, analysis, { effect: 'zoom', on: 'loud', targetClipIds: [v] });
    const c = getClip(r.project, v)!;
    expect(r.clipIds).toEqual([v]);
    expect(valueAt(c, 'scale', 1)).toBeCloseTo(1.3 * 1.16);
    expect(valueAt(c, 'scale', 2)).toBe(1.3);
    expect(valueAt(c, 'scale', 9)).toBe(1.3);
    // a slow eased push-in from 1 to 2 over the clip keeps going under the pulses
    const pushIn = updateClip(p, v, (x) => ({ ...x, keys: { scale: [{ t: 0, v: 1, ease: 'easeInOut' }, { t: 10, v: 2, ease: 'linear' }] } }));
    const own = getClip(pushIn, v)!;
    const q = getClip(applyBeatSync(pushIn, analysis, { effect: 'zoom', on: 'loud', targetClipIds: [v] }).project, v)!;
    expect(valueAt(q, 'scale', 3.5)).toBeCloseTo(valueAt(own, 'scale', 3.5) * 1.16, 3);
    for (const t of [0.5, 2, 2.7, 5, 7.5, 9.9]) expect(valueAt(q, 'scale', t)).toBeCloseTo(valueAt(own, 'scale', t), 2);
    expect(valueAt(q, 'scale', 10)).toBe(2);
  });

  it('runs from the AI, which finds its targets and says what it followed', () => {
    const { p, v, music } = project();
    const run = (actions: unknown[]) => applyAIActions(p, actions, { playhead: 0, selection: [], analysis });
    const r = run([{ type: 'beatSync', effect: 'shake', on: 'bars', to: 6 }]);
    expect(r.results[0].ok).toBe(true);
    expect(r.results[0].detail).toMatch(new RegExp(`^shake pulses on 4 bars \\(following ${music}\\) on c_\\w+ — a new adjustment layer`));
    const onClip = run([{ type: 'beatSync', effect: 'rgbSplit', on: 'loud', clipId: v, amount: 5 }]);
    expect(onClip.results[0].detail).toContain(`rgbSplit pulses on 2 loud`);
    // the amount is limited to twice the preset
    expect(valueAt(getClip(onClip.project, v)!, 'rgbSplit', 1)).toBe(52);
    expect(run([{ type: 'beatSync', effect: 'explode' }]).results[0].detail).toContain('"effect" must be one of impact, shake');
    expect(run([{ type: 'beatSync', on: 'loud', from: 6, to: 9 }]).results[0].detail).toContain('no loud found in 6.00–9.00 s');
    expect(applyAIActions(p, [{ type: 'beatSync' }], { playhead: 0 }).results[0].detail).toContain('no clip with analysed sound');
    expect(VIDEO_AI_INSTRUCTIONS).toContain('{"type":"beatSync"');
  });
});
