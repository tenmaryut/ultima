/**
 * Interactive form controls laid over the widgets of a page (text inputs, checkboxes,
 * radio buttons, combo boxes, list boxes). Values live in the undoable document state.
 */
import { memo, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { rectToScreen, type Matrix } from '../geometry';
import { useDoc } from '../context';
import type { FieldDef, FieldValue, FieldWidget } from '../types';
import { usePdfUi } from '../store';

export interface PageWidget {
  def: FieldDef;
  widget: FieldWidget;
  key: string;
}

/** Writes one field value as an undo step. */
export function useSetField() {
  const history = useDoc();
  return (name: string, value: FieldValue) =>
    history.set((d) => ({ ...d, fields: { ...d.fields, [name]: value } }), { label: 'Fill form' });
}

function TextControl({ def, value, style, onCommit }: { def: FieldDef; value: string; style: React.CSSProperties; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const common = {
    className: 'pd-field pd-field-text',
    style,
    value: draft,
    disabled: def.readOnly,
    maxLength: def.maxLength ?? undefined,
    title: def.name,
    'data-field': def.name,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (draft !== value) onCommit(draft);
    },
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  };
  if (def.multiline) {
    return <textarea {...common} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLElement).blur()} />;
  }
  return (
    <input
      {...common}
      type="text"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLElement).blur();
      }}
    />
  );
}

export const FieldLayer = memo(function FieldLayer({ widgets, m, fields }: { widgets: PageWidget[]; m: Matrix; fields: Record<string, FieldValue> }) {
  const setField = useSetField();
  const highlight = usePdfUi((s) => s.showFields);
  const tool = usePdfUi((s) => s.tool);
  const px = Math.hypot(m[0], m[1]) || 1;
  const interactive = tool === 'select';
  return (
    <div className={`pd-field-layer ${highlight ? 'highlight' : ''}`} style={{ pointerEvents: interactive ? undefined : 'none' }}>
      {widgets.map(({ def, widget, key }) => {
        const r = rectToScreen(m, widget.rect);
        const box: React.CSSProperties = { left: r.left, top: r.top, width: r.width, height: r.height };
        const value = fields[def.name];
        const autoSize = def.multiline ? 10 : Math.max(6, Math.min(14, (Math.min(r.width, r.height) / px) * 0.62));
        const fontSize = (def.fontSize || autoSize) * px;
        switch (def.type) {
          case 'text':
            return (
              <TextControl
                key={key}
                def={def}
                value={typeof value === 'string' ? value : ''}
                style={{ ...box, fontSize, padding: `0 ${2 * px}px` }}
                onCommit={(v) => setField(def.name, v)}
              />
            );
          case 'checkbox':
          case 'radio': {
            const on = def.type === 'checkbox' ? value === true : value === widget.option && !!widget.option;
            return (
              <button
                key={key}
                type="button"
                className={`pd-field pd-field-check ${def.type} ${on ? 'on' : ''}`}
                style={box}
                title={def.name}
                data-field={def.name}
                disabled={def.readOnly}
                aria-pressed={on}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  if (def.type === 'checkbox') setField(def.name, !on);
                  else if (!on) setField(def.name, widget.option ?? '');
                }}
              >
                {on && (def.type === 'checkbox' ? <Check size={Math.max(8, Math.min(r.width, r.height) * 0.8)} strokeWidth={3} /> : <span className="pd-radio-dot" />)}
              </button>
            );
          }
          case 'dropdown':
          case 'optionlist': {
            const selected = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
            const options = def.options.includes(selected[0] ?? '') || !selected[0] ? def.options : [selected[0], ...def.options];
            const multiple = def.type === 'optionlist' && def.multiSelect;
            return (
              <select
                key={key}
                className="pd-field pd-field-select"
                style={{ ...box, fontSize }}
                title={def.name}
                data-field={def.name}
                disabled={def.readOnly}
                multiple={multiple}
                size={def.type === 'optionlist' ? Math.max(2, Math.floor(r.height / (fontSize * 1.3))) : undefined}
                value={multiple ? selected : (selected[0] ?? '')}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setField(def.name, def.type === 'optionlist' ? values.filter(Boolean) : (values[0] ?? ''));
                }}
              >
                {def.type === 'dropdown' && <option value="">—</option>}
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          }
          default:
            return <div key={key} className="pd-field pd-field-static" style={box} title={def.name} />;
        }
      })}
    </div>
  );
});
