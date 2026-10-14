import { describe, expect, it } from 'vitest';
import { capStored, conversationToMarkdown, parseConversationProject, sanitizeStored, serializeConversation, stripForStorage, DEFAULT_SETTINGS, type StoredStudio } from './persist';
import type { Conversation } from './types';

const conv = (id: string, updatedAt: number, size = 10, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  createdAt: 0,
  updatedAt,
  providerId: null,
  model: '',
  personaId: 'assistant',
  messages: [
    { id: `${id}-1`, role: 'user', text: 'u'.repeat(size), createdAt: 1, attachments: [{ id: 'a', kind: 'image', name: 'p.png', mime: 'image/png', size: 9, dataUrl: 'data:image/png;base64,' + 'A'.repeat(500), thumb: 'data:image/jpeg;base64,BBB' }] },
    { id: `${id}-2`, role: 'assistant', text: 'a'.repeat(size), createdAt: 2, status: 'streaming' },
  ],
  ...extra,
});

describe('sanitizeStored', () => {
  it('fills defaults for garbage', () => {
    const s = sanitizeStored('nope');
    expect(s.conversations).toEqual([]);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.currentId).toBeNull();
  });
  it('drops invalid messages and unknown providers, clamps settings', () => {
    const s = sanitizeStored({
      conversations: [{ id: 'c1', providerId: 'evil', messages: [{ role: 'system', text: 'x' }, { role: 'user', text: 'hi', status: 'streaming' }] }],
      currentId: 'missing',
      settings: { historyMessages: 999, charBudget: 5 },
      personas: [{ name: 'Poet', system: 'Write poems' }, { name: '', system: 'x' }],
    });
    expect(s.conversations[0].providerId).toBeNull();
    expect(s.conversations[0].messages).toHaveLength(1);
    expect(s.conversations[0].messages[0].status).toBe('stopped');
    expect(s.currentId).toBe('c1');
    expect(s.settings).toEqual({ historyMessages: 100, charBudget: 4000 });
    expect(s.personas.map((p) => p.name)).toEqual(['Poet']);
  });
});

describe('storage cap', () => {
  it('strips full images and streaming states', () => {
    const c = stripForStorage(conv('a', 1));
    expect(c.messages[0].attachments?.[0].dataUrl).toBeUndefined();
    expect(c.messages[0].attachments?.[0].thumb).toBe('data:image/jpeg;base64,BBB');
    expect(c.messages[1].status).toBe('stopped');
  });
  it('drops the least recently used conversations first, never the current one', () => {
    const data: StoredStudio = {
      version: 1,
      conversations: [conv('old', 1, 5000), conv('current', 2, 5000), conv('new', 3, 5000), conv('pinned', 0, 5000, { pinned: true })],
      currentId: 'current',
      personas: [],
      settings: DEFAULT_SETTINGS,
    };
    const out = capStored(data, 32_000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(32_000);
    expect(out.conversations.map((c) => c.id)).toEqual(['current', 'new', 'pinned']);
    const tight = capStored(data, 11_000);
    expect(tight.conversations.map((c) => c.id)).toEqual(['current']);
  });
  it('trims the current conversation when it alone is too big', () => {
    const data: StoredStudio = { version: 1, conversations: [conv('only', 1, 50_000)], currentId: 'only', personas: [], settings: DEFAULT_SETTINGS };
    const out = capStored(data, 60_000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(60_000);
    expect(out.conversations[0].messages.length).toBe(1);
    expect(out.conversations[0].messages[0].role).toBe('assistant');
  });
});

describe('export and project files', () => {
  it('exports markdown', () => {
    const md = conversationToMarkdown({ ...conv('Trip ideas', 1), messages: [{ id: '1', role: 'user', text: 'Plan a trip', createdAt: 0 }, { id: '2', role: 'assistant', text: '**Day 1** — beach', createdAt: 0, providerId: 'ollama', model: 'gemma3' }] }, 'Creative assistant', (id) => (id === 'ollama' ? 'Ollama' : 'AI'));
    expect(md).toContain('# Trip ideas');
    expect(md).toContain('## You\n\nPlan a trip');
    expect(md).toContain('## Ollama (gemma3)\n\n**Day 1** — beach');
  });
  it('round-trips a conversation project', () => {
    const c = conv('proj', 5);
    const back = parseConversationProject(serializeConversation(c, { id: 'p1', name: 'Poet', description: '', system: 'Write poems' }));
    expect(back.conversation.messages.map((m) => m.text)).toEqual(c.messages.map((m) => m.text));
    expect(back.conversation.messages[0].attachments?.[0].dataUrl).toBeUndefined();
    expect(back.persona?.name).toBe('Poet');
    expect(() => parseConversationProject('{"app":"ultima","module":"color"}')).toThrow();
  });
});
