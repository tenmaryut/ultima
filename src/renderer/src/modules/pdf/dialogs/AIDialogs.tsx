/**
 * AI dialogs: translate a page (side by side), extract key data (JSON → CSV), fill a
 * form from a free-text description (values reviewed before they are applied).
 */
import { useRef, useState } from 'react';
import { ClipboardList, Copy, Download, Languages, Sparkles, Square, Table2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { describeAIError } from '../../../core/ai/client';
import { useAppStore } from '../../../core/store';
import { fileBaseName } from '../../../core/utils/format';
import { Button, Field, Modal, NumberField, Select, Spinner, TextArea, TextInput, toast } from '../../../components/ui';
import { useDoc } from '../context';
import { suggestedPdfName } from '../docActions';
import { engine } from '../engine';
import { documentText } from '../find';
import { usePdfUi } from '../store';
import { toCsv } from '../textsearch';
import type { FieldValue } from '../types';
import { extractKeyData, suggestFormValues, translateText, type ExtractedData, type FormSuggestion } from '../ai/aiTools';
import { FieldInput, useVisibleFields } from '../panels/FormsPanel';
import { saveText } from './PageDialogs';

function useAbort() {
  const ref = useRef<AbortController | null>(null);
  return {
    start: () => {
      ref.current?.abort();
      ref.current = new AbortController();
      return ref.current;
    },
    stop: () => ref.current?.abort(),
  };
}

export function TranslateDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const history = useDoc();
  const pages = history.present.pages;
  const appLang = useAppStore((s) => s.language);
  const [page, setPage] = useState(usePdfUi.getState().currentPage + 1);
  const [target, setTarget] = useState(appLang === 'id' ? 'Indonesian' : 'English');
  const [custom, setCustom] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useAbort();
  const language = target === 'other' ? custom.trim() : target;

  const run = async () => {
    const entry = pages[page - 1];
    if (!entry || !language) return;
    const ctrl = abort.start();
    setBusy(true);
    setResult('');
    try {
      const text = (await engine.pageText(entry.src, entry.index)).trim();
      setSource(text);
      const out = await translateText(text, language, { signal: ctrl.signal, onText: setResult });
      setResult(out);
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Could not translate'), describeAIError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('Translate page')}
      wide
      width={1080}
      onClose={() => {
        abort.stop();
        onClose();
      }}
      footer={
        <>
          {result && (
            <>
              <Button icon={Copy} onClick={() => void navigator.clipboard?.writeText(result).then(() => toast.success(t('Copied')))}>
                {t('Copy')}
              </Button>
              <Button icon={Download} onClick={() => void saveText(result, `${fileBaseName(suggestedPdfName())}-p${page}-${language}.txt`)}>
                {t('Save as TXT')}
              </Button>
            </>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>{t('Close')}</Button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Field label={t('Page')} inline>
          <NumberField value={page} min={1} max={pages.length} step={1} onChange={(v) => setPage(Math.round(v))} style={{ width: 80 }} />
        </Field>
        <Field label={t('Translate to')} inline>
          <Select
            small
            value={target}
            onChange={setTarget}
            options={[
              { value: 'English', label: 'English' },
              { value: 'Indonesian', label: 'Bahasa Indonesia' },
              { value: 'other', label: t('Other language…') },
            ]}
          />
        </Field>
        {target === 'other' && <TextInput small style={{ width: 180 }} placeholder={t('e.g. Japanese')} value={custom} onChange={(e) => setCustom(e.target.value)} />}
        <span className="spacer" />
        {busy ? (
          <Button icon={Square} onClick={abort.stop}>
            {t('Stop')}
          </Button>
        ) : (
          <Button variant="primary" icon={Languages} disabled={!language} onClick={() => void run()}>
            {t('Translate')}
          </Button>
        )}
      </div>
      <div className="pd-translate">
        <div>{source === null ? <span className="faint">{t('The original text of the page appears here.')}</span> : source || <span className="faint">{t('This page has no text (it may be a scanned image).')}</span>}</div>
        <div>
          {result || (busy ? <span className="row faint" style={{ gap: 6 }}><Spinner size={12} /> {t('Translating…')}</span> : <span className="faint">{t('The translation appears here.')}</span>)}
        </div>
      </div>
    </Modal>
  );
}

export function ExtractDataDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const history = useDoc();
  const [focus, setFocus] = useState('');
  const [data, setData] = useState<ExtractedData | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useAbort();
  const base = fileBaseName(suggestedPdfName());

  const run = async () => {
    const ctrl = abort.start();
    setBusy(true);
    try {
      const pages = await documentText(history.present.pages);
      const result = await extractKeyData(pages, focus, { signal: ctrl.signal });
      setData(result);
      if (!result.fields.length && !result.tables.length) toast.info(t('The AI found no structured data.'));
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Could not extract data'), describeAIError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('Extract key data')}
      wide
      onClose={() => {
        abort.stop();
        onClose();
      }}
      footer={
        <>
          {data && (
            <Button icon={Download} onClick={() => void saveText(JSON.stringify(data, null, 2), `${base}-data.json`, 'application/json', 'json')}>
              JSON
            </Button>
          )}
          {data && data.fields.length > 0 && (
            <Button icon={Download} onClick={() => void saveText(toCsv([['Field', 'Value', 'Page'], ...data.fields.map((f) => [f.name, f.value, f.page ?? ''])]), `${base}-fields.csv`, 'text/csv', 'csv')}>
              {t('Fields CSV')}
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>{t('Close')}</Button>
        </>
      }
    >
      <div className="row">
        <TextInput placeholder={t('Optional focus, e.g. "line items and totals"')} value={focus} onChange={(e) => setFocus(e.target.value)} />
        {busy ? (
          <Button icon={Square} onClick={abort.stop}>
            {t('Stop')}
          </Button>
        ) : (
          <Button variant="primary" icon={Table2} onClick={() => void run()}>
            {t('Extract')}
          </Button>
        )}
      </div>
      {busy && (
        <div className="row faint" style={{ gap: 6 }}>
          <Spinner size={12} /> {t('The AI is reading the document…')}
        </div>
      )}
      {data && (
        <div className="col" style={{ gap: 12, maxHeight: '55vh', overflow: 'auto' }}>
          {data.title && <strong style={{ color: 'var(--text-0)' }}>{data.title}</strong>}
          {data.fields.length > 0 && (
            <table className="pd-table">
              <thead>
                <tr>
                  <th>{t('Field')}</th>
                  <th>{t('Value')}</th>
                  <th>{t('Page')}</th>
                </tr>
              </thead>
              <tbody>
                {data.fields.map((f, i) => (
                  <tr key={i}>
                    <td>{f.name}</td>
                    <td>{f.value}</td>
                    <td>{f.page ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.tables.map((tb, i) => (
            <div key={i} className="col" style={{ gap: 4 }}>
              <div className="row">
                <strong className="grow" style={{ color: 'var(--text-0)' }}>{tb.title || t('Table {n}', { n: i + 1 })}</strong>
                <Button size="sm" icon={Download} onClick={() => void saveText(toCsv([tb.columns, ...tb.rows]), `${base}-table-${i + 1}.csv`, 'text/csv', 'csv')}>
                  CSV
                </Button>
              </div>
              <table className="pd-table">
                {tb.columns.length > 0 && (
                  <thead>
                    <tr>
                      {tb.columns.map((c, j) => (
                        <th key={j}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {tb.rows.slice(0, 300).map((row, r) => (
                    <tr key={r}>
                      {row.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function FillFormDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const history = useDoc();
  const fields = useVisibleFields();
  const mainSrc = usePdfUi((s) => s.docInfo?.mainSrc);
  const [description, setDescription] = useState('');
  const [suggestions, setSuggestions] = useState<(FormSuggestion & { accept: boolean })[] | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useAbort();

  const run = async () => {
    const ctrl = abort.start();
    setBusy(true);
    try {
      const formPages = [...new Set(fields.flatMap((f) => f.widgets.map((w) => w.srcIndex)))].slice(0, 6);
      const texts = mainSrc ? await Promise.all(formPages.map((i) => engine.pageText(mainSrc, i))) : [];
      const result = await suggestFormValues(fields, history.present.fields, description, texts.join('\n\n'), { signal: ctrl.signal });
      setSuggestions(result.suggestions.map((s) => ({ ...s, accept: true })));
      setNotes(result.notes);
      if (!result.suggestions.length) toast.info(t('The AI could not match the description to any field.'));
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('Could not fill the form'), describeAIError(error));
    } finally {
      setBusy(false);
    }
  };

  const accepted = suggestions?.filter((s) => s.accept) ?? [];
  const apply = () => {
    if (!accepted.length) return;
    const patch: Record<string, FieldValue> = {};
    for (const s of accepted) patch[s.name] = s.value;
    history.set((d) => ({ ...d, fields: { ...d.fields, ...patch } }), { label: 'Fill form with AI' });
    toast.success(t('{count} field(s) filled', { count: accepted.length }));
    onClose();
  };

  return (
    <Modal
      title={t('Fill form with AI')}
      wide
      onClose={() => {
        abort.stop();
        onClose();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          {suggestions && (
            <Button variant="primary" icon={ClipboardList} disabled={!accepted.length} onClick={apply}>
              {t('Apply {count} value(s)', { count: accepted.length })}
            </Button>
          )}
        </>
      }
    >
      {!fields.length ? (
        <div className="faint">{t('This document has no fillable form fields.')}</div>
      ) : (
        <>
          <Field label={t('Describe the person or company (name, address, dates, IDs, choices…)')}>
            <TextArea
              rows={5}
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('e.g. Budi Santoso, born 4 May 1990 in Bandung, lives at Jl. Merdeka 10, Jakarta 10110, email budi@example.com, married, wants the premium plan.')}
            />
          </Field>
          <div className="row">
            {busy ? (
              <Button icon={Square} onClick={abort.stop}>
                {t('Stop')}
              </Button>
            ) : (
              <Button variant="primary" icon={Sparkles} disabled={!description.trim()} onClick={() => void run()}>
                {suggestions ? t('Suggest again') : t('Suggest values')}
              </Button>
            )}
            {busy && (
              <span className="row faint" style={{ gap: 6 }}>
                <Spinner size={12} /> {t('Matching your description to {count} fields…', { count: fields.length })}
              </span>
            )}
          </div>
          {notes && <div className="pd-warning">{notes}</div>}
          {suggestions && suggestions.length > 0 && (
            <div className="col" style={{ gap: 4, maxHeight: '45vh', overflow: 'auto' }}>
              <div className="faint" style={{ fontSize: 12 }}>{t('Review the values. Untick or edit anything before applying.')}</div>
              {suggestions.map((s, i) => {
                const def = fields.find((f) => f.name === s.name);
                if (!def) return null;
                return (
                  <div key={s.name} className="row pd-field-row" style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={s.accept}
                      aria-label={s.name}
                      onChange={(e) => setSuggestions((list) => list && list.map((x, j) => (j === i ? { ...x, accept: e.target.checked } : x)))}
                    />
                    <span className="pd-field-name" style={{ width: 180, flex: '0 0 180px' }} title={s.name}>
                      {s.name}
                    </span>
                    <div className="grow">
                      <FieldInput def={def} value={s.value} onChange={(v) => setSuggestions((list) => list && list.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
