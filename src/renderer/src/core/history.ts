import { useCallback, useRef, useState } from 'react';

/**
 * Snapshot based undo/redo for immutable document state.
 *
 *   const doc = useHistoryState<MyDoc>(initial);
 *   doc.set(next)                          // records an undo step
 *   doc.set(next, { record: false })       // live update while dragging (no step)
 *   doc.commit()                           // record a step after a series of live updates
 *   doc.undo(); doc.redo(); doc.reset(newDoc)
 */
export interface HistoryState<T> {
  present: T;
  set: (next: T | ((prev: T) => T), options?: { record?: boolean; label?: string }) => void;
  /** Records the current state as one undo step (use after `set(..., { record: false })`). */
  commit: (label?: string) => void;
  undo: () => void;
  redo: () => void;
  reset: (state: T) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Labels of the past steps, oldest first (for a History panel). */
  labels: string[];
  /** Jump to an entry in `labels` (index into past steps); -1 = the very first state. */
  jumpTo: (index: number) => void;
  /** The latest state, even inside stale closures (event handlers set up earlier). */
  current: () => T;
  /** Throws away live edits made with `set(..., { record: false })` since the last step. */
  discard: () => void;
}

interface Stacks<T> {
  past: { state: T; label: string }[];
  future: { state: T; label: string }[];
  /** State at the time of the last recorded step (base for live edits). */
  anchor: T;
}

export function useHistoryState<T>(initial: T | (() => T), limit = 150): HistoryState<T> {
  const [present, setPresent] = useState<T>(initial);
  const presentRef = useRef(present);
  presentRef.current = present;
  const stacks = useRef<Stacks<T>>({ past: [], future: [], anchor: present });
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const push = (state: T, label: string) => {
    const s = stacks.current;
    s.past.push({ state, label });
    if (s.past.length > limit) s.past.shift();
    s.future = [];
  };

  const set = useCallback<HistoryState<T>['set']>((next, options) => {
    const prev = presentRef.current;
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
    if (Object.is(value, prev)) return;
    const record = options?.record ?? true;
    if (record) {
      push(stacks.current.anchor, options?.label ?? 'Edit');
      stacks.current.anchor = value;
    }
    presentRef.current = value;
    setPresent(value);
    rerender();
  }, []);

  const commit = useCallback((label = 'Edit') => {
    const s = stacks.current;
    if (Object.is(s.anchor, presentRef.current)) return;
    push(s.anchor, label);
    s.anchor = presentRef.current;
    rerender();
  }, []);

  const undo = useCallback(() => {
    const s = stacks.current;
    const entry = s.past.pop();
    if (!entry) return;
    s.future.push({ state: presentRef.current, label: entry.label });
    s.anchor = entry.state;
    presentRef.current = entry.state;
    setPresent(entry.state);
    rerender();
  }, []);

  const redo = useCallback(() => {
    const s = stacks.current;
    const entry = s.future.pop();
    if (!entry) return;
    s.past.push({ state: presentRef.current, label: entry.label });
    s.anchor = entry.state;
    presentRef.current = entry.state;
    setPresent(entry.state);
    rerender();
  }, []);

  const reset = useCallback((state: T) => {
    stacks.current = { past: [], future: [], anchor: state };
    presentRef.current = state;
    setPresent(state);
    rerender();
  }, []);

  const getCurrent = useCallback(() => presentRef.current, []);

  const discard = useCallback(() => {
    const anchor = stacks.current.anchor;
    if (Object.is(anchor, presentRef.current)) return;
    presentRef.current = anchor;
    setPresent(anchor);
    rerender();
  }, []);

  const jumpTo = useCallback(
    (index: number) => {
      const s = stacks.current;
      // number of undos needed so that past.length === index + 1
      const target = index + 1;
      while (s.past.length > target) undo();
      while (s.past.length < target && s.future.length) redo();
    },
    [undo, redo],
  );

  return {
    present,
    set,
    commit,
    undo,
    redo,
    reset,
    canUndo: stacks.current.past.length > 0,
    canRedo: stacks.current.future.length > 0,
    labels: stacks.current.past.map((p) => p.label),
    jumpTo,
    current: getCurrent,
    discard,
  };
}
