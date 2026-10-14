/**
 * Popup for a selected sticky note: edit its text, see author/date, change color, delete.
 */
import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { annotBounds } from '../annots';
import { editAnnots, useDoc } from '../context';
import { rectToScreen, type Matrix } from '../geometry';
import { usePdfUi } from '../store';
import type { NoteAnnot } from '../types';

const NOTE_COLORS = ['#facc15', '#fb923c', '#f472b6', '#60a5fa', '#4ade80'];

export function NotePopup({ annot, m, autoFocus, pageWidth, pageHeight }: { annot: NoteAnnot; m: Matrix; autoFocus: boolean; pageWidth: number; pageHeight: number }) {
  const t = useT();
  const history = useDoc();
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = useRef(false);
  const historyRef = useRef(history);
  historyRef.current = history;

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const commit = () => {
    if (dirty.current) historyRef.current.commit('Edit note');
    dirty.current = false;
    const ui = usePdfUi.getState();
    if (ui.editing === annot.id) ui.set({ editing: null });
  };

  const r = rectToScreen(m, annotBounds(annot));
  // open on the side of the icon that has room (the page clips anything outside it)
  const W = 248;
  const left = r.left + r.width + 8 + W <= pageWidth ? r.left + r.width + 8 : Math.max(4, r.left - W - 8);
  const top = Math.max(4, Math.min(r.top, pageHeight - 170));
  return (
    <div
      className="pd-popup pd-note-popup"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="row" style={{ gap: 6 }}>
        <span className="grow faint" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {annot.author} · {new Date(annot.createdAt).toLocaleString()}
        </span>
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`pd-dot ${annot.color === c ? 'active' : ''}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => editAnnots(history, (list) => list.map((a) => (a.id === annot.id ? { ...a, color: c } : a)), 'Note color')}
          />
        ))}
        <button
          type="button"
          className="icon-btn sm"
          title={t('Delete')}
          aria-label={t('Delete')}
          onClick={() => {
            editAnnots(history, (list) => list.filter((a) => a.id !== annot.id), 'Delete note');
            usePdfUi.getState().set({ selection: [], editing: null });
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        ref={ref}
        className="textarea"
        rows={4}
        placeholder={t('Write a comment…')}
        value={annot.text}
        onChange={(e) => {
          dirty.current = true;
          const text = e.target.value;
          history.set((d) => ({ ...d, annots: d.annots.map((a) => (a.id === annot.id && a.type === 'note' ? { ...a, text } : a)) }), { record: false });
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
        }}
      />
    </div>
  );
}
