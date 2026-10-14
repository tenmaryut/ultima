import {
  Circle,
  FilePlus,
  FolderOpen,
  Hand,
  Hexagon,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Crosshair,
  PenTool,
  Save,
  Square,
  Star,
  Type,
  Box,
  Download,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { TFunction } from '../../core/i18n';
import { isMac } from '../../core/platform';
import { ToolButton, type MenuEntry } from '../../components/ui';
import { PRESETS, type PresetId } from './presets';
import type { ToolId } from './state';
import type { LayerType, ShapeKind } from './types';

/** Header menus and the tool palette of the Motion module. */

const mod = isMac ? '⌘' : 'Ctrl+';

export interface MenuHandlers {
  newDoc: () => void;
  open: () => void;
  save: (saveAs: boolean) => void;
  importMedia: () => void;
  exportAs: (format?: 'mp4' | 'webm' | 'gif' | 'png-seq' | 'png-frame') => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  copy: () => void;
  paste: () => void;
  cut: () => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  deselect: () => void;
  addLayer: (type: LayerType, shape?: ShapeKind) => void;
  reorder: (where: 'up' | 'down' | 'top' | 'bottom') => void;
  hasSelection: boolean;
  hasKeys: boolean;
  applyPreset: (id: PresetId) => void;
  easyEase: () => void;
  removeAnimation: () => void;
  revealAnimated: () => void;
  compSettings: () => void;
  trimToWorkArea: () => void;
  workAreaToSelection: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actual: () => void;
  quality: number;
  setQuality: (q: number) => void;
  showPaths: boolean;
  setShowPaths: (v: boolean) => void;
  snapping: boolean;
  setSnapping: (v: boolean) => void;
  animate: () => void;
  suggest: () => void;
}

export function presetEntries(t: TFunction, apply: (id: PresetId) => void, disabled = false): MenuEntry[] {
  return PRESETS.map((p) => ({ label: t(p.label), disabled, onClick: () => apply(p.id) }));
}

export function addLayerEntries(t: TFunction, add: (type: LayerType, shape?: ShapeKind) => void, importMedia: () => void): MenuEntry[] {
  return [
    { label: t('Text'), icon: Type, onClick: () => add('text') },
    { label: t('Rectangle'), icon: Square, onClick: () => add('shape', 'rect') },
    { label: t('Ellipse'), icon: Circle, onClick: () => add('shape', 'ellipse') },
    { label: t('Polygon'), icon: Hexagon, onClick: () => add('shape', 'polygon') },
    { label: t('Star'), icon: Star, onClick: () => add('shape', 'star') },
    { label: t('Line'), icon: Minus, onClick: () => add('shape', 'line') },
    { label: t('Solid'), icon: Square, onClick: () => add('solid') },
    { label: t('Null (parent / group)'), icon: Box, onClick: () => add('null') },
    { type: 'separator' },
    { label: t('Image or video…'), icon: ImageIcon, onClick: importMedia },
  ];
}

export function buildMenus(t: TFunction, h: MenuHandlers): { label: string; entries: () => MenuEntry[] }[] {
  return [
    {
      label: t('File'),
      entries: () => [
        { label: t('New composition…'), icon: FilePlus, shortcut: `${mod}N`, onClick: h.newDoc },
        { label: t('Open…'), icon: FolderOpen, shortcut: `${mod}O`, onClick: h.open },
        { label: t('Import image, video or SVG…'), icon: ImageIcon, onClick: h.importMedia },
        { type: 'separator' },
        { label: t('Save project'), icon: Save, shortcut: `${mod}S`, onClick: () => h.save(false) },
        { label: t('Save project as…'), shortcut: `${mod}Shift+S`, onClick: () => h.save(true) },
        { type: 'separator' },
        { label: t('Export…'), icon: Download, shortcut: `${mod}E`, onClick: () => h.exportAs() },
        {
          label: t('Export as'),
          submenu: [
            { label: t('MP4 video'), onClick: () => h.exportAs('mp4') },
            { label: t('WebM video'), onClick: () => h.exportAs('webm') },
            { label: t('Animated GIF'), onClick: () => h.exportAs('gif') },
            { label: t('PNG sequence (ZIP)'), onClick: () => h.exportAs('png-seq') },
            { label: t('Current frame (PNG)'), onClick: () => h.exportAs('png-frame') },
          ],
        },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), shortcut: `${mod}Z`, disabled: !h.canUndo, onClick: h.undo },
        { label: t('Redo'), shortcut: isMac ? '⌘⇧Z' : 'Ctrl+Y', disabled: !h.canRedo, onClick: h.redo },
        { type: 'separator' },
        { label: t('Cut'), shortcut: `${mod}X`, disabled: !h.hasSelection && !h.hasKeys, onClick: h.cut },
        { label: t('Copy'), shortcut: `${mod}C`, disabled: !h.hasSelection && !h.hasKeys, onClick: h.copy },
        { label: t('Paste'), shortcut: `${mod}V`, onClick: h.paste },
        { label: t('Duplicate'), shortcut: `${mod}D`, disabled: !h.hasSelection, onClick: h.duplicate },
        { label: t('Delete'), shortcut: 'Del', disabled: !h.hasSelection && !h.hasKeys, onClick: h.remove },
        { type: 'separator' },
        { label: t('Select all layers'), shortcut: `${mod}A`, onClick: h.selectAll },
        { label: t('Deselect all'), shortcut: `${mod}Shift+A`, onClick: h.deselect },
      ],
    },
    {
      label: t('Layer'),
      entries: () => [
        { label: t('New'), submenu: addLayerEntries(t, h.addLayer, h.importMedia) },
        { type: 'separator' },
        { label: t('Bring forward'), disabled: !h.hasSelection, onClick: () => h.reorder('up') },
        { label: t('Send backward'), disabled: !h.hasSelection, onClick: () => h.reorder('down') },
        { label: t('Bring to Front'), disabled: !h.hasSelection, onClick: () => h.reorder('top') },
        { label: t('Send to Back'), disabled: !h.hasSelection, onClick: () => h.reorder('bottom') },
      ],
    },
    {
      label: t('Animation'),
      entries: () => [
        { label: t('Apply preset'), submenu: presetEntries(t, h.applyPreset, !h.hasSelection) },
        { type: 'separator' },
        { label: t('Easy ease'), shortcut: 'F9', disabled: !h.hasKeys, onClick: h.easyEase },
        { label: t('Show animated properties'), shortcut: 'U', onClick: h.revealAnimated },
        { label: t('Remove Animation'), disabled: !h.hasSelection, onClick: h.removeAnimation },
        { type: 'separator' },
        { label: t('Animate from description…'), icon: Wand2, onClick: h.animate },
        { label: t('Suggest easing & timing'), icon: Sparkles, disabled: !h.hasSelection, onClick: h.suggest },
      ],
    },
    {
      label: t('Composition'),
      entries: () => [
        { label: t('Composition settings…'), onClick: h.compSettings },
        { label: t('Set work area to selected layers'), disabled: !h.hasSelection, onClick: h.workAreaToSelection },
        { label: t('Trim composition to work area'), onClick: h.trimToWorkArea },
      ],
    },
    {
      label: t('View'),
      entries: () => [
        { label: t('Zoom in'), shortcut: `${mod}+`, onClick: h.zoomIn },
        { label: t('Zoom out'), shortcut: `${mod}-`, onClick: h.zoomOut },
        { label: t('Fit in window'), shortcut: `${mod}0`, onClick: h.fit },
        { label: t('Actual size (100%)'), shortcut: `${mod}1`, onClick: h.actual },
        { type: 'separator' },
        { label: t('Preview: full resolution'), checked: h.quality === 1, onClick: () => h.setQuality(1) },
        { label: t('Preview: half resolution'), checked: h.quality === 0.5, onClick: () => h.setQuality(0.5) },
        { label: t('Preview: quarter resolution'), checked: h.quality === 0.25, onClick: () => h.setQuality(0.25) },
        { type: 'separator' },
        { label: t('Show motion paths'), checked: h.showPaths, onClick: () => h.setShowPaths(!h.showPaths) },
        { label: t('Snapping'), checked: h.snapping, onClick: () => h.setSnapping(!h.snapping) },
      ],
    },
  ];
}

const TOOLS: { id: ToolId; icon: LucideIcon; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Selection', key: 'V' },
  { id: 'anchor', icon: Crosshair, label: 'Anchor point', key: 'Y' },
  { id: 'hand', icon: Hand, label: 'Hand', key: 'H' },
  { id: 'text', icon: Type, label: 'Text', key: 'T' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'E' },
  { id: 'polygon', icon: Hexagon, label: 'Polygon', key: '' },
  { id: 'star', icon: Star, label: 'Star', key: '' },
  { id: 'line', icon: Minus, label: 'Line', key: 'L' },
  { id: 'pen', icon: PenTool, label: 'Pen (click: corner, drag: curve, Enter: finish)', key: 'P' },
];

export const TOOL_KEYS: Record<string, ToolId> = Object.fromEntries(TOOLS.filter((x) => x.key).map((x) => [x.key.toLowerCase(), x.id]));

export function ToolPalette({ t, tool, setTool, onImport, onNull }: { t: TFunction; tool: ToolId; setTool: (t: ToolId) => void; onImport: () => void; onNull: () => void }) {
  return (
    <div className="toolbar-v">
      {TOOLS.map((x, i) => (
        <span key={x.id} style={{ display: 'contents' }}>
          {(i === 3 || i === 9) && <div className="tool-sep" />}
          <ToolButton icon={x.icon} label={t(x.label)} shortcut={x.key || undefined} active={tool === x.id} onClick={() => setTool(x.id)} />
        </span>
      ))}
      <div className="tool-sep" />
      <ToolButton icon={ImageIcon} label={t('Import image, video or SVG…')} onClick={onImport} />
      <ToolButton icon={Box} label={t('New null (parent / group)')} onClick={onNull} />
    </div>
  );
}
