import { useState } from 'react';
import { Check, Pencil, Plus, Shuffle, Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { ColorPicker, IconButton, Panel, TextInput, confirmDialog, promptDialog } from '../../../components/ui';
import { deleteParagraphStyle, styleUsage, updateParagraphStyle } from '../ops';
import { THEME_PRESETS, THEME_ROLES, primaryFont, resolveColor } from '../styles';
import type { TextStyle } from '../types';
import { fontSizeToDisplay, fontUnit } from '../units';
import type { LayoutEditor } from '../useLayoutEditor';
import { Row } from './fields';
import { TypographyFields } from './TextPanel';

export function StylesPanel({ ed }: { ed: LayoutEditor }) {
  const t = useT();
  const doc = ed.doc;
  const [editingId, setEditingId] = useState<string | null>(null);
  const usage = styleUsage(doc);
  const textSelected = ed.selected.some((f) => f.type === 'text');
  const activeStyle = ed.selected.find((f) => f.type === 'text');
  const editing = doc.styles.find((s) => s.id === editingId);

  const patchStyle = (id: string, patch: Partial<TextStyle> & { name?: string }, record = true) => {
    const next = updateParagraphStyle(ed.current(), id, patch);
    if (record) ed.set(next, 'Edit paragraph style');
    else ed.live(next);
  };

  return (
    <>
      <Panel
        title={t('Paragraph styles')}
        actions={
          <IconButton
            icon={Plus}
            size="sm"
            label={t('New paragraph style')}
            onClick={async () => {
              const name = await promptDialog({ title: t('New paragraph style'), defaultValue: t('My style'), confirmLabel: t('Create') });
              if (name?.trim()) setEditingId(ed.addStyleFromSelection(name.trim().slice(0, 60)));
            }}
          />
        }
      >
        <div className="faint ly-hint">
          {textSelected ? t('Click a style to apply it to the selected text.') : t('Select a text frame to apply styles. Editing a style updates every frame that uses it.')}
        </div>
        <div className="list">
          {doc.styles.map((s) => {
            const st = s.style;
            const active = activeStyle?.type === 'text' && activeStyle.styleId === s.id;
            return (
              <div key={s.id} className={`list-item ly-style-item ${active ? 'selected' : ''}`} onClick={() => textSelected && ed.applyStyle(s.id)} title={textSelected ? t('Apply') : undefined}>
                <span
                  className="grow ly-style-preview"
                  style={{
                    fontFamily: st.fontFamily,
                    fontWeight: st.fontWeight,
                    fontStyle: st.italic ? 'italic' : 'normal',
                    textTransform: st.uppercase ? 'uppercase' : 'none',
                    color: resolveColor(st.color, doc.swatches, 'inherit'),
                  }}
                >
                  {s.name}
                </span>
                <span className="faint ly-style-meta">
                  {fontSizeToDisplay(st.fontSize, doc.unit)}
                  {fontUnit(doc.unit)} · {usage.get(s.id) ?? 0}
                </span>
                <IconButton
                  icon={Pencil}
                  size="sm"
                  label={t('Edit style')}
                  active={editingId === s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(editingId === s.id ? null : s.id);
                  }}
                />
              </div>
            );
          })}
        </div>
      </Panel>
      {editing && (
        <Panel
          title={t('Edit “{name}”', { name: editing.name })}
          actions={
            <>
              <IconButton
                icon={Trash2}
                size="sm"
                label={t('Delete style')}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: t('Delete “{name}”?', { name: editing.name }),
                    message: t('Frames using it keep their current look.'),
                    confirmLabel: t('Delete'),
                    danger: true,
                  });
                  if (ok) {
                    ed.set(deleteParagraphStyle(ed.current(), editing.id), 'Delete paragraph style');
                    setEditingId(null);
                  }
                }}
              />
              <IconButton icon={Check} size="sm" label={t('Done')} onClick={() => setEditingId(null)} />
            </>
          }
        >
          <TextInput small value={editing.name} aria-label={t('Name')} onChange={(e) => patchStyle(editing.id, { name: e.target.value.slice(0, 60) }, false)} onBlur={() => ed.commit('Rename style')} />
          <div className="faint ly-hint">{primaryFont(editing.style.fontFamily)}</div>
          <TypographyFields style={editing.style} unit={doc.unit} swatches={doc.swatches} onChange={(patch, record = true) => patchStyle(editing.id, patch, record)} />
        </Panel>
      )}
      <ThemePanel ed={ed} />
    </>
  );
}

export function ThemePanel({ ed }: { ed: LayoutEditor }) {
  const t = useT();
  const doc = ed.doc;
  const setSwatch = (i: number, color: string, record: boolean) => {
    const swatches = doc.swatches.map((c, j) => (j === i ? color : c));
    ed.setDoc({ swatches }, 'Theme color', record);
  };
  return (
    <Panel
      title={t('Theme colors')}
      actions={
        <>
          <IconButton
            icon={Shuffle}
            size="sm"
            label={t('Shuffle accent colors')}
            onClick={() => {
              const s = [...doc.swatches];
              const acc = s.slice(2);
              acc.push(acc.shift()!);
              ed.setDoc({ swatches: [...s.slice(0, 2), ...acc] }, 'Shuffle colors');
            }}
          />
          <IconButton
            icon={Plus}
            size="sm"
            label={t('Add color')}
            disabled={doc.swatches.length >= 10}
            onClick={() => ed.setDoc({ swatches: [...doc.swatches, '#888888'] }, 'Add color')}
          />
        </>
      }
    >
      <div className="faint ly-hint">{t('Colors linked to the theme change everywhere when you edit them here.')}</div>
      <div className="ly-theme-grid">
        {doc.swatches.map((c, i) => (
          <div key={i} className="ly-theme-cell">
            <ColorPicker value={c} alpha={false} size={30} label={`${t(THEME_ROLES[i] ?? 'Extra')} (${c})`} onChange={(v) => setSwatch(i, v, false)} onCommit={(v) => setSwatch(i, v, true)} />
            <span className="faint">{t(THEME_ROLES[i] ?? 'Extra')}</span>
          </div>
        ))}
      </div>
      <div className="ly-label">{t('Palettes')}</div>
      <div className="ly-palettes">
        {THEME_PRESETS.map((p) => (
          <button key={p.name} type="button" className="ly-palette" title={t(p.name)} onClick={() => ed.setDoc({ swatches: [...p.colors, ...doc.swatches.slice(p.colors.length)] }, 'Theme')}>
            {p.colors.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </button>
        ))}
      </div>
      <Row>
        <span className="faint ly-hint">{t('Tip: send a palette from Color Studio to recolor the design.')}</span>
      </Row>
    </Panel>
  );
}
