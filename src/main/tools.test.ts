import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/ipc';
import type { MatteResult } from '@shared/ai-types';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-tools-test-'));
  return {
    app: { getPath: () => userData },
    BrowserWindow: { fromWebContents: () => null },
    dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn), on: () => undefined },
  };
});

const { aiConfig } = await import('./ai/service');
const { registerToolsIpc } = await import('./tools');
registerToolsIpc();
const matte = (req: unknown) => handlers.get(IPC.toolMatte)!({}, req) as Promise<MatteResult>;
const posix = process.platform !== 'win32';

describe('cut-out masks with rembg', () => {
  it.runIf(posix)('runs rembg once over a folder of frames and returns a mask per frame, in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ultima-fake-rembg-'));
    const log = join(dir, 'args.txt');
    const fake = join(dir, 'rembg');
    // a stand-in that "masks" each frame by copying it, and notes how it was called
    writeFileSync(
      fake,
      `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(log)}, args.join(' '));
const [input, output] = args.slice(-2);
for (const f of fs.readdirSync(input)) fs.writeFileSync(path.join(output, f), Buffer.concat([Buffer.from('mask:'), fs.readFileSync(path.join(input, f))]));
`,
    );
    chmodSync(fake, 0o755);
    aiConfig.update({ toolCommands: { rembg: fake } });
    const frames = Array.from({ length: 12 }, (_, i) => new Uint8Array([i, i + 1, i + 2]));
    const r = await matte({ requestId: 'r1', model: 'people', frames });
    expect(r.ok).toBe(true);
    expect(r.masks!.map((m) => Buffer.from(m).subarray(5)[0])).toEqual(frames.map((f) => f[0]));
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(log, 'utf8')).toMatch(/^p -m u2net_human_seg -om \S+ \S+$/);
    expect((await matte({ requestId: 'r2', model: 'anything', frames: frames.slice(0, 1) })).ok).toBe(true);
    expect(readFileSync(log, 'utf8')).toContain('-m isnet-general-use');
  });

  it('refuses bad requests and says when rembg is missing', async () => {
    aiConfig.update({ toolCommands: { rembg: '/nonexistent/rembg' } });
    expect((await matte({ requestId: 'r', model: 'people', frames: [new Uint8Array([1])] })).error).toContain('rembg is not installed');
    aiConfig.update({ toolCommands: { rembg: process.execPath } });
    expect((await matte({ requestId: 'r', model: 'people', frames: [] })).error).toBe('Unsupported frames');
    expect((await matte({ requestId: 'r', model: 'people', frames: ['nope'] })).error).toBe('Unsupported frames');
  });
});
