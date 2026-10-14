/**
 * Editor state: open documents (each with its own undo history), the active tool, tool
 * options and colors. Tool options/colors are remembered between sessions.
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { uid } from '../../core/utils/id';
import type { ViewState } from '../../core/viewport';
import { DocHistory } from './history';
import { docMemory } from './doc';
import { DEFAULT_TOOL_OPTIONS, type PhotoDoc, type ToolId, type ToolOptions } from './types';

export interface Session {
  id: string;
  name: string;
  /** Project path on disk (desktop) for Save. */
  path?: string;
  history: DocHistory<PhotoDoc>;
  /** Document state at the last save. */
  saved: PhotoDoc | null;
  view?: ViewState;
}

export interface PhotoState {
  sessions: Session[];
  activeId: string | null;
  tool: ToolId;
  opts: ToolOptions;
  fg: string;
  bg: string;
  /** Paint on the active layer's mask instead of its pixels. */
  maskEdit: boolean;
  fonts: string[];
  editingTextId: string | null;
  untitled: number;
  /** Free Transform is active on the canvas. */
  transforming: boolean;

  setTool: (tool: ToolId) => void;
  setOpt: <K extends keyof ToolOptions>(key: K, patch: Partial<ToolOptions[K]> | ToolOptions[K]) => void;
  setColors: (fg?: string, bg?: string) => void;
  swapColors: () => void;
  resetColors: () => void;
  setMaskEdit: (on: boolean) => void;
  setFonts: (fonts: string[]) => void;
  setEditingText: (id: string | null) => void;
  setTransforming: (on: boolean) => void;
  openSession: (doc: PhotoDoc, name: string, label?: string, path?: string) => Session;
  closeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  nextUntitled: () => string;
  markSaved: (id: string, path?: string, name?: string) => void;
}

export const HISTORY_MAX_STEPS = 60;
export const HISTORY_MAX_BYTES = 1.2 * 1024 * 1024 * 1024;

export function createHistory(doc: PhotoDoc, label: string): DocHistory<PhotoDoc> {
  return new DocHistory<PhotoDoc>(doc, label, { maxSteps: HISTORY_MAX_STEPS, maxBytes: HISTORY_MAX_BYTES, estimate: docMemory });
}

function mergeOptions(saved: Partial<ToolOptions> | undefined): ToolOptions {
  const out = { ...DEFAULT_TOOL_OPTIONS } as Record<string, unknown>;
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(DEFAULT_TOOL_OPTIONS) as (keyof ToolOptions)[]) {
      const def = DEFAULT_TOOL_OPTIONS[key];
      const val = (saved as Record<string, unknown>)[key];
      if (typeof def === 'object' && def && val && typeof val === 'object') out[key] = { ...def, ...val };
      else if (typeof def === typeof val) out[key] = val;
    }
  }
  return out as unknown as ToolOptions;
}

export const usePhotoStore = create<PhotoState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,
      tool: 'brush',
      opts: DEFAULT_TOOL_OPTIONS,
      fg: '#000000',
      bg: '#ffffff',
      maskEdit: false,
      fonts: [],
      editingTextId: null,
      untitled: 0,
      transforming: false,

      setTool: (tool) => set({ tool }),
      setOpt: (key, patch) => set((s) => ({ opts: { ...s.opts, [key]: typeof patch === 'object' ? { ...(s.opts[key] as object), ...patch } : patch } })),
      setColors: (fg, bg) => set((s) => ({ fg: fg ?? s.fg, bg: bg ?? s.bg })),
      swapColors: () => set((s) => ({ fg: s.bg, bg: s.fg })),
      resetColors: () => set({ fg: '#000000', bg: '#ffffff' }),
      setMaskEdit: (maskEdit) => set({ maskEdit }),
      setFonts: (fonts) => set({ fonts }),
      setEditingText: (editingTextId) => set({ editingTextId }),
      setTransforming: (transforming) => set({ transforming }),
      openSession: (doc, name, label = 'Open', path) => {
        const session: Session = { id: uid('doc'), name, path, history: createHistory(doc, label), saved: path ? doc : null };
        set((s) => ({ sessions: [...s.sessions, session], activeId: session.id, maskEdit: false, editingTextId: null }));
        return session;
      },
      closeSession: (id) =>
        set((s) => {
          const index = s.sessions.findIndex((x) => x.id === id);
          const sessions = s.sessions.filter((x) => x.id !== id);
          const activeId = s.activeId === id ? (sessions[Math.min(index, sessions.length - 1)]?.id ?? null) : s.activeId;
          return { sessions, activeId, editingTextId: null };
        }),
      setActiveSession: (id) => set({ activeId: id, maskEdit: false, editingTextId: null }),
      nextUntitled: () => {
        const n = get().untitled + 1;
        set({ untitled: n });
        return `Untitled-${n}`;
      },
      markSaved: (id, path, name) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, path: path ?? x.path, name: name ?? x.name, saved: x.history.present } : x)),
        })),
    }),
    {
      name: 'ultima-photo',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ opts: s.opts, fg: s.fg, bg: s.bg, tool: s.tool }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PhotoState>;
        return {
          ...current,
          opts: mergeOptions(p.opts),
          fg: typeof p.fg === 'string' ? p.fg : current.fg,
          bg: typeof p.bg === 'string' ? p.bg : current.bg,
          tool: typeof p.tool === 'string' ? p.tool : current.tool,
        };
      },
    },
  ),
);

export function activeSession(): Session | null {
  const s = usePhotoStore.getState();
  return s.sessions.find((x) => x.id === s.activeId) ?? null;
}

export function useActiveSession(): Session | null {
  return usePhotoStore((s) => s.sessions.find((x) => x.id === s.activeId) ?? null);
}

const noop = () => () => undefined;

/** Re-renders when the history changes; returns its version. */
export function useHistoryVersion(history: DocHistory<PhotoDoc> | null | undefined): number {
  return useSyncExternalStore(history ? (fn) => history.subscribe(fn) : noop, () => history?.version ?? -1);
}

export function isDirty(session: Session): boolean {
  return session.history.present !== session.saved && (session.saved !== null || session.history.past.length > 0 || session.history.hasLiveChanges);
}
