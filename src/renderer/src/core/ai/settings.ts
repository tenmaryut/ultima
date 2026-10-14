import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ImageProviderId, LocalToolStatus, ProviderId, ProviderStatus, SpeechProviderId } from '@shared/ai-types';

export interface AISettings {
  /** Provider used when a module doesn't ask for a specific one. */
  defaultProvider: ProviderId | null;
  /** Providers the user explicitly enabled (after reading the terms notice). */
  enabled: Partial<Record<ProviderId, boolean>>;
  /** Preferred model per provider ('' = the tool's default). */
  models: Partial<Record<ProviderId, string>>;
  ollamaUrl: string;
  openaiCompatUrl: string;
  openaiCompatKey: string;
  /** AUTOMATIC1111 / Forge WebUI for local image generation (optional). */
  sdUrl: string;
  /** Image generator for AI Studio → Images and Photo → Generate Image. */
  imageProvider: ImageProviderId;
  comfyUrl: string;
  /** ComfyUI checkpoint ('' = the first one). */
  comfyModel: string;
  /** OpenAI-style local image server, e.g. LocalAI's http://127.0.0.1:8080/v1. */
  localImageUrl: string;
  localImageModel: string;
  /** AI that draws SVG images (null = the default AI). */
  svgProvider: ProviderId | null;
  /** Text-to-speech engine (desktop app). */
  speechProvider: SpeechProviderId;
  /** Chosen voice per engine ('' = a voice matching the UI language, else the engine default). */
  speechVoices: Partial<Record<SpeechProviderId, string>>;
  /** Speaking rate, 0.5–2. */
  speechRate: number;
  timeoutSec: number;
  /** Apply the AI's edit actions automatically instead of showing an Apply button. */
  autoApply: boolean;
  /** Keep API-key env vars away from CLIs so they bill the subscription, never the API. */
  blockApiBilling: boolean;
  /** Attach a snapshot of the canvas to requests when the provider understands images. */
  sendSnapshots: boolean;
}

interface AIStore extends AISettings {
  statuses: ProviderStatus[];
  tools: LocalToolStatus[];
  detecting: boolean;
  lastDetectedAt: number;
  update: (patch: Partial<AISettings>) => void;
  setEnabled: (id: ProviderId, enabled: boolean) => void;
  setModel: (id: ProviderId, model: string) => void;
  setStatuses: (statuses: ProviderStatus[]) => void;
  setTools: (tools: LocalToolStatus[]) => void;
  setDetecting: (detecting: boolean) => void;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  defaultProvider: null,
  enabled: { ollama: true, 'openai-compatible': true },
  models: {},
  ollamaUrl: 'http://127.0.0.1:11434',
  openaiCompatUrl: 'http://127.0.0.1:1234/v1',
  openaiCompatKey: '',
  sdUrl: 'http://127.0.0.1:7860',
  imageProvider: 'sd-webui',
  comfyUrl: 'http://127.0.0.1:8188',
  comfyModel: '',
  localImageUrl: 'http://127.0.0.1:8080/v1',
  localImageModel: '',
  svgProvider: null,
  speechProvider: 'system',
  speechVoices: {},
  speechRate: 1,
  timeoutSec: 300,
  autoApply: false,
  blockApiBilling: true,
  sendSnapshots: true,
};

export const useAISettings = create<AIStore>()(
  persist(
    (set) => ({
      ...DEFAULT_AI_SETTINGS,
      statuses: [],
      tools: [],
      detecting: false,
      lastDetectedAt: 0,
      update: (patch) => set(patch),
      setEnabled: (id, enabled) => set((s) => ({ enabled: { ...s.enabled, [id]: enabled } })),
      setModel: (id, model) => set((s) => ({ models: { ...s.models, [id]: model } })),
      setStatuses: (statuses) => set({ statuses, lastDetectedAt: Date.now() }),
      setTools: (tools) => set({ tools }),
      setDetecting: (detecting) => set({ detecting }),
    }),
    {
      name: 'ultima-ai',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(DEFAULT_AI_SETTINGS) as (keyof AISettings)[]) out[key] = s[key];
        return out as unknown as AISettings;
      },
    },
  ),
);
