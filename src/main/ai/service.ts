import { BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI_PROVIDER_IDS,
  type AIRunRequest,
  type AIRunResult,
  type CliProviderId,
  type CustomCliConfig,
  type ProviderId,
  type ProviderStatus,
} from '@shared/ai-types';
import { IPC, type MainAIConfig } from '@shared/ipc';
import { PROVIDERS, getProviderInfo } from '@shared/providers-catalog';
import { ollamaChat, ollamaModels, ollamaSupportsVision, openAICompatChat, openAICompatModels } from '@shared/local-http';
import { JsonStore } from '../config-store';
import { findExecutable, readVersion, runProcess, type RunningProcess } from './exec';
import { mt } from '../i18n';
import { ADAPTERS, API_BILLING_ENV, classifyError, isUnknownOptionError, type ParseState } from './adapters';

export const aiConfig = new JsonStore<MainAIConfig>('ai-config', {
  executablePaths: {},
  custom: null,
  toolCommands: {},
});

const running = new Map<string, RunningProcess | AbortController>();
/** Requests cancelled before they started a process (Stop pressed while preparing). */
const cancelledEarly = new Set<string>();

function takeCancelled(requestId: string): boolean {
  if (!cancelledEarly.has(requestId)) return false;
  cancelledEarly.delete(requestId);
  return true;
}
let statusCache: { at: number; statuses: ProviderStatus[] } | null = null;
const versionCache = new Map<string, string>();

/** Executable for a CLI provider: user override, otherwise looked up on PATH. */
export function resolveCli(id: CliProviderId): string | null {
  const cfg = aiConfig.get();
  if (id === 'custom') return cfg.custom ? findExecutable(cfg.custom.command) : null;
  const override = cfg.executablePaths[id];
  if (override) return findExecutable(override);
  const info = getProviderInfo(id);
  return info?.command ? findExecutable(info.command) : null;
}

async function detectCli(id: CliProviderId): Promise<ProviderStatus> {
  const now = Date.now();
  const location = resolveCli(id);
  if (!location) {
    return { id, available: false, error: id === 'custom' ? 'No custom command configured' : 'Not installed (not found on PATH)', checkedAt: now };
  }
  if (id === 'custom') return { id, available: true, location, checkedAt: now };
  let version = versionCache.get(location);
  if (!version) {
    version = (await readVersion(location)) ?? undefined;
    if (version) versionCache.set(location, version);
  }
  return { id, available: true, location, version, checkedAt: now };
}

export async function detectAll(force = false): Promise<ProviderStatus[]> {
  if (!force && statusCache && Date.now() - statusCache.at < 60_000) return statusCache.statuses;
  if (force) versionCache.clear();
  const statuses = await Promise.all(CLI_PROVIDER_IDS.map((id) => detectCli(id)));
  statusCache = { at: Date.now(), statuses };
  return statuses;
}

/** Environment for an AI tool: never Electron's own switches and, unless allowed, no API-key variables. */
export function cliEnv(allowApiBilling?: boolean, extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (!allowApiBilling) for (const key of API_BILLING_ENV) delete env[key];
  // Never leak Electron's own switches into child Node-based CLIs.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

function fail(request: AIRunRequest, started: number, error: string, errorKind: AIRunResult['errorKind'] = 'failed'): AIRunResult {
  return { ok: false, text: '', error, errorKind, durationMs: Date.now() - started, providerId: request.providerId };
}

async function runHttp(request: AIRunRequest, send: (delta: string) => void, started: number): Promise<AIRunResult> {
  const ctrl = new AbortController();
  running.set(request.requestId, ctrl);
  const timer = setTimeout(() => ctrl.abort(), request.timeoutMs ?? 300_000);
  try {
    const baseUrl = request.baseUrl || getProviderInfo(request.providerId)?.defaultBaseUrl || '';
    let model = request.model ?? '';
    if (request.providerId === 'ollama' && !model) {
      model = (await ollamaModels(baseUrl, ctrl.signal))[0] ?? '';
      if (!model) return fail(request, started, 'No Ollama model is installed yet. Run: ollama pull gemma3', 'failed');
    }
    let images = request.images;
    let prompt = request.prompt;
    if (request.providerId === 'ollama' && images?.length && !(await ollamaSupportsVision(baseUrl, model, ctrl.signal))) {
      images = undefined;
      prompt = `(An image was attached but the selected model "${model}" cannot see images. Answer from the text only.)\n\n${prompt}`;
    }
    const chat = request.providerId === 'ollama' ? ollamaChat : openAICompatChat;
    const text = await chat({
      baseUrl,
      model,
      prompt,
      system: request.system,
      images,
      apiKey: request.apiKey,
      signal: ctrl.signal,
      onDelta: send,
    });
    return { ok: true, text, durationMs: Date.now() - started, providerId: request.providerId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ctrl.signal.aborted) return fail(request, started, 'Request cancelled or timed out', 'aborted');
    if (/ECONNREFUSED|fetch failed/i.test(message)) {
      return fail(request, started, `Could not reach the local AI server. Is it running? (${message})`, 'not-installed');
    }
    return fail(request, started, message, classifyError(message));
  } finally {
    clearTimeout(timer);
    running.delete(request.requestId);
  }
}

/** How long a tool may keep running after its complete answer before Ultima stops it. */
const STOP_GRACE_MS = 1500;

/** The last lines a tool printed on stderr (progress, retries, notices): what it was doing when time ran out. */
function lastWords(stderr: string): string {
  const lines = stderr
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-3).join('\n').slice(-500);
}

/** A time limit as people say it: "45 s", "5 min", "2 h", "1 h 30 min" (units translated). */
export function formatLimit(ms: number): string {
  const unit = (key: string, n: number) => mt(key).replace('{n}', String(n));
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return unit('{n} s', seconds);
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit('{n} min', minutes);
  const hours = unit('{n} h', Math.floor(minutes / 60));
  return minutes % 60 ? `${hours} ${unit('{n} min', minutes % 60)}` : hours;
}

function timeoutMessage(name: string, timeoutMs: number, stderr: string): string {
  const text = mt('{name} did not answer within the time limit ({limit}). You can raise the limit in Settings → AI behaviour → Time limit per request.')
    .replace('{name}', name)
    .replace('{limit}', formatLimit(timeoutMs));
  const last = lastWords(stderr);
  return last ? `${text}\n\n${mt('Its last message:')}\n${last}` : text;
}

async function runCli(request: AIRunRequest, send: (delta: string) => void, started: number): Promise<AIRunResult> {
  const id = request.providerId as CliProviderId;
  const executable = resolveCli(id);
  const info = getProviderInfo(id);
  if (!executable) {
    return fail(request, started, `${info?.name ?? id} is not installed or not on PATH.`, 'not-installed');
  }
  const cwd = await mkdtemp(join(tmpdir(), 'ultima-ai-'));
  try {
    // the usual way first; then, when a run says so, conservative flags, the prompt off stdin, or one more try with a note
    const attempts: { compat: boolean; avoidStdin?: boolean; note?: string }[] = [{ compat: false }];
    for (let attempt = 0; attempt < attempts.length && attempt < 5; attempt++) {
      const { compat, avoidStdin, note } = attempts[attempt];
      if (takeCancelled(request.requestId)) return fail(request, started, 'Cancelled', 'aborted');
      const req = note ? { ...request, prompt: `${request.prompt}\n\n${note}` } : request;
      const invocation = ADAPTERS[id]({ request: req, cwd, compat, avoidStdin, custom: aiConfig.get().custom, platform: process.platform, executable });
      for (const file of invocation.files ?? []) {
        await writeFile(join(cwd, file.name), file.text !== undefined ? Buffer.from(file.text, 'utf8') : Buffer.from(file.base64 ?? '', 'base64'));
      }
      const env = cliEnv(request.allowApiBilling, invocation.env);
      invocation.envFilter?.(env);
      const state: ParseState = { text: '' };
      let failedFast = false;
      // Set once stdout holds the whole answer: the tool gets a moment to exit by itself, then it is stopped.
      let complete = false;
      let stopTimer: NodeJS.Timeout | undefined;
      let out = '';
      const failFast = invocation.failFast;
      const watch = failFast
        ? (line: string) => {
            if (!failedFast && failFast.pattern.test(line)) {
              failedFast = true;
              proc.cancel();
            }
          }
        : undefined;
      // a tool that stays silent where it should start talking right away: give this way up
      let silent = false;
      let spoke = false;
      const startupTimer = invocation.startupMs
        ? setTimeout(() => {
            if (spoke) return;
            silent = true;
            proc.cancel();
          }, invocation.startupMs)
        : undefined;
      const proc = runProcess({
        command: executable,
        args: invocation.args,
        stdin: invocation.stdin,
        cwd,
        env,
        timeoutMs: request.timeoutMs ?? 300_000,
        onLine:
          invocation.onLine || watch || invocation.isComplete || startupTimer
            ? (line) => {
                spoke = true;
                watch?.(line);
                const delta = invocation.onLine?.(line, state);
                if (delta) {
                  state.text += delta;
                  send(delta);
                }
                if (invocation.isComplete && !complete) {
                  out += `${line}\n`;
                  if (invocation.isComplete(out)) {
                    complete = true;
                    stopTimer = setTimeout(() => proc.cancel(), STOP_GRACE_MS);
                  }
                }
              }
            : undefined,
        onStderrLine: watch,
      });
      running.set(request.requestId, proc);
      const res = await proc.result;
      clearTimeout(stopTimer);
      clearTimeout(startupTimer);
      running.delete(request.requestId);

      if (failedFast && failFast) return fail(request, started, mt(failFast.error), failFast.kind);
      if (silent && !avoidStdin) {
        attempts.push({ compat, avoidStdin: true, note });
        continue;
      }

      if (res.aborted && !complete) return fail(request, started, 'Cancelled', 'aborted');
      if (res.timedOut && !complete) return fail(request, started, timeoutMessage(info?.name ?? id, request.timeoutMs ?? 300_000, res.stderr), 'timeout');
      if (res.spawnError) {
        const kind = /ENOENT/.test(res.spawnError) ? 'not-installed' : 'failed';
        return fail(request, started, `Could not start ${info?.name ?? id}: ${res.spawnError}`, kind);
      }

      let text = invocation.finalize(res.stdout, state, res.stderr);
      if (invocation.outputFile) {
        try {
          const fromFile = (await readFile(join(cwd, invocation.outputFile), 'utf8')).trim();
          if (fromFile) text = fromFile;
        } catch {
          // tool didn't write it (older version); keep stdout
        }
      }
      // The tool hit its own time limit (passed from Ultima's) before finishing: report it like Ultima's.
      if (state.timedOut) return fail(request, started, timeoutMessage(info?.name ?? id, request.timeoutMs ?? 300_000, res.stderr), 'timeout');
      // Stopped by Ultima after a complete answer: a normal end, whatever the exit code says.
      const code = complete ? 0 : res.code;
      const errorText = state.error || (code !== 0 ? (res.stderr || res.stdout).trim() : '');
      // before conservative flags: a version that can't take the prompt on stdin may still know the other flags
      if (state.fallback && !avoidStdin) {
        attempts.push({ compat, avoidStdin: true, note });
        continue;
      }
      if (!compat && code !== 0 && isUnknownOptionError(res.stderr)) {
        attempts.push({ compat: true, avoidStdin, note }); // retry with conservative flags
        continue;
      }
      if (state.retryNote && !note) {
        attempts.push({ compat, avoidStdin, note: state.retryNote });
        continue;
      }
      if (state.isError || (code !== 0 && !text)) {
        const message = (errorText || `${info?.name ?? id} exited with code ${code}`).slice(0, 1500);
        return fail(request, started, mt(message), classifyError(message));
      }
      if (!text.trim()) {
        const message = (res.stderr || 'The tool returned an empty answer.').trim().slice(0, 1500);
        return fail(request, started, message, classifyError(message));
      }
      if (!state.text) send(text); // non-streaming tools: deliver the whole answer at once
      return { ok: true, text, durationMs: Date.now() - started, providerId: id };
    }
    return fail(request, started, `${info?.name ?? id} rejected the command-line options. Please update it to the latest version.`, 'unsupported');
  } finally {
    running.delete(request.requestId);
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runAIRequest(request: AIRunRequest, send: (delta: string) => void): Promise<AIRunResult> {
  const started = Date.now();
  if (!request || typeof request.prompt !== 'string' || !request.requestId) return fail(request, started, 'Invalid request');
  if (!PROVIDERS.some((p) => p.id === request.providerId)) return fail(request, started, 'Unknown AI provider');
  const info = getProviderInfo(request.providerId)!;
  if (takeCancelled(request.requestId)) return fail(request, started, 'Cancelled', 'aborted');
  try {
    return info.kind === 'http' ? await runHttp(request, send, started) : await runCli(request, send, started);
  } catch (error) {
    return fail(request, started, error instanceof Error ? error.message : String(error));
  } finally {
    cancelledEarly.delete(request.requestId);
  }
}

function sanitizeCustom(config: CustomCliConfig | null): CustomCliConfig | null {
  if (!config || typeof config.command !== 'string' || !config.command.trim()) return null;
  return {
    name: String(config.name || config.command).slice(0, 60),
    command: config.command.trim(),
    args: Array.isArray(config.args) ? config.args.map(String).slice(0, 40) : [],
    plainText: Boolean(config.plainText),
  };
}

async function confirmProgram(sender: Electron.WebContents, title: string, detail: string): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(sender);
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: [mt('Allow'), mt('Cancel')],
    defaultId: 1,
    cancelId: 1,
    title: mt(title),
    message: mt(title),
    detail,
  };
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return result.response === 0;
}

export function registerAIIpc(): void {
  ipcMain.handle(IPC.aiProviders, () => PROVIDERS);
  ipcMain.handle(IPC.aiDetect, (_event, force?: boolean) => detectAll(Boolean(force)));
  ipcMain.handle(IPC.aiRun, (event, request: AIRunRequest) =>
    runAIRequest(request, (delta) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.aiChunk, { requestId: request.requestId, delta });
    }),
  );
  ipcMain.handle(IPC.aiCancel, (_event, requestId: string) => {
    const job = running.get(requestId);
    if (!job) {
      // Not started yet (or between retries): remember it so it never starts.
      if (typeof requestId === 'string' && cancelledEarly.size < 1000) {
        cancelledEarly.add(requestId);
        setTimeout(() => cancelledEarly.delete(requestId), 10 * 60_000).unref();
      }
      return;
    }
    if (job instanceof AbortController) job.abort();
    else job.cancel();
    running.delete(requestId);
  });
  ipcMain.handle(IPC.aiGetConfig, () => aiConfig.get());
  ipcMain.handle(IPC.aiSetExecutable, async (event, providerId: ProviderId, path: string | null) => {
    if (!CLI_PROVIDER_IDS.includes(providerId as CliProviderId) || providerId === 'custom') return false;
    const paths = { ...aiConfig.get().executablePaths };
    if (!path) {
      delete paths[providerId];
    } else {
      const ok = await confirmProgram(event.sender, 'Allow Ultima to run this program?', `${getProviderInfo(providerId)?.name}: ${path}`);
      if (!ok) return false;
      paths[providerId] = String(path);
    }
    aiConfig.update({ executablePaths: paths });
    statusCache = null;
    return true;
  });
  ipcMain.handle(IPC.aiSetCustom, async (event, config: CustomCliConfig | null) => {
    const clean = sanitizeCustom(config);
    if (clean) {
      const ok = await confirmProgram(
        event.sender,
        'Allow Ultima to run this command?',
        `${clean.command} ${clean.args.join(' ')}\n\n${mt('Ultima will send your AI requests to this program on standard input.')}`,
      );
      if (!ok) return false;
    }
    aiConfig.update({ custom: clean });
    statusCache = null;
    return true;
  });
  // Returns { ok, models | error } instead of throwing: an unreachable local server is a
  // normal state, not an error worth logging from the main process.
  ipcMain.handle(IPC.aiHttpModels, async (_event, providerId: ProviderId, baseUrl: string, apiKey?: string) => {
    try {
      const signal = AbortSignal.timeout(3000);
      if (providerId === 'ollama') return { ok: true, models: await ollamaModels(baseUrl, signal) };
      if (providerId === 'openai-compatible') return { ok: true, models: await openAICompatModels(baseUrl, apiKey, signal) };
      return { ok: true, models: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: /fetch failed|ECONNREFUSED/i.test(message) ? 'Not running' : message };
    }
  });
}
