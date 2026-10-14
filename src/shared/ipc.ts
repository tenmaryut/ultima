import type {
  TranscodeRequest,
  TranscodeResult,
  AIRunRequest,
  AIRunResult,
  CustomCliConfig,
  ImageGenRequest,
  ImageGenResult,
  LocalToolStatus,
  ProviderId,
  ProviderInfo,
  ProviderStatus,
  RemoveBgRequest,
  RemoveBgResult,
  SpeechConfig,
  SpeechProviderStatus,
  SpeechRequest,
  SpeechResult,
  TranscribeRequest,
  TranscribeResult,
} from './ai-types';

/** IPC channel names. Keep in sync between main and preload. */
export const IPC = {
  appInfo: 'app:info',
  openExternal: 'app:open-external',
  showItemInFolder: 'app:show-item-in-folder',
  setTitle: 'app:set-title',
  setLanguage: 'app:set-language',
  menuCommand: 'app:menu-command',
  openPaths: 'app:open-paths',
  pendingPaths: 'app:pending-paths',

  fileSave: 'file:save',
  fileWriterOpen: 'file:writer-open',
  fileWriterWrite: 'file:writer-write',
  fileWriterClose: 'file:writer-close',
  fileRecentList: 'file:recent-list',
  fileRecentAdd: 'file:recent-add',
  fileRecentRead: 'file:recent-read',
  fileRecentClear: 'file:recent-clear',
  grantPath: 'file:grant-path',

  aiProviders: 'ai:providers',
  aiDetect: 'ai:detect',
  aiRun: 'ai:run',
  aiChunk: 'ai:chunk',
  aiCancel: 'ai:cancel',
  aiGetConfig: 'ai:get-config',
  aiSetExecutable: 'ai:set-executable',
  aiSetCustom: 'ai:set-custom',
  aiHttpModels: 'ai:http-models',

  toolsDetect: 'tools:detect',
  toolsSetCommand: 'tools:set-command',
  toolImageGen: 'tools:image-gen',
  toolTranscribe: 'tools:transcribe',
  toolRemoveBg: 'tools:remove-bg',
  toolSdModels: 'tools:sd-models',
  toolTranscode: 'tools:transcode',
  toolTranscodeCancel: 'tools:transcode-cancel',
  toolComfyModels: 'tools:comfy-models',
  toolLocalImageModels: 'tools:local-image-models',
  toolSpeechStatus: 'tools:speech-status',
  toolSpeechGenerate: 'tools:speech-generate',
  toolSpeechConfig: 'tools:speech-config',
  toolSpeechSetConfig: 'tools:speech-set-config',
  toolPickPiperModel: 'tools:pick-piper-model',
  printToPdf: 'file:print-to-pdf',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: 'darwin' | 'win32' | 'linux' | string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  userDataPath: string;
  isPackaged: boolean;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveFileOptions {
  suggestedName: string;
  filters?: FileFilter[];
  /** Write straight to this path (only allowed for paths the user picked earlier in this session). */
  path?: string;
  data: ArrayBuffer | Uint8Array | string;
}

export interface SaveFileResult {
  path: string;
}

export interface RecentFile {
  path: string;
  name: string;
  moduleId?: string;
  openedAt: number;
}

/** Main-process side AI configuration (paths that execute programs live here, not in the renderer). */
export interface MainAIConfig {
  executablePaths: Partial<Record<ProviderId, string>>;
  custom: CustomCliConfig | null;
  toolCommands: Partial<Record<'whisper' | 'rembg' | 'piper', string>>;
  speech?: SpeechConfig;
}

/** The API the preload script exposes as `window.ultima` (desktop app only). */
export interface UltimaDesktopAPI {
  isDesktop: true;
  platform: string;
  app: {
    getInfo(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): Promise<void>;
    setTitle(title: string): void;
    /** UI language, for the few dialogs the main process shows itself. */
    setLanguage(language: string): void;
    onMenuCommand(callback: (command: string) => void): () => void;
    /** Files the OS asked Ultima to open (double-click, "Open with", drag onto the dock icon). */
    onOpenPaths(callback: (files: { path: string; name: string }[]) => void): () => void;
    /** Files passed on the command line before the window was ready. */
    pendingPaths(): Promise<{ path: string; name: string }[]>;
  };
  files: {
    save(options: SaveFileOptions): Promise<SaveFileResult | null>;
    /** Opens a streaming writer (for large exports). Returns null if the user cancelled. */
    openWriter(options: { suggestedName: string; filters?: FileFilter[] }): Promise<{ id: string; path: string } | null>;
    write(id: string, chunk: Uint8Array, position?: number): Promise<void>;
    closeWriter(id: string, abort?: boolean): Promise<void>;
    /** Absolute path of a File that came from a file input or drag and drop. */
    getPathForFile(file: File): string;
    recent(): Promise<RecentFile[]>;
    addRecent(entry: Omit<RecentFile, 'openedAt'>): Promise<void>;
    readRecent(path: string): Promise<ArrayBuffer | null>;
    clearRecent(): Promise<void>;
    /**
     * Renders a standalone HTML document (no scripts; images as data: URLs) to a vector PDF.
     * Page size in inches. Returns the PDF bytes.
     */
    printToPdf(options: { html: string; widthIn: number; heightIn: number }): Promise<Uint8Array>;
  };
  ai: {
    providers(): Promise<ProviderInfo[]>;
    detect(force?: boolean): Promise<ProviderStatus[]>;
    run(request: AIRunRequest, onDelta?: (delta: string) => void): Promise<AIRunResult>;
    cancel(requestId: string): Promise<void>;
    getConfig(): Promise<MainAIConfig>;
    /** Asks the user (native dialog) to confirm before a custom executable path is stored. */
    setExecutablePath(providerId: ProviderId, path: string | null): Promise<boolean>;
    setCustomCli(config: CustomCliConfig | null): Promise<boolean>;
    httpModels(providerId: ProviderId, baseUrl: string, apiKey?: string): Promise<string[]>;
  };
  tools: {
    detect(): Promise<LocalToolStatus[]>;
    setCommand(tool: 'whisper' | 'rembg' | 'piper', command: string | null): Promise<boolean>;
    imageGenerate(request: ImageGenRequest): Promise<ImageGenResult>;
    transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
    removeBackground(request: RemoveBgRequest): Promise<RemoveBgResult>;
    /** Lists checkpoints of a local Stable Diffusion WebUI (throws if it is not reachable). */
    sdModels(baseUrl: string): Promise<string[]>;
    /** Converts audio/video with the user's FFmpeg (if installed) using safe presets. */
    transcode(request: TranscodeRequest): Promise<TranscodeResult>;
    /** Stops a running conversion (its transcode() then resolves with ok: false). */
    cancelTranscode(requestId: string): Promise<void>;
    /** Checkpoints of a local ComfyUI server (throws if it is not reachable). */
    comfyModels(baseUrl: string): Promise<string[]>;
    /** Models of a local OpenAI-compatible server (throws if it is not reachable). */
    localImageModels(baseUrl: string): Promise<string[]>;
    speechStatus(): Promise<SpeechProviderStatus[]>;
    speak(request: SpeechRequest): Promise<SpeechResult>;
    speechConfig(): Promise<SpeechConfig>;
    /** Stores the custom TTS command after the user confirms it in a native dialog. */
    setSpeechCustom(custom: SpeechConfig['custom']): Promise<boolean>;
    /** Lets the user pick a Piper voice (.onnx) in a native dialog; returns the stored path. */
    pickPiperModel(): Promise<string | null>;
  };
}
