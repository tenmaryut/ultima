import { useEffect, useRef, useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { describeAIError, runAIJson } from '../../core/ai/client';
import { stripHtml } from '../../core/ai/sanitize';
import { useT } from '../../core/i18n';
import { Button, Modal, Spinner, TextArea, Toggle, toast } from '../../components/ui';
import { sceneToActions } from './ai-actions';
import { SCENE_SYSTEM, scenePrompt, SUGGEST_SYSTEM, suggestPrompt } from './ai-prompts';
import type { Layer, MotionDoc } from './types';

type Obj = Record<string, unknown>;

export interface ApplyOptions {
  /** Remove every existing layer first. */
  replace?: boolean;
  label: string;
}

/* --------------------------- Animate from description -------------------------- */

const EXAMPLES = [
  'Intro: the title SUMMER SALE drops in with a bounce, the subtitle "Up to 50% off" fades in below, and confetti circles burst around it',
  'Lower third for "Alex Morgan — Product Designer" sliding in from the left with an accent bar',
  'Logo reveal: a circle draws on, then the word ULTIMA pops in with a glow',
  'Countdown 3, 2, 1, GO! with each number scaling in and out',
];

export function AnimateDialog({ doc, onApply, onClose }: { doc: MotionDoc; onApply: (actions: Obj[], options: ApplyOptions) => string; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [keep, setKeep] = useState(doc.layers.length > 0);
  const [allowComp, setAllowComp] = useState(doc.layers.length === 0);
  const [busy, setBusy] = useState(false);
  const [chars, setChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setChars(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { data } = await runAIJson<Obj>({
        system: SCENE_SYSTEM,
        prompt: scenePrompt(text, doc, keep),
        signal: ctrl.signal,
        onText: (full) => setChars(full.length),
      });
      let actions = sceneToActions(data);
      if (!allowComp) actions = actions.filter((a) => a.type !== 'setComposition');
      if (!actions.some((a) => a.type === 'addLayer')) throw new Error(t('The AI did not return any layers. Try describing the scene in more detail.'));
      const summary = onApply(actions, { replace: !keep, label: 'AI animation' });
      const message = typeof data.message === 'string' ? stripHtml(data.message).slice(0, 300) : '';
      toast.success(t('Animation created'), [message, summary].filter(Boolean).join('\n'));
      onClose();
    } catch (e) {
      if (!ctrl.signal.aborted) setError(describeAIError(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <Modal
      title={
        <span className="row" style={{ gap: 8 }}>
          <Wand2 size={16} /> {t('Animate from description')}
        </span>
      }
      wide
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      footer={
        busy ? (
          <Button onClick={() => abortRef.current?.abort()}>{t('Stop')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" icon={Sparkles} disabled={!text.trim()} onClick={() => void generate()}>
              {t('Generate animation')}
            </Button>
          </>
        )
      }
    >
      <div className="muted" style={{ fontSize: 12 }}>
        {t('Describe the scene: what appears, how it moves and when. The AI creates the layers, keyframes and easing — everything stays editable and one Undo removes it.')}
      </div>
      <TextArea
        rows={5}
        value={text}
        disabled={busy}
        autoFocus
        placeholder={t('e.g. intro: title SUMMER SALE drops in with a bounce, subtitle fades in, confetti circles burst')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate();
        }}
      />
      <div className="ai-suggestions">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" disabled={busy} onClick={() => setText(t(ex))}>
            {t(ex).slice(0, 48)}…
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <Toggle checked={keep} onChange={setKeep} label={t('Keep existing layers')} disabled={busy} />
        <Toggle checked={allowComp} onChange={setAllowComp} label={t('Let the AI change size and length')} disabled={busy} />
      </div>
      {busy && (
        <div className="row muted">
          <Spinner size={14} /> {chars ? t('Writing the animation… ({n} characters)', { n: chars }) : t('Thinking…')}
        </div>
      )}
      {error && <div className="mo-warn selectable" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
    </Modal>
  );
}

/* ------------------------------ Suggest easing ------------------------------ */

export function SuggestDialog({ doc, layer, onApply, onClose }: { doc: MotionDoc; layer: Layer; onApply: (actions: Obj[], options: ApplyOptions) => string; onClose: () => void }) {
  const t = useT();
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; message?: string; actions?: Obj[]; chars?: number }>({ status: 'loading' });
  const abortRef = useRef<AbortController | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    void (async () => {
      try {
        const { data } = await runAIJson<Obj>({
          system: SUGGEST_SYSTEM,
          prompt: suggestPrompt(doc, layer),
          signal: ctrl.signal,
          onText: (full) => setState((s) => (s.status === 'loading' ? { ...s, chars: full.length } : s)),
        });
        const raw = Array.isArray(data.actions) ? (data.actions as unknown[]) : [];
        // Only easing / retiming of THIS layer is accepted.
        const actions = raw
          .filter((a): a is Obj => Boolean(a) && typeof a === 'object')
          .filter((a) => a.type === 'setEasing' || a.type === 'addKeyframes')
          .map((a) => ({ ...a, layerId: layer.id }));
        const message = typeof data.message === 'string' ? stripHtml(data.message).slice(0, 2000) : '';
        setState({ status: 'ready', message, actions });
      } catch (e) {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: describeAIError(e) });
      }
    })();
    return () => ctrl.abort();
  }, [doc, layer]);

  return (
    <Modal
      title={
        <span className="row" style={{ gap: 8 }}>
          <Sparkles size={16} /> {t('Suggest easing & timing')} — {layer.name}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{state.status === 'ready' && state.actions?.length ? t('Cancel') : t('Close')}</Button>
          {state.status === 'ready' && !!state.actions?.length && (
            <Button
              variant="primary"
              onClick={() => {
                onApply(state.actions!, { label: 'AI timing suggestion' });
                onClose();
              }}
            >
              {t('Apply {n} change(s)', { n: state.actions.length })}
            </Button>
          )}
        </>
      }
    >
      {state.status === 'loading' && (
        <div className="row muted">
          <Spinner size={14} /> {state.chars ? t('Reviewing the animation… ({n} characters)', { n: state.chars }) : t('Thinking…')}
        </div>
      )}
      {state.status === 'error' && <div className="mo-warn selectable" style={{ whiteSpace: 'pre-wrap' }}>{state.message}</div>}
      {state.status === 'ready' && (
        <>
          {state.message && <div className="selectable" style={{ whiteSpace: 'pre-wrap' }}>{state.message}</div>}
          {state.actions?.length ? (
            <ul className="mo-suggest-list">
              {state.actions.map((a, i) => (
                <li key={i}>
                  {a.type === 'setEasing'
                    ? t('Easing of {prop} → {easing}', { prop: String(a.property ?? 'all'), easing: String(typeof a.easing === 'string' ? a.easing : 'custom') })
                    : t('Retime {prop} ({n} keyframes)', { prop: String(a.property), n: Array.isArray(a.keyframes) ? a.keyframes.length : 0 })}
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted">{t('No changes suggested — the timing already looks good.')}</div>
          )}
        </>
      )}
    </Modal>
  );
}
