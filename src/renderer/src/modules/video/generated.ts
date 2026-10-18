import type { AudioAnalysis } from './analysis';
import type { MediaAnalysis } from './analysisStore';
import type { GeneratedSound, MediaRef, Project } from './types';
import { addMediaRefs, clipEnd, findFreeAudioTrack, getMedia, insertClips, makeClip } from './model';
import { SFX, SFX_LIMITS, SFX_RATE, sfxWav, type LibraryItem, type SfxVariant } from './library';
import { MUSIC_LIMITS, MUSIC_RATE, fitDrop, genreInfo, keyName, musicTitle, normalizeMusicSpec, planMusic, renderMusic, type Genre, type MusicSpec, type ScaleName, type SectionKind } from './music';
import { encodeWav } from './stems';

/*
 * Sounds made by Ultima for a project (pure, unit tested): songs from the music generator and custom versions of the
 * library's sound effects. A project keeps only their recipe, never the sound: the editor makes the file again when
 * the project opens, as it does for the built-in library (their media ids start with "lib_" too, so they are never
 * "missing").
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** A valid recipe from anything (a project file, the AI), or undefined. */
export function normalizeGenerated(v: unknown): GeneratedSound | undefined {
  if (!isObj(v)) return undefined;
  if (v.type === 'music') {
    const m = normalizeMusicSpec(v);
    return m && { type: 'music', ...m };
  }
  if (v.type !== 'sfx') return undefined;
  const item = SFX.find((x) => x.id === v.sound);
  if (!item) return undefined;
  return {
    type: 'sfx',
    sound: item.id,
    duration: round(clamp(num(v.duration, item.duration ?? 1), SFX_LIMITS.minDuration, SFX_LIMITS.maxDuration), 3),
    pitch: round(clamp(num(v.pitch, 0), -SFX_LIMITS.pitch, SFX_LIMITS.pitch), 2),
    brightness: round(clamp(num(v.brightness, 0), -1, 1), 2),
    seed: Math.round(clamp(num(v.seed, 0), 0, 1e6)),
  };
}

/** The media id of a recipe: the same recipe is the same media (two 32-bit FNV-1a hashes of it). */
export function generatedId(g: GeneratedSound): string {
  const text = g.type === 'music' ? `music|${g.genre}|${g.bpm}|${g.root}|${g.scale}|${g.length}|${g.dropBars}|${g.seed}` : `sfx|${g.sound}|${g.duration}|${g.pitch}|${g.brightness}|${g.seed}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `lib_gen_${a.toString(36)}${b.toString(36)}`;
}

/** "Phonk 130 BPM F# phrygian.wav", "Riser (4.2 s, +3).wav". */
export function generatedName(g: GeneratedSound): string {
  if (g.type === 'music') return `${musicTitle(g)}.wav`;
  const item = SFX.find((x) => x.id === g.sound);
  const bits = [`${g.duration.toFixed(1)} s`];
  if (g.pitch) bits.push(`${g.pitch > 0 ? '+' : ''}${g.pitch}`);
  if (g.brightness) bits.push(g.brightness > 0 ? 'brighter' : 'darker');
  if (g.seed) bits.push(`take ${g.seed + 1}`);
  return `${item?.label ?? g.sound} (${bits.join(', ')}).wav`;
}

/** The media reference of a recipe (also before its file exists). */
export function generatedRef(g: GeneratedSound): MediaRef {
  const rate = g.type === 'music' ? MUSIC_RATE : SFX_RATE;
  const n = Math.max(1, Math.round((g.type === 'music' ? g.length : g.duration) * rate));
  return { id: generatedId(g), name: generatedName(g), kind: 'audio', duration: n / rate, width: 0, height: 0, size: 44 + n * 4, mime: 'audio/wav', hasAudio: true, generated: g };
}

/** The sound of a recipe, as a WAV file. */
export async function generatedFile(g: GeneratedSound, o: { onProgress?: (f: number) => void; signal?: AbortSignal } = {}): Promise<File> {
  const ref = generatedRef(g);
  let wav: Uint8Array;
  if (g.type === 'music') wav = encodeWav(await renderMusic(g, o));
  else {
    const item = SFX.find((x) => x.id === g.sound);
    if (!item) throw new Error(`unknown sound ${g.sound}`);
    wav = sfxWav(item, g);
  }
  return new File([wav as BlobPart], ref.name, { type: 'audio/wav', lastModified: 0 });
}

/** One line about a generated sound, for the AI. */
export function describeGenerated(g: GeneratedSound): string {
  if (g.type === 'sfx') return `custom ${g.sound} sound effect (${g.duration} s${g.pitch ? `, ${g.pitch > 0 ? '+' : ''}${g.pitch} semitones` : ''}${g.brightness ? `, brightness ${g.brightness}` : ''}${g.seed ? `, take ${g.seed + 1}` : ''})`;
  const plan = planMusic(g);
  return `generated ${genreInfo(g.genre).label} music, ${g.bpm} BPM, ${keyName(g.root, g.scale)}; drops ${plan.drops.map((d) => `${d.toFixed(2)}`).join(', ')} s into the file`;
}

/* ---------------------------------- Music ---------------------------------- */

/** Keys that suit each genre (one is picked by the variation when none is asked). */
const KEYS: Record<Genre, number[]> = { phonk: [1, 6, 8], trap: [1, 5, 9], edm: [9, 5, 7], dubstep: [5, 4, 7], dnb: [5, 9, 2], lofi: [2, 5, 9], cinematic: [2, 0, 4] };

export interface MusicRequest {
  genre: Genre;
  bpm?: number;
  root?: number;
  scale?: ScaleName;
  /** Seconds of music on the timeline. */
  length: number;
  /** Timeline second where it starts. */
  start: number;
  /** Timeline second where the first drop lands (default: after the genre's usual intro). */
  dropAt?: number;
  seed?: number;
  volume?: number;
  trackId?: string;
}

export interface PlacedMusic {
  project: Project;
  clipId: string;
  spec: MusicSpec;
  /** Seconds cut from the song's start so its drop lands where asked. */
  trim: number;
  /** Timeline seconds of each drop on the clip. */
  drops: number[];
  /** The song's parts on the timeline (within the clip). */
  sections: { kind: SectionKind; start: number; end: number }[];
  beat: number;
  bar: number;
  /** Timeline second of the first bar on the clip. */
  firstBar: number;
}

/** Makes a song for the timeline and adds it on a free audio track, with its first drop at `dropAt`. */
export function addMusic(p: Project, req: MusicRequest): PlacedMusic {
  const g = genreInfo(req.genre);
  const seed = Math.round(clamp(req.seed ?? 1, 0, 1e9));
  const bpm = clamp(req.bpm ?? g.bpm, MUSIC_LIMITS.minBpm, MUSIC_LIMITS.maxBpm);
  const length = clamp(req.length, MUSIC_LIMITS.minLength, MUSIC_LIMITS.maxLength);
  const lead = req.dropAt !== undefined ? Math.max(0, req.dropAt - req.start) : (g.dropBars * 240) / bpm;
  const fit = fitDrop(bpm, lead);
  const spec = normalizeMusicSpec({
    genre: g.id,
    bpm: fit.bpm,
    root: req.root ?? KEYS[g.id][seed % 3],
    scale: req.scale ?? g.scale,
    // a millisecond to spare, so the clip is exactly as long as asked
    length: Math.min(MUSIC_LIMITS.maxLength, Math.ceil((fit.trim + length) * 1000 + 1) / 1000),
    dropBars: fit.dropBars,
    seed,
  })!;
  const ref = generatedRef({ type: 'music', ...spec });
  const trim = Math.min(fit.trim, Math.max(0, ref.duration - 1));
  const duration = Math.min(length, ref.duration - trim);
  let project = addMediaRefs(p, [ref]);
  let trackId = req.trackId;
  if (!trackId) {
    const r = findFreeAudioTrack(project, req.start, req.start + duration);
    project = r.project;
    trackId = r.trackId;
  }
  const clip = makeClip('audio', trackId, req.start, duration, { mediaId: ref.id, name: musicTitle(spec), in: trim, volume: req.volume ?? 0 });
  project = insertClips(project, [clip]);
  const plan = planMusic(spec);
  const offset = req.start - trim;
  const end = clipEnd(clip);
  const inClip = (t: number) => t >= req.start - 1e-6 && t < end - 1e-6;
  return {
    project,
    clipId: clip.id,
    spec,
    trim,
    drops: plan.drops.map((d) => offset + d).filter(inClip),
    sections: plan.sections.map((s) => ({ kind: s.kind, start: Math.max(req.start, offset + s.start), end: Math.min(end, offset + s.end) })).filter((s) => s.end > s.start + 1e-6),
    beat: plan.beat,
    bar: plan.bar,
    firstBar: offset + Math.ceil(trim / plan.bar - 1e-9) * plan.bar,
  };
}

const planned = new Map<string, MediaAnalysis>();

/** The exact analysis of a generated song, from its plan: its beats, bars, drops and loudness. */
export function plannedAnalysis(spec: MusicSpec): MediaAnalysis {
  const key = generatedId({ type: 'music', ...spec });
  const known = planned.get(key);
  if (known) return known;
  const plan = planMusic(spec);
  const beats: number[] = [];
  for (let k = 0; k * plan.beat < spec.length - 1e-6; k++) beats.push(round(k * plan.beat, 3));
  const downbeats = beats.filter((_, k) => k % 4 === 0);
  const inDrop = (t: number) => plan.sections.some((s) => s.kind === 'drop' && t >= s.start - 1e-6 && t < s.end - 1e-6);
  const level: Record<SectionKind, number> = { intro: -18, build: -14, drop: -9, break: -18, outro: -20 };
  const rate = 10;
  const db = new Float32Array(Math.ceil(spec.length * rate));
  for (let i = 0; i < db.length; i++) {
    const t = i / rate;
    const s = plan.sections.find((x) => t >= x.start && t < x.end);
    db[i] = s ? level[s.kind] : -60;
  }
  const audio: AudioAnalysis = {
    duration: spec.length,
    beats: { bpm: spec.bpm, period: plan.beat, beats, downbeats, confidence: 1 },
    hits: downbeats.filter(inDrop),
    loud: plan.drops.map((time) => ({ time: round(time, 6), db: -3, prominence: 12 })),
    bursts: [],
    // exact: the drops are where the edit lands its biggest moments
    rises: plan.drops.map((t) => round(t, 6)),
    envelope: { rate, db },
  };
  const result: MediaAnalysis = { audio, scenes: null, analysedSeconds: spec.length };
  if (planned.size > 50) planned.clear();
  planned.set(key, result);
  return result;
}

/** Timeline seconds where the drops of a generated song's clip land (when it plays at normal speed). */
export function musicDrops(p: Project, clipId: string): number[] {
  const c = p.clips.find((x) => x.id === clipId);
  const g = c?.kind === 'audio' ? getMedia(p, c.mediaId)?.generated : undefined;
  if (!c || g?.type !== 'music' || c.speed !== 1 || c.speedKeys?.length || c.reverse) return [];
  return plannedAnalysis(g).audio!.rises.map((t) => c.start + t - c.in).filter((t) => t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6);
}

/** An analysis lookup that knows generated songs exactly (also before their file is made). */
export function withPlannedAnalysis(project: () => Project, get?: (id: string) => MediaAnalysis | 'pending' | null): (id: string) => MediaAnalysis | 'pending' | null {
  return (id) => {
    const g = getMedia(project(), id)?.generated;
    if (g?.type === 'music') return plannedAnalysis(g);
    return get?.(id) ?? null;
  };
}

/* ------------------------------ Sound effects ------------------------------ */

/** A custom version of a library sound effect, as media. */
export function sfxVariantRef(item: LibraryItem, v: SfxVariant): MediaRef {
  return generatedRef(normalizeGenerated({ type: 'sfx', sound: item.id, ...v })!);
}

/**
 * Puts a sound on free audio tracks at each time; `endAt` makes it end there instead (a riser, a snare roll or a
 * reverse cymbal into a drop). A sound that would start before 0 has its start cut.
 */
export function placeSound(p: Project, ref: MediaRef, name: string, times: number[], o: { endAt?: boolean; volume?: number; trackId?: string } = {}): { project: Project; clipIds: string[] } {
  let project = addMediaRefs(p, [ref]);
  const clipIds: string[] = [];
  for (const t of times) {
    let start = o.endAt ? t - ref.duration : t;
    let inPoint = 0;
    if (start < 0) {
      inPoint = -start;
      start = 0;
    }
    const duration = ref.duration - inPoint;
    if (duration < 0.01) continue;
    let trackId = o.trackId;
    if (!trackId) {
      const r = findFreeAudioTrack(project, start, start + duration);
      project = r.project;
      trackId = r.trackId;
    }
    const clip = makeClip('audio', trackId, start, duration, { mediaId: ref.id, name, volume: o.volume ?? 0, in: inPoint });
    project = insertClips(project, [clip]);
    clipIds.push(clip.id);
  }
  return { project, clipIds };
}
