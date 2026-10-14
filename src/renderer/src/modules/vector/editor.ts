import { createContext, useContext } from 'react';
import type { HistoryState } from '../../core/history';
import type { Artboard, Style, VDoc, VObject } from './model';
import type { VectorViewport } from './viewport';

export type ToolId =
  | 'select'
  | 'direct'
  | 'pen'
  | 'pencil'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'text'
  | 'eyedropper'
  | 'hand'
  | 'zoom';

export interface ToolOptions {
  sides: number;
  points: number;
  inner: number;
  radius: number;
  /** Pencil smoothing 0..100 */
  smoothing: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
}

export interface ViewOptions {
  grid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  smartGuides: boolean;
  outline: boolean;
  alignTo: 'selection' | 'artboard';
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  sides: 6,
  points: 5,
  inner: 0.5,
  radius: 0,
  smoothing: 40,
  fontFamily: 'Inter',
  fontSize: 48,
  fontWeight: 400,
};

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  grid: false,
  gridSize: 20,
  snapToGrid: false,
  smartGuides: true,
  outline: false,
  alignTo: 'selection',
};

export interface FileInfo {
  /** Desktop path of the .ultima project (for Save without dialog). */
  path?: string;
  /** Last saved/opened document (dirty check by identity). */
  savedDoc: VDoc | null;
}

/** Everything the panels, canvas and tools share. */
export interface EditorCore {
  history: HistoryState<VDoc>;
  doc: VDoc;
  /** Records one undo step. */
  update: (fn: (doc: VDoc) => VDoc, label?: string) => void;
  /** Live change without an undo step (call `commit` afterwards). */
  updateLive: (fn: (doc: VDoc) => VDoc) => void;
  commit: (label?: string) => void;
  updateObjects: (fn: (objects: VObject[]) => VObject[], label?: string) => void;
  selection: string[];
  setSelection: (ids: string[]) => void;
  /** Selected path nodes: "objectId:subpath:index". */
  nodeSel: string[];
  setNodeSel: (keys: string[]) => void;
  /** Group the user entered (double click) — clicks select inside it. */
  scope: string | null;
  setScope: (id: string | null) => void;
  tool: ToolId;
  setTool: (tool: ToolId) => void;
  options: ToolOptions;
  setOptions: (patch: Partial<ToolOptions>) => void;
  viewOpts: ViewOptions;
  setViewOpts: (patch: Partial<ViewOptions>) => void;
  /** Fill/stroke used for new objects. */
  style: Style;
  setStyle: (style: Style) => void;
  paintTarget: 'fill' | 'stroke';
  setPaintTarget: (t: 'fill' | 'stroke') => void;
  editingText: string | null;
  setEditingText: (id: string | null) => void;
  viewport: VectorViewport;
  fonts: string[];
  loadFonts: () => void;
  activeArtboard: Artboard;
  file: FileInfo;
  setFile: (f: FileInfo) => void;
  active: boolean;
}

export const EditorContext = createContext<EditorCore | null>(null);

export function useEditor(): EditorCore {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('Vector editor context missing');
  return ctx;
}

export function nodeKey(id: string, sub: number, idx: number): string {
  return `${id}:${sub}:${idx}`;
}

export function parseNodeKey(key: string): { id: string; sub: number; idx: number } | null {
  const parts = key.split(':');
  if (parts.length < 3) return null;
  const idx = Number(parts.pop());
  const sub = Number(parts.pop());
  const id = parts.join(':');
  return Number.isFinite(sub) && Number.isFinite(idx) ? { id, sub, idx } : null;
}
