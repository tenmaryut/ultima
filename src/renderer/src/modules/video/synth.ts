/*
 * The instruments of the music generator (pure): drums, 808s, basses, pads, leads, bells and transition effects,
 * made from oscillators, filters and seeded noise and written straight into the song. Instruments on the "pumping"
 * side are multiplied by the sidechain gain as they are written, so the song needs no separate buses; reverb and
 * delay are fed through two mono sends.
 */

export type Inst =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'cowbell'
  | 'bass808'
  | 'reese'
  | 'wobble'
  | 'sub'
  | 'pad'
  | 'stab'
  | 'lead'
  | 'pluck'
  | 'bell'
  | 'epiano'
  | 'strings'
  | 'braam'
  | 'taiko'
  | 'tick'
  | 'crash'
  | 'reverseCrash'
  | 'riser'
  | 'downlifter'
  | 'impact'
  | 'vinyl';

/** One note of the song: what plays, when (seconds), for how long, how loud. */
export interface NoteEvent {
  inst: Inst;
  t: number;
  d: number;
  /** MIDI note (pitched instruments). */
  note?: number;
  vel: number;
  /** −1 (left) … 1 (right). */
  pan?: number;
  /** Instrument settings: style, filter cutoffs, glide, wobble rate… */
  p?: Record<string, number>;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** A cheap tanh: a soft clipper that saturates at ±1. */
export function soft(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** PolyBLEP step correction: saws and squares without harsh aliasing. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const u = t / dt;
    return u + u - u * u - 1;
  }
  if (t > 1 - dt) {
    const u = (t - 1) / dt;
    return u * u + u + u + 1;
  }
  return 0;
}

/** Oscillator (phase in cycles). */
class Osc {
  constructor(public phase = 0) {}
  private step(hz: number, sr: number): number {
    const t = this.phase;
    this.phase += hz / sr;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);
    return t;
  }
  saw(hz: number, sr: number): number {
    const dt = Math.min(0.5, hz / sr);
    const t = this.step(hz, sr);
    return 2 * t - 1 - blep(t, dt);
  }
  square(hz: number, sr: number): number {
    const dt = Math.min(0.5, hz / sr);
    const t = this.step(hz, sr);
    return (t < 0.5 ? 1 : -1) + blep(t, dt) - blep((t + 0.5) % 1, dt);
  }
  sine(hz: number, sr: number): number {
    return Math.sin(2 * Math.PI * this.step(hz, sr));
  }
}

/** State-variable filter (topology-preserving: stable at any cutoff and resonance). */
class Filter {
  low = 0;
  band = 0;
  high = 0;
  private ic1 = 0;
  private ic2 = 0;
  private cut = -1;
  private q = -1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 0;
  constructor(private sr: number) {}
  run(x: number, cutoff: number, q = 0.7): this {
    if (cutoff !== this.cut || q !== this.q) {
      this.cut = cutoff;
      this.q = q;
      const g = Math.tan((Math.PI * Math.min(Math.max(cutoff, 10), this.sr * 0.45)) / this.sr);
      this.k = 1 / Math.max(0.3, q);
      this.a1 = 1 / (1 + g * (g + this.k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    }
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - this.k * v1 - v2;
    return this;
  }
}

/** Attack, decay to the sustain level, release after the note ends at `dur` (seconds). */
function adsr(t: number, dur: number, a: number, d: number, s: number, r: number): number {
  const level = (x: number) => (x < a ? x / a : x < a + d ? 1 - ((1 - s) * (x - a)) / d : s);
  if (t <= dur) return level(t);
  return Math.max(0, level(dur) * (1 - (t - dur) / r));
}

/** Where a song's instruments end up: the stereo song, the sidechain gain, and the reverb and delay sends. */
export interface Mix {
  sr: number;
  L: Float32Array;
  R: Float32Array;
  /** Per-sample gain of the pumping instruments (1 = no ducking). */
  duck: Float32Array;
  rev: Float32Array;
  dly: Float32Array;
}

/** How long each instrument sounds after its note starts (its own decay; held notes add their length). */
function lengthOf(e: NoteEvent): number {
  const style = e.p?.style ?? 0;
  switch (e.inst) {
    case 'kick':
      return [0.4, 0.75, 0.6, 0.32][style] ?? 0.4;
    case 'snare':
      return [0.28, 0.45, 0.24][style] ?? 0.3;
    case 'clap':
      return 0.4;
    case 'hat':
      return e.p?.open ? 0.7 : 0.14;
    case 'cowbell':
      return 0.7;
    case 'bass808':
      return e.d + 0.08;
    case 'reese':
    case 'wobble':
    case 'sub':
      return e.d + 0.06;
    case 'pad':
      return e.d + (e.p?.release ?? 0.7);
    case 'stab':
      return e.d + 0.15;
    case 'lead':
      return e.d + 0.2;
    case 'pluck':
      return e.d + 0.4;
    case 'bell':
      return 2.2;
    case 'epiano':
      return e.d + 0.35;
    case 'strings':
      return e.d + 0.12;
    case 'braam':
      return 4;
    case 'taiko':
      return 1.2;
    case 'tick':
      return 0.06;
    case 'crash':
      return 2.8;
    case 'impact':
      return 2.4;
    case 'reverseCrash':
    case 'riser':
    case 'downlifter':
    case 'vinyl':
      return e.d;
  }
}

/** Instruments that follow the kick's pumping. */
const PUMPS = new Set<Inst>(['bass808', 'reese', 'wobble', 'sub', 'pad', 'stab', 'lead', 'pluck', 'bell', 'epiano', 'strings', 'cowbell']);

/** A note as sound: left and right samples from its start. */
export interface Rendered {
  L: Float32Array;
  R: Float32Array;
}

/**
 * One note, at full velocity in the middle (`mixNote` places it, sets its level and pan and feeds the sends), so a
 * note that repeats is made once; `seed` makes its noise.
 */
export function renderNote(e: NoteEvent, sr: number, seed: number): Rendered {
  const n = Math.max(1, Math.round(lengthOf(e) * sr));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = rng(seed);
  const noise = () => r() * 2 - 1;
  const vel = 1;
  const gl = 1;
  const gr = 1;
  const out = (k: number, l: number, rr: number) => {
    L[k] = l;
    R[k] = rr;
  };
  const style = e.p?.style ?? 0;
  const hz = e.note !== undefined ? midiHz(e.note) : 0;

  switch (e.inst) {
    case 'kick': {
      // 0 punchy (EDM), 1 deep 808 kick (trap), 2 hard and distorted (phonk), 3 soft (lo-fi)
      const decay = [0.16, 0.34, 0.26, 0.12][style] ?? 0.16;
      const drive = [1.7, 1.6, 3.4, 1][style] ?? 1.7;
      const lo = [48, 43, 46, 56][style] ?? 48;
      const hi = [180, 130, 170, 115][style] ?? 180;
      const click = new Filter(sr);
      let ph = 0;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        ph += (lo + (hi - lo) * Math.exp(-t / 0.035)) / sr;
        const body = Math.sin(2 * Math.PI * ph) * (t < 0.002 ? t / 0.002 : Math.exp(-(t - 0.002) / decay));
        const c = click.run(noise(), 3500).high * Math.exp(-t / 0.0025) * (style === 3 ? 0.15 : 0.5);
        const v = soft((body + c) * drive) * vel * 0.95;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'snare': {
      // 0 tight, 1 big (with more room), 2 lo-fi (dull)
      const nd = [0.09, 0.16, 0.08][style] ?? 0.09;
      const pitch = Math.pow(2, (e.p?.pitch ?? 0) / 12);
      const bp = new Filter(sr);
      const hp = new Filter(sr);
      const lp = new Filter(sr);
      let ph = 0;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        ph += ((185 + 70 * Math.exp(-t / 0.01)) * pitch) / sr;
        const body = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.05) * 0.7;
        const x = noise();
        let v = body + (bp.run(x, 2200 * pitch, 0.8).band * 1.2 + hp.run(x, 5500).high * 0.5) * Math.exp(-t / nd);
        if (style === 2) v = lp.run(v, 4200).low;
        v = soft(v * 1.3) * vel * 0.8;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'clap': {
      const bl = new Filter(sr);
      const br = new Filter(sr);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        let env = 0;
        for (const b of [0, 0.011, 0.022]) if (t >= b) env = Math.max(env, Math.exp(-(t - b) / 0.004));
        if (t >= 0.03) env = Math.max(env, 0.75 * Math.exp(-(t - 0.03) / 0.13));
        const l = soft(bl.run(noise(), 1250, 1.2).band * env * 2.4);
        const rr = soft(br.run(noise(), 1250, 1.2).band * env * 2.4);
        out(k, l * vel * gl, rr * vel * gr);
      }
      break;
    }
    case 'hat': {
      const decay = e.p?.open ? 0.22 : 0.028;
      const hp = new Filter(sr);
      const bp = new Filter(sr);
      // the six square waves of an 808 hat, for a metallic edge
      const oscs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f, i) => ({ o: new Osc(r()), f: f * 1.7, i }));
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        let metal = 0;
        for (const o of oscs) metal += o.o.square(o.f, sr);
        const x = noise() * 0.7 + metal * 0.08;
        const v = (hp.run(x, 7200).high * 0.7 + bp.run(x, 10500, 0.9).band * 0.5) * Math.exp(-t / decay) * vel;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'cowbell': {
      // the pitched 808 cowbell of phonk: two squares a fifth-ish apart, band-passed and driven
      const a = new Osc(r());
      const b = new Osc(r());
      const bp = new Filter(sr);
      const lp = new Filter(sr);
      const cutoff = e.p?.cutoff ?? 20000;
      const decay = e.p?.decay ?? 0.17;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const s = a.square(hz, sr) * 0.6 + b.square(hz * 1.48, sr) * 0.4;
        let v = bp.run(s, hz * 2.2, 1.4).band * 1.4 + s * 0.12;
        const env = 0.6 * Math.exp(-t / 0.012) + 0.4 * Math.exp(-t / decay);
        v = soft(v * env * 2.2) * 0.55 * vel;
        if (cutoff < 15000) v = lp.run(v, cutoff, 0.8).low;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'bass808': {
      // a long sine with a pitch blip at the start, sliding from the last note when it glides, then driven
      const from = e.p?.glide !== undefined ? midiHz(e.p.glide) : hz;
      const drive = e.p?.drive ?? 1.6;
      const decay = e.p?.decay ?? 1.6;
      const lp = new Filter(sr);
      let ph = 0;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const f = from !== hz ? from * Math.pow(hz / from, Math.min(1, t / 0.07)) : hz * (1 + 0.45 * Math.exp(-t / 0.012));
        ph += f / sr;
        const env = (t < 0.003 ? t / 0.003 : 1) * Math.exp(-t / decay) * (t > e.d ? Math.max(0, 1 - (t - e.d) / 0.08) : 1);
        const v = lp.run(soft(Math.sin(2 * Math.PI * ph) * drive) / soft(drive), 2800).low * env * vel;
        out(k, v, v);
      }
      break;
    }
    case 'reese': {
      // drum & bass: detuned saws growling through a slowly moving filter, over a clean sub
      const o = [new Osc(r()), new Osc(r()), new Osc(r())];
      const sub = new Osc();
      const fl = new Filter(sr);
      const fr = new Filter(sr);
      const cutoff = e.p?.cutoff ?? 650;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const env = adsr(t, e.d, 0.01, 0.1, 1, 0.06);
        const c = cutoff * (1 + 0.35 * Math.sin(2 * Math.PI * 0.35 * t + e.t));
        const s0 = o[0].saw(hz, sr);
        const l = fl.run(s0 + o[1].saw(hz * 1.007, sr), c, 1.1).low;
        const rr = fr.run(s0 + o[2].saw(hz * 0.993, sr), c, 1.1).low;
        const s = sub.sine(hz, sr) * 0.7;
        out(k, soft((l * 0.5 + s) * 1.4) * env * vel * 0.7, soft((rr * 0.5 + s) * 1.4) * env * vel * 0.7);
      }
      break;
    }
    case 'wobble': {
      // dubstep: saw and square through a resonant filter opened and closed `rate` times a second
      const a = new Osc(r());
      const b = new Osc(r());
      const c2 = new Osc(r());
      const sub = new Osc();
      const f1 = new Filter(sr);
      const rate = e.p?.rate ?? 4;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const env = adsr(t, e.d, 0.005, 0.05, 1, 0.04);
        const lfo = 0.5 - 0.5 * Math.cos(2 * Math.PI * rate * t);
        const x = a.saw(hz, sr) * 0.6 + b.square(hz * 1.003, sr) * 0.4 + c2.saw(hz * 2.004, sr) * 0.3;
        const v = soft(f1.run(x, 90 + 2600 * lfo * lfo, 2.6).low * 2.4);
        const s = sub.sine(hz, sr) * 0.55;
        const o2 = (v * 0.6 + s) * env * vel * 0.75;
        out(k, o2, o2);
      }
      break;
    }
    case 'sub': {
      // 0: EDM off-beat bass (filtered saw over a sine), 1: round lo-fi bass
      const a = new Osc(r());
      const s = new Osc();
      const f = new Filter(sr);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        let v: number;
        if (style === 1) {
          const env = (t < 0.01 ? t / 0.01 : Math.exp(-t / 0.9)) * (t > e.d ? Math.max(0, 1 - (t - e.d) / 0.06) : 1);
          const x = s.sine(hz, sr);
          v = f.run(x + 0.25 * x * x * x, 1100).low * env * 0.9;
        } else {
          const env = adsr(t, e.d, 0.004, 0.08, 0.75, 0.05);
          v = (f.run(a.saw(hz, sr), 700 + 900 * Math.exp(-t / 0.05), 0.9).low * 0.6 + s.sine(hz, sr) * 0.6) * env;
        }
        out(k, v * vel, v * vel);
      }
      break;
    }
    case 'pad':
    case 'strings': {
      // detuned saws through a low-pass (it may sweep from `cutoff` to `cutoff2`); voices split left and right
      const o = [new Osc(r()), new Osc(r()), new Osc(r())];
      const fl = new Filter(sr);
      const fr = new Filter(sr);
      const c1 = e.p?.cutoff ?? (e.inst === 'pad' ? 1800 : 2400);
      const c2 = e.p?.cutoff2 ?? c1;
      const attack = e.p?.attack ?? (e.inst === 'pad' ? 0.35 : 0.006);
      const release = e.p?.release ?? (e.inst === 'pad' ? 0.7 : 0.1);
      const d = e.inst === 'pad' ? 0.5 : 0.1;
      const s = e.inst === 'pad' ? 0.85 : 0.45;
      const det = e.inst === 'pad' ? 0.1 : 0.06;
      const f0 = midiHz((e.note ?? 60) - det);
      const f2 = midiHz((e.note ?? 60) + det);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const env = adsr(t, e.d, attack, d, s, release);
        const cut = c1 + (c2 - c1) * Math.min(1, t / Math.max(0.01, e.d));
        const mid = o[1].saw(hz, sr) * 0.7;
        const l = fl.run(o[0].saw(f0, sr) + mid, cut, 0.8).low;
        const rr = fr.run(o[2].saw(f2, sr) + mid, cut, 0.8).low;
        out(k, l * env * vel * 0.32 * gl, rr * env * vel * 0.32 * gr);
      }
      break;
    }
    case 'stab':
    case 'lead': {
      // supersaw: five detuned saws, a filter that closes after the attack
      const dets = [-0.2, -0.1, 0, 0.1, 0.2];
      const o = dets.map(() => new Osc(r()));
      const fs = dets.map((d) => midiHz((e.note ?? 60) + d));
      const fl = new Filter(sr);
      const fr = new Filter(sr);
      const lead = e.inst === 'lead';
      const base = e.p?.cutoff ?? (lead ? 2600 : 1400);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const env = lead ? adsr(t, e.d, 0.01, 0.2, 0.75, 0.15) : adsr(t, e.d, 0.003, 0.18, 0.45, 0.1);
        const cut = base + (lead ? 2600 : 5200) * Math.exp(-t / (lead ? 0.3 : 0.12));
        let l = 0;
        let rr = 0;
        for (let v = 0; v < 5; v++) {
          const s = o[v].saw(fs[v], sr);
          if (v === 2) {
            l += s * 0.7;
            rr += s * 0.7;
          } else if (v % 2) l += s;
          else rr += s;
        }
        out(k, fl.run(l, cut, 0.8).low * env * vel * 0.22 * gl, fr.run(rr, cut, 0.8).low * env * vel * 0.22 * gr);
      }
      break;
    }
    case 'pluck': {
      const a = new Osc(r());
      const b = new Osc(r());
      const f = new Filter(sr);
      const fb = midiHz((e.note ?? 60) + 0.06);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const env = (t < 0.002 ? t / 0.002 : Math.exp(-t / 0.24)) * (t > e.d + 0.25 ? Math.max(0, 1 - (t - e.d - 0.25) / 0.15) : 1);
        const v = f.run(a.saw(hz, sr) + b.square(fb, sr) * 0.5, 300 + 5200 * Math.exp(-t / 0.09), 0.9).low * env * vel * 0.4;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'bell': {
      // FM bell: an inharmonic modulator whose depth dies away
      const ratio = e.p?.ratio ?? 3.5;
      let pc = 0;
      let pm = 0;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        pc += hz / sr;
        pm += (hz * ratio) / sr;
        const index = 2.4 * Math.exp(-t / 0.35) + 0.3;
        const v = (Math.sin(2 * Math.PI * pc + index * Math.sin(2 * Math.PI * pm)) * Math.exp(-t / 0.9) + 0.15 * Math.sin(4 * Math.PI * pc) * Math.exp(-t / 0.15)) * (t < 0.002 ? t / 0.002 : 1) * vel * 0.3;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'epiano': {
      // FM electric piano with a little tine and a stereo tremolo
      let pc = 0;
      let pt = 0;
      const tine = hz * 14 < sr / 2;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        pc += hz / sr;
        pt += (hz * 14) / sr;
        const index = 1.5 * Math.exp(-t / 0.4) + 0.25;
        const env = (t < 0.003 ? t / 0.003 : Math.exp(-t / 1.6)) * (t > e.d ? Math.max(0, 1 - (t - e.d) / 0.3) : 1);
        let v = Math.sin(2 * Math.PI * pc + index * Math.sin(2 * Math.PI * pc)) * env;
        if (tine) v += 0.1 * Math.sin(2 * Math.PI * pt) * Math.exp(-t / 0.02);
        const trem = 0.12 * Math.sin(2 * Math.PI * 4.5 * t);
        out(k, v * (1 + trem) * vel * 0.28 * gl, v * (1 - trem) * vel * 0.28 * gr);
      }
      break;
    }
    case 'braam': {
      // the big brass blast of trailers: the note and its fifth, filter swelling open, driven hard
      const notes = [hz, hz * 1.4983, hz * 0.5];
      const o = [0, 1, 2, 3, 4, 5].map(() => new Osc(r()));
      const sub = new Osc();
      const fl = new Filter(sr);
      const fr = new Filter(sr);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const env = (t < 0.06 ? t / 0.06 : Math.exp(-(t - 0.06) / 2)) * vel;
        const cut = 150 + 2400 * (t < 0.2 ? t / 0.2 : Math.exp(-(t - 0.2) / 0.9));
        const l = o[0].saw(notes[0] * 0.996, sr) + o[1].saw(notes[1] * 1.003, sr) + o[2].saw(notes[0] * 1.004, sr);
        const rr = o[3].saw(notes[0] * 1.003, sr) + o[4].saw(notes[1] * 0.997, sr) + o[5].saw(notes[0] * 0.995, sr);
        const s = sub.square(notes[2], sr) * 0.5;
        out(k, soft((fl.run(l, cut, 1.2).low + s) * 1.8) * env * 0.55, soft((fr.run(rr, cut, 1.2).low + s) * 1.8) * env * 0.55);
      }
      break;
    }
    case 'taiko': {
      const lp = new Filter(sr);
      let ph = 0;
      const tune = Math.pow(2, (e.p?.pitch ?? 0) / 12);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        ph += ((72 + 48 * Math.exp(-t / 0.05)) * tune) / sr;
        const v = soft((Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.32) + lp.run(noise(), 520).low * Math.exp(-t / 0.04) * 1.6) * 1.5) * vel * 0.9;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'tick': {
      const bp = new Filter(sr);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const v = (bp.run(noise(), 2600, 4).band * 2.5 * Math.exp(-t / 0.006) + 0.3 * Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t / 0.008)) * vel;
        out(k, v * gl, v * gr);
      }
      break;
    }
    case 'crash':
    case 'reverseCrash': {
      const hl = new Filter(sr);
      const hr = new Filter(sr);
      const bl = new Filter(sr);
      const br = new Filter(sr);
      const reverse = e.inst === 'reverseCrash';
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const env = reverse ? Math.exp(-(e.d - t) / 0.45) * Math.min(1, t / 0.05) : t < 0.001 ? t / 0.001 : Math.exp(-t / 0.85);
        const xl = noise();
        const xr = noise();
        const l = (hl.run(xl, 4800).high * 0.6 + bl.run(xl, 8000, 0.8).band * 0.5) * env * vel;
        const rr = (hr.run(xr, 4800).high * 0.6 + br.run(xr, 8000, 0.8).band * 0.5) * env * vel;
        out(k, l, rr);
      }
      break;
    }
    case 'riser':
    case 'downlifter': {
      // a noise sweep (up into a drop, or down after one), with a pitched saw under the riser
      const fl = new Filter(sr);
      const fr = new Filter(sr);
      const tone = new Osc(r());
      const up = e.inst === 'riser';
      const base = midiHz(e.note ?? 48);
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        const x = t / e.d;
        const cut = up ? 300 * Math.pow(8000 / 300, x) : 6000 * Math.pow(150 / 6000, x);
        const env = up ? Math.pow(x, 1.8) : Math.pow(1 - x, 1.5) * Math.min(1, t / 0.01);
        const s = up ? tone.saw(base * Math.pow(4, x), sr) * 0.12 * x * x : 0;
        out(k, (fl.run(noise(), cut, 1.5).band * 1.3 + s) * env * vel, (fr.run(noise(), cut, 1.5).band * 1.3 + s) * env * vel);
      }
      break;
    }
    case 'impact': {
      const lp = new Filter(sr);
      const rl = new Filter(sr);
      let ph = 0;
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        ph += (35 + 55 * Math.exp(-t / 0.08)) / sr;
        const v = soft((Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.6) + lp.run(noise(), 2500).low * Math.exp(-t / 0.05) * 1.2 + rl.run(noise(), 200).low * Math.exp(-t / 0.8) * 1.6) * 1.6) * vel * 0.9;
        out(k, v, v);
      }
      break;
    }
    case 'vinyl': {
      // record hiss and crackle (lo-fi), under the whole song
      const hl = new Filter(sr);
      const hr = new Filter(sr);
      let crackL = 0;
      let crackR = 0;
      const decay = Math.exp(-1 / (0.0004 * sr));
      const chance = 9 / sr;
      for (let k = 0; k < n; k++) {
        if (r() < chance) crackL += (0.05 + 0.2 * r()) * (r() < 0.5 ? -1 : 1);
        if (r() < chance) crackR += (0.05 + 0.2 * r()) * (r() < 0.5 ? -1 : 1);
        const l = hl.run(noise(), 3800).band * 0.05 + crackL;
        const rr = hr.run(noise(), 3800).band * 0.05 + crackR;
        crackL *= decay;
        crackR *= decay;
        out(k, l * vel, rr * vel);
      }
      break;
    }
  }
  // no click where a sound is cut short: a 10 ms fade before the end
  const fade = Math.min(n, Math.max(1, Math.round(0.01 * sr)));
  for (let k = 0; k < fade; k++) {
    L[n - 1 - k] *= k / fade;
    R[n - 1 - k] *= k / fade;
  }
  return { L, R };
}

/** Adds a rendered note to the mix at its time, velocity and pan, pumping with the kick if its part does. */
export function mixNote(m: Mix, e: NoteEvent, note: Rendered): void {
  const start = Math.round(e.t * m.sr);
  const n = Math.min(note.L.length, m.L.length - start);
  if (n <= 0 || start < 0) return;
  const pan = e.pan ?? 0;
  const gl = (pan > 0 ? 1 - pan : 1) * e.vel;
  const gr = (pan < 0 ? 1 + pan : 1) * e.vel;
  const pumps = PUMPS.has(e.inst);
  const rev = (e.p?.rev ?? 0) * 0.5;
  const dly = (e.p?.dly ?? 0) * 0.5;
  for (let k = 0; k < n; k++) {
    const i = start + k;
    const g = pumps ? m.duck[i] : 1;
    const l = note.L[k] * gl * g;
    const rr = note.R[k] * gr * g;
    m.L[i] += l;
    m.R[i] += rr;
    if (rev) m.rev[i] += (l + rr) * rev;
    if (dly) m.dly[i] += (l + rr) * dly;
  }
}

/** Freeverb-style reverb of a mono send, added to the song in stereo. */
export function addReverb(m: Mix, o: { room: number; damp: number; wet: number }): void {
  const scale = m.sr / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const passes = [556, 441, 341, 225];
  const x = m.rev;
  for (const [ch, spread] of [
    [0, 0],
    [1, 23],
  ] as const) {
    const y = ch ? m.R : m.L;
    const cb = combs.map((d) => new Float32Array(Math.round((d + spread) * scale)));
    const ci = combs.map(() => 0);
    const store = combs.map(() => 0);
    const ab = passes.map((d) => new Float32Array(Math.round((d + spread) * scale)));
    const ai = passes.map(() => 0);
    for (let s = 0; s < x.length; s++) {
      const input = x[s] * 0.015;
      let acc = 0;
      for (let c = 0; c < 8; c++) {
        const buf = cb[c];
        const v = buf[ci[c]];
        store[c] = v * (1 - o.damp) + store[c] * o.damp;
        buf[ci[c]] = input + store[c] * o.room;
        if (++ci[c] >= buf.length) ci[c] = 0;
        acc += v;
      }
      for (let a = 0; a < 4; a++) {
        const buf = ab[a];
        const b = buf[ai[a]];
        buf[ai[a]] = acc + b * 0.5;
        if (++ai[a] >= buf.length) ai[a] = 0;
        acc = b - acc;
      }
      y[s] += acc * o.wet;
    }
  }
}

/** Ping-pong echo of a mono send (darker with each repeat), added to the song. */
export function addDelay(m: Mix, o: { time: number; feedback: number; wet: number }): void {
  const d = Math.max(1, Math.round(o.time * m.sr));
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const tone = new Filter(m.sr);
  let i = 0;
  for (let s = 0; s < m.dly.length; s++) {
    const yl = bl[i];
    const yr = br[i];
    bl[i] = m.dly[s] + tone.run(yr, 3500).low * o.feedback;
    br[i] = yl * o.feedback;
    if (++i >= d) i = 0;
    m.L[s] += yl * o.wet;
    m.R[s] += yr * o.wet;
  }
}

/** Sidechain pumping: the gain dips at each kick and comes back over `release` seconds. */
export function duckAt(m: Mix, times: number[], depth: number, release: number): void {
  if (depth <= 0) return;
  const rel = Math.max(1, Math.round(release * m.sr));
  const attack = Math.round(0.002 * m.sr);
  for (const t of times) {
    const s = Math.round(t * m.sr);
    for (let k = -attack; k < rel; k++) {
      const i = s + k;
      if (i < 0 || i >= m.duck.length) continue;
      // down to 1 − depth over 2 ms just before the kick, then back up
      const g = k < 0 ? 1 - depth * (1 + k / attack) : 1 - depth * (1 - k / rel) ** 2;
      if (g < m.duck[i]) m.duck[i] = g;
    }
  }
}

/** Warms a lo-fi song: a gentle low-pass over everything. */
export function lowPass(m: Mix, cutoff: number): void {
  const fl = new Filter(m.sr);
  const fr = new Filter(m.sr);
  for (let s = 0; s < m.L.length; s++) {
    m.L[s] = fl.run(m.L[s], cutoff, 0.7).low;
    m.R[s] = fr.run(m.R[s], cutoff, 0.7).low;
  }
}

/** The master: level, soft saturation (`drive`), fades at both ends, and a final peak of −0.7 dBFS. */
export function master(m: Mix, drive: number, fadeOut: number): void {
  const L = m.L;
  const R = m.R;
  let peak = 0;
  for (let s = 0; s < L.length; s++) peak = Math.max(peak, Math.abs(L[s]), Math.abs(R[s]));
  if (peak <= 0) return;
  const pre = drive / peak;
  const norm = 1 / soft(drive);
  for (let s = 0; s < L.length; s++) {
    L[s] = soft(L[s] * pre) * norm;
    R[s] = soft(R[s] * pre) * norm;
  }
  const fin = Math.min(L.length, Math.round(0.004 * m.sr));
  for (let s = 0; s < fin; s++) {
    L[s] *= s / fin;
    R[s] *= s / fin;
  }
  const fout = Math.min(L.length, Math.round(fadeOut * m.sr));
  for (let s = 0; s < fout; s++) {
    const g = s / fout;
    L[L.length - 1 - s] *= g * g;
    R[R.length - 1 - s] *= g * g;
  }
  peak = 0;
  for (let s = 0; s < L.length; s++) peak = Math.max(peak, Math.abs(L[s]), Math.abs(R[s]));
  if (peak > 0) {
    const g = 0.92 / peak;
    for (let s = 0; s < L.length; s++) {
      L[s] *= g;
      R[s] *= g;
    }
  }
}
