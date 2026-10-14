/**
 * Image generation and text-to-speech. Nothing here bills an API key by default:
 * - images: ComfyUI or an OpenAI-style image server on this computer / local network, or the built-in
 *   image tools of Codex CLI (ChatGPT plan) and Antigravity CLI (Google AI Pro / Ultra plan);
 *   Stable Diffusion WebUI lives in tools.ts
 * - speech: the operating system's voices, Piper neural voices, or a command the user configured
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, type Dirent } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type {
  ImageGenRequest,
  ImageGenResult,
  SpeechConfig,
  SpeechProviderStatus,
  SpeechRequest,
  SpeechResult,
  SpeechVoice,
} from '@shared/ai-types';
import { IPC } from '@shared/ipc';
import { openAICompatModels, validateLocalBaseUrl } from '@shared/local-http';
import { AGY_SIGN_IN, agyError, classifyError, isUnknownOptionError } from './ai/adapters';
import { findExecutable, runProcess, type ProcessResult } from './ai/exec';
import { aiConfig, cliEnv, resolveCli } from './ai/service';
import { mt } from './i18n';
import {
  MAX_SPEECH_CHARS,
  antigravityImagePrompt,
  imagePathsIn,
  jsonStrings,
  SAPI_SPEAK_SCRIPT,
  SAPI_VOICES_SCRIPT,
  clampRate,
  codexImagePrompt,
  comfySeed,
  comfyWorkflow,
  fillSpeechArgs,
  parseEspeakVoices,
  parseSapiVoices,
  parseSayVoices,
  piperVoiceFromFile,
  sapiRate,
  sniffAudioMime,
  sniffImageMime,
  wordsPerMinute,
} from './media-utils';

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const failImage = (error: string): ImageGenResult => ({ ok: false, images: [], error });
const snap8 = (value: number | undefined, fallback: number) => Math.round(Math.min(2048, Math.max(64, value || fallback)) / 8) * 8;

function friendlyError(error: unknown, server: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
    return mt('Could not reach {server}. Is it running? Check the address in Settings.').replace('{server}', server);
  }
  if (/TimeoutError|aborted due to timeout/i.test(message)) return mt('{server} did not answer in time.').replace('{server}', server);
  return message;
}

function serverUrl(baseUrl: string, path: string): string {
  validateLocalBaseUrl(baseUrl);
  return `${baseUrl.trim().replace(/\/+$/, '')}${path}`;
}

async function localFetch(baseUrl: string, path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const res = await fetch(serverUrl(baseUrl, path), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${(await res.text().catch(() => '')).slice(0, 400)}`.trim());
  return res;
}

function encodeImages(list: Uint8Array[]): ImageGenResult {
  return {
    ok: true,
    images: list.map((data) => Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64')),
    mimeTypes: list.map(sniffImageMime),
  };
}

/* --------------------------------- ComfyUI --------------------------------- */

interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface ComfyHistoryEntry {
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: Array<[string, Record<string, unknown>]> };
}

interface ComfyQueueResponse {
  prompt_id?: string;
  error?: string | { message?: string; details?: string };
  node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }> }>;
}

/** Checkpoint names of a ComfyUI server (throws when it is not reachable). */
export async function comfyCheckpoints(baseUrl: string): Promise<string[]> {
  const info = (await (await localFetch(baseUrl, '/object_info/CheckpointLoaderSimple', {}, 5000)).json()) as Record<
    string,
    { input?: { required?: { ckpt_name?: unknown[] } } }
  >;
  const spec = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  // Classic format: [[names…], {…}]; newer servers: ["COMBO", { options: [names…] }].
  const names = Array.isArray(spec?.[0]) ? spec[0] : (spec?.[1] as { options?: unknown } | undefined)?.options;
  return Array.isArray(names) ? names.map(String) : [];
}

function comfyQueueError(body: ComfyQueueResponse): string {
  const parts: string[] = [];
  const top = body.error;
  if (typeof top === 'string') parts.push(top);
  else if (top) parts.push([top.message, top.details].filter(Boolean).join(': '));
  for (const node of Object.values(body.node_errors ?? {})) {
    for (const e of node.errors ?? []) parts.push([e.message, e.details].filter(Boolean).join(': '));
  }
  return parts.filter(Boolean).join(' · ').slice(0, 600);
}

function comfyRunError(entry: ComfyHistoryEntry): string {
  const message = entry.status?.messages?.find(([kind]) => kind === 'execution_error')?.[1];
  return message ? String(message.exception_message ?? message.node_type ?? '').trim().slice(0, 600) : '';
}

async function comfyGenerate(req: ImageGenRequest): Promise<ImageGenResult> {
  try {
    const checkpoint = req.model?.trim() || (await comfyCheckpoints(req.baseUrl))[0];
    if (!checkpoint) {
      return failImage(mt('ComfyUI has no checkpoint model yet. Put a Stable Diffusion model (.safetensors) into ComfyUI/models/checkpoints and restart ComfyUI.'));
    }
    const workflow = comfyWorkflow({
      checkpoint,
      prompt: String(req.prompt ?? '').slice(0, 4000),
      negative: String(req.negativePrompt ?? '').slice(0, 2000),
      width: snap8(req.width, 512),
      height: snap8(req.height, 512),
      steps: Math.round(Math.min(150, Math.max(1, req.steps ?? 25))),
      cfg: Math.min(30, Math.max(1, req.cfgScale ?? 7)),
      seed: comfySeed(req.seed),
    });
    const queued = await fetch(serverUrl(req.baseUrl, '/prompt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'ultima' }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await queued.json().catch(() => ({}))) as ComfyQueueResponse;
    if (!queued.ok || !body.prompt_id) return failImage(`${mt('ComfyUI rejected the request.')} ${comfyQueueError(body) || queued.status}`);
    const id = body.prompt_id;
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      await delay(1000);
      // A prompt appears in the history once it has finished (or failed).
      const history = (await (await localFetch(req.baseUrl, `/history/${encodeURIComponent(id)}`)).json()) as Record<string, ComfyHistoryEntry>;
      const entry = history?.[id];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') return failImage(`${mt('ComfyUI could not create the image.')} ${comfyRunError(entry)}`.trim());
      const refs = Object.values(entry.outputs ?? {})
        .flatMap((output) => output.images ?? [])
        .filter((ref) => ref?.filename && (!ref.type || ref.type === 'output'));
      if (!refs.length) {
        if (entry.status?.completed === false) continue;
        return failImage(mt('ComfyUI finished without an image.'));
      }
      const images: Uint8Array[] = [];
      for (const ref of refs.slice(0, 8)) {
        const query = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder ?? '', type: ref.type ?? 'output' });
        images.push(new Uint8Array(await (await localFetch(req.baseUrl, `/view?${query}`, {}, 120_000)).arrayBuffer()));
      }
      return encodeImages(images);
    }
    return failImage(mt('ComfyUI did not finish within 20 minutes.'));
  } catch (error) {
    return failImage(friendlyError(error, 'ComfyUI'));
  }
}

/* ------------------------- OpenAI-style local image server ------------------------- */

function decodeDataUrl(value: string): Uint8Array {
  return Buffer.from(value.replace(/^data:[^,]*,/, ''), 'base64');
}

async function localOpenAIGenerate(req: ImageGenRequest): Promise<ImageGenResult> {
  const model = req.model?.trim();
  if (!model) return failImage(mt('Choose an image model for the local server first (Settings → Image generation).'));
  try {
    const res = await localFetch(
      req.baseUrl,
      '/images/generations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: String(req.prompt ?? '').slice(0, 4000),
          n: 1,
          size: `${snap8(req.width, 1024)}x${snap8(req.height, 1024)}`,
          response_format: 'b64_json',
        }),
      },
      20 * 60_000,
    );
    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const images: Uint8Array[] = [];
    for (const item of (data.data ?? []).slice(0, 8)) {
      if (item.b64_json) images.push(decodeDataUrl(item.b64_json));
      else if (item.url?.startsWith('data:')) images.push(decodeDataUrl(item.url));
      else if (item.url) {
        // Some servers answer with a link to the file; only follow it on this computer / network.
        const url = new URL(item.url, serverUrl(req.baseUrl, '/')).toString();
        validateLocalBaseUrl(url);
        images.push(new Uint8Array(await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).arrayBuffer()));
      }
    }
    const usable = images.filter((img) => img.length > 0);
    return usable.length ? encodeImages(usable) : failImage(mt('The server returned no image. Check that the selected model can create images.'));
  } catch (error) {
    return failImage(friendlyError(error, mt('the local image server')));
  }
}

/* ----------------------------- Codex image tool ----------------------------- */

const queues = new Map<string, Promise<unknown>>();

/** One image job per tool at a time, so every new image file belongs to the running job. */
function inQueue<T>(tool: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(tool) ?? Promise.resolve()).then(job, job);
  queues.set(tool, run.catch(() => undefined));
  return run;
}

function codexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? resolve(configured) : join(homedir(), '.codex');
}

/** Images Codex saved since `since` ($CODEX_HOME/generated_images/<thread>/<call>.png), oldest first. */
async function newCodexImages(since: number): Promise<string[]> {
  const root = join(codexHome(), 'generated_images');
  const found: Array<{ path: string; time: number }> = [];
  let threads: string[];
  try {
    threads = await readdir(root);
  } catch {
    return [];
  }
  for (const thread of threads) {
    const dir = join(root, thread);
    try {
      const info = await stat(dir);
      // Every `codex exec` starts a new thread, so its folder is newer than the job.
      if (!info.isDirectory() || info.mtimeMs < since) continue;
      for (const name of await readdir(dir)) {
        if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
        const file = await stat(join(dir, name));
        if (file.isFile() && file.mtimeMs >= since && file.size <= MAX_FILE_BYTES) found.push({ path: join(dir, name), time: file.mtimeMs });
      }
    } catch {
      // removed while scanning
    }
  }
  return found.sort((a, b) => a.time - b.time).map((f) => f.path);
}

function codexImageError(res: ProcessResult | null): string {
  if (!res) return mt('Codex did not run.');
  if (res.spawnError) return `${mt('Could not start Codex.')} ${res.spawnError}`;
  if (res.timedOut) return mt('Codex did not finish the image within 8 minutes.');
  const output = `${res.stderr}\n${res.stdout}`.trim();
  const kind = classifyError(output);
  if (kind === 'not-logged-in') return mt('Codex is not signed in. Run "codex" in a terminal once and sign in with your ChatGPT account.');
  if (kind === 'rate-limited') return mt('Your ChatGPT plan has reached its image limit for now. Try again after it resets.');
  const hint = mt('Codex finished without creating an image. Image generation needs a ChatGPT plan that includes it and an up-to-date Codex CLI (npm install -g @openai/codex).');
  return output ? `${hint}\n\n${output.slice(-800)}` : hint;
}

async function codexGenerate(req: ImageGenRequest): Promise<ImageGenResult> {
  const exe = resolveCli('codex');
  if (!exe) return failImage(mt('Codex CLI is not installed. Install it with: npm install -g @openai/codex — then run "codex" once to sign in with your ChatGPT account.'));
  const prompt = String(req.prompt ?? '').trim();
  if (!prompt) return failImage(mt('Write a prompt first.'));
  return inQueue('codex', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ultima-codex-image-'));
    try {
      let last: ProcessResult | null = null;
      for (const compat of [false, true]) {
        const since = Date.now() - 3000;
        // Files from the previous job can be newer than `since`: only count files this run adds.
        const before = new Set(await newCodexImages(since));
        const args = compat
          ? ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-']
          : [
              'exec',
              '--skip-git-repo-check',
              '--ephemeral',
              '--color', 'never',
              '--sandbox', 'read-only',
              '--enable', 'image_generation',
              '--disable', 'shell_tool',
              '-c', 'web_search="disabled"',
              '-',
            ];
        last = await runProcess({
          command: exe,
          args,
          stdin: codexImagePrompt(prompt, req.width, req.height),
          cwd,
          env: cliEnv(req.allowApiBilling),
          timeoutMs: 8 * 60_000,
        }).result;
        const files = (await newCodexImages(since)).filter((file) => !before.has(file));
        if (files.length) return encodeImages(await Promise.all(files.slice(-4).map((file) => readFile(file))));
        if (!compat && last.code !== 0 && isUnknownOptionError(last.stderr)) continue; // older Codex: retry with basic flags
        break;
      }
      return failImage(codexImageError(last));
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

/* --------------------------- Antigravity image tool --------------------------- */

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
/** Folders that can hold thousands of unrelated files (subagent Git worktrees and the like). */
const SKIP_DIRS = new Set(['worktrees', '.git', 'node_modules', 'scratch']);

/** Where Antigravity keeps conversations and their artifacts: the CLI, the desktop app / SDK, older builds. */
function antigravityRoots(): string[] {
  const base = join(homedir(), '.gemini');
  return [join(base, 'antigravity-cli'), join(base, 'antigravity'), join(base, 'jetski')];
}

function isInside(path: string, folders: string[]): boolean {
  const full = resolve(path);
  return folders.some((folder) => full.startsWith(resolve(folder) + sep));
}

/** Walks `root` (skipping SKIP_DIRS); `visit` returns true to stop. Bounded by depth and entry count. */
async function walk(root: string, visit: (path: string, entry: Dirent) => Promise<boolean> | boolean, depth = 0, budget = { left: 30_000 }): Promise<boolean> {
  if (depth > 8 || budget.left <= 0) return false;
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (--budget.left <= 0) return false;
    const path = join(root, entry.name);
    if (await visit(path, entry)) return true;
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && (await walk(path, visit, depth + 1, budget))) return true;
  }
  return false;
}

async function freshImage(path: string, since: number): Promise<{ path: string; time: number } | null> {
  try {
    const info = await stat(path);
    return info.isFile() && IMAGE_EXT.test(path) && info.mtimeMs >= since && info.size <= MAX_FILE_BYTES ? { path, time: info.mtimeMs } : null;
  } catch {
    return null;
  }
}

/**
 * The image an Antigravity run saved: a path in its answer or JSON output, else a file named after the
 * requested image name (saved as <name>_<timestamp>.png) in the conversation's artifacts.
 */
async function antigravityImage(json: Record<string, unknown> | null, name: string, since: number, cwd: string): Promise<string | null> {
  const roots = antigravityRoots();
  const mentioned = jsonStrings(json).flatMap(imagePathsIn);
  for (const path of mentioned.reverse()) {
    const file = await freshImage(path, since);
    if (file && (file.path.split(/[\\/]/).pop()!.startsWith(name) || isInside(file.path, [...roots, cwd]))) return file.path;
  }
  const found: Array<{ path: string; time: number }> = [];
  const collect = async (path: string, entry: Dirent) => {
    if (entry.isFile() && entry.name.startsWith(name)) {
      const file = await freshImage(path, since);
      if (file) found.push(file);
    }
    return false;
  };
  const conversation = typeof json?.conversation_id === 'string' ? json.conversation_id : '';
  for (const root of [cwd, ...roots]) {
    if (conversation && root !== cwd) {
      // Look inside this run's conversation folder first; it is small.
      const dirs: string[] = [];
      await walk(root, (path, entry) => {
        if (entry.isDirectory() && entry.name === conversation) dirs.push(path);
        return false;
      }, 4);
      for (const dir of dirs) await walk(dir, collect);
    }
    if (!found.length) await walk(root, collect);
    if (found.length) break;
  }
  return found.sort((a, b) => a.time - b.time).pop()?.path ?? null;
}

function lastJson(text: string): Record<string, unknown> | null {
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // not JSON
    }
  }
  return null;
}

function antigravityImageError(res: ProcessResult | null, json: Record<string, unknown> | null, signIn: boolean): string {
  const notSignedIn = mt('Antigravity CLI is not signed in. Open a terminal, run agy once and sign in with your Google account.');
  if (signIn) return notSignedIn;
  if (!res) return mt('Antigravity CLI did not run.');
  if (res.spawnError) return `${mt('Could not start Antigravity CLI.')} ${res.spawnError}`;
  if (res.timedOut) return mt('Antigravity did not finish the image within 8 minutes.');
  const message = agyError(res.stderr) ?? (typeof json?.error === 'string' ? json.error : '');
  const output = [message, res.stderr, typeof json?.response === 'string' ? json.response : res.stdout].filter(Boolean).join('\n');
  if (/credits balance is too low|out of credits/i.test(output) || classifyError(output) === 'rate-limited') {
    return mt('Your Google AI plan has reached its limit for now. Try again after it resets (in a terminal, agy -p "/usage" shows when).');
  }
  if (classifyError(output) === 'not-logged-in') return notSignedIn;
  const hint = mt('Antigravity finished without creating an image. Image generation needs a Google AI Pro or Ultra plan and an up-to-date Antigravity CLI (run: agy update).');
  const detail = (message || (typeof json?.response === 'string' ? json.response : '') || res.stderr).trim();
  return detail ? `${hint}\n\n${detail.slice(-800)}` : hint;
}

async function antigravityGenerate(req: ImageGenRequest): Promise<ImageGenResult> {
  const exe = resolveCli('antigravity');
  if (!exe) return failImage(mt('Antigravity CLI is not installed. Install it (Settings → AI connections), then run agy once to sign in with your Google account.'));
  const prompt = String(req.prompt ?? '').trim();
  if (!prompt) return failImage(mt('Write a prompt first.'));
  return inQueue('antigravity', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ultima-agy-image-'));
    try {
      let last: ProcessResult | null = null;
      let json: Record<string, unknown> | null = null;
      let signIn = false;
      for (const compat of [false, true]) {
        const since = Date.now() - 3000;
        const name = `ultima_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const text = antigravityImagePrompt(prompt, req.width, req.height, name);
        const args = [`-p=${text}`, '--output-format', 'json', ...(compat ? [] : ['--sandbox', '--disable-slash-commands', '--print-timeout', '7m'])];
        const proc = runProcess({
          command: exe,
          args,
          cwd,
          env: cliEnv(req.allowApiBilling),
          timeoutMs: 8 * 60_000,
          onStderrLine: (line) => {
            // Not signed in: the CLI would wait a minute for a sign-in code.
            if (!signIn && AGY_SIGN_IN.test(line)) {
              signIn = true;
              proc.cancel();
            }
          },
        });
        last = await proc.result;
        if (signIn) break;
        json = lastJson(last.stdout);
        const file = await antigravityImage(json, name, since, cwd);
        if (file) return encodeImages([await readFile(file)]);
        if (!compat && last.code !== 0 && isUnknownOptionError(last.stderr)) continue; // older CLI: retry with basic flags
        break;
      }
      return failImage(antigravityImageError(last, json, signIn));
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

/** Image generators other than Stable Diffusion WebUI. */
export function generateImageWith(req: ImageGenRequest): Promise<ImageGenResult> {
  switch (req?.provider) {
    case 'comfyui':
      return comfyGenerate(req);
    case 'local-openai':
      return localOpenAIGenerate(req);
    case 'codex':
      return codexGenerate(req);
    case 'antigravity':
      return antigravityGenerate(req);
    default:
      return Promise.resolve(failImage('Unknown image generator'));
  }
}

/* --------------------------------- Speech --------------------------------- */

/** Voice names are passed as arguments: no leading "-" (never an option) and no odd characters. */
const VOICE_RE = /^[\p{L}\p{N}][\p{L}\p{N}_ .:()'+-]{0,99}$/u;

interface SystemSpeech {
  command: string;
  kind: 'say' | 'sapi' | 'espeak';
}

let systemCache: { at: number; status: SpeechProviderStatus } | null = null;

function speechConfig(): SpeechConfig {
  return aiConfig.get().speech ?? {};
}

export function resolvePiper(): string | null {
  const configured = aiConfig.get().toolCommands.piper;
  return configured ? findExecutable(configured) : findExecutable('piper');
}

function systemSpeech(): SystemSpeech | null {
  if (process.platform === 'darwin') {
    const say = findExecutable('say') ?? (existsSync('/usr/bin/say') ? '/usr/bin/say' : null);
    return say ? { command: say, kind: 'say' } : null;
  }
  if (process.platform === 'win32') {
    const fallback = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const ps = findExecutable('powershell') ?? (existsSync(fallback) ? fallback : null);
    return ps ? { command: ps, kind: 'sapi' } : null;
  }
  const espeak = findExecutable('espeak-ng') ?? findExecutable('espeak');
  return espeak ? { command: espeak, kind: 'espeak' } : null;
}

/** -EncodedCommand avoids any quoting problems with the script on the command line. */
function powershellArgs(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

async function systemVoices(program: SystemSpeech): Promise<SpeechVoice[]> {
  if (program.kind === 'say') return parseSayVoices((await runProcess({ command: program.command, args: ['-v', '?'], timeoutMs: 15_000 }).result).stdout);
  if (program.kind === 'espeak') return parseEspeakVoices((await runProcess({ command: program.command, args: ['--voices'], timeoutMs: 15_000 }).result).stdout);
  return parseSapiVoices((await runProcess({ command: program.command, args: powershellArgs(SAPI_VOICES_SCRIPT), timeoutMs: 30_000 }).result).stdout);
}

async function systemStatus(): Promise<SpeechProviderStatus> {
  if (systemCache && Date.now() - systemCache.at < 5 * 60_000) return systemCache.status;
  const program = systemSpeech();
  const status: SpeechProviderStatus = program
    ? { id: 'system', available: true, detail: program.command, voices: await systemVoices(program).catch(() => []) }
    : { id: 'system', available: false, detail: 'not-installed', voices: [] };
  systemCache = { at: Date.now(), status };
  return status;
}

async function piperVoices(model: string): Promise<SpeechVoice[]> {
  try {
    const dir = dirname(model);
    const names = (await readdir(dir)).filter((name) => /\.onnx$/i.test(name)).sort();
    return names.length ? names.map((name) => piperVoiceFromFile(join(dir, name))) : [piperVoiceFromFile(model)];
  } catch {
    return [piperVoiceFromFile(model)];
  }
}

async function piperStatus(): Promise<SpeechProviderStatus> {
  const model = speechConfig().piperModel;
  if (!resolvePiper()) return { id: 'piper', available: false, detail: 'not-installed', voices: [] };
  if (!model || !existsSync(model)) return { id: 'piper', available: false, detail: 'no-model', voices: [] };
  return { id: 'piper', available: true, detail: model, voices: await piperVoices(model) };
}

function customStatus(): SpeechProviderStatus {
  const custom = speechConfig().custom;
  if (!custom) return { id: 'custom', available: false, detail: 'not-configured', voices: [] };
  if (!findExecutable(custom.command)) return { id: 'custom', available: false, detail: 'not-installed', voices: [] };
  return { id: 'custom', available: true, detail: [custom.command, ...custom.args].join(' '), voices: [] };
}

export async function speechStatus(): Promise<SpeechProviderStatus[]> {
  return Promise.all([systemStatus(), piperStatus(), customStatus()]);
}

/** A Piper voice must be an .onnx file next to the configured model; anything else falls back to it. */
function piperModelFor(voice: string | undefined): string | null {
  const configured = speechConfig().piperModel;
  if (!configured || !existsSync(configured)) return null;
  if (voice && /\.onnx$/i.test(voice) && resolve(dirname(voice)) === resolve(dirname(configured)) && existsSync(voice)) return voice;
  return configured;
}

async function runSpeech(req: SpeechRequest, text: string, dir: string, output: string): Promise<ProcessResult | string> {
  const voice = typeof req.voice === 'string' && VOICE_RE.test(req.voice) ? req.voice : '';
  const textFile = join(dir, 'text.txt');
  await writeFile(textFile, text, 'utf8');
  if (req.provider === 'system') {
    const program = systemSpeech();
    if (!program) return mt('No speech program was found on this computer. On Linux install espeak-ng (for example: sudo apt install espeak-ng).');
    if (program.kind === 'say') {
      const args = [...(voice ? ['-v', voice] : []), '-r', String(wordsPerMinute(req.rate)), '--file-format=WAVE', '--data-format=LEI16@22050', '-o', output, '-f', textFile];
      return runProcess({ command: program.command, args, cwd: dir, timeoutMs: 10 * 60_000 }).result;
    }
    if (program.kind === 'espeak') {
      const args = ['-b', '1', ...(voice ? ['-v', voice] : []), '-s', String(wordsPerMinute(req.rate)), '-w', output, '-f', textFile];
      return runProcess({ command: program.command, args, cwd: dir, timeoutMs: 10 * 60_000 }).result;
    }
    const env = { ...process.env, ULTIMA_TEXT: textFile, ULTIMA_OUT: output, ULTIMA_VOICE: voice, ULTIMA_RATE: String(sapiRate(req.rate)) };
    return runProcess({ command: program.command, args: powershellArgs(SAPI_SPEAK_SCRIPT), cwd: dir, env, timeoutMs: 10 * 60_000 }).result;
  }
  if (req.provider === 'piper') {
    const exe = resolvePiper();
    if (!exe) return mt('Piper is not installed. Install it with: pip install piper-tts');
    const model = piperModelFor(req.voice);
    if (!model) return mt('Choose a Piper voice model (.onnx) in Settings → Speech first.');
    // Older Piper versions write every input line to the same file: send the text as one line.
    const line = text.replace(/\s*[\r\n]+\s*/g, ' ');
    let res: ProcessResult | null = null;
    for (const compat of [false, true]) {
      const args = ['--model', model, '--output_file', output, ...(compat ? [] : ['--length_scale', (1 / clampRate(req.rate)).toFixed(3)])];
      res = await runProcess({ command: exe, args, stdin: `${line}\n`, cwd: dir, timeoutMs: 15 * 60_000 }).result;
      if (!compat && res.code !== 0 && isUnknownOptionError(res.stderr)) continue;
      break;
    }
    return res!;
  }
  if (req.provider === 'custom') {
    const custom = speechConfig().custom;
    const exe = custom ? findExecutable(custom.command) : null;
    if (!custom || !exe) return mt('Set up a custom speech command in Settings → Speech first.');
    const args = fillSpeechArgs(custom.args, { textFile, output, voice, rate: clampRate(req.rate) });
    return runProcess({ command: exe, args, stdin: text, cwd: dir, env: cliEnv(req.allowApiBilling), timeoutMs: 15 * 60_000 }).result;
  }
  return 'Unknown speech engine';
}

export async function speak(req: SpeechRequest): Promise<SpeechResult> {
  const text = typeof req?.text === 'string' ? req.text.trim() : '';
  if (!text) return { ok: false, error: mt('There is no text to read.') };
  if (text.length > MAX_SPEECH_CHARS) {
    return { ok: false, error: mt('The text is too long (max {count} characters). Split it into parts.').replace('{count}', String(MAX_SPEECH_CHARS)) };
  }
  const dir = await mkdtemp(join(tmpdir(), 'ultima-tts-'));
  try {
    const output = join(dir, 'speech.wav');
    const res = await runSpeech(req, text, dir, output);
    if (typeof res === 'string') return { ok: false, error: res };
    try {
      const info = await stat(output);
      if (info.size > MAX_FILE_BYTES) return { ok: false, error: mt('The audio file is too large.') };
      const data = await readFile(output);
      if (data.length > 44) return { ok: true, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), mime: sniffAudioMime(data) };
    } catch {
      // no output file: report the program's own message below
    }
    if (res.timedOut) return { ok: false, error: mt('Speech generation took too long and was stopped.') };
    const detail = (res.spawnError || res.stderr || res.stdout || '').trim().slice(-1200);
    return { ok: false, error: detail ? `${mt('Speech generation failed.')}\n\n${detail}` : mt('Speech generation failed.') };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ------------------------------ Speech settings ------------------------------ */

function sanitizeCustom(custom: unknown): SpeechConfig['custom'] {
  if (!custom || typeof custom !== 'object') return null;
  const { command, args } = custom as { command?: unknown; args?: unknown };
  if (typeof command !== 'string' || !command.trim() || command.length > 500) return null;
  const list = Array.isArray(args) ? args.map(String).filter((a) => a.length <= 1000).slice(0, 40) : [];
  return { command: command.trim(), args: list };
}

async function confirm(sender: Electron.WebContents, message: string, detail: string): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(sender);
  const options: Electron.MessageBoxOptions = { type: 'question', buttons: [mt('Allow'), mt('Cancel')], defaultId: 1, cancelId: 1, message, detail };
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return result.response === 0;
}

export function registerMediaIpc(): void {
  ipcMain.handle(IPC.toolComfyModels, async (_event, baseUrl: string) => {
    try {
      return { ok: true, models: await comfyCheckpoints(baseUrl) };
    } catch (error) {
      return { ok: false, error: friendlyError(error, 'ComfyUI') };
    }
  });
  ipcMain.handle(IPC.toolLocalImageModels, async (_event, baseUrl: string) => {
    try {
      return { ok: true, models: await openAICompatModels(baseUrl, undefined, AbortSignal.timeout(4000)) };
    } catch (error) {
      return { ok: false, error: friendlyError(error, mt('the local image server')) };
    }
  });
  ipcMain.handle(IPC.toolSpeechStatus, () => speechStatus());
  ipcMain.handle(IPC.toolSpeechGenerate, (_event, req: SpeechRequest) => speak(req));
  ipcMain.handle(IPC.toolSpeechConfig, () => speechConfig());
  ipcMain.handle(IPC.toolSpeechSetConfig, async (event, custom: unknown) => {
    const clean = sanitizeCustom(custom);
    if (clean) {
      if (!clean.args.some((arg) => arg.includes('{output}'))) return false;
      const ok = await confirm(
        event.sender,
        mt('Allow Ultima to run this command?'),
        `${clean.command} ${clean.args.join(' ')}\n\n${mt('Ultima will run this program to turn text into speech.')}`,
      );
      if (!ok) return false;
    }
    aiConfig.update({ speech: { ...speechConfig(), custom: clean } });
    return true;
  });
  ipcMain.handle(IPC.toolPickPiperModel, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: mt('Choose a Piper voice (.onnx)'),
      properties: ['openFile'],
      filters: [{ name: 'Piper voice', extensions: ['onnx'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return null;
    aiConfig.update({ speech: { ...speechConfig(), piperModel: path } });
    return path;
  });
}
