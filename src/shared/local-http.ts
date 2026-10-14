/**
 * Clients for free AI servers that run on the user's own machine or local network.
 * Used by the Electron main process and, in the web build, directly by the renderer.
 * Only standard fetch / ReadableStream APIs are used so it runs in both places.
 */
import type { AIImage } from './ai-types';

export interface LocalChatRequest {
  baseUrl: string;
  model: string;
  prompt: string;
  system?: string;
  images?: AIImage[];
  apiKey?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127(?:\.\d{1,3}){3}$/,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/,
  /^10(?:\.\d{1,3}){3}$/,
  /^192\.168(?:\.\d{1,3}){2}$/,
  /^172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/, // CGNAT / Tailscale
  /\.local$/i,
  /\.lan$/i,
  /\.home\.arpa$/i,
  /\.internal$/i,
  /\.ts\.net$/i,
];

/**
 * Ultima deliberately only talks to servers on this computer or the local network,
 * so nobody accidentally points it at a paid, metered cloud API.
 */
export function validateLocalBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid server URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Server URL must start with http:// or https://');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!PRIVATE_HOST_PATTERNS.some((re) => re.test(host) || re.test(url.hostname))) {
    throw new Error(
      `For safety Ultima only connects to AI servers on this computer or your local network (got "${url.hostname}"). ` +
        'Use a local server such as Ollama or LM Studio.',
    );
  }
  return url;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

async function readLines(response: Response, onLine: (line: string) => void): Promise<void> {
  if (!response.body) {
    const text = await response.text();
    text.split(/\r?\n/).forEach(onLine);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, index).replace(/\r$/, ''));
      buffer = buffer.slice(index + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) onLine(buffer);
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    // ignore
  }
  throw new Error(`Server responded ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
}

/* ---------------------------------- Ollama ---------------------------------- */

export async function ollamaChat(req: LocalChatRequest): Promise<string> {
  validateLocalBaseUrl(req.baseUrl);
  const messages: Array<Record<string, unknown>> = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  messages.push({
    role: 'user',
    content: req.prompt,
    ...(req.images?.length ? { images: req.images.map((i) => i.base64) } : {}),
  });
  const response = await fetch(joinUrl(req.baseUrl, '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: req.model, messages, stream: true }),
    signal: req.signal,
  });
  await ensureOk(response);
  let text = '';
  await readLines(response, (line) => {
    if (!line.trim()) return;
    try {
      const data = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (data.error) throw new Error(data.error);
      const delta = data.message?.content ?? '';
      if (delta) {
        text += delta;
        req.onDelta?.(delta);
      }
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  });
  return text;
}

export async function ollamaModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  validateLocalBaseUrl(baseUrl);
  const response = await fetch(joinUrl(baseUrl, '/api/tags'), { signal });
  await ensureOk(response);
  const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
  return (data.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
}

/** True when the model reports the "vision" capability (or when that can't be determined). */
export async function ollamaSupportsVision(baseUrl: string, model: string, signal?: AbortSignal): Promise<boolean> {
  validateLocalBaseUrl(baseUrl);
  try {
    const response = await fetch(joinUrl(baseUrl, '/api/show'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal,
    });
    if (!response.ok) return true;
    const data = (await response.json()) as { capabilities?: string[] };
    return Array.isArray(data.capabilities) ? data.capabilities.includes('vision') : true;
  } catch {
    return true;
  }
}

export async function ollamaVersion(baseUrl: string, signal?: AbortSignal): Promise<string> {
  validateLocalBaseUrl(baseUrl);
  const response = await fetch(joinUrl(baseUrl, '/api/version'), { signal });
  await ensureOk(response);
  const data = (await response.json()) as { version?: string };
  return data.version ?? 'running';
}

/* ------------------------- OpenAI-compatible (local) ------------------------- */

export async function openAICompatChat(req: LocalChatRequest): Promise<string> {
  validateLocalBaseUrl(req.baseUrl);
  const messages: Array<Record<string, unknown>> = [];
  if (req.system) messages.push({ role: 'system', content: req.system });
  if (req.images?.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: req.prompt },
        ...req.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ],
    });
  } else {
    messages.push({ role: 'user', content: req.prompt });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;
  const response = await fetch(joinUrl(req.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: req.model || undefined, messages, stream: true }),
    signal: req.signal,
  });
  await ensureOk(response);
  let text = '';
  await readLines(response, (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const data = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (data.error?.message) throw new Error(data.error.message);
      const delta = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? '';
      if (delta) {
        text += delta;
        req.onDelta?.(delta);
      }
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  });
  return text;
}

export async function openAICompatModels(baseUrl: string, apiKey?: string, signal?: AbortSignal): Promise<string[]> {
  validateLocalBaseUrl(baseUrl);
  const response = await fetch(joinUrl(baseUrl, '/models'), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    signal,
  });
  await ensureOk(response);
  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
}
