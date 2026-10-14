import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Check, ChevronDown, ChevronRight, Eye, Play, Send, Sparkles, Square, Trash2, TriangleAlert, X } from 'lucide-react';
import type { AIImage, ProviderId } from '@shared/ai-types';
import { useAISettings } from '../../core/ai/settings';
import { describeAIError, providerSupportsImages, resolveProvider, runAIJson, useProviderDetection } from '../../core/ai/client';
import { partialJsonMessage } from '../../core/ai/json';
import { attachedImages } from './attachments';
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
  /** More pictures sent after the snapshot, e.g. frames from every clip of a timeline. */
  moreImages?: AIImage[];
  /** What `moreImages` show, for the AI (e.g. "frame sheets of the timeline…"). */
  moreImagesNote?: string;
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
  /** `images` tells whether pictures will be sent, so modules can skip rendering them. */
  getContext: (options: { images: boolean }) => AIContext | Promise<AIContext>;
  /**
   * Executes the actions. Return a short result text (shown under the message) or a report whose
   * details go back to the AI with the next request; throw when nothing could be applied.
   */
  onActions: (actions: AIAction[]) => Promise<string | AIActionReport | void> | string | AIActionReport | void;
  /**
   * Answers the AI's {"type":"look"} actions with pictures. The panel then asks the AI again
   * automatically, with the pictures attached, so it can finish the request.
   */
  onLook?: (actions: AIAction[]) => Promise<AILookResult>;
  suggestions?: string[];
  placeholder?: string;
  /** Show the "attach snapshot" toggle (modules with a visual canvas). */
  canSnapshot?: boolean;
  /** Tooltip of the toggle while pictures are sent, when they are more than the canvas snapshot. */
  snapshotLabel?: string;
  onClose?: () => void;
}

export interface AIActionReport {
  /** Short text for the user. */
  summary: string;
  /** What happened to every action, for the AI (and the user on request). */
  details?: string;
  /** Some actions were skipped. */
  partial?: boolean;
}

export interface AILookResult {
  images: AIImage[];
  /** What the pictures show, for the AI. */
  note: string;
}

/** Automatic follow-ups after "look" requests, per user message. */
const MAX_LOOKS = 2;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  actions?: AIAction[];
  status?: 'pending' | 'ready' | 'applying' | 'applied' | 'failed' | 'looked';
  result?: string;
  details?: string;
  partial?: boolean;
  provider?: ProviderId;
}

/** How an earlier reply's actions turned out, for the AI's next request. */
function outcome(m: ChatMessage): string {
  const n = m.actions?.length ?? 0;
  switch (m.status) {
    case 'applied':
      return `Applied.${m.details ? ` Results:\n${m.details}` : m.result ? ` ${m.result}` : ''}`;
    case 'failed':
      return `NOT applied, it failed: ${m.details ?? m.result ?? 'unknown error'}`;
    case 'applying':
      return 'Being applied right now.';
    case 'looked':
      return 'Look request answered with pictures.';
    default:
      return `NOT applied: the user has not pressed Apply for these ${n} action(s).`;
  }
}

function historyText(list: ChatMessage[]): string {
  return list
    .filter((m) => m.role !== 'error' && (m.text || m.actions?.length))
    .map((m) => (m.role === 'user' ? `User: ${m.text}` : `Assistant: ${m.text}${m.actions?.length ? `\n[${outcome(m)}]` : ''}`))
    .join('\n');
}

const REPLY_FORMAT = `REPLY FORMAT
Reply with a single JSON object: {"message": string, "actions": array}
- "message": a short, friendly reply for the user, written in the same language the user used.
- "actions": the edit operations to perform, in order. Use [] when you only answer a question or cannot do the request.
- Use only the action types documented above, with valid values. Never invent file paths, URLs or fonts that are not available.
- Lines in [brackets] after your earlier messages tell you whether those actions were applied and what happened to each one.`;

export function AIAssistantPanel(props: AIAssistantPanelProps) {
  const t = useT();
  useProviderDetection();
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
      const report = typeof result === 'string' ? { summary: result } : result ?? { summary: '' };
      update(msg.id, { status: 'applied', result: report.summary || undefined, details: report.details, partial: report.partial });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const [first, ...rest] = text.split('\n');
      update(msg.id, { status: 'failed', result: first, details: rest.length ? rest.join('\n') : undefined });
    } finally {
      applying.current.delete(msg.id);
    }
  };

  /** One request to the AI; "look" replies are answered with pictures and asked again (up to MAX_LOOKS). */
  const ask = async (request: string, earlier: ChatMessage[], signal: AbortSignal, look?: { depth: number; result: AILookResult }) => {
    const reply: ChatMessage = { id: uid('m'), role: 'assistant', text: '', status: 'pending', provider: provider ?? undefined };
    setMessages((list) => [...list, reply]);
    const imagesWanted = Boolean(snapshot && props.canSnapshot && providerSupportsImages(provider));
    const ctx = await propsRef.current.getContext({ images: imagesWanted });
    const groups = imagesWanted && ctx.moreImages?.length ? [{ images: ctx.moreImages, note: ctx.moreImagesNote ?? '' }] : [];
    const lookShown = Boolean(look?.result.images.length && providerSupportsImages(provider));
    if (look && lookShown) groups.push({ images: look.result.images, note: look.result.note });
    const attached = attachedImages(imagesWanted ? ctx.image : null, groups);
    const transcript = historyText(earlier);
    const prompt = [
      transcript && `CONVERSATION SO FAR\n${transcript}`,
      `CURRENT DOCUMENT\n${ctx.summary || '(empty)'}`,
      attached.note,
      look
        ? `LOOK RESULT\nYou asked to look; ${lookShown ? `the pictures are attached (${look.result.note})` : providerSupportsImages(provider) ? look.result.note : 'this AI connection cannot receive pictures, so work from CURRENT DOCUMENT'}. Now finish the request${look.depth >= MAX_LOOKS ? ' without asking to look again' : ''}.`
        : '',
      `USER REQUEST\n${request}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const system = `You are the built-in AI assistant of the ${props.moduleName} in Ultima, a free, open-source all-in-one creative suite.\n\n${props.instructions}\n\n${REPLY_FORMAT}`;
    const { data, providerId } = await runAIJson<{ message?: string; actions?: AIAction[] }>({
      prompt,
      system,
      providerId: provider ?? undefined,
      images: attached.images.length ? attached.images : undefined,
      signal,
      onText: (partial) => {
        const m = partialJsonMessage(partial);
        if (m) update(reply.id, { text: m });
      },
    });
    const actions = Array.isArray(data?.actions) ? data.actions.filter((a) => a && typeof a.type === 'string') : [];
    const looks = actions.filter((a) => a.type === 'look');
    const depth = look?.depth ?? 0;
    if (looks.length && propsRef.current.onLook && depth < MAX_LOOKS) {
      const lookMsg: ChatMessage = { ...reply, text: typeof data?.message === 'string' && data.message ? data.message : t('Looking closer…'), actions: looks, status: 'looked', provider: providerId };
      update(reply.id, lookMsg);
      const result = providerSupportsImages(provider) ? await propsRef.current.onLook(looks) : { images: [], note: '' };
      return ask(request, [...earlier, lookMsg], signal, { depth: depth + 1, result });
    }
    const editActions = actions.filter((a) => a.type !== 'look');
    const final: ChatMessage = {
      ...reply,
      text: typeof data?.message === 'string' ? data.message : editActions.length ? t('Done.') : t('(no answer)'),
      actions: editActions,
      status: editActions.length ? 'ready' : undefined,
      provider: providerId,
    };
    update(reply.id, final);
    if (editActions.length && useAISettings.getState().autoApply) await apply(final);
  };

  const send = async (text: string) => {
    const request = text.trim();
    if (!request || busy) return;
    setInput('');
    const userMsg: ChatMessage = { id: uid('m'), role: 'user', text: request };
    const earlier = messages.slice(-8);
    setMessages((list) => [...list, userMsg]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await ask(request, earlier, ctrl.signal);
    } catch (error) {
      setMessages((list) => {
        const last = list[list.length - 1];
        const err: ChatMessage = { id: uid('m'), role: 'error', text: describeAIError(error) };
        return last?.role === 'assistant' && last.status === 'pending' ? [...list.slice(0, -1), err] : [...list, err];
      });
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
              label={snapshot ? (props.snapshotLabel ?? t('A snapshot of the canvas is sent with your request')) : t('No snapshot is sent')}
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
  const [showResults, setShowResults] = useState(false);
  const autoApply = useAISettings((s) => s.autoApply);
  if (message.role === 'user') return <div className="ai-msg user">{message.text}</div>;
  if (message.role === 'error') return <div className="ai-msg error selectable" style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>;
  const toggle = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12 } as const;
  return (
    <div className="ai-msg">
      {message.status === 'pending' && !message.text ? (
        <div className="row muted">
          <Spinner size={14} /> {t('Thinking…')}
        </div>
      ) : (
        <Markdown text={message.text} />
      )}
      {message.status === 'looked' && (
        <div className="row faint" style={{ fontSize: 12, marginTop: 6 }}>
          <Eye size={12} /> {t('The AI looked closer at {count} moment(s)', { count: message.actions?.reduce((n, a) => n + (Array.isArray(a.times) ? a.times.length : 1), 0) ?? 0 })}
        </div>
      )}
      {!!message.actions?.length && message.status !== 'looked' && (
        <div className="col" style={{ gap: 6, marginTop: 8 }}>
          <button type="button" className="row faint" style={toggle} onClick={() => setShowDetails((s) => !s)}>
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('{count} edit step(s)', { count: message.actions.length })}
          </button>
          {showDetails && <pre className="code-block" style={{ maxHeight: 220, overflow: 'auto', margin: 0 }}>{JSON.stringify(message.actions, null, 2)}</pre>}
          {(message.status === 'ready' || message.status === 'applying') && (
            <>
              <button type="button" className="btn primary sm" onClick={onApply} disabled={message.status === 'applying'}>
                {message.status === 'applying' ? <Spinner size={12} /> : <Play size={12} />} {t('Apply')}
              </button>
              {message.status === 'ready' && (
                <span className="faint" style={{ fontSize: 11 }}>
                  {t('Not applied yet — press Apply to make these changes.')}
                </span>
              )}
              <label className="row faint" style={{ fontSize: 11, gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={autoApply} onChange={(e) => useAISettings.getState().update({ autoApply: e.target.checked })} />
                {t('Apply AI edits automatically')}
              </label>
            </>
          )}
          {message.status === 'applied' && (
            <span className={`badge ${message.partial ? 'warn' : 'ok'}`} style={{ whiteSpace: 'normal', alignSelf: 'flex-start' }}>
              {message.partial ? <TriangleAlert size={11} style={{ flex: '0 0 auto' }} /> : <Check size={11} style={{ flex: '0 0 auto' }} />} {message.result || t('Applied')}
            </span>
          )}
          {message.status === 'failed' && (
            <span className="badge err" style={{ whiteSpace: 'normal', alignSelf: 'flex-start' }}>
              {message.result || t('Could not apply')}
            </span>
          )}
          {message.details && (message.status === 'applied' || message.status === 'failed') && (
            <>
              <button type="button" className="row faint" style={toggle} onClick={() => setShowResults((s) => !s)}>
                {showResults ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('What happened to each step')}
              </button>
              {showResults && <pre className="code-block selectable" style={{ maxHeight: 220, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>{message.details}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
