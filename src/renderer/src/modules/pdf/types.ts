/**
 * PDF Studio document model. Everything here is plain JSON (immutable updates) so the
 * whole document lives in one `useHistoryState` for undo/redo and can be saved in an
 * Ultima project file.
 */
import type { Rect, Rotation, ViewBox } from './geometry';
import type { FontFamily, TextAlign } from './textlayout';

/** One page of the document, pointing at a page of a loaded source PDF. */
export interface PageEntry {
  /** Stable id (annotations reference it). */
  id: string;
  /** Source document id (see engine.ts). */
  src: string;
  /** 0-based page index inside the source. */
  index: number;
  /** Extra clockwise rotation added by the user (on top of the source page's /Rotate). */
  rotate: Rotation;
}

export type AnnotType =
  | 'text'
  | 'ink'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'image'
  | 'stamp'
  | 'whiteout'
  | 'note'
  | 'redact';

interface AnnotBase {
  id: string;
  /** PageEntry.id */
  page: string;
}

/** Objects whose content reads upright: `rot` = page display rotation it was created for. */
interface Upright {
  rect: Rect;
  rot: Rotation;
}

export interface TextAnnot extends AnnotBase, Upright {
  type: 'text';
  text: string;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  size: number;
  color: string;
  align: TextAlign;
  /** Box grows with the text (no wrapping) until the user resizes it. */
  autoWidth: boolean;
  /** Optional background fill (null = transparent). */
  background: string | null;
  /** Optional border color (date stamps). */
  border: string | null;
}

export interface InkAnnot extends AnnotBase {
  type: 'ink';
  /** Each stroke is a flat list x0, y0, x1, y1, ... in user space. */
  strokes: number[][];
  color: string;
  width: number;
  opacity: number;
}

export interface MarkupAnnot extends AnnotBase {
  type: 'highlight' | 'underline' | 'strike';
  rects: Rect[];
  color: string;
  opacity: number;
}

export interface ShapeAnnot extends AnnotBase {
  type: 'rect' | 'ellipse';
  rect: Rect;
  stroke: string;
  fill: string | null;
  width: number;
  opacity: number;
}

export interface LineAnnot extends AnnotBase {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  opacity: number;
}

export interface ImageAnnot extends AnnotBase, Upright {
  type: 'image';
  /** data: URL (PNG or JPEG). */
  src: string;
  /** "signature" images are listed separately in the UI. */
  kind: 'image' | 'signature';
  opacity: number;
}

export interface StampAnnot extends AnnotBase, Upright {
  type: 'stamp';
  label: string;
  color: string;
}

export interface WhiteoutAnnot extends AnnotBase {
  type: 'whiteout';
  rect: Rect;
  color: string;
}

export interface NoteAnnot extends AnnotBase, Upright {
  type: 'note';
  text: string;
  color: string;
  author: string;
  createdAt: number;
}

export interface RedactAnnot extends AnnotBase {
  type: 'redact';
  rect: Rect;
}

export type Annot =
  | TextAnnot
  | InkAnnot
  | MarkupAnnot
  | ShapeAnnot
  | LineAnnot
  | ImageAnnot
  | StampAnnot
  | WhiteoutAnnot
  | NoteAnnot
  | RedactAnnot;

export type FieldValue = string | boolean | string[];

export interface DocMeta {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
}

/** The undoable document state. */
export interface DocState {
  pages: PageEntry[];
  annots: Annot[];
  /** Current values of the main source's form fields (by fully qualified name). */
  fields: Record<string, FieldValue>;
  meta: DocMeta;
}

export const EMPTY_META: DocMeta = { title: '', author: '', subject: '', keywords: '', creator: '' };

export const EMPTY_DOC: DocState = { pages: [], annots: [], fields: {}, meta: EMPTY_META };

/* ------------------------------- Forms ---------------------------------- */

export type FieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'optionlist' | 'button' | 'signature';

export interface FieldWidget {
  /** 0-based page index in the main source. */
  srcIndex: number;
  rect: Rect;
  /** Export value of this widget (radio buttons / checkboxes). */
  option?: string;
}

export interface FieldDef {
  name: string;
  type: FieldType;
  options: string[];
  multiline: boolean;
  multiSelect: boolean;
  /** Combo box that also accepts typed values. */
  editable: boolean;
  readOnly: boolean;
  required: boolean;
  maxLength: number | null;
  /** Font size from the field's default appearance (0 = auto). */
  fontSize: number;
  widgets: FieldWidget[];
}

/* ------------------------------ Outline --------------------------------- */

export interface OutlineNode {
  title: string;
  /** 0-based page index in the main source (null when it points nowhere / to a URL). */
  srcIndex: number | null;
  url: string | null;
  bold: boolean;
  italic: boolean;
  items: OutlineNode[];
}

/** Page geometry of a source page (from pdf.js). */
export interface PageInfo {
  view: ViewBox;
  /** The page's own /Rotate (normalized). */
  rotate: Rotation;
  userUnit: number;
}

/* ------------------------------- Tools ---------------------------------- */

export type ToolId =
  | 'select'
  | 'hand'
  | 'text'
  | 'ink'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'image'
  | 'stamp'
  | 'signature'
  | 'whiteout'
  | 'note'
  | 'date'
  | 'redact';

/** Remembered tool settings (style of new objects). */
export interface ToolStyle {
  color: string;
  strokeWidth: number;
  opacity: number;
  fill: string | null;
  highlightColor: string;
  font: FontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  stamp: string;
  stampColor: string;
  noteColor: string;
  dateFormat: 'iso' | 'local' | 'long';
}

export const DEFAULT_TOOL_STYLE: ToolStyle = {
  color: '#e11d48',
  strokeWidth: 2,
  opacity: 1,
  fill: null,
  highlightColor: '#ffe14d',
  font: 'helvetica',
  fontSize: 12,
  bold: false,
  italic: false,
  textColor: '#111111',
  stamp: 'APPROVED',
  stampColor: '#15803d',
  noteColor: '#facc15',
  dateFormat: 'local',
};

export const BUILTIN_STAMPS: { label: string; color: string }[] = [
  { label: 'APPROVED', color: '#15803d' },
  { label: 'DRAFT', color: '#1d4ed8' },
  { label: 'CONFIDENTIAL', color: '#b91c1c' },
  { label: 'PAID', color: '#047857' },
  { label: 'COPY', color: '#475569' },
];

/** Text a stamp shows: built-in stamps in the UI language, custom text as typed (upper case). */
export function stampText(label: string, translate: (text: string) => string): string {
  const raw = label.trim();
  return (BUILTIN_STAMPS.some((s) => s.label === raw) ? translate(raw) : raw).toUpperCase();
}

export function isUpright(a: Annot): a is TextAnnot | ImageAnnot | StampAnnot | NoteAnnot {
  return a.type === 'text' || a.type === 'image' || a.type === 'stamp' || a.type === 'note';
}
