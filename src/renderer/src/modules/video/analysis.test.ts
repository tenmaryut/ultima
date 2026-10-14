import { describe, expect, it } from 'vitest';
import { analyzeAudio, burstsOf, busiest, energyRises, estimateTempo, frameDifference, loudMoments, onsetEnvelope, sceneCuts, trackBeats } from './analysis';

const SR = 22050;

/** Seeded noise so the tests are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** Quiet noise with short bursts ("clicks") at the given times. */
function withClicks(seconds: number, clicks: number[], clickGain = 0.8, noise = 0.01, clickLen = 0.012): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const r = rng(7);
  for (let i = 0; i < out.length; i++) out[i] = r() * noise * 2;
  for (const t of clicks) {
    const from = Math.round(t * SR);
    for (let i = 0; i < clickLen * SR && from + i < out.length; i++) out[from + i] += clickGain * Math.sin((2 * Math.PI * 180 * i) / SR) * (1 - i / (clickLen * SR));
  }
  return out;
}

describe('music analysis', () => {
  it('finds the tempo and the beats of a click track', () => {
    const clicks = Array.from({ length: 40 }, (_, i) => 0.25 + i * 0.5); // 120 BPM
    const audio = withClicks(20.5, clicks);
    const { env, fps } = onsetEnvelope(audio, SR);
    const tempo = estimateTempo(env, fps)!;
    expect(tempo.bpm).toBeGreaterThan(117);
    expect(tempo.bpm).toBeLessThan(123);
    const beats = trackBeats(env, fps, tempo.bpm);
    const inner = beats.filter((b) => b > 2 && b < 18);
    expect(inner.length).toBeGreaterThan(25);
    for (const b of inner) expect(Math.min(...clicks.map((c) => Math.abs(c - b)))).toBeLessThan(0.04);
    // reported with the analysis latency added, beats land within ~20 ms of the clicks
    const a = analyzeAudio([audio], SR);
    const inner2 = a.beats!.beats.filter((b) => b > 2 && b < 18);
    for (const b of inner2) expect(Math.min(...clicks.map((c) => Math.abs(c - b)))).toBeLessThan(0.025);
  });

  it('reports beats, downbeats and hits together', () => {
    const clicks = Array.from({ length: 32 }, (_, i) => 0.1 + i * 0.4); // 150 BPM
    const a = analyzeAudio([withClicks(13.2, clicks)], SR);
    expect(a.beats?.bpm).toBeGreaterThan(146);
    expect(a.beats?.bpm).toBeLessThan(154);
    expect(a.beats!.downbeats.length).toBeGreaterThan(5);
    expect(a.hits.length).toBeGreaterThan(5);
    expect(a.duration).toBeCloseTo(13.2, 1);
  });

  it('does not invent a beat in steady noise', () => {
    const a = analyzeAudio([withClicks(10, [])], SR);
    expect(a.beats === null || a.beats.confidence < 0.5).toBe(true);
    expect(a.loud).toHaveLength(0);
  });
});

describe('action analysis', () => {
  it('finds loud moments and groups quick ones into bursts', () => {
    const shots = [2, 2.3, 2.6, 2.9, 7.5];
    const loud = loudMoments(withClicks(10, shots, 0.9, 0.004, 0.03), SR);
    expect(loud.length).toBe(5);
    loud.forEach((m, i) => expect(Math.abs(m.time - shots[i])).toBeLessThan(0.03));
    expect(burstsOf(loud)).toEqual([{ start: loud[0].time, end: loud[3].time, count: 4 }]);
  });

  it('finds where the sound gets louder', () => {
    const quiet = withClicks(10, [], 0, 0.003);
    const loud = withClicks(10, [], 0, 0.2);
    const both = new Float32Array(quiet.length + loud.length);
    both.set(quiet);
    both.set(loud, quiet.length);
    const rises = energyRises(both, SR);
    expect(rises).toHaveLength(1);
    expect(Math.abs(rises[0] - 10)).toBeLessThan(2.5);
  });
});

describe('scene changes', () => {
  it('compares frames and finds the cut', () => {
    const black = new Uint8ClampedArray(16).fill(0);
    const white = new Uint8ClampedArray(16).fill(255);
    expect(frameDifference(black, white)).toBeCloseTo(1);
    expect(frameDifference(black, black)).toBe(0);
    const times = [0, 0.5, 1, 1.5, 2, 2.5];
    const diffs = [0.02, 0.03, 0.6, 0.02, 0.025];
    expect(sceneCuts(diffs, times)).toEqual([1.25]);
    expect(busiest(diffs, times, 1)).toEqual([1.25]);
  });
});
