import { uid } from '../../core/utils/id';
import type { CaptionCue, Clip, ClipKind, Keyframe, MediaRef, Project, ProjectSettings, TimeRange, Track, TrackKind } from './types';
import { DEFAULT_SETTINGS, DEFAULT_STILL_DURATION, DEFAULT_VISUAL, MAX_SPEED, MIN_SPEED, defaultCaptionStyle } from './presets';
import { EPS, clampNum, frameDur, mergeRanges } from './time';
import { animatedVisual, scaleKeys, shiftClipKeys, sourceAt, sourceOffset, sourceSpan, speedAt } from './keyframes';

/* ---------------------------------------------------------------------------------
 * Pure, immutable timeline operations. Every function returns a new Project (or the
 * same object when nothing changed) so the result can go straight into the undo history.
 * --------------------------------------------------------------------------------- */

const PREFIX: Record<TrackKind, string> = { video: 'V', audio: 'A', caption: 'C' };

export function newTrack(kind: TrackKind, name: string): Track {
  return { id: uid('t_'), kind, name, muted: false, hidden: false, locked: false, solo: false };
}

export function createProject(settings: Partial<ProjectSettings> = {}, name = 'Untitled'): Project {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    version: 1,
    name,
    settings: s,
    media: [],
    tracks: [newTrack('video', 'V1'), newTrack('video', 'V2'), newTrack('audio', 'A1'), newTrack('audio', 'A2')],
    clips: [],
    markers: [],
    workArea: null,
    captionStyle: defaultCaptionStyle(s.height),
    luts: [],
    fonts: [],
  };
}

/* --------------------------------- Lookups --------------------------------- */

export function trackKindForClip(kind: ClipKind): TrackKind {
  if (kind === 'audio') return 'audio';
  if (kind === 'caption') return 'caption';
  return 'video';
}

export const isVisualClip = (c: Clip) => c.kind === 'video' || c.kind === 'image' || c.kind === 'title' || c.kind === 'adjustment';
/** Clips whose `in`/`speed` refer to a time-based source. */
export const usesSource = (c: Clip) => c.kind === 'video' || c.kind === 'audio';
export const clipEnd = (c: Clip) => c.start + c.duration;
/** End of the source range a clip uses (speed ramps included). */
export const sourceOut = (c: Clip) => c.in + sourceSpan(c);

export function getClip(p: Project, id: string): Clip | undefined {
  return p.clips.find((c) => c.id === id);
}
export function getTrack(p: Project, id: string): Track | undefined {
  return p.tracks.find((t) => t.id === id);
}
export function getMedia(p: Project, id: string | undefined): MediaRef | undefined {
  return id ? p.media.find((m) => m.id === id) : undefined;
}
export function tracksOfKind(p: Project, kind: TrackKind): Track[] {
  return p.tracks.filter((t) => t.kind === kind);
}
export function isLockedTrack(p: Project, trackId: string): boolean {
  return Boolean(getTrack(p, trackId)?.locked);
}

/** Tracks in on-screen order: captions, video (top layer first), audio. */
export function displayTracks(p: Project): Track[] {
  return [...tracksOfKind(p, 'caption').reverse(), ...tracksOfKind(p, 'video').reverse(), ...tracksOfKind(p, 'audio')];
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function clipAt(p: Project, trackId: string, t: number): Clip | undefined {
  let found: Clip | undefined;
  for (const c of p.clips) {
    if (c.trackId === trackId && c.start <= t + EPS && t < clipEnd(c) - EPS && (!found || c.start >= found.start)) found = c;
  }
  return found;
}

export function timelineDuration(p: Project): number {
  let end = 0;
  for (const c of p.clips) end = Math.max(end, clipEnd(c));
  return end;
}

/** Sorted unique clip boundaries (for previous/next edit navigation). */
export function editPoints(p: Project): number[] {
  const set = new Set<number>([0]);
  for (const c of p.clips) {
    set.add(Math.round(c.start * 1e6) / 1e6);
    set.add(Math.round(clipEnd(c) * 1e6) / 1e6);
  }
  return [...set].sort((a, b) => a - b);
}

export function expandLinked(p: Project, ids: Iterable<string>): Set<string> {
  const out = new Set<string>(ids);
  const links = new Set<string>();
  for (const c of p.clips) if (out.has(c.id) && c.linkId) links.add(c.linkId);
  if (links.size) for (const c of p.clips) if (c.linkId && links.has(c.linkId)) out.add(c.id);
  return out;
}

/* ---------------------------------- Tracks --------------------------------- */

export function nextTrackName(p: Project, kind: TrackKind): string {
  const used = new Set(p.tracks.map((t) => t.name));
  let n = tracksOfKind(p, kind).length + 1;
  while (used.has(`${PREFIX[kind]}${n}`)) n++;
  return `${PREFIX[kind]}${n}`;
}

/** Adds a track at the top of its kind's stack (or right above `aboveId`). */
export function addTrack(p: Project, kind: TrackKind, aboveId?: string): { project: Project; track: Track } {
  const track = newTrack(kind, nextTrackName(p, kind));
  const tracks = [...p.tracks];
  const above = aboveId ? tracks.findIndex((t) => t.id === aboveId && t.kind === kind) : -1;
  if (above >= 0) tracks.splice(above + 1, 0, track);
  else {
    let last = -1;
    tracks.forEach((t, i) => t.kind === kind && (last = i));
    if (last >= 0) tracks.splice(last + 1, 0, track);
    else tracks.push(track);
  }
  return { project: { ...p, tracks }, track };
}

export function removeTrack(p: Project, trackId: string): Project {
  if (!getTrack(p, trackId)) return p;
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), clips: normalizeLinks(p.clips.filter((c) => c.trackId !== trackId)) };
}

export function updateTrack(p: Project, trackId: string, patch: Partial<Omit<Track, 'id' | 'kind'>>): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) };
}

/** First unlocked track of a kind, creating one when needed. */
export function ensureTrack(p: Project, kind: TrackKind, preferred?: string): { project: Project; trackId: string } {
  const pref = preferred ? getTrack(p, preferred) : undefined;
  if (pref && pref.kind === kind && !pref.locked) return { project: p, trackId: pref.id };
  const t = tracksOfKind(p, kind).find((x) => !x.locked);
  if (t) return { project: p, trackId: t.id };
  const r = addTrack(p, kind);
  return { project: r.project, trackId: r.track.id };
}

/* ------------------------------ Clip creation ------------------------------ */

export function makeClip(kind: ClipKind, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  const visual = kind === 'video' || kind === 'image' || kind === 'title' || kind === 'adjustment' ? { ...DEFAULT_VISUAL } : undefined;
  return {
    id: uid('c_'),
    kind,
    trackId,
    name: kind,
    start: Math.max(0, start),
    duration: Math.max(0.01, duration),
    in: 0,
    speed: 1,
    keepPitch: true,
    volume: 0,
    fadeIn: 0,
    fadeOut: 0,
    visual,
    ...extra,
  };
}

/**
 * Places a media item on the timeline (overwriting what is there). Videos with sound get a
 * linked audio clip on the matching audio track.
 */
export function addMediaToTimeline(
  p: Project,
  media: MediaRef,
  opts: { start: number; trackId?: string; duration?: number },
): { project: Project; ids: string[] } {
  const start = Math.max(0, opts.start);
  const length = opts.duration ?? (media.kind === 'image' ? DEFAULT_STILL_DURATION : Math.max(frameDur(p.settings.fps), media.duration));
  let project = p;
  const clips: Clip[] = [];
  if (media.kind === 'audio') {
    const r = ensureTrack(project, 'audio', opts.trackId);
    project = r.project;
    clips.push(makeClip('audio', r.trackId, start, length, { mediaId: media.id, name: media.name }));
  } else {
    const r = ensureTrack(project, 'video', opts.trackId);
    project = r.project;
    const linkId = media.kind === 'video' && media.hasAudio ? uid('l_') : undefined;
    clips.push(makeClip(media.kind, r.trackId, start, length, { mediaId: media.id, name: media.name, linkId }));
    if (linkId) {
      const vIndex = tracksOfKind(project, 'video').findIndex((t) => t.id === r.trackId);
      const audioTracks = tracksOfKind(project, 'audio');
      const a = ensureTrack(project, 'audio', audioTracks[vIndex]?.id);
      project = a.project;
      clips.push(makeClip('audio', a.trackId, start, length, { mediaId: media.id, name: media.name, linkId }));
    }
  }
  return { project: insertClips(project, clips), ids: clips.map((c) => c.id) };
}

function freeTrack(p: Project, kind: TrackKind, candidates: Track[], start: number, end: number): { project: Project; trackId: string } {
  for (const t of candidates) {
    if (t.locked) continue;
    const busy = p.clips.some((c) => c.trackId === t.id && c.start < end - EPS && clipEnd(c) > start + EPS);
    if (!busy) return { project: p, trackId: t.id };
  }
  const r = addTrack(p, kind);
  return { project: r.project, trackId: r.track.id };
}

/** Lowest free, unlocked video track above V1 for [start, end) — adds a track when all are busy. */
export function findFreeVideoTrack(p: Project, start: number, end: number): { project: Project; trackId: string } {
  const video = tracksOfKind(p, 'video');
  return freeTrack(p, 'video', video.length > 1 ? video.slice(1) : video, start, end);
}

/** A free, unlocked video track above every clip in [start, end) — adjustment layers change what is below them. */
export function findTopVideoTrack(p: Project, start: number, end: number): { project: Project; trackId: string } {
  const video = tracksOfKind(p, 'video');
  let highest = -1;
  video.forEach((t, i) => {
    if (p.clips.some((c) => c.trackId === t.id && c.start < end - EPS && clipEnd(c) > start + EPS)) highest = i;
  });
  return freeTrack(p, 'video', video.slice(highest + 1), start, end);
}

/** Lowest free, unlocked audio track for [start, end), e.g. for a voice-over — adds a track when all are busy. */
export function findFreeAudioTrack(p: Project, start: number, end: number): { project: Project; trackId: string } {
  return freeTrack(p, 'audio', tracksOfKind(p, 'audio'), start, end);
}

/* ------------------------------- Link helpers ------------------------------ */

function breakLinks(clips: Clip[], linkIds: Set<string>): Clip[] {
  if (!linkIds.size) return clips;
  return clips.map((c) => (c.linkId && linkIds.has(c.linkId) ? { ...c, linkId: undefined } : c));
}

/** Removes link ids that are left on a single clip. */
export function normalizeLinks(clips: Clip[]): Clip[] {
  const counts = new Map<string, number>();
  for (const c of clips) if (c.linkId) counts.set(c.linkId, (counts.get(c.linkId) ?? 0) + 1);
  let lonely = false;
  for (const n of counts.values()) if (n < 2) lonely = true;
  if (!lonely) return clips;
  return clips.map((c) => (c.linkId && (counts.get(c.linkId) ?? 0) < 2 ? { ...c, linkId: undefined } : c));
}

export function linkClips(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  const targets = p.clips.filter((c) => set.has(c.id));
  if (targets.length < 2) return p;
  const linkId = uid('l_');
  return { ...p, clips: normalizeLinks(p.clips.map((c) => (set.has(c.id) ? { ...c, linkId } : c))) };
}

export function unlinkClips(p: Project, ids: string[]): Project {
  const all = expandLinked(p, ids);
  if (!p.clips.some((c) => all.has(c.id) && c.linkId)) return p;
  return { ...p, clips: p.clips.map((c) => (all.has(c.id) && c.linkId ? { ...c, linkId: undefined } : c)) };
}

/* ------------------------------ Range editing ------------------------------ */

function fixLimits(c: Clip): Clip {
  let { fadeIn, fadeOut } = c;
  fadeIn = clampNum(fadeIn, 0, c.duration);
  fadeOut = clampNum(fadeOut, 0, c.duration - fadeIn);
  const transition = c.transition ? { ...c.transition, duration: Math.min(c.transition.duration, c.duration) } : undefined;
  if (fadeIn === c.fadeIn && fadeOut === c.fadeOut && (!c.transition || transition?.duration === c.transition.duration)) return c;
  return { ...c, fadeIn, fadeOut, transition };
}

function trimStartTo(c: Clip, t: number): Clip {
  const d = t - c.start;
  const duration = c.duration - d;
  let inPoint = c.in;
  // a reversed clip loses (or gains) the end of its source range here, a frozen one keeps its frame
  if (usesSource(c) && !c.reverse && !c.freeze) inPoint = d >= 0 ? c.in + sourceOffset(c, d) : Math.max(0, c.in + d * speedAt(c, 0));
  return fixLimits({ ...c, start: t, duration, in: inPoint, ...shiftClipKeys(c, -d, duration) });
}

function trimEndTo(c: Clip, t: number): Clip {
  const duration = t - c.start;
  let inPoint = c.in;
  if (usesSource(c) && c.reverse && !c.freeze) {
    const lost = duration <= c.duration ? sourceSpan(c) - sourceOffset(c, duration) : -(duration - c.duration) * speedAt(c, c.duration);
    inPoint = Math.max(0, c.in + lost);
  }
  return fixLimits({ ...c, duration, in: inPoint, ...shiftClipKeys(c, 0, duration) });
}

/**
 * Removes [start, end) on one track ("overwrite"): covered clips are deleted, partially
 * covered ones are trimmed or split. Link groups that were cut are unlinked.
 */
export function clearRange(clips: Clip[], trackId: string, start: number, end: number, except: Set<string> = new Set()): Clip[] {
  if (end - start <= EPS) return clips;
  const out: Clip[] = [];
  const touched = new Set<string>();
  for (const c of clips) {
    const cs = c.start;
    const ce = clipEnd(c);
    if (c.trackId !== trackId || except.has(c.id) || ce <= start + EPS || cs >= end - EPS) {
      out.push(c);
      continue;
    }
    if (c.linkId) touched.add(c.linkId);
    if (cs >= start - EPS && ce <= end + EPS) continue; // fully covered
    if (cs < start && ce > end) {
      out.push(trimEndTo(c, start), { ...trimStartTo(c, end), id: uid('c_'), transition: undefined, linkId: undefined });
    } else if (cs < start) out.push(trimEndTo(c, start));
    else out.push(trimStartTo(c, end));
  }
  return breakLinks(out, touched);
}

/** Adds clips, overwriting whatever they cover on their tracks. */
export function insertClips(p: Project, newClips: Clip[]): Project {
  const except = new Set(newClips.map((c) => c.id));
  let clips = p.clips;
  for (const c of newClips) clips = clearRange(clips, c.trackId, c.start, clipEnd(c), except);
  return { ...p, clips: [...clips, ...newClips] };
}

/**
 * Moves clips (and their linked partners) by `dt` seconds. `trackShift` moves the clips of
 * `shiftKind` that are in `ids` up/down by that many tracks of the same kind.
 */
export function moveClips(p: Project, ids: string[], dt: number, trackShift = 0, shiftKind?: TrackKind): Project {
  const moving = expandLinked(p, ids);
  const movingClips = p.clips.filter((c) => moving.has(c.id) && !isLockedTrack(p, c.trackId));
  if (!movingClips.length) return p;
  const delta = Math.max(dt, -Math.min(...movingClips.map((c) => c.start)));
  const primary = new Set(ids);
  const kindTracks = shiftKind ? tracksOfKind(p, shiftKind) : [];
  const shifts = (c: Clip) => Boolean(shiftKind) && primary.has(c.id) && getTrack(p, c.trackId)?.kind === shiftKind;
  let shift = trackShift;
  if (shift) {
    const idx = movingClips.filter(shifts).map((c) => kindTracks.findIndex((t) => t.id === c.trackId));
    if (idx.length) {
      shift = clampNum(shift, -Math.min(...idx), kindTracks.length - 1 - Math.max(...idx));
      if (idx.some((i) => kindTracks[i + shift]?.locked)) shift = 0;
    } else shift = 0;
  }
  if (Math.abs(delta) < EPS && !shift) return p;
  const moved = new Map<string, Clip>();
  for (const c of movingClips) {
    let trackId = c.trackId;
    if (shift && shifts(c)) {
      const i = kindTracks.findIndex((t) => t.id === c.trackId);
      if (i >= 0) trackId = kindTracks[i + shift].id;
    }
    moved.set(c.id, { ...c, start: c.start + delta, trackId });
  }
  let clips = p.clips.map((c) => moved.get(c.id) ?? c);
  const except = new Set(moved.keys());
  for (const m of moved.values()) clips = clearRange(clips, m.trackId, m.start, clipEnd(m), except);
  return { ...p, clips };
}

/**
 * Drags the start or end edge of a clip (and its linked partners) to `time`, respecting
 * the source media length and neighbouring clips on the same track.
 */
export function trimClip(p: Project, id: string, edge: 'start' | 'end', time: number): Project {
  const clip = getClip(p, id);
  if (!clip || isLockedTrack(p, clip.trackId)) return p;
  const minDur = frameDur(p.settings.fps);
  const linked = expandLinked(p, [id]);
  const group = p.clips.filter((c) => linked.has(c.id) && !isLockedTrack(p, c.trackId));
  const groupIds = new Set(group.map((c) => c.id));
  let delta = time - (edge === 'start' ? clip.start : clipEnd(clip));
  for (const c of group) {
    const media = getMedia(p, c.mediaId);
    const limited = usesSource(c) && !c.freeze && media && media.duration > 0;
    const others = p.clips.filter((o) => o.trackId === c.trackId && !groupIds.has(o.id));
    // source left before the in-point and after the out-point (swapped for reversed clips)
    const before = c.reverse ? (media?.duration ?? 0) - sourceOut(c) : c.in;
    const after = c.reverse ? c.in : (media?.duration ?? 0) - sourceOut(c);
    let lo: number;
    let hi: number;
    if (edge === 'start') {
      const prevEnd = Math.max(0, ...others.filter((o) => clipEnd(o) <= c.start + EPS).map(clipEnd));
      lo = prevEnd - c.start;
      if (limited) lo = Math.max(lo, -before / Math.max(1e-6, speedAt(c, 0)));
      hi = c.duration - minDur;
    } else {
      const nextStart = Math.min(Infinity, ...others.filter((o) => o.start >= clipEnd(c) - EPS).map((o) => o.start));
      hi = nextStart - clipEnd(c);
      if (limited && media) hi = Math.min(hi, after / Math.max(1e-6, speedAt(c, c.duration)));
      lo = minDur - c.duration;
    }
    delta = hi < lo ? 0 : clampNum(delta, lo, hi);
  }
  if (Math.abs(delta) < EPS) return p;
  return {
    ...p,
    clips: p.clips.map((c) => {
      if (!groupIds.has(c.id)) return c;
      return edge === 'start' ? trimStartTo(c, c.start + delta) : trimEndTo(c, clipEnd(c) + delta);
    }),
  };
}

/**
 * Splits clips at time t. With `ids`, only those clips (and linked partners) are cut;
 * otherwise every clip under t on unlocked tracks. `edgeTolerance` avoids slivers.
 */
export function splitAt(p: Project, t: number, ids?: string[], edgeTolerance?: number): { project: Project; created: string[] } {
  const tol = edgeTolerance ?? frameDur(p.settings.fps) / 2;
  const scope = ids ? expandLinked(p, ids) : null;
  const targets = p.clips.filter(
    (c) => (!scope || scope.has(c.id)) && !isLockedTrack(p, c.trackId) && c.start + tol < t && t < clipEnd(c) - tol,
  );
  if (!targets.length) return { project: p, created: [] };
  const linkMap = new Map<string, string>();
  const rights = new Map<string, Clip>();
  for (const c of targets) {
    let linkId: string | undefined;
    if (c.linkId) {
      linkId = linkMap.get(c.linkId) ?? uid('l_');
      linkMap.set(c.linkId, linkId);
    }
    rights.set(c.id, fixLimits({ ...trimStartTo(c, t), id: uid('c_'), fadeIn: 0, transition: undefined, linkId }));
  }
  const clips: Clip[] = [];
  for (const c of p.clips) {
    const right = rights.get(c.id);
    if (!right) {
      clips.push(c);
      continue;
    }
    clips.push(fixLimits({ ...trimEndTo(c, t), fadeOut: 0 }), right);
  }
  return { project: { ...p, clips: normalizeLinks(clips) }, created: [...rights.values()].map((c) => c.id) };
}

/** Deletes clips (with linked partners unless `linked: false`). `ripple` closes the gaps. */
export function deleteClips(p: Project, ids: string[], opts: { ripple?: boolean; linked?: boolean } = {}): Project {
  const scope = opts.linked === false ? new Set(ids) : expandLinked(p, ids);
  const del = new Set([...scope].filter((id) => {
    const c = getClip(p, id);
    return c && !isLockedTrack(p, c.trackId);
  }));
  if (!del.size) return p;
  let clips = p.clips.filter((c) => !del.has(c.id));
  if (opts.ripple) {
    const removed = new Map<string, TimeRange[]>();
    for (const c of p.clips) {
      if (!del.has(c.id)) continue;
      removed.set(c.trackId, [...(removed.get(c.trackId) ?? []), { start: c.start, end: clipEnd(c) }]);
    }
    const merged = new Map([...removed].map(([k, v]) => [k, mergeRanges(v)]));
    clips = clips.map((c) => {
      const ranges = merged.get(c.trackId);
      if (!ranges) return c;
      let shift = 0;
      for (const r of ranges) if (r.end <= c.start + EPS) shift += r.end - r.start;
      return shift > EPS ? { ...c, start: Math.max(0, c.start - shift) } : c;
    });
  }
  return { ...p, clips: normalizeLinks(clips) };
}

/**
 * Cuts the given time ranges out of every unlocked track and closes the gaps (used by
 * "Remove silences" and transcript based rough cuts). Markers and the work area follow.
 */
export function rippleDeleteRanges(p: Project, ranges: TimeRange[]): Project {
  const merged = mergeRanges(ranges);
  if (!merged.length) return p;
  const minLen = frameDur(p.settings.fps) / 2;
  let proj = p;
  for (let i = merged.length - 1; i >= 0; i--) {
    const { start: a, end: b } = merged[i];
    const len = b - a;
    proj = splitAt(proj, a, undefined, EPS).project;
    proj = splitAt(proj, b, undefined, EPS).project;
    const unlocked = new Set(proj.tracks.filter((t) => !t.locked).map((t) => t.id));
    let clips = proj.clips.filter((c) => !(unlocked.has(c.trackId) && c.start >= a - EPS && clipEnd(c) <= b + EPS));
    clips = clips
      .map((c) => (unlocked.has(c.trackId) && c.start >= b - EPS ? { ...c, start: Math.max(0, c.start - len) } : c))
      .filter((c) => c.duration >= minLen || !unlocked.has(c.trackId));
    const shiftTime = (x: number) => (x <= a ? x : x >= b ? x - len : a);
    const markers = proj.markers.filter((m) => m.time <= a + EPS || m.time >= b - EPS).map((m) => ({ ...m, time: shiftTime(m.time) }));
    let workArea = proj.workArea;
    if (workArea) {
      const s = shiftTime(workArea.start);
      const e = shiftTime(workArea.end);
      workArea = e - s > EPS ? { start: s, end: e } : null;
    }
    proj = { ...proj, clips: normalizeLinks(clips), markers, workArea };
  }
  return proj;
}

/** Copies clips right after the selection (overwriting what's there). */
export function duplicateClips(p: Project, ids: string[]): { project: Project; ids: string[] } {
  const linked = expandLinked(p, ids);
  const group = p.clips.filter((c) => linked.has(c.id) && !isLockedTrack(p, c.trackId));
  if (!group.length) return { project: p, ids: [] };
  const offset = Math.max(...group.map(clipEnd)) - Math.min(...group.map((c) => c.start));
  const linkMap = new Map<string, string>();
  const copies = group.map((c) => {
    let linkId: string | undefined;
    if (c.linkId) {
      linkId = linkMap.get(c.linkId) ?? uid('l_');
      linkMap.set(c.linkId, linkId);
    }
    return { ...structuredCloneClip(c), id: uid('c_'), start: c.start + offset, linkId };
  });
  return { project: insertClips(p, copies), ids: copies.map((c) => c.id) };
}

function structuredCloneClip(c: Clip): Clip {
  return {
    ...c,
    visual: c.visual ? { ...c.visual } : undefined,
    title: c.title ? { ...c.title } : undefined,
    transition: c.transition ? { ...c.transition } : undefined,
    keys: c.keys ? Object.fromEntries(Object.entries(c.keys).map(([k, list]) => [k, list?.map((x) => ({ ...x }))])) : undefined,
    speedKeys: c.speedKeys?.map((x) => ({ ...x })),
  };
}

export interface ClipboardData {
  clips: Clip[];
  media: MediaRef[];
}

export function copyClips(p: Project, ids: string[]): ClipboardData | null {
  const all = expandLinked(p, ids);
  const clips = p.clips.filter((c) => all.has(c.id)).map(structuredCloneClip);
  if (!clips.length) return null;
  const mediaIds = new Set(clips.map((c) => c.mediaId).filter(Boolean));
  return { clips, media: p.media.filter((m) => mediaIds.has(m.id)) };
}

/** Pastes clipboard clips so the earliest one starts at `at`, keeping tracks where possible. */
export function pasteClips(p: Project, data: ClipboardData, at: number): { project: Project; ids: string[] } {
  if (!data.clips.length) return { project: p, ids: [] };
  let project: Project = { ...p, media: [...p.media, ...data.media.filter((m) => !p.media.some((x) => x.id === m.id))] };
  const offset = Math.max(0, at) - Math.min(...data.clips.map((c) => c.start));
  const linkMap = new Map<string, string>();
  const copies: Clip[] = [];
  for (const c of data.clips) {
    const kind = trackKindForClip(c.kind);
    const r = ensureTrack(project, kind, c.trackId);
    project = r.project;
    let linkId: string | undefined;
    if (c.linkId) {
      linkId = linkMap.get(c.linkId) ?? uid('l_');
      linkMap.set(c.linkId, linkId);
    }
    copies.push({ ...structuredCloneClip(c), id: uid('c_'), trackId: r.trackId, start: c.start + offset, linkId });
  }
  return { project: insertClips(project, copies), ids: copies.map((c) => c.id) };
}

/* -------------------------------- Properties ------------------------------- */

export function updateClip(p: Project, id: string, fn: (c: Clip) => Clip): Project {
  let changed = false;
  const clips = p.clips.map((c) => {
    if (c.id !== id) return c;
    const next = fn(c);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...p, clips } : p;
}

/** Changes the speed of a media clip (and its partners), keeping its start and in-point. */
export function setClipSpeed(p: Project, id: string, speed: number): Project {
  const clip = getClip(p, id);
  if (!clip || !usesSource(clip)) return p;
  const s = clampNum(speed, MIN_SPEED, MAX_SPEED);
  const linked = expandLinked(p, [id]);
  const group = p.clips.filter((c) => linked.has(c.id) && usesSource(c) && !isLockedTrack(p, c.trackId));
  const ids = new Set(group.map((c) => c.id));
  let duration = sourceSpan(clip) / s;
  for (const c of group) {
    const next = p.clips.filter((o) => o.trackId === c.trackId && !ids.has(o.id) && o.start >= clipEnd(c) - EPS);
    const room = Math.min(Infinity, ...next.map((o) => o.start)) - c.start;
    duration = Math.min(duration, room);
    const media = getMedia(p, c.mediaId);
    if (media && media.duration > 0) duration = Math.min(duration, (media.duration - c.in) / s);
  }
  duration = Math.max(frameDur(p.settings.fps), duration);
  // a constant speed replaces a ramp; keyframes stretch with the clip
  return {
    ...p,
    clips: p.clips.map((c) => {
      if (!ids.has(c.id)) return c;
      const f = duration / Math.max(1e-6, c.duration);
      const keys = c.keys ? (Object.fromEntries(Object.entries(c.keys).map(([k, l]) => [k, scaleKeys(l, f)])) as Clip['keys']) : undefined;
      return fixLimits({ ...c, speed: s, duration, speedKeys: undefined, freeze: undefined, keys });
    }),
  };
}

/** Longest duration (≤ the clip's) whose ramped source still fits in `available` seconds. */
function fitRamp(c: Clip, available: number): number {
  if (sourceOffset(c, c.duration) <= available + 1e-6) return c.duration;
  let lo = 0;
  let hi = c.duration;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sourceOffset(c, mid) <= available) lo = mid;
    else hi = mid;
  }
  return lo;
}

export type RampKeep = 'length' | 'content';

/**
 * Gives a clip and its linked sound a speed ramp (`keys` in clip seconds; undefined removes it).
 * "length" keeps the clip's place and length (shorter when the source runs out); "content" keeps
 * the part of the source it shows, so the clip changes length and the clips after it on its
 * tracks move. Returns null when nothing could be done.
 */
export function setSpeedRamp(p: Project, id: string, keys: Keyframe[] | undefined, keep: RampKeep = 'length'): { project: Project; duration: number; moved: number } | null {
  const clip = getClip(p, id);
  if (!clip || !usesSource(clip) || clip.freeze || isLockedTrack(p, clip.trackId)) return null;
  const linked = expandLinked(p, [id]);
  const group = p.clips.filter((c) => linked.has(c.id) && usesSource(c) && !c.freeze && !isLockedTrack(p, c.trackId));
  const ids = new Set(group.map((c) => c.id));
  const list = keys?.length ? keys.map((k) => ({ ...k, t: clampNum(k.t, 0, clip.duration), v: clampNum(k.v, MIN_SPEED, MAX_SPEED) })).sort((a, b) => a.t - b.t) : undefined;
  if (keep === 'content') {
    const span = sourceSpan(clip);
    const trial = { ...clip, speedKeys: list };
    const f = span / Math.max(1e-6, sourceOffset(trial, clip.duration));
    const duration = Math.max(frameDur(p.settings.fps), clip.duration * f);
    const scaled = list?.map((k) => ({ ...k, t: k.t * f }));
    const tracks = new Set(group.map((c) => c.trackId));
    const end = clipEnd(clip);
    const later = p.clips.filter((o) => tracks.has(o.trackId) && !ids.has(o.id) && o.start >= end - EPS && !isLockedTrack(p, o.trackId)).map((o) => o.id);
    let project = p;
    if (later.length && duration > clip.duration) project = moveClips(project, later, duration - clip.duration);
    project = {
      ...project,
      clips: project.clips.map((c) => {
        if (!ids.has(c.id)) return c;
        const g = duration / Math.max(1e-6, c.duration);
        const keyed = c.keys ? (Object.fromEntries(Object.entries(c.keys).map(([k, l]) => [k, scaleKeys(l, g)])) as Clip['keys']) : undefined;
        return { ...c, speedKeys: scaled?.map((k) => ({ ...k })), duration, keys: keyed };
      }),
    };
    if (later.length && duration < clip.duration) project = moveClips(project, later, duration - clip.duration);
    return { project, duration, moved: later.length };
  }
  // the same length, but never past the end of the source (a reversed clip starts there)
  let duration = clip.duration;
  for (const c of group) {
    const media = getMedia(p, c.mediaId);
    if (!media || media.duration <= 0) continue;
    duration = Math.min(duration, fitRamp({ ...c, speedKeys: list }, media.duration - c.in));
  }
  if (duration < frameDur(p.settings.fps)) return null;
  const clips = p.clips.map((c) => {
    if (!ids.has(c.id)) return c;
    const d = Math.min(c.duration, duration);
    const keys = d < c.duration - EPS ? shiftClipKeys(c, 0, d).keys : c.keys;
    return { ...c, duration: d, keys, speedKeys: list?.map((k) => ({ ...k })) };
  });
  return { project: { ...p, clips }, duration, moved: 0 };
}

/* --------------------------------- Snapping -------------------------------- */

export function snapPoints(p: Project, opts: { playhead?: number; exclude?: Set<string> } = {}): number[] {
  const pts: number[] = [0];
  if (opts.playhead !== undefined) pts.push(opts.playhead);
  for (const c of p.clips) {
    if (opts.exclude?.has(c.id)) continue;
    pts.push(c.start, clipEnd(c));
  }
  for (const m of p.markers) pts.push(m.time);
  if (p.workArea) pts.push(p.workArea.start, p.workArea.end);
  return pts;
}

/* -------------------------------- Freeze frame ------------------------------- */

/**
 * Holds the picture of a video clip at timeline time `t` for `duration` seconds: the clip is cut
 * there, a still clip is inserted and everything after `t` on unlocked tracks moves later.
 */
export function freezeFrameAt(p: Project, clipId: string, t: number, duration: number): { project: Project; id: string | null } {
  const clip = getClip(p, clipId);
  if (!clip || clip.kind !== 'video' || isLockedTrack(p, clip.trackId) || t < clip.start - EPS || t > clipEnd(clip) + EPS || duration <= 0) return { project: p, id: null };
  const local = Math.min(Math.max(0, t - clip.start), clip.duration - 1e-3);
  const source = sourceAt(clip, local);
  let project = splitAt(p, t, [clip.id], EPS).project;
  const later = project.clips.filter((c) => c.start >= t - EPS && !isLockedTrack(project, c.trackId)).map((c) => c.id);
  if (later.length) project = moveClips(project, later, duration);
  const markers = project.markers.map((m) => (m.time >= t - EPS ? { ...m, time: m.time + duration } : m));
  const still = makeClip('video', clip.trackId, t, duration, {
    mediaId: clip.mediaId,
    name: `${clip.name} (freeze)`,
    in: source,
    freeze: true,
    visual: { ...animatedVisual(clip, local) },
  });
  return { project: insertClips({ ...project, markers }, [still]), id: still.id };
}

/* --------------------------------- Markers --------------------------------- */

export function addMarker(p: Project, time: number, label = ''): { project: Project; id: string } {
  const id = uid('mk_');
  const markers = [...p.markers, { id, time: Math.max(0, time), label }].sort((a, b) => a.time - b.time);
  return { project: { ...p, markers }, id };
}

export function updateMarker(p: Project, id: string, patch: { time?: number; label?: string }): Project {
  return {
    ...p,
    markers: p.markers
      .map((m) => (m.id === id ? { ...m, ...patch, time: Math.max(0, patch.time ?? m.time) } : m))
      .sort((a, b) => a.time - b.time),
  };
}

export function removeMarker(p: Project, id: string): Project {
  return { ...p, markers: p.markers.filter((m) => m.id !== id) };
}

/* --------------------------------- Settings -------------------------------- */

/** Applies new project settings, rescaling pixel based clip properties to the new frame. */
export function changeSettings(p: Project, next: ProjectSettings): Project {
  const old = p.settings;
  const sx = next.width / old.width;
  const sy = next.height / old.height;
  if (sx === 1 && sy === 1) return { ...p, settings: next };
  const clips = p.clips.map((c) => {
    if (!c.visual && !c.title) return c;
    const out = { ...c };
    // pixel sizes follow the frame (effects measured in px included)
    const v = c.visual;
    if (v) out.visual = { ...v, x: v.x * sx, y: v.y * sy, blur: v.blur * sy, shake: v.shake * sy, rgbSplit: v.rgbSplit * sy, motionBlur: v.motionBlur * sy, glowRadius: v.glowRadius * sy };
    if (c.keys) {
      const scale = (list: Keyframe[] | undefined, f: number) => list?.map((k) => ({ ...k, v: k.v * f }));
      out.keys = { ...c.keys, x: scale(c.keys.x, sx), y: scale(c.keys.y, sy), blur: scale(c.keys.blur, sy), shake: scale(c.keys.shake, sy), rgbSplit: scale(c.keys.rgbSplit, sy), motionBlur: scale(c.keys.motionBlur, sy) };
      for (const k of ['x', 'y', 'blur', 'shake', 'rgbSplit', 'motionBlur'] as const) if (!out.keys[k]) delete out.keys[k];
    }
    if (c.title) out.title = { ...c.title, size: Math.max(4, Math.round(c.title.size * sy)), outlineWidth: c.title.outlineWidth * sy };
    return out;
  });
  const cs = p.captionStyle;
  return {
    ...p,
    settings: next,
    clips,
    captionStyle: { ...cs, size: Math.max(6, Math.round(cs.size * sy)), outlineWidth: cs.outlineWidth * sy },
  };
}

/* --------------------------------- Captions -------------------------------- */

export function ensureCaptionTrack(p: Project, preferred?: string): { project: Project; trackId: string } {
  return ensureTrack(p, 'caption', preferred);
}

/** Caption clips (visible caption tracks only unless `all`), sorted by time. */
export function captionClips(p: Project, all = false): Clip[] {
  const tracks = new Set(tracksOfKind(p, 'caption').filter((t) => all || !t.hidden).map((t) => t.id));
  return p.clips.filter((c) => c.kind === 'caption' && tracks.has(c.trackId)).sort((a, b) => a.start - b.start);
}

export function captionCues(p: Project, all = false): CaptionCue[] {
  return captionClips(p, all).map((c) => ({ start: c.start, end: clipEnd(c), text: c.text ?? '' }));
}

export function addCaptionCues(p: Project, cues: CaptionCue[], opts: { trackId?: string; replace?: boolean } = {}): { project: Project; trackId: string; ids: string[] } {
  const r = ensureCaptionTrack(p, opts.trackId);
  let project = r.project;
  if (opts.replace) project = { ...project, clips: project.clips.filter((c) => c.trackId !== r.trackId) };
  const clips = cues
    .filter((c) => c.text.trim() && Number.isFinite(c.start) && Number.isFinite(c.end))
    .map((c) =>
      makeClip('caption', r.trackId, Math.max(0, c.start), Math.max(0.2, c.end - c.start), { name: c.text.slice(0, 40), text: c.text.trim() }),
    );
  return { project: insertClips(project, clips), trackId: r.trackId, ids: clips.map((c) => c.id) };
}

/* ---------------------------------- Media ---------------------------------- */

export function addMediaRefs(p: Project, refs: MediaRef[]): Project {
  const fresh = refs.filter((r) => !p.media.some((m) => m.id === r.id));
  return fresh.length ? { ...p, media: [...p.media, ...fresh] } : p;
}

export function removeMedia(p: Project, mediaId: string): Project {
  return {
    ...p,
    media: p.media.filter((m) => m.id !== mediaId),
    clips: normalizeLinks(p.clips.filter((c) => c.mediaId !== mediaId)),
  };
}
