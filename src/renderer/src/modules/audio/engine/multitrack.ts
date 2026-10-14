/**
 * Multitrack session: tracks of clips placed on a timeline (positions in frames at the
 * session sample rate), per-track volume / pan / mute / solo, and the mixer used for
 * playback and mixdown. Immutable updates (for snapshot undo). Pure TypeScript.
 */
import { uid } from '../../../core/utils/id';

export interface MtClip {
  id: string;
  sourceId: string;
  /** Timeline position (frames). */
  start: number;
  /** Offset into the source (frames). */
  offset: number;
  /** Length on the timeline (frames). */
  length: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
}

export interface MtTrack {
  id: string;
  name: string;
  volumeDb: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  mute: boolean;
  solo: boolean;
  color: string;
  clips: MtClip[];
}

export interface MtSession {
  sampleRate: number;
  tracks: MtTrack[];
}

export interface MtSource {
  id: string;
  name: string;
  sampleRate: number;
  channels: Float32Array[];
}

export const TRACK_COLORS = ['#10d9b0', '#5b9cff', '#f5a524', '#e85d9b', '#a78bfa', '#4ade80', '#fb7185', '#38bdf8'];

export function emptySession(sampleRate = 48000): MtSession {
  return { sampleRate, tracks: [] };
}

export function newTrack(session: MtSession, name?: string): MtTrack {
  const index = session.tracks.length;
  return {
    id: uid('trk'),
    name: name ?? `Track ${index + 1}`,
    volumeDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    clips: [],
  };
}

export function sessionLength(session: MtSession): number {
  let end = 0;
  for (const t of session.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
  return end;
}

export function findClip(session: MtSession, clipId: string): { track: MtTrack; clip: MtClip } | null {
  for (const track of session.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function mapTracks(session: MtSession, fn: (t: MtTrack) => MtTrack): MtSession {
  return { ...session, tracks: session.tracks.map(fn) };
}

export function addTrack(session: MtSession, name?: string): MtSession {
  return { ...session, tracks: [...session.tracks, newTrack(session, name)] };
}

export function removeTrack(session: MtSession, trackId: string): MtSession {
  return { ...session, tracks: session.tracks.filter((t) => t.id !== trackId) };
}

export function updateTrack(session: MtSession, trackId: string, patch: Partial<Omit<MtTrack, 'id' | 'clips'>>): MtSession {
  return mapTracks(session, (t) => (t.id === trackId ? { ...t, ...patch } : t));
}

export function addClip(session: MtSession, trackId: string, clip: Omit<MtClip, 'id'>): { session: MtSession; clipId: string } {
  const id = uid('clp');
  return { session: mapTracks(session, (t) => (t.id === trackId ? { ...t, clips: [...t.clips, { ...clip, id }] } : t)), clipId: id };
}

export function removeClip(session: MtSession, clipId: string): MtSession {
  return mapTracks(session, (t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t));
}

export function updateClip(session: MtSession, clipId: string, patch: Partial<Omit<MtClip, 'id' | 'sourceId'>>): MtSession {
  return mapTracks(session, (t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) } : t));
}

/** Moves a clip in time (and optionally to another track). */
export function moveClip(session: MtSession, clipId: string, start: number, trackId?: string): MtSession {
  const found = findClip(session, clipId);
  if (!found) return session;
  const moved = { ...found.clip, start: Math.max(0, Math.round(start)) };
  const target = trackId && session.tracks.some((t) => t.id === trackId) ? trackId : found.track.id;
  return mapTracks(session, (t) => {
    let clips = t.clips.filter((c) => c.id !== clipId);
    if (t.id === target) clips = [...clips, moved];
    return clips === t.clips ? t : { ...t, clips };
  });
}

/** Trims a clip edge to timeline position `pos`, limited by the source length. */
export function trimClip(session: MtSession, clipId: string, edge: 'start' | 'end', pos: number, sourceLength: number, minLength = 1): MtSession {
  const found = findClip(session, clipId);
  if (!found) return session;
  const c = found.clip;
  if (edge === 'start') {
    const earliest = c.start - c.offset; // cannot reveal audio before the source start
    const latest = c.start + c.length - minLength;
    const newStart = Math.round(Math.min(latest, Math.max(earliest, Math.max(0, pos))));
    const delta = newStart - c.start;
    return updateClip(session, clipId, { start: newStart, offset: c.offset + delta, length: c.length - delta });
  }
  const maxEnd = c.start + (sourceLength - c.offset);
  const newEnd = Math.round(Math.min(maxEnd, Math.max(c.start + minLength, pos)));
  return updateClip(session, clipId, { length: newEnd - c.start });
}

/** Splits a clip at timeline position `at` into two clips. */
export function splitClip(session: MtSession, clipId: string, at: number): MtSession {
  const found = findClip(session, clipId);
  if (!found) return session;
  const c = found.clip;
  const cut = Math.round(at);
  if (cut <= c.start || cut >= c.start + c.length) return session;
  const left: MtClip = { ...c, length: cut - c.start, fadeOut: 0 };
  const right: MtClip = { ...c, id: uid('clp'), start: cut, offset: c.offset + (cut - c.start), length: c.start + c.length - cut, fadeIn: 0 };
  return mapTracks(session, (t) => (t.id === found.track.id ? { ...t, clips: t.clips.flatMap((x) => (x.id === clipId ? [left, right] : [x])) } : t));
}

export function duplicateClip(session: MtSession, clipId: string): { session: MtSession; clipId: string } {
  const found = findClip(session, clipId);
  if (!found) return { session, clipId };
  const id = uid('clp');
  const copy: MtClip = { ...found.clip, id, start: found.clip.start + found.clip.length };
  return { session: mapTracks(session, (t) => (t.id === found.track.id ? { ...t, clips: [...t.clips, copy] } : t)), clipId: id };
}

/** Balance pan law: centre keeps unity on both sides, hard left/right mutes the other side. */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  return p <= 0 ? [1, 1 + p] : [1 - p, 1];
}

export function audibleTracks(session: MtSession): MtTrack[] {
  const anySolo = session.tracks.some((t) => t.solo);
  return session.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
}

/**
 * Renders frames [start, start + count) of the stereo mix. Sources must be at the
 * session sample rate (they are resampled when imported).
 */
export function mixRange(session: MtSession, sources: Map<string, MtSource>, start: number, count: number): Float32Array[] {
  const out = [new Float32Array(count), new Float32Array(count)];
  const end = start + count;
  for (const track of audibleTracks(session)) {
    const tg = Math.pow(10, track.volumeDb / 20);
    const [pl, pr] = panGains(track.pan);
    for (const clip of track.clips) {
      const cs = clip.start;
      const ce = clip.start + clip.length;
      if (ce <= start || cs >= end) continue;
      const src = sources.get(clip.sourceId);
      if (!src || !src.channels.length) continue;
      const g = tg * Math.pow(10, clip.gainDb / 20);
      const left = src.channels[0];
      const right = src.channels[1] ?? left;
      const from = Math.max(cs, start);
      const to = Math.min(ce, end);
      const srcLen = left.length;
      for (let t = from; t < to; t++) {
        const s = clip.offset + (t - cs);
        if (s < 0 || s >= srcLen) continue;
        let fg = g;
        const intoClip = t - cs;
        const toEnd = ce - t;
        if (clip.fadeIn > 0 && intoClip < clip.fadeIn) fg *= intoClip / clip.fadeIn;
        if (clip.fadeOut > 0 && toEnd < clip.fadeOut) fg *= toEnd / clip.fadeOut;
        const i = t - start;
        out[0][i] += left[s] * fg * pl;
        out[1][i] += right[s] * fg * pr;
      }
    }
  }
  return out;
}

/** Simple immutable snapshot history for the session. */
export class SnapshotHistory<T> {
  private past: { state: T; label: string }[] = [];
  private future: { state: T; label: string }[] = [];
  constructor(private limit = 100) {}

  push(previous: T, label: string): void {
    this.past.push({ state: previous, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ state: current, label: entry.label });
    return entry.state;
  }

  redo(current: T): T | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ state: current, label: entry.label });
    return entry.state;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
