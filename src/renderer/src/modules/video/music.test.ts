import { describe, expect, it } from 'vitest';
import { GENRES, SCALES, fitDrop, normalizeMusicSpec, parseKey, planMusic, planSections, renderMusic, type MusicSpec } from './music';
import { analyzeAudio } from './analysis';

const spec = (o: Partial<MusicSpec> = {}): MusicSpec => ({ genre: 'phonk', bpm: 130, root: 6, scale: 'phrygian', length: 40, dropBars: 4, seed: 3, ...o });
const rmsDb = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20);
};

describe('the music generator', () => {
  it('reads keys', () => {
    expect(parseKey('F#')).toEqual({ root: 6 });
    expect(parseKey('F# minor')).toEqual({ root: 6, scale: 'minor' });
    expect(parseKey('Am')).toEqual({ root: 9, scale: 'minor' });
    expect(parseKey('Bb major')).toEqual({ root: 10, scale: 'major' });
    expect(parseKey('c phrygian')).toEqual({ root: 0, scale: 'phrygian' });
    expect(parseKey('E harmonic minor')).toEqual({ root: 4, scale: 'harmonicMinor' });
    expect(parseKey('Cb')).toEqual({ root: 11 });
    expect([parseKey('H'), parseKey('C lydian'), parseKey(5)]).toEqual([null, null, null]);
  });

  it('plans intro, build-up, drops and outro that fill the song, with the drop where asked', () => {
    expect(planSections(32, 8)).toEqual([
      { kind: 'intro', from: 0, bars: 4 },
      { kind: 'build', from: 4, bars: 4 },
      { kind: 'drop', from: 8, bars: 8 },
      { kind: 'break', from: 16, bars: 4 },
      { kind: 'build', from: 20, bars: 2 },
      { kind: 'drop', from: 22, bars: 6 },
      { kind: 'outro', from: 28, bars: 4 },
    ]);
    expect(planSections(8, 0).map((s) => s.kind)).toEqual(['drop', 'outro']);
    expect(planSections(3, 1).map((s) => s.kind)).toEqual(['build', 'drop']);
    for (let total = 1; total <= 80; total++) {
      for (let drop = 0; drop <= total + 2; drop++) {
        const s = planSections(total, drop, 8);
        // back to back, all the bars, the first drop exactly after `drop` bars
        expect(s.reduce((n, x) => n + x.bars, 0)).toBe(total);
        s.forEach((x, i) => expect(x.from).toBe(i ? s[i - 1].from + s[i - 1].bars : 0));
        if (drop < total) expect(s.find((x) => x.kind === 'drop')?.from).toBe(drop);
      }
    }
  });

  it('lands a drop on a bar: a nudge of the tempo, or a cut intro', () => {
    expect(fitDrop(128, 15)).toEqual({ bpm: 128, dropBars: 8, trim: 0 });
    expect(fitDrop(130, 12.8)).toEqual({ bpm: 131.25, dropBars: 7, trim: 0 });
    // 136 BPM would be 5 % off: keep 130 and cut the start of the intro
    const cut = fitDrop(130, 12.31);
    expect([cut.bpm, cut.dropBars]).toEqual([130, 7]);
    expect(7 * (240 / 130) - cut.trim).toBeCloseTo(12.31, 9);
    expect(fitDrop(140, 0.01)).toEqual({ bpm: 140, dropBars: 0, trim: 0 });
    expect(fitDrop(140, 0.5).dropBars).toBe(1);
  });

  it('keeps its settings in range', () => {
    expect(normalizeMusicSpec({ genre: 'trap', bpm: 999, length: -5, dropBars: 1e9, seed: -2, scale: 'weird' })).toEqual({ genre: 'trap', bpm: 200, root: 9, scale: 'harmonicMinor', length: 4, dropBars: 128, seed: 0 });
    expect(normalizeMusicSpec({ genre: 'polka' })).toBeUndefined();
  });

  it('writes the same notes for the same settings, other notes for another variation, all in the key', () => {
    for (const g of GENRES) {
      const s = spec({ genre: g.id, scale: g.scale, root: 2, dropBars: g.dropBars });
      const a = planMusic(s);
      expect(planMusic(s).events).toEqual(a.events);
      expect(planMusic({ ...s, seed: 4 }).events).not.toEqual(a.events);
      expect(a.drops[0]).toBeCloseTo(g.dropBars * a.bar, 9);
      const scale = new Set(SCALES[g.scale]);
      for (const e of a.events) if (e.note !== undefined) expect(scale.has((((e.note - 2) % 12) + 12) % 12), `${g.id} ${e.inst} ${e.note}`).toBe(true);
      // nothing before the drop plays the drop's heavy parts
      const heavy = a.events.filter((e) => ['bass808', 'wobble', 'reese', 'stab', 'braam'].includes(e.inst));
      expect(heavy.every((e) => e.t >= a.drops[0] - 1e-9 || e.t >= a.sections.find((x) => x.kind === 'outro')?.start! - 1e-9)).toBe(true);
    }
  });

  it('plays a song whose drop is clearly louder than its intro, on tempo, without clipping', { timeout: 60_000 }, async () => {
    const s = spec({ length: 20 });
    const pcm = await renderMusic(s);
    const [l] = pcm.channels;
    expect(l.length).toBe(20 * pcm.sampleRate);
    let peak = 0;
    for (const v of l) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.85);
    expect(peak).toBeLessThanOrEqual(0.921);
    const plan = planMusic(s);
    const at = (t: number) => Math.round(t * pcm.sampleRate);
    const intro = rmsDb(l, 0, at(plan.drops[0]) - at(plan.bar));
    const drop = rmsDb(l, at(plan.drops[0]), at(plan.drops[0] + 4 * plan.bar));
    expect(drop - intro).toBeGreaterThan(6);
    // the app's own beat tracking finds its tempo
    expect(analyzeAudio(pcm.channels, pcm.sampleRate).beats?.bpm).toBeCloseTo(130, 0);
  });

  it('plays every genre', { timeout: 120_000 }, async () => {
    for (const g of GENRES) {
      const pcm = await renderMusic(spec({ genre: g.id, scale: g.scale, length: 12, dropBars: 2, bpm: g.bpm }));
      let bad = 0;
      let energy = 0;
      for (const v of pcm.channels[1]) {
        if (!Number.isFinite(v) || Math.abs(v) > 0.93) bad++;
        energy += v * v;
      }
      expect([g.id, bad]).toEqual([g.id, 0]);
      expect(energy / pcm.channels[1].length, g.id).toBeGreaterThan(1e-3);
    }
  });

  it('can be stopped', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(renderMusic(spec({ length: 60 }), { signal: ctrl.signal })).rejects.toThrow('Cancelled');
  });
});
