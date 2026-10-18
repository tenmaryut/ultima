import { useRef, useState } from 'react';
import type { MotionTrack, Project } from './types';
import type { TFunction } from '../../core/i18n';
import { toast } from '../../components/ui';
import type { MediaLibrary } from './media';
import { clipEnd, getClip, getMedia } from './model';
import { sourceAt, sourceSpan } from './keyframes';
import { applyAIActions } from './aiActions';
import { addMotionTrack, findMotionTrack, followTrack, frameToSource, removeMotionTrack, trackBoxSize, trackSpan } from './tracking';
import { runTracker } from './trackRunner';
import type { TrackEffect } from './ai/executor';

/* Motion tracking in the editor: drawing the box on the preview, the tracking run, and pinning clips to a track. */

/** A box on the preview, in project px. */
export interface TrackBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type FollowWith = 'crosshair' | 'circle' | 'text' | 'selected';

interface Deps {
  t: TFunction;
  /** The project as it is right now (also right after a change, before React renders). */
  current: () => Project;
  lib: MediaLibrary;
  playhead: () => number;
  seek: (t: number) => void;
  /** A new undo step. */
  change: (p: Project, o?: { label?: string }) => void;
  /** Finishes an AI edit: replaces the step it recorded, or records one when it had nothing else to change. */
  amend: (p: Project) => void;
  selection: () => string[];
  setSelection: (ids: string[]) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

export function useTracking(d: Deps) {
  const { t } = d;
  /** The clip whose picture the user is drawing a box on. */
  const [pick, setPick] = useState<string | null>(null);
  const [job, setJob] = useState<{ clipId: string; progress: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Tracks what is inside `box` at timeline time `at`; the new track is not in the project yet. */
  const run = async (p: Project, clipId: string, box: TrackBox, at: number): Promise<{ points: MotionTrack['points']; w: number; h: number; found: number } | { problem: string }> => {
    const c = getClip(p, clipId);
    if (!c || c.kind !== 'video') return { problem: `${clipId} is not a video clip` };
    if (c.freeze) return { problem: 'a freeze frame does not move' };
    const media = getMedia(p, c.mediaId);
    const file = media ? d.lib.file(media.id) : undefined;
    if (!media || !file) return { problem: 'its video file is missing (relink it first)' };
    const local = clamp(at, c.start, clipEnd(c) - 1e-3) - c.start;
    const mid = frameToSource(p, c, local, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    const a = frameToSource(p, c, local, Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
    const b = frameToSource(p, c, local, Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));
    if (!mid || !a || !b) return { problem: 'the clip has no picture there' };
    if (mid.u < 0 || mid.u > 1 || mid.v < 0 || mid.v > 1) return { problem: 'the box is outside the video picture' };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ clipId, progress: 0 });
    try {
      const r = await runTracker({
        file,
        media,
        at: sourceAt(c, local),
        x: mid.u,
        y: mid.v,
        w: Math.min(1, Math.abs(b.u - a.u)),
        h: Math.min(1, Math.abs(b.v - a.v)),
        from: c.in,
        to: Math.min(c.in + sourceSpan(c), media.duration || Infinity),
        onProgress: (progress) => setJob({ clipId, progress }),
        signal: ctrl.signal,
      });
      return { points: r.points, w: Math.min(1, Math.abs(b.u - a.u)), h: Math.min(1, Math.abs(b.v - a.v)), found: r.found };
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const startPick = (clipId: string) => {
    const c = getClip(d.current(), clipId);
    if (!c) return;
    const now = d.playhead();
    if (now < c.start || now >= clipEnd(c)) d.seek(c.start);
    setPick(clipId);
  };

  /** The user drew the box: track it and keep the track on the clip. */
  const onPickBox = async (box: TrackBox) => {
    const clipId = pick;
    setPick(null);
    if (!clipId) return;
    try {
      const r = await run(d.current(), clipId, box, d.playhead());
      if ('problem' in r) return void toast.warning(t('Could not track'), r.problem);
      const n = (getClip(d.current(), clipId)?.tracks?.length ?? 0) + 1;
      d.change(addMotionTrack(d.current(), clipId, { points: r.points, w: r.w, h: r.h, name: t('Track {n}', { n }) }).project, { label: t('Track motion') });
      const pct = Math.round(r.found * 100);
      if (r.found >= 0.8) toast.success(t('Tracked: found in {pct}% of the frames', { pct }), t('Now pin a crosshair, a circle or a text to it.'));
      else toast.warning(t('Tracked: found in {pct}% of the frames', { pct }), t('Where it was lost, followers hold still. A bigger box around something with clear edges tracks better.'));
    } catch (error) {
      if (isAbort(error)) toast.info(t('Tracking cancelled'));
      else toast.error(t('Tracking failed'), error instanceof Error ? error.message : String(error));
    }
  };

  /** New crosshair/circle/text on the track, or the selected clips (keeping where they are relative to the target). */
  const followWith = (p: Project, clipId: string, trackId: string | undefined, what: FollowWith | string[], text?: string, mode?: 'center' | 'offset') => {
    const c = getClip(p, clipId);
    const track = findMotionTrack(c, trackId);
    const span = c && track ? trackSpan(c, track) : null;
    if (!c || !track || !span) return { project: p, followers: [] as string[], keys: 0, problem: track ? 'the clip no longer shows the tracked part' : 'no such track' };
    const H = p.settings.height;
    let ids: string[];
    let shift: { x: number; y: number } | undefined;
    if (Array.isArray(what) || what === 'selected') {
      ids = (Array.isArray(what) ? what : d.selection()).filter((id) => id !== clipId);
      if (!ids.length) return { project: p, followers: [], keys: 0, problem: 'select the clips that should follow first' };
    } else {
      const size = trackBoxSize(p, c, track, span.start);
      const duration = Math.max(0.1, span.end - span.start);
      const action =
        what === 'text'
          ? { type: 'addTitle', text: text || t('Target'), start: span.start, duration, style: { size: Math.round(H * 0.045), outlineWidth: Math.max(2, Math.round(H * 0.003)) } }
          : { type: 'addGraphic', graphic: what, start: span.start, duration, scale: clamp((Math.max(size.w, size.h) * (what === 'circle' ? 1.7 : 1.2)) / H, 0.04, 0.8) };
      const r = applyAIActions(p, [action], { playhead: span.start });
      if (!r.applied) return { project: p, followers: [], keys: 0, problem: r.results[0]?.detail ?? 'could not add it' };
      ids = r.project.clips.filter((x) => !p.clips.some((o) => o.id === x.id)).map((x) => x.id);
      p = r.project;
      // a label sits above the target
      if (what === 'text') shift = { x: 0, y: -(size.h / 2 + H * 0.05) };
    }
    const followMode = mode ?? (Array.isArray(what) || what === 'selected' ? 'offset' : 'center');
    return followTrack(p, clipId, track.id, ids, { mode: followMode, at: followMode === 'offset' ? clamp(d.playhead(), span.start, span.end) : undefined, shift });
  };

  const follow = (clipId: string, trackId: string, what: FollowWith) => {
    const r = followWith(d.current(), clipId, trackId, what);
    if (!r.followers.length) return void toast.warning(t('Nothing could follow'), r.problem);
    d.change(r.project, { label: t('Follow track') });
    d.setSelection(r.followers);
    toast.success(t('{count} clip(s) follow the track', { count: r.followers.length }));
  };

  const remove = (clipId: string, trackId: string) => d.change(removeMotionTrack(d.current(), clipId, trackId), { label: t('Delete motion track') });

  /** Runs the AI's track requests after its edit was applied; returns what happened, for the AI. */
  const runForAI = async (effects: TrackEffect[]): Promise<string[]> => {
    const notes: string[] = [];
    for (const e of effects) {
      const p = d.current();
      const { width: W, height: H } = p.settings;
      const half = (e.size * H) / 2;
      const box = { x0: e.x * W - half, y0: e.y * H - half, x1: e.x * W + half, y1: e.y * H + half };
      try {
        const r = await run(p, e.clipId, box, e.at);
        if ('problem' in r) {
          notes.push(`track ${e.clipId}: could not track — ${r.problem}`);
          continue;
        }
        const added = addMotionTrack(d.current(), e.clipId, { points: r.points, w: r.w, h: r.h, name: e.name });
        let project = added.project;
        const c = getClip(project, e.clipId)!;
        const span = trackSpan(c, added.track);
        let line = `track ${added.track.id} on ${e.clipId}: found the target in ${Math.round(r.found * 100)}% of ${span ? `${span.start.toFixed(2)}–${span.end.toFixed(2)} s` : 'the clip'}`;
        const what = e.sticker ?? (e.follow.length ? e.follow : null);
        if (what) {
          const f = followWith(project, e.clipId, added.track.id, what, e.text, e.mode);
          if (f.followers.length) {
            project = f.project;
            line += `; ${f.followers.join(', ')} follow${f.followers.length === 1 ? 's' : ''} it (${f.keys} position keyframes)`;
          } else line += `; nothing could follow it: ${f.problem}`;
        }
        d.amend(project);
        notes.push(line + (r.found < 0.8 ? ' — check it with a look: where the target was lost the followers hold still' : ''));
      } catch (error) {
        notes.push(`track ${e.clipId}: ${isAbort(error) ? 'cancelled by the user' : `failed — ${error instanceof Error ? error.message : String(error)}`}`);
      }
    }
    return notes;
  };

  return { pick, startPick, cancelPick: () => setPick(null), onPickBox, job, cancel: () => abortRef.current?.abort(), follow, remove, runForAI };
}

export type TrackingApi = ReturnType<typeof useTracking>;
