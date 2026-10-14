import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Check, ChevronDown, ChevronRight, Play, Send, Sparkles, Square, Trash2, X } from 'lucide-react';
import type { AIImage, ProviderId } from '@shared/ai-types';
import { useAISettings } from '../../core/ai/settings';
import { describeAIError, providerSupportsImages, resolveProvider, runAIJson, useProviderDetection } from '../../core/ai/client';
import { partialJsonMessage } from '../../core/ai/json';
import { useAppStore, type ModuleId } from '../../core/store';
import { useT } from '../../core/i18n';
import { uid } from '../../core/utils/id';
import { Markdown } from './Markdown';
import { ProviderPicker } from './ProviderPicker';
import { IconButton, Spinner } from '../ui';

export interface AIAction {
  type: string;
  [key: string]: unknown;
}

export interface AIContext {
  /** Plain-text description of the current document/selection for the AI. */
  summary: string;
  /** Optional rendered snapshot (sent only when the provider understands images). */
  image?: AIImage | null;
}

export interface AIAssistantPanelProps {
  moduleId: ModuleId;
  /** e.g. "Photo Editor" — used in the system prompt. */
  moduleName: string;
  /**
   * Module specific instructions: what the assistant can do and the exact JSON shape of
   * every action type it may return.
   */
  instructions: string;
  getContext: () => AIContext | Promise<AIContext>;
  /** Executes the actions. Return a short result text (shown under the message) or throw. */
  onActions: (actions: AIAction[]) => Promise<string | void> | string | void;
  suggestions?: string[];
  placeholder?: string;
  /** Show the "attach snapshot" toggle (modules with a visual canvas). */
  canSnapshot?: boolean;
  onClose?: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  actions?: AIAction[];
  status?: 'pending' | 'ready' | 'applying' | 'applied' | 'failed';
  result?: string;
  provider?: ProviderId;
}

const REPLY_FORMAT = `REPLY FORMAT
Reply with a single JSON object: {"message": string, "actions": array}
- "message": a short, friendly reply for the user, written in the same language the user used.
- "actions": the edit operations to perform, in order. Use [] when you only answer a question or cannot do the request.
- Use only the action types documented above, with valid values. Never invent file paths, URLs or fonts that are not available.`;

export function AIAssistantPanel(props: AIAssistantPanelProps) {
  const t = useT();
  useProviderDetection();
  const autoApply = useAISettings((s) => s.autoApply);
  const sendSnapshots = useAISettings((s) => s.sendSnapshots);
  const statuses = useAISettings((s) => s.statuses);
  const enabled = useAISettings((s) => s.enabled);
  const [provider, setProvider] = useState<ProviderId | null>(() => resolveProvider());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [snapshot, setSnapshot] = useState(sendSnapshots);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // keep provider valid when connections change
  useEffect(() => {
    setProvider((p) => resolveProvider(p ?? undefined));
  }, [statuses, enabled]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const update = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const applying = useRef(new Set<string>());
  const apply = async (msg: ChatMessage) => {
    if (!msg.actions?.length || applying.current.has(msg.id)) return;
    applying.current.add(msg.id);
    update(msg.id, { status: 'applying' });
    try {
      const result = await propsRef.current.onActions(msg.actions);
      update(msg.id, { status: 'applied', result: result || undefined });
    } catch (error) {
      update(msg.id, { status: 'failed', result: error instanceof Error ? error.message : String(error) });
    } finally {
      applying.current.delete(msg.id);
    }
  };

  const send = async (text: string) => {
    const request = text.trim();
    if (!request || busy) return;
    setInput('');
    const userMsg: ChatMessage = { id: uid('m'), role: 'user', text: request };
    const reply: ChatMessage = { id: uid('m'), role: 'assistant', text: '', status: 'pending', provider: provider ?? undefined };
    const history = messages.slice(-8);
    setMessages((list) => [...list, userMsg, reply]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const ctx = await propsRef.current.getContext();
      const useImage = snapshot && props.canSnapshot && ctx.image && providerSupportsImages(provider);
      const transcript = history
        .filter((m) => m.role !== 'error' && m.text)
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n');
      const prompt = [
        transcript && `CONVERSATION SO FAR\n${transcript}`,
        `CURRENT DOCUMENT\n${ctx.summary || '(empty)'}`,
        useImage ? 'A snapshot of the current canvas is attached.' : '',
        `USER REQUEST\n${request}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      const system = `You are the built-in AI assistant of the ${props.moduleName} in Ultima, a free, open-source all-in-one creative suite.\n\n${props.instructions}\n\n${REPLY_FORMAT}`;
      const { data, providerId } = await runAIJson<{ message?: string; actions?: AIAction[] }>({
        prompt,
        system,
        providerId: provider ?? undefined,
        images: useImage && ctx.image ? [ctx.image] : undefined,
        signal: ctrl.signal,
        onText: (partial) => {
          const m = partialJsonMessage(partial);
          if (m) update(reply.id, { text: m });
        },
      });
      const actions = Array.isArray(data?.actions) ? data.actions.filter((a) => a && typeof a.type === 'string') : [];
      const final: ChatMessage = {
        ...reply,
        text: typeof data?.message === 'string' ? data.message : actions.length ? t('Done.') : t('(no answer)'),
        actions,
        status: actions.length ? 'ready' : undefined,
        provider: providerId,
      };
      update(reply.id, final);
      if (actions.length && autoApply) await apply(final);
    } catch (error) {
      update(reply.id, { role: 'error', text: describeAIError(error), status: undefined });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const noProvider = !provider;
  const showSnapshotToggle = props.canSnapshot && providerSupportsImages(provider);

  return (
    <div className="ai-panel">
      <div className="panel-header" style={{ cursor: 'default' }}>
        <Sparkles size={13} color="var(--accent)" style={{ flex: '0 0 auto' }} />
        <span className="grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t('AI Assistant')}
        </span>
        <ProviderPicker value={provider} onChange={setProvider} />
        <IconButton icon={Trash2} label={t('Clear conversation')} size="sm" onClick={() => setMessages([])} disabled={!messages.length} />
        {props.onClose && <IconButton icon={X} label={t('Close')} size="sm" onClick={props.onClose} />}
      </div>

      <div className="ai-messages" ref={listRef}>
        {noProvider && (
          <div className="card col" style={{ gap: 8 }}>
            <strong style={{ color: 'var(--text-0)' }}>{t('Connect an AI to get started')}</strong>
            <span className="muted">
              {t('Ultima uses the AI subscriptions you already have (Claude Code, Codex, Antigravity CLI, GitHub Copilot…) or free local models (Ollama, LM Studio). No paid API keys needed.')}
            </span>
            <button type="button" className="btn primary sm" onClick={() => useAppStore.getState().setActiveModule('settings')}>
              {t('Open AI settings')}
            </button>
          </div>
        )}
        {!messages.length && !noProvider && (
          <div className="muted" style={{ fontSize: 12 }}>
            {t('Describe what you want and the assistant will edit your document. You can review every change before it is applied.')}
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} onApply={() => apply(m)} />
        ))}
      </div>

      <div className="ai-composer">
        {!messages.length && props.suggestions?.length ? (
          <div className="ai-suggestions">
            {props.suggestions.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={busy || noProvider}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          className="textarea"
          rows={3}
          value={input}
          placeholder={props.placeholder ?? t('Ask the AI to edit…')}
          disabled={noProvider}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="row">
          {showSnapshotToggle && (
            <IconButton
              icon={snapshot ? Camera : CameraOff}
              label={snapshot ? t('A snapshot of the canvas is sent with your request') : t('No snapshot is sent')}
              active={snapshot}
              size="sm"
              onClick={() => setSnapshot((s) => !s)}
            />
          )}
          <span className="faint" style={{ fontSize: 11 }}>
            {t('Enter to send · Shift+Enter for a new line')}
          </span>
          <span className="spacer" />
          {busy ? (
            <button type="button" className="btn sm" onClick={() => abortRef.current?.abort()}>
              <Square size={12} /> {t('Stop')}
            </button>
          ) : (
            <button type="button" className="btn primary sm" disabled={!input.trim() || noProvider} onClick={() => send(input)}>
              <Send size={12} /> {t('Send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageView({ message, onApply }: { message: ChatMessage; onApply: () => void }) {
  const t = useT();
  const [showDetails, setShowDetails] = useState(false);
  if (message.role === 'user') return <div className="ai-msg user">{message.text}</div>;
  if (message.role === 'error') return <div className="ai-msg error selectable" style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>;
  return (
    <div className="ai-msg">
      {message.status === 'pending' && !message.text ? (
        <div className="row muted">
          <Spinner size={14} /> {t('Thinking…')}
        </div>
      ) : (
        <Markdown text={message.text} />
      )}
      {!!message.actions?.length && (
        <div className="col" style={{ gap: 6, marginTop: 8 }}>
          <button type="button" className="row faint" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12 }} onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('{count} edit step(s)', { count: message.actions.length })}
          </button>
          {showDetails && <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto', margin: 0 }}>{JSON.stringify(message.actions, null, 2)}</pre>}
          {(message.status === 'ready' || message.status === 'applying') && (
            <button type="button" className="btn primary sm" onClick={onApply} disabled={message.status === 'applying'}>
              {message.status === 'applying' ? <Spinner size={12} /> : <Play size={12} />} {t('Apply')}
            </button>
          )}
          {message.status === 'applied' && (
            <span className="badge ok" style={{ whiteSpace: 'normal', alignSelf: 'flex-start' }}>
              <Check size={11} style={{ flex: '0 0 auto' }} /> {message.result || t('Applied')}
            </span>
          )}
          {message.status === 'failed' && (
            <span className="badge err" style={{ whiteSpace: 'normal', alignSelf: 'flex-start' }}>
              {message.result || t('Could not apply')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
