/**
 * Pure helpers for image generation and text-to-speech (no Electron imports, unit tested).
 */
import { fileURLToPath } from 'node:url';
import type { SpeechVoice } from '@shared/ai-types';

/* ---------------------------------- Images ---------------------------------- */

/** MIME type from the first bytes of an image file. */
export function sniffImageMime(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(data, 0, 3) === 'GIF') return 'image/gif';
  return 'image/png';
}

/** MIME type from the first bytes of an audio file (WAV when unknown). */
export function sniffAudioMime(data: Uint8Array): string {
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(data, 0, 4) === 'FORM' && ascii(data, 8, 12).startsWith('AIF')) return 'audio/aiff';
  if (ascii(data, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(data, 0, 4) === 'fLaC') return 'audio/flac';
  if (ascii(data, 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return 'audio/wav';
}

function ascii(data: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && i < data.length; i++) s += String.fromCharCode(data[i]);
  return s;
}

export function aspectName(width: number, height: number): 'square' | 'landscape' | 'portrait' {
  const r = width / Math.max(1, height);
  return r > 1.15 ? 'landscape' : r < 0.87 ? 'portrait' : 'square';
}

/** Instructions for Codex CLI's built-in image tool (billed to the user's ChatGPT plan). */
export function codexImagePrompt(prompt: string, width: number, height: number): string {
  return [
    'Create exactly one image with your built-in image generation tool.',
    `Image description: ${prompt.trim().slice(0, 4000)}`,
    `Aspect ratio: ${aspectName(width, height)} (about ${Math.round(width)}×${Math.round(height)} pixels).`,
    'Do not write code, do not run shell commands and do not ask questions.',
    'When the image is ready, reply with one short sentence.',
  ].join('\n');
}

/** Aspect ratios Google's image models accept; the closest one to width × height. */
export function nearestAspectRatio(width: number, height: number): string {
  const ratios = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'];
  const target = Math.log(Math.max(1, width || 1) / Math.max(1, height || 1));
  const distance = (r: string) => {
    const [a, b] = r.split(':').map(Number);
    return Math.abs(Math.log(a / b) - target);
  };
  return ratios.reduce((best, r) => (distance(r) < distance(best) ? r : best));
}

/** Instructions for Antigravity CLI's built-in image tool (Google AI Pro / Ultra plan). */
export function antigravityImagePrompt(prompt: string, width: number, height: number, imageName: string): string {
  return [
    'Create exactly one image with your built-in image generation (the generate_image tool).',
    `Image name: ${imageName}`,
    `Aspect ratio: ${nearestAspectRatio(width, height)}`,
    `Image description: ${prompt.trim().slice(0, 4000)}`,
    'Do not run shell commands, do not create or edit any other files and do not ask questions.',
    'When the image is saved, reply with its full file path only.',
  ].join('\n');
}

const IMAGE_FILE = /\.(?:png|jpe?g|webp)$/i;

/** Absolute image file paths mentioned in a piece of text (POSIX, Windows or file:// URIs). */
export function imagePathsIn(text: string): string[] {
  const found = new Set<string>();
  const whole = text.trim().replace(/^[`'"]+|[`'".]+$/g, '');
  if (IMAGE_FILE.test(whole) && (whole.startsWith('/') || /^[A-Za-z]:[\\/]/.test(whole))) found.add(whole);
  for (const m of text.matchAll(/file:\/\/[^\s"'<>`)\]]+?\.(?:png|jpe?g|webp)\b/gi)) {
    try {
      found.add(fileURLToPath(m[0]));
    } catch {
      // not a local file URI
    }
  }
  for (const m of text.matchAll(/(?<![\w:/])(?:[A-Za-z]:\\|\/)[^\s"'<>`|*?]+?\.(?:png|jpe?g|webp)\b/gi)) found.add(m[0]);
  return [...found];
}

/** Every string inside a parsed JSON value. */
export function jsonStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) jsonStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) jsonStrings(v, out);
  return out;
}

export interface ComfyParams {
  checkpoint: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
}

/** The standard text-to-image graph (checkpoint → sampler → decode → save) in ComfyUI's API format. */
export function comfyWorkflow(p: ComfyParams): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.checkpoint } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['4', 1] } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ultima', images: ['8', 0] } },
  };
}

/** Seed for ComfyUI (needs a non-negative integer; -1 means random). */
export function comfySeed(seed: number | undefined, random = Math.random): number {
  return Number.isFinite(seed) && (seed as number) >= 0 ? Math.floor(seed as number) : Math.floor(random() * 2 ** 32);
}

/* ---------------------------------- Speech ---------------------------------- */

export const MAX_SPEECH_CHARS = 20_000;

export function clampRate(rate: number | undefined): number {
  return Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate as number)) : 1;
}

/** Words per minute for macOS say / espeak-ng (both default to about 175–180). */
export function wordsPerMinute(rate: number | undefined): number {
  return Math.round(175 * clampRate(rate));
}

/** Windows SAPI rate, -10..10 (0 = normal). */
export function sapiRate(rate: number | undefined): number {
  const r = clampRate(rate);
  return Math.max(-10, Math.min(10, Math.round(r >= 1 ? (r - 1) * 10 : (r - 1) * 20)));
}

/** `say -v '?'` lines: "Alex                en_US    # Most people recognize me by my voice." */
export function parseSayVoices(text: string): SpeechVoice[] {
  const voices: SpeechVoice[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#/.exec(line);
    if (m) voices.push({ id: m[1].trim(), name: m[1].trim(), language: m[2] });
  }
  return voices;
}

/**
 * `espeak-ng --voices` table: " 5  id              --/M      Indonesian         poz/id".
 * MBROLA voices (file "mb/…") need extra packages, so they are left out.
 */
export function parseEspeakVoices(text: string): SpeechVoice[] {
  const voices: SpeechVoice[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^\d+$/.test(cols[0]) || cols[4].startsWith('mb/')) continue;
    const language = cols[1];
    if (seen.has(language)) continue;
    seen.add(language);
    voices.push({ id: language, name: `${cols[3].replace(/_/g, ' ')} (${language})`, language });
  }
  return voices;
}

/** Output of the SAPI voice listing script: "Microsoft Andika<TAB>id-ID" per line. */
export function parseSapiVoices(text: string): SpeechVoice[] {
  const voices: SpeechVoice[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [name, language] = line.split('\t').map((s) => s?.trim());
    if (name) voices.push({ id: name, name, language: language || undefined });
  }
  return voices;
}

/** Piper voice name like "id_ID-news_tts-medium" → language "id_ID". */
export function piperVoiceFromFile(path: string): SpeechVoice {
  const file = path.split(/[\\/]/).pop() ?? path;
  const name = file.replace(/\.onnx$/i, '');
  const language = /^([a-z]{2,3}_[A-Z]{2})[-_]/.exec(name)?.[1];
  return { id: path, name, language };
}

/** PowerShell script that writes a WAV with System.Speech; inputs arrive in environment variables. */
export const SAPI_SPEAK_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  'if ($env:ULTIMA_VOICE) { $s.SelectVoice($env:ULTIMA_VOICE) }',
  '$s.Rate = [int]$env:ULTIMA_RATE',
  '$s.SetOutputToWaveFile($env:ULTIMA_OUT)',
  '$s.Speak([IO.File]::ReadAllText($env:ULTIMA_TEXT, [Text.Encoding]::UTF8))',
  '$s.Dispose()',
].join('; ');

export const SAPI_VOICES_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + "`t" + $_.VoiceInfo.Culture.Name }',
].join('; ');

/** Fills {text_file}, {output}, {voice} and {rate} in custom command arguments (one argument each, never split). */
export function fillSpeechArgs(args: string[], values: { textFile: string; output: string; voice: string; rate: number }): string[] {
  return args.map((arg) =>
    arg
      .replace(/\{text_file\}/g, values.textFile)
      .replace(/\{output\}/g, values.output)
      .replace(/\{voice\}/g, values.voice)
      .replace(/\{rate\}/g, String(values.rate)),
  );
}

/**
 * FFmpeg arguments for an upload-ready MP4 for TikTok, Reels and Shorts. These apps re-encode every upload, so
 * this hands them the cleanest source: constant 30 or 60 fps, H.264 High at a low CRF capped near the target
 * bitrate (x264 picks a level that covers the frame rate), BT.709 tags, AAC 320 kbps and the index up front.
 */
export function socialVideoArgs(fps: number | undefined, bitrate: number | undefined): string[] {
  const rate = (fps ?? 30) >= 50 ? 60 : 30;
  const maxKbps = Math.round(Math.min(50_000_000, Math.max(4_000_000, bitrate ?? (rate === 60 ? 24_000_000 : 16_000_000))) / 1000);
  return [
    '-vf', `scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=${rate}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-maxrate', `${maxKbps}k`, '-bufsize', `${maxKbps * 2}k`,
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(rate * 2),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
  ];
}
