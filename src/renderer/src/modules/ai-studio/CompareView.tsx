import { useEffect, useRef, useState } from 'react';
import { Columns2, Copy, MessageSquarePlus, Send, Square } from 'lucide-react';
import type { ProviderId } from '@shared/ai-types';
import { Markdown } from '../../components/ai/Markdown';
import { ProviderPicker } from '../../components/ai/ProviderPicker';
import { Button, IconButton, Spinner } from '../../components/ui';
import { describeAIError, runAI, usableProviders } from '../../core/ai/client';
import { useAISettings } from '../../core/ai/settings';
import { uid } from '../../core/utils/id';
import { useT } from '../../core/i18n';
import { personaLabel, systemPromptOf } from './personas';
import { titleFrom } from './detect';
import { useStudio } from './store';
import { ModelInput } from './ModelInput';
import { copyToClipboard, providerName } from './MessageItem';
import type { Persona } from './types';

interface Side {
  providerId: ProviderId | null;
  model: string;
  text: string;
  status: 'idle' | 'streaming' | 'done' | 'error' | 'stopped';
  error?: string;
  durationMs?: number;
  usedProvider?: ProviderId;
}

const emptySide = (providerId: ProviderId | null): Side => ({ providerId, model: '', text: '', status: 'idle' });

/** Same prompt, two AIs side by side. */
export function CompareView({ persona, onOpenChat }: { persona: Persona; onOpenChat: () => void }) {
  const t = useT();
  const statuses = useAISettings((s) => s.statuses);
  const enabled = useAISettings((s) => s.enabled);
  const [prompt, setPrompt] = useState('');
  const [sides, setSides] = useState<Side[]>(() => {
    const usable = usableProviders();
    return [emptySide(usable[0] ?? null), emptySide(usable[1] ?? usable[0] ?? null)];
  });
  const controllers = useRef<AbortController[]>([]);
  const usable = usableProviders();
  const running = sides.some((s) => s.status === 'streaming');

  // pick providers once connections are detected
  useEffect(() => {
    const list = usableProviders();
    setSides((prev) =>
      prev.map((s, i) => (s.providerId && list.includes(s.providerId) ? s : { ...s, providerId: list[i] ?? list[0] ?? null })),
    );
  }, [statuses, enabled]);

  const patch = (i: number, p: Partial<Side>) => setSides((prev) => prev.map((s, k) => (k === i ? { ...s, ...p } : s)));

  const run = () => {
    const text = prompt.trim();
    if (!text || running) return;
    controllers.current = sides.map(() => new AbortController());
    sides.forEach((side, i) => {
      patch(i, { text: '', status: 'streaming', error: undefined, durationMs: undefined, usedProvider: side.providerId ?? undefined });
      const started = performance.now();
      void runAI({
        prompt: text,
        system: systemPromptOf(persona),
        providerId: side.providerId ?? undefined,
        model: side.model || undefined,
        signal: controllers.current[i].signal,
        onText: (partial) => patch(i, { text: partial }),
      })
        .then((r) => patch(i, { text: r.text, status: 'done', usedProvider: r.providerId, durationMs: Math.round(performance.now() - started) }))
        .catch((error) => {
          if (controllers.current[i]?.signal.aborted) patch(i, { status: 'stopped' });
          else patch(i, { status: 'error', error: describeAIError(error) });
        });
    });
  };

  const continueInChat = (side: Side) => {
    const now = Date.now();
    useStudio.getState().newConversation({
      title: titleFrom(prompt) || t('Comparison'),
      providerId: side.usedProvider ?? side.providerId,
      model: side.model,
      personaId: persona.id,
      messages: [
        { id: uid('m'), role: 'user', text: prompt.trim(), createdAt: now },
        { id: uid('m'), role: 'assistant', text: side.text, createdAt: now, providerId: side.usedProvider, model: side.model || undefined, durationMs: side.durationMs, status: 'done' },
      ],
    });
    onOpenChat();
  };

  return (
    <div className="as-compare">
      {usable.length < 2 && (
        <div className="as-compare-note muted">
          <Columns2 size={15} />
          {usable.length
            ? t('Only one AI is connected. You can still compare two models of it, or connect another AI in Settings.')
            : t('Connect at least one AI in Settings to compare answers.')}
        </div>
      )}
      <div className="as-compare-cols">
        {sides.map((side, i) => (
          <section key={i} className="as-compare-col">
            <header className="as-compare-head">
              <strong>{i === 0 ? 'A' : 'B'}</strong>
              <ProviderPicker value={side.providerId} onChange={(id) => patch(i, { providerId: id })} />
              <ModelInput providerId={side.providerId} value={side.model} onChange={(model) => patch(i, { model })} width={130} />
            </header>
            <div className="as-compare-body">
              {side.status === 'idle' && <div className="faint as-compare-empty">{t('The answer will appear here.')}</div>}
              {side.status === 'streaming' && !side.text && (
                <div className="row muted">
                  <Spinner size={14} /> {t('Thinking…')}
                </div>
              )}
              {side.text && (
                <div className="as-md selectable">
                  <Markdown text={side.text} />
                </div>
              )}
              {side.status === 'error' && <div className="as-error-box selectable">{side.error}</div>}
              {side.status === 'stopped' && <span className="badge warn">{t('Stopped')}</span>}
            </div>
            <footer className="as-compare-foot">
              <span className="faint">
                {side.status === 'done' && side.durationMs !== undefined
                  ? `${providerName(side.usedProvider)} · ${(side.durationMs / 1000).toFixed(1)} s · ${t('{count} characters', { count: side.text.length })}`
                  : ''}
              </span>
              <span className="spacer" />
              <IconButton icon={Copy} size="sm" label={t('Copy')} disabled={!side.text} onClick={() => void copyToClipboard(side.text, t('Copied to clipboard'))} />
              <Button size="sm" icon={MessageSquarePlus} disabled={side.status !== 'done'} onClick={() => continueInChat(side)}>
                {t('Continue in chat')}
              </Button>
            </footer>
          </section>
        ))}
      </div>
      <div className="as-composer as-compare-composer">
        <textarea
          className="textarea as-input"
          rows={3}
          value={prompt}
          placeholder={t('Ask both AIs the same thing…')}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              run();
            }
          }}
          aria-label={t('Prompt')}
        />
        <div className="as-composer-bar">
          <span className="faint as-hint">
            {t('Persona')}: {personaLabel(persona, persona.name, t)} · {t('Enter to send · Shift+Enter for a new line')}
          </span>
          <span className="spacer" />
          {running ? (
            <Button size="sm" icon={Square} onClick={() => controllers.current.forEach((c) => c.abort())}>
              {t('Stop')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={Send} disabled={!prompt.trim() || !usable.length} onClick={run}>
              {t('Compare')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
