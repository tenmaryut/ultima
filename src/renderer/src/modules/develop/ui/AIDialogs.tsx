import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { describeAIError, resolveProvider } from '../../../core/ai/client';
import { getProviderInfo } from '@shared/providers-catalog';
import { useT } from '../../../core/i18n';
import { useAppStore } from '../../../core/store';
import { Button, Modal, ProgressBar, Spinner, TextArea, Toggle, toast } from '../../../components/ui';
import { aiAutoEdit, describeLook, suggestRatings, type BatchProgress, type CullResult } from '../aiFeatures';
import { usePresetStore } from '../presets';
import { getPhoto, selectedIds, setFlag, setRating, useDevelop } from '../store';
import { displayName } from '../types';
import { FlagIcon, Stars } from './common';

function providerName(): string | null {
  const id = resolveProvider();
  return id ? (getProviderInfo(id)?.name ?? id) : null;
}

function NoProvider({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="col" style={{ gap: 10 }}>
      <span>{t('Connect an AI to get started')}</span>
      <span className="muted">
        {t('Ultima uses the AI subscriptions you already have (Claude Code, Codex, Antigravity CLI, GitHub Copilot…) or free local models (Ollama, LM Studio). No paid API keys needed.')}
      </span>
      <Button
        variant="primary"
        onClick={() => {
          onClose();
          useAppStore.getState().setActiveModule('settings');
        }}
      >
        {t('Open AI settings')}
      </Button>
    </div>
  );
}

/* -------------------------------- Auto edit -------------------------------- */

export function AIAutoEditDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const t = useT();
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [result, setResult] = useState<{ done: number; failed: { name: string; error: string }[] } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const provider = providerName();
  const start = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ done: 0, total: ids.length, current: '' });
    try {
      const r = await aiAutoEdit(ids, setProgress, ctrl.signal);
      setResult(r);
      if (r.done) toast.success(t('AI edited {count} photo(s)', { count: r.done }));
    } catch (error) {
      toast.error(t('AI Auto Edit failed'), describeAIError(error));
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };
  return (
    <Modal
      title={t('AI Auto Edit')}
      onClose={() => (progress ? abort.current?.abort() : onClose())}
      footer={
        progress ? (
          <Button variant="danger" onClick={() => abort.current?.abort()}>
            {t('Stop')}
          </Button>
        ) : result ? (
          <Button variant="primary" onClick={onClose}>
            {t('Close')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" icon={Sparkles} disabled={!provider || !ids.length} onClick={() => void start()}>
              {t('Edit {count} photo(s)', { count: ids.length })}
            </Button>
          </>
        )
      }
    >
      {!provider ? (
        <NoProvider onClose={onClose} />
      ) : progress ? (
        <div className="col" style={{ gap: 10 }}>
          <div className="row">
            <Spinner size={14} />
            <span className="muted">{t('Editing {current} ({n}/{total})…', { current: progress.current, n: Math.min(progress.done + 1, progress.total), total: progress.total })}</span>
          </div>
          <ProgressBar value={progress.total ? progress.done / progress.total : 0} />
        </div>
      ) : result ? (
        <div className="col" style={{ gap: 8 }}>
          <span>{t('{done} of {total} photo(s) edited. Each photo has its own undo step.', { done: result.done, total: ids.length })}</span>
          {result.failed.map((f) => (
            <span key={f.name} className="dv-hint" style={{ color: 'var(--danger)' }}>
              {f.name}: {f.error}
            </span>
          ))}
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <span>
            {t('{provider} looks at each photo and its histogram and picks exposure, white balance, tone, presence and color settings.', { provider })}
          </span>
          <span className="dv-hint">{t('Crops are kept. Every photo gets one undo step, so you can step back per photo.')}</span>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Describe a look ------------------------------ */

const LOOK_IDEAS = ['moody autumn film', 'clean bright wedding', 'cinematic teal night', 'faded 70s Kodachrome', 'crisp high-contrast black & white', 'soft pastel spring'];

export function DescribeLookDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; settings: object } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const provider = providerName();
  const count = selectedIds().length;
  const run = async (desc = text) => {
    if (!desc.trim()) return;
    setText(desc);
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    try {
      const activeId = useDevelop.getState().activeId;
      const ids = all ? selectedIds() : activeId ? [activeId] : [];
      const r = await describeLook(desc, ids, ctrl.signal);
      setResult({ message: r.message || t('Look applied.'), settings: r.settings });
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Could not create the look'), describeAIError(error));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  return (
    <Modal
      title={t('Describe a look')}
      onClose={() => (busy ? abort.current?.abort() : onClose())}
      footer={
        busy ? (
          <Button variant="danger" onClick={() => abort.current?.abort()}>
            {t('Stop')}
          </Button>
        ) : (
          <>
            {result && (
              <Button
                onClick={() => {
                  usePresetStore.getState().add(text.trim().slice(0, 60) || t('AI look'), result.settings);
                  toast.success(t('Saved as a user preset'));
                }}
              >
                {t('Save as preset')}
              </Button>
            )}
            <span className="spacer" />
            <Button onClick={onClose}>{result ? t('Close') : t('Cancel')}</Button>
            {provider && (
              <Button variant="primary" icon={Sparkles} disabled={!text.trim()} onClick={() => void run()}>
                {result ? t('Try again') : t('Create look')}
              </Button>
            )}
          </>
        )
      }
    >
      {!provider ? (
        <NoProvider onClose={onClose} />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <TextArea
            rows={3}
            value={text}
            placeholder={t('e.g. moody autumn film with warm highlights and faded blacks')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void run();
              }
            }}
            autoFocus
          />
          <div className="ai-suggestions">
            {LOOK_IDEAS.map((idea) => (
              <button key={idea} type="button" className="chip" disabled={busy} onClick={() => void run(t(idea))}>
                {t(idea)}
              </button>
            ))}
          </div>
          {count > 1 && <Toggle checked={all} onChange={setAll} label={t('Apply to all {count} selected photos', { count })} />}
          {busy && (
            <div className="row muted">
              <Spinner size={14} /> {t('Thinking…')}
            </div>
          )}
          {result && !busy && <div className="card" style={{ padding: 10 }}>{result.message}</div>}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Rating suggestions ------------------------------ */

export function CullDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const t = useT();
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [results, setResults] = useState<CullResult[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const abort = useRef<AbortController | null>(null);
  const provider = providerName();
  const start = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ done: 0, total: ids.length, current: '' });
    try {
      const r = await suggestRatings(ids, setProgress, ctrl.signal);
      setResults(r);
      setChecked(new Set(r.map((x) => x.id)));
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Rating suggestions failed'), describeAIError(error));
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };
  const apply = () => {
    for (const r of results ?? []) {
      if (!checked.has(r.id)) continue;
      setRating([r.id], r.rating);
      setFlag([r.id], r.flag);
    }
    toast.success(t('Applied {count} rating(s)', { count: checked.size }));
    onClose();
  };
  return (
    <Modal
      title={t('AI rating suggestions')}
      wide={Boolean(results)}
      onClose={() => (progress ? abort.current?.abort() : onClose())}
      footer={
        progress ? (
          <Button variant="danger" onClick={() => abort.current?.abort()}>
            {t('Stop')}
          </Button>
        ) : results ? (
          <>
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" disabled={!checked.size} onClick={apply}>
              {t('Apply {count}', { count: checked.size })}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button variant="primary" disabled={!provider || !ids.length} onClick={() => void start()}>
              {t('Rate {count} photo(s)', { count: Math.min(60, ids.length) })}
            </Button>
          </>
        )
      }
    >
      {!provider ? (
        <NoProvider onClose={onClose} />
      ) : progress ? (
        <div className="col" style={{ gap: 10 }}>
          <span className="muted">{t('Looking at {current}…', { current: progress.current })}</span>
          <ProgressBar value={progress.total ? progress.done / progress.total : 0} />
        </div>
      ) : results ? (
        <div className="col" style={{ gap: 0, maxHeight: '60vh', overflowY: 'auto' }}>
          {!results.length && <span className="muted">{t('The AI returned no ratings.')}</span>}
          {results.map((r) => {
            const p = getPhoto(r.id);
            if (!p) return null;
            return (
              <label key={r.id} className="dv-cull-row">
                <input
                  type="checkbox"
                  checked={checked.has(r.id)}
                  onChange={() =>
                    setChecked((s) => {
                      const n = new Set(s);
                      if (n.has(r.id)) n.delete(r.id);
                      else n.add(r.id);
                      return n;
                    })
                  }
                />
                {p.devThumb ?? p.thumb ? <img src={p.devThumb ?? p.thumb} alt="" /> : <span />}
                <span className="col" style={{ gap: 2, minWidth: 0 }}>
                  <strong style={{ color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName(p)}</strong>
                  <span className="dv-hint">{r.reason}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <FlagIcon flag={r.flag} />
                  <Stars value={r.rating} />
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <span>{t('{provider} rates the selected photos (focus, exposure, composition, moment) and suggests picks and rejects. You review the suggestions before anything changes.', { provider })}</span>
          {ids.length > 60 && <span className="dv-hint">{t('Only the first 60 selected photos are rated per run.')}</span>}
        </div>
      )}
    </Modal>
  );
}
