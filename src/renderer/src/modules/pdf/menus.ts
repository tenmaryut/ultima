/**
 * Header menus (File, Edit, View, Pages, Tools, AI).
 */
import {
  Copy,
  Download,
  EyeOff,
  FileImage,
  FileInput,
  FileOutput,
  FilePlus,
  FileText,
  FolderOpen,
  Images,
  LayoutGrid,
  Printer,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { HistoryState } from '../../core/history';
import { t } from '../../core/i18n';
import { isMac, pickFiles } from '../../core/platform';
import type { MenuEntry } from '../../components/ui';
import { closeDocument, insertFiles, newBlankDocument, openFiles, savePdf, saveProject } from './docActions';
import { extractAllText, printDocument } from './output';
import { duplicate, extractToFile, insertBlank, remove, rotate, targetPages } from './pageActions';
import { applyRedactions } from './redact';
import { usePdfUi } from './store';
import { selectTool, TOOL_GROUPS } from './tools';
import type { DocState } from './types';
import { openFind, rotateView, setZoom, setZoomMode, zoomBy } from './viewActions';
import { deleteSelection, duplicateSelection, selectAllOnPage } from './editActions';

type History = HistoryState<DocState>;

const mod = isMac ? '⌘' : 'Ctrl+';

export const OPEN_ACCEPT = 'application/pdf,.pdf,image/*,.ultima';

export async function pickAndOpen(history: History): Promise<void> {
  const files = await pickFiles({ accept: OPEN_ACCEPT, multiple: true });
  if (files.length) await openFiles(files, history);
}

export async function pickAndInsert(history: History, at?: number): Promise<void> {
  const files = await pickFiles({ accept: 'application/pdf,.pdf,image/*', multiple: true });
  if (!files.length) return;
  await insertFiles(files, history, at ?? usePdfUi.getState().currentPage + 1);
}

/** Entries of the header "Export" button. */
export function exportEntries(history: History): MenuEntry[] {
  const ui = usePdfUi.getState();
  return [
    { label: t('Save PDF As…'), icon: Save, onClick: () => void savePdf(history, true) },
    { label: t('Save project (.ultima)…'), onClick: () => void saveProject(history) },
    { type: 'separator' },
    { label: t('Export pages as images…'), icon: FileImage, onClick: () => ui.set({ dialog: 'export-images' }) },
    { label: t('Extract all text (TXT)…'), icon: FileText, onClick: () => void extractAllText(history.present) },
    { label: t('Split document…'), icon: Scissors, disabled: history.present.pages.length < 2, onClick: () => ui.set({ dialog: 'split' }) },
    { type: 'separator' },
    { label: t('Print…'), icon: Printer, onClick: () => void printDocument(history.present) },
  ];
}

export function buildMenus(history: History): { label: string; entries: () => MenuEntry[] }[] {
  const doc = () => history.present;
  const hasDoc = () => doc().pages.length > 0;
  const ui = () => usePdfUi.getState();
  return [
    {
      label: t('File'),
      entries: () => [
        { label: t('New blank PDF'), icon: FilePlus, shortcut: `${mod}N`, onClick: () => void newBlankDocument(history) },
        { label: t('Open…'), icon: FolderOpen, shortcut: `${mod}O`, onClick: () => void pickAndOpen(history) },
        { label: t('Images to PDF…'), icon: Images, onClick: () => ui().set({ dialog: 'images' }) },
        { type: 'separator' },
        { label: t('Save PDF'), icon: Save, shortcut: `${mod}S`, disabled: !hasDoc(), onClick: () => void savePdf(history) },
        { label: t('Save PDF As…'), shortcut: `${mod}Shift+S`, disabled: !hasDoc(), onClick: () => void savePdf(history, true) },
        { label: t('Save project (.ultima)…'), disabled: !hasDoc(), onClick: () => void saveProject(history) },
        { type: 'separator' },
        { label: t('Export pages as images…'), icon: FileImage, shortcut: `${mod}E`, disabled: !hasDoc(), onClick: () => ui().set({ dialog: 'export-images' }) },
        { label: t('Extract all text (TXT)…'), icon: FileText, disabled: !hasDoc(), onClick: () => void extractAllText(doc()) },
        { label: t('Print…'), icon: Printer, disabled: !hasDoc(), onClick: () => void printDocument(doc()) },
        { type: 'separator' },
        { label: t('Document properties'), disabled: !hasDoc(), onClick: () => ui().set({ rightTab: 'document', mode: 'view' }) },
        { label: t('Close document'), icon: X, disabled: !hasDoc(), onClick: () => void closeDocument(history) },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), icon: Undo2, shortcut: `${mod}Z`, disabled: !history.canUndo, onClick: history.undo },
        { label: t('Redo'), icon: Redo2, shortcut: isMac ? '⌘⇧Z' : 'Ctrl+Y', disabled: !history.canRedo, onClick: history.redo },
        { type: 'separator' },
        { label: t('Duplicate'), icon: Copy, shortcut: `${mod}D`, disabled: !ui().selection.length, onClick: () => duplicateSelection(history) },
        { label: t('Delete'), icon: Trash2, shortcut: 'Del', disabled: !ui().selection.length, onClick: () => deleteSelection(history) },
        { label: t('Select all objects on this page'), disabled: !hasDoc(), onClick: () => selectAllOnPage(history) },
        { type: 'separator' },
        { label: t('Find…'), icon: Search, shortcut: `${mod}F`, disabled: !hasDoc(), onClick: openFind },
      ],
    },
    {
      label: t('View'),
      entries: () => [
        { label: t('Zoom in'), shortcut: `${mod}+`, disabled: !hasDoc(), onClick: () => zoomBy(1) },
        { label: t('Zoom out'), shortcut: `${mod}-`, disabled: !hasDoc(), onClick: () => zoomBy(-1) },
        { label: t('Fit width'), shortcut: `${mod}0`, checked: ui().zoomMode === 'fit-width', onClick: () => setZoomMode('fit-width') },
        { label: t('Fit page'), checked: ui().zoomMode === 'fit-page', onClick: () => setZoomMode('fit-page') },
        { label: t('Actual size'), shortcut: `${mod}1`, onClick: () => setZoom(1) },
        { type: 'separator' },
        { label: t('Rotate view clockwise'), icon: RotateCw, onClick: () => rotateView(90) },
        { label: t('Rotate view counter-clockwise'), icon: RotateCcw, onClick: () => rotateView(-90) },
        { type: 'separator' },
        { label: t('Page thumbnails'), checked: ui().leftPanel === 'thumbs', onClick: () => ui().set({ leftPanel: ui().leftPanel === 'thumbs' ? null : 'thumbs' }) },
        { label: t('Bookmarks'), checked: ui().leftPanel === 'outline', onClick: () => ui().set({ leftPanel: ui().leftPanel === 'outline' ? null : 'outline' }) },
        { label: t('Highlight form fields'), checked: ui().showFields, onClick: () => ui().set({ showFields: !ui().showFields }) },
      ],
    },
    {
      label: t('Pages'),
      entries: () => {
        const ids = targetPages(doc());
        return [
          { label: t('Organize pages'), icon: LayoutGrid, disabled: !hasDoc(), onClick: () => ui().set({ mode: 'organize' }) },
          { type: 'separator' },
          { label: t('Rotate clockwise'), icon: RotateCw, disabled: !ids.length, onClick: () => rotate(history, ids, 90) },
          { label: t('Rotate counter-clockwise'), icon: RotateCcw, disabled: !ids.length, onClick: () => rotate(history, ids, -90) },
          { label: t('Duplicate'), icon: Copy, disabled: !ids.length, onClick: () => duplicate(history, ids) },
          { label: t('Delete'), icon: Trash2, disabled: !ids.length || ids.length >= doc().pages.length, onClick: () => void remove(history, ids) },
          { type: 'separator' },
          { label: t('Insert blank page'), icon: FilePlus, disabled: !hasDoc(), onClick: () => void insertBlank(history, ui().currentPage + 1) },
          { label: t('Insert pages from file…'), icon: FileInput, disabled: !hasDoc(), onClick: () => void pickAndInsert(history) },
          { label: t('Insert images…'), icon: Images, disabled: !hasDoc(), onClick: () => ui().set({ dialog: 'insert-images' }) },
          { label: t('Merge files…'), icon: FileInput, onClick: () => void pickAndInsert(history, doc().pages.length) },
          { type: 'separator' },
          { label: t('Extract pages…'), icon: FileOutput, disabled: !ids.length, onClick: () => void extractToFile(history, ids) },
          { label: t('Split document…'), icon: Scissors, disabled: doc().pages.length < 2, onClick: () => ui().set({ dialog: 'split' }) },
          { label: t('Export pages as images…'), icon: Download, disabled: !hasDoc(), onClick: () => ui().set({ dialog: 'export-images' }) },
        ];
      },
    },
    {
      label: t('Tools'),
      entries: () => [
        ...TOOL_GROUPS.flat().map((d) => ({ label: t(d.label), icon: d.icon, shortcut: d.key, checked: ui().tool === d.id, disabled: !hasDoc(), onClick: () => void selectTool(d.id) })),
        { type: 'separator' as const },
        { label: t('Apply redactions…'), icon: EyeOff, disabled: !doc().annots.some((a) => a.type === 'redact'), onClick: () => void applyRedactions(history) },
      ],
    },
    {
      label: t('AI'),
      entries: () => [
        { label: t('Summarize document'), disabled: !hasDoc(), onClick: () => ui().set({ rightTab: 'ai', mode: 'view' }) },
        { label: t('Ask this PDF'), disabled: !hasDoc(), onClick: () => ui().set({ rightTab: 'ai', mode: 'view' }) },
        { label: t('Translate page…'), disabled: !hasDoc(), onClick: () => ui().set({ dialog: 'translate' }) },
        { label: t('Extract key data…'), disabled: !hasDoc(), onClick: () => ui().set({ dialog: 'extract-data' }) },
        { label: t('Fill form with AI…'), disabled: !ui().docInfo?.fieldDefs.length, onClick: () => ui().set({ dialog: 'fill-ai' }) },
      ],
    },
  ];
}
