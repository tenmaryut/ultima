import { BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ImageGenRequest,
  ImageGenResult,
  LocalToolStatus,
  RemoveBgRequest,
  MatteRequest,
  MatteResult,
  RemoveBgResult,
  TranscribeRequest,
  TranscribeResult,
  TranscriptSegment,
  TranscodeRequest,
  TranscodeResult,
} from '@shared/ai-types';
import { IPC } from '@shared/ipc';
import { validateLocalBaseUrl } from '@shared/local-http';
import { findExecutable, readVersion, runProcess, type RunningProcess } from './ai/exec';
import { mt } from './i18n';
import { aiConfig } from './ai/service';
import { generateImageWith, resolvePiper } from './media';
import { socialVideoArgs } from './media-utils';

const WHISPER_CANDIDATES = ['whisper-ctranslate2', 'whisper', 'whisper-cli'];

function resolveTool(tool: LocalToolStatus['id']): string | null {
  if (tool === 'piper') return resolvePiper();
  const configured = tool !== 'ffmpeg' ? aiConfig.get().toolCommands[tool] : undefined;
  if (configured) return findExecutable(configured);
  if (tool === 'whisper') {
    for (const name of WHISPER_CANDIDATES) {
      const found = findExecutable(name);
      if (found) return found;
    }
    return null;
  }
  return findExecutable(tool);
}

async function detectTools(): Promise<LocalToolStatus[]> {
  return Promise.all(
    (['whisper', 'rembg', 'ffmpeg', 'piper'] as const).map(async (id) => {
      const location = resolveTool(id);
      if (!location) return { id, available: false };
      const version = id === 'ffmpeg' ? await readVersion(location, ['-version'], 8000) : undefined;
      return { id, available: true, location, version: version ?? undefined };
    }),
  );
}

/* ----------------------------- Stable Diffusion ----------------------------- */

async function sdRequest(baseUrl: string, path: string, body?: unknown, timeoutMs = 600_000): Promise<unknown> {
  validateLocalBaseUrl(baseUrl);
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Stable Diffusion WebUI responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function generateImage(req: ImageGenRequest): Promise<ImageGenResult> {
  try {
    const common = {
      prompt: String(req.prompt ?? '').slice(0, 4000),
      negative_prompt: String(req.negativePrompt ?? '').slice(0, 2000),
      width: Math.round(Math.min(2048, Math.max(64, req.width || 512)) / 8) * 8,
      height: Math.round(Math.min(2048, Math.max(64, req.height || 512)) / 8) * 8,
      steps: Math.min(150, Math.max(1, req.steps ?? 25)),
      cfg_scale: Math.min(30, Math.max(1, req.cfgScale ?? 7)),
      seed: Number.isFinite(req.seed) ? req.seed : -1,
    };
    const data = (
      req.initImage
        ? await sdRequest(req.baseUrl, '/sdapi/v1/img2img', {
            ...common,
            init_images: [req.initImage],
            denoising_strength: Math.min(1, Math.max(0, req.denoisingStrength ?? 0.75)),
            ...(req.mask
              ? { mask: req.mask, inpainting_fill: 1, inpaint_full_res: true, inpaint_full_res_padding: 32, mask_blur: 4 }
              : {}),
          })
        : await sdRequest(req.baseUrl, '/sdapi/v1/txt2img', common)
    ) as { images?: string[] };
    return { ok: true, images: (data.images ?? []).map((img) => img.replace(/^data:image\/\w+;base64,/, '')) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      images: [],
      error: /fetch failed|ECONNREFUSED/i.test(message)
        ? 'Could not reach Stable Diffusion WebUI. Start it with the --api flag and check the URL in Settings.'
        : message,
    };
  }
}

/* --------------------------------- Whisper --------------------------------- */

function parseSrt(srt: string): TranscriptSegment[] {
  const toSec = (t: string) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0;
  };
  const segments: TranscriptSegment[] = [];
  for (const block of srt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const timeIndex = lines.findIndex((l) => l.includes('-->'));
    if (timeIndex < 0) continue;
    const [a, b] = lines[timeIndex].split('-->');
    const text = lines.slice(timeIndex + 1).join(' ').trim();
    if (text) segments.push({ start: toSec(a), end: toSec(b), text });
  }
  return segments;
}

async function transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
  const exe = resolveTool('whisper');
  if (!exe) {
    return { ok: false, segments: [], error: 'No speech-to-text tool found. Install one with: pip install -U openai-whisper' };
  }
  const dir = await mkdtemp(join(tmpdir(), 'ultima-stt-'));
  try {
    const input = join(dir, 'audio.wav');
    await writeFile(input, Buffer.from(req.wavBase64, 'base64'));
    const language = req.language && /^[a-z]{2,3}$/i.test(req.language) ? req.language : undefined;
    const model = req.model && /^[\w./\\:-]{1,200}$/.test(req.model) ? req.model : undefined;
    const isCpp = /whisper-cli(\.exe)?$/i.test(exe);
    let args: string[];
    if (isCpp) {
      const modelPath = model ?? process.env.WHISPER_CPP_MODEL;
      if (!modelPath) {
        return {
          ok: false,
          segments: [],
          error: 'whisper.cpp needs a model file. Download ggml-base.bin and set WHISPER_CPP_MODEL to its path, or install openai-whisper.',
        };
      }
      args = ['-m', modelPath, '-f', input, '-osrt', '-of', join(dir, 'audio'), '-np', '-l', language ?? 'auto'];
    } else {
      args = [input, '--model', model ?? 'base', '--output_format', 'srt', '--output_dir', dir, ...(language ? ['--language', language] : [])];
    }
    const res = await runProcess({ command: exe, args, cwd: dir, timeoutMs: 30 * 60_000 }).result;
    const srtName = (await readdir(dir)).find((f) => f.endsWith('.srt'));
    if (!srtName) {
      return { ok: false, segments: [], error: (res.stderr || res.spawnError || 'Transcription failed').slice(-1200) };
    }
    return { ok: true, segments: parseSrt(await readFile(join(dir, srtName), 'utf8')) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ---------------------------------- rembg ---------------------------------- */

async function removeBackground(req: RemoveBgRequest): Promise<RemoveBgResult> {
  const exe = resolveTool('rembg');
  if (!exe) return { ok: false, error: 'rembg is not installed. Install it with: pip install "rembg[cpu,cli]"' };
  const dir = await mkdtemp(join(tmpdir(), 'ultima-rembg-'));
  try {
    const input = join(dir, 'in.png');
    const output = join(dir, 'out.png');
    await writeFile(input, Buffer.from(req.pngBase64, 'base64'));
    // Explicit model: rembg's default (bria-rmbg) has non-commercial weights.
    const res = await runProcess({ command: exe, args: ['i', '-m', 'isnet-general-use', input, output], cwd: dir, timeoutMs: 10 * 60_000 }).result;
    try {
      const data = await readFile(output);
      return { ok: true, pngBase64: data.toString('base64') };
    } catch {
      return { ok: false, error: (res.stderr || res.spawnError || 'rembg failed').slice(-1200) };
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** rembg models for video mattes (both under permissive licences). */
const MATTE_MODELS: Record<MatteRequest['model'], string> = { people: 'u2net_human_seg', anything: 'isnet-general-use' };
const runningMattes = new Map<string, RunningProcess>();

/** Masks for many frames in one rembg run (the model loads once): a folder in, a folder of masks out. */
async function matteFrames(req: MatteRequest): Promise<MatteResult> {
  const exe = resolveTool('rembg');
  if (!exe) return { ok: false, error: 'rembg is not installed. Install it with: pip install "rembg[cpu,cli]" (Settings → Local creative tools).' };
  const model = MATTE_MODELS[req?.model] ?? MATTE_MODELS.anything;
  const frames = Array.isArray(req?.frames) ? req.frames.filter((f) => f instanceof Uint8Array && f.byteLength < 8 * 1024 * 1024) : [];
  if (!frames.length || frames.length > 400 || frames.length !== req.frames.length) return { ok: false, error: 'Unsupported frames' };
  const dir = await mkdtemp(join(tmpdir(), 'ultima-matte-'));
  try {
    const input = join(dir, 'in');
    const output = join(dir, 'out');
    await mkdir(input);
    await mkdir(output);
    const names = frames.map((_, i) => `f${String(i).padStart(5, '0')}`);
    await Promise.all(frames.map((f, i) => writeFile(join(input, `${names[i]}.png`), f)));
    const proc = runProcess({ command: exe, args: ['p', '-m', model, '-om', input, output], cwd: dir, timeoutMs: 60 * 60_000 });
    const id = typeof req.requestId === 'string' ? req.requestId : '';
    if (id) runningMattes.set(id, proc);
    const res = await proc.result.finally(() => id && runningMattes.delete(id));
    if (res.aborted) return { ok: false, error: 'Cancelled' };
    try {
      const masks = await Promise.all(names.map(async (n) => new Uint8Array(await readFile(join(output, `${n}.png`)))));
      return { ok: true, masks };
    } catch {
      return { ok: false, error: (res.stderr || res.spawnError || 'rembg made no masks').slice(-1200) };
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ---------------------------------- FFmpeg ---------------------------------- */

const TRANSCODE_ARGS: Record<TranscodeRequest['format'], (q: 'high' | 'medium' | 'small', req: TranscodeRequest) => string[]> = {
  // yuv420p H.264 needs even dimensions: round odd sizes down by one pixel.
  mp4: (q, req) => (req.preset === 'social' ? socialVideoArgs(req.fps, req.videoBitrate) : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', q === 'high' ? '18' : q === 'small' ? '28' : '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']),
  mov: (q) => ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', q === 'high' ? '18' : q === 'small' ? '28' : '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'],
  webm: (q) => ['-c:v', 'libvpx-vp9', '-crf', q === 'high' ? '24' : q === 'small' ? '40' : '32', '-b:v', '0', '-c:a', 'libopus', '-b:a', '160k'],
  gif: (_q, req) => {
    const fps = Math.round(Math.min(50, Math.max(1, req.fps ?? 12)));
    const width = Math.round(Math.min(4096, Math.max(16, req.width ?? 480)));
    return ['-an', '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, '-loop', '0'];
  },
  mp3: (q) => ['-vn', '-c:a', 'libmp3lame', '-q:a', q === 'high' ? '0' : q === 'small' ? '6' : '2'],
  wav: () => ['-vn', '-c:a', 'pcm_s16le'],
  ogg: (q) => ['-vn', '-c:a', 'libopus', '-b:a', q === 'high' ? '192k' : q === 'small' ? '64k' : '128k'],
  m4a: (q) => ['-vn', '-c:a', 'aac', '-b:a', q === 'high' ? '256k' : q === 'small' ? '96k' : '192k'],
  flac: () => ['-vn', '-c:a', 'flac'],
};

/** Conversions in progress, by request id, so the renderer can cancel them. */
const runningTranscodes = new Map<string, RunningProcess>();

async function transcode(req: TranscodeRequest): Promise<TranscodeResult> {
  const exe = resolveTool('ffmpeg');
  if (!exe) return { ok: false, error: 'FFmpeg is not installed. Install it to export this format (see Settings → Local creative tools).' };
  const build = TRANSCODE_ARGS[req?.format];
  if (!build || !(req.input instanceof Uint8Array)) return { ok: false, error: 'Unsupported conversion' };
  const inExt = (/\.([a-z0-9]{1,5})$/i.exec(String(req.inputName ?? ''))?.[1] ?? 'bin').toLowerCase();
  const dir = await mkdtemp(join(tmpdir(), 'ultima-ffmpeg-'));
  try {
    const input = join(dir, `input.${inExt}`);
    const output = join(dir, `output.${req.format}`);
    await writeFile(input, req.input);
    const quality = req.quality === 'high' || req.quality === 'small' ? req.quality : 'medium';
    const proc = runProcess({
      command: exe,
      args: ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...build(quality, req), output],
      cwd: dir,
      timeoutMs: 60 * 60_000,
    });
    const id = typeof req.requestId === 'string' ? req.requestId : '';
    if (id) runningTranscodes.set(id, proc);
    const res = await proc.result.finally(() => id && runningTranscodes.delete(id));
    if (res.aborted) return { ok: false, error: 'Cancelled' };
    try {
      const data = await readFile(output);
      return { ok: true, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    } catch {
      return { ok: false, error: (res.stderr || res.spawnError || 'FFmpeg failed').slice(-1500) };
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerToolsIpc(): void {
  ipcMain.handle(IPC.toolTranscode, (_event, req: TranscodeRequest) => transcode(req));
  ipcMain.handle(IPC.toolTranscodeCancel, (_event, requestId: string) => {
    runningTranscodes.get(String(requestId))?.cancel();
  });
  ipcMain.handle(IPC.toolsDetect, () => detectTools());
  ipcMain.handle(IPC.toolsSetCommand, async (event, tool: 'whisper' | 'rembg' | 'piper', command: string | null) => {
    if (tool !== 'whisper' && tool !== 'rembg' && tool !== 'piper') return false;
    const commands = { ...aiConfig.get().toolCommands };
    if (!command) delete commands[tool];
    else {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        buttons: [mt('Allow'), mt('Cancel')],
        defaultId: 1,
        cancelId: 1,
        message: mt('Allow Ultima to run this program?'),
        detail: String(command),
      };
      const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      if (result.response !== 0) return false;
      commands[tool] = String(command);
    }
    aiConfig.update({ toolCommands: commands });
    return true;
  });
  ipcMain.handle(IPC.toolImageGen, (_event, req: ImageGenRequest) =>
    !req?.provider || req.provider === 'sd-webui' ? generateImage(req) : generateImageWith(req),
  );
  ipcMain.handle(IPC.toolTranscribe, (_event, req: TranscribeRequest) => transcribe(req));
  ipcMain.handle(IPC.toolRemoveBg, (_event, req: RemoveBgRequest) => removeBackground(req));
  ipcMain.handle(IPC.toolMatte, (_event, req: MatteRequest) => matteFrames(req));
  ipcMain.handle(IPC.toolMatteCancel, (_event, requestId: string) => {
    runningMattes.get(String(requestId))?.cancel();
  });
  ipcMain.handle(IPC.toolSdModels, async (_event, baseUrl: string) => {
    try {
      const data = (await sdRequest(baseUrl, '/sdapi/v1/sd-models', undefined, 4000)) as Array<{ title?: string }>;
      return { ok: true, models: Array.isArray(data) ? data.map((m) => m.title ?? '').filter(Boolean) : [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: /fetch failed|ECONNREFUSED/i.test(message) ? 'Stable Diffusion WebUI is not running' : message };
    }
  });
}
