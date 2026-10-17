import { describe, expect, it } from 'vitest';
import type { AIRunRequest } from '@shared/ai-types';
import { ADAPTERS, AGY_TOOL_DENIED_MESSAGE, agyError, agyPrintTimeout, classifyError, isUnknownOptionError, safeModel, type ParseState } from './adapters';

const base: AIRunRequest = { requestId: 'r1', providerId: 'claude', prompt: 'Make it brighter', system: 'You edit photos.' };
const ctx = (request: Partial<AIRunRequest> = {}, compat = false, platform: NodeJS.Platform = 'linux', executable?: string) => ({
  request: { ...base, ...request },
  cwd: '/tmp/x',
  compat,
  platform,
  executable,
});
/** Where Antigravity's installer puts agy on Windows (this user folder name has a backtick). */
const AGY_EXE = 'C:\\Users\\PC`\\AppData\\Local\\agy\\bin\\agy.exe';
const PROMPT_FILE_ARG =
  '-p=Read the file ultima-prompt.md in the current folder with your file viewing tool (terminal commands are blocked) and follow its instructions exactly. Reply with the answer only.';
/** What Antigravity printed when its agent tried a terminal command in a headless run. */
const AGY_DENIED =
  'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json (e.g. command(<target>)). Alternatively, re-run with --dangerously-skip-permissions to auto-approve all tools.';

describe('claude adapter', () => {
  it('sends a stream-json user message on stdin with images and no tools', () => {
    const inv = ADAPTERS.claude(ctx({ images: [{ mime: 'image/png', base64: 'AAAA' }], model: 'sonnet' }));
    expect(inv.args).toContain('--input-format');
    expect(inv.args[inv.args.indexOf('--tools') + 1]).toBe('');
    expect(inv.args).toContain('--system-prompt');
    expect(inv.args).toEqual(expect.arrayContaining(['--model', 'sonnet']));
    expect(inv.args.join(' ')).not.toContain('Make it brighter'); // prompt never on the command line
    const msg = JSON.parse(inv.stdin.trim());
    expect(msg.type).toBe('user');
    expect(msg.message.content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png', data: 'AAAA' } });
    expect(msg.message.content[1]).toMatchObject({ type: 'text', text: 'Make it brighter' });
  });

  it('streams text deltas and reads the final result', () => {
    const inv = ADAPTERS.claude(ctx());
    const state: ParseState = { text: '' };
    const lines = [
      '{"type":"system","subtype":"init"}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"Hello"}',
    ];
    const deltas = lines.map((l) => inv.onLine!(l, state)).filter(Boolean);
    state.text = deltas.join('');
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(inv.finalize('', state, '')).toBe('Hello');
  });

  it('reports errors from the result event', () => {
    const inv = ADAPTERS.claude(ctx());
    const state: ParseState = { text: '' };
    inv.onLine!('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}', state);
    expect(state.isError).toBe(true);
    expect(classifyError(state.error ?? '')).toBe('not-logged-in');
  });

  it('compat mode uses plain JSON output', () => {
    const inv = ADAPTERS.claude(ctx({}, true));
    expect(inv.args).toEqual(['-p', '--output-format', 'json']);
    expect(inv.finalize('{"type":"result","result":"ok","is_error":false}', { text: '' }, '')).toBe('ok');
  });
});

describe('codex adapter', () => {
  it('reads the prompt from stdin and puts --image last', () => {
    const inv = ADAPTERS.codex(ctx({ providerId: 'codex', images: [{ mime: 'image/jpeg', base64: 'x' }, { mime: 'image/png', base64: 'y' }] }));
    const dash = inv.args.indexOf('-');
    expect(dash).toBeGreaterThan(0);
    expect(inv.args.slice(dash)).toEqual(['-', '--image', 'image-1.jpg,image-2.png']);
    expect(inv.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--skip-git-repo-check']));
    expect(inv.stdin).toContain('Make it brighter');
    expect(inv.outputFile).toBeTruthy();
  });
});

describe('gemini adapter', () => {
  it('uses JSON output, plan mode, trusted workspace and @file images', () => {
    const inv = ADAPTERS.gemini(ctx({ providerId: 'gemini', images: [{ mime: 'image/png', base64: 'x' }] }));
    expect(inv.args).toEqual(expect.arrayContaining(['--output-format', 'json', '--approval-mode', 'plan']));
    expect(inv.env?.GEMINI_CLI_TRUST_WORKSPACE).toBe('true');
    expect(inv.stdin).toContain('@./image-1.png');
    expect(inv.finalize('Loaded cached credentials.\n{"response":"Done","stats":{}}', { text: '' }, '')).toBe('Done');
  });

  it('surfaces JSON errors', () => {
    const inv = ADAPTERS.gemini(ctx({ providerId: 'gemini' }));
    const state: ParseState = { text: '' };
    inv.finalize('', state, '{"error":{"type":"Error","message":"You have exhausted your daily quota on this model."}}');
    expect(state.isError).toBe(true);
    expect(classifyError(state.error!)).toBe('rate-limited');
  });
});

describe('antigravity adapter', () => {
  it('attaches the prompt to -p, asks for JSON and runs sandboxed', () => {
    const inv = ADAPTERS.antigravity(ctx({ providerId: 'antigravity', model: 'gemini-3.1-pro-high', images: [{ mime: 'image/png', base64: 'x' }] }));
    expect(inv.args[0]).toMatch(/^-p=<instructions>/);
    expect(inv.args[0]).toContain('Make it brighter');
    expect(inv.args[0]).toContain('image-1.png');
    expect(inv.args[0]).toContain('Terminal commands are blocked');
    expect(inv.args.slice(1)).toEqual(['--output-format', 'json', '--model', 'gemini-3.1-pro-high', '--sandbox', '--disable-slash-commands', '--print-timeout', '290s']);
    expect(inv.stdin).toBe('');
    expect(inv.files?.map((f) => f.name)).toEqual(['image-1.png']);
  });

  it('passes the prompt straight to agy.exe on Windows, so the agent has no file to open', () => {
    const inv = ADAPTERS.antigravity(ctx({ providerId: 'antigravity' }, false, 'win32', AGY_EXE));
    expect(inv.args[0]).toMatch(/^-p=<instructions>/);
    expect(inv.args[0]).toContain('Make it brighter');
    expect(inv.files ?? []).toEqual([]);
  });

  it('uses a prompt file only for cmd shims and prompts too long for the command line', () => {
    const shim = ADAPTERS.antigravity(ctx({ providerId: 'antigravity' }, false, 'win32', 'C:\\Users\\me\\AppData\\Roaming\\npm\\agy.cmd'));
    expect(shim.args[0]).toBe(PROMPT_FILE_ARG);
    expect(shim.files?.find((f) => f.name === 'ultima-prompt.md')?.text).toContain('Make it brighter');
    expect(ADAPTERS.antigravity(ctx({ providerId: 'antigravity' }, false, 'win32')).args[0]).toBe(PROMPT_FILE_ARG);

    const long = ADAPTERS.antigravity(ctx({ providerId: 'antigravity', prompt: 'x'.repeat(31_000) }, false, 'win32', AGY_EXE));
    expect(long.args[0]).toBe(PROMPT_FILE_ARG);
    // quotes are escaped on the Windows command line, so they count twice
    const quoted = ADAPTERS.antigravity(ctx({ providerId: 'antigravity', prompt: '"'.repeat(16_000) }, false, 'win32', AGY_EXE));
    expect(quoted.args[0]).toBe(PROMPT_FILE_ARG);
    const fits = ADAPTERS.antigravity(ctx({ providerId: 'antigravity', prompt: 'x'.repeat(25_000) }, false, 'win32', AGY_EXE));
    expect(fits.args[0]).toContain('x'.repeat(25_000));
  });

  it('inlines long prompts on macOS and Linux up to 100 KB', () => {
    const big = ADAPTERS.antigravity(ctx({ providerId: 'antigravity', prompt: 'y'.repeat(60_000) }));
    expect(big.args[0]).toContain('y'.repeat(60_000));
    const huge = ADAPTERS.antigravity(ctx({ providerId: 'antigravity', prompt: 'y'.repeat(120_000) }, false, 'darwin'));
    expect(huge.args[0]).toBe(PROMPT_FILE_ARG);
  });

  it('explains a tool that headless mode denied instead of suggesting to allow commands', () => {
    const inv = ADAPTERS.antigravity(ctx({ providerId: 'antigravity' }));
    const viaStderr: ParseState = { text: '' };
    expect(inv.finalize('', viaStderr, `error: ${AGY_DENIED}`)).toBe('');
    expect(viaStderr).toMatchObject({ isError: true, error: AGY_TOOL_DENIED_MESSAGE });
    const viaJson: ParseState = { text: '' };
    inv.finalize(JSON.stringify({ status: 'ERROR', error: AGY_DENIED }), viaJson, '');
    expect(viaJson.error).toBe(AGY_TOOL_DENIED_MESSAGE);
    const plainLine: ParseState = { text: '' };
    inv.finalize('', plainLine, AGY_DENIED);
    expect(plainLine.error).toBe(AGY_TOOL_DENIED_MESSAGE);
    expect(classifyError(AGY_TOOL_DENIED_MESSAGE)).toBe('failed');
    // the agent got past the denied tool and answered: keep the answer
    const answered: ParseState = { text: '' };
    expect(inv.finalize('{"status":"SUCCESS","response":"Done."}', answered, `note: ${AGY_DENIED}`)).toBe('Done.');
    expect(answered.isError).toBeUndefined();
  });

  it('drops newer flags in compat mode', () => {
    const inv = ADAPTERS.antigravity(ctx({ providerId: 'antigravity' }, true));
    expect(inv.args).not.toContain('--sandbox');
    expect(inv.args).not.toContain('--disable-slash-commands');
    expect(inv.args).not.toContain('--print-timeout');
  });

  it('ends its own run just before the time limit set in Ultima', () => {
    expect(ADAPTERS.antigravity(ctx({ providerId: 'antigravity', timeoutMs: 600_000 })).args).toEqual(expect.arrayContaining(['--print-timeout', '590s']));
    expect(agyPrintTimeout(2 * 60 * 60_000)).toBe('7190s');
    expect(agyPrintTimeout(20_000)).toBe('30s');
  });

  it('treats its print timeout as a timeout, not as a (partial) answer', () => {
    const inv = ADAPTERS.antigravity(ctx({ providerId: 'antigravity' }));
    const notice = '[agy] print timeout after 4m50s with turn in progress; returning partial output';
    const viaStderr: ParseState = { text: '' };
    inv.finalize('{"status":"SUCCESS","response":"{\\"actions\\":["}', viaStderr, notice);
    expect(viaStderr).toMatchObject({ isError: true, timedOut: true });
    const viaJson: ParseState = { text: '' };
    inv.finalize(JSON.stringify({ status: 'ERROR', error: notice }), viaJson, '');
    expect(viaJson).toMatchObject({ isError: true, timedOut: true, error: notice });
  });

  it('knows when the JSON result is complete', () => {
    const done = ADAPTERS.antigravity(ctx({ providerId: 'antigravity' })).isComplete!;
    expect(done('{"conversation_id":"c1","status":"SUCCESS","response":"Hi","usage":{}}\n')).toBe(true);
    expect(done('{"status":"ERROR","error":"quota"}\n')).toBe(true);
    expect(done('{\n  "status": "SUCCESS",\n  "response": "Hi"\n}\n')).toBe(true);
    expect(done('{\n  "status": "SUCCESS",\n  "response": "Hi"\n')).toBe(false);
    expect(done('Thinking…\n{"step":"view_file"}\n')).toBe(false);
    expect(done('')).toBe(false);
  });

  it('reads the JSON envelope and AGY_ERROR lines', () => {
    const inv = ADAPTERS.antigravity(ctx({ providerId: 'antigravity' }));
    const ok: ParseState = { text: '' };
    expect(inv.finalize('{"conversation_id":"c1","status":"SUCCESS","response":"Warmer now.","usage":{}}', ok, '')).toBe('Warmer now.');
    expect(ok.isError).toBeUndefined();
    const failed: ParseState = { text: '' };
    inv.finalize('{"conversation_id":"c1","status":"ERROR","response":"Part"}', failed, 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","code":429,"retryable":false,"message":"You have reached your quota limit. It resets in 3 hours."}');
    expect(failed.isError).toBe(true);
    expect(classifyError(failed.error!)).toBe('rate-limited');
  });

  it('understands both error line styles', () => {
    expect(agyError('noise\nAGY_ERROR: {"message":"Please sign in"}')).toBe('Please sign in');
    expect(agyError('error: Your AI credits balance is too low to continue.')).toBe('Your AI credits balance is too low to continue.');
    expect(agyError('all fine')).toBeNull();
  });
});

describe('copilot adapter', () => {
  it('pipes the prompt and parses the last assistant message', () => {
    const inv = ADAPTERS.copilot(ctx({ providerId: 'copilot' }));
    expect(inv.args).not.toContain('-p');
    expect(inv.stdin).toContain('Make it brighter');
    const out = [
      '{"type":"user.message","data":{"content":"hi"}}',
      '{"type":"assistant.message","data":{"content":"First"}}',
      '{"type":"assistant.message","data":{"content":"Final answer"}}',
    ].join('\n');
    expect(inv.finalize(out, { text: '' }, '')).toBe('Final answer');
  });

  it('drops classic PATs from the environment', () => {
    const inv = ADAPTERS.copilot(ctx({ providerId: 'copilot' }));
    const env: NodeJS.ProcessEnv = { GH_TOKEN: 'ghp_abc', GITHUB_TOKEN: 'github_pat_ok' };
    inv.envFilter!(env);
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBe('github_pat_ok');
  });
});

describe('argument-prompt tools', () => {
  it('use a prompt file on Windows when started through a cmd shim', () => {
    const inv = ADAPTERS.opencode(ctx({ providerId: 'opencode' }, false, 'win32', 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd'));
    expect(inv.files?.[0]?.name).toBe('ultima-prompt.md');
    expect(inv.args.join(' ')).not.toContain('Make it brighter');
  });

  it('inline prompts for real Windows programs', () => {
    const inv = ADAPTERS.opencode(ctx({ providerId: 'opencode' }, false, 'win32', 'C:\\Tools\\opencode.EXE'));
    expect(inv.files ?? []).toEqual([]);
    expect(inv.args[inv.args.length - 1]).toContain('Make it brighter');
  });

  it('inline short prompts elsewhere', () => {
    const inv = ADAPTERS.cursor(ctx({ providerId: 'cursor' }));
    expect(inv.args[inv.args.length - 1]).toContain('Make it brighter');
    expect(inv.finalize('{"type":"result","is_error":false,"result":"OK"}', { text: '' }, '')).toBe('OK');
  });
});

describe('qwen adapter', () => {
  it('reads the result entry from the JSON array', () => {
    const inv = ADAPTERS.qwen(ctx({ providerId: 'qwen' }));
    const out = '[{"type":"system","subtype":"session_start"},{"type":"result","subtype":"success","is_error":false,"result":"Hi"}]';
    expect(inv.finalize(out, { text: '' }, '')).toBe('Hi');
  });
});

describe('helpers', () => {
  it('rejects unsafe model names', () => {
    expect(safeModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(safeModel('provider/model:latest')).toBe('provider/model:latest');
    expect(safeModel('x; rm -rf /')).toBeUndefined();
    expect(safeModel('a b')).toBeUndefined();
  });

  it('classifies common CLI errors', () => {
    expect(classifyError('You’ve hit your usage limit. Try again at 3pm')).toBe('rate-limited');
    expect(classifyError("You've hit your session limit · resets 3:45pm")).toBe('rate-limited');
    expect(classifyError('Please set an Auth method in your settings.json')).toBe('not-logged-in');
    expect(classifyError('error: unknown option --ephemeral')).toBe('unsupported');
    expect(classifyError('segfault')).toBe('failed');
  });

  it('detects unknown option errors from different CLI parsers', () => {
    expect(isUnknownOptionError("error: unexpected argument '--ephemeral' found")).toBe(true);
    expect(isUnknownOptionError('Unknown arguments: approval-mode')).toBe(true);
    expect(isUnknownOptionError('Invalid values:\n  Argument: approval-mode, Given: "plan"')).toBe(true);
    expect(isUnknownOptionError('Error: Unknown feature flag: shell_tool')).toBe(true);
    expect(isUnknownOptionError('model overloaded')).toBe(false);
  });
});
