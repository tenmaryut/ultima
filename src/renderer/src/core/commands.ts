import { useEffect, useRef } from 'react';
import { useAppStore, type ModuleId } from './store';
import { desktop, isMac } from './platform';

/**
 * Application commands (menu items + global keyboard shortcuts). The active module
 * receives document commands (new/open/save/undo/...) through `useModuleCommands`.
 */
export type CommandId =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'export'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'duplicate'
  | 'select-all'
  | 'deselect'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'zoom-100'
  | 'toggle-ai'
  | 'go-home'
  | 'open-settings';

/** Return `false` from a handler to let the default behaviour happen. */
export type CommandHandler = () => void | boolean;
export type CommandMap = Partial<Record<CommandId, CommandHandler>>;

const registry = new Map<ModuleId, CommandMap>();

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(type);
  }
  return el.isContentEditable;
}

/** Runs a command. Returns true when something handled it. */
export function dispatchCommand(command: CommandId | string): boolean {
  const app = useAppStore.getState();
  switch (command) {
    case 'go-home':
      app.setActiveModule('home');
      return true;
    case 'open-settings':
      app.setActiveModule('settings');
      return true;
    case 'toggle-ai':
      app.toggleAIPanel();
      return true;
  }
  if ((command === 'undo' || command === 'redo') && isEditableTarget(document.activeElement)) {
    document.execCommand(command);
    return true;
  }
  if (command === 'select-all' && isEditableTarget(document.activeElement)) {
    document.execCommand('selectAll');
    return true;
  }
  const handler = registry.get(app.activeModule)?.[command as CommandId];
  if (!handler) return false;
  return handler() !== false;
}

/**
 * Registers document command handlers for a module. Handlers are read from a ref, so
 * inline closures are fine (always the latest render's version is called).
 */
export function useModuleCommands(moduleId: ModuleId, map: CommandMap): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const proxy: CommandMap = {};
    const ids: CommandId[] = [
      'new', 'open', 'save', 'save-as', 'export', 'undo', 'redo', 'delete', 'duplicate',
      'select-all', 'deselect', 'zoom-in', 'zoom-out', 'zoom-fit', 'zoom-100',
    ];
    for (const id of ids) {
      proxy[id] = () => {
        const fn = ref.current[id];
        return fn ? fn() : false;
      };
    }
    registry.set(moduleId, proxy);
    return () => {
      if (registry.get(moduleId) === proxy) registry.delete(moduleId);
    };
  }, [moduleId]);
}

/** Maps a keyboard event to a command id (or null). */
export function shortcutToCommand(e: KeyboardEvent): CommandId | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && !e.altKey) {
    if (key === 'z' && !e.shiftKey) return 'undo';
    if ((key === 'z' && e.shiftKey) || (key === 'y' && !isMac)) return 'redo';
    if (key === 'n' && !e.shiftKey) return 'new';
    if (key === 'o') return 'open';
    if (key === 's') return e.shiftKey ? 'save-as' : 'save';
    if (key === 'e') return 'export';
    if (key === 'd') return 'duplicate';
    if (key === '=' || key === '+') return 'zoom-in';
    if (key === '-' || key === '_') return 'zoom-out';
    if (key === '0') return 'zoom-fit';
    if (key === '1') return 'zoom-100';
    if (key === 'j') return 'toggle-ai';
    if (key === 'h' && e.shiftKey) return 'go-home';
    if (key === ',') return 'open-settings';
    if (key === 'a') return e.shiftKey ? 'deselect' : 'select-all';
  }
  if (!mod && !e.altKey && (key === 'delete' || key === 'backspace')) return 'delete';
  return null;
}

/** Installs the global shortcut listener and the desktop menu bridge. Call once in App. */
export function useGlobalCommands(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = shortcutToCommand(e);
      if (!command) return;
      const editable = isEditableTarget(e.target);
      // Inside text fields, leave plain editing keys alone.
      if (editable && (command === 'delete' || command === 'duplicate' || command === 'deselect')) return;
      if (editable && (command === 'undo' || command === 'redo')) {
        // The Edit menu items aren't roles, so do the text undo ourselves (needed on macOS).
        dispatchCommand(command);
        e.preventDefault();
        return;
      }
      if (dispatchCommand(command)) e.preventDefault();
      else if (['save', 'save-as', 'open', 'new', 'export', 'zoom-in', 'zoom-out', 'zoom-fit', 'zoom-100', 'select-all'].includes(command)) {
        e.preventDefault(); // never let the browser's own save/open/zoom dialogs appear
      }
    };
    window.addEventListener('keydown', onKey);
    const offMenu = desktop?.app.onMenuCommand((command) => dispatchCommand(command));
    return () => {
      window.removeEventListener('keydown', onKey);
      offMenu?.();
    };
  }, []);
}

/**
 * Keydown listener that is only active while `active` is true and ignores typing in
 * inputs. Use it for single-key tool shortcuts (V, B, E, ...).
 */
export function useModuleKeydown(active: boolean, handler: (e: KeyboardEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // A focused slider keeps its own arrow/Home/End/Page keys.
      const el = e.target as HTMLInputElement | null;
      if (el?.tagName === 'INPUT' && el.type === 'range' && /^(Arrow|Home$|End$|Page)/.test(e.key)) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
