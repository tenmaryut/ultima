import { useRef, useState } from 'react';
import type { Project } from './types';
import type { TFunction } from '../../core/i18n';
import { desktop, saveFile } from '../../core/platform';
import { getAudioContext } from '../../core/utils/audio';
import { uid } from '../../core/utils/id';
import { toast } from '../../components/ui';
import type { MediaLibrary } from './media';
import { getClip, getMedia } from './model';
import { sourceSpan } from './keyframes';
import { readPcm } from './audioSource';
import { encodeWav, separate, type StemKind, type StemPcm } from './stems';
import { placeStem, soundClipOf, stemLabel, stemName } from './stemsClip';
import type { StemsEffect } from './ai/executor';

/* Splitting a clip's sound into stems in the editor: built-in, or with Demucs when it is installed. */

export type StemEngine = 'auto' | 'builtin' | 'demucs';

interface Deps {
  t: TFunction;
  current: () => Project;
  lib: MediaLibrary;
  demucsAvailable: () => boolean;
  change: (p: Project, o?: { label?: string }) => void;
  amend: (p: Project) => void;
  setSelection: (ids: string[]) => void;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';
/** Demucs' two stems for each kind: which stem, and whether to keep it or everything else. */
const DEMUCS: Record<StemKind, { stem: 'vocals' | 'drums'; keep: 'only' | 'without' }> = {
  instrumental: { stem: 'vocals', keep: 'without' },
  vocals: { stem: 'vocals', keep: 'only' },
  drums: { stem: 'drums', keep: 'only' },
  melody: { stem: 'drums', keep: 'without' },
};

export function useStems(d: Deps) {
  const { t } = d;
  const [job, setJob] = useState<{ clipId: string; progress: number; engine: 'builtin' | 'demucs' } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** The stem as a new clip in the project: returns the project and the new clip's id. */
  const run = async (clipId: string, stem: StemKind, engine: StemEngine): Promise<{ project: Project; stemClipId: string; engine: 'builtin' | 'demucs' }> => {
    const p = d.current();
    const c = getClip(p, clipId);
    if (!c || (c.kind !== 'audio' && c.kind !== 'video')) throw new Error(`${clipId} has no sound`);
    const sound = soundClipOf(p, c);
    const media = getMedia(p, (sound ?? c).mediaId);
    const file = media ? d.lib.file(media.id) : undefined;
    if (!media || !file || !media.hasAudio) throw new Error('its sound file is missing or silent');
    const use: 'builtin' | 'demucs' = engine === 'demucs' || (engine === 'auto' && d.demucsAvailable()) ? 'demucs' : 'builtin';
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ clipId, progress: 0, engine: use });
    try {
      const from = c.in;
      const to = Math.min(c.in + sourceSpan(c), media.duration || Infinity);
      const pcm = await readPcm(media, file, from, to);
      if (!pcm) throw new Error('its sound could not be read');
      let result: StemPcm;
      if (use === 'demucs') {
        if (!desktop) throw new Error('Demucs needs the desktop app.');
        const requestId = uid('st_');
        const stop = () => void desktop?.tools.cancelStems(requestId);
        ctrl.signal.addEventListener('abort', stop, { once: true });
        const want = DEMUCS[stem];
        const res = await desktop.tools.stems({ requestId, wav: encodeWav(pcm), stem: want.stem });
        if (ctrl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const bytes = want.keep === 'only' ? res.only : res.without;
        if (!res.ok || !bytes) throw new Error(res.error || 'Demucs failed');
        const buf = await getAudioContext().decodeAudioData(bytes.slice().buffer);
        result = { sampleRate: buf.sampleRate, channels: Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).slice()) };
      } else {
        result = await separate(pcm, stem, { onProgress: (progress) => setJob({ clipId, progress, engine: use }), signal: ctrl.signal });
      }
      const base = media.name.replace(/\.[a-z0-9]{1,5}$/i, '');
      const name = `${base} (${stemName(stem)}).wav`;
      const wav = encodeWav(result);
      // kept on disk (the export folder) so the project finds it again later
      const saved = desktop ? await saveFile(wav, { suggestedName: name, filters: [{ name: 'WAV audio', extensions: ['wav'] }], toExportFolder: true }).catch(() => null) : null;
      const fileOut = new File([wav as BlobPart], saved?.path ? saved.path.split(/[\\/]/).pop()! : name, { type: 'audio/wav' });
      const [ref] = await d.lib.importFiles([fileOut]);
      if (!ref) throw new Error('the stem could not be imported');
      const placed = placeStem(d.current(), clipId, { ...ref, path: saved?.path ?? ref.path }, stem);
      if (!placed.stemClipId) throw new Error(placed.problem ?? 'could not place the stem');
      return { project: placed.project, stemClipId: placed.stemClipId, engine: use };
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const split = async (clipId: string, stem: StemKind, engine: StemEngine) => {
    try {
      const r = await run(clipId, stem, engine);
      d.change(r.project, { label: t('Separate stems') });
      d.setSelection([r.stemClipId]);
      toast.success(t('{stem}: a new clip in sync, the original sound is muted', { stem: t(stemLabel(stem)) }));
    } catch (error) {
      if (isAbort(error)) toast.info(t('Separation cancelled'));
      else toast.error(t('Could not separate the sound'), error instanceof Error ? error.message : String(error));
    }
  };

  /** Runs the AI's stem requests after its edit was applied; returns what happened, for the AI. */
  const runForAI = async (effects: StemsEffect[]): Promise<string[]> => {
    const notes: string[] = [];
    for (const e of effects) {
      try {
        const r = await run(e.clipId, e.stem, e.engine);
        d.amend(r.project);
        notes.push(`stems of ${e.clipId}: ${r.stemClipId} = ${e.stem} (${r.engine === 'demucs' ? 'Demucs' : 'built-in separation'}) on a free audio track, in sync; the original sound is muted`);
      } catch (error) {
        notes.push(`stems of ${e.clipId}: ${isAbort(error) ? 'cancelled by the user' : `failed — ${error instanceof Error ? error.message : String(error)}`}`);
      }
    }
    return notes;
  };

  return { job, cancel: () => abortRef.current?.abort(), split, runForAI };
}

export type StemsApi = ReturnType<typeof useStems>;
