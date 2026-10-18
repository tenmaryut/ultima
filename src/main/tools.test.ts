import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/ipc';
import type { MatteResult, StemsResult } from '@shared/ai-types';

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
const stems = (req: unknown) => handlers.get(IPC.toolStems)!({}, req) as Promise<StemsResult>;
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

describe('stems with Demucs', () => {
  it.runIf(posix)('runs Demucs for two stems and returns the stem and everything else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ultima-fake-demucs-'));
    const log = join(dir, 'args.txt');
    const fake = join(dir, 'demucs');
    // a stand-in that writes the two stems where Demucs puts them (<out>/htdemucs/<song name>/)
    writeFileSync(
      fake,
      `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(log)}, args.join(' '));
const stem = args.find((a) => a.startsWith('--two-stems=')).split('=')[1];
const out = args[args.indexOf('-o') + 1];
const input = args[args.length - 1];
const folder = path.join(out, 'htdemucs', path.basename(input, '.wav'));
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, stem + '.wav'), Buffer.concat([Buffer.from('only:'), fs.readFileSync(input)]));
fs.writeFileSync(path.join(folder, 'no_' + stem + '.wav'), Buffer.concat([Buffer.from('without:'), fs.readFileSync(input)]));
`,
    );
    chmodSync(fake, 0o755);
    aiConfig.update({ toolCommands: { demucs: fake } });
    const r = await stems({ requestId: 's1', wav: new Uint8Array([82, 73, 70, 70]), stem: 'drums' });
    expect(r.ok).toBe(true);
    expect([Buffer.from(r.only!).toString(), Buffer.from(r.without!).toString()]).toEqual(['only:RIFF', 'without:RIFF']);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(log, 'utf8')).toMatch(/^-n htdemucs --two-stems=drums -o \S+ \S+song\.wav$/);
    // an unknown stem falls back to the vocals
    expect((await stems({ requestId: 's2', wav: new Uint8Array([1]), stem: 'kazoo' })).ok).toBe(true);
    expect(readFileSync(log, 'utf8')).toContain('--two-stems=vocals');
  });

  it('refuses bad requests and says when Demucs is missing or made nothing', async () => {
    aiConfig.update({ toolCommands: { demucs: '/nonexistent/demucs' } });
    expect((await stems({ requestId: 's', wav: new Uint8Array([1]), stem: 'vocals' })).error).toContain('Demucs is not installed');
    aiConfig.update({ toolCommands: { demucs: process.execPath } });
    expect((await stems({ requestId: 's', wav: 'nope', stem: 'vocals' })).error).toBe('Unsupported sound');
    // a program that runs but writes no stems
    const r = await stems({ requestId: 's', wav: new Uint8Array([1]), stem: 'vocals' });
    expect([r.ok, typeof r.error]).toEqual([false, 'string']);
  });
});
