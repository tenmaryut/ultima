import './i18n';
import './video.css';
import { useEffect, useRef, useState } from 'react';
import { Download, Redo2, Settings2, Sparkles, Undo2 } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel } from '../../components/ai/AIAssistantPanel';
import { SpeechDialog } from '../../components/ai/SpeechDialog';
import { Button, DropdownButton, DropOverlay, IconButton, Spinner } from '../../components/ui';
import { useModuleCommands, useModuleKeydown } from '../../core/commands';
import { useHandoffs } from '../../core/hooks';
import { isMac } from '../../core/platform';
import { useAISettings } from '../../core/ai/settings';
import { useVideoEditor } from './editor';
import { buildMenus } from './menus';
import { parseProject } from './project';
import { captionClips, getClip, timelineDuration } from './model';
import { formatTimecode } from './time';
import { VIDEO_AI_INSTRUCTIONS } from './aiActions';
import { ffmpegReady } from './exporter';
import { Timeline } from './ui/Timeline';
import { Preview } from './ui/Preview';
import { Inspector } from './ui/Inspector';
import { LeftPanel } from './ui/LeftPanel';
import { MediaBin } from './ui/MediaBin';
import { FolderPanel } from './ui/FolderPanel';
import { FolderLibrary } from './folders';
import { GraphicsPanel } from './ui/GraphicsPanel';
import { LibraryPanel } from './ui/LibraryPanel';
import { isLibraryMedia } from './library';
import { CaptionsPanel } from './ui/CaptionsPanel';
import { ExportDialog } from './ui/ExportDialog';
import { ProjectSettingsDialog, RelinkDialog } from './ui/Dialogs';
import { AutoCaptionsDialog, MetaDialog, RoughCutDialog, SilenceDialog } from './ui/AIDialogs';
import { BeatDialog } from './ui/BeatDialog';

/** Native file drag & drop on the whole module (passes the drop position for timeline placement). */
function useFileDropAt(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean, onDrop: (files: File[], x: number, y: number) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onDrop);
  cb.current = onDrop;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) cb.current(files, e.clientX, e.clientY);
    };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  }, [ref, enabled]);
  return dragging;
}

export default function VideoModule({ active }: ModuleProps) {
  const ed = useVideoEditor(active);
  const { t, project, doc, engine, time, actions, selection, dialog } = ed;
  const rootRef = useRef<HTMLDivElement>(null);
  const tools = useAISettings((s) => s.tools);
  const canFfmpeg = ffmpegReady(tools);
  const fps = project.settings.fps;
  const duration = timelineDuration(project);

  const dragging = useFileDropAt(rootRef, active, (files, x, y) => {
    const target = ed.timelineApi.current?.dropTarget(x, y);
    void ed.importFiles(files, target ?? 'auto');
  });

  useHandoffs('video', (items) => {
    for (const item of items) {
      if (item.kind === 'files' && item.files?.length) void ed.importFiles(item.files, item.place === 'playhead' ? { time: ed.time.get(), trackId: null, freeTrack: true } : 'auto');
      else if (item.kind === 'image' && item.image) {
        void fetch(item.image)
          .then((r) => r.blob())
          .then((b) => ed.importFiles([new File([b], `${item.title ?? 'image'}.${b.type.includes('jpeg') ? 'jpg' : 'png'}`, { type: b.type || 'image/png' })], 'auto'))
          .catch(() => undefined);
      } else if (item.kind === 'json' && item.json) {
        try {
          const p = parseProject(item.json);
          const file = new File([JSON.stringify(item.json)], `${p.name}.ultima`, { type: 'application/json' });
          void ed.importFiles([file]);
        } catch {
          // not a video project
        }
      } else if (item.kind === 'text' && item.text) {
        ed.addTitle('basic', undefined, undefined, item.text);
      }
    }
  });

  useModuleCommands('video', {
    new: actions.newProject,
    open: actions.open,
    save: () => actions.save(false),
    'save-as': () => actions.save(true),
    export: () => actions.exportDialog('mp4'),
    undo: doc.undo,
    redo: doc.redo,
    delete: () => ed.deleteSelection(ed.shiftRef.current),
    duplicate: () => ed.duplicate(),
    'select-all': actions.selectAll,
    deselect: actions.deselect,
    'zoom-in': actions.zoomIn,
    'zoom-out': actions.zoomOut,
    'zoom-fit': actions.zoomFit,
    'zoom-100': () => ed.setPreviewZoom(ed.previewZoom === 1 ? 'fit' : 1),
  });

  useModuleKeydown(active && !dialog, (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return; // sliders, checkboxes
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (e.key === ' ') {
      e.preventDefault();
      engine?.toggle();
      return;
    }
    if (mod && !e.altKey) {
      const map: Record<string, () => void> = { c: actions.copy, x: actions.cut, v: actions.paste, k: actions.split };
      if (map[key]) {
        e.preventDefault();
        map[key]();
      }
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const handlers: Record<string, () => void> = {
      j: () => engine?.shuttle('j'),
      k: () => engine?.shuttle('k'),
      l: () => engine?.shuttle('l'),
      arrowleft: () => engine?.step(e.shiftKey ? -fps : -1),
      arrowright: () => engine?.step(e.shiftKey ? fps : 1),
      arrowup: actions.prevEdit,
      arrowdown: actions.nextEdit,
      home: actions.goStart,
      end: actions.goEnd,
      s: actions.split,
      m: actions.addMarker,
      i: actions.setIn,
      o: actions.setOut,
      v: () => ed.setTool('select'),
      c: () => ed.setTool('razor'),
      n: actions.toggleSnapping,
    };
    const h = handlers[key];
    if (h) {
      e.preventDefault();
      h();
    }
  });

  const selectedClips = selection.map((id) => getClip(project, id)).filter(Boolean);
  const menus = buildMenus(t, actions, {
    canUndo: doc.canUndo,
    canRedo: doc.canRedo,
    hasSelection: selection.length > 0,
    hasClipboard: ed.hasClipboard,
    snapping: ed.snapping,
    safe: ed.safe,
    loop: ed.loop,
    previewZoom: ed.previewZoom,
    canFfmpeg,
    hasCaptions: captionClips(project, true).length > 0,
    visualSelected: selectedClips.some((c) => c && (c.kind === 'video' || c.kind === 'image' || c.kind === 'title')),
    mediaSelected: selectedClips.some((c) => c && (c.kind === 'video' || c.kind === 'audio')),
    missingMedia: project.media.some((m) => !ed.lib.has(m.id) && !isLibraryMedia(m.id)),
  });
  const aiTools = menus[menus.length - 1].entries;

  const leftContent =
    ed.leftTab === 'media' ? (
      <MediaBin
        project={project}
        lib={ed.lib}
        libVersion={ed.libVersion}
        canConvert={canFfmpeg}
        onImport={actions.importMedia}
        onAdd={(id, where) => ed.addMedia(id, where)}
        onRemove={(id) => void ed.removeMediaItem(id)}
        onRelink={actions.relink}
        onConvert={(id) => void ed.convertMedia(id)}
        folders={
          FolderLibrary.supported() ? (
            <FolderPanel
              folders={ed.folders}
              folderVersion={ed.folderVersion}
              inProject={new Set(project.media.map((m) => m.id))}
              onLink={() => void ed.linkFolder()}
              onUnlink={(id) => void ed.unlinkFolder(id)}
              onAllow={(id) => void ed.allowFolder(id)}
              onRefresh={() => void ed.folders.refresh()}
              onAdd={(id, where) => void ed.addFromFolder(id, where)}
            />
          ) : undefined
        }
      />
    ) : ed.leftTab === 'graphics' ? (
      <GraphicsPanel onAdd={(id) => ed.addTitle(id)} onAddAdjustment={ed.addAdjustment} onImportFont={() => void ed.importFont()} />
    ) : ed.leftTab === 'library' ? (
      <LibraryPanel onAdd={ed.addLibraryItem} />
    ) : (
      <CaptionsPanel
        project={project}
        time={time}
        fonts={ed.fontList}
        selection={selection}
        setSelection={ed.setSelection}
        change={ed.change}
        commit={ed.commit}
        seek={ed.seek}
        onAutoCaptions={actions.autoCaptions}
        onAdd={ed.addCaptionAtPlayhead}
        onImport={actions.importCaptions}
        onExport={actions.exportCaptions}
      />
    );

  return (
    <div ref={rootRef} className="vd-root">
      <ModuleLayout
        moduleId="video"
        title={project.name}
        dirty={ed.dirty}
        menus={menus}
        toolbar={
          <>
            <Button size="sm" variant="ghost" icon={Settings2} onClick={actions.projectSettings} title={t('Project settings')}>
              {project.settings.width}×{project.settings.height} · {fps} fps
            </Button>
            <IconButton icon={Undo2} label={`${t('Undo')} (Ctrl+Z)`} disabled={!doc.canUndo} onClick={doc.undo} />
            <IconButton icon={Redo2} label={`${t('Redo')} (Ctrl+Shift+Z)`} disabled={!doc.canRedo} onClick={doc.redo} />
            <span className="vsep" />
            <DropdownButton className="btn sm ghost" entries={aiTools}>
              <Sparkles size={13} /> {t('AI tools')}
            </DropdownButton>
          </>
        }
        actions={
          <Button variant="primary" size="sm" icon={Download} onClick={() => actions.exportDialog('mp4')} disabled={ed.exporting}>
            {t('Export')}
          </Button>
        }
        left={
          <LeftPanel tab={ed.leftTab} setTab={ed.setLeftTab}>
            {leftContent}
          </LeftPanel>
        }
        right={
          <Inspector
            project={project}
            time={time}
            selection={selection}
            fonts={ed.fontList}
            change={ed.change}
            commit={ed.commit}
            onOpenSettings={actions.projectSettings}
            onImportLut={ed.importLut}
            onDuck={ed.duckClip}
            onLink={actions.link}
            onUnlink={actions.unlink}
            onSeek={ed.seek}
            onRenameMarker={(id) => void ed.renameMarker(id)}
          />
        }
        bottom={
          <Timeline
            project={project}
            lib={ed.lib}
            libVersion={ed.libVersion}
            time={time}
            playing={ed.play.playing}
            selection={selection}
            setSelection={ed.setSelection}
            tool={ed.tool}
            setTool={ed.setTool}
            snapping={ed.snapping}
            setSnapping={ed.setSnapping}
            pps={ed.pps}
            setPps={ed.setPps}
            change={ed.change}
            commit={ed.commit}
            seek={ed.seek}
            cutRanges={ed.cutRanges}
            onDropMedia={(id, at, trackId) => ed.addMedia(id, { time: at, trackId })}
            onDropTitle={(id, at, trackId) => ed.addTitle(id, at, trackId)}
            onDropFolder={(id, at, trackId) => void ed.addFromFolder(id, { time: at, trackId })}
            actions={{
              split: actions.split,
              rippleDelete: () => actions.deleteSelection(true),
              deleteSelection: () => actions.deleteSelection(false),
              link: actions.link,
              unlink: actions.unlink,
              addMarker: actions.addMarker,
              setIn: actions.setIn,
              setOut: actions.setOut,
              addTrack: actions.addTrack,
            }}
            clipMenu={ed.clipMenu}
            trackMenu={ed.trackMenu}
            markerMenu={ed.markerMenu}
            onRenameMarker={(id) => void ed.renameMarker(id)}
            onPatchTrack={ed.patchTrack}
            apiRef={ed.timelineApi}
          />
        }
        bottomHeight={300}
        resizableBottom
        status={
          <>
            <span>
              {project.settings.width}×{project.settings.height} · {fps} fps
            </span>
            <span>{t('{count} clips', { count: project.clips.length })}</span>
            <span>
              {t('Duration')} {formatTimecode(duration, fps)}
            </span>
            {selection.length > 0 && <span>{t('{count} selected', { count: selection.length })}</span>}
            {ed.importing > 0 && (
              <span className="row" style={{ gap: 6 }}>
                <Spinner size={10} /> {t('Importing {count} file(s)…', { count: ed.importing })}
              </span>
            )}
            <span className="spacer" />
            <span>{ed.tool === 'razor' ? t('Razor: click a clip to cut it (V for the selection tool)') : t('Drag clips to move · drag edges to trim · S splits at the playhead')}</span>
          </>
        }
        ai={
          <AIAssistantPanel
            moduleId="video"
            moduleName="Video Editor"
            instructions={VIDEO_AI_INSTRUCTIONS}
            getContext={ed.aiContext}
            onActions={ed.aiApply}
            onLook={ed.aiLook}
            suggestions={[t('Add a title “My Trip” over the first 3 seconds'), t('Add cross dissolves between all clips'), t('Make the selected clip black and white'), t('Fade the music out at the end')]}
            placeholder={t('Ask the AI to edit your video…')}
            canSnapshot
            snapshotLabel={t('The current frame and frames from every clip are sent with your request')}
          />
        }
      >
        <Preview
          engine={engine}
          project={project}
          time={time}
          playing={ed.play.playing}
          rate={ed.play.rate}
          loop={ed.loop}
          setLoop={ed.setLoop}
          safe={ed.safe}
          setSafe={ed.setSafe}
          zoom={ed.previewZoom}
          setZoom={ed.setPreviewZoom}
          selection={selection}
          setSelection={ed.setSelection}
          change={ed.change}
          commit={ed.commit}
          onImport={actions.importMedia}
          onExportFrame={() => actions.exportDialog('png')}
          onTogglePlay={() => engine?.toggle()}
          onSeek={ed.seek}
          onStep={(n) => engine?.step(n)}
        />
      </ModuleLayout>
      <DropOverlay show={dragging} label={t('Drop to import — drop on the timeline to place it there')} />
      {dialog?.kind === 'export' && (
        <ExportDialog project={project} lib={ed.lib} time={time} initialKind={dialog.exportKind} onClose={() => ed.setDialog(null)} onBusy={ed.setExporting} />
      )}
      {dialog?.kind === 'settings' && <ProjectSettingsDialog project={project} onApply={ed.applySettings} onClose={() => ed.setDialog(null)} />}
      {dialog?.kind === 'relink' && <RelinkDialog project={project} lib={ed.lib} onRelinked={ed.onRelinked} onClose={() => ed.setDialog(null)} />}
      {dialog?.kind === 'autocaptions' && <AutoCaptionsDialog project={project} lib={ed.lib} onDone={ed.onAutoCaptions} onClose={() => ed.setDialog(null)} />}
      {dialog?.kind === 'beats' && (
        <BeatDialog project={project} selection={ed.selection} analysis={ed.analysisOf} waitForAnalysis={ed.waitForAnalysis} onApply={ed.applyBeat} onClose={() => ed.setDialog(null)} />
      )}
      {dialog?.kind === 'silence' && (
        <SilenceDialog project={project} lib={ed.lib} onPreview={ed.setCutRanges} onApply={(r) => ed.applyCuts(r, t('Remove silences'))} onClose={() => ed.setDialog(null)} />
      )}
      {dialog?.kind === 'meta' && <MetaDialog project={project} onAddMarkers={ed.addChapterMarkers} onClose={() => ed.setDialog(null)} />}
      {dialog?.kind === 'roughcut' && (
        <RoughCutDialog project={project} onPreview={ed.setCutRanges} onApply={(r) => ed.applyCuts(r, t('Rough cut'))} onClose={() => ed.setDialog(null)} />
      )}
      {dialog?.kind === 'speech' && (
        <SpeechDialog
          title={t('Voice-over from text')}
          confirmLabel={t('Add to timeline')}
          hint={t('The voice-over is placed at the playhead on a free audio track.')}
          onInsert={(file) => ed.importFiles([file], { time: ed.time.get(), trackId: null, freeTrack: true })}
          onClose={() => ed.setDialog(null)}
        />
      )}
    </div>
  );
}
