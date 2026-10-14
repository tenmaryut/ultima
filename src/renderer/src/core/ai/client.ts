import { useEffect } from 'react';
import type { AIImage, AIRunResult, ProviderId, ProviderStatus } from '@shared/ai-types';
import { getProviderInfo, PROVIDERS } from '@shared/providers-catalog';
import { ollamaChat, ollamaModels, ollamaVersion, openAICompatChat, openAICompatModels } from '@shared/local-http';
import { desktop } from '../platform';
import { uid } from '../utils/id';
import { useAISettings } from './settings';
import { extractJson } from './json';

export class AIError extends Error {
  constructor(
    message: string,
    public kind: AIRunResult['errorKind'] | 'no-provider' = 'failed',
  ) {
    super(message);
  }
}

export interface RunAIOptions {
  prompt: string;
  system?: string;
  images?: AIImage[];
  providerId?: ProviderId;
  model?: string;
  /** Receives the growing answer text while it streams in. */
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
}

/* ------------------------------ Provider status ------------------------------ */

function baseUrlFor(id: ProviderId): string | undefined {
  const s = useAISettings.getState();
  if (id === 'ollama') return s.ollamaUrl;
  if (id === 'openai-compatible') return s.openaiCompatUrl;
  return undefined;
}

async function detectHttpInBrowser(): Promise<ProviderStatus[]> {
  const s = useAISettings.getState();
  const now = Date.now();
  const check = async (
    id: ProviderId,
    fn: (signal: AbortSignal) => Promise<{ version?: string; models: string[] }>,
  ): Promise<ProviderStatus> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fn(ctrl.signal);
      return { id, available: true, version: r.version, models: r.models, location: baseUrlFor(id), checkedAt: now };
    } catch (error) {
      return { id, available: false, error: error instanceof Error ? error.message : String(error), checkedAt: now };
    } finally {
      clearTimeout(timer);
    }
  };
  return Promise.all([
    check('ollama', async (signal) => ({
      version: await ollamaVersion(s.ollamaUrl, signal),
      models: await ollamaModels(s.ollamaUrl, signal),
    })),
    check('openai-compatible', async (signal) => ({
      models: await openAICompatModels(s.openaiCompatUrl, s.openaiCompatKey || undefined, signal),
    })),
  ]);
}

/** Detects installed CLIs and running local servers. */
export async function detectProviders(force = false): Promise<ProviderStatus[]> {
  const store = useAISettings.getState();
  store.setDetecting(true);
  try {
    let statuses: ProviderStatus[];
    const api = desktop;
    if (api) {
      statuses = await api.ai.detect(force);
      // http providers: refresh with the user's configured URLs
      const http = await Promise.all(
        (['ollama', 'openai-compatible'] as const).map(async (id): Promise<ProviderStatus> => {
          try {
            const models = await api.ai.httpModels(id, baseUrlFor(id) ?? '', id === 'openai-compatible' ? store.openaiCompatKey || undefined : undefined);
            return { id, available: true, models, location: baseUrlFor(id), checkedAt: Date.now() };
          } catch (error) {
            return { id, available: false, error: error instanceof Error ? error.message : String(error), checkedAt: Date.now() };
          }
        }),
      );
      statuses = [...statuses.filter((s) => s.id !== 'ollama' && s.id !== 'openai-compatible'), ...http];
      try {
        store.setTools(await api.tools.detect());
      } catch {
        // optional
      }
    } else {
      statuses = await detectHttpInBrowser();
    }
    store.setStatuses(statuses);
    return statuses;
  } finally {
    store.setDetecting(false);
  }
}

/** Providers that are installed/running AND enabled by the user, in catalog order. */
export function usableProviders(): ProviderId[] {
  const s = useAISettings.getState();
  return PROVIDERS.filter((p) => s.enabled[p.id] && s.statuses.find((st) => st.id === p.id)?.available).map((p) => p.id);
}

export function resolveProvider(preferred?: ProviderId): ProviderId | null {
  const usable = usableProviders();
  if (preferred && usable.includes(preferred)) return preferred;
  const def = useAISettings.getState().defaultProvider;
  if (def && usable.includes(def)) return def;
  return usable[0] ?? null;
}

export function providerSupportsImages(id: ProviderId | null): boolean {
  return Boolean(id && getProviderInfo(id)?.supportsImages);
}

/** React hook: runs detection once on mount if it never ran (or is stale). */
export function useProviderDetection(): void {
  useEffect(() => {
    const last = useAISettings.getState().lastDetectedAt;
    if (Date.now() - last > 60_000) void detectProviders().catch(() => undefined);
  }, []);
}

/* ---------------------------------- Running ---------------------------------- */

/**
 * Sends a prompt to an AI provider and returns the full answer text.
 * Throws AIError (with `kind`) on failure. Never calls paid APIs.
 */
export async function runAI(options: RunAIOptions): Promise<{ text: string; providerId: ProviderId; durationMs: number }> {
  const providerId = resolveProvider(options.providerId);
  if (!providerId) {
    throw new AIError(
      desktop
        ? 'No AI is connected yet. Open Settings → AI connections to connect Claude Code, Codex, Antigravity CLI or a free local model.'
        : 'No AI is connected. In the browser version only local servers (Ollama / LM Studio) are available — or download the desktop app to use your AI subscriptions.',
      'no-provider',
    );
  }
  const settings = useAISettings.getState();
  const info = getProviderInfo(providerId);
  const images = info?.supportsImages ? options.images : undefined;
  const model = options.model ?? settings.models[providerId] ?? '';
  const started = performance.now();
  let text = '';
  const onDelta = (delta: string) => {
    text += delta;
    options.onText?.(text);
  };

  if (options.signal?.aborted) throw new AIError('Cancelled', 'aborted');
  const api = desktop;
  if (api) {
    const requestId = uid('ai_');
    const abort = () => void api.ai.cancel(requestId);
    options.signal?.addEventListener('abort', abort);
    try {
      const result = await api.ai.run(
        {
          requestId,
          providerId,
          prompt: options.prompt,
          system: options.system,
          images,
          model,
          timeoutMs: settings.timeoutSec * 1000,
          baseUrl: baseUrlFor(providerId),
          apiKey: providerId === 'openai-compatible' ? settings.openaiCompatKey || undefined : undefined,
          allowApiBilling: !settings.blockApiBilling,
        },
        onDelta,
      );
      if (!result.ok) throw new AIError(result.error || 'The AI request failed', result.errorKind);
      if (result.text && result.text !== text) options.onText?.(result.text);
      return { text: result.text, providerId, durationMs: result.durationMs };
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
  }

  // Browser build: local HTTP servers only.
  if (providerId !== 'ollama' && providerId !== 'openai-compatible') {
    throw new AIError('This AI connection needs the desktop app.', 'unsupported');
  }
  try {
    let finalModel = model;
    if (!finalModel && providerId === 'ollama') {
      finalModel = settings.statuses.find((s) => s.id === 'ollama')?.models?.[0] ?? '';
      if (!finalModel) throw new AIError('No Ollama model installed. Run: ollama pull gemma3', 'failed');
    }
    const chat = providerId === 'ollama' ? ollamaChat : openAICompatChat;
    const answer = await chat({
      baseUrl: baseUrlFor(providerId) ?? '',
      model: finalModel,
      prompt: options.prompt,
      system: options.system,
      images,
      apiKey: settings.openaiCompatKey || undefined,
      signal: options.signal,
      onDelta,
    });
    return { text: answer, providerId, durationMs: performance.now() - started };
  } catch (error) {
    if (error instanceof AIError) throw error;
    if ((error as Error)?.name === 'AbortError') throw new AIError('Cancelled', 'aborted');
    throw new AIError(error instanceof Error ? error.message : String(error));
  }
}

const JSON_RULE =
  'Respond with ONE valid JSON value only — no markdown fences, no comments, no text before or after it.';

/**
 * Like runAI but expects a JSON answer. Retries once if the answer can't be parsed.
 */
export async function runAIJson<T>(options: RunAIOptions): Promise<{ data: T; text: string; providerId: ProviderId }> {
  const system = [options.system, JSON_RULE].filter(Boolean).join('\n\n');
  const first = await runAI({ ...options, system });
  try {
    return { data: extractJson<T>(first.text), text: first.text, providerId: first.providerId };
  } catch {
    const retry = await runAI({
      ...options,
      system,
      prompt: `${options.prompt}\n\nYour previous answer was not valid JSON:\n${first.text.slice(0, 2000)}\n\n${JSON_RULE}`,
    });
    return { data: extractJson<T>(retry.text), text: retry.text, providerId: retry.providerId };
  }
}

/** Friendly text for an error thrown by runAI. */
export function describeAIError(error: unknown): string {
  if (error instanceof AIError) {
    switch (error.kind) {
      case 'not-installed':
        return `${error.message}\nInstall it from Settings → AI connections.`;
      case 'not-logged-in':
        return `${error.message}\nSign in once in a terminal (see Settings → AI connections), then try again.`;
      case 'rate-limited':
        return `${error.message}\nYour plan's usage limit was reached. Wait for the reset or switch to another AI in the panel.`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
