import type { ProviderId } from '@shared/ai-types';

export interface Attachment {
  id: string;
  kind: 'image' | 'text';
  name: string;
  mime: string;
  size: number;
  /** Full image as a data URL (kept in memory only, never persisted). */
  dataUrl?: string;
  /** Small JPEG preview (persisted). */
  thumb?: string;
  /** Text file contents (capped). */
  text?: string;
  truncated?: boolean;
}

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  attachments?: Attachment[];
  providerId?: ProviderId;
  model?: string;
  durationMs?: number;
  status?: MessageStatus;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** null = the user's default AI. */
  providerId: ProviderId | null;
  /** '' = the provider's default model. */
  model: string;
  personaId: string;
  messages: ChatMessage[];
  pinned?: boolean;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  system: string;
  builtin?: boolean;
  starters?: string[];
}

export interface StudioSettings {
  /** Last N messages included with each prompt. */
  historyMessages: number;
  /** Character budget of the whole prompt (history + new message). */
  charBudget: number;
}
