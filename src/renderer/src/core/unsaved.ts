import { useEffect } from 'react';

/** Modules that currently hold unsaved changes. Closing the window asks first while any do. */
const unsaved = new Set<string>();
/** Last state each module reported (survives the module unmounting). */
const lastKnown = new Map<string, boolean>();
/** Modules that crashed with unsaved changes: their documents are still in memory. */
const crashed = new Set<string>();

export function hasUnsavedWork(): boolean {
  return unsaved.size > 0 || crashed.size > 0;
}

/** Reports whether a module has unsaved changes (ModuleLayout calls it with its `dirty` prop). */
export function useUnsavedWork(moduleId: string, dirty: boolean): void {
  useEffect(() => {
    lastKnown.set(moduleId, dirty);
    if (!dirty) return;
    unsaved.add(moduleId);
    return () => {
      unsaved.delete(moduleId);
    };
  }, [moduleId, dirty]);
}

/** A module crashed (error boundary): keep asking on close if it had unsaved changes. */
export function keepUnsavedAfterCrash(moduleId: string): void {
  if (lastKnown.get(moduleId)) crashed.add(moduleId);
}

/** The crashed module was reloaded and reports its own state again. */
export function releaseCrashedModule(moduleId: string): void {
  crashed.delete(moduleId);
}

/**
 * Asks before the window closes or reloads while there are unsaved changes. The browser shows
 * its own prompt; the desktop app shows a dialog from the main process (will-prevent-unload).
 */
export function useUnsavedGuard(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedWork()) return;
      e.preventDefault();
      e.returnValue = 'unsaved';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
