import { join, posix, win32 } from 'node:path';

/*
 * What the app's pages may use (pure, unit tested). The window only ever shows Ultima itself, so the rules are about
 * which features, not which sites.
 */

const ALLOWED = new Set([
  'media', // microphone / camera for recording in Audio and Video
  'clipboard-sanitized-write',
  'clipboard-read',
  'fullscreen',
  'local-fonts',
  'notifications',
]);

/**
 * Whether a permission request or check is allowed. Folders the user picked for the Video Editor (File System Access
 * API) may be read, never written. (Electron checks folder access with `isMainFrame: false` even for the main
 * window, so the frame is not part of the rule.)
 */
export function allowsPermission(permission: string, details: { fileAccessType?: string } = {}): boolean {
  return ALLOWED.has(permission) || (permission === 'fileSystem' && details.fileAccessType === 'readable');
}

/**
 * A folder Chromium keeps from web pages, picked by the user: one of their own big folders (home, Desktop,
 * Documents, Downloads…) or a whole drive, which Ultima may read once they confirm, or a system or app folder, which
 * it never reads.
 */
export function restrictedFolderKind(path: string, personalFolders: string[], platform: NodeJS.Platform = process.platform): 'personal' | 'system' {
  const P = platform === 'win32' ? win32 : posix;
  // Windows and macOS folder names ignore case
  const norm = (p: string) => (platform === 'win32' || platform === 'darwin' ? P.resolve(p).toLowerCase() : P.resolve(p));
  const p = norm(path);
  if (P.dirname(p) === p) return 'personal';
  return personalFolders.some((f) => f && norm(f) === p) ? 'personal' : 'system';
}

/** "Videos/Outplayed" with the system's separator, for the hints. */
export const exampleClipFolder = () => join('Videos', 'Outplayed');
