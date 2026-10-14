/**
 * AI Studio state: conversations, custom personas and settings, persisted to localStorage
 * (debounced, size capped — see persist.ts).
 */
import { create } from 'zustand';
import { uid } from '../../core/utils/id';
import { toast } from '../../components/ui';
import { t } from '../../core/i18n';
import { capStored, sanitizeStored, STORAGE_CAP, type StoredStudio } from './persist';
import { DEFAULT_PERSONA_ID } from './personas';
import type { ChatMessage, Conversation, Persona, StudioSettings } from './types';

const KEY = 'ultima-ai-studio';

interface StudioStore extends StoredStudio {
  newConversation: (init?: Partial<Conversation>) => string;
  select: (id: string | null) => void;
  updateConversation: (id: string, fn: (c: Conversation) => Conversation, touch?: boolean) => void;
  patchMessage: (convId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  removeConversation: (id: string) => void;
  duplicateConversation: (id: string, suffix: string) => string | null;
  importConversation: (c: Conversation) => string;
  setSettings: (patch: Partial<StudioSettings>) => void;
  savePersona: (p: Persona) => void;
  deletePersona: (id: string) => void;
  clearAll: () => void;
}

function load(): StoredStudio {
  try {
    return sanitizeStored(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return sanitizeStored({});
  }
}

export function makeConversation(init: Partial<Conversation> = {}): Conversation {
  const now = Date.now();
  return { id: uid('chat'), title: '', createdAt: now, updatedAt: now, providerId: null, model: '', personaId: DEFAULT_PERSONA_ID, messages: [], ...init };
}

export const useStudio = create<StudioStore>()((set, get) => ({
  ...load(),
  newConversation: (init) => {
    const c = makeConversation(init);
    set((s) => ({ conversations: [c, ...s.conversations], currentId: c.id }));
    return c.id;
  },
  select: (id) => set({ currentId: id }),
  updateConversation: (id, fn, touch = true) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== id) return c;
        const next = fn(c);
        return touch && next !== c ? { ...next, updatedAt: Date.now() } : next;
      }),
    })),
  patchMessage: (convId, msgId, patch) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) } : c,
      ),
    })),
  removeConversation: (id) =>
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const currentId = s.currentId === id ? ([...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null) : s.currentId;
      return { conversations, currentId };
    }),
  duplicateConversation: (id, suffix) => {
    const src = get().conversations.find((c) => c.id === id);
    if (!src) return null;
    const copy = makeConversation({
      ...src,
      id: uid('chat'),
      title: `${src.title || t('New chat')} ${suffix}`.trim(),
      pinned: false,
      messages: src.messages.map((m) => ({ ...m, id: uid('m'), status: m.status === 'streaming' ? 'stopped' : m.status })),
    });
    set((s) => ({ conversations: [copy, ...s.conversations], currentId: copy.id }));
    return copy.id;
  },
  importConversation: (c) => {
    const copy = { ...c, id: uid('chat'), updatedAt: Date.now() };
    set((s) => ({ conversations: [copy, ...s.conversations], currentId: copy.id }));
    return copy.id;
  },
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  savePersona: (p) =>
    set((s) => ({ personas: s.personas.some((x) => x.id === p.id) ? s.personas.map((x) => (x.id === p.id ? p : x)) : [...s.personas, p] })),
  deletePersona: (id) =>
    set((s) => ({
      personas: s.personas.filter((p) => p.id !== id),
      conversations: s.conversations.map((c) => (c.personaId === id ? { ...c, personaId: DEFAULT_PERSONA_ID } : c)),
    })),
  clearAll: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    set({ ...sanitizeStored({}) });
  },
}));

/* ------------------------------- Persistence ------------------------------- */

let timer: ReturnType<typeof setTimeout> | null = null;
let firstChange = 0;
let warned = false;

function persistNow() {
  timer = null;
  firstChange = 0;
  const s = useStudio.getState();
  const data: StoredStudio = { version: 1, conversations: s.conversations, currentId: s.currentId, personas: s.personas, settings: s.settings };
  for (const cap of [STORAGE_CAP, STORAGE_CAP / 2, STORAGE_CAP / 8]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(capStored(data, cap)));
      return;
    } catch {
      // quota exceeded: retry with a smaller cap
    }
  }
  if (!warned) {
    warned = true;
    toast.warning(t('Could not save your chats'), t('The browser storage is full. Export important conversations as Markdown.'));
  }
}

useStudio.subscribe((s, prev) => {
  if (s.conversations === prev.conversations && s.personas === prev.personas && s.settings === prev.settings && s.currentId === prev.currentId) return;
  const now = Date.now();
  if (!firstChange) firstChange = now;
  if (timer) clearTimeout(timer);
  // debounce, but never wait more than 4 s (long streaming answers)
  timer = setTimeout(persistNow, now - firstChange > 4000 ? 0 : 600);
});

if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => timer && persistNow());
