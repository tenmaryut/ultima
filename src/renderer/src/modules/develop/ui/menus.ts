/** Menu bar + context menu definitions of Photo Develop. */
import type { MenuEntry } from '../../../components/ui/Menu';
import type { TFunction } from '../../../core/i18n';
import { isMac } from '../../../core/platform';
import { autoToneFor, autoWhiteBalance, flipPhotos, pasteSettings, resetAll, rotatePhotos } from '../ops';
import { createVirtualCopy, missingCount } from '../library';
import { selectAll, selectedIds, selectNone, setActive, setFlag, setLabel, setRating, setStore, setView, useDevelop } from '../store';
import { LABELS } from '../types';
import { LABEL_NAMES } from './common';
import { viewportRef } from './DevelopView';

export interface MenuActions {
  importPhotos: () => void;
  openCatalog: () => void;
  newCatalog: () => void;
  save: () => void;
  saveAs: () => void;
  relink: () => void;
  exportSelected: () => void;
  undo: () => void;
  redo: () => void;
  copySettings: () => void;
  syncSettings: () => void;
  removeSelected: () => void;
  savePreset: () => void;
  aiAutoEdit: () => void;
  describeLook: () => void;
  aiCull: () => void;
  toggleAI: () => void;
  shortcuts: () => void;
}

const M = isMac ? '⌘' : 'Ctrl+';

export function ratingEntries(t: TFunction): MenuEntry[] {
  return [0, 1, 2, 3, 4, 5].map((n) => ({ label: n ? '★'.repeat(n) : t('No rating'), shortcut: String(n), onClick: () => setRating(selectedIds(), n) }));
}

export function flagEntries(t: TFunction): MenuEntry[] {
  return [
    { label: t('Pick'), shortcut: 'P', onClick: () => setFlag(selectedIds(), 'pick') },
    { label: t('Reject'), shortcut: 'X', onClick: () => setFlag(selectedIds(), 'reject') },
    { label: t('Unflag'), shortcut: 'U', onClick: () => setFlag(selectedIds(), null) },
  ];
}

export function labelEntries(t: TFunction): MenuEntry[] {
  return [
    ...LABELS.map((l, i) => ({ label: t(LABEL_NAMES[l]), shortcut: i < 4 ? String(i + 6) : undefined, onClick: () => setLabel(selectedIds(), l) })),
    { type: 'separator' as const },
    { label: t('No label'), onClick: () => setLabel(selectedIds(), null) },
  ];
}

export function buildMenus(t: TFunction, a: MenuActions): { label: string; entries: () => MenuEntry[] }[] {
  const s = () => useDevelop.getState();
  const has = () => s().order.length > 0;
  return [
    {
      label: t('File'),
      entries: () => [
        { label: t('Import Photos…'), shortcut: `${M}O`, onClick: a.importPhotos },
        { label: t('Open Catalog…'), onClick: a.openCatalog },
        { label: t('New Catalog'), shortcut: `${M}N`, onClick: a.newCatalog },
        { type: 'separator' },
        { label: t('Save Catalog'), shortcut: `${M}S`, onClick: a.save, disabled: !has() },
        { label: t('Save Catalog As…'), shortcut: `${M}Shift+S`, onClick: a.saveAs, disabled: !has() },
        { label: t('Locate Missing Files…'), onClick: a.relink, disabled: missingCount() === 0 },
        { type: 'separator' },
        { label: t('Export…'), shortcut: `${M}E`, onClick: a.exportSelected, disabled: !has() },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), shortcut: `${M}Z`, onClick: a.undo },
        { label: t('Redo'), shortcut: `${M}Shift+Z`, onClick: a.redo },
        { type: 'separator' },
        { label: t('Copy Settings…'), shortcut: `${M}Shift+C`, onClick: a.copySettings, disabled: !s().activeId },
        { label: t('Paste Settings'), shortcut: `${M}Shift+V`, onClick: () => pasteSettings(selectedIds()), disabled: !s().clipboard },
        { label: t('Sync Settings…'), onClick: a.syncSettings, disabled: selectedIds().length < 2 },
        { type: 'separator' },
        { label: t('Select All'), shortcut: `${M}A`, onClick: selectAll },
        { label: t('Select None'), shortcut: `${M}Shift+A`, onClick: selectNone },
        { type: 'separator' },
        { label: t('Remove from Library'), shortcut: 'Del', onClick: a.removeSelected, disabled: !has() },
      ],
    },
    {
      label: t('Photo'),
      entries: () => [
        { label: t('Rating'), submenu: ratingEntries(t) },
        { label: t('Flag'), submenu: flagEntries(t) },
        { label: t('Color Label'), submenu: labelEntries(t) },
        { type: 'separator' },
        { label: t('Rotate Left'), shortcut: `${M}[`, onClick: () => rotatePhotos(selectedIds(), -1) },
        { label: t('Rotate Right'), shortcut: `${M}]`, onClick: () => rotatePhotos(selectedIds(), 1) },
        { label: t('Flip Horizontal'), onClick: () => flipPhotos(selectedIds(), 'h') },
        { label: t('Flip Vertical'), onClick: () => flipPhotos(selectedIds(), 'v') },
        { type: 'separator' },
        { label: t('Auto Tone'), shortcut: `${M}U`, onClick: () => void autoToneFor(selectedIds()) },
        { label: t('Auto White Balance'), onClick: () => void autoWhiteBalance(selectedIds()) },
        { label: t('Reset All Settings'), shortcut: `${M}Shift+R`, onClick: () => resetAll(selectedIds()) },
        { label: t('Save Settings as Preset…'), onClick: a.savePreset, disabled: !s().activeId },
        { type: 'separator' },
        { label: t('Create Virtual Copy'), shortcut: `${M}D`, onClick: () => s().activeId && createVirtualCopy(s().activeId!), disabled: !s().activeId },
      ],
    },
    {
      label: t('View'),
      entries: () => [
        { label: t('Library'), shortcut: 'G', checked: s().view === 'library', onClick: () => setView('library') },
        { label: t('Develop'), shortcut: 'D', checked: s().view === 'develop', onClick: () => has() && setView('develop') },
        { type: 'separator' },
        { label: t('Before / After'), shortcut: '\\', checked: s().compare === 'before', onClick: () => setStore({ compare: s().compare === 'before' ? 'off' : 'before', view: 'develop' }) },
        { label: t('Split Compare'), shortcut: 'Y', checked: s().compare === 'split', onClick: () => setStore({ compare: s().compare === 'split' ? 'off' : 'split', view: 'develop' }) },
        { label: t('Show Clipping'), shortcut: 'J', checked: s().showClipping, onClick: () => setStore({ showClipping: !s().showClipping }) },
        { label: t('Crop & Straighten'), shortcut: 'R', checked: s().cropMode, onClick: () => setStore({ cropMode: !s().cropMode, view: 'develop', tool: 'none' }) },
        { type: 'separator' },
        { label: t('Zoom to Fit'), shortcut: `${M}0`, onClick: () => viewportRef.current?.fit() },
        { label: t('Zoom 100%'), shortcut: `${M}1`, onClick: () => viewportRef.current?.actualSize() },
        { type: 'separator' },
        { label: t('Keyboard Shortcuts'), onClick: a.shortcuts },
      ],
    },
    {
      label: t('AI'),
      entries: () => [
        { label: t('AI Auto Edit Selected…'), onClick: a.aiAutoEdit, disabled: !has() },
        { label: t('Describe a Look…'), onClick: a.describeLook, disabled: !s().activeId },
        { label: t('Suggest Ratings…'), onClick: a.aiCull, disabled: !has() },
        { type: 'separator' },
        { label: t('AI Assistant'), shortcut: `${M}J`, onClick: a.toggleAI },
      ],
    },
  ];
}

export function photoContextMenu(t: TFunction, a: MenuActions, id: string): MenuEntry[] {
  return [
    {
      label: t('Open in Develop'),
      onClick: () => {
        setActive(id);
        setView('develop');
      },
    },
    { type: 'separator' },
    { label: t('Rating'), submenu: ratingEntries(t) },
    { label: t('Flag'), submenu: flagEntries(t) },
    { label: t('Color Label'), submenu: labelEntries(t) },
    { type: 'separator' },
    { label: t('Rotate Left'), onClick: () => rotatePhotos(selectedIds(), -1) },
    { label: t('Rotate Right'), onClick: () => rotatePhotos(selectedIds(), 1) },
    { label: t('Auto Tone'), onClick: () => void autoToneFor(selectedIds()) },
    { label: t('Reset All Settings'), onClick: () => resetAll(selectedIds()) },
    { type: 'separator' },
    { label: t('Copy Settings…'), onClick: a.copySettings },
    { label: t('Paste Settings'), onClick: () => pasteSettings(selectedIds()), disabled: !useDevelop.getState().clipboard },
    { label: t('Create Virtual Copy'), onClick: () => createVirtualCopy(id) },
    { type: 'separator' },
    { label: t('AI Auto Edit…'), onClick: a.aiAutoEdit },
    { label: t('Export…'), onClick: a.exportSelected },
    { label: t('Remove from Library'), onClick: a.removeSelected },
  ];
}

export const SHORTCUTS: [string, string][] = [
  ['G / D', 'Library / Develop'],
  ['← →', 'Previous / next photo'],
  ['0 – 5', 'Star rating'],
  ['6 – 9', 'Color label (red, yellow, green, blue)'],
  ['P / X / U', 'Pick / reject / unflag'],
  ['\\', 'Before / after'],
  ['Y', 'Split compare'],
  ['J', 'Show clipping'],
  ['R', 'Crop & straighten'],
  ['X (crop)', 'Swap portrait / landscape'],
  ['O', 'Cycle crop overlay'],
  ['W', 'White balance picker'],
  ['Z / click', 'Zoom fit ↔ 100%'],
  ['Space + drag', 'Pan'],
  [`${M}Shift+C / V`, 'Copy / paste settings'],
  [`${M}U`, 'Auto Tone'],
  [`${M}[ / ]`, 'Rotate left / right'],
  [`${M}D`, 'Create virtual copy'],
  [`${M}Z / ${M}Shift+Z`, 'Undo / redo (per photo)'],
  [`${M}E`, 'Export'],
  [`${M}S`, 'Save catalog'],
  ['Double-click a slider label', 'Reset that slider'],
];
