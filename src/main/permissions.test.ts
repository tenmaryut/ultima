import { describe, expect, it } from 'vitest';
import { allowsPermission, restrictedFolderKind } from './permissions';

describe('permissions', () => {
  it('lets the app read a folder the user picked, also when Electron checks it as a subframe, but never write', () => {
    // what Electron 44 sends when a folder is picked: the request from the main frame, then checks without it
    expect(allowsPermission('fileSystem', { fileAccessType: 'readable', isMainFrame: true } as never)).toBe(true);
    expect(allowsPermission('fileSystem', { fileAccessType: 'readable', isMainFrame: false } as never)).toBe(true);
    expect(allowsPermission('fileSystem', { fileAccessType: 'writable' })).toBe(false);
    expect(allowsPermission('fileSystem')).toBe(false);
    expect(allowsPermission('media')).toBe(true);
    expect(allowsPermission('geolocation')).toBe(false);
  });

  it('tells the user’s own big folders and whole drives from system folders', () => {
    const home = ['/home/ana', '/home/ana/Desktop', '/home/ana/Documents', '/home/ana/Downloads'];
    expect(restrictedFolderKind('/home/ana', home, 'linux')).toBe('personal');
    expect(restrictedFolderKind('/home/ana/Documents/', home, 'linux')).toBe('personal');
    expect(restrictedFolderKind('/', home, 'linux')).toBe('personal');
    expect(restrictedFolderKind('/home/ana/.config', home, 'linux')).toBe('system');
    expect(restrictedFolderKind('/proc', home, 'linux')).toBe('system');
    const win = ['C:\\Users\\Ana', 'C:\\Users\\Ana\\Desktop', 'C:\\Users\\Ana\\Downloads'];
    expect(restrictedFolderKind('c:\\users\\ana\\desktop', win, 'win32')).toBe('personal');
    expect(restrictedFolderKind('D:\\', win, 'win32')).toBe('personal');
    expect(restrictedFolderKind('C:\\Windows', win, 'win32')).toBe('system');
    expect(restrictedFolderKind('C:\\Users\\Ana\\AppData\\Local', win, 'win32')).toBe('system');
  });
});
