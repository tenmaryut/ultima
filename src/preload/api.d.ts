import type { UltimaDesktopAPI } from '../shared/ipc';

declare global {
  interface Window {
    /** Present only inside the desktop (Electron) app. */
    ultima?: UltimaDesktopAPI;
  }
}

export {};
