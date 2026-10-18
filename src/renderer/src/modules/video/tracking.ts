import type { Clip, Keyframe, MotionTrack, Project } from './types';
import { uid } from '../../core/utils/id';
import { animatedVisual, sourceAt, timeOfSource } from './keyframes';
import { clipEnd, getClip, getMedia, updateClip } from './model';
import { frameDur } from './time';

/*
 * Motion tracking in the project (pure, unit tested): tracks live on video clips in source time and as fractions of
 * the source picture, so trimming, moving or zooming the clip keeps them right. Following a track writes position
 * keyframes on other clips (a title, a crosshair, a circle…), which stay editable like any keyframes.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** How the clip's (uncropped) picture sits in the frame `local` seconds into the clip. */
function placement(p: Project, c: Clip, local: number) {
  const media = getMedia(p, c.mediaId);
  if (!media || !c.visual) return null;
  const { width: W, height: H } = p.settings;
  const v = animatedVisual(c, clamp(local, 0, c.duration));
  const mw = media.width || W;
  const mh = media.height || H;
  const fit = Math.min(W / mw, H / mh);
  const rad = (v.rotation * Math.PI) / 180;
  return { w: mw * fit * v.scale, h: mh * fit * v.scale, cx: W / 2 + v.x, cy: H / 2 + v.y, cos: Math.cos(rad), sin: Math.sin(rad) };
}

/** Where a point of the source picture (fractions of it) is drawn in the frame (project px). */
export function sourceToFrame(p: Project, c: Clip, local: number, u: number, v: number): { x: number; y: number } | null {
  const L = placement(p, c, local);
  if (!L) return null;
  const px = (u - 0.5) * L.w;
  const py = (v - 0.5) * L.h;
  return { x: L.cx + px * L.cos - py * L.sin, y: L.cy + px * L.sin + py * L.cos };
}

/** The point of the source picture (fractions of it) under a frame point (project px). */
export function frameToSource(p: Project, c: Clip, local: number, x: number, y: number): { u: number; v: number } | null {
  const L = placement(p, c, local);
  if (!L || L.w <= 0 || L.h <= 0) return null;
  const dx = x - L.cx;
  const dy = y - L.cy;
  return { u: (dx * L.cos + dy * L.sin) / L.w + 0.5, v: (-dx * L.sin + dy * L.cos) / L.h + 0.5 };
}

/** The track at source time `t` (between two points: in between), or null outside it. */
export function trackAtSource(track: MotionTrack, t: number): { x: number; y: number; s: number } | null {
  const pts = track.points;
  if (!pts.length || t < pts[0].t - 1e-4 || t > pts[pts.length - 1].t + 1e-4) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const k = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: Math.min(a.s, b.s) };
}

/** Where the tracked point is in the frame at timeline time `t`, and how sure; null when the clip does not show it then. */
export function trackPointAt(p: Project, c: Clip, track: MotionTrack, t: number): { x: number; y: number; sure: number } | null {
  if (t < c.start - 1e-6 || t > clipEnd(c) + 1e-6) return null;
  const local = t - c.start;
  const q = trackAtSource(track, sourceAt(c, local));
  if (!q) return null;
  const f = sourceToFrame(p, c, local, q.x, q.y);
  return f ? { ...f, sure: q.s } : null;
}

/** The part of the timeline where the clip shows the track. */
export function trackSpan(c: Clip, track: MotionTrack): { start: number; end: number } | null {
  const times = track.points.map((q) => timeOfSource(c, q.t)).filter((t): t is number => t !== null);
  if (!times.length) return null;
  return { start: Math.min(...times), end: Math.max(...times) };
}

/** Share of the track where the target was found (0-1). */
export const trackSureness = (track: MotionTrack) => (track.points.length ? track.points.filter((q) => q.s >= 0.4).length / track.points.length : 0);

/** Adds a track to a video clip. */
export function addMotionTrack(p: Project, clipId: string, t: Pick<MotionTrack, 'points' | 'w' | 'h'> & { name?: string }): { project: Project; track: MotionTrack } {
  const c = getClip(p, clipId);
  const n = (c?.tracks?.length ?? 0) + 1;
  const track: MotionTrack = { id: uid('tk_'), name: t.name?.trim() || `Track ${n}`, points: t.points, w: t.w, h: t.h };
  return { project: updateClip(p, clipId, (x) => ({ ...x, tracks: [...(x.tracks ?? []), track] })), track };
}

export function removeMotionTrack(p: Project, clipId: string, trackId: string): Project {
  return updateClip(p, clipId, (x) => {
    const tracks = (x.tracks ?? []).filter((t) => t.id !== trackId);
    return { ...x, tracks: tracks.length ? tracks : undefined };
  });
}

/** The track `trackId` of a clip, or the clip's last track. */
export function findMotionTrack(c: Clip | undefined, trackId?: string): MotionTrack | undefined {
  if (!c?.tracks?.length) return undefined;
  return trackId ? c.tracks.find((t) => t.id === trackId || t.name.toLowerCase() === trackId.toLowerCase()) : c.tracks[c.tracks.length - 1];
}

/** The point of a clip that sits on the target: a picture's centre, a title's anchor. */
function anchorAt(p: Project, f: Clip, t: number): { x: number; y: number } {
  const { width: W, height: H } = p.settings;
  const v = animatedVisual(f, clamp(t - f.start, 0, f.duration));
  if (f.kind === 'title' && f.title) {
    const rad = (v.rotation * Math.PI) / 180;
    const ax = (f.title.x - 0.5) * W * v.scale;
    const ay = (f.title.y - 0.5) * H * v.scale;
    return { x: W / 2 + v.x + ax * Math.cos(rad) - ay * Math.sin(rad), y: H / 2 + v.y + ax * Math.sin(rad) + ay * Math.cos(rad) };
  }
  return { x: W / 2 + v.x, y: H / 2 + v.y };
}

/** Fewer keyframes for the same path: drops keys the path between their neighbours passes within `tol`. */
export function simplifyKeys(keys: { t: number; v: number }[], tol: number): { t: number; v: number }[] {
  if (keys.length <= 2) return keys;
  const keep = new Uint8Array(keys.length);
  keep[0] = 1;
  keep[keys.length - 1] = 1;
  const stack: [number, number][] = [[0, keys.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const k = (keys[i].t - keys[a].t) / (keys[b].t - keys[a].t || 1);
      const d = Math.abs(keys[i].v - (keys[a].v + (keys[b].v - keys[a].v) * k));
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return keys.filter((_, i) => keep[i]);
}

export interface FollowOptions {
  /** "center": the follower sits right on the target; "offset": it keeps where it is now relative to the target. */
  mode: 'center' | 'offset';
  /** Timeline time where the follower is where it should be (default: the first moment both are there). */
  at?: number;
  /** "center": this far (project px) from the target, e.g. a label above a head. */
  shift?: { x: number; y: number };
}

/** Size (project px) of the tracked patch where the clip shows it at timeline time `t`. */
export function trackBoxSize(p: Project, c: Clip, track: MotionTrack, t: number): { w: number; h: number } {
  const L = placement(p, c, t - c.start);
  return L ? { w: track.w * L.w, h: track.h * L.h } : { w: 0, h: 0 };
}

export interface FollowResult {
  project: Project;
  followers: string[];
  /** Position keyframes written (x and y together). */
  keys: number;
  span: { start: number; end: number } | null;
  problem?: string;
}

/** Makes clips follow a track with x/y position keyframes (they replace the followers' position animation). */
export function followTrack(p: Project, clipId: string, trackId: string | undefined, followerIds: string[], o: FollowOptions): FollowResult {
  const c = getClip(p, clipId);
  const track = findMotionTrack(c, trackId);
  const none = (problem: string): FollowResult => ({ project: p, followers: [], keys: 0, span: null, problem });
  if (!c || c.kind !== 'video') return none(`${clipId} is not a video clip`);
  if (!track) return none(trackId ? `clip ${clipId} has no track ${trackId}` : `clip ${clipId} has no motion track yet`);
  const span = trackSpan(c, track);
  if (!span) return none(`the clip no longer shows the part of the video that was tracked`);
  const step = frameDur(p.settings.fps);
  let project = p;
  let keys = 0;
  const followers: string[] = [];
  const skipped: string[] = [];
  for (const id of followerIds) {
    const f = getClip(project, id);
    if (!f || !f.visual || f.id === c.id || (f.kind !== 'title' && f.kind !== 'image' && f.kind !== 'video')) {
      skipped.push(`${id} (${f ? 'not a title or picture' : 'unknown'})`);
      continue;
    }
    const from = Math.max(span.start, f.start);
    const to = Math.min(span.end, clipEnd(f));
    if (to - from < step / 2) {
      skipped.push(`${id} (not on screen while the track is)`);
      continue;
    }
    // the target at every frame where the tracker was sure
    const path: { t: number; x: number; y: number }[] = [];
    for (let t = from; t <= to + 1e-6; t += step) {
      const q = trackPointAt(project, c, track, Math.min(t, to));
      if (q && q.sure >= 0.4) path.push({ t: Math.min(t, to), x: q.x, y: q.y });
    }
    if (path.length < 2) {
      skipped.push(`${id} (the tracker lost the target there)`);
      continue;
    }
    const t0 = o.at === undefined ? path[0].t : clamp(o.at, path[0].t, path[path.length - 1].t);
    const p0 = path.reduce((best, q) => (Math.abs(q.t - t0) < Math.abs(best.t - t0) ? q : best), path[0]);
    const anchor = anchorAt(project, f, p0.t);
    const ref = o.mode === 'center' ? { x: anchor.x - (o.shift?.x ?? 0), y: anchor.y - (o.shift?.y ?? 0) } : p0;
    const v0 = animatedVisual(f, clamp(p0.t - f.start, 0, f.duration));
    // within ¾ px of the tracked path: invisible, and far fewer keyframes to edit
    const xs = simplifyKeys(path.map((q) => ({ t: q.t - f.start, v: v0.x + q.x - ref.x })), 0.75);
    const ys = simplifyKeys(path.map((q) => ({ t: q.t - f.start, v: v0.y + q.y - ref.y })), 0.75);
    const toKeys = (list: { t: number; v: number }[]): Keyframe[] => list.map((k) => ({ t: +k.t.toFixed(4), v: Math.round(k.v * 10) / 10, ease: 'linear' }));
    project = updateClip(project, f.id, (x) => ({ ...x, keys: { ...(x.keys ?? {}), x: toKeys(xs), y: toKeys(ys) } }));
    keys += Math.max(xs.length, ys.length);
    followers.push(f.id);
  }
  return { project, followers, keys, span, problem: followers.length ? (skipped.length ? `skipped ${skipped.join(', ')}` : undefined) : `nothing could follow: ${skipped.join(', ')}` };
}
