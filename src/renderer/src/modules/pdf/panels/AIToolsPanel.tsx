/**
 * "AI" tab: Summarize document (map-reduce with progress), Ask this PDF (chat with
 * page citations), and entry points for translate / extract data / fill form.
 */
import { useRef, useState } from 'react';
import { ClipboardList, Copy, Languages, MessageSquare, Send, Sparkles, Square, Table2, Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { describeAIError } from '../../../core/ai/client';
import { useAppStore } from '../../../core/store';
import { Button, IconButton, Panel, ProgressBar, Select, Spinner, TextArea, toast } from '../../../components/ui';
import { useDoc } from '../context';
import { documentText } from '../find';
import { usePdfUi } from '../store';
import { askDocument, summarizeDocument, type AnswerLanguage, type ChatTurn } from '../ai/aiTools';
import { CitedText } from '../ai/CitedText';

export function useAnswerLanguage(): [AnswerLanguage, (l: AnswerLanguage) => void] {
  const appLang = useAppStore((s) => s.language);
  const [lang, setLang] = useState<AnswerLanguage>(appLang === 'id' ? 'id' : 'auto');
  return [lang, setLang];
}

export function LanguageSelect({ value, onChange }: { value: AnswerLanguage; onChange: (v: AnswerLanguage) => void }) {
  const t = useT();
  return (
    <Select
      small
      value={value}
      onChange={onChange}
      options={[
        { value: 'auto', label: t('Language of the document') },
        { value: 'en', label: 'English' },
        { value: 'id', label: 'Bahasa Indonesia' },
      ]}
    />
  );
}

function Summarize() {
  const t = useT();
  const history = useDoc();
  const [lang, setLang] = useAnswerLanguage();
  const [summary, setSummary] = useState('');
  const [state, setState] = useState<{ label: string; progress: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pages = history.present.pages;

  const run = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setSummary('');
    try {
      setState({ label: t('Reading the document…'), progress: 0 });
      const signal = { cancelled: false };
      ctrl.signal.addEventListener('abort', () => (signal.cancelled = true));
      const texts = await documentText(pages, (d, total) => setState({ label: t('Reading the document…'), progress: (d / total) * 0.2 }), signal);
      if (ctrl.signal.aborted) return;
      const result = await summarizeDocument(texts, {
        language: lang,
        signal: ctrl.signal,
        onProgress: (p) =>
          setState({
            label: p.stage === 'map' ? t('Summarizing part {n} of {total}…', { n: p.done + 1, total: p.total }) : t('Writing the summary…'),
            progress: 0.2 + 0.8 * (p.total ? p.done / p.total : 0) * (p.stage === 'map' ? 0.85 : 1),
          }),
        onText: (text) => {
          setSummary(text);
          setState((s) => (s ? { ...s, label: t('Writing the summary…') } : s));
        },
      });
      setSummary(result);
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Could not summarize'), describeAIError(error));
    } finally {
      setState(null);
      abort.current = null;
    }
  };

  return (
    <Panel title={t('Summarize document')}>
      <LanguageSelect value={lang} onChange={setLang} />
      <div className="row">
        {state ? (
          <Button size="sm" icon={Square} onClick={() => abort.current?.abort()}>
            {t('Stop')}
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={Sparkles} onClick={() => void run()}>
            {summary ? t('Summarize again') : t('Summarize')}
          </Button>
        )}
        {summary && !state && (
          <IconButton
            icon={Copy}
            size="sm"
            label={t('Copy')}
            onClick={() => void navigator.clipboard?.writeText(summary).then(() => toast.success(t('Copied')))}
          />
        )}
      </div>
      {state && (
        <div className="col" style={{ gap: 4 }}>
          <span className="faint row" style={{ fontSize: 12, gap: 6 }}>
            <Spinner size={12} /> {state.label}
          </span>
          <ProgressBar value={state.progress} />
        </div>
      )}
      {summary && (
        <div className="pd-ai-out">
          <CitedText text={summary} pageCount={pages.length} />
        </div>
      )}
    </Panel>
  );
}

function AskPdf() {
  const t = useT();
  const history = useDoc();
  const [lang, setLang] = useAnswerLanguage();
  const [turns, setTurns] = useState<(ChatTurn & { pages?: number[] })[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const abort = useRef<AbortController | null>(null);
  const pages = history.present.pages;

  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    const previous = turns;
    setTurns([...previous, { role: 'user', text: question }]);
    setBusy(true);
    setLive('');
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const texts = await documentText(pages);
      const result = await askDocument(texts, question, previous, { language: lang, signal: ctrl.signal, onText: setLive });
      setTurns((list) => [...list, { role: 'assistant', text: result.answer, pages: result.ranked ? result.pagesUsed : undefined }]);
    } catch (error) {
      if (!ctrl.signal.aborted) setTurns((list) => [...list, { role: 'assistant', text: `⚠ ${describeAIError(error)}` }]);
    } finally {
      setBusy(false);
      setLive('');
      abort.current = null;
    }
  };

  return (
    <Panel
      title={t('Ask this PDF')}
      actions={turns.length ? <IconButton icon={Trash2} size="sm" label={t('Clear conversation')} onClick={() => setTurns([])} /> : undefined}
    >
      <LanguageSelect value={lang} onChange={setLang} />
      <div className="pd-chat">
        {!turns.length && <div className="faint" style={{ fontSize: 12 }}>{t('Ask anything about the document. Answers cite the pages they come from — click a citation to jump there.')}</div>}
        {turns.map((m, i) => (
          <div key={i} className={`pd-chat-msg ${m.role === 'user' ? 'user' : ''}`}>
            {m.role === 'user' ? m.text : <CitedText text={m.text} pageCount={pages.length} />}
            {m.pages && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{t('Searched the most relevant pages: {pages}', { pages: m.pages.slice(0, 12).join(', ') })}</div>}
          </div>
        ))}
        {busy && (
          <div className="pd-chat-msg">
            {live ? (
              <CitedText text={live} pageCount={pages.length} />
            ) : (
              <span className="row faint" style={{ gap: 6 }}>
                <Spinner size={12} /> {t('Reading the document…')}
              </span>
            )}
          </div>
        )}
      </div>
      <TextArea
        rows={2}
        value={input}
        placeholder={t('e.g. What is the deadline for payment?')}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {busy ? (
        <Button size="sm" icon={Square} onClick={() => abort.current?.abort()}>
          {t('Stop')}
        </Button>
      ) : (
        <Button size="sm" variant="primary" icon={Send} disabled={!input.trim()} onClick={() => void send()}>
          {t('Ask')}
        </Button>
      )}
    </Panel>
  );
}

export function AIToolsPanel() {
  const t = useT();
  const set = usePdfUi((s) => s.set);
  const hasFields = usePdfUi((s) => !!s.docInfo?.fieldDefs.length);
  return (
    <>
      <Summarize />
      <AskPdf />
      <Panel title={t('More AI tools')}>
        <Button size="sm" icon={Languages} onClick={() => set({ dialog: 'translate' })}>
          {t('Translate page…')}
        </Button>
        <Button size="sm" icon={Table2} onClick={() => set({ dialog: 'extract-data' })}>
          {t('Extract key data…')}
        </Button>
        <Button size="sm" icon={ClipboardList} disabled={!hasFields} onClick={() => set({ dialog: 'fill-ai' })}>
          {t('Fill form with AI…')}
        </Button>
        <div className="faint row" style={{ fontSize: 11.5, gap: 6 }}>
          <MessageSquare size={12} /> {t('The assistant (Ctrl+J) can also rotate, delete, highlight, add text and fill fields for you.')}
        </div>
      </Panel>
    </>
  );
}
