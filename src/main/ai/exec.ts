import spawn from 'cross-spawn';
import { execFile, type ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/** Finds an executable on PATH (honours PATHEXT on Windows). Returns the absolute path or null. */
export function findExecutable(name: string): string | null {
  if (!name) return null;
  if (isAbsolute(name)) return isExecutable(name) ? name : null;
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())]
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutable(path: string): boolean {
  try {
    const info = statSync(path);
    if (!info.isFile()) return false;
    if (process.platform === 'win32') return true;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: string;
}

export interface RunProcessOptions {
  command: string;
  args: string[];
  stdin?: string;
  cwd?: string;
  /** Complete environment for the child (replaces process.env, so removed variables stay removed). */
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Called for every complete stdout line (without the trailing newline). */
  onLine?: (line: string) => void;
  /** Called for every complete stderr line (without the trailing newline). */
  onStderrLine?: (line: string) => void;
}

export interface RunningProcess {
  result: Promise<ProcessResult>;
  cancel: () => void;
}

const running = new Set<ChildProcess>();

/**
 * Spawns a program without a shell (cross-spawn takes care of Windows .cmd shims and
 * argument escaping). The prompt is always passed on stdin, never on the command line.
 */
export function runProcess(options: RunProcessOptions): RunningProcess {
  let child: ChildProcess;
  let timedOut = false;
  let aborted = false;
  let timer: NodeJS.Timeout | undefined;

  const result = new Promise<ProcessResult>((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let errLineBuffer = '';
    let settled = false;
    const finish = (partial: Partial<ProcessResult>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (lineBuffer && options.onLine) options.onLine(lineBuffer);
      if (errLineBuffer && options.onStderrLine) options.onStderrLine(errLineBuffer);
      running.delete(child);
      resolvePromise({ code: null, stdout, stderr, timedOut, aborted, ...partial });
    };

    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: {
          ...(options.env ?? process.env),
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          TERM: 'dumb',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      finish({ spawnError: error instanceof Error ? error.message : String(error) });
      return;
    }
    running.add(child);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (!options.onLine) return;
      lineBuffer += chunk;
      let index: number;
      while ((index = lineBuffer.indexOf('\n')) >= 0) {
        const line = lineBuffer.slice(0, index).replace(/\r$/, '');
        lineBuffer = lineBuffer.slice(index + 1);
        options.onLine(line);
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      if (!options.onStderrLine) return;
      errLineBuffer += chunk;
      let index: number;
      while ((index = errLineBuffer.indexOf('\n')) >= 0) {
        const line = errLineBuffer.slice(0, index).replace(/\r$/, '');
        errLineBuffer = errLineBuffer.slice(index + 1);
        options.onStderrLine(line);
      }
    });
    child.on('error', (error) => finish({ spawnError: error.message }));
    child.on('close', (code) => finish({ code }));

    child.stdin?.on('error', () => undefined); // tool exited before reading stdin
    if (options.stdin !== undefined) child.stdin?.end(options.stdin, 'utf8');
    else child.stdin?.end();

    timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);
  });

  return {
    result,
    cancel: () => {
      aborted = true;
      if (child) killTree(child);
    },
  };
}

export function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    } else {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }, 2000).unref();
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

export function killAllProcesses(): void {
  for (const child of running) killTree(child);
  running.clear();
}

/** Runs `<command> --version` (or other args) and returns the first line of output. */
export async function readVersion(command: string, args: string[] = ['--version'], timeoutMs = 15000): Promise<string | null> {
  const proc = runProcess({ command, args, timeoutMs });
  const res = await proc.result;
  if (res.spawnError || res.timedOut) return null;
  const text = (res.stdout || res.stderr).trim();
  if (!text) return res.code === 0 ? 'installed' : null;
  return text.split(/\r?\n/)[0].slice(0, 120);
}
