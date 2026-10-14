import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, CornerDownLeft, Search, Send } from 'lucide-react';
import { Button, Field, Modal, Select, TextArea, TextInput } from '../../components/ui';
import { useT } from '../../core/i18n';
import { TEMPLATES, TEMPLATE_CATEGORIES, buildTemplatePrompt, missingFields, searchTemplates, templateDefaults, type PromptTemplate } from './templates';

interface Props {
  language: string;
  initial?: PromptTemplate | null;
  onClose: () => void;
  /** Puts the prompt in the message box (send = true sends it right away). */
  onUse: (prompt: string, template: PromptTemplate, send: boolean) => void;
  canSend: boolean;
}

/** Prompt library browser + fill-in form for one template. */
export function TemplateModal({ language, initial, onClose, onUse, canSend }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<PromptTemplate | null>(initial ?? null);
  const [values, setValues] = useState<Record<string, string>>(() => (initial ? templateDefaults(initial) : {}));
  const list = searchTemplates(TEMPLATES, query, category, t);
  const missing = selected ? missingFields(selected, values) : [];
  const preview = useMemo(() => (selected ? buildTemplatePrompt(selected, values, language) : ''), [selected, values, language]);

  const choose = (tpl: PromptTemplate) => {
    setSelected(tpl);
    setValues(templateDefaults(tpl));
  };

  if (!selected) {
    return (
      <Modal title={t('Prompt library')} onClose={onClose} wide>
        <div className="row as-lib-bar">
          <div className="as-search grow">
            <Search size={13} />
            <TextInput small autoFocus value={query} placeholder={t('Search templates…')} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Select
            small
            value={category}
            onChange={setCategory}
            style={{ width: 160 }}
            options={[{ value: '', label: t('All categories') }, ...TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: t(c) }))]}
          />
        </div>
        <div className="as-template-grid">
          {list.map((tpl) => (
            <button key={tpl.id} type="button" className="as-template" onClick={() => choose(tpl)}>
              <span className="as-template-cat">{t(tpl.category)}</span>
              <strong>{t(tpl.title)}</strong>
              <span className="muted">{t(tpl.description)}</span>
            </button>
          ))}
          {!list.length && <div className="muted">{t('No templates match your search.')}</div>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={
        <span className="row" style={{ gap: 8 }}>
          <BookOpen size={16} /> {t(selected.title)}
        </span>
      }
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" icon={ArrowLeft} onClick={() => setSelected(null)}>
            {t('All templates')}
          </Button>
          <span className="spacer" />
          <Button icon={CornerDownLeft} disabled={missing.length > 0} onClick={() => onUse(preview, selected, false)}>
            {t('Insert into message')}
          </Button>
          <Button variant="primary" icon={Send} disabled={missing.length > 0 || !canSend} onClick={() => onUse(preview, selected, true)}>
            {t('Send now')}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {t(selected.description)}
      </p>
      <div className="as-template-form">
        <div className="col" style={{ gap: 10 }}>
          {selected.fields.map((f) => (
            <Field key={f.key} label={`${t(f.label)}${f.required ? ' *' : ''}`}>
              {f.options ? (
                <Select
                  small
                  value={values[f.key] ?? ''}
                  onChange={(v) => setValues({ ...values, [f.key]: v })}
                  options={f.options.map((o) => ({ value: o, label: t(o) }))}
                />
              ) : f.multiline ? (
                <TextArea rows={4} value={values[f.key] ?? ''} placeholder={f.placeholder ? t(f.placeholder) : undefined} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ) : (
                <TextInput small value={values[f.key] ?? ''} placeholder={f.placeholder ? t(f.placeholder) : undefined} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
        </div>
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <span className="field-label">{t('Prompt preview')}</span>
          <pre className="code-block as-template-preview">{preview}</pre>
          {missing.length > 0 && <span className="faint">{t('Fill in the fields marked with *')}</span>}
        </div>
      </div>
    </Modal>
  );
}
