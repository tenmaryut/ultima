import { join } from 'node:path';
import type { AIErrorKind, AIRunRequest, CliProviderId, CustomCliConfig } from '@shared/ai-types';

/** Antigravity CLI waits up to a minute for a sign-in code when it is not signed in. */
export const AGY_SIGN_IN = /Authentication required|Please visit the URL to log in/i;

/**
 * How each subscription CLI is started in non-interactive mode and how its output is
 * read. Prompts go through stdin whenever the tool supports it (never through a shell).
 * Tools that only accept the prompt as an argument get it as a single argv entry, or —
 * on Windows / for long prompts — as a file in the private working directory.
 */
export interface CliInvocation {
  args: string[];
  /** Text written to the tool's stdin ('' = nothing). */
  stdin: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Removes/edits variables right before the process starts. */
  envFilter?: (env: NodeJS.ProcessEnv) => void;
  /** Files written into the working directory first (images, prompt file). */
  files?: { name: string; base64?: string; text?: string }[];
  /** Parses one stdout line; returns text to append to the streamed answer. */
  onLine?: (line: string, state: ParseState) => string | null;
  /** Builds the final answer from the collected output. */
  finalize: (stdout: string, state: ParseState, stderr: string) => string;
  /** File (inside the working dir) holding the final answer, when the tool writes one. */
  outputFile?: string;
  /** Stop right away when the tool prints this (e.g. an interactive sign-in prompt) and report `error`. */
  failFast?: { pattern: RegExp; error: string; kind: AIErrorKind };
  /** True once stdout holds the complete answer: Ultima stops waiting for a tool that lingers after it. */
  isComplete?: (stdout: string) => boolean;
  /**
   * The tool must print something on stdout within this many ms; if it stays silent, this way of sending the
   * request is given up and the adapter is asked again with `avoidStdin`.
   */
  startupMs?: number;
}

export interface ParseState {
  text: string;
  final?: string;
  error?: string;
  isError?: boolean;
  /** The tool stopped at its own time limit (the one Ultima passed) before the answer was complete. */
  timedOut?: boolean;
  /** This way of sending the request did not work: ask the adapter again with `avoidStdin`. */
  fallback?: boolean;
  /** Worth one more try, with this note added to the request. */
  retryNote?: string;
}

export interface AdapterContext {
  request: AIRunRequest;
  /** Working directory (a fresh, empty temp folder per request). */
  cwd: string;
  /** Use the most conservative flags (retry after an "unknown option" error). */
  compat: boolean;
  custom?: CustomCliConfig | null;
  platform: NodeJS.Platform;
  /** Full path of the program that will run (decides whether a prompt fits on its command line). */
  executable?: string;
  /** Send the prompt as an argument or a prompt file: sending it on stdin did not work (an older version). */
  avoidStdin?: boolean;
}

const MODEL_RE = /^[\w.:/@+-]{1,80}$/;

export function safeModel(model?: string): string | undefined {
  return model && MODEL_RE.test(model) ? model : undefined;
}

/** System prompt + prompt merged for tools that don't have a separate system prompt flag. */
export function mergedPrompt(req: AIRunRequest, imageNote = ''): string {
  const parts: string[] = [];
  if (req.system) parts.push(`<instructions>\n${req.system}\n</instructions>`);
  if (imageNote) parts.push(imageNote);
  parts.push(req.prompt);
  return parts.join('\n\n');
}

export function imageFiles(req: AIRunRequest): { name: string; base64: string }[] {
  return (req.images ?? []).slice(0, 8).map((img, i) => {
    const ext = img.mime.includes('png') ? 'png' : img.mime.includes('webp') ? 'webp' : img.mime.includes('gif') ? 'gif' : 'jpg';
    return { name: `image-${i + 1}.${ext}`, base64: img.base64 };
  });
}

function tryJson(text: string): unknown {
  const s = text.trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Longest prompt passed as one argument: Linux allows 128 KiB per argument, macOS 1 MiB for all of them. */
const MAX_ARG_BYTES = 100_000;
/** Windows allows 32,767 characters for the whole command line, and quotes and backslashes get escaped. */
const MAX_WINDOWS_ARG_CHARS = 30_000;

/** True when the prompt can go on the command line as it is. */
function fitsArgument(ctx: AdapterContext, prompt: string): boolean {
  if (ctx.platform !== 'win32') return Buffer.byteLength(prompt, 'utf8') <= MAX_ARG_BYTES;
  // Only real programs start without cmd.exe; npm's .cmd shims can't carry newlines or long command lines.
  if (!ctx.executable || !/\.(exe|com)$/i.test(ctx.executable)) return false;
  return prompt.length + (prompt.match(/["\\]/g)?.length ?? 0) <= MAX_WINDOWS_ARG_CHARS;
}

/**
 * For tools that need the prompt as an argument: inline it, or point to a prompt file. Inline is preferred —
 * reading the file is one more step for the agent, and headless agents stop when they try a terminal command for it.
 */
function promptArgument(ctx: AdapterContext, prompt: string): { arg: string; files: { name: string; text: string }[] } {
  if (fitsArgument(ctx, prompt)) return { arg: prompt, files: [] };
  return {
    arg: 'Read the file ultima-prompt.md in the current folder with your file viewing tool (terminal commands are blocked) and follow its instructions exactly. Reply with the answer only.',
    files: [{ name: 'ultima-prompt.md', text: prompt }],
  };
}

/* -------------------------------- Claude Code -------------------------------- */

function claude(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  if (ctx.compat) {
    // Oldest supported form: plain text in, one JSON result out.
    return {
      args: ['-p', '--output-format', 'json', ...(model ? ['--model', model] : [])],
      stdin: mergedPrompt(req),
      finalize: (stdout, state) => {
        const obj = asRecord(tryJson(stdout.trim().split('\n').pop() ?? ''));
        if (obj && typeof obj.result === 'string') {
          if (obj.is_error) {
            state.isError = true;
            state.error = obj.result;
          }
          return obj.result;
        }
        return stdout.trim();
      },
    };
  }
  const content: unknown[] = [];
  for (const img of req.images ?? []) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } });
  }
  content.push({ type: 'text', text: req.prompt });
  const userMessage = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  return {
    args: [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--tools', '',
      '--disallowedTools', 'mcp__*',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--system-prompt',
      req.system?.trim() || 'You are a helpful assistant inside Ultima, a creative suite.',
      ...(model ? ['--model', model] : []),
    ],
    stdin: JSON.stringify(userMessage) + '\n',
    env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    onLine: (line, state) => {
      const obj = asRecord(tryJson(line));
      if (!obj) return null;
      if (obj.type === 'stream_event') {
        const event = asRecord(obj.event);
        const delta = asRecord(event?.delta);
        if (event?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
          return delta.text;
        }
        return null;
      }
      if (obj.type === 'assistant' && !state.text) {
        // No partial messages (older versions): take the full assistant text.
        const msg = asRecord(obj.message);
        const parts = Array.isArray(msg?.content) ? (msg.content as Array<Record<string, unknown>>) : [];
        const text = parts.filter((c) => c.type === 'text').map((c) => String(c.text ?? '')).join('');
        return text || null;
      }
      if (obj.type === 'result') {
        if (typeof obj.result === 'string') state.final = obj.result;
        if (obj.is_error) {
          state.isError = true;
          const errors = Array.isArray(obj.errors) ? (obj.errors as unknown[]).map(String).join('\n') : '';
          state.error = (typeof obj.result === 'string' && obj.result) || errors || String(obj.subtype ?? 'error');
        }
      }
      return null;
    },
    finalize: (_stdout, state) => state.final ?? state.text,
  };
}

/* ------------------------------------ Codex ----------------------------------- */

function codex(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const files = imageFiles(req);
  const outputFile = 'ultima-answer.txt';
  // NOTE: `-` (read prompt from stdin) must come BEFORE --image, and --image must be
  // last: the image option greedily swallows a following positional argument.
  const tail = ['-', ...(files.length ? ['--image', files.map((f) => f.name).join(',')] : [])];
  const args = ctx.compat
    ? ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-last-message', outputFile, ...(model ? ['--model', model] : []), ...tail]
    : [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--color', 'never',
        '--sandbox', 'read-only',
        '--disable', 'shell_tool',
        '-c', 'web_search="disabled"',
        '--output-last-message', outputFile,
        ...(model ? ['--model', model] : []),
        ...tail,
      ];
  return {
    args,
    stdin: mergedPrompt(req),
    files,
    outputFile,
    finalize: (stdout) => stdout.trim(),
  };
}

/* --------------------------------- Gemini CLI --------------------------------- */

function atFileRefs(files: { name: string }[]): string {
  return files.length ? `Attached image(s): ${files.map((f) => `@./${f.name}`).join(' ')}` : '';
}

function parseGeminiJson(text: string, state: ParseState): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const obj = asRecord(tryJson(text.slice(start)));
  if (!obj) return null;
  const error = asRecord(obj.error);
  if (error && typeof error.message === 'string') {
    state.isError = true;
    state.error = error.message;
  }
  return typeof obj.response === 'string' ? obj.response : null;
}

function gemini(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const files = imageFiles(req);
  const prompt = [mergedPrompt(req), atFileRefs(files)].filter(Boolean).join('\n\n');
  const env = { GEMINI_CLI_TRUST_WORKSPACE: 'true' };
  if (ctx.compat) {
    return { args: [...(model ? ['-m', model] : [])], stdin: prompt, files, env, finalize: (stdout) => stdout.trim() };
  }
  return {
    args: ['--output-format', 'json', '--approval-mode', 'plan', ...(model ? ['-m', model] : [])],
    stdin: prompt,
    files,
    env,
    finalize: (stdout, state, stderr) => parseGeminiJson(stdout, state) ?? (parseGeminiJson(stderr, state) || stdout.trim()),
  };
}

/* ------------------------------- Antigravity CLI ------------------------------- */

/** Last complete JSON object in a tool's output (whole text, or the last line that parses). */
function lastJsonObject(text: string): Record<string, unknown> | null {
  const whole = asRecord(tryJson(text));
  if (whole) return whole;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = asRecord(tryJson(lines[i]));
    if (obj) return obj;
  }
  return null;
}

/** Message of the `AGY_ERROR: {...}` (or `error: …`) line Antigravity CLI prints on stderr when a headless run fails. */
export function agyError(stderr: string): string | null {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim());
  const tagged = lines.find((l) => l.startsWith('AGY_ERROR:'));
  if (tagged) {
    const body = tagged.slice('AGY_ERROR:'.length).trim();
    const obj = asRecord(tryJson(body));
    const message = obj?.message ?? obj?.error ?? obj?.status;
    return typeof message === 'string' && message ? message : body;
  }
  const marker = lines.find((l) => /^error:\s/i.test(l));
  return marker ? marker.replace(/^error:\s*/i, '') : null;
}

/**
 * Antigravity's notice when the agent tried a tool that needs approval (usually a terminal command): headless
 * runs can't ask, so the tool is denied and the run may end without an answer. Its advice (allow rules,
 * --dangerously-skip-permissions) would let the AI run commands on the user's computer, so Ultima explains instead.
 */
const AGY_TOOL_DENIED = /headless mode cannot prompt|auto-denied|required the "?[\w-]+"? permission|dangerously-skip-permissions/i;
export const AGY_TOOL_DENIED_MESSAGE =
  'Antigravity stopped without an answer: it tried to use a tool that needs approval (such as a terminal command on your computer), which Ultima does not allow. Please send the request again.';
/** The same, for requests Ultima already sent again by itself. */
export const AGY_TOOL_DENIED_AGAIN_MESSAGE =
  'Antigravity stopped without an answer: it tried to use a tool that needs approval (such as a terminal command on your computer), which Ultima does not allow. Ultima already asked again once. Please send the request again, or pick another model.';

/** Added to the request when Ultima asks again after a denied tool ended the run. */
export const AGY_RETRY_NOTE =
  'Note: your previous attempt at this request stopped because it tried a tool that needs approval (a terminal command). Terminal commands are blocked here. Do not run any command and do not look for other files: everything you need is in this message (attached images can be opened with your file viewing tool). Answer directly.';

/** True when `text` holds Antigravity's "tool needs approval" notice. */
export function agyToolDenied(text: string): boolean {
  return AGY_TOOL_DENIED.test(text);
}

/**
 * True once Antigravity printed its JSON result. Some versions keep running for minutes after it (background
 * tasks and summaries), so callers take the answer and stop the process instead of waiting for it to exit.
 */
export function agyAnswerComplete(stdout: string): boolean {
  const obj = lastJsonObject(stdout.trim());
  return typeof obj?.status === 'string' && ('response' in obj || 'error' in obj);
}

/** Antigravity's notice that its --print-timeout ended a turn that was still in progress. */
const AGY_PRINT_TIMEOUT = /print timeout after/i;

/** --print-timeout value just under Ultima's own limit, so Antigravity ends the run itself and says why. */
export function agyPrintTimeout(timeoutMs = 300_000): string {
  return `${Math.max(30, Math.round(timeoutMs / 1000) - 10)}s`;
}

/** True once Antigravity's stream-json output has printed its result event (it is the newest line). */
export function agyStreamComplete(stdout: string): boolean {
  const lines = stdout.trimEnd().split(/\r?\n/);
  return asRecord(tryJson(lines[lines.length - 1] ?? ''))?.event === 'result';
}

/**
 * The result of a stream-json run — `{"event":"result","result":{status, response, error}, denied_actions}`, its
 * fields read from either level — with the answer: its response, or the text the agent streamed (`step_update`
 * events with `text_delta`).
 */
export function agyStreamResult(stdout: string): { result: Record<string, unknown> | null; text: string } {
  let result: Record<string, unknown> | null = null;
  let streamed = '';
  for (const line of stdout.split(/\r?\n/)) {
    const event = asRecord(tryJson(line));
    if (event?.event === 'result') result = { ...event, ...asRecord(event.result) };
    else if (event?.event === 'step_update') {
      const step = asRecord(event.step_update);
      if (step && step.step_type !== 'tool' && typeof step.text_delta === 'string') streamed += step.text_delta;
    }
  }
  const response = typeof result?.response === 'string' ? result.response : '';
  return { result, text: response.trim() ? response : streamed };
}

/** Antigravity says nothing for this long on the stdin route: it is given up for the prompt-file route. */
export const AGY_STARTUP_MS = 90_000;

function antigravity(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const images = imageFiles(req);
  const compose = (attached: string) =>
    [mergedPrompt(req), images.length ? `${attached} — open them with your file viewing tool.` : '', 'Terminal commands are blocked here: answer without running any.']
      .filter(Boolean)
      .join('\n\n');
  const prompt = compose(`Attached image(s) in the current folder: ${images.map((f) => f.name).join(', ')}`);
  const flags = ctx.compat ? [] : ['--sandbox', '--disable-slash-commands'];
  const failFast = {
    pattern: AGY_SIGN_IN,
    error: 'Antigravity CLI is not signed in. Open a terminal, run agy once and sign in with your Google account.',
    kind: 'not-logged-in' as const,
  };
  // Too long for the command line (or a .cmd shim, which can't carry it): the request goes to stdin as a stream-json
  // event, so the agent has no prompt file to open — opening one with a terminal command is what headless mode blocks.
  // Its tools don't start in the current folder this way: the folder is added to the workspace (reading there needs
  // no approval) and images are named by full path. Never with -p, which takes the next option as its prompt here.
  if (!ctx.compat && !ctx.avoidStdin && !fitsArgument(ctx, prompt)) {
    const content = compose(`Attached image(s): ${images.map((f) => join(ctx.cwd, f.name)).join(', ')}`);
    return {
      args: [
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        ...(model ? ['--model', model] : []),
        ...flags,
        '--add-dir',
        ctx.cwd,
        '--print-timeout',
        agyPrintTimeout(req.timeoutMs),
      ],
      stdin: `${JSON.stringify({ event: 'user', message: { content } })}\n`,
      files: images,
      failFast,
      isComplete: agyStreamComplete,
      startupMs: AGY_STARTUP_MS,
      finalize: (stdout, state, stderr) => {
        const { result, text } = agyStreamResult(stdout);
        // no result at all: this version doesn't take requests this way
        if (!result && !text.trim() && !agyToolDenied(stderr)) {
          state.fallback = true;
          return '';
        }
        // a denied tool ends the turn with an empty response: what the agent streamed before it is not the answer
        const response = typeof result?.response === 'string' ? result.response : '';
        const cutShort = Array.isArray(result?.denied_actions) && result.denied_actions.length > 0 && !response.trim();
        return agyFinish(result, cutShort ? '' : text, state, stderr);
      },
    };
  }
  const { arg, files } = promptArgument(ctx, prompt);
  // The prompt must be attached to the flag: "-p <prompt>" would swallow the next option.
  const args = [`-p=${arg}`, '--output-format', 'json', ...(model ? ['--model', model] : [])];
  return {
    args: ctx.compat ? args : [...args, ...flags, '--print-timeout', agyPrintTimeout(req.timeoutMs)],
    stdin: '',
    files: [...images, ...files],
    failFast,
    isComplete: agyAnswerComplete,
    finalize: (stdout, state, stderr) => {
      // {"conversation_id":…,"status":"SUCCESS"|"ERROR","response":…,"error":…,"usage":{…}}
      const obj = lastJsonObject(stdout.trim());
      return agyFinish(obj, typeof obj?.response === 'string' ? obj.response : stdout.trim(), state, stderr);
    },
  };
}

/** The answer of an Antigravity run from its result object, or why there is none. */
function agyFinish(obj: Record<string, unknown> | null, text: string, state: ParseState, stderr: string): string {
  const error =
    agyError(stderr) ??
    (typeof obj?.error === 'string' && obj.error ? obj.error : asRecord(obj?.error)?.message) ??
    (obj?.status === 'ERROR' ? 'Antigravity CLI reported an error.' : null);
  const denied = Array.isArray(obj?.denied_actions) && obj.denied_actions.length > 0;
  const deny = () => {
    state.isError = true;
    // the agent may well answer when asked again, told that commands are blocked (Ultima does that once)
    state.error = AGY_TOOL_DENIED_AGAIN_MESSAGE;
    state.retryNote = AGY_RETRY_NOTE;
  };
  if (agyToolDenied(String(error ?? ''))) deny();
  else if (AGY_PRINT_TIMEOUT.test(`${error ?? ''}\n${stderr}`)) {
    // "[agy] print timeout after 1h59m50s with turn in progress; returning partial output": not an answer
    state.isError = true;
    state.timedOut = true;
    state.error = String(error ?? 'Antigravity reached its time limit.');
  } else if (!text.trim() && (agyToolDenied(stderr) || denied)) {
    // a denied tool only matters when nothing came back; its notice can be on any stderr line
    deny();
  } else if (error) {
    state.isError = true;
    state.error = String(error);
  }
  return text;
}

/* ---------------------------------- Qwen Code ---------------------------------- */

function qwen(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const files = imageFiles(req);
  const prompt = [mergedPrompt(req), atFileRefs(files)].filter(Boolean).join('\n\n');
  if (ctx.compat) {
    return { args: [...(model ? ['-m', model] : [])], stdin: prompt, files, finalize: (stdout) => stdout.trim() };
  }
  return {
    args: ['--output-format', 'json', '--approval-mode', 'plan', ...(model ? ['-m', model] : [])],
    stdin: prompt,
    files,
    finalize: (stdout, state) => {
      const start = stdout.indexOf('[');
      const parsed = start >= 0 ? tryJson(stdout.slice(start)) : null;
      if (Array.isArray(parsed)) {
        const result = [...parsed].reverse().map(asRecord).find((e) => e?.type === 'result');
        if (result) {
          if (result.is_error) {
            state.isError = true;
            state.error = String(result.result ?? result.subtype ?? 'error');
          }
          if (typeof result.result === 'string') return result.result;
        }
      }
      return stdout.trim();
    },
  };
}

/* ------------------------------ GitHub Copilot CLI ------------------------------ */

function lastAssistantText(stdout: string): string | null {
  let answer: string | null = null;
  for (const line of stdout.split('\n')) {
    const obj = asRecord(tryJson(line));
    if (!obj) continue;
    const data = asRecord(obj.data);
    if (obj.type === 'assistant.message' && typeof data?.content === 'string' && data.content.trim()) answer = data.content;
    else if ((obj.type === 'message' || obj.role) && obj.role === 'assistant' && typeof obj.content === 'string' && obj.content.trim()) answer = obj.content;
    else if (obj.type === 'result' && typeof obj.result === 'string' && obj.result.trim()) answer = obj.result;
  }
  return answer;
}

function copilot(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const files = imageFiles(req);
  // Classic personal access tokens in the environment make Copilot CLI refuse to start;
  // the stored login is used instead.
  const envFilter = (env: NodeJS.ProcessEnv) => {
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN']) if (env[key]?.startsWith('ghp_')) delete env[key];
  };
  if (ctx.compat) {
    return { args: ['-s', ...(model ? ['--model', model] : [])], stdin: mergedPrompt(req), envFilter, finalize: (stdout) => stdout.trim() };
  }
  return {
    // The prompt is piped on stdin (no -p) so it is not limited by command-line length.
    args: [
      '-s',
      '--output-format', 'json',
      '--no-ask-user',
      '--available-tools=view',
      '--deny-tool=shell',
      '--deny-tool=write',
      '--disable-builtin-mcps',
      '--no-custom-instructions',
      ...(model ? [`--model=${model}`] : []),
      ...files.flatMap((f) => ['--attachment', `./${f.name}`]),
    ],
    stdin: mergedPrompt(req),
    files,
    envFilter,
    finalize: (stdout) => lastAssistantText(stdout) ?? stdout.trim(),
  };
}

/* --------------------------------- Cursor CLI --------------------------------- */

function cursor(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const { arg, files } = promptArgument(ctx, mergedPrompt(req));
  if (ctx.compat) {
    return { args: ['-p', ...(model ? ['--model', model] : []), arg], stdin: '', files, finalize: (stdout) => stdout.trim() };
  }
  return {
    args: ['-p', '--output-format', 'json', '--mode', 'ask', ...(model ? ['--model', model] : []), arg],
    stdin: '',
    files,
    finalize: (stdout, state) => {
      const obj = asRecord(tryJson(stdout.trim().split('\n').pop() ?? ''));
      if (obj && typeof obj.result === 'string') {
        if (obj.is_error) {
          state.isError = true;
          state.error = obj.result;
        }
        return obj.result;
      }
      return stdout.trim();
    },
  };
}

/* ---------------------------------- opencode ---------------------------------- */

function opencode(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const { arg, files } = promptArgument(ctx, mergedPrompt(req));
  if (ctx.compat) {
    return { args: ['run', ...(model ? ['-m', model] : []), arg], stdin: '', files, finalize: (stdout) => stdout.trim() };
  }
  return {
    args: ['run', '--format', 'json', ...(model ? ['-m', model] : []), arg],
    stdin: '',
    files,
    onLine: (line, state) => {
      const obj = asRecord(tryJson(line));
      if (!obj) return null;
      const part = asRecord(obj.part);
      if (obj.type === 'text' && typeof part?.text === 'string') return part.text;
      if (obj.type === 'error') {
        state.isError = true;
        const err = asRecord(obj.error);
        state.error = String(err?.message ?? part?.text ?? 'opencode error');
      }
      return null;
    },
    finalize: (stdout, state) => state.text || stdout.trim(),
  };
}

/* ---------------------------------- Kimi Code ---------------------------------- */

function kimi(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const { arg, files } = promptArgument(ctx, mergedPrompt(req));
  if (ctx.compat) {
    return { args: ['-p', arg, ...(model ? ['-m', model] : [])], stdin: '', files, finalize: (stdout) => stdout.trim() };
  }
  return {
    args: ['-p', arg, '--output-format', 'stream-json', ...(model ? ['-m', model] : [])],
    stdin: '',
    files,
    finalize: (stdout) => {
      let answer: string | null = null;
      for (const line of stdout.split('\n')) {
        const obj = asRecord(tryJson(line));
        if (obj?.role === 'assistant' && typeof obj.content === 'string' && obj.content.trim()) answer = obj.content;
      }
      return answer ?? stdout.trim();
    },
  };
}

/* ----------------------------------- Custom ----------------------------------- */

function custom(ctx: AdapterContext): CliInvocation {
  const cfg = ctx.custom;
  return {
    args: cfg?.args ?? [],
    stdin: mergedPrompt(ctx.request),
    onLine: cfg?.plainText ? (line) => line + '\n' : undefined,
    finalize: (stdout) => stdout.trim(),
  };
}

export const ADAPTERS: Record<CliProviderId, (ctx: AdapterContext) => CliInvocation> = {
  claude,
  codex,
  antigravity,
  gemini,
  qwen,
  copilot,
  cursor,
  opencode,
  kimi,
  custom,
};

/** Environment variables that would make CLIs bill an API key instead of the subscription. */
export const API_BILLING_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'DASHSCOPE_API_KEY',
  'CURSOR_API_KEY',
  'MOONSHOT_API_KEY',
  'KIMI_API_KEY',
];

/** Turns tool output into a friendly error category. */
export function classifyError(text: string): AIErrorKind {
  const s = text.toLowerCase();
  if (
    /not logged in|please run \/login|login expired|log ?in required|not authenticated|unauthori[sz]ed|authentication|auth method|oauth token|sign in|codex login|no credentials|401/.test(
      s,
    )
  ) {
    return 'not-logged-in';
  }
  if (/usage limit|rate limit|hit your|limit reached|quota|too many requests|429|resets? (at|in|on)|exhausted|at capacity|credits/.test(s)) {
    return 'rate-limited';
  }
  if (isUnknownOptionError(s)) return 'unsupported';
  return 'failed';
}

export function isUnknownOptionError(text: string): boolean {
  return /unknown option|unknown (shorthand )?flag|unrecognized (option|argument)|unknown argument|unknown feature flag|unexpected argument|invalid option|invalid values?:|error: option|found argument .* which wasn't expected|unexpected value .* for/i.test(
    text,
  );
}
