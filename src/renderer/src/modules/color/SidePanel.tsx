import { useState } from 'react';
import { CircleDot, CopyPlus, LayoutTemplate, Lock, LockOpen, Orbit, PenTool, Save, Sparkles, Square, Tags, Trash2, Type } from 'lucide-react';
import { Button, ColorPicker, Field, Panel, Select, Spinner, TextArea, TextInput } from '../../components/ui';
import { useT } from '../../core/i18n';
import { COLOR_FORMATS, formatColor, formatCss, textOn } from './colormath';
import { addSwatch, baseIndex, removeSwatch, renameSwatch, setBaseIndex, setSwatchHex, toggleLock, type ColorDoc } from './state';
import { parseTags } from './library';
import { CopyButton, ValueInput, copyText } from './widgets';
import type { GeneratedPalette } from './aiFeatures';

export type AITask = 'describe' | 'names' | 'accessible' | null;

interface Props {
  doc: ColorDoc;
  selected: number;
  onSelect: (i: number) => void;
  onChange: (doc: ColorDoc, label: string) => void;
  onPreview: (doc: ColorDoc) => void;
  onCommit: (label: string) => void;
  onSaveToLibrary: () => void;
  onUseIn: (module: 'vector' | 'layout' | 'motion') => void;
  aiTask: AITask;
  onAIDescribe: (description: string, count: number) => void;
  onAINames: () => void;
  onAIAccessible: () => void;
  onAIStop: () => void;
  lastGenerated: GeneratedPalette | null;
  aiMessage: string | null;
}

export function SidePanel(props: Props) {
  const t = useT();
  const { doc, selected } = props;
  const s = doc.swatches[selected] ?? doc.swatches[0];
  const index = doc.swatches.indexOf(s);
  const isBase = index === baseIndex(doc);
  const [description, setDescription] = useState('');
  const [count, setCount] = useState(5);
  const busy = props.aiTask !== null;

  return (
    <div className="co-side">
      <Panel title={t('Selected color')}>
        <div className="co-side-preview" style={{ background: s.hex, color: textOn(s.hex) }}>
          <span className="mono">{formatColor(s.hex, 'hex')}</span>
          {isBase && (
            <span className="co-base-badge">
              <CircleDot size={12} /> {t('Base')}
            </span>
          )}
        </div>
        <div className="row">
          <ColorPicker
            value={s.hex}
            alpha={false}
            size={28}
            label={t('Edit color')}
            onChange={(c) => props.onPreview(setSwatchHex(doc, index, c))}
            onCommit={() => props.onCommit('Edit color')}
          />
          <TextInput
            small
            value={s.name}
            placeholder={t('Color name')}
            aria-label={t('Color name')}
            onChange={(e) => props.onPreview(renameSwatch(doc, index, e.target.value))}
            onBlur={() => props.onCommit('Rename color')}
          />
        </div>
        <div className="co-values">
          {COLOR_FORMATS.map((f) => (
            <div className="co-value-row" key={f.id}>
              <span className="co-value-label">{f.label}</span>
              <ValueInput hex={s.hex} format={f.id} disabled={s.locked} onChange={(hex) => props.onChange(setSwatchHex(doc, index, hex), 'Edit color')} />
              <CopyButton text={() => formatColor(s.hex, f.id)} label={t('Copy {format}', { format: f.label })} />
            </div>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <Button size="sm" icon={CircleDot} disabled={isBase} onClick={() => props.onChange(setBaseIndex(doc, index), 'Set base color')}>
            {t('Set as base')}
          </Button>
          <Button size="sm" icon={s.locked ? LockOpen : Lock} onClick={() => props.onChange(toggleLock(doc, index), s.locked ? 'Unlock color' : 'Lock color')}>
            {s.locked ? t('Unlock') : t('Lock')}
          </Button>
          <Button
            size="sm"
            icon={CopyPlus}
            onClick={() => {
              props.onChange(addSwatch(doc, s.hex, index + 1), 'Duplicate color');
              props.onSelect(index + 1);
            }}
            disabled={doc.swatches.length >= 12}
          >
            {t('Duplicate')}
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={doc.swatches.length <= 1} onClick={() => props.onChange(removeSwatch(doc, index), 'Remove color')} title={t('Remove color')} />
        </div>
        <div className="row faint" style={{ fontSize: 11, flexWrap: 'wrap', gap: 4 }}>
          {t('Copy as CSS:')}
          {(['hex', 'rgb', 'hsl', 'lab'] as const).map((f) => (
            <button key={f} type="button" className="chip" onClick={() => void copyText(formatCss(s.hex, f))}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={t('Palette')}>
        <Field label={t('Name')}>
          <TextInput
            small
            value={doc.name}
            onChange={(e) => props.onPreview({ ...doc, name: e.target.value.slice(0, 120) })}
            onBlur={() => props.onCommit('Rename palette')}
          />
        </Field>
        <Field label={t('Tags')} hint={<Tags size={11} />}>
          <TagInput tags={doc.tags} onChange={(tags) => props.onChange({ ...doc, tags }, 'Edit tags')} />
        </Field>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="primary" icon={Save} onClick={props.onSaveToLibrary}>
            {t('Save to library')}
          </Button>
          <Button size="sm" icon={Type} onClick={() => void copyText(doc.swatches.map((x) => x.hex.toUpperCase()).join(', '))}>
            {t('Copy hex codes')}
          </Button>
        </div>
        <span className="field-label">{t('Use in…')}</span>
        <div className="co-use-in">
          <Button size="sm" icon={PenTool} onClick={() => props.onUseIn('vector')}>
            {t('Vector')}
          </Button>
          <Button size="sm" icon={LayoutTemplate} onClick={() => props.onUseIn('layout')}>
            {t('Layout')}
          </Button>
          <Button size="sm" icon={Orbit} onClick={() => props.onUseIn('motion')}>
            {t('Motion')}
          </Button>
        </div>
      </Panel>

      <Panel title={t('AI palette tools')}>
        <Field label={t('Palette from a description')}>
          <TextArea
            rows={3}
            value={description}
            placeholder={t('e.g. “cozy autumn café”, “fintech brand, trustworthy”, “tropical summer”')}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && description.trim() && !busy) props.onAIDescribe(description.trim(), count);
            }}
          />
        </Field>
        <div className="row">
          <Select<number> small value={count} onChange={setCount} options={[3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: t('{count} colors', { count: n }) }))} style={{ width: 110 }} />
          <span className="spacer" />
          {props.aiTask === 'describe' ? (
            <Button size="sm" icon={Square} onClick={props.onAIStop}>
              {t('Stop')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={Sparkles} disabled={!description.trim() || busy} onClick={() => props.onAIDescribe(description.trim(), count)}>
              {t('Generate')}
            </Button>
          )}
        </div>
        {props.aiTask === 'describe' && (
          <div className="row muted">
            <Spinner size={14} /> {t('Creating your palette…')}
          </div>
        )}
        {props.lastGenerated && props.aiTask !== 'describe' && (
          <div className="co-generated">
            <div className="co-generated-strip">
              {props.lastGenerated.colors.map((c, i) => (
                <span key={i} style={{ background: c.hex }} title={`${c.name} ${c.hex.toUpperCase()}`} />
              ))}
            </div>
            <strong>{props.lastGenerated.name}</strong>
            {props.lastGenerated.rationale && <p className="muted selectable">{props.lastGenerated.rationale}</p>}
          </div>
        )}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" icon={props.aiTask === 'names' ? undefined : Sparkles} disabled={busy} onClick={props.onAINames}>
            {props.aiTask === 'names' && <Spinner size={12} />}
            {t('Name my colors')}
          </Button>
          <Button size="sm" icon={props.aiTask === 'accessible' ? undefined : Sparkles} disabled={busy || doc.swatches.length < 2} onClick={props.onAIAccessible}>
            {props.aiTask === 'accessible' && <Spinner size={12} />}
            {t('Make it accessible')}
          </Button>
          {busy && props.aiTask !== 'describe' && (
            <Button size="sm" variant="ghost" icon={Square} onClick={props.onAIStop}>
              {t('Stop')}
            </Button>
          )}
        </div>
        {props.aiMessage && <div className="co-ai-note selectable">{props.aiMessage}</div>}
      </Panel>
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const commit = () => {
    if (!text.trim()) return;
    onChange(parseTags([...tags, text].join(',')));
    setText('');
  };
  return (
    <div className="co-tags">
      {tags.map((tag) => (
        <button key={tag} type="button" className="chip" title={t('Remove tag')} onClick={() => onChange(tags.filter((x) => x !== tag))}>
          #{tag} ×
        </button>
      ))}
      <input
        className="input sm"
        value={text}
        placeholder={t('Add tag…')}
        aria-label={t('Add tag')}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}
