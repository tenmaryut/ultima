import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  BringToFront,
  ClipboardPaste,
  Copy,
  FileDown,
  FilePlus,
  FolderOpen,
  Group,
  ImagePlus,
  LayoutTemplate,
  Lock,
  Printer,
  Redo2,
  Save,
  Scissors,
  SendToBack,
  Sparkles,
  Trash2,
  Undo2,
  Ungroup,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MenuEntry } from '../../components/ui';
import type { TFunction } from '../../core/i18n';
import { isMac } from '../../core/platform';
import { MASTER_ID } from './types';
import type { LayoutEditor, ViewOptions } from './useLayoutEditor';
import type { ExportFormat } from './dialogs/ExportDialog';

export interface MenuActions {
  newDoc: (tab: 'templates' | 'blank') => void;
  open: () => void;
  save: (asNew: boolean) => void;
  placeImage: () => void;
  exportAs: (format: ExportFormat) => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  fit: () => void;
  actualSize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  brief: () => void;
  rewrite: () => void;
  copywriter: () => void;
  toggleAI: () => void;
}

export function buildMenus(ed: LayoutEditor, a: MenuActions, t: TFunction): { label: string; entries: () => MenuEntry[] }[] {
  const mod = isMac ? '⌘' : 'Ctrl+';
  const sel = ed.selected;
  const textSel = sel.find((f) => f.type === 'text');
  const toggleView = (key: keyof ViewOptions) => () => ed.setView((v) => ({ ...v, [key]: !v[key] }));
  return [
    {
      label: t('File'),
      entries: () => [
        { label: t('New from template…'), icon: LayoutTemplate, shortcut: `${mod}N`, onClick: () => a.newDoc('templates') },
        { label: t('New blank document…'), icon: FilePlus, onClick: () => a.newDoc('blank') },
        { label: t('Open…'), icon: FolderOpen, shortcut: `${mod}O`, onClick: a.open },
        { type: 'separator' },
        { label: t('Save'), icon: Save, shortcut: `${mod}S`, onClick: () => a.save(false) },
        { label: t('Save as…'), shortcut: `${mod}⇧S`, onClick: () => a.save(true) },
        { type: 'separator' },
        { label: t('Place image…'), icon: ImagePlus, onClick: a.placeImage },
        { type: 'separator' },
        { label: t('Export PDF…'), icon: FileDown, shortcut: `${mod}E`, onClick: () => a.exportAs('pdf') },
        { label: t('Export PNG…'), onClick: () => a.exportAs('png') },
        { label: t('Export JPG…'), onClick: () => a.exportAs('jpeg') },
        { label: t('Print…'), icon: Printer, onClick: () => a.exportAs('print') },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), icon: Undo2, shortcut: `${mod}Z`, disabled: !ed.history.canUndo, onClick: ed.history.undo },
        { label: t('Redo'), icon: Redo2, shortcut: isMac ? '⌘⇧Z' : 'Ctrl+Y', disabled: !ed.history.canRedo, onClick: ed.history.redo },
        { type: 'separator' },
        { label: t('Cut'), icon: Scissors, shortcut: `${mod}X`, disabled: !sel.length, onClick: a.cut },
        { label: t('Copy'), icon: Copy, shortcut: `${mod}C`, disabled: !sel.length, onClick: a.copy },
        { label: t('Paste'), icon: ClipboardPaste, shortcut: `${mod}V`, onClick: a.paste },
        { label: t('Duplicate'), shortcut: `${mod}D`, disabled: !sel.length, onClick: () => ed.duplicateSelection() },
        { label: t('Delete'), icon: Trash2, shortcut: 'Del', disabled: !sel.length, onClick: ed.deleteSelection },
        { type: 'separator' },
        { label: t('Select all'), shortcut: `${mod}A`, onClick: () => ed.select(ed.frames.filter((f) => !f.locked && !f.hidden).map((f) => f.id)) },
        { label: t('Deselect'), shortcut: `${mod}⇧A`, onClick: () => ed.setSelection([]) },
      ],
    },
    {
      label: t('Object'),
      entries: () => [
        {
          label: t('Arrange'),
          disabled: !sel.length,
          submenu: [
            { label: t('Bring to front'), icon: BringToFront, shortcut: `${mod}⇧]`, onClick: () => ed.reorder('front') },
            { label: t('Bring forward'), shortcut: `${mod}]`, onClick: () => ed.reorder('forward') },
            { label: t('Send backward'), shortcut: `${mod}[`, onClick: () => ed.reorder('backward') },
            { label: t('Send to back'), icon: SendToBack, shortcut: `${mod}⇧[`, onClick: () => ed.reorder('back') },
          ],
        },
        {
          label: t('Align'),
          disabled: !sel.length,
          submenu: [
            { label: t('Left edges'), icon: AlignStartVertical, onClick: () => ed.align('left') },
            { label: t('Horizontal centers'), icon: AlignCenterVertical, onClick: () => ed.align('hcenter') },
            { label: t('Right edges'), icon: AlignEndVertical, onClick: () => ed.align('right') },
            { label: t('Top edges'), icon: AlignStartHorizontal, onClick: () => ed.align('top') },
            { label: t('Vertical centers'), icon: AlignCenterHorizontal, onClick: () => ed.align('vcenter') },
            { label: t('Bottom edges'), icon: AlignEndHorizontal, onClick: () => ed.align('bottom') },
            { type: 'separator' },
            { label: t('Center on page'), onClick: () => (ed.align('hcenter', true), ed.align('vcenter', true)) },
            { label: t('Distribute horizontally'), disabled: sel.length < 3, onClick: () => ed.distribute('x') },
            { label: t('Distribute vertically'), disabled: sel.length < 3, onClick: () => ed.distribute('y') },
          ],
        },
        { type: 'separator' },
        { label: t('Group'), icon: Group, shortcut: `${mod}G`, disabled: sel.length < 2, onClick: ed.group },
        { label: t('Ungroup'), icon: Ungroup, shortcut: `${mod}⇧G`, disabled: !sel.some((f) => f.groupId), onClick: ed.ungroup },
        { label: sel.length && sel.every((f) => f.locked) ? t('Unlock') : t('Lock'), icon: Lock, shortcut: `${mod}L`, disabled: !sel.length, onClick: () => ed.toggleLock() },
        { type: 'separator' },
        { label: t('Rotate 90° right'), disabled: !sel.length, onClick: () => ed.rotateSelection(90) },
        { label: t('Rotate 90° left'), disabled: !sel.length, onClick: () => ed.rotateSelection(-90) },
        { type: 'separator' },
        { label: t('Edit text'), disabled: !textSel, onClick: () => textSel && ed.beginEdit(textSel.id) },
        { label: t('Continue text in another frame…'), disabled: !textSel || ed.pageId === MASTER_ID, onClick: () => textSel && ed.startLink(textSel.id) },
        { label: t('Add linked text frame'), disabled: !textSel || ed.pageId === MASTER_ID, onClick: () => textSel && ed.addLinkedFrame(textSel.id) },
        { label: t('Unlink next frame'), disabled: !(textSel?.type === 'text' && textSel.nextId), onClick: () => textSel && ed.unlink(textSel.id) },
      ],
    },
    {
      label: t('Page'),
      entries: () => [
        { label: t('Add page'), icon: FilePlus, onClick: () => ed.addPage(false) },
        { label: t('Duplicate page'), icon: Copy, disabled: ed.pageIndex < 0, onClick: () => ed.addPage(true) },
        { label: t('Delete page'), icon: Trash2, disabled: ed.doc.pages.length <= 1 || ed.pageIndex < 0, onClick: () => ed.deletePage() },
        { type: 'separator' },
        { label: t('Previous page'), shortcut: 'PgUp', disabled: ed.pageIndex <= 0, onClick: () => ed.goToPage(ed.pageIndex - 1) },
        { label: t('Next page'), shortcut: 'PgDn', disabled: ed.pageIndex >= ed.doc.pages.length - 1, onClick: () => ed.goToPage(ed.pageIndex + 1) },
        { label: t('Move page left'), disabled: ed.pageIndex <= 0, onClick: () => ed.movePage(ed.pageIndex, ed.pageIndex - 1) },
        { label: t('Move page right'), disabled: ed.pageIndex < 0 || ed.pageIndex >= ed.doc.pages.length - 1, onClick: () => ed.movePage(ed.pageIndex, ed.pageIndex + 1) },
        { type: 'separator' },
        { label: ed.pageId === MASTER_ID ? t('Back to pages') : t('Edit master page'), icon: LayoutTemplate, onClick: () => ed.goToPage(ed.pageId === MASTER_ID ? 0 : MASTER_ID) },
      ],
    },
    {
      label: t('View'),
      entries: () => [
        { label: t('Zoom in'), icon: ZoomIn, shortcut: `${mod}+`, onClick: a.zoomIn },
        { label: t('Zoom out'), icon: ZoomOut, shortcut: `${mod}-`, onClick: a.zoomOut },
        { label: t('Fit page'), shortcut: `${mod}0`, onClick: a.fit },
        { label: t('Actual size'), shortcut: `${mod}1`, onClick: a.actualSize },
        { type: 'separator' },
        { label: t('Single page'), checked: ed.view.mode === 'single', onClick: () => ed.setView((v) => ({ ...v, mode: 'single' })) },
        { label: t('Continuous scroll'), checked: ed.view.mode === 'continuous', onClick: () => ed.setView((v) => ({ ...v, mode: 'continuous' })) },
        { type: 'separator' },
        { label: t('Guides & margins'), checked: ed.view.guides, onClick: toggleView('guides') },
        { label: t('Snap to guides and objects'), checked: ed.view.snap, onClick: toggleView('snap') },
        { label: t('Rulers'), checked: ed.view.rulers, onClick: toggleView('rulers') },
        { label: t('Bleed area'), checked: ed.view.bleed, onClick: toggleView('bleed') },
        { label: t('Frame edges'), checked: ed.view.edges, onClick: toggleView('edges') },
      ],
    },
    {
      label: t('AI'),
      entries: () => [
        { label: t('Design from a brief…'), icon: Sparkles, onClick: a.brief },
        { label: t('Rewrite selected text…'), icon: Wand2, disabled: !textSel, onClick: a.rewrite },
        { label: t('Generate copy…'), onClick: a.copywriter },
        { type: 'separator' },
        { label: t('Show AI assistant'), shortcut: `${mod}J`, onClick: a.toggleAI },
      ],
    },
  ];
}
