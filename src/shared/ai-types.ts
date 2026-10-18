/**
 * Types shared by the Electron main process, the preload bridge and the renderer
 * for everything AI related.
 *
 * Ultima never calls paid, metered AI APIs itself. Instead it talks to:
 *  - "cli" providers: the official command-line tools the user already installed and
 *    signed in to with their own subscription (Claude Code, Codex, Antigravity CLI, ...).
 *  - "http" providers: free AI servers running on the user's own machine
 *    (Ollama, LM Studio / llama.cpp / Jan and other OpenAI-compatible local servers).
 */

export type CliProviderId = 'claude' | 'codex' | 'antigravity' | 'gemini' | 'copilot' | 'qwen' | 'cursor' | 'opencode' | 'kimi' | 'custom';
export type HttpProviderId = 'ollama' | 'openai-compatible';
export type ProviderId = CliProviderId | HttpProviderId;

export const CLI_PROVIDER_IDS: CliProviderId[] = [
  'claude',
  'codex',
  'antigravity',
  'gemini',
  'copilot',
  'qwen',
  'cursor',
  'opencode',
  'kimi',
  'custom',
];
export const HTTP_PROVIDER_IDS: HttpProviderId[] = ['ollama', 'openai-compatible'];

export type OsKey = 'mac' | 'windows' | 'linux' | 'all';

export interface InstallCommand {
  os: OsKey;
  command: string;
  note?: string;
}

export interface ModelOption {
  /** Value passed to the provider. Empty string means "the tool's own default". */
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  vendor: string;
  kind: 'cli' | 'http';
  /** What the user needs: a subscription, a free account, or nothing (local). */
  plan: string;
  /** Executable name looked up on PATH (cli providers). */
  command?: string;
  supportsImages: boolean;
  supportsStreaming: boolean;
  /** True when the provider costs nothing extra (local models or a free tier). */
  free: boolean;
  installCommands: InstallCommand[];
  loginSteps: string[];
  docsUrl: string;
  models: ModelOption[];
  /** Default base URL for http providers. */
  defaultBaseUrl?: string;
  /** Provider specific policy note shown before the user enables it. */
  termsNote?: string;
}

export interface ProviderStatus {
  id: ProviderId;
  available: boolean;
  version?: string;
  /** Resolved executable path (cli) or base URL (http). */
  location?: string;
  /** Models reported by an http provider. */
  models?: string[];
  error?: string;
  checkedAt: number;
}

export interface AIImage {
  /** e.g. image/png */
  mime: string;
  /** Raw base64 without the data: prefix. */
  base64: string;
  name?: string;
}

export interface AIRunRequest {
  requestId: string;
  providerId: ProviderId;
  prompt: string;
  system?: string;
  images?: AIImage[];
  model?: string;
  timeoutMs?: number;
  /** Base URL for http providers (validated to be a loopback/LAN http(s) URL by the main process). */
  baseUrl?: string;
  /** Optional bearer token for OpenAI-compatible local servers that require one. */
  apiKey?: string;
  /**
   * When false (default) the main process removes API-key environment variables
   * (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ...) before starting a CLI, so the
   * tool uses the subscription login instead of pay-per-token API billing.
   */
  allowApiBilling?: boolean;
}

export type AIErrorKind =
  | 'not-installed'
  | 'not-logged-in'
  | 'rate-limited'
  | 'timeout'
  | 'aborted'
  | 'unsupported'
  | 'failed';

export interface AIRunResult {
  ok: boolean;
  text: string;
  error?: string;
  errorKind?: AIErrorKind;
  durationMs: number;
  providerId: ProviderId;
}

export interface AIChunkEvent {
  requestId: string;
  delta: string;
}

/** User-defined command for any other CLI. `{prompt}` is NOT substituted into args: the prompt is always sent on stdin. */
export interface CustomCliConfig {
  name: string;
  command: string;
  args: string[];
  /** When true the tool's stdout is used verbatim as the answer. */
  plainText: boolean;
}

/* ----------------------------- Local creative tools ----------------------------- */

/**
 * Where images come from. None of them bills an API key:
 * - sd-webui: AUTOMATIC1111 / Forge / SD.Next WebUI started with --api (local)
 * - comfyui: ComfyUI server with a checkpoint model (local)
 * - local-openai: a local server with an OpenAI-style /images/generations endpoint (e.g. LocalAI)
 * - codex: Codex CLI's built-in image tool, billed to the user's ChatGPT plan
 * - antigravity: Antigravity CLI's built-in image tool (Nano Banana), on the user's Google AI Pro / Ultra plan
 * - svg: the user's own chat AI (any connection) draws an SVG, rendered to an image in the app
 */
export type ImageProviderId = 'sd-webui' | 'comfyui' | 'local-openai' | 'codex' | 'antigravity' | 'svg';

export interface ImageGenRequest {
  requestId: string;
  /** Defaults to 'sd-webui'. */
  provider?: ImageProviderId;
  /** Server address for sd-webui, comfyui and local-openai (ignored by codex). */
  baseUrl: string;
  /** ComfyUI checkpoint or local-openai model ('' = first available / server default). */
  model?: string;
  /** codex / antigravity: keep API-key variables so a configured key may be billed (off by default). */
  allowApiBilling?: boolean;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  /** img2img / inpainting source (base64 PNG, no data: prefix). */
  initImage?: string;
  /** Inpainting mask (white = repaint), base64 PNG. */
  mask?: string;
  denoisingStrength?: number;
}

export interface ImageGenResult {
  ok: boolean;
  /** Base64 image data (no data: prefix). */
  images: string[];
  /** MIME type per image (PNG when missing). */
  mimeTypes?: string[];
  error?: string;
}

/* --------------------------------- Speech --------------------------------- */

/**
 * Text-to-speech engines, all running on the user's computer:
 * - system: the operating system's voices (macOS say, Windows SAPI, Linux espeak-ng)
 * - piper: Piper neural voices (.onnx models, offline)
 * - custom: a command the user configured (e.g. Kokoro or another local TTS)
 */
export type SpeechProviderId = 'system' | 'piper' | 'custom';

export interface SpeechVoice {
  /** Value to pass back in SpeechRequest.voice. */
  id: string;
  name: string;
  /** BCP 47-like language tag when known (e.g. "id-ID", "en_US"). */
  language?: string;
}

export interface SpeechProviderStatus {
  id: SpeechProviderId;
  available: boolean;
  /** Program or model in use, or why it is unavailable. */
  detail?: string;
  voices: SpeechVoice[];
}

export interface SpeechRequest {
  requestId: string;
  provider: SpeechProviderId;
  text: string;
  voice?: string;
  /** Speaking rate multiplier, 0.5–2 (1 = normal). */
  rate?: number;
  /** custom only: keep API-key variables for the configured command (off by default). */
  allowApiBilling?: boolean;
}

export interface SpeechResult {
  ok: boolean;
  data?: Uint8Array;
  /** audio/wav, audio/mpeg, audio/ogg or audio/aiff. */
  mime?: string;
  error?: string;
}

/** Main-process speech settings (anything that runs a program lives in the main process). */
export interface SpeechConfig {
  /** Piper voice model (.onnx). Other .onnx files in the same folder are offered as voices too. */
  piperModel?: string;
  /**
   * Custom TTS command. Arguments may contain {text_file}, {output}, {voice} and {rate}; the
   * program must write the audio to {output}.
   */
  custom?: { command: string; args: string[] } | null;
}

export interface TranscribeRequest {
  requestId: string;
  /** 16 kHz mono PCM WAV, base64. */
  wavBase64: string;
  language?: string;
  /** Model name/path understood by the configured whisper tool. */
  model?: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeResult {
  ok: boolean;
  segments: TranscriptSegment[];
  error?: string;
}

export interface RemoveBgRequest {
  requestId: string;
  pngBase64: string;
}

export interface RemoveBgResult {
  ok: boolean;
  pngBase64?: string;
  error?: string;
}

/** Masks of the subject (people, or anything in front) of many video frames, with rembg. */
export interface MatteRequest {
  requestId: string;
  model: 'people' | 'anything';
  /** PNG frames. */
  frames: Uint8Array[];
}

export interface MatteResult {
  ok: boolean;
  /** Grey PNG masks (white = subject), one per frame. */
  masks?: Uint8Array[];
  error?: string;
}

export type LocalToolId = 'whisper' | 'rembg' | 'ffmpeg' | 'piper';

export interface LocalToolStatus {
  id: LocalToolId;
  available: boolean;
  location?: string;
  version?: string;
  error?: string;
}

/* ------------------------------ Media conversion ------------------------------ */

export type TranscodeFormat = 'mp4' | 'mov' | 'webm' | 'gif' | 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac';

export interface TranscodeRequest {
  requestId: string;
  input: Uint8Array;
  /** Original file name (only its extension is used). */
  inputName: string;
  format: TranscodeFormat;
  quality?: 'high' | 'medium' | 'small';
  /** GIF and the social preset: output frame rate. */
  fps?: number;
  /** GIF only: output width in px (height keeps aspect ratio). */
  width?: number;
  /** MP4 only: upload-ready file for TikTok, Reels and Shorts (see socialVideoArgs). */
  preset?: 'social';
  /** Social preset: target video bitrate in bit/s. */
  videoBitrate?: number;
}

export interface TranscodeResult {
  ok: boolean;
  data?: Uint8Array;
  error?: string;
}
