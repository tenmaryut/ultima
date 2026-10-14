/**
 * Menu definitions (header menu bar and the waveform context menu).
 */
import {
  ArrowLeftRight,
  AudioLines,
  Bookmark,
  Captions,
  ClipboardPaste,
  Copy,
  Crop,
  Download,
  FileText,
  Flag,
  FolderOpen,
  Gauge,
  Mic,
  Music,
  Save,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Redo2,
  VolumeX,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { t } from '../../../core/i18n';
import { isMac } from '../../../core/platform';
import { promptDialog, type MenuEntry } from '../../../components/ui';
import { EFFECTS, getEffect, type EffectCategory, type EffectId } from '../dsp/effects';
import { audio } from '../controller';
import { setUI, ui } from '../state';
import { applyEffect, captureNoisePrint, clearNoisePrint } from '../ops';
import { exportMarkers, newDocument, pickAndOpen, saveProject } from '../files';
import { canTranscribe, exportTranscript, summarizeTranscript, transcribe } from '../transcript';
import { mt } from '../mt';

const mod = isMac ? '⌘' : 'Ctrl+';

/** Opens the effect dialog, or applies parameter-less effects immediately. */
export function openEffect(id: EffectId): void {
  if (!audio.length) return;
  if (getEffect(id).instant) void applyEffect(id, {});
  else setUI({ dialog: { kind: 'effect', effect: id } });
}

export async function promptInsertSilence(): Promise<void> {
  const value = await promptDialog({ title: t('Insert silence'), message: t('Duration in seconds'), defaultValue: '1', confirmLabel: t('Insert') });
  if (value === null) return;
  const seconds = parseFloat(value.replace(',', '.'));
  if (Number.isFinite(seconds) && seconds > 0) audio.insertSilence(seconds);
}

const CATEGORIES: { id: EffectCategory; label: string }[] = [
  { id: 'amplitude', label: 'Amplitude' },
  { id: 'filter', label: 'Filter & EQ' },
  { id: 'dynamics', label: 'Dynamics' },
  { id: 'time', label: 'Time & Pitch' },
  { id: 'space', label: 'Delay & Reverb' },
  { id: 'channels', label: 'Channels' },
  { id: 'restoration', label: 'Restoration' },
];

function effectEntries(disabled: boolean): MenuEntry[] {
  return CATEGORIES.map((cat) => ({
    label: t(cat.label),
    submenu: [
      ...EFFECTS.filter((e) => e.category === cat.id).map((e) => ({
        label: e.instant ? t(e.name) : `${t(e.name)}…`,
        disabled,
        onClick: () => openEffect(e.id),
      })),
      ...(cat.id === 'restoration'
        ? ([
            { type: 'separator' },
            { label: t('Capture noise print'), shortcut: 'Shift+P', disabled: !audio.selection(), onClick: () => captureNoisePrint() },
            { label: t('Clear noise print'), disabled: !ui().noisePrint, onClick: () => clearNoisePrint() },
            { label: `${t('Remove silence')}…`, disabled, onClick: () => setUI({ dialog: { kind: 'removeSilence' } }) },
          ] as MenuEntry[])
        : []),
    ],
  }));
}

export function fileMenu(): MenuEntry[] {
  const has = audio.length > 0;
  return [
    { label: `${t('New audio file')}…`, shortcut: `${mod}N`, onClick: () => setUI({ dialog: { kind: 'newFile' } }) },
    { label: `${t('Open')}…`, icon: FolderOpen, shortcut: `${mod}O`, onClick: () => void pickAndOpen() },
    { type: 'separator' },
    { label: t('Save project'), icon: Save, shortcut: `${mod}S`, onClick: () => void saveProject(false) },
    { label: `${t('Save project as')}…`, shortcut: `${mod}Shift+S`, onClick: () => void saveProject(true) },
    { type: 'separator' },
    { label: `${t('Export audio')}…`, icon: Download, shortcut: `${mod}E`, disabled: !has, onClick: () => setUI({ dialog: { kind: 'export' } }) },
    { label: `${t('Export selection')}…`, disabled: !audio.selection(), onClick: () => setUI({ dialog: { kind: 'export', selectionOnly: true } }) },
    { label: `${t('Export multitrack mix')}…`, disabled: !mt.length, onClick: () => setUI({ dialog: { kind: 'export', multitrack: true } }) },
    {
      label: t('Export markers'),
      icon: Flag,
      disabled: !audio.doc.markers.length,
      submenu: [
        { label: t('Text list (.txt)'), onClick: () => void exportMarkers('txt') },
        { label: t('Spreadsheet (.csv)'), onClick: () => void exportMarkers('csv') },
        { label: t('YouTube chapters'), onClick: () => void exportMarkers('chapters') },
      ],
    },
    {
      label: t('Export transcript'),
      icon: Captions,
      disabled: !audio.doc.transcript.length,
      submenu: [
        { label: t('Text (.txt)'), onClick: () => void exportTranscript('txt') },
        { label: t('Subtitles (.srt)'), onClick: () => void exportTranscript('srt') },
        { label: t('WebVTT (.vtt)'), onClick: () => void exportTranscript('vtt') },
      ],
    },
    { type: 'separator' },
    { label: `${t('Record')}…`, icon: Mic, onClick: () => setUI({ dialog: { kind: 'record' } }) },
  ];
}

export function editMenu(): MenuEntry[] {
  const has = audio.length > 0;
  const sel = Boolean(audio.selection());
  return [
    { label: t('Undo'), icon: Undo2, shortcut: `${mod}Z`, disabled: !audio.doc.canUndo, onClick: () => audio.undo() },
    { label: t('Redo'), icon: Redo2, shortcut: isMac ? '⌘Shift+Z' : 'Ctrl+Y', disabled: !audio.doc.canRedo, onClick: () => audio.redo() },
    { type: 'separator' },
    { label: t('Cut'), icon: Scissors, shortcut: `${mod}X`, disabled: !sel, onClick: () => audio.cut() },
    { label: t('Copy'), icon: Copy, shortcut: `${mod}C`, disabled: !sel, onClick: () => audio.copy() },
    { label: t('Paste'), icon: ClipboardPaste, shortcut: `${mod}V`, disabled: !audio.clipboard, onClick: () => audio.paste() },
    { label: t('Mix paste (overlay)'), shortcut: `${mod}Shift+V`, disabled: !audio.clipboard, onClick: () => audio.pasteMix() },
    { label: t('Delete'), icon: Trash2, shortcut: 'Del', disabled: !sel, onClick: () => audio.deleteSelection() },
    { label: t('Duplicate selection'), shortcut: `${mod}D`, disabled: !sel, onClick: () => audio.duplicateSelection() },
    { type: 'separator' },
    { label: t('Trim to selection (crop)'), icon: Crop, disabled: !sel, onClick: () => audio.cropToSelection() },
    { label: t('Silence selection'), icon: VolumeX, disabled: !sel, onClick: () => audio.silenceSelection() },
    { label: `${t('Insert silence')}…`, disabled: !audio.hasAudio, onClick: () => void promptInsertSilence() },
    { type: 'separator' },
    { label: t('Select all'), shortcut: `${mod}A`, disabled: !has, onClick: () => audio.selectAll() },
    { label: t('Deselect'), shortcut: `${mod}Shift+A`, disabled: !sel, onClick: () => audio.setSelection(null) },
    { type: 'separator' },
    { label: `${t('Convert sample rate')}…`, disabled: !has, onClick: () => setUI({ dialog: { kind: 'resample' } }) },
  ];
}

export function effectsMenu(): MenuEntry[] {
  const disabled = !audio.length;
  return [
    { label: `${t('Auto Clean Voice')}…`, icon: WandSparkles, disabled, onClick: () => openEffect('autoClean') },
    { label: `${t('Noise Reduction')}…`, icon: AudioLines, disabled, onClick: () => openEffect('noiseReduction') },
    { type: 'separator' },
    ...effectEntries(disabled),
  ];
}

export function generateMenu(): MenuEntry[] {
  return [
    { label: `${t('Tone')}…`, icon: Music, onClick: () => setUI({ dialog: { kind: 'generate', generator: 'tone' } }) },
    { label: `${t('Noise')}…`, onClick: () => setUI({ dialog: { kind: 'generate', generator: 'noise' } }) },
    { label: `${t('Silence')}…`, onClick: () => setUI({ dialog: { kind: 'generate', generator: 'silence' } }) },
    { label: `${t('DTMF tones')}…`, onClick: () => setUI({ dialog: { kind: 'generate', generator: 'dtmf' } }) },
    { type: 'separator' },
    { label: t('Speech from text…'), icon: AudioLines, onClick: () => setUI({ dialog: { kind: 'speech' } }) },
  ];
}

export function viewMenu(): MenuEntry[] {
  const s = ui();
  return [
    { label: t('Zoom in'), icon: ZoomIn, shortcut: `${mod}=`, onClick: () => audio.zoomBy(2) },
    { label: t('Zoom out'), icon: ZoomOut, shortcut: `${mod}-`, onClick: () => audio.zoomBy(0.5) },
    { label: t('Zoom to selection'), shortcut: `${mod}1`, disabled: !audio.selection(), onClick: () => audio.zoomToSelection() },
    { label: t('Zoom out full'), shortcut: `${mod}0`, onClick: () => audio.zoomFit() },
    { type: 'separator' },
    { label: t('Spectral frequency display'), icon: Gauge, checked: s.spectral, onClick: () => setUI({ spectral: !s.spectral }) },
    { label: t('Logarithmic frequency scale'), checked: s.spectralLog, onClick: () => setUI({ spectralLog: !s.spectralLog }) },
    { type: 'separator' },
    { label: t('Follow playback'), checked: s.follow, onClick: () => setUI({ follow: !s.follow }) },
    { label: t('Loop playback'), shortcut: 'L', checked: s.loop, onClick: () => audio.toggleLoop() },
    { type: 'separator' },
    { label: t('Waveform'), checked: s.tab === 'waveform', onClick: () => setUI({ tab: 'waveform' }) },
    { label: t('Multitrack'), checked: s.tab === 'multitrack', onClick: () => setUI({ tab: 'multitrack' }) },
  ];
}

export function markersMenu(): MenuEntry[] {
  const has = audio.doc.markers.length > 0;
  return [
    { label: t('Add marker'), icon: Bookmark, shortcut: 'M', disabled: !audio.length, onClick: () => audio.addMarker() },
    { label: t('Previous marker'), shortcut: '[', disabled: !has, onClick: () => audio.jumpToMarker(-1) },
    { label: t('Next marker'), shortcut: ']', disabled: !has, onClick: () => audio.jumpToMarker(1) },
    { type: 'separator' },
    { label: t('Clear all markers'), disabled: !has, onClick: () => audio.clearMarkers() },
  ];
}

export function aiMenu(): MenuEntry[] {
  const has = audio.length > 0;
  const transcript = audio.doc.transcript.length > 0;
  return [
    { label: t('Transcribe'), icon: FileText, disabled: !has || !canTranscribe(), onClick: () => void transcribe('all') },
    { label: t('Transcribe selection'), disabled: !audio.selection() || !canTranscribe(), onClick: () => void transcribe('selection') },
    { type: 'separator' },
    { label: t('Summarize transcript'), icon: Sparkles, disabled: !transcript, onClick: () => void summarizeTranscript('summary') },
    { label: t('Write show notes'), disabled: !transcript, onClick: () => void summarizeTranscript('shownotes') },
    ...(canTranscribe() ? [] : ([{ type: 'separator' }, { type: 'heading', label: t('Transcription needs the desktop app') }] as MenuEntry[])),
  ];
}

export function buildContextMenu(at: number): MenuEntry[] {
  const sel = Boolean(audio.selection());
  return [
    { label: t('Cut'), icon: Scissors, disabled: !sel, onClick: () => audio.cut() },
    { label: t('Copy'), icon: Copy, disabled: !sel, onClick: () => audio.copy() },
    { label: t('Paste'), icon: ClipboardPaste, disabled: !audio.clipboard, onClick: () => audio.paste() },
    { label: t('Mix paste (overlay)'), disabled: !audio.clipboard, onClick: () => audio.pasteMix() },
    { label: t('Delete'), icon: Trash2, disabled: !sel, onClick: () => audio.deleteSelection() },
    { type: 'separator' },
    { label: t('Trim to selection (crop)'), icon: Crop, disabled: !sel, onClick: () => audio.cropToSelection() },
    { label: t('Silence selection'), icon: VolumeX, disabled: !sel, onClick: () => audio.silenceSelection() },
    { label: t('Zoom to selection'), disabled: !sel, onClick: () => audio.zoomToSelection() },
    { type: 'separator' },
    { label: t('Add marker here'), icon: Bookmark, onClick: () => audio.addMarker(at) },
    { label: t('Capture noise print'), disabled: !sel, onClick: () => captureNoisePrint() },
    { type: 'separator' },
    { label: t('Effects'), icon: SlidersHorizontal, submenu: effectEntries(false) },
    { label: t('Swap channels'), icon: ArrowLeftRight, disabled: audio.doc.channels.length < 2, onClick: () => openEffect('swapChannels') },
    { label: t('Select all'), onClick: () => audio.selectAll() },
  ];
}

export function startNew(sampleRate: number, channels: number): void {
  void newDocument(sampleRate, channels);
}
