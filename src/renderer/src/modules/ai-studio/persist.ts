/**
 * Persistence helpers for AI Studio: sanitising stored data, keeping localStorage under a
 * size cap, Markdown export and the .ultima project format. Pure — unit tested.
 */
import type { ProviderId } from '@shared/ai-types';
import { PROVIDERS } from '@shared/providers-catalog';
import type { Attachment, ChatMessage, Conversation, Persona, StudioSettings } from './types';
import { DEFAULT_CHAR_BUDGET, DEFAULT_HISTORY_MESSAGES } from './transcript';
import { DEFAULT_PERSONA_ID } from './personas';

/** About 2.5M UTF-16 chars ≈ 5 MB, the usual localStorage quota for one origin. */
export const STORAGE_CAP = 2_400_000;
const MAX_TEXT = 200_000;
const MAX_THUMB = 40_000;

export interface StoredStudio {
  version: 1;
  conversations: Conversation[];
  currentId: string | null;
  personas: Persona[];
  settings: StudioSettings;
}

export const DEFAULT_SETTINGS: StudioSettings = { historyMessages: DEFAULT_HISTORY_MESSAGES, charBudget: DEFAULT_CHAR_BUDGET };

const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && PROVIDERS.some((p) => p.id === v);
const str = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function sanitizeAttachment(raw: unknown): Attachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const kind = a.kind === 'image' ? 'image' : a.kind === 'text' ? 'text' : null;
  if (!kind) return null;
  const thumb = typeof a.thumb === 'string' && a.thumb.startsWith('data:image/') && a.thumb.length <= MAX_THUMB ? a.thumb : undefined;
  const dataUrl = typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? a.dataUrl : undefined;
  return {
    id: str(a.id, 80) || `att${Math.random().toString(36).slice(2, 9)}`,
    kind,
    name: str(a.name, 200) || 'file',
    mime: str(a.mime, 100),
    size: num(a.size, 0),
    thumb,
    dataUrl,
    text: kind === 'text' ? str(a.text) : undefined,
    truncated: a.truncated === true,
  };
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const role = m.role === 'user' || m.role === 'assistant' ? m.role : null;
  if (!role) return null;
  const status = m.status === 'streaming' ? 'stopped' : m.status === 'done' || m.status === 'stopped' || m.status === 'error' ? m.status : undefined;
  const attachments = Array.isArray(m.attachments) ? m.attachments.map(sanitizeAttachment).filter((a): a is Attachment => Boolean(a)) : undefined;
  return {
    id: str(m.id, 80) || `m${Math.random().toString(36).slice(2, 9)}`,
    role,
    text: str(m.text),
    createdAt: num(m.createdAt, Date.now()),
    attachments: attachments?.length ? attachments : undefined,
    providerId: isProvider(m.providerId) ? m.providerId : undefined,
    model: typeof m.model === 'string' ? m.model.slice(0, 200) : undefined,
    durationMs: typeof m.durationMs === 'number' ? m.durationMs : undefined,
    status,
    error: typeof m.error === 'string' ? m.error.slice(0, 2000) : undefined,
  };
}

export function sanitizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const messages = Array.isArray(c.messages) ? c.messages.map(sanitizeMessage).filter((m): m is ChatMessage => Boolean(m)) : [];
  return {
    id: str(c.id, 80) || `c${Math.random().toString(36).slice(2, 9)}`,
    title: str(c.title, 200),
    createdAt: num(c.createdAt, Date.now()),
    updatedAt: num(c.updatedAt, Date.now()),
    providerId: isProvider(c.providerId) ? c.providerId : null,
    model: str(c.model, 200),
    personaId: str(c.personaId, 80) || DEFAULT_PERSONA_ID,
    messages,
    pinned: c.pinned === true,
  };
}

export function sanitizePersonas(raw: unknown): Persona[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): Persona | null => {
      if (!p || typeof p !== 'object') return null;
      const o = p as Record<string, unknown>;
      const name = str(o.name, 80).trim();
      const system = str(o.system, 8000).trim();
      if (!name || !system) return null;
      return { id: str(o.id, 80) || `p${Math.random().toString(36).slice(2, 9)}`, name, description: str(o.description, 300), system };
    })
    .filter((p): p is Persona => Boolean(p))
    .slice(0, 100);
}

export function sanitizeStored(raw: unknown): StoredStudio {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const conversations = Array.isArray(o.conversations) ? o.conversations.map(sanitizeConversation).filter((c): c is Conversation => Boolean(c)) : [];
  const s = (o.settings ?? {}) as Record<string, unknown>;
  const settings: StudioSettings = {
    historyMessages: Math.max(0, Math.min(100, Math.round(num(s.historyMessages, DEFAULT_SETTINGS.historyMessages)))),
    charBudget: Math.max(4000, Math.min(400_000, Math.round(num(s.charBudget, DEFAULT_SETTINGS.charBudget)))),
  };
  const currentId = typeof o.currentId === 'string' && conversations.some((c) => c.id === o.currentId) ? o.currentId : (conversations[0]?.id ?? null);
  return { version: 1, conversations, currentId, personas: sanitizePersonas(o.personas), settings };
}

/** Removes data that must not (or need not) be stored: full images and in-flight states. */
export function stripForStorage(c: Conversation): Conversation {
  return {
    ...c,
    messages: c.messages.map((m) => ({
      ...m,
      status: m.status === 'streaming' ? 'stopped' : m.status,
      attachments: m.attachments?.map((a) => ({ ...a, dataUrl: undefined, thumb: a.thumb && a.thumb.length <= MAX_THUMB ? a.thumb : undefined })),
    })),
  };
}

/**
 * Keeps the serialized studio under `cap` characters: drops the least recently used
 * conversations first (never the current one), then the oldest messages of the current
 * conversation, then attachment previews.
 */
export function capStored(data: StoredStudio, cap = STORAGE_CAP): StoredStudio {
  let out: StoredStudio = { ...data, conversations: data.conversations.map(stripForStorage) };
  const size = (d: StoredStudio) => JSON.stringify(d).length;
  if (size(out) <= cap) return out;
  const order = [...out.conversations].filter((c) => c.id !== out.currentId && !c.pinned).sort((a, b) => a.updatedAt - b.updatedAt);
  const pinnedOld = [...out.conversations].filter((c) => c.id !== out.currentId && c.pinned).sort((a, b) => a.updatedAt - b.updatedAt);
  for (const victim of [...order, ...pinnedOld]) {
    out = { ...out, conversations: out.conversations.filter((c) => c.id !== victim.id) };
    if (size(out) <= cap) return out;
  }
  // only the current conversation is left: drop thumbnails, then its oldest messages
  out = {
    ...out,
    conversations: out.conversations.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, attachments: m.attachments?.map((a) => ({ ...a, thumb: undefined })) })) })),
  };
  while (size(out) > cap && out.conversations.some((c) => c.messages.length > 1)) {
    out = { ...out, conversations: out.conversations.map((c) => ({ ...c, messages: c.messages.slice(1) })) };
  }
  if (size(out) > cap) {
    out = { ...out, conversations: out.conversations.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, text: m.text.slice(0, Math.max(0, cap / 2)) })) })) };
  }
  return out;
}

/* --------------------------------- Export --------------------------------- */

export function conversationToMarkdown(c: Conversation, personaName: string, providerName: (id: ProviderId | undefined) => string): string {
  const lines = [`# ${c.title || 'Conversation'}`, '', `_${personaName} · ${new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' ')} · exported from Ultima AI Studio_`, ''];
  for (const m of c.messages) {
    if (m.role === 'user') {
      lines.push('## You', '');
      if (m.text) lines.push(m.text, '');
      for (const a of m.attachments ?? []) lines.push(`> 📎 ${a.name}${a.kind === 'image' ? ' (image)' : ''}`, '');
    } else {
      const who = providerName(m.providerId) + (m.model ? ` (${m.model})` : '');
      lines.push(`## ${who}`, '');
      if (m.status === 'error') lines.push(`> ⚠️ ${m.error ?? 'Error'}`, '');
      else if (m.text) lines.push(m.text, '');
      if (m.status === 'stopped') lines.push('_(stopped)_', '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export interface ConversationProject {
  app: 'ultima';
  module: 'ai-studio';
  version: 1;
  conversation: Conversation;
  persona?: Persona;
}

export function serializeConversation(c: Conversation, persona?: Persona): string {
  const project: ConversationProject = { app: 'ultima', module: 'ai-studio', version: 1, conversation: stripForStorage(c), ...(persona && !persona.builtin ? { persona } : {}) };
  return JSON.stringify(project, null, 1);
}

export function parseConversationProject(text: string): { conversation: Conversation; persona?: Persona } {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (data.app !== 'ultima' || data.module !== 'ai-studio') throw new Error('This is not an AI Studio file');
  const conversation = sanitizeConversation(data.conversation);
  if (!conversation) throw new Error('The file does not contain a conversation');
  const persona = sanitizePersonas([data.persona])[0];
  return { conversation, persona };
}
