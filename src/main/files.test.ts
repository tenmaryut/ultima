import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/ipc';

const root = mkdtempSync(join(tmpdir(), 'ultima-files-test-'));
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  openPath: vi.fn(async () => ''),
}));

vi.mock('electron', async () => {
  const path = await import('node:path');
  return {
    app: { getPath: (name: string) => path.join(root, name) },
    BrowserWindow: { fromWebContents: () => null },
    dialog: { showSaveDialog: electron.saveDialog, showOpenDialog: electron.openDialog },
    ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => electron.handlers.set(channel, fn), on: () => undefined },
    session: { fromPartition: () => ({}) },
    shell: { openPath: electron.openPath },
  };
});

const { exportFileName, exportFolderInfo, registerFileIpc } = await import('./files');
registerFileIpc();
const call = <T,>(channel: string, ...args: unknown[]) => electron.handlers.get(channel)!({ sender: {} }, ...args) as Promise<T>;
const videos = join(root, 'videos', 'Ultima');

describe('export folder', () => {
  beforeEach(async () => {
    electron.saveDialog.mockReset();
    electron.openDialog.mockReset();
    await call(IPC.exportFolderSet, { ask: false, reset: true });
  });

  it('makes safe file names with an export extension', () => {
    expect(exportFileName('My clip.mp4')).toBe('My clip.mp4');
    expect(exportFileName('a/b\\c:d*?.MP4')).toBe('c_d_.mp4');
    expect(exportFileName('montage.mp4. ')).toBe('montage.mp4');
    expect(exportFileName('CON.wav')).toBe('CON_.wav');
    expect(exportFileName(`${'x'.repeat(300)}.png`)).toBe(`${'x'.repeat(120)}.png`);
    expect(exportFileName('../../evil.exe')).toBeNull();
    expect(exportFileName('notes')).toBeNull();
  });

  it('saves exports in Videos/Ultima without asking, never over an older file', async () => {
    expect(exportFolderInfo()).toEqual({ path: videos, isDefault: true, ask: false });
    const first = await call<{ path: string }>(IPC.fileSave, { suggestedName: 'Montage.gif', data: 'one', toExportFolder: true });
    const second = await call<{ path: string }>(IPC.fileSave, { suggestedName: 'Montage.gif', data: 'two', toExportFolder: true });
    expect(first.path).toBe(join(videos, 'Montage.gif'));
    expect(second.path).toBe(join(videos, 'Montage (2).gif'));
    expect(readFileSync(first.path, 'utf8')).toBe('one');
    expect(readFileSync(second.path, 'utf8')).toBe('two');
    expect(electron.saveDialog).not.toHaveBeenCalled();
    // a streamed export too
    const writer = await call<{ id: string; path: string }>(IPC.fileWriterOpen, { suggestedName: 'Montage.mp4', toExportFolder: true });
    expect(writer.path).toBe(join(videos, 'Montage.mp4'));
    await call(IPC.fileWriterWrite, writer.id, new Uint8Array([1, 2, 3]));
    await call(IPC.fileWriterClose, writer.id);
    expect([...readFileSync(writer.path)]).toEqual([1, 2, 3]);
    // what is not an export still asks
    electron.saveDialog.mockResolvedValue({ canceled: true });
    expect(await call(IPC.fileSave, { suggestedName: 'run.sh', data: 'x', toExportFolder: true })).toBeNull();
    expect(electron.saveDialog).toHaveBeenCalledTimes(1);
  });

  it('uses the folder the user chose, or asks every time when they want that', async () => {
    const chosen = mkdtempSync(join(root, 'chosen-'));
    electron.openDialog.mockResolvedValue({ canceled: false, filePaths: [chosen] });
    expect(await call(IPC.exportFolderChoose)).toEqual({ path: chosen, isDefault: false, ask: false });
    const saved = await call<{ path: string }>(IPC.fileSave, { suggestedName: 'clip.wav', data: 'x', toExportFolder: true });
    expect(saved.path).toBe(join(chosen, 'clip.wav'));
    // cancelling the folder picker keeps the folder
    electron.openDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await call(IPC.exportFolderChoose)).toBeNull();
    expect(exportFolderInfo().path).toBe(chosen);
    // ask every time: the save dialog opens in the export folder
    await call(IPC.exportFolderSet, { ask: true });
    const picked = join(root, 'picked.mp4');
    electron.saveDialog.mockResolvedValue({ canceled: false, filePath: picked });
    const asked = await call<{ path: string }>(IPC.fileSave, { suggestedName: 'clip.mp4', data: 'y', toExportFolder: true });
    expect(asked.path).toBe(picked);
    expect(electron.saveDialog.mock.calls[0][0]).toMatchObject({ defaultPath: join(chosen, 'clip.mp4') });
    expect(existsSync(join(chosen, 'clip.mp4'))).toBe(false);
    // and back to Videos/Ultima
    expect(await call(IPC.exportFolderSet, { reset: true, ask: false })).toEqual({ path: videos, isDefault: true, ask: false });
  });
});
