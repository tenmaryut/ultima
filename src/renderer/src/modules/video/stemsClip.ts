import type { Clip, MediaRef, Project } from './types';
import { addMediaRefs, clipEnd, findFreeAudioTrack, getClip, insertClips, makeClip, updateClip } from './model';
import { MIN_VOLUME_DB } from './presets';
import { STEMS, type StemKind } from './stems';

/*
 * A separated stem in the project (pure, unit tested): the stem's file starts where the clip's part of the source
 * starts, so a clip with the same timing, speed and direction on a free audio track plays it in sync; the original
 * sound is muted (not deleted), so the stem can be removed again.
 */

/** The clip that carries a clip's sound: an audio clip itself, or a video clip's linked audio clip. */
export function soundClipOf(p: Project, c: Clip): Clip | undefined {
  if (c.kind === 'audio') return c;
  if (c.kind === 'video' && c.linkId) return p.clips.find((o) => o.linkId === c.linkId && o.kind === 'audio');
  return undefined;
}

export const stemLabel = (stem: StemKind) => STEMS.find((s) => s.id === stem)?.label ?? stem;
/** The stem's short name, for clip and file names. */
export const stemName = (stem: StemKind) => (stem === 'melody' ? 'no drums' : stem);

/** Adds the stem's media and a clip in sync with `clipId` (whose sound is muted); returns the new clip's id. */
export function placeStem(p: Project, clipId: string, ref: MediaRef, stem: StemKind): { project: Project; stemClipId?: string; problem?: string } {
  const c = getClip(p, clipId);
  if (!c) return { project: p, problem: `unknown clip ${clipId}` };
  const sound = soundClipOf(p, c) ?? c;
  let project = addMediaRefs(p, [ref]);
  const r = findFreeAudioTrack(project, c.start, clipEnd(c));
  project = r.project;
  const clip = makeClip('audio', r.trackId, c.start, c.duration, {
    mediaId: ref.id,
    name: `${sound.name.replace(/\.[a-z0-9]{1,5}$/i, '')} (${stemName(stem)})`,
    in: 0,
    speed: c.speed,
    speedKeys: c.speedKeys,
    reverse: c.reverse,
    keepPitch: c.keepPitch,
    // a sound muted by an earlier separation gives its next stems full volume
    volume: sound.kind === 'audio' && sound.volume > MIN_VOLUME_DB ? sound.volume : 0,
    fadeIn: sound.fadeIn,
    fadeOut: sound.fadeOut,
    keys: sound.keys?.volume ? { volume: sound.keys.volume } : undefined,
  });
  project = insertClips(project, [clip]);
  if (sound.kind === 'audio') project = updateClip(project, sound.id, (x) => ({ ...x, volume: MIN_VOLUME_DB, keys: x.keys?.volume ? { ...x.keys, volume: undefined } : x.keys }));
  return { project, stemClipId: clip.id };
}
