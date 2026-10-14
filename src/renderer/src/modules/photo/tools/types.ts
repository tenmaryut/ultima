import type { PhotoEngine } from '../engine';

export interface ToolEvent {
  /** Document coordinates (floating point). */
  x: number;
  y: number;
  /** Screen coordinates relative to the canvas viewport (CSS px). */
  sx: number;
  sy: number;
  /** 0..1 (pen pressure; 1 for mouse/touch). */
  pressure: number;
  pen: boolean;
  shift: boolean;
  alt: boolean;
  /** Ctrl (Windows/Linux) or Cmd (macOS). */
  mod: boolean;
  button: number;
}

export interface ToolHandler {
  /** CSS cursor for the canvas. */
  cursor?: (engine: PhotoEngine) => string;
  /** Diameter (doc px) of the brush outline to draw at the pointer, or 0. */
  brushSize?: (engine: PhotoEngine) => number;
  down?: (engine: PhotoEngine, e: ToolEvent) => void;
  move?: (engine: PhotoEngine, e: ToolEvent) => void;
  up?: (engine: PhotoEngine, e: ToolEvent) => void;
  hover?: (engine: PhotoEngine, e: ToolEvent) => void;
  dblclick?: (engine: PhotoEngine, e: ToolEvent) => void;
  /** Return true when the key was handled. */
  key?: (engine: PhotoEngine, e: KeyboardEvent) => boolean;
  /** Draws tool feedback; ctx is in screen CSS px (the engine handles devicePixelRatio). */
  overlay?: (engine: PhotoEngine, ctx: CanvasRenderingContext2D) => void;
  activate?: (engine: PhotoEngine) => void;
  /** Called when switching to another tool or document (commit or cancel pending work). */
  deactivate?: (engine: PhotoEngine) => void;
}
