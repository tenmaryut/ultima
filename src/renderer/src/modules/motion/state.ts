import { createContext, useContext, useSyncExternalStore } from 'react';
import type { HistoryState } from '../../core/history';
import type { CopiedKeyframe } from './ops';
import type { Keyframe, KeyRef, MotionDoc, PropKey } from './types';

/** Editor-wide state shared by the stage, timeline and panels. */

/* -------------------------------- Time store ------------------------------- */

export interface TimeStore {
  get(): number;
  set(t: number): void;
  subscribe(fn: () => void): () => void;
}

export function createTimeStore(initial = 0): TimeStore {
  let t = initial;
  const subs = new Set<() => void>();
  return {
    get: () => t,
    set: (v) => {
      if (v === t || !Number.isFinite(v)) return;
      t = v;
      for (const fn of subs) fn();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Current playhead time (re-renders the caller when it changes). */
export function useTime(store: TimeStore): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/* --------------------------------- Tools ---------------------------------- */

export type ToolId = 'select' | 'anchor' | 'hand' | 'text' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'pen';

/* ------------------------------- Clipboard -------------------------------- */

/** In-memory clipboard shared by copy/paste of keyframes and layers. */
export const clipboard: {
  keys: CopiedKeyframe[] | null;
  layers: MotionDoc['layers'] | null;
  assets: MotionDoc['assets'];
} = { keys: null, layers: null, assets: {} };

/* -------------------------------- Context --------------------------------- */

export interface EditorApi {
  doc: MotionDoc;
  history: HistoryState<MotionDoc>;
  /** Updates the document; `record: false` for live drags (call commit() on release). */
  setDoc: (next: MotionDoc | ((d: MotionDoc) => MotionDoc), options?: { record?: boolean; label?: string }) => void;
  commit: (label?: string) => void;
  time: TimeStore;
  /** Moves the playhead (snapped to frames, clamped to the composition). */
  seek: (t: number) => void;
  playing: boolean;
  togglePlay: () => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  selectedKeys: ReadonlySet<string>;
  setSelectedKeys: (ids: ReadonlySet<string>) => void;
  /** Index of every keyframe id → its layer/property (for selection operations). */
  keyIndex: Map<string, KeyRef>;
  tool: ToolId;
  setTool: (tool: ToolId) => void;
  /** Asks the properties panel to focus the text field of a text layer. */
  editText: (layerId: string) => void;
  snapping: boolean;
  setSnapping: (on: boolean) => void;
  /** "U": shows only the animated properties of the selected (or all) layers. */
  revealAnimated: () => void;
  /** Scale X/Y edited together (keeps the ratio). */
  scaleLinked: boolean;
  setScaleLinked: (linked: boolean) => void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error('Motion editor context missing');
  return api;
}

/** Builds keyId → {layerId, prop, keyId}. */
export function buildKeyIndex(doc: MotionDoc): Map<string, KeyRef> {
  const map = new Map<string, KeyRef>();
  for (const layer of doc.layers) {
    for (const [prop, anim] of Object.entries(layer.props) as [PropKey, { keyframes: Keyframe[] }][]) {
      for (const k of anim.keyframes) map.set(k.id, { layerId: layer.id, prop, keyId: k.id });
    }
  }
  return map;
}
