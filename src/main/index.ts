import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron';
import { join } from 'node:path';
import { IPC, type AppInfo } from '@shared/ipc';
import { buildAppMenu } from './menu';
import { closeAllWriters, filterOpenablePaths, registerFileIpc } from './files';
import { fixPathEnv } from './path-env';
import { registerAIIpc } from './ai/service';
import { registerToolsIpc } from './tools';
import { registerMediaIpc } from './media';
import { killAllProcesses } from './ai/exec';
import { mt, setMainLanguage } from './i18n';

app.setName('Ultima');

let mainWindow: BrowserWindow | null = null;
/** Files the OS asked us to open before the renderer was ready to receive them. */
let pendingOpen: string[] = process.argv.slice(app.isPackaged ? 1 : 2);

async function deliverPaths(paths: string[], cwd?: string): Promise<void> {
  const files = await filterOpenablePaths(paths, cwd);
  if (!files.length) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(IPC.openPaths, files);
    return;
  }
  pendingOpen.push(...files.map((f) => f.path));
  // macOS keeps running without windows: open one so the file actually shows up.
  if (!mainWindow && app.isReady()) createWindow();
}

// macOS: double-click / "Open With" / drop on the Dock icon (can fire before ready).
app.on('open-file', (event, path) => {
  event.preventDefault();
  if (app.isReady()) void deliverPaths([path]);
  else pendingOpen.push(path);
});

function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Ultima',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#f4f5f7',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: process.platform === 'linux' ? join(__dirname, '../../resources/icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // The renderer blocks unloading (beforeunload) while documents have unsaved changes.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (!mainWindow) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Ultima',
      message: mt('You have unsaved changes.'),
      detail: mt('If you close Ultima now, those changes will be lost.'),
      buttons: [mt('Close without saving'), mt('Cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice === 0) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Never open new Electron windows; send links to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The window only ever shows Ultima itself. Block every navigation (dropped files would
  // otherwise replace the app with a file view) and send web links to the browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? '';
    if (url.split('#')[0] === current.split('#')[0]) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function configurePermissions(): void {
  const allowed = new Set([
    'media', // microphone / camera for recording in Audio and Video
    'clipboard-sanitized-write',
    'clipboard-read',
    'fullscreen',
    'local-fonts',
    'notifications',
  ]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function registerAppIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
  }));
  ipcMain.handle(IPC.openExternal, async (_event, url: string) => {
    if (typeof url === 'string' && isSafeExternalUrl(url)) await shell.openExternal(url);
  });
  ipcMain.handle(IPC.showItemInFolder, (_event, path: string) => {
    if (typeof path === 'string' && path) shell.showItemInFolder(path);
  });
  ipcMain.handle(IPC.pendingPaths, async () => {
    const paths = pendingOpen;
    pendingOpen = [];
    return filterOpenablePaths(paths);
  });
  ipcMain.on(IPC.setLanguage, (_event, language: unknown) => setMainLanguage(language));
  ipcMain.on(IPC.setTitle, (event, title: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && typeof title === 'string') win.setTitle(title.slice(0, 200));
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Relative paths are relative to where the second instance was started.
    void deliverPaths(argv.slice(1), workingDirectory);
  });

  app.whenReady().then(async () => {
    await fixPathEnv().catch((error) => console.warn('[ultima] PATH fix failed', error));
    configurePermissions();
    registerAppIpc();
    registerFileIpc();
    registerAIIpc();
    registerToolsIpc();
    registerMediaIpc();
    buildAppMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Not before-quit: closing can still be cancelled there (unsaved changes dialog).
  app.on('will-quit', () => {
    killAllProcesses();
    void closeAllWriters();
  });
}
