import { useSyncExternalStore } from 'react';

/** Tiny external store for the playhead time (updated at 60 fps without re-rendering the module). */
export interface TimeStore {
  get(): number;
  set(t: number): void;
  subscribe(fn: () => void): () => void;
}

export function createTimeStore(initial = 0): TimeStore {
  let time = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    set: (t: number) => {
      if (t === time || !Number.isFinite(t)) return;
      time = t;
      listeners.forEach((l) => l());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** Re-renders the calling component whenever the playhead moves. Keep such components small. */
export function usePlayhead(store: TimeStore): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
