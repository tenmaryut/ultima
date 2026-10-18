import type { ClipMatte, Project } from './types';
import { uid } from '../../core/utils/id';
import { clipEnd, findTopVideoTrack, getClip, insertClips, updateClip } from './model';

/*
 * Cut-out subjects in the project (pure, unit tested): a matte on a video clip keeps only its subject (or only the
 * rest); "subject in front" puts a cut-out copy on a track above everything, so titles below it pass behind the
 * player — the montage "text behind the player" look.
 */

export function setMatte(p: Project, clipId: string, matte: ClipMatte | undefined): Project {
  return updateClip(p, clipId, (c) => (c.kind === 'video' ? { ...c, matte } : c));
}

export function setMatteInvert(p: Project, clipId: string, invert: boolean): Project {
  return updateClip(p, clipId, (c) => (c.matte ? { ...c, matte: { ...c.matte, invert: invert || undefined } } : c));
}

/** A silent copy of the clip showing only its subject, above everything else: returns its id. */
export function subjectInFront(p: Project, clipId: string): { project: Project; copyId?: string; problem?: string } {
  const c = getClip(p, clipId);
  if (!c || c.kind !== 'video') return { project: p, problem: `${clipId} is not a video clip` };
  if (!c.matte) return { project: p, problem: `${clipId} has no cut-out yet` };
  const r = findTopVideoTrack(p, c.start, clipEnd(c));
  const copy = { ...c, id: uid('c_'), trackId: r.trackId, linkId: undefined, transition: undefined, transitionOut: undefined, tracks: undefined, matte: { ...c.matte, invert: undefined }, name: `${c.name} (subject)` };
  return { project: insertClips(r.project, [copy]), copyId: copy.id };
}
