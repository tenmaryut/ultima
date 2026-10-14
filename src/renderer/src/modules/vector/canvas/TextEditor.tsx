import { useEffect, useRef } from 'react';
import type { EditorCore } from '../editor';
import { worldMatrix } from '../geometry';
import { multiply, translate, type Matrix } from '../matrix';
import type { TextObject } from '../model';
import { findById, removeByIds, updateById } from '../ops';
import { alignFactor, cssFontFamily, fontMetrics, fontOf, layoutText } from '../text';
import { textSession } from '../tools/draw';

function displayColor(o: TextObject): string {
  if (o.fill.type === 'solid') return o.fill.color;
  if (o.fill.type === 'linear' || o.fill.type === 'radial') return o.fill.stops[0]?.color ?? '#000';
  return 'var(--text-0)';
}

/** In-place text editing: a transparent textarea laid exactly over the SVG text. */
export function TextEditor({ core, id }: { core: EditorCore; id: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const coreRef = useRef(core);
  coreRef.current = core;
  const done = useRef(false);
  const o = findById(core.doc.objects, id);
  const wm = worldMatrix(core.doc.objects, id);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const c = coreRef.current;
    const cur = findById(c.doc.objects, id);
    const isNew = textSession.id === id && textSession.startDoc;
    if (!cur || cur.type !== 'text' || !cur.text.trim()) {
      if (isNew && textSession.startDoc) {
        const start = textSession.startDoc;
        c.updateLive(() => start);
        c.commit();
      } else if (cur) {
        c.updateLive((d) => ({ ...d, objects: removeByIds(d.objects, [id]) }));
        c.commit('Delete text');
      }
      c.setSelection([]);
    } else {
      c.commit(isNew ? 'Add text' : 'Edit text');
    }
    textSession.id = null;
    textSession.startDoc = null;
    c.setEditingText(null);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  if (!o || o.type !== 'text' || !wm || o.onPath) return null;

  const { view } = core.viewport;
  const layout = layoutText(o);
  const { ascent, descent } = fontMetrics(fontOf(o));
  const lh = layout.lineHeight;
  const baseline = (lh - (ascent + descent)) / 2 + ascent;
  const extra = o.fontSize * 0.6;
  const width = layout.width + extra;
  const V: Matrix = [view.zoom, 0, 0, view.zoom, view.x, view.y];
  const left = -width * alignFactor(o.align);
  const m = multiply(multiply(V, wm), translate(left, -baseline));
  const lines = o.text.split('\n').length;

  return (
    <textarea
      ref={ref}
      className="vc-text-editor"
      spellCheck={false}
      value={o.text}
      style={{
        transform: `matrix(${m.join(',')})`,
        width,
        height: lines * lh + 2,
        font: `${o.italic ? 'italic ' : ''}${o.fontWeight} ${o.fontSize}px ${cssFontFamily(o.fontFamily)}`,
        lineHeight: `${lh}px`,
        letterSpacing: `${o.letterSpacing}px`,
        textAlign: o.align,
        color: displayColor(o),
        caretColor: 'var(--accent)',
      }}
      onChange={(e) => {
        const text = e.target.value;
        core.updateLive((d) => ({
          ...d,
          objects: updateById(d.objects, id, (x) => {
            if (x.type !== 'text') return x;
            const autoName = x.name === 'Text' || x.name === x.text.split('\n')[0].slice(0, 40);
            return { ...x, text, name: autoName ? text.split('\n')[0].slice(0, 40) || 'Text' : x.name };
          }),
        }));
      }}
      onBlur={() => finish()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          finish();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
