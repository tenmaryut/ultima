import type { StemPcm } from './stems';
import { addDelay, addReverb, duckAt, lowPass, master, mixNote, renderNote, rng, type Inst, type Mix, type NoteEvent, type Rendered } from './synth';

/*
 * The music generator (pure, unit tested): royalty-free songs for montages, made on this computer. A genre gives
 * the tempo, the scale, the chords and the parts; a seed picks the chord progression, the melodies and the drum
 * variations, so the same settings always make the same song. The song is planned as notes first — intro, build-up,
 * drop, break, second drop, outro — with the drop exactly `dropBars` bars in, then played by the instruments in
 * synth.ts.
 */

export type Genre = 'phonk' | 'trap' | 'edm' | 'dubstep' | 'dnb' | 'lofi' | 'cinematic';
export type ScaleName = 'minor' | 'phrygian' | 'harmonicMinor' | 'dorian' | 'major';
export type SectionKind = 'intro' | 'build' | 'drop' | 'break' | 'outro';

export interface GenreInfo {
  id: Genre;
  label: string;
  description: string;
  bpm: number;
  min: number;
  max: number;
  scale: ScaleName;
  /** Bars before the first drop when nothing else is asked. */
  dropBars: number;
}

export const GENRES: GenreInfo[] = [
  { id: 'phonk', label: 'Phonk', description: 'drift phonk: cowbell melody, distorted 808, hard kicks', bpm: 130, min: 100, max: 160, scale: 'phrygian', dropBars: 4 },
  { id: 'trap', label: 'Trap', description: 'half-time drums, hi-hat rolls, sliding 808, dark bells', bpm: 140, min: 120, max: 170, scale: 'harmonicMinor', dropBars: 4 },
  { id: 'edm', label: 'EDM', description: 'festival build-up and drop: supersaw chords, pumping bass', bpm: 128, min: 115, max: 140, scale: 'minor', dropBars: 8 },
  { id: 'dubstep', label: 'Dubstep', description: 'heavy half-time drop with a wobble bass', bpm: 140, min: 130, max: 150, scale: 'minor', dropBars: 8 },
  { id: 'dnb', label: 'Drum & bass', description: 'fast breakbeat and a rolling reese bass', bpm: 174, min: 160, max: 180, scale: 'minor', dropBars: 8 },
  { id: 'lofi', label: 'Lo-fi', description: 'chill swung beat, warm electric piano, vinyl crackle', bpm: 84, min: 65, max: 100, scale: 'dorian', dropBars: 2 },
  { id: 'cinematic', label: 'Cinematic', description: 'epic trailer: ticking build-up, taikos, braams and impacts', bpm: 100, min: 80, max: 120, scale: 'minor', dropBars: 4 },
];

export const genreInfo = (g: Genre): GenreInfo => GENRES.find((x) => x.id === g)!;

export const SCALES: Record<ScaleName, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export const SCALE_LABELS: Record<ScaleName, string> = { minor: 'minor', phrygian: 'phrygian', harmonicMinor: 'harmonic minor', dorian: 'dorian', major: 'major' };

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** What a song is made from (all that is needed to make it again). */
export interface MusicSpec {
  genre: Genre;
  bpm: number;
  /** Key note: 0 = C … 11 = B. */
  root: number;
  scale: ScaleName;
  /** Seconds. */
  length: number;
  /** Bars before the first drop (0 = it starts with the drop). */
  dropBars: number;
  seed: number;
}

export const MUSIC_LIMITS = { minLength: 4, maxLength: 300, minBpm: 60, maxBpm: 200, maxDropBars: 128 };

/** A key from text: "F#", "F# minor", "Am", "Bb major", "C phrygian"… (the scale is undefined when not named). */
export function parseKey(text: unknown): { root: number; scale?: ScaleName } | null {
  if (typeof text !== 'string') return null;
  const m = /^\s*([a-g])\s*([#♯b♭]?)\s*(.*)$/i.exec(text);
  if (!m) return null;
  let root = NOTE_NAMES.indexOf(m[1].toUpperCase());
  if (m[2] === '#' || m[2] === '♯') root += 1;
  else if (m[2] === 'b' || m[2] === '♭') root -= 1;
  root = (root + 12) % 12;
  const rest = m[3].trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!rest) return { root };
  const scale = SCALE_WORDS[rest];
  return scale ? { root, scale } : null;
}

const SCALE_WORDS: Record<string, ScaleName> = {
  m: 'minor',
  min: 'minor',
  minor: 'minor',
  aeolian: 'minor',
  phrygian: 'phrygian',
  harmonic: 'harmonicMinor',
  harmonicminor: 'harmonicMinor',
  dorian: 'dorian',
  maj: 'major',
  major: 'major',
  ionian: 'major',
};

export const keyName = (root: number, scale: ScaleName) => `${NOTE_NAMES[((root % 12) + 12) % 12]} ${SCALE_LABELS[scale]}`;

/** The name of a song: "Phonk 130 BPM F# phrygian". */
export const musicTitle = (s: MusicSpec) => `${genreInfo(s.genre).label} ${Math.round(s.bpm)} BPM ${keyName(s.root, s.scale)}`;

const isGenre = (v: unknown): v is Genre => GENRES.some((g) => g.id === v);
const isScale = (v: unknown): v is ScaleName => typeof v === 'string' && v in SCALES;

/** A valid spec from anything (project files, the AI): out-of-range values are brought into range. */
export function normalizeMusicSpec(v: unknown): MusicSpec | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (!isGenre(o.genre)) return undefined;
  const g = genreInfo(o.genre);
  const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  return {
    genre: g.id,
    bpm: Math.round(num(o.bpm, g.bpm, MUSIC_LIMITS.minBpm, MUSIC_LIMITS.maxBpm) * 1000) / 1000,
    root: Math.round(num(o.root, 9, 0, 11)),
    scale: isScale(o.scale) ? o.scale : g.scale,
    length: Math.round(num(o.length, 30, MUSIC_LIMITS.minLength, MUSIC_LIMITS.maxLength) * 1000) / 1000,
    dropBars: Math.round(num(o.dropBars, g.dropBars, 0, MUSIC_LIMITS.maxDropBars)),
    seed: Math.round(num(o.seed, 1, 0, 1e9)),
  };
}

export interface Section {
  kind: SectionKind;
  /** First bar (from the start of the song). */
  from: number;
  bars: number;
}

/**
 * The parts of a song of `total` bars with its first drop after `dropBars`: intro and build-up before it; after it
 * the drop, then (when there is room) a break, a second build-up and drop, and an outro. Lengths are in phrases of
 * 2, 4 or 8 bars where they can be.
 */
export function planSections(total: number, dropBars: number, maxBuild = 4): Section[] {
  const out: Section[] = [];
  let at = 0;
  const push = (kind: SectionKind, bars: number) => {
    if (bars <= 0) return;
    out.push({ kind, from: at, bars });
    at += bars;
  };
  const pre = Math.min(dropBars, total);
  if (pre >= 2) {
    const build = Math.min(maxBuild, Math.max(1, 2 ** Math.floor(Math.log2(pre / 2))));
    push('intro', pre - build);
    push('build', build);
  } else push('build', pre);
  const post = total - pre;
  if (post >= 24) {
    const drop1 = post >= 40 ? 16 : 8;
    const rest = post - drop1;
    const outro = rest >= 16 ? 4 : 2;
    const brk = rest - outro >= 20 ? 8 : 4;
    const build2 = rest - outro - brk >= 12 ? 4 : 2;
    push('drop', drop1);
    push('break', brk);
    push('build', build2);
    push('drop', rest - outro - brk - build2);
    push('outro', outro);
  } else if (post >= 6) {
    const outro = post >= 12 ? 2 : 1;
    push('drop', post - outro);
    push('outro', outro);
  } else push('drop', post);
  return out;
}

/** Everything about a planned song: its timing, parts and notes. */
export interface MusicPlan {
  spec: MusicSpec;
  beat: number;
  bar: number;
  sections: (Section & { start: number; end: number })[];
  /** Seconds where each drop starts (the first is `dropBars` bars in). */
  drops: number[];
  events: NoteEvent[];
}

/* ------------------------------- Composing -------------------------------- */

const PROGRESSIONS: Record<Genre, number[][]> = {
  phonk: [
    [0, 0, 5, 6],
    [0, 5, 3, 4],
    [0, 3, 0, 5],
  ],
  trap: [
    [0, 5, 2, 6],
    [0, 3, 5, 4],
    [0, 5, 3, 4],
  ],
  edm: [
    [5, 6, 0, 0],
    [0, 5, 2, 6],
    [3, 5, 0, 6],
  ],
  dubstep: [
    [0, 0, 5, 6],
    [0, 5, 3, 6],
  ],
  dnb: [
    [0, 5, 2, 6],
    [0, 3, 5, 6],
  ],
  lofi: [
    [1, 4, 0, 0],
    [3, 2, 1, 4],
    [0, 5, 1, 4],
  ],
  cinematic: [
    [0, 5, 2, 6],
    [0, 0, 5, 5],
    [0, 3, 5, 4],
  ],
};

/** Bars each chord lasts. */
const CHORD_BARS: Partial<Record<Genre, number>> = { dnb: 2, cinematic: 2 };
const MAX_BUILD: Partial<Record<Genre, number>> = { edm: 8, dubstep: 8, dnb: 8 };
/** How strongly the music pumps with the kick, and how hard the master is driven. */
const SIDECHAIN: Record<Genre, number> = { phonk: 0.35, trap: 0.3, edm: 0.72, dubstep: 0.45, dnb: 0.35, lofi: 0.15, cinematic: 0 };
const DRIVE: Record<Genre, number> = { phonk: 2.4, trap: 1.9, edm: 2.1, dubstep: 2.2, dnb: 2, lofi: 1.3, cinematic: 1.5 };

/** Velocities of a 16-step pattern: X accent, x normal, o soft, . rest. */
const VEL: Record<string, number> = { X: 1, x: 0.8, o: 0.45 };

interface Motif {
  step: number;
  len: number;
  deg: number;
}

/** Composes one song: walks through its sections bar by bar and writes the notes of each part. */
class Composer {
  readonly events: NoteEvent[] = [];
  readonly r: () => number;
  readonly beat: number;
  readonly bar: number;
  readonly step: number;
  readonly prog: number[];
  readonly chordBars: number;
  readonly scale: number[];
  readonly swing: number;
  /** Melodies and rhythms picked once per song (so the song repeats its ideas). */
  readonly riff: Motif[];
  readonly hook: Motif[];
  readonly stabRhythm: string;
  readonly kickA: string;
  readonly kickB: string;
  /** Scale degrees of the 16th-note string ostinato, the war-drum groove, the arpeggio's chord tones. */
  readonly ostinato: number[];
  readonly taiko: string;
  readonly arp: number[];
  private last808: number | undefined;

  constructor(readonly s: MusicSpec) {
    this.r = rng((s.seed + 1) * 2654435761 + s.genre.length * 97 + s.root * 13);
    this.beat = 60 / s.bpm;
    this.bar = this.beat * 4;
    this.step = this.beat / 4;
    this.prog = this.pick(PROGRESSIONS[s.genre]);
    this.chordBars = CHORD_BARS[s.genre] ?? 1;
    this.scale = SCALES[s.scale];
    this.swing = s.genre === 'lofi' ? 0.6 : 0.5;
    this.riff = this.makeRiff();
    this.hook = this.makeHook();
    this.stabRhythm = this.pick(['x..x..x...x..x..', 'x.x..x.x..x..x..', '..x...x...x..xx.', 'x..x..x.x..x..x.']);
    this.kickA = s.genre === 'trap' ? this.pick(['X.........X..x..', 'X......x..X.....', 'X.......x.X.....']) : 'X.........X.....';
    this.kickB = s.genre === 'trap' ? this.pick(['X.........x.X...', 'X..x......X..x..', 'X......X..x..x..']) : s.genre === 'dnb' ? 'X.........X..X..' : 'X.......x.X.....';
    this.ostinato = this.pick([
      [0, 4, 7, 4],
      [0, 2, 4, 2],
      [0, 4, 2, 4],
      [7, 4, 2, 0],
      [0, 7, 4, 7],
    ]);
    this.taiko = this.pick(['X..x..X.x..x.X..', 'X...x.X...x.X.x.', 'X.x...X.x...X..x', 'X..x..x.X..x..x.']);
    this.arp = this.pick([
      [0, 1, 2, 3, 2, 1, 0, 2, 0, 1, 2, 3, 2, 1, 0, 1],
      [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 2, 1, 0, 1],
      [3, 2, 1, 0, 3, 2, 1, 0, 2, 1, 0, 1, 2, 3, 2, 1],
      [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 0, 3, 2, 1],
    ]);
  }

  pick<T>(list: T[]): T {
    return list[Math.floor(this.r() * list.length)];
  }

  /** MIDI note of a scale degree (any integer; 7 = an octave up), in the octave whose key note is at or above `lo`. */
  midi(deg: number, lo: number): number {
    const base = lo + ((((this.s.root - lo) % 12) + 12) % 12);
    const o = Math.floor(deg / 7);
    return base + this.scale[((deg % 7) + 7) % 7] + 12 * o;
  }

  /** The chord (scale degree of its root) of a bar; the first drop starts on the first chord. */
  chordAt(bar: number): number {
    const i = Math.floor((bar - this.s.dropBars) / this.chordBars);
    return this.prog[((i % this.prog.length) + this.prog.length) % this.prog.length];
  }

  /** Time of a 16th step in a bar (with swing on the off-steps). */
  at(t0: number, step: number): number {
    return t0 + step * this.step + (step % 2 === 1 ? (this.swing - 0.5) * 2 * this.step : 0);
  }

  add(inst: Inst, t: number, d: number, vel: number, o: { note?: number; pan?: number; p?: Record<string, number> } = {}) {
    if (vel <= 0) return;
    this.events.push({ inst, t: Math.max(0, t), d, vel: Math.min(1.2, vel), note: o.note, pan: o.pan, p: o.p });
  }

  /** Plays a 16-step drum pattern in a bar; `until` cuts it (steps), `humanize` loosens the timing a little. */
  drums(pattern: string, inst: Inst, t0: number, gain: number, o: { p?: Record<string, number>; pan?: number; note?: number; until?: number; humanize?: boolean } = {}) {
    for (let i = 0; i < 16 && i < (o.until ?? 16); i++) {
      const ch = pattern[i];
      const v = VEL[ch];
      if (!v) continue;
      const jitter = o.humanize ? (this.r() - 0.5) * 0.008 : 0;
      this.add(inst, this.at(t0, i) + jitter, this.step, v * gain * (o.humanize ? 0.85 + this.r() * 0.3 : 1), { p: o.p, pan: o.pan, note: o.note });
    }
  }

  /** Hi-hats in 8ths with trap rolls: some beats get a triplet or 32nd-note roll. */
  hats(t0: number, gain: number, rolls: number, o: { until?: number; open?: boolean } = {}) {
    for (let i = 0; i < 16 && i < (o.until ?? 16); i += 2) {
      const pan = i % 4 ? 0.2 : 0.1;
      const roll = this.r() < rolls;
      if (roll && i % 4 === 2) {
        const n = this.r() < 0.5 ? 3 : 4;
        for (let k = 0; k < n; k++) this.add('hat', this.at(t0, i) + (k * 2 * this.step) / n, this.step / 2, gain * (0.55 + 0.35 * (k / n)), { pan });
      } else this.add('hat', this.at(t0, i), this.step, gain * (i % 4 ? 0.65 : 0.85), { pan });
    }
    if (o.open) this.add('hat', this.at(t0, 14), this.step * 2, gain * 0.6, { pan: -0.15, p: { open: 1 } });
  }

  /** A roll that speeds up over a build-up: quarter notes, then 8ths, 16ths and 32nds, getting louder and higher. */
  roll(inst: Inst, t0: number, bars: number, gain: number, stopBeforeEnd: number) {
    const total = bars * 16;
    for (let st = 0; st < total * 2; st++) {
      const step = st / 2;
      const q = step / total;
      const every = q < 0.25 ? 4 : q < 0.5 ? 2 : q < 0.75 ? 1 : 0.5;
      if (step % every !== 0 || step >= total - stopBeforeEnd) continue;
      this.add(inst, t0 + step * this.step, this.step, gain * (0.35 + 0.65 * q), { p: { pitch: 7 * q, style: 0 } });
    }
  }

  /** The cowbell riff of phonk: two bars of mostly 16th notes, walking around the key note. */
  makeRiff(): Motif[] {
    const cells = ['x.x.', 'xx.x', 'x.xx', 'xxx.', 'x..x', 'xx..'];
    const steps: number[] = [];
    for (let b = 0; b < 8; b++) {
      const cell = b % 4 === 0 ? this.pick(cells.slice(0, 4)) : this.pick(cells);
      for (let i = 0; i < 4; i++) if (cell[i] === 'x') steps.push(b * 4 + i);
    }
    const ladder = [-1, 0, 1, 2, 4, 5, 7];
    let at = 1;
    return steps.map((step, i) => {
      const roll = this.r();
      if (i === 0 || step === 16) at = 1;
      else if (roll < 0.35) at = Math.min(ladder.length - 1, at + 1);
      else if (roll < 0.7) at = Math.max(0, at - 1);
      else if (roll < 0.85) at = this.r() < 0.5 ? 1 : 6;
      const next = steps[i + 1] ?? 32;
      return { step, len: Math.min(2, next - step), deg: ladder[at] };
    });
  }

  /** A two-bar hook in chord tones (degrees relative to the chord), for bells, leads and plucks. */
  makeHook(): Motif[] {
    const rhythms = ['x..x..x...x.x...', 'x.x...x.x.x.....', 'x..x..x.x.......', 'x...x..x..x.x...', 'x.x.x...x.x.x.x.'];
    const tones = [0, 2, 4, 7, 9];
    const out: Motif[] = [];
    let at = 2;
    for (let b = 0; b < 2; b++) {
      const rh = this.pick(rhythms);
      const onsets = [...rh].map((c, i) => (c === 'x' ? i : -1)).filter((i) => i >= 0);
      onsets.forEach((st, k) => {
        const roll = this.r();
        if (roll < 0.4) at = Math.min(tones.length - 1, at + 1);
        else if (roll < 0.8) at = Math.max(0, at - 1);
        const next = onsets[k + 1] ?? 16;
        out.push({ step: b * 16 + st, len: Math.min(4, next - st), deg: tones[at] });
      });
    }
    return out;
  }

  /** Plays a two-bar motif in one bar (`half` = which of its two bars), relative to `deg`, from note `lo` up. */
  motif(m: Motif[], half: number, inst: Inst, t0: number, deg: number, lo: number, gain: number, p?: Record<string, number>, pan?: number) {
    for (const n of m) {
      if (Math.floor(n.step / 16) !== half) continue;
      const st = n.step % 16;
      this.add(inst, this.at(t0, st), n.len * this.step * 0.95, gain * (st % 4 === 0 ? 1 : 0.85), { note: this.midi(deg + n.deg, lo), p, pan });
    }
  }

  /** The notes of the chord on a scale degree: triad, or a 7th chord. */
  chord(deg: number, lo: number, seventh = false): number[] {
    return (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map((d) => this.midi(deg + d, lo));
  }

  /** An 808 note; it slides from the previous one when asked. */
  bass808(t: number, d: number, note: number, vel: number, drive: number, glide: boolean) {
    const p: Record<string, number> = { drive };
    if (glide && this.last808 !== undefined && this.last808 !== note) p.glide = this.last808;
    this.add('bass808', t, d, vel, { note, p });
    this.last808 = note;
  }
}

interface Bar {
  t0: number;
  bar: number;
  /** Bar within its section, and how many bars the section has. */
  i: number;
  n: number;
  kind: SectionKind;
  chord: number;
  /** This is the last bar before a drop. */
  beforeDrop: boolean;
  /** Which drop this is (1, 2, …), 0 outside drops. */
  dropNo: number;
}

type BarWriter = (c: Composer, b: Bar) => void;

/** How the parts of each genre play in each section. */
const GENRE_BARS: Record<Genre, BarWriter> = {
  phonk(c, b) {
    const { t0, kind, i, n } = b;
    const half = b.bar % 2;
    const gap = b.beforeDrop ? 12 : 16;
    const lo = 66;
    if (kind === 'intro' || kind === 'outro') {
      const x = (i + 1) / n;
      const cutoff = kind === 'intro' ? 700 + 4000 * x * x : 5000 - 4300 * x;
      for (const m of c.riff) if (Math.floor(m.step / 16) === half) c.add('cowbell', c.at(t0, m.step % 16), m.len * c.step, 0.8, { note: c.midi(m.deg, lo), p: { cutoff, rev: 0.12, dly: 0.12 } });
      if (kind === 'intro' && n >= 4 && i >= n / 2) c.hats(t0, 0.45, 0);
      if (kind === 'outro' && i === n - 1) c.bass808(t0, c.bar, c.midi(b.chord, 28), 0.9, 3, false);
      return;
    }
    if (kind === 'build') {
      for (const m of c.riff) if (Math.floor(m.step / 16) === half && m.step % 16 < gap) c.add('cowbell', c.at(t0, m.step % 16), m.len * c.step, 0.85, { note: c.midi(m.deg, lo), p: { rev: 0.12, dly: 0.12 } });
      c.drums('x.x.x.x.x.x.x.x.', 'hat', t0, 0.5 + 0.3 * (i / n), { until: gap, pan: 0.2 });
      if (i === n - 1) c.drums('....x...x.x.xxxx', 'clap', t0, 0.75, { until: gap });
      return;
    }
    if (kind === 'break') {
      for (const m of c.riff) if (Math.floor(m.step / 16) === half) c.add('cowbell', c.at(t0, m.step % 16), m.len * c.step, 0.75, { note: c.midi(m.deg, lo), p: { rev: 0.2, dly: 0.15 } });
      if (b.bar % c.chordBars === 0) for (const note of c.chord(b.chord, 50)) c.add('pad', t0, c.bar * c.chordBars, 0.55, { note, p: { cutoff: 1400, rev: 0.3 } });
      return;
    }
    // the drop: four on the floor, claps on 2 and 4, the 808 in a 3-3-2 groove under the riff
    const fill = i % 4 === 3;
    c.drums('X...x...X...x...', 'kick', t0, 1, { p: { style: 2 } });
    c.drums(fill ? '....X.......X.xx' : '....X.......X...', 'clap', t0, 0.85, { p: { rev: 0.2 } });
    c.drums('..x...x...x...x.', 'hat', t0, 0.6, { pan: 0.2 });
    c.drums('o.o.o.o.o.o.o.o.', 'hat', t0, 0.35, { pan: -0.2 });
    if (b.bar % 2 === 1) c.add('hat', c.at(t0, 14), c.step * 2, 0.4, { p: { open: 1 }, pan: -0.15 });
    const root = c.midi(b.chord, 28);
    for (const [st, len] of [
      [0, 6],
      [6, 4],
      [10, 6],
    ]) {
      const note = st === 10 && c.r() < 0.3 ? root + 12 : root;
      c.bass808(c.at(t0, st), len * c.step, note, 0.95, 3.2, true);
    }
    for (const m of c.riff) if (Math.floor(m.step / 16) === half) c.add('cowbell', c.at(t0, m.step % 16), m.len * c.step, 0.9, { note: c.midi(m.deg, lo), p: { rev: 0.1, dly: 0.1 } });
    if (b.dropNo >= 2) for (const m of c.riff) if (Math.floor(m.step / 16) === half) c.add('cowbell', c.at(t0, m.step % 16), m.len * c.step, 0.35, { note: c.midi(m.deg, lo) + 12, pan: 0.3 });
  },

  trap(c, b) {
    const { t0, kind, i, n } = b;
    const half = b.bar % 2;
    const gap = b.beforeDrop ? 8 : 16;
    if (kind !== 'drop') {
      c.motif(c.hook, half, 'bell', t0, b.chord, 72, kind === 'outro' ? 0.7 * (1 - i / n) + 0.2 : 0.75, { rev: 0.35, dly: 0.25 });
      if (b.bar % c.chordBars === 0) for (const note of c.chord(b.chord, 52)) c.add('pad', t0, c.bar, kind === 'break' ? 0.6 : 0.45, { note, p: { cutoff: 1100, rev: 0.3 } });
      if (kind === 'build') c.hats(t0, 0.55, 0.3 + 0.4 * (i / n), { until: gap });
      else if (kind === 'intro' && n >= 4 && i >= n / 2) c.hats(t0, 0.4, 0);
      if (kind === 'outro' && i === n - 1) c.bass808(t0, c.bar, c.midi(b.chord, 28), 0.85, 1.6, false);
      return;
    }
    // the drop, in half time: snare on beat 3, 808 notes on the kicks sliding between chords
    const kick = i % 4 === 3 ? c.kickB : c.kickA;
    c.drums(kick, 'kick', t0, 1, { p: { style: 1 } });
    c.drums('........X.......', 'clap', t0, 0.85, { p: { rev: 0.25 } });
    c.drums('........x.......', 'snare', t0, 0.6, { p: { style: 0 } });
    c.hats(t0, 0.6, 0.35, { open: i % 2 === 1 });
    const hits = [...kick].map((ch, k) => (ch !== '.' ? k : -1)).filter((k) => k >= 0);
    const root = c.midi(b.chord, 28);
    hits.forEach((st, k) => {
      const next = hits[k + 1] ?? 16;
      const note = k > 0 && c.r() < 0.25 ? root + 12 : root;
      c.bass808(c.at(t0, st), (next - st) * c.step, note, 0.95, 1.7, true);
    });
    c.motif(c.hook, half, 'bell', t0, b.chord, 72, 0.7, { rev: 0.3, dly: 0.2 });
    if (b.bar % c.chordBars === 0) for (const note of c.chord(b.chord, 52)) c.add('pad', t0, c.bar, 0.35, { note, p: { cutoff: 1300, rev: 0.25 } });
  },

  edm(c, b) {
    const { t0, kind, i, n } = b;
    const chordNotes = c.chord(b.chord, 57);
    const arp = (gain: number, cutoff?: number) => {
      const tones = [...chordNotes, chordNotes[0] + 12];
      for (let st = 0; st < 16; st++) c.add('pluck', c.at(t0, st), c.step, gain * (st % 4 === 0 ? 1 : 0.75), { note: tones[c.arp[st]] + 12, p: { rev: 0.25, dly: 0.2, ...(cutoff ? { cutoff } : {}) }, pan: st % 2 ? 0.25 : -0.25 });
    };
    if (kind === 'intro' || kind === 'outro') {
      c.drums('X...x...x...x...', 'kick', t0, 0.6);
      c.drums('..x...x...x...x.', 'hat', t0, 0.4, { pan: 0.2 });
      if (i >= n / 2) c.drums('....x.......x...', 'clap', t0, 0.4, { p: { rev: 0.2 } });
      for (const note of chordNotes) c.add('pad', t0, c.bar, 0.55, { note, p: { cutoff: kind === 'intro' ? 700 + 900 * (i / n) : 1500 - 800 * (i / n), rev: 0.3 } });
      arp(0.45);
      return;
    }
    if (kind === 'build') {
      if (i === 0) {
        c.roll('snare', t0, n, 0.45, 4);
        c.add('riser', t0, n * c.bar, 0.55, { note: c.midi(0, 48) });
      }
      if (i < n - 1) c.drums('X...x...x...x...', 'kick', t0, 0.6);
      for (const note of chordNotes) c.add('pad', t0, c.bar, 0.6, { note, p: { cutoff: 1200 + 4800 * (i / n), cutoff2: 1200 + 4800 * ((i + 1) / n), rev: 0.3 } });
      if (!b.beforeDrop) arp(0.5);
      return;
    }
    if (kind === 'break') {
      for (const note of chordNotes) c.add('pad', t0, c.bar, 0.65, { note, p: { cutoff: 1600, rev: 0.35 } });
      c.motif(c.hook, b.bar % 2, 'pluck', t0, b.chord, 69, 0.7, { rev: 0.3, dly: 0.3 });
      return;
    }
    // the drop: pumping supersaw chords, off-beat bass, four on the floor
    c.drums('X...X...X...X...', 'kick', t0, 1);
    c.drums(i % 4 === 3 ? '....X.......X.XX' : '....X.......X...', 'clap', t0, 0.8, { p: { rev: 0.2 } });
    c.drums('..x...x...x...x.', 'hat', t0, 0.55, { p: { open: 1 }, pan: 0.15 });
    c.drums('x.x.x.x.x.x.x.x.', 'hat', t0, 0.3, { pan: -0.2 });
    c.drums('..x...x...x...x.', 'sub', t0, 0.9, { note: c.midi(b.chord, 33) });
    for (let st = 0; st < 16; st++) {
      if (c.stabRhythm[st] !== 'x') continue;
      for (const note of [...chordNotes, chordNotes[0] + 12]) c.add('stab', c.at(t0, st), c.step * 1.5, 0.6, { note, p: { rev: 0.15 } });
    }
    if (b.dropNo >= 2) c.motif(c.hook, b.bar % 2, 'lead', t0, b.chord, 69, 0.6, { rev: 0.2, dly: 0.2 });
  },

  dubstep(c, b) {
    const { t0, kind, i, n } = b;
    if (kind !== 'drop') {
      if (b.bar % c.chordBars === 0) for (const note of c.chord(b.chord, 52)) c.add('pad', t0, c.bar, 0.55, { note, p: { cutoff: kind === 'build' ? 900 + 4000 * ((i + 1) / n) : 1000, rev: 0.35 } });
      c.motif(c.hook, b.bar % 2, 'bell', t0, b.chord, 72, 0.55, { rev: 0.4, dly: 0.3 });
      if (kind === 'intro' && n >= 4 && i >= n / 2) c.drums('x.x.x.x.x.x.x.x.', 'hat', t0, 0.35, { pan: 0.2 });
      if (kind === 'build' && i === 0) {
        c.roll('snare', t0, n, 0.3, 4);
        c.add('riser', t0, n * c.bar, 0.55, { note: c.midi(0, 48) });
      }
      return;
    }
    // the drop, in half time: kick on 1, a big snare on 3, the wobble changing speed every beat
    c.drums(i % 2 ? 'X.........x.....' : 'X...............', 'kick', t0, 1);
    c.drums('........X.......', 'snare', t0, 1, { p: { style: 1, rev: 0.35 } });
    c.drums('x.x.x.x.x.x.x.x.', 'hat', t0, 0.35, { pan: 0.2 });
    const rates = [1, 2, 3, 4, 2, 6];
    for (let beat = 0; beat < 4; beat++) {
      const rate = c.pick(rates) / c.beat;
      // the last beat of every other bar jumps to the fifth, the octave or the third (in the key)
      const note = c.midi(b.chord + (beat === 3 && i % 2 === 1 ? c.pick([4, 7, 2]) : 0), 28);
      c.add('wobble', t0 + beat * c.beat, c.beat * 0.98, 0.95, { note, p: { rate } });
    }
  },

  dnb(c, b) {
    const { t0, kind, i, n } = b;
    if (kind !== 'drop') {
      if (b.bar % c.chordBars === 0) for (const note of c.chord(b.chord, 52)) c.add('pad', t0, c.bar * c.chordBars, 0.5, { note, p: { cutoff: kind === 'build' ? 1000 + 3000 * ((i + 1) / n) : 1200, rev: 0.35 } });
      if (kind !== 'outro' || i < n - 1) c.drums('x.x.x.x.x.x.x.x.', 'hat', t0, 0.4, { pan: 0.2 });
      if (kind === 'intro' && i >= n / 2) c.motif(c.hook, b.bar % 2, 'pluck', t0, b.chord, 69, 0.55, { rev: 0.3, dly: 0.3 });
      if (kind === 'build' && i === 0) {
        c.roll('snare', t0, n, 0.45, 4);
        c.add('riser', t0, n * c.bar, 0.55, { note: c.midi(0, 48) });
      }
      return;
    }
    // the drop: two-step breakbeat with ghost snares, a reese bass under it
    const kick = i % 4 === 3 ? c.kickB : c.kickA;
    c.drums(kick, 'kick', t0, 1);
    c.drums('....X.......X...', 'snare', t0, 1, { p: { style: 1, rev: 0.25 } });
    c.drums('..o.....o.o..o..', 'snare', t0, 0.35, { p: { style: 0 } });
    c.drums('x.x.x.x.x.x.x.x.', 'hat', t0, 0.5, { pan: 0.2 });
    c.drums('.o.o.o.o.o.o.o.o', 'hat', t0, 0.3, { pan: -0.25 });
    if (b.bar % c.chordBars === 0) {
      c.add('reese', t0, c.bar * 1.5, 0.9, { note: c.midi(b.chord, 28) });
      c.add('reese', t0 + c.bar * 1.5, c.bar * 0.5, 0.85, { note: c.midi(b.chord + c.pick([0, 4, 7]), 28) });
      for (const note of c.chord(b.chord, 55)) c.add('pad', t0, c.bar * c.chordBars, 0.3, { note, p: { cutoff: 1500, rev: 0.3 } });
    }
    if (b.dropNo >= 2 || i >= 4) c.motif(c.hook, b.bar % 2, 'pluck', t0, b.chord, 69, 0.45, { rev: 0.25, dly: 0.25 });
  },

  lofi(c, b) {
    const { t0, kind, i, n } = b;
    // warm 7th chords, strummed, every bar
    const notes = c.chord(b.chord, 55, true);
    const fadeOut = kind === 'outro' ? 1 - i / n : 1;
    notes.forEach((note, k) => c.add('epiano', t0 + k * 0.018, c.bar * 0.95, 0.6 * fadeOut, { note, pan: (k - 1.5) * 0.2, p: { rev: 0.25 } }));
    if (kind === 'intro' || kind === 'build' || kind === 'outro') return;
    if (kind === 'drop') {
      const kick = i % 4 === 3 ? 'X.......X.x.....' : 'X......x..x.....';
      c.drums(kick, 'kick', t0, 0.95, { p: { style: 3 }, humanize: true });
      c.drums('....X.......X...', 'snare', t0, 0.8, { p: { style: 2, rev: 0.15 }, humanize: true });
      c.drums('x.x.x.x.x.x.x.x.', 'hat', t0, 0.4, { pan: 0.25, humanize: true });
      const root = c.midi(b.chord, 33);
      for (const [k, ch] of [...kick].entries()) if (ch !== '.') c.add('sub', c.at(t0, k), c.step * 3, 0.85, { note: root, p: { style: 1 } });
    }
    // a few melody notes over the chords, from the pentatonic notes of the key
    for (let st = 0; st < 16; st += 2) {
      if (c.r() > 0.32) continue;
      const deg = c.pick([0, 1, 2, 4, 5, 7]);
      c.add('epiano', c.at(t0, st), c.step * 2, 0.5, { note: c.midi(deg, 72), pan: 0.15, p: { rev: 0.3 } });
    }
  },

  cinematic(c, b) {
    const { t0, kind, i, n } = b;
    const drone = () => {
      if (b.bar % 2 === 0) for (const note of [c.midi(0, 36), c.midi(4, 36)]) c.add('pad', t0, c.bar * 2, 0.5, { note, p: { cutoff: 600, attack: 1.2, release: 1.5, rev: 0.4 } });
    };
    const strings = (gain: number) => {
      if (b.bar % c.chordBars === 0) for (const note of c.chord(b.chord, 55)) c.add('pad', t0, c.bar * c.chordBars, gain, { note, p: { cutoff: 2200, attack: 0.8, release: 1.2, rev: 0.45 } });
    };
    const ostinato = (gain: number) => {
      for (let st = 0; st < 16; st++) c.add('strings', c.at(t0, st), c.step * 0.9, gain * (st % 4 === 0 ? 1 : 0.7), { note: c.midi(b.chord + c.ostinato[st % 4], 55), pan: st % 2 ? 0.2 : -0.2, p: { rev: 0.3 } });
    };
    if (kind === 'intro' || kind === 'break' || kind === 'outro') {
      drone();
      strings(kind === 'outro' ? 0.45 * (1 - i / n) + 0.1 : 0.45);
      if (kind !== 'outro') c.drums('x.x.x.x.x.x.x.x.', 'tick', t0, 0.45, { pan: 0.3 });
      if (kind === 'outro' && i === n - 1) c.add('impact', t0, 2, 0.9);
      return;
    }
    if (kind === 'build') {
      if (i === 0) {
        c.roll('taiko', t0, n, 0.6, 0);
        c.add('riser', t0, n * c.bar, 0.55, { note: c.midi(0, 48) });
      }
      drone();
      ostinato(0.35 + 0.25 * (i / n));
      if (!b.beforeDrop) c.drums('x.x.x.x.x.x.x.x.', 'tick', t0, 0.45, { pan: 0.3 });
      return;
    }
    // the hit: a braam every two bars, war drums, strings
    if (i % 2 === 0) c.add('braam', t0, c.bar * 2, 1.2, { note: c.midi(b.chord, 36), p: { rev: 0.35 } });
    if (i % 4 === 0 && i > 0) c.add('impact', t0, 2, 0.7, { p: { rev: 0.3 } });
    c.drums(c.taiko, 'taiko', t0, 1, { pan: 0 });
    c.drums('..x.....x.....x.', 'taiko', t0, 0.6, { p: { pitch: 7 }, pan: 0.4 });
    ostinato(0.7);
    strings(0.55);
  },
};

/** Plans a whole song: its sections and every note. */
export function planMusic(spec: MusicSpec): MusicPlan {
  const c = new Composer(spec);
  const total = Math.max(1, Math.ceil(spec.length / c.bar - 1e-6));
  const sections = planSections(total, spec.dropBars, MAX_BUILD[spec.genre] ?? 4).map((s) => ({ ...s, start: s.from * c.bar, end: (s.from + s.bars) * c.bar }));
  const drops = sections.filter((s) => s.kind === 'drop').map((s) => s.start);
  const write = GENRE_BARS[spec.genre];
  if (spec.genre === 'lofi') c.add('vinyl', 0, spec.length, 0.8);
  for (const s of sections) {
    for (let i = 0; i < s.bars; i++) {
      const bar = s.from + i;
      const t0 = bar * c.bar;
      const beforeDrop = i === s.bars - 1 && sections.some((x) => x.kind === 'drop' && x.from === bar + 1);
      write(c, { t0, bar, i, n: s.bars, kind: s.kind, chord: c.chordAt(bar), beforeDrop, dropNo: s.kind === 'drop' ? drops.indexOf(s.start) + 1 : 0 });
      // transitions: a reverse cymbal into each drop, a crash and an impact on it, a crash every 8 bars of a drop
      if (beforeDrop && spec.genre !== 'lofi') c.add('reverseCrash', t0 + c.bar - Math.min(c.bar, 2 * c.beat), Math.min(c.bar, 2 * c.beat), 0.7);
      if (s.kind === 'drop' && i % 8 === 0 && spec.genre !== 'lofi') c.add('crash', t0, 2, i === 0 ? 0.85 : 0.6, { p: { rev: 0.15 } });
      if (s.kind === 'drop' && i === 0 && spec.genre !== 'lofi' && spec.genre !== 'trap') c.add('impact', t0, 2, 0.8, { p: { rev: 0.3 } });
      if (s.kind === 'build' && i === 0 && (spec.genre === 'phonk' || spec.genre === 'trap')) c.add('riser', t0, s.bars * c.bar, 0.6, { note: c.midi(0, 48) });
    }
  }
  const events = c.events.filter((e) => e.t < spec.length).sort((a, b) => a.t - b.t);
  return { spec, beat: c.beat, bar: c.bar, sections, drops, events };
}

/* ------------------------------- Rendering -------------------------------- */

/**
 * The level of each part in each genre (dB), measured: what each part adds to a drop, weighted the way ears hear it
 * (K-weighting), brought to a balance like that of real songs of the genre. The parts' velocities do the rest.
 */
const MIX: Record<Genre, Partial<Record<Inst, number>>> = {
  phonk: { cowbell: 2.8, hat: 5.4, clap: 4, kick: -1.8, bass808: -4.1 },
  trap: { bell: 0.1, pad: -0.3, hat: 4.4, kick: 0.7, bass808: -2.4, clap: 8.3, snare: 7.9 },
  edm: { kick: 1.5, hat: 2.1, clap: 4.3, stab: 6.1, sub: 0.7, pad: -3.1, pluck: 2.4, snare: 3, lead: 6 },
  dubstep: { wobble: 0.6, kick: 3.9, snare: 7.7, hat: 7.6, pad: -1.7, bell: -1 },
  dnb: { reese: -0.8, kick: 0.7, snare: 3.6, hat: 6.8, pad: 0.1, pluck: 3.7 },
  lofi: { epiano: 6.7, sub: -3.5, kick: 5.5, snare: 9.3, hat: 9.2, vinyl: 6.8 },
  cinematic: { taiko: -0.9, braam: 3.8, pad: -0.5, strings: 6.8, tick: 4.5 },
};

const gainOf = (g: Genre, inst: Inst) => Math.pow(10, (MIX[g][inst] ?? 0) / 20);

/** Notes kept for reuse (samples per channel): a song repeats its notes, so most are made once. */
const NOTE_CACHE_SAMPLES = 12_000_000;

/** What makes two notes sound the same (their level, pan and sends are set when they are mixed). */
function noteKey(e: NoteEvent): string {
  const p = e.p ? Object.keys(e.p).filter((k) => k !== 'rev' && k !== 'dly').sort().map((k) => `${k}=${Math.round(e.p![k] * 1e4) / 1e4}`) : [];
  return `${e.inst}|${e.note ?? ''}|${Math.round(e.d * 1e4)}|${p.join(',')}`;
}

export const MUSIC_RATE = 44100;

/** Plays a planned song into stereo sound (async: it yields to keep the app responsive). */
export async function renderMusic(spec: MusicSpec, o: { onProgress?: (f: number) => void; signal?: AbortSignal; sampleRate?: number } = {}): Promise<StemPcm> {
  const plan = planMusic(spec);
  const sr = o.sampleRate ?? MUSIC_RATE;
  const len = Math.max(1, Math.round(spec.length * sr));
  const m: Mix = { sr, L: new Float32Array(len), R: new Float32Array(len), duck: new Float32Array(len).fill(1), rev: new Float32Array(len), dly: new Float32Array(len) };
  duckAt(
    m,
    plan.events.filter((e) => e.inst === 'kick' || (spec.genre === 'dubstep' && e.inst === 'snare' && (e.p?.style ?? 0) === 1)).map((e) => e.t),
    SIDECHAIN[spec.genre],
    plan.beat * (spec.genre === 'edm' ? 0.85 : 0.5),
  );
  let last = performance.now();
  const cache = new Map<string, Rendered>();
  let cached = 0;
  for (let i = 0; i < plan.events.length; i++) {
    const e = plan.events[i];
    const key = noteKey(e);
    let note = cache.get(key);
    if (!note) {
      note = renderNote(e, sr, (spec.seed + 1) * 7919 + i * 104729);
      if (cached + note.L.length <= NOTE_CACHE_SAMPLES) {
        cache.set(key, note);
        cached += note.L.length;
      }
    }
    mixNote(m, { ...e, vel: e.vel * gainOf(spec.genre, e.inst) }, note);
    if (performance.now() - last > 30) {
      if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      o.onProgress?.((0.8 * i) / plan.events.length);
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
    }
  }
  if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  addDelay(m, { time: plan.beat * 0.75, feedback: 0.35, wet: 0.5 });
  o.onProgress?.(0.85);
  await new Promise((r) => setTimeout(r, 0));
  addReverb(m, { room: 0.84, damp: 0.35, wet: 2.4 });
  if (spec.genre === 'lofi') lowPass(m, 6500);
  o.onProgress?.(0.95);
  await new Promise((r) => setTimeout(r, 0));
  // songs that stop mid-bar fade out over their last beat; the rest just let the tail ring
  master(m, DRIVE[spec.genre], Math.min(spec.length * 0.2, Math.max(0.3, plan.beat)));
  o.onProgress?.(1);
  return { sampleRate: sr, channels: [m.L, m.R] };
}

/* ------------------------------ Fitting a drop ----------------------------- */

/**
 * Lands the first drop `lead` seconds after the song starts: a whole number of bars at a tempo within 4 % of the one
 * asked, or else at that tempo with the start of the intro cut (`trim` seconds of the song skipped).
 */
export function fitDrop(bpm: number, lead: number): { bpm: number; dropBars: number; trim: number } {
  if (lead < 0.05) return { bpm, dropBars: 0, trim: 0 };
  const bar = 240 / bpm;
  const n = Math.round(lead / bar);
  if (n >= 1 && n <= MUSIC_LIMITS.maxDropBars) {
    const exact = Math.round(((240 * n) / lead) * 1000) / 1000;
    if (Math.abs(exact / bpm - 1) <= 0.04 && exact >= MUSIC_LIMITS.minBpm && exact <= MUSIC_LIMITS.maxBpm) return { bpm: exact, dropBars: n, trim: 0 };
  }
  const m = Math.min(MUSIC_LIMITS.maxDropBars, Math.max(1, Math.ceil(lead / bar - 1e-9)));
  return { bpm, dropBars: m, trim: Math.max(0, m * bar - lead) };
}
