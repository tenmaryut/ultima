import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AIAction, AIActionReport } from '../../components/ai/AIAssistantPanel';
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
import { FolderLibrary, folderIdsIn } from './folders';
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
  clipEnd,
  setSpeedRamp,
  findTopVideoTrack,
  freezeFrameAt,
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
import { RAMP_PRESETS, rampPreset, type RampPreset } from './keyframes';
import { encodeLut, parseCube } from './grade';
import { isLibraryMedia, libraryFile, libraryItemOf, type LibraryItem } from './library';
import type { ImportWhat } from './ai/executor';
import { applyAIActions, describeProject, formatResults } from './aiActions';
import { clipFrameSheets, lookSheet, planSourceLook, sourceLookSheet, type FrameSource } from './ai/frames';
import { sourceAnalysisSummary } from './ai/describe';
import type { AIImage } from '@shared/ai-types';
import { AnalysisStore } from './analysisStore';
import { totalLength } from './silence';
import { applyBeatSync, type BeatSyncOptions } from './beatsync';
import type { TimelineApi } from './ui/Timeline';
import type { ExportKind } from './ui/ExportDialog';
import type { PreviewZoom } from './ui/Preview';
import type { LeftTab } from './ui/LeftPanel';
import type { VideoActions } from './menus';

export type Dialog =
  | { kind: 'export'; exportKind: ExportKind; range?: 'all' | 'work'; autoStart?: boolean }
  | { kind: 'settings' }
  | { kind: 'relink' }
  | { kind: 'autocaptions' }
  | { kind: 'silence' }
  | { kind: 'beats' }
  | { kind: 'meta' }
  | { kind: 'roughcut' }
  | { kind: 'speech' };

const even = (v: number) => Math.max(16, Math.round(v / 2) * 2);

const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];
const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2';
/** Button labels for the files the AI asks for. */
const IMPORT_LABELS: Record<ImportWhat, string> = {
  music: 'Choose music…',
  sfx: 'Choose sound files…',
  video: 'Choose videos…',
  image: 'Choose pictures…',
  font: 'Choose fonts…',
  lut: 'Choose LUT files…',
  any: 'Choose files…',
};
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
  const analysis = useMemo(() => new AnalysisStore(lib), [lib]);
  const libVersion = useSyncExternalStore(lib.subscribe, lib.getVersion);
  const folders = useMemo(() => new FolderLibrary(), []);
  const folderVersion = useSyncExternalStore(folders.subscribe, folders.getVersion);
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
  const fontsRef = useLatest(fonts);
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
  // linked folders: read once, then look for new recordings when Ultima gets the focus and every 30 s
  const activeRef = useLatest(active);
  useEffect(() => {
    if (!FolderLibrary.supported()) return;
    void folders.load();
    let last = Date.now();
    const refresh = () => {
      if (!activeRef.current || document.visibilityState !== 'visible' || Date.now() - last < 5000) return;
      last = Date.now();
      void folders.refresh();
    };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, [folders, activeRef]);
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

  // fonts stored in the project are loaded for titles (and stay loaded for this session)
  const [, setFontsReady] = useState(0);
  const loadedFonts = useRef(new Set<string>());
  useEffect(() => {
    for (const f of project.fonts) {
      if (loadedFonts.current.has(f.id)) continue;
      loadedFonts.current.add(f.id);
      try {
        const bin = atob(f.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        void new FontFace(f.family, bytes)
          .load()
          .then((face) => {
            document.fonts.add(face);
            setFontsReady((n) => n + 1);
          })
          .catch(() => toast.error(tRef.current('Could not load the font {name}', { name: f.family })));
      } catch {
        toast.error(tRef.current('Could not load the font {name}', { name: f.family }));
      }
    }
  }, [project.fonts, tRef]);
  const fontList = useMemo(() => [...new Set([...project.fonts.map((f) => f.family), ...fonts])], [project.fonts, fonts]);

  // built-in library items (sound effects, stickers, overlays) are made when a project uses them
  const making = useRef(new Set<string>());
  useEffect(() => {
    for (const m of project.media) {
      if (!isLibraryMedia(m.id) || lib.has(m.id) || making.current.has(m.id)) continue;
      const item = libraryItemOf(m.id);
      if (!item) continue;
      making.current.add(m.id);
      void libraryFile(item)
        .then((file) => lib.add(file, m.id))
        .catch(() => undefined)
        .finally(() => making.current.delete(m.id));
    }
  }, [project.media, lib]);
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

  /** The file of a project media item in a linked folder (same id, or same name and size), if any. */
  const folderFileFor = async (m: MediaRef): Promise<File | undefined> => {
    const entry = folders.get(m.id) ?? folders.find(m.name, m.size);
    return entry ? folders.file(entry.id).catch(() => undefined) : undefined;
  };

  /** Relinks missing media found in linked folders (after linking a folder or when new files appear). */
  const relinking = useRef(false);
  const relinkFromFolders = async (): Promise<void> => {
    if (relinking.current) return;
    relinking.current = true;
    try {
      const missing = projectRef.current.media.filter((m) => !lib.has(m.id) && !isLibraryMedia(m.id));
      const relinked: MediaRef[] = [];
      for (const m of missing) {
        const f = await folderFileFor(m);
        if (!f) continue;
        try {
          relinked.push({ ...m, ...(await lib.relink(m, f)), id: m.id });
        } catch {
          // stays missing
        }
      }
      if (!relinked.length) return;
      const clean = !dirtyRef.current;
      const cur = projectRef.current;
      const next = { ...cur, media: cur.media.map((m) => relinked.find((r) => r.id === m.id) ?? m) };
      doc.set(next, { label: t('Relink media') });
      if (clean) setSaved(next);
      toast.success(t('Found {count} missing file(s) in your linked folders', { count: relinked.length }));
    } finally {
      relinking.current = false;
    }
  };
  // after a restart Chromium may want a click before reading the linked folders again: the user's first click
  // anywhere does it (the "Allow" button stays as a fallback)
  useEffect(() => {
    const waiting = folders.folders.filter((f) => f.access === 'prompt');
    if (!waiting.length) return;
    const onFirstClick = () => waiting.forEach((f) => void folders.allow(f.id));
    window.addEventListener('pointerdown', onFirstClick, { once: true, capture: true });
    return () => window.removeEventListener('pointerdown', onFirstClick, { capture: true });
  }, [folderVersion, folders]);
  const relinkRef = useLatest(relinkFromFolders);
  useEffect(() => {
    if (folders.entries.length && projectRef.current.media.some((m) => !lib.has(m.id) && !isLibraryMedia(m.id))) void relinkRef.current();
  }, [folderVersion, folders, lib, projectRef, relinkRef]);

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
    // files used earlier in this session, or found in a linked folder, come back by themselves
    await folders.load().catch(() => undefined);
    const relinked: MediaRef[] = [];
    for (const m of p.media) {
      if (lib.has(m.id) || isLibraryMedia(m.id)) continue;
      const f = stash.current.get(`${m.name}|${m.size}`) ?? (await folderFileFor(m));
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
    // built-in library items are made again by themselves
    if (p.media.some((m) => !lib.has(m.id) && !isLibraryMedia(m.id))) setDialog({ kind: 'relink' });
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
  /** `idFor`: a fixed media id per file (files from linked folders keep their "fd_…" id). */
  const importFiles = async (
    files: File[],
    place: { time: number; trackId: string | null; freeTrack?: boolean } | 'auto' | 'bin' = 'bin',
    idFor?: (file: File) => string | undefined,
  ) => {
    const projectFile = files.find((f) => fileExtension(f.name) === 'ultima');
    if (projectFile) return openProject(projectFile);
    const subs = files.filter((f) => ['srt', 'vtt'].includes(fileExtension(f.name)));
    for (const f of subs) await importCaptionFile(f);
    const cubes = files.filter((f) => fileExtension(f.name) === 'cube');
    const fontFiles = files.filter((f) => FONT_EXTENSIONS.includes(fileExtension(f.name)));
    const other = (f: File) => !subs.includes(f) && !cubes.includes(f) && !fontFiles.includes(f);
    const mediaFiles = files.filter((f) => other(f) && mediaKindOf(f));
    const unknown = files.filter((f) => other(f) && !mediaKindOf(f));
    if (unknown.length) toast.warning(t('Unsupported file type'), unknown.map((f) => f.name).join(', '));
    if (cubes.length) await addLutFiles(cubes);
    if (fontFiles.length) await addFontFiles(fontFiles);
    if (!mediaFiles.length) return;
    setImporting((n) => n + mediaFiles.length);
    let refs: MediaRef[] = [];
    try {
      refs = await lib.importFiles(mediaFiles, (name, reason) => toast.error(t('Could not import {name}', { name }), t(reason)), idFor);
    } finally {
      setImporting((n) => n - mediaFiles.length);
    }
    if (!refs.length) return;
    mediaFiles.slice(0, 3).forEach((f) => rememberRecent(f, 'video'));
    // beats, loud moments and scene changes for the AI assistant, in the background
    for (const r of refs) void analysis.ensure(r);
    for (const f of mediaFiles) stash.current.set(`${f.name}|${f.size}`, f);
    const before = doc.current();
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
    const files = await pickFiles({ accept: `${MEDIA_ACCEPT},.cube,${FONT_ACCEPT}`, multiple: true });
    if (files.length) await importFiles(files, 'auto');
  };

  /** Adds fonts to the project (stored inside it) so titles can use them. */
  const addFontFiles = async (files: File[]): Promise<string[]> => {
    const families: string[] = [];
    let p = doc.current();
    for (const f of files) {
      try {
        if (f.size > 16 * 1024 * 1024) throw new Error('This font file is too large (16 MB at most).');
        const bytes = new Uint8Array(await f.arrayBuffer());
        const family = fileBaseName(f.name).replace(/[_-]+/g, ' ').replace(/["';{}<>\\]/g, '').trim().slice(0, 80) || 'Font';
        // check that the browser can read it before keeping it
        await new FontFace(family, bytes).load();
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        p = { ...p, fonts: [...p.fonts.filter((x) => x.family !== family), { id: uid('font_'), family, name: f.name, data: btoa(bin) }] };
        families.push(family);
      } catch (e) {
        toast.error(t('Could not import {name}', { name: f.name }), t(e instanceof Error ? e.message : 'This is not a font file this app can read.'));
      }
    }
    if (families.length) {
      doc.set(p, { label: t('Import font') });
      toast.success(t('Fonts added: {names}', { names: families.join(', ') }), t('Choose them in a title’s Font list.'));
    }
    return families;
  };
  const importFont = async () => {
    const files = await pickFiles({ accept: FONT_ACCEPT, multiple: true });
    if (files.length) await addFontFiles(files);
  };

  /** Puts a built-in sound, sticker or overlay at the playhead (the same as the AI's actions). */
  const addLibraryItem = (item: LibraryItem) => {
    const action = item.kind === 'sfx' ? { type: 'addSfx', sound: item.id } : { type: 'addGraphic', graphic: item.id };
    const r = applyAIActions(doc.current(), [action], { playhead: playhead() });
    if (!r.applied) {
      toast.error(t('Could not add {name}', { name: t(item.label) }), r.results[0]?.detail);
      return;
    }
    change(r.project, { label: t('Add {name}', { name: t(item.label) }) });
    const added = r.project.clips.filter((c) => !doc.current().clips.some((o) => o.id === c.id)).map((c) => c.id);
    if (added.length) setSelectionState(added);
  };

  /** Adds color lookup tables from .cube files to the project; returns their ids. */
  const addLutFiles = async (files: File[]): Promise<string[]> => {
    const ids: string[] = [];
    let p = doc.current();
    for (const f of files) {
      try {
        if (f.size > 40 * 1024 * 1024) throw new Error('This LUT is too large.');
        const lut = parseCube(await f.text());
        const id = uid('lut_');
        p = { ...p, luts: [...p.luts, { id, name: fileBaseName(f.name).slice(0, 80) || 'LUT', size: lut.size, data: encodeLut(lut) }] };
        ids.push(id);
      } catch (e) {
        toast.error(t('Could not import {name}', { name: f.name }), t(e instanceof Error ? e.message : String(e)));
      }
    }
    if (ids.length) {
      doc.set(p, { label: t('Import LUT') });
      toast.success(t('Added {count} LUT(s) — choose them under Color grade', { count: ids.length }));
    }
    return ids;
  };
  const importLut = async (): Promise<string[]> => {
    const files = await pickFiles({ accept: '.cube', multiple: true });
    return files.length ? addLutFiles(files) : [];
  };

  /** Lowers an audio clip wherever the other sound is loud (auto ducking); returns what happened. */
  const duckClip = (clipId: string, amount: number) => {
    const r = applyAIActions(doc.current(), [{ type: 'duck', clipId, amount }], { playhead: playhead(), analysis: (id) => analysis.get(id) });
    const res = r.results[0];
    if (res?.ok) {
      change(r.project, { label: t('Auto ducking') });
      toast.success(t('Auto ducking'), res.detail);
    } else toast.info(t('Auto ducking'), res?.detail ?? '');
  };

  /** An adjustment layer from the playhead to the end of the timeline (or 5 s), above all pictures. */
  const addAdjustment = () => {
    const p0 = doc.current();
    const start = playhead();
    const end = timelineDuration(p0);
    const duration = end - start > 0.5 ? end - start : 5;
    const r = findTopVideoTrack(p0, start, start + duration);
    const clip = makeClip('adjustment', r.trackId, start, duration, { name: t('Adjustment layer') });
    change(insertClips(r.project, [clip]), { label: t('Add adjustment layer') });
    setSelectionState([clip.id]);
  };

  const open = async () => {
    const files = await pickFiles({ accept: `.ultima,${MEDIA_ACCEPT},.srt,.vtt,.cube`, multiple: true });
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

  /* -------------------------------- linked folders -------------------------------- */

  const linkFolder = async () => {
    try {
      const folder = await folders.link();
      if (!folder) return;
      if (folder.access !== 'granted') toast.warning(t('Ultima may not read this folder'), folder.name);
      else toast.success(t('Linked {name}', { name: folder.name }), t('{count} files', { count: folders.entries.filter((e) => e.folderId === folder.id).length }));
      setLeftTab('media');
    } catch (error) {
      toast.error(t('Could not link the folder'), error instanceof Error ? error.message : String(error));
    }
  };

  const unlinkFolder = async (id: string) => {
    const folder = folders.folders.find((f) => f.id === id);
    if (!folder) return;
    const ok = await confirmDialog({
      title: t('Unlink {name}?', { name: folder.name }),
      message: t('Its files stay where they are and clips already in the project keep working this session.'),
      confirmLabel: t('Unlink'),
    });
    if (ok) await folders.unlink(id);
  };

  const allowFolder = async (id: string) => {
    if (!(await folders.allow(id))) toast.warning(t('Ultima may not read this folder'));
  };

  /** Adds a file from a linked folder to the project (it keeps its folder id) and, unless 'bin', to the timeline. */
  const addFromFolder = async (entryId: string, where: 'playhead' | 'end' | 'bin' | { time: number; trackId: string | null }) => {
    const p = projectRef.current;
    if (getMedia(p, entryId) && lib.has(entryId)) {
      if (where !== 'bin') addMedia(entryId, where);
      return;
    }
    let file: File;
    try {
      file = await folders.file(entryId);
    } catch (error) {
      toast.error(t('Could not open the file'), error instanceof Error ? error.message : String(error));
      return;
    }
    const place = where === 'bin' ? 'bin' : where === 'playhead' ? { time: playhead(), trackId: null } : where === 'end' ? { time: timelineDuration(p), trackId: null } : where;
    await importFiles([file], place, () => entryId);
  };

  /** Brings the folder files the AI refers to into the project before its edit runs; returns the ids that failed. */
  const importForAI = async (ids: string[]): Promise<string[]> => {
    const wanted = ids.filter((id) => !(getMedia(projectRef.current, id) && lib.has(id)) && folders.get(id));
    if (!wanted.length) return [];
    const files: File[] = [];
    const idOf = new Map<File, string>();
    for (const id of wanted) {
      const f = await folders.file(id).catch(() => null);
      if (!f) continue;
      files.push(f);
      idOf.set(f, id);
    }
    if (files.length) await importFiles(files, 'bin', (f) => idOf.get(f));
    return wanted.filter((id) => !(getMedia(projectRef.current, id) && lib.has(id)));
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
    for (const r of refs) {
      analysis.forget(r.id);
      void analysis.ensure(r);
    }
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

  /** Beat effects: pulses on the beats, bars, hits or loud moments of the sound on the timeline. */
  const applyBeat = (o: BeatSyncOptions) => {
    const r = applyBeatSync(projectRef.current, (id) => analysis.get(id), o);
    if (!r.count) {
      toast.warning(t('Nothing to follow yet.'));
      return;
    }
    change(r.project, { label: t('Beat effects') });
    setSelectionState(r.clipIds);
    toast.success(t('Added on {count} beat(s)', { count: r.count }));
  };

  /** Starts the analysis of the sound on the timeline and waits for it (at most 30 s). */
  const waitForAnalysis = useCallback(async () => {
    const p = projectRef.current;
    const media = p.media.filter((m) => m.kind !== 'image' && m.hasAudio && lib.has(m.id) && p.clips.some((c) => c.mediaId === m.id));
    media.forEach((m) => void analysis.ensure(m));
    await analysis.waitFor(media, 30_000);
  }, [analysis, lib, projectRef]);
  const analysisOf = useCallback((id: string) => analysis.get(id), [analysis]);

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
  /** A speed curve preset (or 'none') on the selected video/audio clips, keeping their length. */
  const setRamp = (preset: RampPreset | 'none') => {
    let p = projectRef.current;
    const done = new Set<string>();
    for (const c of clipsSelected()) {
      if ((c.kind !== 'video' && c.kind !== 'audio') || c.freeze || done.has(c.id)) continue;
      expandLinked(p, [c.id]).forEach((id) => done.add(id));
      const r = setSpeedRamp(p, c.id, preset === 'none' ? undefined : rampPreset(preset, c.duration));
      if (r) p = r.project;
    }
    change(p, { label: preset === 'none' ? t('Remove speed curve') : t('Speed curve') });
  };
  const toggleReverse = () => {
    const sel = clipsSelected().filter((c) => (c.kind === 'video' || c.kind === 'audio') && !c.freeze);
    if (!sel.length) return;
    const on = !sel[0].reverse;
    let p = projectRef.current;
    for (const id of expandLinked(p, sel.map((c) => c.id))) p = updateClip(p, id, (x) => (x.kind === 'video' || x.kind === 'audio' ? { ...x, reverse: on || undefined } : x));
    change(p, { label: t('Reverse') });
  };
  const freezeFrame = () => {
    const now = playhead();
    const clip = clipsSelected().find((c) => c.kind === 'video' && c.start <= now && now < clipEnd(c)) ?? projectRef.current.clips.find((c) => c.kind === 'video' && !c.freeze && c.start <= now && now < clipEnd(c));
    const r = clip ? freezeFrameAt(projectRef.current, clip.id, now, 1) : null;
    if (!r?.id) {
      toast.info(t('Put the playhead over a video clip first.'));
      return;
    }
    change(r.project, { label: t('Freeze frame') });
    setSelectionState([r.id]);
  };
  const resetEffects = () => {
    let p = projectRef.current;
    for (const c of clipsSelected()) if (c.visual) p = updateClip(p, c.id, (x) => ({ ...x, visual: { ...DEFAULT_VISUAL }, keys: undefined, fadeIn: 0, fadeOut: 0, transition: undefined }));
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
      ...(media && !clip.freeze
        ? [
            { label: t('Speed'), submenu: [0.25, 0.5, 1, 1.5, 2, 4].map((v) => ({ label: `${v}×`, onClick: () => setSpeed(v) })) },
            { label: t('Speed curve'), submenu: [{ label: t('None (one speed)'), onClick: () => setRamp('none') }, ...RAMP_PRESETS.map((r) => ({ label: t(r.label), onClick: () => setRamp(r.id) }))] },
            { label: t('Play backwards'), checked: Boolean(clip.reverse), onClick: toggleReverse },
          ]
        : []),
      ...(clip.kind === 'video' ? [{ label: t('Freeze frame at the playhead'), onClick: freezeFrame }] : []),
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
    setRamp,
    toggleReverse,
    freezeFrame,
    addAdjustment,
    importLut: () => void importLut(),
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
    beatEffects: () => setDialog({ kind: 'beats' }),
    writeMeta: () => setDialog({ kind: 'meta' }),
    roughCut: () => setDialog({ kind: 'roughcut' }),
    voiceOver: () => setDialog({ kind: 'speech' }),
    toggleAI: () => useAppStore.getState().toggleAIPanel(),
  };

  /* --------------------------------------- AI --------------------------------------- */

  /** Files in linked folders that are not in the project yet, for the AI (newest first). */
  const folderContext = (p: Project) => {
    if (!folders.folders.length) return undefined;
    const files = folders.entries.filter((e) => !getMedia(p, e.id) && !e.unreadable);
    const listed = files.slice(0, 60);
    // lengths and sizes are read in the background; they show up in the next request
    listed.forEach((e) => folders.ensureInfo(e));
    return {
      names: folders.folders.map((f) => f.name),
      files: listed.map((e) => ({ id: e.id, path: e.path, kind: e.kind, lastModified: e.lastModified, duration: e.duration, width: e.width, height: e.height })),
      total: files.length,
    };
  };

  const aiContext = async ({ images }: { images: boolean }) => {
    let p = projectRef.current;
    const used = p.media.filter((m) => m.kind !== 'image' && lib.has(m.id) && p.clips.some((c) => c.mediaId === m.id));
    await analysis.waitFor(used, images ? 8000 : 5000);
    p = projectRef.current;
    const summary = describeProject(p, {
      playhead: playhead(),
      selection: selectionRef.current,
      fonts: aiFonts(),
      analysis: (id) => analysis.get(id),
      folders: folderContext(p),
    });
    if (!images || !p.clips.length) return { summary };
    const canvas = engine?.canvasElement;
    const image = canvas ? await canvasToAIImage(canvas, { maxSize: 1024 }).catch(() => null) : null;
    // frames from every clip, so the AI sees what the whole timeline shows (not just the playhead)
    const sheets = await clipFrameSheets(p, (media, times, height) => lib.framesAt(media, times, height)).catch(() => null);
    return { summary, image, moreImages: sheets?.images, moreImagesNote: sheets?.note };
  };

  const aiFonts = () => [...new Set(['Inter', ...doc.current().fonts.map((f) => f.family), ...fontsRef.current])];

  const aiApply = async (list: AIAction[]): Promise<AIActionReport> => {
    // leading undo/redo steps act on the history, the rest is one new step
    let undone = 0;
    let i = 0;
    for (; i < list.length && (list[i].type === 'undo' || list[i].type === 'redo'); i++) {
      const steps = Math.max(1, Math.min(20, Math.round(Number(list[i].steps) || 1)));
      for (let k = 0; k < steps; k++) (list[i].type === 'undo' ? doc.undo : doc.redo)();
      undone += steps;
    }
    const rest = list.slice(i);
    // files from linked folders the AI uses come into the project first (keeping their fd_ ids)
    const fromFolders = folderIdsIn(rest);
    const notImported = fromFolders.length ? await importForAI(fromFolders) : [];
    const imported = fromFolders.filter((id) => !notImported.includes(id) && folders.get(id));
    // beat effects follow the analysis of the sound, also of music added in this same step: wait for it
    if (rest.some((a) => a.type === 'beatSync')) {
      const sound = projectRef.current.media.filter((m) => m.kind !== 'image' && m.hasAudio && lib.has(m.id));
      sound.forEach((m) => void analysis.ensure(m));
      await analysis.waitFor(sound, 30_000);
    }
    const r = applyAIActions(projectRef.current, rest, { playhead: playhead(), selection: selectionRef.current, fonts: aiFonts(), analysis: (id) => analysis.get(id) });
    if (r.project !== projectRef.current) doc.set(r.project, { label: t('AI edit') });
    const buttons: { label: string; run: () => void }[] = [];
    for (const e of r.effects) {
      if (e.kind === 'seek') seek(e.time);
      else if (e.kind === 'select') setSelectionState(e.ids);
      else if (e.kind === 'export') setDialog({ kind: 'export', exportKind: e.exportKind, range: e.range, autoStart: true });
      // the AI can't open files itself: it asks, and the user picks them
      else if (e.kind === 'requestImport') buttons.push({ label: t(IMPORT_LABELS[e.what]), run: () => void importRequested(e.what) });
    }
    const failed = r.results.filter((x) => !x.ok).length;
    const exporting = r.effects.some((e) => e.kind === 'export');
    const folder = exporting ? await desktop?.files.exportFolder().catch(() => null) : null;
    const details = [
      undone ? `undo/redo: ${undone} step(s) done` : '',
      imported.length ? `imported from linked folders (same ids): ${imported.join(', ')}` : '',
      notImported.length ? `could not import from linked folders: ${notImported.join(', ')}` : '',
      formatResults(r.results.map((x) => ({ ...x, index: x.index + i }))),
      exporting
        ? folder && !folder.ask
          ? `export: rendering now; the file is saved in the export folder ${folder.path} (no dialog)`
          : desktop
            ? 'export: rendering now; the user picks where to save it (they asked to be asked)'
            : 'export: rendering now; the browser downloads the file'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (!r.applied && !undone) throw new Error(`${t('Nothing could be applied.')}\n${details}`);
    const summary = t('Applied {count} change(s)', { count: r.applied + (undone ? 1 : 0) });
    return { summary: failed ? `${summary} · ${t('{count} skipped', { count: failed })}` : summary, details, partial: failed > 0, buttons };
  };

  /** Opens a file picker for what the AI asked for and imports the files. */
  const importRequested = async (what: ImportWhat) => {
    const accept = { music: 'audio/*,.flac,.m4a,.opus', sfx: 'audio/*,.flac,.m4a,.opus', video: 'video/*,.mkv,.mov', image: 'image/*', font: FONT_ACCEPT, lut: '.cube', any: `${MEDIA_ACCEPT},.cube,${FONT_ACCEPT}` }[what];
    const files = await pickFiles({ accept, multiple: true });
    if (files.length) await importFiles(files, 'bin');
  };

  /** Folder files the AI looked at without using them yet: registered in the library only (not in the project). */
  const looked = useRef(new Map<string, MediaRef>());
  const lookMedia = async (id: string): Promise<MediaRef | null> => {
    const inProject = getMedia(projectRef.current, id);
    if (inProject) return lib.has(id) ? inProject : null;
    const known = looked.current.get(id);
    if (known && lib.has(id)) return known;
    if (!folders.get(id)) return null;
    const ref = await lib.add(await folders.file(id), id);
    looked.current.set(id, ref);
    return ref;
  };

  /**
   * Pictures for the AI's "look" requests: the final picture at timeline times, and frames of source clips
   * (bin or linked folder) — chosen times, an even strip over a range, or an overview with the clip's analysis,
   * optionally zoomed into a part of the picture.
   */
  const aiLook = async (list: AIAction[]) => {
    const images: AIImage[] = [];
    const notes: string[] = [];
    const frames: FrameSource = (media, ts, height) => lib.framesAt(media, ts, height);
    const times = list
      .filter((a) => typeof a.media !== 'string')
      .flatMap((a) => (Array.isArray(a.times) ? a.times : [a.time]))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (times.length) {
      const r = await lookSheet(projectRef.current, times, frames, (id) => lib.get(id)?.image ?? null);
      images.push(...r.images);
      notes.push(r.images.length ? `picture ${images.length}: timeline — ${r.note}` : r.note);
    }
    for (const a of list.filter((x) => typeof x.media === 'string').slice(0, 6)) {
      const id = String(a.media);
      const ref = await lookMedia(id).catch(() => null);
      if (!ref) {
        notes.push(`${id}: no such media item or linked-folder file, or it can't be read`);
        continue;
      }
      const plan = planSourceLook(a, ref.duration);
      const sheet = await sourceLookSheet(ref, plan, frames).catch(() => null);
      let note = sheet ? sheet.note : `${id} "${ref.name}": ${ref.kind === 'audio' ? 'audio, no picture' : 'no frames could be read'}`;
      if (plan.overview && ref.kind !== 'image') {
        await Promise.race([analysis.ensure(ref), new Promise((r) => setTimeout(r, 20_000))]);
        note += `; analysis (source seconds): ${sourceAnalysisSummary(analysis.get(id))}`;
      }
      if (sheet) images.push(sheet.image);
      notes.push(sheet ? `picture ${images.length}: ${note}` : note);
    }
    return { images, note: notes.join(' | ') };
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
    fontList,
    lib,
    libVersion,
    folders,
    folderVersion,
    linkFolder,
    unlinkFolder,
    allowFolder,
    addFromFolder,
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
    addAdjustment,
    importLut,
    duckClip,
    importFont,
    addLibraryItem,
    addCaptionAtPlayhead,
    onAutoCaptions,
    applyCuts,
    applyBeat,
    waitForAnalysis,
    analysisOf,
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
    aiLook,
    applySettings,
    exportCaptions,
    importCaptions,
  };
}
