/**
 * Per-photo undo history (pure). Live edits (slider drags) change a photo's settings
 * without recording; `commitHistory` then records one labelled step from the "anchor"
 * (the settings at the previous step).
 */
import type { DevelopSettings } from './params';
import { settingsEqual } from './params';

export interface HistoryEntry {
  settings: DevelopSettings;
  label: string;
}

export interface PhotoHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Settings at the last recorded step. */
  anchor: DevelopSettings;
}

export const HISTORY_LIMIT = 100;

export function newHistory(settings: DevelopSettings): PhotoHistory {
  return { past: [], future: [], anchor: settings };
}

/**
 * Records the change from the anchor to `current` as one step (no-op when unchanged).
 * With `merge`, a change carrying the same label as the previous step extends that step
 * instead (keyboard nudges, quick repeated drags of one slider).
 */
export function commitHistory(h: PhotoHistory, current: DevelopSettings, label: string, merge = false): PhotoHistory {
  if (settingsEqual(h.anchor, current)) return h.anchor === current ? h : { ...h, anchor: current };
  const last = h.past[h.past.length - 1];
  if (merge && last && last.label === label) return { past: h.past, future: [], anchor: current };
  const past = [...h.past, { settings: h.anchor, label }];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [], anchor: current };
}

export function undoHistory(h: PhotoHistory, current: DevelopSettings): { history: PhotoHistory; settings: DevelopSettings } | null {
  // uncommitted live edit: undo goes back to the anchor first
  if (!settingsEqual(h.anchor, current)) {
    return { history: { past: h.past, future: [{ settings: current, label: 'Edit' }], anchor: h.anchor }, settings: h.anchor };
  }
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, { settings: current, label: entry.label }], anchor: entry.settings },
    settings: entry.settings,
  };
}

export function redoHistory(h: PhotoHistory, current: DevelopSettings): { history: PhotoHistory; settings: DevelopSettings } | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return {
    history: { past: [...h.past, { settings: current, label: entry.label }], future: h.future.slice(0, -1), anchor: entry.settings },
    settings: entry.settings,
  };
}

/** Jumps to a step: index into `past` (-1 = the original state). */
export function jumpHistory(h: PhotoHistory, current: DevelopSettings, index: number): { history: PhotoHistory; settings: DevelopSettings } {
  let state = { history: h, settings: current };
  const target = index + 1;
  let guard = 0;
  while (state.history.past.length > target && guard++ < 1000) {
    const r = undoHistory(state.history, state.settings);
    if (!r) break;
    state = r;
  }
  while (state.history.past.length < target && state.history.future.length && guard++ < 2000) {
    const r = redoHistory(state.history, state.settings);
    if (!r) break;
    state = r;
  }
  return state;
}
