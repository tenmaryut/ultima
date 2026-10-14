/**
 * "Forms" tab: every AcroForm field of the document with an input to fill it, plus
 * highlight / flatten options and "Fill form with AI".
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, ChevronDown, CircleDot, List, RotateCcw, Sparkles, TextCursorInput } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, Panel, TextArea, TextInput, Toggle } from '../../../components/ui';
import { useDoc } from '../context';
import { usePdfUi } from '../store';
import type { FieldDef, FieldValue } from '../types';
import { valuesEqual } from '../forms';

const ICONS = { text: TextCursorInput, checkbox: CheckSquare, radio: CircleDot, dropdown: ChevronDown, optionlist: List, button: CheckSquare, signature: TextCursorInput };

function TextFieldInput({ def, value, onCommit }: { def: FieldDef; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    value: draft,
    disabled: def.readOnly,
    maxLength: def.maxLength ?? undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => draft !== value && onCommit(draft),
  };
  return def.multiline ? <TextArea rows={3} {...props} /> : <TextInput small {...props} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()} />;
}

export function FieldInput({ def, value, onChange }: { def: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const t = useT();
  switch (def.type) {
    case 'text':
      return <TextFieldInput def={def} value={typeof value === 'string' ? value : ''} onCommit={onChange} />;
    case 'checkbox':
      return <Toggle checked={value === true} disabled={def.readOnly} onChange={onChange} label={value === true ? t('Checked') : t('Not checked')} />;
    case 'radio':
    case 'dropdown':
      return (
        <select className="select sm" value={typeof value === 'string' ? value : ''} disabled={def.readOnly} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {[...new Set([...(typeof value === 'string' && value && !def.options.includes(value) ? [value] : []), ...def.options])].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'optionlist': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <select
          className="select sm"
          style={{ height: 'auto' }}
          multiple={def.multiSelect}
          size={Math.min(5, Math.max(2, def.options.length))}
          disabled={def.readOnly}
          value={def.multiSelect ? selected : (selected[0] ?? '')}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <span className="faint" style={{ fontSize: 12 }}>{def.type === 'signature' ? t('Signature field (use the Sign tool)') : t('Button')}</span>;
  }
}

/** Fields whose widgets are on pages that are still in the document. */
export function useVisibleFields(): FieldDef[] {
  const history = useDoc();
  const defs = usePdfUi((s) => s.docInfo?.fieldDefs ?? []);
  const mainSrc = usePdfUi((s) => s.docInfo?.mainSrc);
  const pages = history.present.pages;
  return useMemo(() => {
    const present = new Set(pages.filter((p) => p.src === mainSrc).map((p) => p.index));
    return defs.filter((d) => d.widgets.some((w) => present.has(w.srcIndex)));
  }, [defs, pages, mainSrc]);
}

export function FormsPanel() {
  const t = useT();
  const history = useDoc();
  const fields = useVisibleFields();
  const values = history.present.fields;
  const initial = usePdfUi((s) => s.docInfo?.initialFields ?? {});
  const mainSrc = usePdfUi((s) => s.docInfo?.mainSrc);
  const showFields = usePdfUi((s) => s.showFields);
  const flatten = usePdfUi((s) => s.flattenForms);
  const set = usePdfUi((s) => s.set);
  const [filter, setFilter] = useState('');
  const changed = fields.filter((f) => !valuesEqual(values[f.name], initial[f.name])).length;
  const shown = filter ? fields.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase())) : fields;

  if (!fields.length) {
    return (
      <Panel title={t('Form')}>
        <div className="faint" style={{ fontSize: 12 }}>
          {t('This document has no fillable form fields. Use the Add text tool to type on any page.')}
        </div>
      </Panel>
    );
  }

  const goTo = (def: FieldDef) => {
    const w = def.widgets[0];
    const index = history.present.pages.findIndex((p) => p.src === mainSrc && p.index === w?.srcIndex);
    if (index >= 0) {
      set({ mode: 'view', tool: 'select' });
      usePdfUi.getState().goToPage(index);
      setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${CSS.escape(def.name)}"]`)?.focus(), 350);
    }
  };

  return (
    <>
      <Panel title={t('Form ({count} fields)', { count: fields.length })}>
        <Toggle checked={showFields} onChange={(v) => set({ showFields: v })} label={t('Highlight fields on the page')} />
        <Toggle checked={flatten} onChange={(v) => set({ flattenForms: v })} label={t('Flatten form when saving')} />
        <div className="faint" style={{ fontSize: 11.5 }}>
          {flatten ? t('Filled values become part of the page and can no longer be edited.') : t('The saved PDF keeps its fillable fields.')}
        </div>
        <div className="row">
          <Button size="sm" variant="primary" icon={Sparkles} onClick={() => set({ dialog: 'fill-ai' })}>
            {t('Fill with AI…')}
          </Button>
          <Button
            size="sm"
            icon={RotateCcw}
            disabled={!changed}
            onClick={() => history.set((d) => ({ ...d, fields: { ...initial } }), { label: 'Reset form' })}
          >
            {t('Reset')}
          </Button>
        </div>
      </Panel>
      <Panel title={t('Fields')}>
        {fields.length > 8 && <TextInput small placeholder={t('Filter fields…')} value={filter} onChange={(e) => setFilter(e.target.value)} />}
        {shown.map((def) => {
          const Icon = ICONS[def.type] ?? TextCursorInput;
          return (
            <div key={def.name} className="pd-field-row">
              <button type="button" className="pd-field-name" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} title={t('Show on page')} onClick={() => goTo(def)}>
                <Icon size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.name}</span>
                {def.required && <span style={{ color: 'var(--danger)' }}>*</span>}
              </button>
              <FieldInput def={def} value={values[def.name]} onChange={(v) => history.set((d) => ({ ...d, fields: { ...d.fields, [def.name]: v } }), { label: 'Fill form' })} />
            </div>
          );
        })}
      </Panel>
    </>
  );
}
