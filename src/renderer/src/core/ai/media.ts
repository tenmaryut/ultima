/**
 * Image generation and text-to-speech for the editors. Most of the work happens in the desktop app's
 * main process (src/main/media.ts, src/main/tools.ts); SVG drawings come from the connected chat AI.
 * None of it bills an API key.
 */
import type { ImageGenRequest, ImageProviderId, SpeechProviderId, SpeechProviderStatus, SpeechVoice } from '@shared/ai-types';
import { desktop } from '../platform';
import { t, type TFunction } from '../i18n';
import { useAppStore } from '../store';
import { uid } from '../utils/id';
import { detectProviders, resolveProvider, runAI } from './client';
import { extractSvg, sanitizeSvg } from './sanitize';
import { useAISettings } from './settings';

/* ---------------------------------- Images ---------------------------------- */

export interface ImageProviderInfo {
  id: ImageProviderId;
  name: string;
  note: string;
  /** Understands negative prompt, steps, CFG and seed. */
  advanced: boolean;
  /** Runs through the desktop app (everything except SVG drawings, which any connected AI can make). */
  desktopOnly: boolean;
}

export const IMAGE_PROVIDERS: ImageProviderInfo[] = [
  {
    id: 'sd-webui',
    name: 'Stable Diffusion WebUI',
    note: 'Free and offline on your graphics card: AUTOMATIC1111 or Forge started with --api.',
    advanced: true,
    desktopOnly: true,
  },
  {
    id: 'comfyui',
    name: 'ComfyUI',
    note: 'Free and offline on your graphics card, with any Stable Diffusion checkpoint in ComfyUI/models/checkpoints.',
    advanced: true,
    desktopOnly: true,
  },
  {
    id: 'local-openai',
    name: 'Local image server (OpenAI-style)',
    note: 'Free: a server on your computer with an OpenAI-style /v1/images/generations endpoint, for example LocalAI.',
    advanced: false,
    desktopOnly: true,
  },
  {
    id: 'antigravity',
    name: 'Antigravity (Google AI plan)',
    note: 'Uses the image quota of your Google AI Pro or Ultra plan (Nano Banana) through the signed-in Antigravity CLI. No API key.',
    advanced: false,
    desktopOnly: true,
  },
  {
    id: 'codex',
    name: 'Codex (ChatGPT plan)',
    note: 'Uses the image allowance of your ChatGPT plan through the signed-in Codex CLI. No API key.',
    advanced: false,
    desktopOnly: true,
  },
  {
    id: 'svg',
    name: 'SVG drawing by your AI',
    note: 'Any connected AI — for example Claude — draws the picture as SVG code, within your plan’s normal limits. Best for illustrations, icons and flat art, not photos. Open the result in Vector to edit it.',
    advanced: false,
    desktopOnly: false,
  },
];

export function imageProviderInfo(id: ImageProviderId): ImageProviderInfo {
  return IMAGE_PROVIDERS.find((p) => p.id === id) ?? IMAGE_PROVIDERS[0];
}

/** Address and model for an image generator from the settings. */
export function imageTarget(provider: ImageProviderId): { baseUrl: string; model?: string } {
  const s = useAISettings.getState();
  if (provider === 'comfyui') return { baseUrl: s.comfyUrl, model: s.comfyModel || undefined };
  if (provider === 'local-openai') return { baseUrl: s.localImageUrl, model: s.localImageModel || undefined };
  if (provider === 'sd-webui') return { baseUrl: s.sdUrl };
  return { baseUrl: '' };
}

export type ImageCheck = { ok: true; models: string[] } | { ok: false; error: string };

const CLI_SETUP: Record<'codex' | 'antigravity', { missing: string; enable: string }> = {
  codex: {
    missing: 'Codex CLI is not installed. Install it with: npm install -g @openai/codex — then run "codex" once to sign in with your ChatGPT account.',
    enable: 'Turn on Codex in Settings → AI connections first.',
  },
  antigravity: {
    missing: 'Antigravity CLI is not installed. Install it (Settings → AI connections), then run agy once to sign in with your Google account.',
    enable: 'Turn on Antigravity CLI in Settings → AI connections first.',
  },
};

/** Whether an image generator is ready; lists its models when it has any. */
export async function checkImageProvider(provider: ImageProviderId): Promise<ImageCheck> {
  if (provider === 'svg') {
    return resolveProvider(useAISettings.getState().svgProvider ?? undefined)
      ? { ok: true, models: [] }
      : { ok: false, error: t('Connect an AI in Settings → AI connections first.') };
  }
  if (!desktop) return { ok: false, error: t('Image generation needs the Ultima desktop app.') };
  const { baseUrl } = imageTarget(provider);
  try {
    if (provider === 'sd-webui') return { ok: true, models: await desktop.tools.sdModels(baseUrl) };
    if (provider === 'comfyui') {
      const models = await desktop.tools.comfyModels(baseUrl);
      return models.length ? { ok: true, models } : { ok: false, error: t('ComfyUI is running but has no checkpoint model yet.') };
    }
    if (provider === 'local-openai') return { ok: true, models: await desktop.tools.localImageModels(baseUrl) };
    const cli = provider === 'antigravity' ? 'antigravity' : 'codex';
    const statuses = await detectProviders();
    if (!statuses.find((s) => s.id === cli)?.available) return { ok: false, error: t(CLI_SETUP[cli].missing) };
    if (!useAISettings.getState().enabled[cli]) return { ok: false, error: t(CLI_SETUP[cli].enable) };
    return { ok: true, models: [] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface GeneratedImageData {
  dataUrl: string;
  mime: string;
  /** The vector original of an SVG drawing (can be opened in Vector). */
  svg?: string;
}

export type ImageParams = Omit<ImageGenRequest, 'requestId' | 'baseUrl' | 'provider' | 'model' | 'allowApiBilling'>;

/** Generates images with the chosen (or given) generator. Throws with a readable message. */
export async function generateImages(params: ImageParams, provider: ImageProviderId = useAISettings.getState().imageProvider): Promise<GeneratedImageData[]> {
  if (provider === 'svg') return [await generateSvgImage(params)];
  if (!desktop) throw new Error(t('Image generation needs the Ultima desktop app.'));
  const res = await desktop.tools.imageGenerate({
    ...params,
    ...imageTarget(provider),
    provider,
    requestId: uid('img'),
    allowApiBilling: provider === 'codex' || provider === 'antigravity' ? !useAISettings.getState().blockApiBilling : undefined,
  });
  if (!res.ok) throw new Error(res.error || t('Image generation failed'));
  return res.images.map((b64, i) => {
    const mime = res.mimeTypes?.[i] ?? 'image/png';
    return { mime, dataUrl: `data:${mime};base64,${b64}` };
  });
}

/* ----------------------------- SVG drawn by the AI ----------------------------- */

const SVG_SYSTEM =
  'You are an expert vector illustrator who draws with SVG code. Reply with exactly one complete, standalone SVG document and nothing else — no explanation and no Markdown fences. Use the viewBox you are given and fill the whole canvas, background included. Build the picture from paths, basic shapes and gradients; add text only when asked. Never use <image>, <script>, <foreignObject>, external links or web fonts. Keep it under 60 KB.';

export function svgImagePrompt(prompt: string, width: number, height: number): string {
  return `Draw this as a polished, detailed illustration:\n${prompt.trim().slice(0, 4000)}\n\nCanvas: viewBox="0 0 ${width} ${height}".`;
}

/** Gives the root <svg> the canvas size, a viewBox and the SVG namespace, so it renders as an image at that size. */
export function fitSvg(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    const attr = (name: string) => Number(new RegExp(`\\s${name}="([\\d.]+)(?:px)?"`).exec(tag)?.[1] ?? NaN);
    let out = tag;
    if (!/\sviewBox=/i.test(out)) {
      const w = attr('width');
      const h = attr('height');
      out = out.replace(/^<svg\b/i, `<svg viewBox="${w > 0 && h > 0 ? `0 0 ${w} ${h}` : `0 0 ${width} ${height}`}"`);
    }
    if (!/\sxmlns=/i.test(out)) out = out.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    out = out.replace(/\s(?:width|height)="[^"]*"/g, '');
    return out.replace(/^<svg\b/i, `<svg width="${width}" height="${height}"`);
  });
}

/** Renders SVG markup to a PNG data URL of the given size. */
export async function rasterizeSvg(svg: string, width: number, height: number): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(t('The SVG drawing could not be rendered.')));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Asks the connected AI (Settings → Image generation, else the default AI) for an SVG drawing. */
export async function generateSvgImage(params: ImageParams, signal?: AbortSignal): Promise<GeneratedImageData> {
  const width = Math.round(Math.min(4096, Math.max(64, params.width || 1024)));
  const height = Math.round(Math.min(4096, Math.max(64, params.height || 1024)));
  const { text } = await runAI({
    providerId: useAISettings.getState().svgProvider ?? undefined,
    system: SVG_SYSTEM,
    prompt: svgImagePrompt(params.prompt, width, height),
    signal,
  });
  const raw = extractSvg(text);
  const clean = raw ? sanitizeSvg(raw) : '';
  if (!clean) throw new Error(t('The AI did not answer with an SVG drawing. Try again, or choose another AI.'));
  const svg = fitSvg(clean, width, height);
  return { dataUrl: await rasterizeSvg(svg, width, height), mime: 'image/png', svg };
}

/* ---------------------------------- Speech ---------------------------------- */

export const SPEECH_PROVIDERS: { id: SpeechProviderId; name: string }[] = [
  { id: 'system', name: 'System voices' },
  { id: 'piper', name: 'Piper (natural offline voices)' },
  { id: 'custom', name: 'Custom command' },
];

let statusRequest: Promise<SpeechProviderStatus[]> | null = null;

/** Speech engines and their voices (cached; pass force after changing settings). */
export function speechStatus(force = false): Promise<SpeechProviderStatus[]> {
  if (!desktop) return Promise.resolve([]);
  if (force || !statusRequest) {
    statusRequest = desktop.tools.speechStatus().catch((error: unknown) => {
      statusRequest = null;
      throw error;
    });
  }
  return statusRequest;
}

/** Why an engine can't be used, in words. */
export function speechProblem(t: TFunction, status: SpeechProviderStatus | undefined): string | null {
  if (!status || status.available) return null;
  if (status.id === 'system') return t('No speech program was found. On Linux install espeak-ng (sudo apt install espeak-ng).');
  if (status.id === 'piper') {
    return status.detail === 'no-model'
      ? t('Choose a Piper voice (.onnx) in Settings → Speech.')
      : t('Piper is not installed. Install it with: pip install piper-tts');
  }
  return status.detail === 'not-configured' ? t('Set up the custom command in Settings → Speech.') : t('The custom speech program was not found.');
}

/** Voices in the UI language first, then by name. */
export function sortVoices(voices: SpeechVoice[], language: string): SpeechVoice[] {
  const lang = language.toLowerCase();
  const rank = (v: SpeechVoice) => (v.language?.toLowerCase().replace('_', '-').split('-')[0] === lang ? 0 : 1);
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** A voice in the UI language when the user has not picked one. */
export function preferredVoice(voices: SpeechVoice[], language: string): string {
  const lang = language.toLowerCase();
  return voices.find((v) => v.language?.toLowerCase().replace('_', '-').split('-')[0] === lang)?.id ?? '';
}

export interface SpeechOptions {
  provider?: SpeechProviderId;
  voice?: string;
  rate?: number;
}

export const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/aiff': 'aiff',
  'audio/flac': 'flac',
};

export function speechFileName(text: string, mime = 'audio/wav'): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `speech-${slug || 'clip'}.${AUDIO_EXTENSIONS[mime] ?? 'wav'}`;
}

/** Turns text into an audio file with the chosen engine and voice. Throws with a readable message. */
export async function synthesizeSpeech(text: string, options: SpeechOptions = {}): Promise<File> {
  if (!desktop) throw new Error(t('Text to speech needs the Ultima desktop app.'));
  const s = useAISettings.getState();
  const provider = options.provider ?? s.speechProvider;
  let voice = options.voice ?? s.speechVoices[provider] ?? '';
  if (!voice && provider !== 'custom') {
    const status = (await speechStatus().catch(() => [])).find((x) => x.id === provider);
    voice = preferredVoice(status?.voices ?? [], useAppStore.getState().language);
  }
  const res = await desktop.tools.speak({
    requestId: uid('tts'),
    provider,
    text,
    voice,
    rate: options.rate ?? s.speechRate,
    allowApiBilling: !s.blockApiBilling,
  });
  if (!res.ok || !res.data) throw new Error(res.error || t('Speech generation failed.'));
  const mime = res.mime ?? 'audio/wav';
  return new File([new Uint8Array(res.data)], speechFileName(text, mime), { type: mime });
}
