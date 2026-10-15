import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findExecutable, runProcess } from './exec';

describe('findExecutable on Windows', () => {
  const saved = { platform: process.platform, PATH: process.env.PATH, PATHEXT: process.env.PATHEXT };
  let dir = '';
  const setup = (files: string[]) => {
    dir = mkdtempSync(join(tmpdir(), 'ultima-which-'));
    for (const f of files) writeFileSync(join(dir, f), '');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.PATH = dir;
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  };
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: saved.platform });
    process.env.PATH = saved.PATH;
    if (saved.PATHEXT === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = saved.PATHEXT;
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers the program over an extensionless shell script with the same name', () => {
    setup(['agy', 'agy.exe']);
    expect(findExecutable('agy')).toBe(join(dir, 'agy.exe'));
  });

  it('finds npm cmd shims and names given with their extension', () => {
    setup(['codex', 'codex.cmd', 'piper.exe']);
    expect(findExecutable('codex')).toBe(join(dir, 'codex.cmd'));
    expect(findExecutable('piper.exe')).toBe(join(dir, 'piper.exe'));
    expect(findExecutable('missing')).toBeNull();
  });
});

const PRINT_ENV = 'process.stdout.write(JSON.stringify({ key: process.env.ULTIMA_TEST_KEY ?? null, extra: process.env.ULTIMA_TEST_EXTRA ?? null }))';

describe('runProcess environment', () => {
  afterEach(() => {
    delete process.env.ULTIMA_TEST_KEY;
  });

  it('inherits the parent environment by default', async () => {
    process.env.ULTIMA_TEST_KEY = 'secret';
    const res = await runProcess({ command: process.execPath, args: ['-e', PRINT_ENV], env: undefined, timeoutMs: 20_000 }).result;
    expect(JSON.parse(res.stdout)).toEqual({ key: 'secret', extra: null });
  });

  it('keeps variables removed from a given environment out of the child', async () => {
    process.env.ULTIMA_TEST_KEY = 'secret';
    const env: NodeJS.ProcessEnv = { ...process.env, ULTIMA_TEST_EXTRA: 'yes', ELECTRON_RUN_AS_NODE: '1' };
    delete env.ULTIMA_TEST_KEY;
    const res = await runProcess({ command: process.execPath, args: ['-e', PRINT_ENV], env, timeoutMs: 20_000 }).result;
    expect(JSON.parse(res.stdout)).toEqual({ key: null, extra: 'yes' });
  });
});
