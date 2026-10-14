import {
  ArrowLeftToLine,
  AudioLines,
  Captions,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  FileDown,
  FilePlus,
  Film,
  Flag,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  Music,
  Redo2,
  Save,
  Scissors,
  Settings2,
  Smartphone,
  Sparkles,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
  Unlink2,
  Upload,
  Wand2,
} from 'lucide-react';
import type { MenuEntry } from '../../components/ui';
import type { TFunction } from '../../core/i18n';
import type { TrackKind, TransitionKind } from './types';
import type { ExportKind } from './ui/ExportDialog';
import type { PreviewZoom } from './ui/Preview';
import { TRANSITIONS } from './presets';

export interface VideoActions {
  newProject: () => void;
  open: () => void;
  importMedia: () => void;
  save: (as: boolean) => void;
  exportDialog: (kind: ExportKind) => void;
  importCaptions: () => void;
  exportCaptions: (fmt: 'srt' | 'vtt') => void;
  relink: () => void;
  projectSettings: () => void;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  deleteSelection: (ripple: boolean) => void;
  selectAll: () => void;
  deselect: () => void;
  split: () => void;
  link: () => void;
  unlink: () => void;
  setTransition: (kind: TransitionKind | 'none') => void;
  setSpeed: (speed: number) => void;
  resetEffects: () => void;
  renameClip: () => void;
  addTrack: (kind: TrackKind) => void;
  addMarker: () => void;
  setIn: () => void;
  setOut: () => void;
  clearInOut: () => void;
  toggleSnapping: () => void;
  goStart: () => void;
  goEnd: () => void;
  prevEdit: () => void;
  nextEdit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  toggleSafe: () => void;
  toggleLoop: () => void;
  setPreviewZoom: (z: PreviewZoom) => void;
  autoCaptions: () => void;
  removeSilences: () => void;
  writeMeta: () => void;
  roughCut: () => void;
  voiceOver: () => void;
  toggleAI: () => void;
}

export interface MenuState {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  snapping: boolean;
  safe: boolean;
  loop: boolean;
  previewZoom: PreviewZoom;
  canFfmpeg: boolean;
  hasCaptions: boolean;
  visualSelected: boolean;
  mediaSelected: boolean;
  missingMedia: boolean;
}

export function buildMenus(t: TFunction, a: VideoActions, s: MenuState): { label: string; entries: () => MenuEntry[] }[] {
  return [
    {
      label: t('File'),
      entries: () => [
        { label: t('New project'), icon: FilePlus, shortcut: 'Ctrl+N', onClick: a.newProject },
        { label: t('Open…'), icon: FolderOpen, shortcut: 'Ctrl+O', onClick: a.open },
        { label: t('Import media…'), icon: Upload, onClick: a.importMedia },
        { type: 'separator' },
        { label: t('Save project'), icon: Save, shortcut: 'Ctrl+S', onClick: () => a.save(false) },
        { label: t('Save project as…'), shortcut: 'Ctrl+Shift+S', onClick: () => a.save(true) },
        { type: 'separator' },
        { label: t('Export video…'), icon: Download, shortcut: 'Ctrl+E', onClick: () => a.exportDialog('mp4') },
        { label: t('Export for TikTok · Reels · Shorts…'), icon: Smartphone, onClick: () => a.exportDialog('social') },
        { label: t('Export frame as PNG…'), icon: ImageIcon, onClick: () => a.exportDialog('png') },
        { label: t('Export audio as WAV…'), icon: Music, onClick: () => a.exportDialog('wav') },
        { label: t('Export GIF…'), icon: Film, onClick: () => a.exportDialog('gif') },
        { label: t('Convert to MP4/MOV with FFmpeg…'), onClick: () => a.exportDialog('ffmpeg'), disabled: !s.canFfmpeg },
        { type: 'separator' },
        { label: t('Import captions (SRT/VTT)…'), icon: Captions, onClick: a.importCaptions },
        {
          label: t('Export captions'),
          icon: FileDown,
          disabled: !s.hasCaptions,
          submenu: [
            { label: 'SRT…', onClick: () => a.exportCaptions('srt') },
            { label: 'WebVTT…', onClick: () => a.exportCaptions('vtt') },
          ],
        },
        { type: 'separator' },
        { label: t('Relink missing media…'), onClick: a.relink, disabled: !s.missingMedia },
        { label: t('Project settings…'), icon: Settings2, onClick: a.projectSettings },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), icon: Undo2, shortcut: 'Ctrl+Z', onClick: a.undo, disabled: !s.canUndo },
        { label: t('Redo'), icon: Redo2, shortcut: 'Ctrl+Shift+Z', onClick: a.redo, disabled: !s.canRedo },
        { type: 'separator' },
        { label: t('Cut'), icon: Scissors, shortcut: 'Ctrl+X', onClick: a.cut, disabled: !s.hasSelection },
        { label: t('Copy'), icon: Copy, shortcut: 'Ctrl+C', onClick: a.copy, disabled: !s.hasSelection },
        { label: t('Paste at playhead'), icon: ClipboardPaste, shortcut: 'Ctrl+V', onClick: a.paste, disabled: !s.hasClipboard },
        { label: t('Duplicate'), icon: CopyPlus, shortcut: 'Ctrl+D', onClick: a.duplicate, disabled: !s.hasSelection },
        { label: t('Delete'), icon: Trash2, shortcut: 'Del', onClick: () => a.deleteSelection(false), disabled: !s.hasSelection },
        { label: t('Ripple delete'), icon: ArrowLeftToLine, shortcut: 'Shift+Del', onClick: () => a.deleteSelection(true), disabled: !s.hasSelection },
        { type: 'separator' },
        { label: t('Select all'), shortcut: 'Ctrl+A', onClick: a.selectAll },
        { label: t('Deselect'), shortcut: 'Ctrl+Shift+A', onClick: a.deselect },
        { type: 'separator' },
        { label: t('Split at playhead'), icon: SquareSplitHorizontal, shortcut: 'S', onClick: a.split },
        { label: t('Link clips'), icon: Link2, onClick: a.link, disabled: !s.hasSelection },
        { label: t('Unlink clips'), icon: Unlink2, onClick: a.unlink, disabled: !s.hasSelection },
      ],
    },
    {
      label: t('Clip'),
      entries: () => [
        {
          label: t('Transition in'),
          disabled: !s.visualSelected,
          submenu: [
            { label: t('None'), onClick: () => a.setTransition('none') },
            ...TRANSITIONS.map((tr) => ({ label: t(tr.label), onClick: () => a.setTransition(tr.kind) })),
          ],
        },
        {
          label: t('Speed'),
          disabled: !s.mediaSelected,
          submenu: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4].map((v) => ({ label: `${v}×`, onClick: () => a.setSpeed(v) })),
        },
        { label: t('Reset effects'), onClick: a.resetEffects, disabled: !s.visualSelected },
        { label: t('Rename…'), onClick: a.renameClip, disabled: !s.hasSelection },
      ],
    },
    {
      label: t('Timeline'),
      entries: () => [
        { label: t('Add video track'), icon: Film, onClick: () => a.addTrack('video') },
        { label: t('Add audio track'), icon: Music, onClick: () => a.addTrack('audio') },
        { label: t('Add caption track'), icon: Captions, onClick: () => a.addTrack('caption') },
        { type: 'separator' },
        { label: t('Add marker'), icon: Flag, shortcut: 'M', onClick: a.addMarker },
        { label: t('Set in point'), shortcut: 'I', onClick: a.setIn },
        { label: t('Set out point'), shortcut: 'O', onClick: a.setOut },
        { label: t('Clear in/out'), onClick: a.clearInOut },
        { type: 'separator' },
        { label: t('Snapping'), checked: s.snapping, shortcut: 'N', onClick: a.toggleSnapping },
        { label: t('Go to start'), shortcut: 'Home', onClick: a.goStart },
        { label: t('Go to end'), shortcut: 'End', onClick: a.goEnd },
        { label: t('Previous edit point'), shortcut: '↑', onClick: a.prevEdit },
        { label: t('Next edit point'), shortcut: '↓', onClick: a.nextEdit },
        { type: 'separator' },
        { label: t('Zoom in'), shortcut: 'Ctrl+=', onClick: a.zoomIn },
        { label: t('Zoom out'), shortcut: 'Ctrl+−', onClick: a.zoomOut },
        { label: t('Fit timeline'), shortcut: 'Ctrl+0', onClick: a.zoomFit },
      ],
    },
    {
      label: t('View'),
      entries: () => [
        { label: t('Safe area guides'), checked: s.safe, onClick: a.toggleSafe },
        { label: t('Loop playback'), checked: s.loop, onClick: a.toggleLoop },
        { type: 'separator' },
        { label: t('Fit preview'), checked: s.previewZoom === 'fit', onClick: () => a.setPreviewZoom('fit') },
        { label: '50%', checked: s.previewZoom === 0.5, onClick: () => a.setPreviewZoom(0.5) },
        { label: '100%', checked: s.previewZoom === 1, shortcut: 'Ctrl+1', onClick: () => a.setPreviewZoom(1) },
      ],
    },
    {
      label: t('AI'),
      entries: () => [
        { label: t('Auto captions…'), icon: Captions, onClick: a.autoCaptions },
        { label: t('Remove silences…'), icon: Wand2, onClick: a.removeSilences },
        { label: t('Write titles & description…'), icon: Sparkles, onClick: a.writeMeta },
        { label: t('Rough cut from transcript…'), icon: Scissors, onClick: a.roughCut },
        { label: t('Voice-over from text…'), icon: AudioLines, onClick: a.voiceOver },
        { type: 'separator' },
        { label: t('AI Assistant'), shortcut: 'Ctrl+J', onClick: a.toggleAI },
      ],
    },
  ];
}
