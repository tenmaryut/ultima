import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AIAction } from '../../components/ai/AIAssistantPanel';
import { confirmDialog, promptDialog, toast, type MenuEntry } from '../../components/ui';
import { useHistoryState } from '../../core/history';
import { useLatest } from '../../core/hooks';
import { useT } from '../../core/i18n';
import { rememberRecent } from '../../core/open';
import { desktop, listSystemFonts, pathForFile, pickFiles, saveFile } from '../../core/platform';
import { useAppStore } from '../../core/store';
import { fileBaseName, fileExtension } from '../../core/utils/format';
import { canvasToAIImage } from '../../core/utils/image';
import { uid } from '../../core/utils/id';
import type { CaptionCue, Clip, MediaRef, Project, ProjectSettings, TimeRange, Track, TrackKind, TransitionKind } from './types';
import { MediaLibrary, MEDIA_ACCEPT, mediaKindOf } from './media';
import { PreviewEngine } from './engine';
import { createTimeStore } from './timeStore';
import {
  addCaptionCues,
  addMarker,
  addMediaRefs,
  addMediaToTimeline,
  addTrack,
  captionCues,
  changeSettings,
  copyClips,
  createProject,
  deleteClips,
  duplicateClips,
  editPoints,
  expandLinked,
  findFreeAudioTrack,
  findFreeVideoTrack,
  getClip,
  getMedia,
  getTrack,
  insertClips,
  linkClips,
  makeClip,
  pasteClips,
  removeMarker,
  removeMedia,
  removeTrack,
  rippleDeleteRanges,
  setClipSpeed,
  splitAt,
  timelineDuration,
  unlinkClips,
  updateClip,
  updateMarker,
  updateTrack,
  type ClipboardData,
} from './model';
import { parseProject, serializeProject } from './project';
import { parseSubtitles, serializeSrt, serializeVtt } from './captions';
import { DEFAULT_STILL_DURATION, DEFAULT_TITLE_DURATION, DEFAULT_VISUAL, TRANSITIONS, titlePreset } from './presets';
import { applyAIActions, describeProject } from './aiActions';
import { totalLength } from './silence';
import type { TimelineApi } from './ui/Timeline';
import type { ExportKind } from './ui/ExportDialog';
import type { PreviewZoom } from './ui/Preview';
import type { LeftTab } from './ui/LeftPanel';
import type { VideoActions } from './menus';

export type Dialog =
  | { kind: 'export'; exportKind: ExportKind }
  | { kind: 'settings' }
  | { kind: 'relink' }
  | { kind: 'autocaptions' }
  | { kind: 'silence' }
  | { kind: 'meta' }
  | { kind: 'roughcut' }
  | { kind: 'speech' };

const even = (v: number) => Math.max(16, Math.round(v / 2) * 2);
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video';

function compatibleTrack(p: Project, trackId: string | null | undefined, ref: MediaRef): string | undefined {
  const track = trackId ? getTrack(p, trackId) : undefined;
  if (!track || track.locked) return undefined;
  if (ref.kind === 'audio') return track.kind === 'audio' ? track.id : undefined;
  return track.kind === 'video' ? track.id : undefined;
}

/** All Video Editor state and document actions (the module component only renders). */
export function useVideoEditor(active: boolean) {
  const t = useT();
  const tRef = useLatest(t);
  const doc = useHistoryState<Project>(() => createProject({}, t('Untitled')));
  const project = doc.present;
  const projectRef = useLatest(project);
  const lib = useMemo(() => new MediaLibrary(), []);
  const libVersion = useSyncExternalStore(lib.subscribe, lib.getVersion);
  const time = useMemo(() => createTimeStore(), []);
  const [engine, setEngine] = useState<PreviewEngine | null>(null);
  const [play, setPlay] = useState({ playing: false, rate: 0 });
  const [selection, setSelectionState] = useState<string[]>([]);
  const selectionRef = useLatest(selection);
  const [tool, setTool] = useState<'select' | 'razor'>('select');
  const [snapping, setSnapping] = useState(true);
  const [pps, setPps] = useState(40);
  const [loop, setLoop] = useState(false);
  const [safe, setSafe] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<PreviewZoom>('fit');
  const [leftTab, setLeftTab] = useState<LeftTab>('media');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cutRanges, setCutRanges] = useState<TimeRange[] | null>(null);
  const [filePath, setFilePath] = useState<string | undefined>();
  const filePathRef = useLatest(filePath);
  const [saved, setSaved] = useState<Project>(project);
  const [importing, setImporting] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [hasClipboard, setHasClipboard] = useState(false);
  const clipboard = useRef<ClipboardData | null>(null);
  const timelineApi = useRef<TimelineApi | null>(null);
  const shiftRef = useRef(false);
  const settingsChosen = useRef(false);
  /** Files used earlier in this session, for automatic relinking when a project is reopened. */
  const stash = useRef(new Map<string, File>());
  const dirty = project !== saved;
  const dirtyRef = useLatest(dirty);

  const setSelection = useCallback((ids: string[]) => setSelectionState(ids), []);
  const change = useCallback((next: Project, opts?: { record?: boolean; label?: string }) => doc.set(next, opts), [doc.set]);
  const commit = useCallback((label: string) => doc.commit(label), [doc.commit]);

  /* ------------------------------ engine & effects ------------------------------ */

  useEffect(() => {
    const e = new PreviewEngine(lib, time, {
      onPlayState: (playing, rate) => setPlay({ playing, rate }),
      offlineLabel: () => tRef.current('Media offline'),
    });
    setEngine(e);
    return () => e.dispose();
  }, [lib, time, tRef]);
  useEffect(() => () => lib.dispose(), [lib]);
  useEffect(() => engine?.setProject(project), [engine, project]);
  useEffect(() => engine?.setActive(active), [engine, active]);
  useEffect(() => {
    if (engine) engine.loop = loop;
  }, [engine, loop]);
  useEffect(() => {
    setSelectionState((sel) => {
      const kept = sel.filter((id) => project.clips.some((c) => c.id === id));
      return kept.length === sel.length ? sel : kept;
    });
  }, [project]);
  const fontsLoaded = useRef(false);
  useEffect(() => {
    if (!active || fontsLoaded.current) return;
    fontsLoaded.current = true;
    void listSystemFonts().then(setFonts);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const track = (e: KeyboardEvent) => (shiftRef.current = e.shiftKey);
    const reset = () => (shiftRef.current = false);
    window.addEventListener('keydown', track, true);
    window.addEventListener('keyup', track, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', track, true);
      window.removeEventListener('keyup', track, true);
      window.removeEventListener('blur', reset);
    };
  }, [active]);

  const seek = useCallback((tm: number) => (engine ? engine.seek(tm) : time.set(Math.max(0, tm))), [engine, time]);
  const playhead = () => time.get();

  /* ---------------------------------- documents --------------------------------- */

  const resetDocument = (p: Project) => {
    for (const m of projectRef.current.media) {
      if (p.media.some((x) => x.id === m.id)) continue;
      const f = lib.file(m.id);
      if (f) stash.current.set(`${m.name}|${m.size}`, f);
      lib.remove(m.id);
    }
    engine?.pause();
    doc.reset(p);
    setSaved(p);
    setSelectionState([]);
    setCutRanges(null);
    seek(0);
  };

  const confirmDiscard = async () =>
    !dirtyRef.current ||
    confirmDialog({
      title: t('Discard unsaved changes?'),
      message: t('The current project has unsaved changes that will be lost.'),
      confirmLabel: t('Discard changes'),
      danger: true,
    });

  const newProject = async () => {
    if (!(await confirmDiscard())) return;
    resetDocument(createProject({}, t('Untitled')));
    setFilePath(undefined);
    settingsChosen.current = false;
    setDialog({ kind: 'settings' });
  };

  const openProject = async (file: File) => {
    let p: Project;
    try {
      p = parseProject(await file.text());
    } catch (error) {
      toast.error(t('Could not open project'), error instanceof Error ? error.message : String(error));
      return;
    }
    if (!(await confirmDiscard())) return;
    resetDocument(p);
    setFilePath(pathForFile(file));
    rememberRecent(file, 'video');
    settingsChosen.current = true;
    const relinked: MediaRef[] = [];
    for (const m of p.media) {
      if (lib.has(m.id)) continue;
      const f = stash.current.get(`${m.name}|${m.size}`);
      if (!f) continue;
      try {
        relinked.push({ ...m, ...(await lib.relink(m, f)), id: m.id });
      } catch {
        // stays missing
      }
    }
    if (relinked.length) {
      const next = { ...p, media: p.media.map((m) => relinked.find((r) => r.id === m.id) ?? m) };
      doc.reset(next);
      setSaved(next);
    }
    if (p.media.some((m) => !lib.has(m.id))) setDialog({ kind: 'relink' });
    toast.success(t('Opened {name}', { name: file.name }));
  };

  const save = async (as: boolean) => {
    const p = projectRef.current;
    try {
      const res = await saveFile(serializeProject(p), {
        suggestedName: `${safeName(p.name)}.ultima`,
        filters: [{ name: t('Ultima project'), extensions: ['ultima'] }],
        path: as ? undefined : filePathRef.current,
      });
      if (!res) return;
      let next = p;
      if (res.path) {
        setFilePath(res.path);
        const base = fileBaseName(res.path.split(/[\\/]/).pop() ?? '');
        if (base && base !== p.name) {
          next = { ...p, name: base };
          doc.set(next, { record: false });
        }
      }
      setSaved(next);
      toast.success(t('Project saved'), res.path);
    } catch (error) {
      toast.error(t('Could not save the project'), error instanceof Error ? error.message : String(error));
    }
  };

  /* ------------------------------------ media ------------------------------------ */

  const importCaptionFile = async (file: File) => {
    try {
      const cues = parseSubtitles(await file.text(), file.name);
      if (!cues.length) {
        toast.warning(t('No captions found in {name}', { name: file.name }));
        return;
      }
      const r = addCaptionCues(projectRef.current, cues);
      doc.set(r.project, { label: t('Import captions') });
      setLeftTab('captions');
      toast.success(t('Imported {count} captions', { count: r.ids.length }));
    } catch (error) {
      toast.error(t('Could not read {name}', { name: file.name }), error instanceof Error ? error.message : String(error));
    }
  };

  /** Imports files. `place`: 'bin' (just the bin), 'auto' (also onto an empty timeline) or a timeline position. */
  /** `freeTrack`: put audio on a free audio track (a voice-over must not cut the sound under it). */
  const importFiles = async (files: File[], place: { time: number; trackId: string | null; freeTrack?: boolean } | 'auto' | 'bin' = 'bin') => {
    const projectFile = files.find((f) => fileExtension(f.name) === 'ultima');
    if (projectFile) return openProject(projectFile);
    const subs = files.filter((f) => ['srt', 'vtt'].includes(fileExtension(f.name)));
    for (const f of subs) await importCaptionFile(f);
    const mediaFiles = files.filter((f) => !subs.includes(f) && mediaKindOf(f));
    const unknown = files.filter((f) => !subs.includes(f) && !mediaKindOf(f));
    if (unknown.length) toast.warning(t('Unsupported file type'), unknown.map((f) => f.name).join(', '));
    if (!mediaFiles.length) return;
    setImporting((n) => n + mediaFiles.length);
    let refs: MediaRef[] = [];
    try {
      refs = await lib.importFiles(mediaFiles, (name, reason) => toast.error(t('Could not import {name}', { name }), t(reason)));
    } finally {
      setImporting((n) => n - mediaFiles.length);
    }
    if (!refs.length) return;
    mediaFiles.slice(0, 3).forEach((f) => rememberRecent(f, 'video'));
    for (const f of mediaFiles) stash.current.set(`${f.name}|${f.size}`, f);
    const before = projectRef.current;
    let p = addMediaRefs(before, refs);
    const wasEmpty = before.clips.length === 0;
    const target: { time: number; trackId: string | null; freeTrack?: boolean } | null = place === 'bin' ? null : place === 'auto' ? (wasEmpty ? { time: 0, trackId: null } : null) : place;
    if (wasEmpty && target && !settingsChosen.current) {
      const v = refs.find((r) => r.kind === 'video' && r.width > 0 && r.height > 0);
      if (v && (even(v.width) !== p.settings.width || even(v.height) !== p.settings.height)) {
        p = changeSettings(p, { ...p.settings, width: even(v.width), height: even(v.height) });
        toast.info(t('Project frame set to {size} to match {name}', { size: `${even(v.width)}×${even(v.height)}`, name: v.name }));
      }
    }
    const added: string[] = [];
    if (target) {
      let at = target.time;
      for (const ref of refs) {
        let trackId = compatibleTrack(p, target.trackId, ref);
        if (target.freeTrack && ref.kind === 'audio') {
          const free = findFreeAudioTrack(p, at, at + ref.duration);
          p = free.project;
          trackId = free.trackId;
        }
        const r = addMediaToTimeline(p, ref, { start: at, trackId });
        p = r.project;
        added.push(...r.ids);
        at += ref.kind === 'image' ? DEFAULT_STILL_DURATION : ref.duration;
      }
    }
    doc.set(p, { label: t('Import media') });
    if (added.length) setSelectionState(added);
    if (!target) setLeftTab('media');
  };

  const importMedia = async () => {
    const files = await pickFiles({ accept: MEDIA_ACCEPT, multiple: true });
    if (files.length) await importFiles(files, 'auto');
  };

  const open = async () => {
    const files = await pickFiles({ accept: `.ultima,${MEDIA_ACCEPT},.srt,.vtt`, multiple: true });
    if (files.length) await importFiles(files, 'auto');
  };

  const addMedia = (mediaId: string, where: 'playhead' | 'end' | { time: number; trackId: string | null }) => {
    const p = projectRef.current;
    const ref = getMedia(p, mediaId);
    if (!ref || !lib.has(mediaId)) return;
    const start = where === 'end' ? timelineDuration(p) : where === 'playhead' ? playhead() : where.time;
    const r = addMediaToTimeline(p, ref, { start, trackId: typeof where === 'object' ? compatibleTrack(p, where.trackId, ref) : undefined });
    change(r.project, { label: t('Add to timeline') });
    setSelectionState(r.ids);
  };

  const removeMediaItem = async (mediaId: string) => {
    const p = projectRef.current;
    const used = p.clips.filter((c) => c.mediaId === mediaId).length;
    if (used && !(await confirmDialog({ title: t('Remove from project?'), message: t('{count} clip(s) on the timeline use this file and will be removed too.', { count: used }), confirmLabel: t('Remove'), danger: true }))) return;
    change(removeMedia(p, mediaId), { label: t('Remove media') });
  };

  const convertMedia = async (mediaId: string) => {
    const api = desktop;
    const item = lib.get(mediaId);
    const ref = getMedia(projectRef.current, mediaId);
    if (!api || !item || !ref) return;
    toast.info(t('Converting {name} with FFmpeg…', { name: ref.name }));
    try {
      const format = ref.kind === 'audio' ? 'm4a' : 'mp4';
      const res = await api.tools.transcode({ requestId: uid('tc_'), input: new Uint8Array(await item.file.arrayBuffer()), inputName: item.file.name, format, quality: 'high' });
      if (!res.ok || !res.data) throw new Error(res.error || 'FFmpeg failed');
      const file = new File([res.data as BlobPart], `${fileBaseName(ref.name)}.${format}`, { type: format === 'mp4' ? 'video/mp4' : 'audio/mp4' });
      const fresh = await lib.relink(ref, file);
      const p = projectRef.current;
      doc.set({ ...p, media: p.media.map((m) => (m.id === mediaId ? { ...fresh, id: mediaId } : m)) }, { record: false });
      toast.success(t('Converted {name}', { name: ref.name }));
    } catch (error) {
      toast.error(t('Conversion failed'), error instanceof Error ? error.message : String(error));
    }
  };

  const onRelinked = (refs: MediaRef[]) => {
    const p = projectRef.current;
    doc.set({ ...p, media: p.media.map((m) => refs.find((r) => r.id === m.id) ?? m) }, { record: false });
  };

  /* -------------------------------- editing actions -------------------------------- */

  const clipsSelected = (): Clip[] => selectionRef.current.map((id) => getClip(projectRef.current, id)).filter((c): c is Clip => Boolean(c));

  const deleteSelection = (ripple: boolean) => {
    const sel = selectionRef.current;
    if (!sel.length) return false;
    const p = projectRef.current;
    const next = deleteClips(p, sel, { ripple });
    if (next !== p) change(next, { label: ripple ? t('Ripple delete') : t('Delete clips') });
    setSelectionState([]);
    return true;
  };

  const split = () => {
    const sel = selectionRef.current;
    const r = splitAt(projectRef.current, playhead(), sel.length ? sel : undefined);
    if (r.created.length) change(r.project, { label: t('Split') });
    else toast.info(t('Nothing to split at the playhead'));
  };

  const copy = () => {
    const data = copyClips(projectRef.current, selectionRef.current);
    if (data) {
      clipboard.current = data;
      setHasClipboard(true);
    }
  };
  const cut = () => {
    copy();
    deleteSelection(false);
  };
  const paste = () => {
    if (!clipboard.current) return;
    const r = pasteClips(projectRef.current, clipboard.current, playhead());
    change(r.project, { label: t('Paste') });
    setSelectionState(r.ids);
  };
  const duplicate = () => {
    const r = duplicateClips(projectRef.current, selectionRef.current);
    if (!r.ids.length) return false;
    change(r.project, { label: t('Duplicate') });
    setSelectionState(r.ids);
    return true;
  };
  const selectAll = () => {
    const p = projectRef.current;
    const locked = new Set(p.tracks.filter((tr) => tr.locked).map((tr) => tr.id));
    setSelectionState(p.clips.filter((c) => !locked.has(c.trackId)).map((c) => c.id));
  };

  const addMarkerAt = () => {
    const r = addMarker(projectRef.current, playhead(), '');
    change(r.project, { label: t('Add marker') });
  };
  const renameMarker = async (id: string) => {
    const m = projectRef.current.markers.find((x) => x.id === id);
    if (!m) return;
    const label = await promptDialog({ title: t('Marker name'), defaultValue: m.label });
    if (label !== null) change(updateMarker(projectRef.current, id, { label: label.slice(0, 100) }), { label: t('Rename marker') });
  };
  const setIn = () => {
    const p = projectRef.current;
    const at = playhead();
    const end = p.workArea && p.workArea.end > at ? p.workArea.end : Math.max(timelineDuration(p), at + 1);
    change({ ...p, workArea: { start: at, end } }, { label: t('Set in point') });
  };
  const setOut = () => {
    const p = projectRef.current;
    const at = playhead();
    if (at <= 0) return;
    const start = p.workArea && p.workArea.start < at ? p.workArea.start : 0;
    change({ ...p, workArea: { start, end: at } }, { label: t('Set out point') });
  };
  const clearInOut = () => {
    const p = projectRef.current;
    if (p.workArea) change({ ...p, workArea: null }, { label: t('Clear in/out') });
  };

  const addTrackOf = (kind: TrackKind) => change(addTrack(projectRef.current, kind).project, { label: t('Add track') });
  const patchTrack = (trackId: string, patch: Partial<Track>) => change(updateTrack(projectRef.current, trackId, patch), { label: t('Track settings') });

  const addTitle = (presetId: string, at?: number, trackId?: string | null, text?: string) => {
    const p0 = projectRef.current;
    const style = titlePreset(presetId, p0.settings.width, p0.settings.height);
    const line = text?.split('\n').map((s) => s.trim()).find(Boolean);
    style.text = line ? Array.from(line).slice(0, 120).join('') : t(style.text);
    if (style.subtitle) style.subtitle = t(style.subtitle);
    const start = Math.max(0, at ?? playhead());
    const track = trackId ? getTrack(p0, trackId) : undefined;
    const r = track && track.kind === 'video' && !track.locked ? { project: p0, trackId: track.id } : findFreeVideoTrack(p0, start, start + DEFAULT_TITLE_DURATION);
    const clip = makeClip('title', r.trackId, start, DEFAULT_TITLE_DURATION, { name: style.text, title: style });
    change(insertClips(r.project, [clip]), { label: t('Add title') });
    setSelectionState([clip.id]);
  };

  const addCaptionAtPlayhead = () => {
    const at = playhead();
    const r = addCaptionCues(projectRef.current, [{ start: at, end: at + 2, text: t('New caption') }]);
    change(r.project, { label: t('Add caption') });
    setSelectionState(r.ids);
    setLeftTab('captions');
  };

  const importCaptions = async () => {
    const files = await pickFiles({ accept: '.srt,.vtt,text/vtt' });
    if (files[0]) await importCaptionFile(files[0]);
  };
  const exportCaptions = async (fmt: 'srt' | 'vtt') => {
    const cues = captionCues(projectRef.current, true);
    if (!cues.length) return toast.info(t('There are no captions to export.'));
    const text = fmt === 'srt' ? serializeSrt(cues) : serializeVtt(cues);
    const res = await saveFile(text, { suggestedName: `${safeName(projectRef.current.name)}.${fmt}`, filters: [{ name: fmt === 'srt' ? 'SubRip' : 'WebVTT', extensions: [fmt] }] });
    if (res) toast.success(t('Captions exported'), res.path);
  };
  const onAutoCaptions = (cues: CaptionCue[], replace: boolean) => {
    const p = projectRef.current;
    const track = p.tracks.find((tr) => tr.kind === 'caption' && !tr.locked);
    change(addCaptionCues(p, cues, { trackId: track?.id, replace }).project, { label: t('Auto captions') });
    setLeftTab('captions');
  };

  const applyCuts = (ranges: TimeRange[], label: string) => {
    if (!ranges.length) return;
    change(rippleDeleteRanges(projectRef.current, ranges), { label });
    setCutRanges(null);
    toast.success(t('Removed {seconds} s in {count} cut(s)', { seconds: totalLength(ranges).toFixed(1), count: ranges.length }));
  };

  const addChapterMarkers = (chapters: { time: number; title: string }[]) => {
    let p = projectRef.current;
    for (const c of chapters) p = addMarker(p, c.time, c.title).project;
    change(p, { label: t('Add chapter markers') });
    toast.success(t('Added {count} markers', { count: chapters.length }));
  };

  const setTransition = (kind: TransitionKind | 'none') => {
    let p = projectRef.current;
    for (const c of clipsSelected()) {
      if (!(c.kind === 'video' || c.kind === 'image' || c.kind === 'title')) continue;
      p = updateClip(p, c.id, (x) => ({ ...x, transition: kind === 'none' ? undefined : { kind, duration: Math.min(1, x.duration) } }));
    }
    change(p, { label: t('Transition') });
  };
  const setSpeed = (speed: number) => {
    let p = projectRef.current;
    const done = new Set<string>();
    for (const c of clipsSelected()) {
      if ((c.kind !== 'video' && c.kind !== 'audio') || done.has(c.id)) continue;
      expandLinked(p, [c.id]).forEach((id) => done.add(id));
      p = setClipSpeed(p, c.id, speed);
    }
    change(p, { label: t('Change speed') });
  };
  const resetEffects = () => {
    let p = projectRef.current;
    for (const c of clipsSelected()) if (c.visual) p = updateClip(p, c.id, (x) => ({ ...x, visual: { ...DEFAULT_VISUAL }, fadeIn: 0, fadeOut: 0, transition: undefined }));
    change(p, { label: t('Reset effects') });
  };
  const renameClip = async () => {
    const c = clipsSelected()[0];
    if (!c) return;
    const name = await promptDialog({ title: t('Rename clip'), defaultValue: c.kind === 'title' ? c.title?.text ?? '' : c.name });
    if (name === null || !name.trim()) return;
    change(
      updateClip(projectRef.current, c.id, (x) => (x.kind === 'title' && x.title ? { ...x, name: name.slice(0, 80), title: { ...x.title, text: name } } : { ...x, name: name.slice(0, 200) })),
      { label: t('Rename clip') },
    );
  };

  const goEdit = (dir: 1 | -1) => {
    const now = playhead();
    const pts = editPoints(projectRef.current);
    const target = dir > 0 ? pts.find((x) => x > now + 1e-4) : [...pts].reverse().find((x) => x < now - 1e-4);
    if (target !== undefined) seek(target);
  };

  /* ------------------------------------ menus ------------------------------------ */

  const clipMenu = (clip: Clip): MenuEntry[] => {
    const visual = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'title';
    const media = clip.kind === 'video' || clip.kind === 'audio';
    return [
      { label: t('Split at playhead'), shortcut: 'S', onClick: split },
      { label: t('Cut'), shortcut: 'Ctrl+X', onClick: cut },
      { label: t('Copy'), shortcut: 'Ctrl+C', onClick: copy },
      { label: t('Duplicate'), shortcut: 'Ctrl+D', onClick: duplicate },
      { label: t('Delete'), shortcut: 'Del', onClick: () => deleteSelection(false) },
      { label: t('Ripple delete'), shortcut: 'Shift+Del', onClick: () => deleteSelection(true) },
      { type: 'separator' },
      clip.linkId ? { label: t('Unlink clips'), onClick: () => change(unlinkClips(projectRef.current, selectionRef.current), { label: t('Unlink clips') }) } : { label: t('Link clips'), onClick: () => change(linkClips(projectRef.current, selectionRef.current), { label: t('Link clips') }), disabled: selectionRef.current.length < 2 },
      ...(visual ? [{ label: t('Transition in'), submenu: [{ label: t('None'), onClick: () => setTransition('none') }, ...TRANSITIONS.map((tr) => ({ label: t(tr.label), onClick: () => setTransition(tr.kind) }))] }] : []),
      ...(media ? [{ label: t('Speed'), submenu: [0.25, 0.5, 1, 1.5, 2, 4].map((v) => ({ label: `${v}×`, onClick: () => setSpeed(v) })) }] : []),
      { label: t('Rename…'), onClick: () => void renameClip() },
    ];
  };

  const trackMenu = (track: Track): MenuEntry[] => [
    {
      label: t('Rename track…'),
      onClick: async () => {
        const name = await promptDialog({ title: t('Track name'), defaultValue: track.name });
        if (name?.trim()) patchTrack(track.id, { name: name.trim().slice(0, 40) });
      },
    },
    { label: t('Add track above'), onClick: () => change(addTrack(projectRef.current, track.kind, track.id).project, { label: t('Add track') }) },
    { label: track.locked ? t('Unlock track') : t('Lock track'), onClick: () => patchTrack(track.id, { locked: !track.locked }) },
    { type: 'separator' },
    {
      label: t('Delete track'),
      onClick: async () => {
        const p = projectRef.current;
        const count = p.clips.filter((c) => c.trackId === track.id).length;
        if (count && !(await confirmDialog({ title: t('Delete track {name}?', { name: track.name }), message: t('Its {count} clip(s) will be removed.', { count }), confirmLabel: t('Delete'), danger: true }))) return;
        change(removeTrack(projectRef.current, track.id), { label: t('Delete track') });
      },
    },
  ];

  const markerMenu = (id: string): MenuEntry[] => [
    { label: t('Go to marker'), onClick: () => seek(projectRef.current.markers.find((m) => m.id === id)?.time ?? playhead()) },
    { label: t('Rename…'), onClick: () => void renameMarker(id) },
    { label: t('Delete marker'), onClick: () => change(removeMarker(projectRef.current, id), { label: t('Delete marker') }) },
  ];

  const actions: VideoActions = {
    newProject: () => void newProject(),
    open: () => void open(),
    importMedia: () => void importMedia(),
    save: (as) => void save(as),
    exportDialog: (exportKind) => setDialog({ kind: 'export', exportKind }),
    importCaptions: () => void importCaptions(),
    exportCaptions: (fmt) => void exportCaptions(fmt),
    relink: () => setDialog({ kind: 'relink' }),
    projectSettings: () => setDialog({ kind: 'settings' }),
    undo: doc.undo,
    redo: doc.redo,
    cut,
    copy,
    paste,
    duplicate: () => void duplicate(),
    deleteSelection: (ripple) => void deleteSelection(ripple),
    selectAll,
    deselect: () => setSelectionState([]),
    split,
    link: () => change(linkClips(projectRef.current, selectionRef.current), { label: t('Link clips') }),
    unlink: () => change(unlinkClips(projectRef.current, selectionRef.current), { label: t('Unlink clips') }),
    setTransition,
    setSpeed,
    resetEffects,
    renameClip: () => void renameClip(),
    addTrack: addTrackOf,
    addMarker: addMarkerAt,
    setIn,
    setOut,
    clearInOut,
    toggleSnapping: () => setSnapping((s) => !s),
    goStart: () => seek(0),
    goEnd: () => seek(timelineDuration(projectRef.current)),
    prevEdit: () => goEdit(-1),
    nextEdit: () => goEdit(1),
    zoomIn: () => timelineApi.current?.zoomIn(),
    zoomOut: () => timelineApi.current?.zoomOut(),
    zoomFit: () => timelineApi.current?.zoomFit(),
    toggleSafe: () => setSafe((s) => !s),
    toggleLoop: () => setLoop((s) => !s),
    setPreviewZoom,
    autoCaptions: () => setDialog({ kind: 'autocaptions' }),
    removeSilences: () => setDialog({ kind: 'silence' }),
    writeMeta: () => setDialog({ kind: 'meta' }),
    roughCut: () => setDialog({ kind: 'roughcut' }),
    voiceOver: () => setDialog({ kind: 'speech' }),
    toggleAI: () => useAppStore.getState().toggleAIPanel(),
  };

  /* --------------------------------------- AI --------------------------------------- */

  const aiContext = async () => {
    const canvas = engine?.canvasElement;
    let image = null;
    if (canvas && projectRef.current.clips.length) {
      try {
        image = await canvasToAIImage(canvas, { maxSize: 1024 });
      } catch {
        image = null;
      }
    }
    return { summary: describeProject(projectRef.current, { playhead: playhead(), selection: selectionRef.current }), image };
  };

  const aiApply = (list: AIAction[]) => {
    const r = applyAIActions(projectRef.current, list, { playhead: playhead() });
    if (!r.applied) throw new Error(r.notes.length ? r.notes.join('; ') : t('Nothing could be applied.'));
    doc.set(r.project, { label: t('AI edit') });
    const summary = t('Applied {count} change(s)', { count: r.applied });
    return r.notes.length ? `${summary} · ${t('skipped')}: ${r.notes.join('; ')}` : summary;
  };

  const applySettings = (settings: ProjectSettings, name: string) => {
    settingsChosen.current = true;
    const p = projectRef.current;
    change({ ...changeSettings(p, settings), name }, { label: t('Project settings') });
  };

  return {
    t,
    doc,
    project,
    lib,
    libVersion,
    time,
    engine,
    play,
    selection,
    setSelection,
    tool,
    setTool,
    snapping,
    setSnapping,
    pps,
    setPps,
    loop,
    setLoop,
    safe,
    setSafe,
    previewZoom,
    setPreviewZoom,
    leftTab,
    setLeftTab,
    dialog,
    setDialog,
    cutRanges,
    setCutRanges,
    dirty,
    importing,
    exporting,
    setExporting,
    fonts,
    hasClipboard,
    timelineApi,
    shiftRef,
    change,
    commit,
    seek,
    actions,
    importFiles,
    addMedia,
    removeMediaItem,
    convertMedia,
    onRelinked,
    addTitle,
    addCaptionAtPlayhead,
    onAutoCaptions,
    applyCuts,
    addChapterMarkers,
    renameMarker,
    patchTrack,
    clipMenu,
    trackMenu,
    markerMenu,
    deleteSelection,
    duplicate,
    aiContext,
    aiApply,
    applySettings,
    exportCaptions,
    importCaptions,
  };
}
