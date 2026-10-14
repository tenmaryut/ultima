/**
 * UI state of PDF Studio (tool, zoom, selection, panels, find, document info). The
 * document itself (pages, annotations, form values, metadata) lives in a
 * useHistoryState in index.tsx so every edit is undoable.
 */
import { create } from 'zustand';
import type { Rotation, Rect } from './geometry';
import type { TextMatch } from './textgeom';
import { DEFAULT_TOOL_STYLE, type DocState, type FieldDef, type FieldValue, type OutlineNode, type ToolId, type ToolStyle } from './types';

export type ZoomMode = 'custom' | 'fit-width' | 'fit-page';
export type PdfDialog = 'signature' | 'split' | 'images' | 'export-images' | 'insert-images' | 'translate' | 'extract-data' | 'fill-ai' | null;
export type RightTab = 'edit' | 'forms' | 'document' | 'ai';

export interface FindMatch extends TextMatch {
  /** PageEntry id */
  page: string;
  rects: Rect[];
}

export interface DocInfo {
  name: string;
  /** Source id of the document that was opened (forms / outline / metadata come from it). */
  mainSrc: string | null;
  /** Path of the opened file (desktop). */
  originalPath?: string;
  /** Path chosen in a save dialog this session (Save overwrites it). */
  savePath?: string;
  fieldDefs: FieldDef[];
  initialFields: Record<string, FieldValue>;
  outline: OutlineNode[];
  fileSize: number;
  encrypted: boolean;
  /** Document state at the last save (dirty tracking). */
  savedState: DocState | null;
}

export interface PendingPlacement {
  kind: 'image' | 'signature';
  src: string;
  /** Natural size in points. */
  width: number;
  height: number;
}

interface PdfUi {
  docInfo: DocInfo | null;
  mode: 'view' | 'organize';
  tool: ToolId;
  style: ToolStyle;
  zoom: number;
  zoomMode: ZoomMode;
  viewRotation: Rotation;
  currentPage: number;
  selection: string[];
  pageSelection: string[];
  editing: string | null;
  leftPanel: 'thumbs' | 'outline' | null;
  rightTab: RightTab;
  showFields: boolean;
  flattenForms: boolean;
  notesAsComments: boolean;
  find: { open: boolean; query: string; caseSensitive: boolean; wholeWord: boolean; matches: FindMatch[]; active: number; searching: boolean; progress: number };
  pending: PendingPlacement | null;
  busy: { label: string; progress: number | null } | null;
  dialog: PdfDialog;
  /** Bumped to ask the viewer to scroll to a page. */
  scrollRequest: { index: number; nonce: number; offsetY?: number } | null;
  set: (patch: Partial<Omit<PdfUi, 'set'>>) => void;
  setStyle: (patch: Partial<ToolStyle>) => void;
  setFind: (patch: Partial<PdfUi['find']>) => void;
  goToPage: (index: number, offsetY?: number) => void;
}

const STYLE_KEY = 'ultima-pdf-style';

function loadStyle(): ToolStyle {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (raw) return { ...DEFAULT_TOOL_STYLE, ...(JSON.parse(raw) as Partial<ToolStyle>) };
  } catch {
    // ignore
  }
  return DEFAULT_TOOL_STYLE;
}

export const usePdfUi = create<PdfUi>()((set, get) => ({
  docInfo: null,
  mode: 'view',
  tool: 'select',
  style: typeof localStorage === 'undefined' ? DEFAULT_TOOL_STYLE : loadStyle(),
  zoom: 1,
  zoomMode: 'fit-width',
  viewRotation: 0,
  currentPage: 0,
  selection: [],
  pageSelection: [],
  editing: null,
  leftPanel: 'thumbs',
  rightTab: 'edit',
  showFields: true,
  flattenForms: false,
  notesAsComments: true,
  find: { open: false, query: '', caseSensitive: false, wholeWord: false, matches: [], active: -1, searching: false, progress: 0 },
  pending: null,
  busy: null,
  dialog: null,
  scrollRequest: null,
  set: (patch) => set(patch),
  setStyle: (patch) => {
    const style = { ...get().style, ...patch };
    set({ style });
    try {
      localStorage.setItem(STYLE_KEY, JSON.stringify(style));
    } catch {
      // ignore
    }
  },
  setFind: (patch) => set({ find: { ...get().find, ...patch } }),
  goToPage: (index, offsetY) => set({ currentPage: Math.max(0, index), scrollRequest: { index: Math.max(0, index), nonce: Date.now() + Math.random(), offsetY } }),
}));

export const ui = () => usePdfUi.getState();
