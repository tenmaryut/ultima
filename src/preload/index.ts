import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type UltimaDesktopAPI } from '@shared/ipc';
import type { AIChunkEvent, AIRunRequest } from '@shared/ai-types';

function unwrapModels(result: { ok: boolean; models?: string[]; error?: string }): string[] {
  if (!result?.ok) throw new Error(result?.error || 'Not reachable');
  return result.models ?? [];
}

const api: UltimaDesktopAPI = {
  isDesktop: true,
  platform: process.platform,
  app: {
    getInfo: () => ipcRenderer.invoke(IPC.appInfo),
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
    showItemInFolder: (path) => ipcRenderer.invoke(IPC.showItemInFolder, path),
    setTitle: (title) => ipcRenderer.send(IPC.setTitle, title),
    setLanguage: (language) => ipcRenderer.send(IPC.setLanguage, language),
    onMenuCommand: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
      ipcRenderer.on(IPC.menuCommand, listener);
      return () => ipcRenderer.removeListener(IPC.menuCommand, listener);
    },
    onOpenPaths: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, files: { path: string; name: string }[]) => callback(files);
      ipcRenderer.on(IPC.openPaths, listener);
      return () => ipcRenderer.removeListener(IPC.openPaths, listener);
    },
    pendingPaths: () => ipcRenderer.invoke(IPC.pendingPaths),
  },
  files: {
    save: (options) => ipcRenderer.invoke(IPC.fileSave, options),
    openWriter: (options) => ipcRenderer.invoke(IPC.fileWriterOpen, options),
    write: (id, chunk, position) => ipcRenderer.invoke(IPC.fileWriterWrite, id, chunk, position),
    closeWriter: (id, abort) => ipcRenderer.invoke(IPC.fileWriterClose, id, abort),
    exportFolder: () => ipcRenderer.invoke(IPC.exportFolderGet),
    chooseExportFolder: () => ipcRenderer.invoke(IPC.exportFolderChoose),
    setExportFolder: (options) => ipcRenderer.invoke(IPC.exportFolderSet, options),
    openExportFolder: () => ipcRenderer.invoke(IPC.exportFolderOpen),
    getPathForFile: (file) => {
      try {
        // Only real files from a picker or drag and drop have a path; tell the main process
        // so it may later re-open this file from the recent list.
        const path = webUtils.getPathForFile(file);
        if (path) ipcRenderer.send(IPC.grantPath, path);
        return path;
      } catch {
        return '';
      }
    },
    recent: () => ipcRenderer.invoke(IPC.fileRecentList),
    addRecent: (entry) => ipcRenderer.invoke(IPC.fileRecentAdd, entry),
    readRecent: (path) => ipcRenderer.invoke(IPC.fileRecentRead, path),
    clearRecent: () => ipcRenderer.invoke(IPC.fileRecentClear),
    printToPdf: (options) => ipcRenderer.invoke(IPC.printToPdf, options),
  },
  ai: {
    providers: () => ipcRenderer.invoke(IPC.aiProviders),
    detect: (force) => ipcRenderer.invoke(IPC.aiDetect, force),
    run: async (request: AIRunRequest, onDelta) => {
      const listener = (_event: Electron.IpcRendererEvent, chunk: AIChunkEvent) => {
        if (chunk.requestId === request.requestId && onDelta) onDelta(chunk.delta);
      };
      ipcRenderer.on(IPC.aiChunk, listener);
      try {
        return await ipcRenderer.invoke(IPC.aiRun, request);
      } finally {
        ipcRenderer.removeListener(IPC.aiChunk, listener);
      }
    },
    cancel: (requestId) => ipcRenderer.invoke(IPC.aiCancel, requestId),
    getConfig: () => ipcRenderer.invoke(IPC.aiGetConfig),
    setExecutablePath: (providerId, path) => ipcRenderer.invoke(IPC.aiSetExecutable, providerId, path),
    setCustomCli: (config) => ipcRenderer.invoke(IPC.aiSetCustom, config),
    httpModels: async (providerId, baseUrl, apiKey) => unwrapModels(await ipcRenderer.invoke(IPC.aiHttpModels, providerId, baseUrl, apiKey)),
  },
  tools: {
    detect: () => ipcRenderer.invoke(IPC.toolsDetect),
    setCommand: (tool, command) => ipcRenderer.invoke(IPC.toolsSetCommand, tool, command),
    imageGenerate: (request) => ipcRenderer.invoke(IPC.toolImageGen, request),
    transcribe: (request) => ipcRenderer.invoke(IPC.toolTranscribe, request),
    removeBackground: (request) => ipcRenderer.invoke(IPC.toolRemoveBg, request),
    sdModels: async (baseUrl) => unwrapModels(await ipcRenderer.invoke(IPC.toolSdModels, baseUrl)),
    transcode: (request) => ipcRenderer.invoke(IPC.toolTranscode, request),
    cancelTranscode: (requestId) => ipcRenderer.invoke(IPC.toolTranscodeCancel, requestId),
    comfyModels: async (baseUrl) => unwrapModels(await ipcRenderer.invoke(IPC.toolComfyModels, baseUrl)),
    localImageModels: async (baseUrl) => unwrapModels(await ipcRenderer.invoke(IPC.toolLocalImageModels, baseUrl)),
    speechStatus: () => ipcRenderer.invoke(IPC.toolSpeechStatus),
    speak: (request) => ipcRenderer.invoke(IPC.toolSpeechGenerate, request),
    speechConfig: () => ipcRenderer.invoke(IPC.toolSpeechConfig),
    setSpeechCustom: (custom) => ipcRenderer.invoke(IPC.toolSpeechSetConfig, custom),
    pickPiperModel: () => ipcRenderer.invoke(IPC.toolPickPiperModel),
  },
};

contextBridge.exposeInMainWorld('ultima', api);
