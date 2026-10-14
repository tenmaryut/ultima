import { useEffect, useRef } from 'react';
import { Bot, Plug } from 'lucide-react';
import { Button } from '../../components/ui';
import { useAppStore } from '../../core/store';
import { isDesktop } from '../../core/platform';
import { useT } from '../../core/i18n';
import { MessageItem } from './MessageItem';
import { Composer } from './Composer';
import { personaLabel } from './personas';
import type { ChatEngine } from './useChatEngine';
import type { Attachment, Conversation, Persona } from './types';

export interface Draft {
  text: string;
  attachments: Attachment[];
}

interface Props {
  conv: Conversation;
  persona: Persona;
  engine: ChatEngine;
  draft: Draft;
  setDraft: (d: Draft) => void;
  noProvider: boolean;
  imagesSupported: boolean;
  onOpenTemplates: () => void;
}

export function ChatView({ conv, persona, engine, draft, setDraft, noProvider, imagesSupported, onOpenTemplates }: Props) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const busy = engine.busy.has(conv.id);
  const last = conv.messages[conv.messages.length - 1];

  useEffect(() => {
    stick.current = true;
  }, [conv.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [conv.id, conv.messages.length, last?.text, last?.status]);

  const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
  const lastAssistant = last?.role === 'assistant' ? last : null;

  const send = () => {
    if (busy || noProvider) return;
    engine.send(conv.id, draft.text, draft.attachments);
    setDraft({ text: '', attachments: [] });
    stick.current = true;
  };

  return (
    <div className="as-chat">
      <div
        className="as-messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="as-messages-inner">
          {noProvider && (
            <div className="card as-connect">
              <Plug size={20} color="var(--accent)" />
              <div className="col" style={{ gap: 6 }}>
                <strong>{t('Connect an AI to get started')}</strong>
                <span className="muted">
                  {isDesktop
                    ? t('Ultima uses the AI subscriptions you already have (Claude Code, Codex, Antigravity CLI, GitHub Copilot…) or free local models (Ollama, LM Studio). No paid API keys needed.')
                    : t('In the browser, AI Studio works with free local models (Ollama or LM Studio running on this computer). Download the desktop app to use Claude Code, Codex, Antigravity CLI and other subscriptions.')}
                </span>
                <div>
                  <Button size="sm" variant="primary" onClick={() => useAppStore.getState().setActiveModule('settings')}>
                    {t('Open AI settings')}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {!conv.messages.length && (
            <div className="as-welcome">
              <div className="as-welcome-icon">
                <Bot size={26} />
              </div>
              <h2>{personaLabel(persona, persona.name, t)}</h2>
              <p className="muted">{personaLabel(persona, persona.description, t)}</p>
              {persona.starters?.length ? (
                <div className="as-starters">
                  {persona.starters.map((s) => (
                    <button key={s} type="button" className="as-starter" disabled={noProvider} onClick={() => setDraft({ ...draft, text: t(s) })}>
                      {t(s)}
                    </button>
                  ))}
                </div>
              ) : null}
              <Button size="sm" variant="ghost" onClick={onOpenTemplates}>
                {t('Browse the prompt library')}
              </Button>
            </div>
          )}
          {conv.messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              title={conv.title}
              canEdit={!busy && m.id === lastUser?.id}
              canRegenerate={!busy && m.id === lastAssistant?.id}
              onRegenerate={() => engine.regenerate(conv.id)}
              onEditResend={(text) => engine.editAndResend(conv.id, m.id, text)}
            />
          ))}
        </div>
      </div>
      <Composer
        value={draft.text}
        onChange={(text) => setDraft({ ...draft, text })}
        attachments={draft.attachments}
        onAttachments={(attachments) => setDraft({ ...draft, attachments })}
        onSend={send}
        onStop={() => engine.stop(conv.id)}
        busy={busy}
        disabled={noProvider}
        imagesSupported={imagesSupported}
        onOpenTemplates={onOpenTemplates}
        focusKey={conv.id}
        placeholder={t('Message {name}…', { name: personaLabel(persona, persona.name, t) })}
      />
    </div>
  );
}
