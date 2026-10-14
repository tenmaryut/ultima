/**
 * "Edit" tab: tool options, properties of the selected objects, redaction controls and
 * the list of all annotations in the document.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpToLine, Bold, Copy, EyeOff, ImagePlus, Italic, Signature, Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, ColorPicker, Field, IconButton, NumberField, Panel, Segmented, Select, Slider, TextInput, Toggle, toast } from '../../../components/ui';
import { annotLabel, stampSize } from '../annots';
import { useDoc } from '../context';
import { bringToFront, deleteSelection, duplicateSelection, updateSelected } from '../editActions';
import { contentFrame, rectFromFrame } from '../geometry';
import { applyRedactions, markTextForRedaction } from '../redact';
import { usePdfUi } from '../store';
import { selectTool, toolDef } from '../tools';
import { unsupportedCharacters, type FontFamily } from '../textlayout';
import { BUILTIN_STAMPS, stampText, type Annot, type StampAnnot, type ToolId, type ToolStyle } from '../types';

const FONTS: { value: FontFamily; label: string }[] = [
  { value: 'helvetica', label: 'Helvetica (Sans)' },
  { value: 'times', label: 'Times (Serif)' },
  { value: 'courier', label: 'Courier (Mono)' },
];

const dateFormats = (): { value: ToolStyle['dateFormat']; label: string }[] => [
  { value: 'local', label: new Date().toLocaleDateString() },
  { value: 'iso', label: new Date().toISOString().slice(0, 10) },
  { value: 'long', label: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) },
];

function ColorRow({ label, value, onChange, onCommit, alpha = false }: { label: string; value: string; onChange: (c: string) => void; onCommit?: (c: string) => void; alpha?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="field-label">{label}</span>
      <ColorPicker value={value} onChange={onChange} onCommit={onCommit} alpha={alpha} label={label} />
    </div>
  );
}

function getAuthor(): string {
  try {
    return localStorage.getItem('ultima-pdf-author') || '';
  } catch {
    return '';
  }
}

/** Options for the active tool (style of new objects). */
function ToolOptions({ tool }: { tool: ToolId }) {
  const t = useT();
  const style = usePdfUi((s) => s.style);
  const setStyle = usePdfUi((s) => s.setStyle);
  const [author, setAuthor] = useState(getAuthor);
  const def = toolDef(tool);
  const shape = tool === 'ink' || tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow';
  return (
    <Panel title={def ? t(def.label) : t('Tool')}>
      {def && <div className="faint" style={{ fontSize: 12 }}>{t(def.hint)}</div>}
      {(tool === 'text' || tool === 'date') && (
        <>
          <Field label={t('Font')}>
            <Select value={style.font} options={FONTS} onChange={(font) => setStyle({ font })} small />
          </Field>
          <div className="row">
            <NumberField value={style.fontSize} min={4} max={144} step={1} suffix="pt" small onChange={(fontSize) => setStyle({ fontSize })} style={{ width: 80 }} />
            <IconButton icon={Bold} label={t('Bold')} active={style.bold} size="sm" onClick={() => setStyle({ bold: !style.bold })} />
            <IconButton icon={Italic} label={t('Italic')} active={style.italic} size="sm" onClick={() => setStyle({ italic: !style.italic })} />
            <span className="spacer" />
            {tool === 'text' && <ColorPicker value={style.textColor} onChange={(textColor) => setStyle({ textColor })} alpha={false} label={t('Text color')} />}
          </div>
          {tool === 'date' && (
            <Field label={t('Date format')}>
              <Select value={style.dateFormat} options={dateFormats()} onChange={(dateFormat) => setStyle({ dateFormat })} small />
            </Field>
          )}
        </>
      )}
      {shape && (
        <>
          <ColorRow label={t('Color')} value={style.color} onChange={(color) => setStyle({ color })} />
          {(tool === 'rect' || tool === 'ellipse') && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <Toggle checked={!!style.fill} onChange={(on) => setStyle({ fill: on ? '#fde68a' : null })} label={t('Fill')} />
              {style.fill && <ColorPicker value={style.fill} onChange={(fill) => setStyle({ fill })} alpha={false} label={t('Fill color')} />}
            </div>
          )}
          <Slider label={t('Line width')} value={style.strokeWidth} min={0.5} max={20} step={0.5} onChange={(strokeWidth) => setStyle({ strokeWidth })} format={(v) => `${v} pt`} />
          <Slider label={t('Opacity')} value={style.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => setStyle({ opacity })} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      )}
      {tool === 'highlight' && <ColorRow label={t('Highlight color')} value={style.highlightColor} onChange={(highlightColor) => setStyle({ highlightColor })} />}
      {(tool === 'underline' || tool === 'strike') && <ColorRow label={t('Color')} value={style.color} onChange={(color) => setStyle({ color })} />}
      {tool === 'stamp' && (
        <>
          <div className="pd-swatches">
            {BUILTIN_STAMPS.map((s) => (
              <button
                key={s.label}
                type="button"
                className={`pd-stamp-btn ${style.stamp === s.label ? 'active' : ''}`}
                style={{ color: s.color }}
                onClick={() => setStyle({ stamp: s.label, stampColor: s.color })}
              >
                {t(s.label)}
              </button>
            ))}
          </div>
          <Field label={t('Custom stamp text')}>
            <TextInput small value={stampText(style.stamp, t)} maxLength={24} onChange={(e) => setStyle({ stamp: e.target.value.toUpperCase() })} />
          </Field>
          <ColorRow label={t('Stamp color')} value={style.stampColor} onChange={(stampColor) => setStyle({ stampColor })} />
        </>
      )}
      {tool === 'note' && (
        <>
          <ColorRow label={t('Note color')} value={style.noteColor} onChange={(noteColor) => setStyle({ noteColor })} />
          <Field label={t('Your name (shown on comments)')}>
            <TextInput
              small
              value={author}
              placeholder="Ultima"
              onChange={(e) => {
                setAuthor(e.target.value);
                try {
                  localStorage.setItem('ultima-pdf-author', e.target.value);
                } catch {
                  // ignore
                }
              }}
            />
          </Field>
        </>
      )}
      {tool === 'signature' && (
        <Button size="sm" icon={Signature} onClick={() => usePdfUi.getState().set({ dialog: 'signature' })}>
          {t('Choose signature…')}
        </Button>
      )}
      {tool === 'image' && (
        <Button size="sm" icon={ImagePlus} onClick={() => void selectTool('image')}>
          {t('Choose image…')}
        </Button>
      )}
    </Panel>
  );
}

/** Properties of the selected objects. */
function SelectionProps({ annots }: { annots: Annot[] }) {
  const t = useT();
  const history = useDoc();
  const a = annots[0];
  const set = (patch: Record<string, unknown>, record = true) => updateSelected(history, patch, 'Change style', record);
  const commit = () => history.commit('Change style');
  const unsupported = a.type === 'text' ? unsupportedCharacters(a.text) : [];
  const title = annots.length > 1 ? t('{count} objects', { count: annots.length }) : t(annotLabel(a));
  return (
    <Panel
      title={title}
      actions={
        <>
          <IconButton icon={ArrowUpToLine} size="sm" label={t('Bring to front')} onClick={() => bringToFront(history, true)} />
          <IconButton icon={ArrowDownToLine} size="sm" label={t('Send to back')} onClick={() => bringToFront(history, false)} />
          <IconButton icon={Copy} size="sm" label={t('Duplicate')} onClick={() => duplicateSelection(history)} />
          <IconButton icon={Trash2} size="sm" label={t('Delete')} onClick={() => deleteSelection(history)} />
        </>
      }
    >
      {a.type === 'text' && (
        <>
          <Field label={t('Font')}>
            <Select value={a.font} options={FONTS} onChange={(font) => set({ font })} small />
          </Field>
          <div className="row">
            <NumberField value={a.size} min={4} max={144} step={1} suffix="pt" small onChange={(size) => set({ size })} style={{ width: 80 }} />
            <IconButton icon={Bold} label={t('Bold')} active={a.bold} size="sm" onClick={() => set({ bold: !a.bold })} />
            <IconButton icon={Italic} label={t('Italic')} active={a.italic} size="sm" onClick={() => set({ italic: !a.italic })} />
            <span className="spacer" />
            <ColorPicker value={a.color} onChange={(color) => set({ color }, false)} onCommit={commit} alpha={false} label={t('Text color')} />
          </div>
          <Segmented
            value={a.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: t('Left') },
              { value: 'center', label: t('Center') },
              { value: 'right', label: t('Right') },
            ]}
          />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Toggle checked={!!a.background} onChange={(on) => set({ background: on ? '#ffffff' : null })} label={t('Background')} />
            {a.background && <ColorPicker value={a.background} onChange={(background) => set({ background }, false)} onCommit={commit} alpha={false} label={t('Background')} />}
          </div>
          <Toggle checked={!!a.border} onChange={(on) => set({ border: on ? a.color : null })} label={t('Border')} />
          {unsupported.length > 0 && (
            <div className="pd-warning">
              <AlertTriangle size={14} style={{ flex: '0 0 auto', marginTop: 1 }} />
              <span>
                {t('Standard PDF fonts cannot write {chars}. This text box will be saved as an image so it still looks right.', {
                  chars: unsupported.slice(0, 8).join(' '),
                })}
              </span>
            </div>
          )}
          <Button size="sm" onClick={() => usePdfUi.getState().set({ editing: a.id })}>
            {t('Edit text')}
          </Button>
        </>
      )}
      {(a.type === 'ink' || a.type === 'line' || a.type === 'arrow') && (
        <>
          <ColorRow label={t('Color')} value={a.color} onChange={(color) => set({ color }, false)} onCommit={commit} />
          <Slider label={t('Line width')} value={a.width} min={0.5} max={20} step={0.5} onChange={(width) => set({ width }, false)} onCommit={commit} format={(v) => `${v} pt`} />
          <Slider label={t('Opacity')} value={a.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => set({ opacity }, false)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      )}
      {(a.type === 'rect' || a.type === 'ellipse') && (
        <>
          <ColorRow label={t('Line color')} value={a.stroke} onChange={(stroke) => set({ stroke }, false)} onCommit={commit} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Toggle checked={!!a.fill} onChange={(on) => set({ fill: on ? '#fde68a' : null })} label={t('Fill')} />
            {a.fill && <ColorPicker value={a.fill} onChange={(fill) => set({ fill }, false)} onCommit={commit} alpha={false} label={t('Fill color')} />}
          </div>
          <Slider label={t('Line width')} value={a.width} min={0} max={20} step={0.5} onChange={(width) => set({ width }, false)} onCommit={commit} format={(v) => `${v} pt`} />
          <Slider label={t('Opacity')} value={a.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => set({ opacity }, false)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      )}
      {(a.type === 'highlight' || a.type === 'underline' || a.type === 'strike') && (
        <>
          <ColorRow label={t('Color')} value={a.color} onChange={(color) => set({ color }, false)} onCommit={commit} />
          <Slider label={t('Opacity')} value={a.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => set({ opacity }, false)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      )}
      {a.type === 'image' && (
        <Slider label={t('Opacity')} value={a.opacity} min={0.1} max={1} step={0.05} onChange={(opacity) => set({ opacity }, false)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
      )}
      {a.type === 'stamp' && annots.length === 1 && <StampProps a={a} />}
      {a.type === 'whiteout' && <ColorRow label={t('Fill color')} value={a.color} onChange={(color) => set({ color }, false)} onCommit={commit} />}
      {a.type === 'note' && <ColorRow label={t('Note color')} value={a.color} onChange={(color) => set({ color }, false)} onCommit={commit} />}
      {a.type === 'redact' && <div className="faint" style={{ fontSize: 12 }}>{t('This area will be blacked out when you apply redactions.')}</div>}
    </Panel>
  );
}

function StampProps({ a }: { a: StampAnnot }) {
  const t = useT();
  const history = useDoc();
  return (
    <>
      <Field label={t('Stamp text')}>
        <TextInput
          small
          value={a.label}
          maxLength={24}
          onChange={(e) => {
            const label = e.target.value.toUpperCase();
            const f = contentFrame(a.rect, a.rot);
            const size = stampSize(label || ' ');
            const scale = f.height / size.h;
            const rect = rectFromFrame(f.origin, a.rot, size.w * scale, f.height);
            history.set((d) => ({ ...d, annots: d.annots.map((x) => (x.id === a.id ? { ...a, label, rect } : x)) }), { record: false });
          }}
          onBlur={() => history.commit('Edit stamp')}
        />
      </Field>
      <ColorRow label={t('Stamp color')} value={a.color} onChange={(color) => updateSelected(history, { color }, 'Change style', false)} onCommit={() => history.commit('Change style')} />
    </>
  );
}

function RedactionPanel() {
  const t = useT();
  const history = useDoc();
  const marks = history.present.annots.filter((a) => a.type === 'redact').length;
  const [query, setQuery] = useState('');
  return (
    <Panel title={t('Redaction')}>
      <div className="faint" style={{ fontSize: 12 }}>
        {t('Mark areas with the Redact tool, select text and choose "Mark for redaction", or mark every occurrence of a word.')}
      </div>
      <div className="row">
        <TextInput small placeholder={t('Text to redact, e.g. a name')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button
          size="sm"
          disabled={!query.trim()}
          onClick={async () => {
            const n = await markTextForRedaction(history, query);
            if (n) toast.success(t('{count} occurrence(s) marked', { count: n }));
            else toast.info(t('No matches'));
          }}
        >
          {t('Mark')}
        </Button>
      </div>
      <div className="pd-warning pd-danger-box">
        <EyeOff size={14} style={{ flex: '0 0 auto', marginTop: 1 }} />
        <span>{t('{count} area(s) marked. Applying removes the content for good: affected pages become images.', { count: marks })}</span>
      </div>
      <Button size="sm" variant="danger" icon={EyeOff} disabled={!marks} onClick={() => void applyRedactions(history)}>
        {t('Apply redactions…')}
      </Button>
    </Panel>
  );
}

function AnnotationList() {
  const t = useT();
  const history = useDoc();
  const doc = history.present;
  const selection = usePdfUi((s) => s.selection);
  const items = useMemo(() => {
    const order = new Map(doc.pages.map((p, i) => [p.id, i]));
    return doc.annots
      .filter((a) => order.has(a.page))
      .map((a) => ({ a, page: order.get(a.page)! }))
      .sort((x, y) => x.page - y.page);
  }, [doc.annots, doc.pages]);
  if (!items.length) return null;
  const snippet = (a: Annot) => (a.type === 'text' || a.type === 'note' ? a.text.slice(0, 40) : a.type === 'stamp' ? a.label : '');
  return (
    <Panel title={t('Annotations ({count})', { count: items.length })} defaultOpen={items.length < 30}>
      <div className="pd-list">
        {items.slice(0, 500).map(({ a, page }) => (
          <div
            key={a.id}
            className={`pd-list-item ${selection.includes(a.id) ? 'selected' : ''}`}
            onClick={() => {
              const ui = usePdfUi.getState();
              ui.set({ selection: [a.id], tool: 'select', mode: 'view' });
              ui.goToPage(page);
            }}
          >
            <span className="faint" style={{ width: 28 }}>
              {t('p.')} {page + 1}
            </span>
            <span>{t(annotLabel(a))}</span>
            <span className="faint grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {snippet(a)}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function EditPanel() {
  const history = useDoc();
  const tool = usePdfUi((s) => s.tool);
  const selection = usePdfUi((s) => s.selection);
  const selected = history.present.annots.filter((a) => selection.includes(a.id));
  const hasMarks = history.present.annots.some((a) => a.type === 'redact');
  return (
    <>
      {selected.length > 0 ? <SelectionProps annots={selected} /> : tool !== 'select' && tool !== 'hand' && <ToolOptions tool={tool} />}
      {(tool === 'redact' || hasMarks) && <RedactionPanel />}
      {selected.length === 0 && (tool === 'select' || tool === 'hand') && <QuickTools />}
      <AnnotationList />
    </>
  );
}

function QuickTools() {
  const t = useT();
  return (
    <Panel title={t('Edit & annotate')}>
      <div className="faint" style={{ fontSize: 12 }}>
        {t('Pick a tool on the left to add text, draw, highlight, insert images, stamps or your signature. Select text on the page to highlight, underline or copy it.')}
      </div>
      <div className="pd-grid2">
        <Button size="sm" icon={Signature} onClick={() => usePdfUi.getState().set({ dialog: 'signature' })}>
          {t('Sign')}
        </Button>
        <Button size="sm" icon={EyeOff} onClick={() => void selectTool('redact')}>
          {t('Redact')}
        </Button>
      </div>
    </Panel>
  );
}
