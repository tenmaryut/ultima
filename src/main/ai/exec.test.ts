import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from './exec';

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
