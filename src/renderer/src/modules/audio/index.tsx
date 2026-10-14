import './i18n';
import './audio.css';
import { useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { useT } from '../../core/i18n';
import { useModuleCommands, useModuleKeydown } from '../../core/commands';
import { useFileDrop, useHandoffs } from '../../core/hooks';
import { isMac } from '../../core/platform';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel } from '../../components/ai/AIAssistantPanel';
import { Button, DropOverlay } from '../../components/ui';
import { audio } from './controller';
import { mt } from './mt';
import { setUI, ui, useAudioUI } from './state';
import { openFiles, pickAndOpen, saveProject } from './files';
import { captureNoisePrint } from './ops';
import { AUDIO_AI_INSTRUCTIONS, applyAIActions, buildAIContext } from './ai';
import { WaveformView } from './ui/WaveformView';
import { MultitrackView } from './ui/MultitrackView';
import { Transport } from './ui/Transport';
import { AudioDialogs, BusyOverlay, StatusBar, Toolbar } from './ui/chrome';
import { FileInfoPanel, HistoryPanel, MarkersPanel, QuickEffectsPanel, StatsPanel } from './ui/panels';
import { TranscriptPanel } from './ui/TranscriptPanel';
import { aiMenu, editMenu, effectsMenu, fileMenu, generateMenu, markersMenu, viewMenu } from './ui/menus';

export default function AudioModule({ active }: ModuleProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const tab = useAudioUI((s) => s.tab);
  const docName = useAudioUI((s) => s.docName);
  useAudioUI((s) => s.revision);
  useAudioUI((s) => s.savedTick);
  useAudioUI((s) => s.mtRevision);
  const hasAudio = audio.length > 0;
  const wave = tab === 'waveform';

  useHandoffs('audio', (items) => {
    const files = items.flatMap((item) => (item.kind === 'files' ? (item.files ?? []) : []));
    if (files.length) void openFiles(files);
  });

  const dragging = useFileDrop(rootRef, (files) => void openFiles(files), active);

  // stop playback when leaving the module
  useEffect(() => {
    if (!active && ui().playing) audio.stop();
  }, [active]);

  useModuleCommands('audio', {
    new: () => setUI({ dialog: { kind: 'newFile' } }),
    open: () => void pickAndOpen(),
    save: () => void saveProject(false),
    'save-as': () => void saveProject(true),
    export: () => setUI({ dialog: { kind: 'export', multitrack: !wave && mt.length > 0 } }),
    undo: () => (wave ? audio.undo() : mt.undo()),
    redo: () => (wave ? audio.redo() : mt.redo()),
    delete: () => {
      if (wave) audio.deleteSelection();
      else mt.deleteSelectedClip();
    },
    duplicate: () => {
      if (wave) audio.duplicateSelection();
      else mt.duplicateSelectedClip();
    },
    'select-all': () => audio.selectAll(),
    deselect: () => audio.setSelection(null),
    'zoom-in': () => (wave ? audio.zoomBy(2) : mt.zoomBy(2)),
    'zoom-out': () => (wave ? audio.zoomBy(0.5) : mt.zoomBy(0.5)),
    'zoom-fit': () => (wave ? audio.zoomFit() : mt.fit()),
    'zoom-100': () => (wave ? audio.zoomToSelection() : mt.fit()),
  });

  useModuleKeydown(active, (e) => {
    const s = ui();
    if (s.dialog || s.busy) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key;
    if (e.code === 'Space' && !mod) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (!wave) mt.togglePlay();
      else if (e.shiftKey) {
        if (s.playing) audio.stop();
        void audio.play({ ignoreSelection: true });
      } else audio.togglePlay();
      return;
    }
    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (!wave) return;
      if (k === 'x') audio.cut();
      else if (k === 'c') audio.copy();
      else if (k === 'v') {
        if (e.shiftKey) audio.pasteMix();
        else audio.paste();
      } else if (k === 'a' && !e.shiftKey) audio.selectAll();
      else return;
      e.preventDefault();
      return;
    }
    if (mod || e.altKey) return;
    if (!wave) {
      if (key === 's' || key === 'S') mt.splitAtPlayhead();
      else if (key === 'Home') {
        mt.playhead = 0;
        mt.bump();
      }
      return;
    }
    const span = audio.viewWidth * s.view.spp;
    switch (key) {
      case 'm':
      case 'M':
        audio.addMarker();
        break;
      case 'l':
      case 'L':
        audio.toggleLoop();
        break;
      case 'P':
        if (e.shiftKey) captureNoisePrint();
        break;
      case '[':
        audio.jumpToMarker(-1);
        break;
      case ']':
        audio.jumpToMarker(1);
        break;
      case 'Home':
        audio.seek(0);
        break;
      case 'End':
        audio.seek(audio.length);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        audio.nudge(((key === 'ArrowLeft' ? -1 : 1) * span) / 100 / audio.sampleRate, e.shiftKey);
        break;
      case 'Escape':
        if (s.playing) audio.stop();
        else audio.setSelection(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  const right = wave ? (
    <>
      <QuickEffectsPanel />
      <MarkersPanel />
      <TranscriptPanel />
      <StatsPanel />
      <FileInfoPanel />
      <HistoryPanel />
    </>
  ) : undefined;

  return (
    <div ref={rootRef} className="au-root">
      <ModuleLayout
        moduleId="audio"
        title={docName || t('Untitled')}
        dirty={(audio.doc.dirty && hasAudio) || mt.dirty}
        menus={[
          { label: t('File'), entries: fileMenu },
          { label: t('Edit'), entries: editMenu },
          { label: t('Effects'), entries: effectsMenu },
          { label: t('Generate'), entries: generateMenu },
          { label: t('Markers'), entries: markersMenu },
          { label: t('View'), entries: viewMenu },
          { label: t('AI'), entries: aiMenu },
        ]}
        toolbar={<Toolbar />}
        actions={
          <Button size="sm" variant="primary" icon={Download} disabled={wave ? !hasAudio : !mt.length} onClick={() => setUI({ dialog: { kind: 'export', multitrack: !wave } })}>
            {t('Export')}
          </Button>
        }
        right={right}
        bottom={<Transport active={active} />}
        bottomHeight={58}
        status={<StatusBar />}
        ai={
          <AIAssistantPanel
            moduleId="audio"
            moduleName="Audio Editor"
            instructions={AUDIO_AI_INSTRUCTIONS}
            getContext={buildAIContext}
            onActions={applyAIActions}
            suggestions={[t('Clean up this voice recording'), t('Remove the long pauses'), t('Make it -16 LUFS for a podcast'), t('Fade out the last 3 seconds')]}
            placeholder={t('Ask the AI to edit the audio…')}
          />
        }
      >
        {wave ? <WaveformView active={active && wave} /> : <MultitrackView active={active && !wave} />}
        <DropOverlay show={dragging} label={wave ? t('Drop audio or video files to open them') : t('Drop audio files to add them as tracks')} />
        <BusyOverlay />
      </ModuleLayout>
      <AudioDialogs />
    </div>
  );
}
