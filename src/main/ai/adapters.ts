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
}

export interface ParseState {
  text: string;
  final?: string;
  error?: string;
  isError?: boolean;
}

export interface AdapterContext {
  request: AIRunRequest;
  /** Working directory (a fresh, empty temp folder per request). */
  cwd: string;
  /** Use the most conservative flags (retry after an "unknown option" error). */
  compat: boolean;
  custom?: CustomCliConfig | null;
  platform: NodeJS.Platform;
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

/** For tools that need the prompt as an argument: inline it, or point to a prompt file. */
function promptArgument(ctx: AdapterContext, prompt: string): { arg: string; files: { name: string; text: string }[] } {
  if (ctx.platform !== 'win32' && prompt.length <= 12_000) return { arg: prompt, files: [] };
  // cmd.exe shims can't carry newlines or long command lines: hand over a file instead.
  return {
    arg: 'Read the file ultima-prompt.md in the current folder and follow its instructions exactly. Reply with the answer only.',
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

function antigravity(ctx: AdapterContext): CliInvocation {
  const req = ctx.request;
  const model = safeModel(req.model);
  const images = imageFiles(req);
  const note = images.length ? `Attached image(s) in the current folder: ${images.map((f) => f.name).join(', ')} — open them with your file viewing tool.` : '';
  const { arg, files } = promptArgument(ctx, [mergedPrompt(req), note].filter(Boolean).join('\n\n'));
  // The prompt must be attached to the flag: "-p <prompt>" would swallow the next option.
  const args = [`-p=${arg}`, '--output-format', 'json', ...(model ? ['--model', model] : [])];
  return {
    args: ctx.compat ? args : [...args, '--sandbox', '--disable-slash-commands'],
    stdin: '',
    files: [...images, ...files],
    failFast: {
      pattern: AGY_SIGN_IN,
      error: 'Antigravity CLI is not signed in. Open a terminal, run agy once and sign in with your Google account.',
      kind: 'not-logged-in',
    },
    finalize: (stdout, state, stderr) => {
      // {"conversation_id":…,"status":"SUCCESS"|"ERROR","response":…,"error":…,"usage":{…}}
      const obj = lastJsonObject(stdout.trim());
      const error =
        agyError(stderr) ??
        (typeof obj?.error === 'string' && obj.error ? obj.error : asRecord(obj?.error)?.message) ??
        (obj?.status === 'ERROR' ? 'Antigravity CLI reported an error.' : null);
      if (error) {
        state.isError = true;
        state.error = String(error);
      }
      return typeof obj?.response === 'string' ? obj.response : stdout.trim();
    },
  };
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
  return /unknown option|unrecognized (option|argument)|unknown argument|unknown feature flag|unexpected argument|invalid option|invalid values?:|error: option|found argument .* which wasn't expected|unexpected value .* for/i.test(
    text,
  );
}
