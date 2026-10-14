import type { Clip, ClipKind, Project, Track, TrackKind } from '../types';
import { addTrack, clipEnd, getClip, isLockedTrack, tracksOfKind } from '../model';

/* Which clips and tracks an AI action talks about. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Thrown by action handlers: the action is skipped and the reason goes back to the AI. */
export class Skip extends Error {}

/** A track by name ("V2", "A1"), id or 1-based number among the tracks of `kind` (any kind when omitted). */
export function findTrack(p: Project, ref: unknown, kind?: TrackKind): Track | null {
  const pool = kind ? tracksOfKind(p, kind) : p.tracks;
  if (typeof ref === 'string') {
    const key = ref.trim().toLowerCase();
    const hit = pool.find((t) => t.id === ref || t.name.toLowerCase() === key);
    if (hit) return hit;
    const m = /^([vac])?(\d+)$/i.exec(key);
    if (m) {
      const k: TrackKind | undefined = m[1] ? ({ v: 'video', a: 'audio', c: 'caption' } as const)[m[1].toLowerCase() as 'v' | 'a' | 'c'] : kind;
      if (!k || (kind && k !== kind)) return null;
      return tracksOfKind(p, k)[parseInt(m[2], 10) - 1] ?? null;
    }
    return null;
  }
  if (finite(ref) && kind) return tracksOfKind(p, kind)[Math.round(ref) - 1] ?? null;
  return null;
}

/** Like findTrack, but adds the missing tracks when the AI asks for the next one (V3 when there are two). */
export function trackOrCreate(p: Project, ref: unknown, kind: TrackKind): { project: Project; track: Track | null } {
  const found = findTrack(p, ref, kind);
  if (found) return { project: p, track: found };
  const m = typeof ref === 'string' ? /^[vac]?(\d+)$/i.exec(ref.trim()) : null;
  const wanted = m ? parseInt(m[1], 10) : finite(ref) ? Math.round(ref) : NaN;
  const have = tracksOfKind(p, kind).length;
  if (!(wanted > have && wanted <= 12)) return { project: p, track: null };
  let project = p;
  let last: Track | null = null;
  for (let i = have; i < wanted; i++) {
    const r = addTrack(project, kind);
    project = r.project;
    last = r.track;
  }
  return { project, track: last };
}

export interface TargetOptions {
  /** Only clips of these kinds (others are skipped with a note). */
  kinds?: ClipKind[];
  /** Selected clip ids (for "selected"). */
  selection?: string[];
  /** Allow an empty result (no Skip). */
  optional?: boolean;
}

/**
 * Clip ids from "clipId", "clipIds" or "clips": an id, a list of ids, "all", "selected", a track name
 * such as "V1", or {"track": "V1", "kind": "video", "from": s, "to": s}. Clips on locked tracks are left out.
 */
export function resolveClips(p: Project, a: Obj, opts: TargetOptions = {}): { ids: string[]; notes: string[] } {
  const notes: string[] = [];
  const picked: Clip[] = [];
  const add = (c: Clip | undefined, label: string) => {
    if (!c) notes.push(`unknown clip ${label}`);
    else if (!picked.includes(c)) picked.push(c);
  };
  const bySelector = (sel: unknown) => {
    if (sel === 'all') {
      picked.push(...p.clips.filter((c) => !picked.includes(c)));
      return;
    }
    if (sel === 'selected') {
      for (const id of opts.selection ?? []) add(getClip(p, id), id);
      if (!opts.selection?.length) notes.push('no clip is selected');
      return;
    }
    if (typeof sel === 'string') {
      const clip = getClip(p, sel);
      if (clip) return add(clip, sel);
      const track = findTrack(p, sel);
      if (track) {
        picked.push(...p.clips.filter((c) => c.trackId === track.id && !picked.includes(c)));
        return;
      }
      notes.push(`unknown clip or track ${sel}`);
      return;
    }
    if (Array.isArray(sel)) {
      for (const item of sel.slice(0, 500)) bySelector(item);
      return;
    }
    if (isObj(sel)) {
      const track = sel.track !== undefined ? findTrack(p, sel.track) : null;
      if (sel.track !== undefined && !track) {
        notes.push(`unknown track ${String(sel.track)}`);
        return;
      }
      const from = finite(sel.from) ? sel.from : -Infinity;
      const to = finite(sel.to) ? sel.to : Infinity;
      const kind = typeof sel.kind === 'string' ? sel.kind : null;
      picked.push(
        ...p.clips.filter(
          (c) => !picked.includes(c) && (!track || c.trackId === track.id) && (!kind || c.kind === kind) && clipEnd(c) > from && c.start < to,
        ),
      );
      return;
    }
    notes.push('no clips named');
  };
  if (typeof a.clipId === 'string') add(getClip(p, a.clipId), a.clipId);
  if (Array.isArray(a.clipIds)) for (const id of a.clipIds.slice(0, 500)) typeof id === 'string' && add(getClip(p, id), id);
  if (a.clips !== undefined) bySelector(a.clips);
  if (a.clipId === undefined && a.clipIds === undefined && a.clips === undefined) notes.push('no clips named (use clipId, clipIds or clips)');
  let list = picked;
  if (opts.kinds) {
    const wrong = list.filter((c) => !opts.kinds!.includes(c.kind));
    if (wrong.length && list.length === wrong.length) notes.push(`this works on ${opts.kinds.join('/')} clips only`);
    list = list.filter((c) => opts.kinds!.includes(c.kind));
  }
  const locked = list.filter((c) => isLockedTrack(p, c.trackId));
  if (locked.length) notes.push(`${locked.length} clip(s) on locked tracks left out`);
  const ids = list.filter((c) => !isLockedTrack(p, c.trackId)).map((c) => c.id);
  if (!ids.length && !opts.optional) throw new Skip(notes.join('; ') || 'no matching clips');
  return { ids, notes };
}
