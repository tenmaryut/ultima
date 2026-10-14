/**
 * Inline editor for text boxes: a textarea laid over the box (rotated with it) that
 * updates the object live and records one undo step when editing ends.
 */
import { useEffect, useRef } from 'react';
import { relayoutText } from '../annots';
import { useDoc } from '../context';
import { applyLinear, applyMatrix, contentFrame, type Matrix } from '../geometry';
import { usePdfUi } from '../store';
import { cssFontFamily, LINE_HEIGHT, TEXT_PAD } from '../textlayout';
import type { DocState, TextAnnot } from '../types';

/** Document state before a text box was created (so an empty new box leaves no undo step). */
export const textCreation: { id: string | null; base: DocState | null } = { id: null, base: null };

export function TextEditor({ annot, m }: { annot: TextAnnot; m: Matrix }) {
  const history = useDoc();
  const ref = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const h = historyRef.current;
    const current = h.present.annots.find((a) => a.id === annot.id);
    const isNew = textCreation.id === annot.id;
    if (!current || current.type !== 'text' || !current.text.trim()) {
      if (isNew && textCreation.base) h.set(textCreation.base, { record: false });
      else h.set((d) => ({ ...d, annots: d.annots.filter((a) => a.id !== annot.id) }), { label: 'Delete text' });
    } else {
      h.commit(isNew ? 'Add text' : 'Edit text');
    }
    if (isNew) {
      textCreation.id = null;
      textCreation.base = null;
    }
    const ui = usePdfUi.getState();
    if (ui.editing === annot.id) ui.set({ editing: null });
  };

  // End the edit when the editor goes away without a blur (page scrolled out, object deleted).
  // The timeout makes this safe with React StrictMode's simulated unmount/remount.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) finish();
      }, 0);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const f = contentFrame(annot.rect, annot.rot);
  const origin = applyMatrix(m, f.origin.x, f.origin.y);
  const dir = applyLinear(m, f.ax.x, f.ax.y);
  const px = Math.hypot(m[0], m[1]) || 1;
  const angle = Math.atan2(dir.y, dir.x);
  return (
    <textarea
      ref={ref}
      className="pd-text-editor"
      spellCheck
      value={annot.text}
      wrap={annot.autoWidth ? 'off' : 'soft'}
      style={{
        left: origin.x,
        top: origin.y,
        width: f.width * px + (annot.autoWidth ? annot.size * px * 2 : 0),
        height: f.height * px,
        transform: `rotate(${angle}rad)`,
        fontFamily: cssFontFamily(annot.font),
        fontSize: annot.size * px,
        fontWeight: annot.bold ? 700 : 400,
        fontStyle: annot.italic ? 'italic' : 'normal',
        lineHeight: `${annot.size * LINE_HEIGHT * px}px`,
        padding: TEXT_PAD * px,
        color: annot.color,
        textAlign: annot.align,
        background: annot.background ?? 'transparent',
        whiteSpace: annot.autoWidth ? 'pre' : 'pre-wrap',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const text = e.target.value;
        historyRef.current.set(
          (d) => ({ ...d, annots: d.annots.map((a) => (a.id === annot.id && a.type === 'text' ? relayoutText({ ...a, text }) : a)) }),
          { record: false },
        );
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
