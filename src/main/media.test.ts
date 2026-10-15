import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-media-test-'));
  return {
    app: { getPath: () => userData },
    BrowserWindow: { fromWebContents: () => null },
    dialog: { showMessageBox: async () => ({ response: 0 }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
});

const { aiConfig, runAIRequest } = await import('./ai/service');
const { findExecutable } = await import('./ai/exec');
const { comfyCheckpoints, generateImageWith, speak, speechStatus } = await import('./media');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const work = mkdtempSync(join(tmpdir(), 'ultima-media-work-'));
const posix = process.platform !== 'win32';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

async function serve(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(() => done())) };
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

/** Writes an executable Node script (POSIX only; Windows would need a .cmd shim). */
function script(name: string, source: string): string {
  const file = join(work, name);
  writeFileSync(file, `#!/usr/bin/env node\n${source}`);
  chmodSync(file, 0o755);
  return file;
}

const base = { requestId: 'r1', baseUrl: '', prompt: 'a red fox in the snow', width: 512, height: 512 };

describe('ComfyUI', () => {
  it('queues the standard workflow, waits for the result and downloads the image', async () => {
    let posted: { prompt: Record<string, { inputs: Record<string, unknown> }> } | null = null;
    let polls = 0;
    const server = await serve((req, body, res) => {
      if (req.url === '/object_info/CheckpointLoaderSimple') {
        return json(res, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sd15.safetensors', 'sdxl.safetensors'], {}] } } } });
      }
      if (req.url === '/prompt' && req.method === 'POST') {
        posted = JSON.parse(body);
        return json(res, { prompt_id: 'p1', number: 1, node_errors: {} });
      }
      if (req.url === '/history/p1') {
        polls++;
        if (polls < 2) return json(res, {});
        return json(res, { p1: { outputs: { '9': { images: [{ filename: 'ultima_00001_.png', subfolder: '', type: 'output' }] } }, status: { status_str: 'success', completed: true, messages: [] } } });
      }
      if (req.url === '/view?filename=ultima_00001_.png&subfolder=&type=output') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(PNG);
      }
      json(res, { error: 'not found' }, 404);
    });
    try {
      const result = await generateImageWith({ ...base, provider: 'comfyui', baseUrl: server.url, negativePrompt: 'blurry', width: 770, height: 1000, steps: 12, seed: 7 });
      expect(result).toMatchObject({ ok: true, mimeTypes: ['image/png'] });
      expect(Buffer.from(result.images[0], 'base64')).toEqual(PNG);
      expect(posted!.prompt['4'].inputs.ckpt_name).toBe('sd15.safetensors');
      expect(posted!.prompt['5'].inputs).toMatchObject({ width: 768, height: 1000 });
      expect(posted!.prompt['3'].inputs).toMatchObject({ steps: 12, seed: 7 });
      expect(posted!.prompt['7'].inputs.text).toBe('blurry');
    } finally {
      await server.close();
    }
  });

  it('reports validation errors from the server', async () => {
    const server = await serve((req, _body, res) => {
      if (req.url === '/prompt') {
        return json(res, { error: { message: 'Prompt outputs failed validation', details: '' }, node_errors: { '4': { errors: [{ message: 'Value not in list', details: 'ckpt_name: missing.safetensors' }] } } }, 400);
      }
      json(res, {}, 404);
    });
    try {
      const result = await generateImageWith({ ...base, provider: 'comfyui', baseUrl: server.url, model: 'missing.safetensors' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Value not in list: ckpt_name: missing.safetensors');
    } finally {
      await server.close();
    }
  });

  it('reads checkpoint lists in the newer COMBO format', async () => {
    const server = await serve((_req, _body, res) => json(res, { CheckpointLoaderSimple: { input: { required: { ckpt_name: ['COMBO', { options: ['flux1-schnell-fp8.safetensors'] }] } } } }));
    try {
      expect(await comfyCheckpoints(server.url)).toEqual(['flux1-schnell-fp8.safetensors']);
    } finally {
      await server.close();
    }
  });

  it('explains when the server is not running and refuses internet addresses', async () => {
    const server = await serve((_req, _body, res) => json(res, {}));
    const url = server.url;
    await server.close();
    expect((await generateImageWith({ ...base, provider: 'comfyui', baseUrl: url, model: 'x' })).error).toMatch(/Could not reach ComfyUI/);
    expect((await generateImageWith({ ...base, provider: 'comfyui', baseUrl: 'http://example.com:8188', model: 'x' })).error).toMatch(/only connects to AI servers on this computer/);
  });
});

describe('OpenAI-style local image server', () => {
  it('sends model, size and prompt and decodes base64 images', async () => {
    let request: Record<string, unknown> = {};
    const server = await serve((req, body, res) => {
      if (req.url === '/v1/images/generations') {
        request = JSON.parse(body);
        return json(res, { created: 1, data: [{ b64_json: PNG.toString('base64') }] });
      }
      json(res, {}, 404);
    });
    try {
      const result = await generateImageWith({ ...base, provider: 'local-openai', baseUrl: `${server.url}/v1/`, model: 'flux.1-dev-ggml', width: 1024, height: 768 });
      expect(result.ok).toBe(true);
      expect(Buffer.from(result.images[0], 'base64')).toEqual(PNG);
      expect(request).toMatchObject({ model: 'flux.1-dev-ggml', prompt: base.prompt, size: '1024x768', n: 1, response_format: 'b64_json' });
    } finally {
      await server.close();
    }
  });

  it('follows relative image links on the same server', async () => {
    const server = await serve((req, _body, res) => {
      if (req.url === '/v1/images/generations') return json(res, { data: [{ url: '/generated/img.png' }] });
      if (req.url === '/generated/img.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(PNG);
      }
      json(res, {}, 404);
    });
    try {
      const result = await generateImageWith({ ...base, provider: 'local-openai', baseUrl: `${server.url}/v1`, model: 'sd' });
      expect(Buffer.from(result.images[0], 'base64')).toEqual(PNG);
    } finally {
      await server.close();
    }
  });

  it('asks for a model first', async () => {
    expect((await generateImageWith({ ...base, provider: 'local-openai', baseUrl: 'http://127.0.0.1:1/v1' })).error).toMatch(/Choose an image model/);
  });
});

describe.skipIf(!posix)('Codex image tool', () => {
  const home = join(work, 'codex-home');
  const savedEnv = { CODEX_HOME: process.env.CODEX_HOME, OPENAI_API_KEY: process.env.OPENAI_API_KEY };

  beforeAll(() => {
    mkdirSync(home, { recursive: true });
    process.env.CODEX_HOME = home;
    process.env.OPENAI_API_KEY = 'sk-should-not-be-used';
    // An image from an earlier session must never be picked up.
    const old = join(home, 'generated_images', 'old-thread');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'old.png'), PNG);
    const past = new Date(Date.now() - 3600_000);
    utimesSync(join(old, 'old.png'), past, past);
    utimesSync(old, past, past);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const fakeCodex = (name: string, behaviour: string) =>
    script(
      name,
      `const fs = require('fs'), path = require('path');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  fs.appendFileSync(path.join(process.env.CODEX_HOME, '${name}.log'), JSON.stringify({ args, input, key: process.env.OPENAI_API_KEY ?? null }) + '\\n');
  const save = () => {
    const dir = path.join(process.env.CODEX_HOME, 'generated_images', 'thread-' + process.pid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ig_1.png'), Buffer.from(${JSON.stringify([...PNG])}));
  };
  ${behaviour}
});`,
    );
  const runs = (name: string) =>
    readFileSync(join(home, `${name}.log`), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[]; input: string; key: string | null });

  it('runs codex exec with the image tool enabled and returns the new image', async () => {
    aiConfig.update({ executablePaths: { codex: fakeCodex('codex-ok', 'save(); console.log("Done.");') } });
    const result = await generateImageWith({ ...base, provider: 'codex', width: 1536, height: 1024 });
    expect(result).toMatchObject({ ok: true, mimeTypes: ['image/png'] });
    expect(result.images).toHaveLength(1);
    const [run] = runs('codex-ok');
    expect(run.args).toEqual(expect.arrayContaining(['exec', '--enable', 'image_generation', '--sandbox', 'read-only', '-']));
    expect(run.input).toContain('Image description: a red fox in the snow');
    expect(run.input).toContain('landscape');
    expect(run.key).toBeNull();
  });

  it('gives each job of a batch only its own image', async () => {
    aiConfig.update({ executablePaths: { codex: fakeCodex('codex-batch', 'save();') } });
    const results = await Promise.all([1, 2, 3].map(() => generateImageWith({ ...base, provider: 'codex' })));
    expect(results.map((r) => r.images.length)).toEqual([1, 1, 1]);
    expect(runs('codex-batch')).toHaveLength(3);
  });

  it('retries with basic flags when an older Codex does not know the image feature', async () => {
    aiConfig.update({
      executablePaths: {
        codex: fakeCodex('codex-old', `if (args.includes('--enable')) { console.error('Error: Unknown feature flag: image_generation'); process.exit(2); } save();`),
      },
    });
    const result = await generateImageWith({ ...base, provider: 'codex' });
    expect(result.ok).toBe(true);
    const log = runs('codex-old');
    expect(log).toHaveLength(2);
    expect(log[1].args).not.toContain('--enable');
  });

  it('explains a missing sign-in', async () => {
    aiConfig.update({ executablePaths: { codex: fakeCodex('codex-logged-out', `console.error('Not logged in. Please run codex login'); process.exit(1);`) } });
    const result = await generateImageWith({ ...base, provider: 'codex' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Codex is not signed in/);
  });

  it('keeps the API key when the user allowed API billing', async () => {
    aiConfig.update({ executablePaths: { codex: fakeCodex('codex-billing', 'save();') } });
    await generateImageWith({ ...base, provider: 'codex', allowApiBilling: true });
    expect(runs('codex-billing')[0].key).toBe('sk-should-not-be-used');
  });
});

describe.skipIf(!posix)('Antigravity CLI', () => {
  const home = join(work, 'agy-home');
  const savedHome = process.env.HOME;
  const savedKey = process.env.GEMINI_API_KEY;

  beforeAll(() => {
    mkdirSync(home, { recursive: true });
    process.env.HOME = home;
    process.env.GEMINI_API_KEY = 'must-not-reach-agy';
  });

  afterAll(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  /** A stand-in for `agy`: saves the image like Antigravity's generate_image tool and prints the JSON envelope. */
  const fakeAgy = (name: string, behaviour: string) =>
    script(
      name,
      `const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const prompt = (args.find((a) => a.startsWith('-p=')) || '').slice(3);
fs.appendFileSync(path.join(process.env.HOME, '${name}.log'), JSON.stringify({ args, key: process.env.GEMINI_API_KEY ?? null }) + '\\n');
const imageName = (/Image name: (\\S+)/.exec(prompt) || [])[1] || 'image';
const conversation = 'conv-' + process.pid;
const save = () => {
  const dir = path.join(process.env.HOME, '.gemini', 'antigravity-cli', 'brain', conversation);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, imageName + '_' + Date.now() + '.png');
  fs.writeFileSync(file, Buffer.from(${JSON.stringify([...PNG])}));
  return file;
};
const envelope = (fields) => console.log(JSON.stringify({ conversation_id: conversation, status: 'SUCCESS', response: '', duration_seconds: 1, num_turns: 2, usage: {}, ...fields }));
${behaviour}`,
    );
  const calls = (name: string) => readFileSync(join(home, `${name}.log`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; key: string | null });

  it('runs agy with the image request and reads the saved file from its answer', async () => {
    aiConfig.update({ executablePaths: { antigravity: fakeAgy('agy-path', `const file = save(); envelope({ response: file });`) } });
    const result = await generateImageWith({ ...base, provider: 'antigravity', width: 1920, height: 1080 });
    expect(result).toMatchObject({ ok: true, mimeTypes: ['image/png'] });
    expect(Buffer.from(result.images[0], 'base64')).toEqual(PNG);
    const [call] = calls('agy-path');
    expect(call.args[0]).toMatch(/^-p=Create exactly one image/);
    expect(call.args[0]).toContain('Aspect ratio: 16:9');
    expect(call.args.slice(1)).toEqual(['--output-format', 'json', '--sandbox', '--disable-slash-commands', '--print-timeout', '7m']);
    expect(call.key).toBeNull();
  });

  it('finds the image in the conversation folder when the answer has no path', async () => {
    aiConfig.update({ executablePaths: { antigravity: fakeAgy('agy-nopath', `save(); envelope({ response: 'Done, the image is ready.' });`) } });
    const result = await generateImageWith({ ...base, provider: 'antigravity' });
    expect(result.ok).toBe(true);
    expect(result.images).toHaveLength(1);
  });

  it('stops at once when agy asks to sign in', async () => {
    aiConfig.update({
      executablePaths: {
        antigravity: fakeAgy('agy-signin', `console.error('Authentication required. Please visit the URL to log in:'); setTimeout(() => {}, 60000);`),
      },
    });
    const started = Date.now();
    const result = await generateImageWith({ ...base, provider: 'antigravity' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not signed in/);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('explains an exhausted plan quota', async () => {
    aiConfig.update({
      executablePaths: {
        antigravity: fakeAgy(
          'agy-quota',
          `console.error('AGY_ERROR: {"status":"RESOURCE_EXHAUSTED","code":429,"message":"You have reached your quota limit."}'); envelope({ status: 'ERROR', error: 'quota' }); process.exit(3);`,
        ),
      },
    });
    const result = await generateImageWith({ ...base, provider: 'antigravity' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Google AI plan has reached its limit/);
  });

  it('chat: returns the response and fails fast without a sign-in', async () => {
    aiConfig.update({ executablePaths: { antigravity: fakeAgy('agy-chat', `envelope({ response: 'Halo! ' + prompt.length });`) } });
    const ok = await runAIRequest({ requestId: 'c1', providerId: 'antigravity', prompt: 'Sapa saya' }, () => undefined);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.text).toMatch(/^Halo! \d+$/);
    aiConfig.update({
      executablePaths: { antigravity: fakeAgy('agy-chat-signin', `console.error('Authentication required. Please visit the URL to log in:'); setTimeout(() => {}, 60000);`) },
    });
    const started = Date.now();
    const failed = await runAIRequest({ requestId: 'c2', providerId: 'antigravity', prompt: 'Sapa saya' }, () => undefined);
    expect(failed).toMatchObject({ ok: false, errorKind: 'not-logged-in' });
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('chat: takes the answer at once when agy keeps running after it', async () => {
    aiConfig.update({ executablePaths: { antigravity: fakeAgy('agy-linger', `envelope({ response: 'Done.' }); setTimeout(() => {}, 60000);`) } });
    const started = Date.now();
    const result = await runAIRequest({ requestId: 'c3', providerId: 'antigravity', prompt: 'Cut on the beat' }, () => undefined);
    expect(result).toMatchObject({ ok: true, text: 'Done.' });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(calls('agy-linger')[0].args).toEqual(expect.arrayContaining(['--print-timeout', '290s']));
  });

  it('chat: a timeout names the limit and what agy printed last', async () => {
    aiConfig.update({
      executablePaths: { antigravity: fakeAgy('agy-slow', `console.error('Model is busy, retrying (attempt 4)'); setTimeout(() => {}, 60000);`) },
    });
    const result = await runAIRequest({ requestId: 'c4', providerId: 'antigravity', prompt: 'Cut on the beat', timeoutMs: 2500 }, () => undefined);
    expect(result).toMatchObject({ ok: false, errorKind: 'timeout' });
    expect(result.error).toContain('within the time limit (3 s)');
    expect(result.error).toContain('Time limit per request');
    expect(result.error).toContain('Model is busy, retrying (attempt 4)');
  });

  it('images: picks up the image at once when agy keeps running after its answer', async () => {
    aiConfig.update({ executablePaths: { antigravity: fakeAgy('agy-image-linger', `const file = save(); envelope({ response: file }); setTimeout(() => {}, 60000);`) } });
    const started = Date.now();
    const result = await generateImageWith({ ...base, provider: 'antigravity' });
    expect(result).toMatchObject({ ok: true, mimeTypes: ['image/png'] });
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});

describe('speech', () => {
  const ttsScript = join(work, 'fake-tts.js');
  const record = join(work, 'fake-tts.json');

  beforeAll(() => {
    // Writes a small WAV to the output path and records what it was given.
    writeFileSync(
      ttsScript,
      `const fs = require('fs');
const [textFile, output, voice, rate] = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ text: fs.readFileSync(textFile, 'utf8'), stdin, voice, rate, key: process.env.OPENAI_API_KEY ?? null }));
  const wav = Buffer.alloc(144);
  wav.write('RIFF', 0); wav.write('WAVE', 8);
  fs.writeFileSync(output, wav);
});`,
    );
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('runs a custom command with the placeholders filled in', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    aiConfig.update({ speech: { custom: { command: process.execPath, args: [ttsScript, '{text_file}', '{output}', '{voice}', '{rate}'] } } });
    const result = await speak({ requestId: 's1', provider: 'custom', text: '  Halo dunia  ', voice: 'id-ID-GadisNeural', rate: 1.5 });
    expect(result).toMatchObject({ ok: true, mime: 'audio/wav' });
    expect(result.data!.byteLength).toBe(144);
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({ text: 'Halo dunia', stdin: 'Halo dunia', voice: 'id-ID-GadisNeural', rate: '1.5', key: null });
  });

  it('never passes a voice that looks like an option', async () => {
    await speak({ requestId: 's2', provider: 'custom', text: 'Hi', voice: '--output=/etc/passwd' });
    expect(JSON.parse(readFileSync(record, 'utf8')).voice).toBe('');
  });

  it('keeps voice names with accents (macOS "Amélie")', async () => {
    await speak({ requestId: 's2b', provider: 'custom', text: 'Bonjour', voice: 'Amélie' });
    expect(JSON.parse(readFileSync(record, 'utf8')).voice).toBe('Amélie');
  });

  it('rejects empty or very long text', async () => {
    expect((await speak({ requestId: 's3', provider: 'custom', text: '   ' })).error).toMatch(/no text/);
    expect((await speak({ requestId: 's4', provider: 'custom', text: 'a'.repeat(20_001) })).error).toMatch(/too long/);
  });

  it.skipIf(!posix)('uses Piper with the chosen voice from the model folder', async () => {
    const voices = join(work, 'voices');
    mkdirSync(voices, { recursive: true });
    const indonesian = join(voices, 'id_ID-news_tts-medium.onnx');
    const english = join(voices, 'en_US-lessac-medium.onnx');
    writeFileSync(indonesian, 'model');
    writeFileSync(english, 'model');
    const piper = script(
      'piper',
      `const fs = require('fs');
const args = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(join(work, 'piper.json'))}, JSON.stringify({ args, stdin }));
  const wav = Buffer.alloc(100); wav.write('RIFF', 0); wav.write('WAVE', 8);
  fs.writeFileSync(args[args.indexOf('--output_file') + 1], wav);
});`,
    );
    aiConfig.update({ toolCommands: { piper }, speech: { piperModel: indonesian } });

    const piperStatus = (await speechStatus()).find((s) => s.id === 'piper')!;
    expect(piperStatus.available).toBe(true);
    expect(piperStatus.voices.map((v) => v.name)).toEqual(['en_US-lessac-medium', 'id_ID-news_tts-medium']);

    const result = await speak({ requestId: 's5', provider: 'piper', text: 'Satu.\n\nDua.', voice: english, rate: 2 });
    expect(result).toMatchObject({ ok: true, mime: 'audio/wav' });
    const run = JSON.parse(readFileSync(join(work, 'piper.json'), 'utf8'));
    expect(run.args).toEqual(['--model', english, '--output_file', expect.stringMatching(/speech\.wav$/), '--length_scale', '0.500']);
    expect(run.stdin).toBe('Satu. Dua.\n');

    // A voice outside the model folder falls back to the configured model.
    await speak({ requestId: 's6', provider: 'piper', text: 'Halo', voice: join(work, 'elsewhere.onnx') });
    expect(JSON.parse(readFileSync(join(work, 'piper.json'), 'utf8')).args[1]).toBe(indonesian);
  });

  it.skipIf(process.platform !== 'linux' || !findExecutable('espeak-ng'))('speaks with espeak-ng on Linux', async () => {
    const system = (await speechStatus()).find((s) => s.id === 'system')!;
    expect(system.available).toBe(true);
    expect(system.voices.some((v) => v.id === 'id')).toBe(true);
    const result = await speak({ requestId: 's7', provider: 'system', text: 'Selamat pagi, ini Ultima.', voice: 'id', rate: 1.2 });
    expect(result).toMatchObject({ ok: true, mime: 'audio/wav' });
    expect(result.data!.byteLength).toBeGreaterThan(10_000);
  });
});
