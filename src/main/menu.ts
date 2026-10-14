import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '@shared/ipc';

const REPO_URL = 'https://github.com/tenmaryut/ultima';

/**
 * Menu items that act on the current document are forwarded to the renderer as
 * commands. Their accelerators are only displayed (registerAccelerator: false):
 * the renderer handles the keyboard shortcuts itself so they work the same in the
 * desktop app and in the browser build.
 */
function command(label: string, id: string, accelerator?: string): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    registerAccelerator: false,
    click: (_item, window) => {
      const target = (window as BrowserWindow | undefined) ?? BrowserWindow.getFocusedWindow();
      target?.webContents.send(IPC.menuCommand, id);
    },
  };
}

export function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              command('Settings…', 'open-settings', 'Cmd+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        command('Home', 'go-home', 'CmdOrCtrl+Shift+H'),
        { type: 'separator' },
        command('New', 'new', 'CmdOrCtrl+N'),
        command('Open…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        command('Save', 'save', 'CmdOrCtrl+S'),
        command('Save As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        command('Export…', 'export', 'CmdOrCtrl+E'),
        { type: 'separator' },
        ...(isMac ? [] : [command('Settings', 'open-settings', 'Ctrl+,'), { type: 'separator' } as MenuItemConstructorOptions]),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        command('Undo', 'undo', 'CmdOrCtrl+Z'),
        command('Redo', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        command('Delete', 'delete', 'Delete'),
        // Custom item (not the selectAll role) so editors receive it; text fields still
        // get a normal select-all from the renderer.
        command('Select All', 'select-all', 'CmdOrCtrl+A'),
      ],
    },
    {
      label: 'View',
      submenu: [
        command('Zoom In', 'zoom-in', 'CmdOrCtrl+='),
        command('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
        command('Fit to Screen', 'zoom-fit', 'CmdOrCtrl+0'),
        command('Actual Size', 'zoom-100', 'CmdOrCtrl+1'),
        { type: 'separator' },
        command('Toggle AI Assistant', 'toggle-ai', 'CmdOrCtrl+J'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? ([{ role: 'front' }] as MenuItemConstructorOptions[]) : [])],
    },
    {
      role: 'help',
      submenu: [
        { label: 'User Guide', click: () => shell.openExternal(`${REPO_URL}/blob/main/docs/USER_GUIDE.md`) },
        { label: 'Connect your AI subscription', click: () => shell.openExternal(`${REPO_URL}/blob/main/docs/AI_SETUP.md`) },
        { label: 'Report an Issue', click: () => shell.openExternal(`${REPO_URL}/issues`) },
        { type: 'separator' },
        { label: 'Source Code (GitHub)', click: () => shell.openExternal(REPO_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
