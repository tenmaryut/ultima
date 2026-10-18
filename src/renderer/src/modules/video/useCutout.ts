import { useRef, useState } from 'react';
import type { ClipMatte, Project } from './types';
import type { TFunction } from '../../core/i18n';
import { toast } from '../../components/ui';
import type { MediaLibrary } from './media';
import { getClip, getMedia } from './model';
import { sourceSpan } from './keyframes';
import { setMatte, setMatteInvert, subjectInFront } from './cutout';
import { makeMatte } from './matteRunner';
import type { CutoutEffect } from './ai/executor';

/* Cutting the subject out of video clips in the editor: the rembg run with its progress, and what to do with it. */

interface Deps {
  t: TFunction;
  current: () => Project;
  lib: MediaLibrary;
  change: (p: Project, o?: { label?: string }) => void;
  /** Finishes an AI edit (see useTracking). */
  amend: (p: Project) => void;
  setSelection: (ids: string[]) => void;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

export function useCutout(d: Deps) {
  const { t } = d;
  const [job, setJob] = useState<{ clipId: string; progress: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** The masks of a clip's subject (not in the project yet). */
  const run = async (clipId: string, model: ClipMatte['model']): Promise<ClipMatte> => {
    const p = d.current();
    const c = getClip(p, clipId);
    if (!c || c.kind !== 'video') throw new Error(`${clipId} is not a video clip`);
    if (c.freeze) throw new Error('a freeze frame: cut out the clip it comes from instead');
    const media = getMedia(p, c.mediaId);
    const file = media ? d.lib.file(media.id) : undefined;
    if (!media || !file) throw new Error('its video file is missing (relink it first)');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ clipId, progress: 0 });
    try {
      return await makeMatte({ file, media, from: c.in, to: Math.min(c.in + sourceSpan(c), media.duration || Infinity), model, onProgress: (progress) => setJob({ clipId, progress }), signal: ctrl.signal });
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const cutOut = async (clipId: string, model: ClipMatte['model']) => {
    try {
      const matte = await run(clipId, model);
      d.change(setMatte(d.current(), clipId, matte), { label: t('Cut out the subject') });
      toast.success(t('Subject cut out ({count} frames)', { count: matte.frames.length }), t('Use “Subject in front of titles” for text behind the player.'));
    } catch (error) {
      if (isAbort(error)) toast.info(t('Cut-out cancelled'));
      else toast.error(t('Could not cut out the subject'), error instanceof Error ? error.message : String(error));
    }
  };

  const invert = (clipId: string, on: boolean) => d.change(setMatteInvert(d.current(), clipId, on), { label: t('Cut out the subject') });
  const remove = (clipId: string) => d.change(setMatte(d.current(), clipId, undefined), { label: t('Remove cut-out') });

  const inFront = (clipId: string) => {
    const r = subjectInFront(d.current(), clipId);
    if (!r.copyId) return void toast.warning(t('Nothing to put in front'), r.problem);
    // the clip itself shows its whole picture again; the copy on top is the subject
    d.change(setMatte(r.project, clipId, undefined), { label: t('Subject in front of titles') });
    d.setSelection([r.copyId]);
    toast.success(t('The subject is now in front: titles on the tracks below pass behind it.'));
  };

  /** Runs the AI's cut-out requests after its edit was applied; returns what happened, for the AI. */
  const runForAI = async (effects: CutoutEffect[]): Promise<string[]> => {
    const notes: string[] = [];
    for (const e of effects) {
      try {
        const matte = await run(e.clipId, e.model);
        let project = setMatte(d.current(), e.clipId, { ...matte, invert: e.mode === 'background' || undefined });
        let line = `cut-out of ${e.clipId}: ${matte.frames.length} masks (${e.model} model), the clip now shows ${e.mode === 'background' ? 'everything but the subject' : 'only the subject'}`;
        if (e.mode === 'front') {
          // the clip itself stays whole; a cut-out copy goes on top
          const r = subjectInFront(project, e.clipId);
          project = setMatte(r.project, e.clipId, undefined);
          line = r.copyId
            ? `cut-out of ${e.clipId}: ${matte.frames.length} masks (${e.model} model); ${r.copyId} = the subject alone on the top track, so titles on lower tracks pass behind it (${e.clipId} stays whole)`
            : `${line}; could not put it in front: ${r.problem}`;
        }
        d.amend(project);
        notes.push(line);
      } catch (error) {
        notes.push(`cut-out of ${e.clipId}: ${isAbort(error) ? 'cancelled by the user' : `failed — ${error instanceof Error ? error.message : String(error)}`}`);
      }
    }
    return notes;
  };

  return { job, cancel: () => abortRef.current?.abort(), cutOut, invert, remove, inFront, runForAI };
}

export type CutoutApi = ReturnType<typeof useCutout>;
