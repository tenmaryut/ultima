import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useT } from '../../../core/i18n';
import { getFrames, threadOf } from '../ops';
import { resolveColor, resolveTextStyle } from '../styles';
import { MASTER_ID } from '../types';
import type { LayoutEditor } from '../useLayoutEditor';
import { pageBackground, textContentSize } from '../vnode';
import type { PageSlot } from './world';

/**
 * Inline text editing: a plain <textarea> placed exactly over the frame (inside the zoomed
 * world layer so it scales and rotates with the frame). Only plain text is stored.
 */
export function InlineEditor({ ed, slot }: { ed: LayoutEditor; slot: PageSlot }) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const editing = ed.editing!;
  const frame = getFrames(ed.doc, slot.id).find((f) => f.id === editing.id);
  const value = frame?.type === 'table' && editing.cell ? (frame.cells[editing.cell[0]]?.[editing.cell[1]] ?? '') : ed.editableText(editing.id);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (editing.created) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.id, editing.cell?.[0], editing.cell?.[1]]);

  // vertical alignment of short text (single column, unthreaded)
  const threaded = frame?.type === 'text' && slot.id !== MASTER_ID && threadOf(ed.doc, frame.id).length > 1;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !frame || frame.type !== 'text' || frame.vAlign === 'top' || frame.columns > 1 || threaded) {
      if (el) el.style.paddingTop = '0px';
      return;
    }
    el.style.paddingTop = '0px';
    const content = el.clientHeight;
    const used = el.scrollHeight;
    const free = Math.max(0, content - used);
    el.style.paddingTop = `${frame.vAlign === 'middle' ? free / 2 : free}px`;
  });

  if (!frame || (frame.type !== 'text' && frame.type !== 'table')) return null;

  const swatches = ed.doc.swatches;
  const page = ed.page;
  const bg = pageBackground(page, swatches).backgroundColor ?? '#ffffff';
  let style: CSSProperties;
  if (frame.type === 'table' && editing.cell) {
    const [r, c] = editing.cell;
    const cw = frame.w / frame.cols;
    const rh = frame.h / frame.rows;
    style = {
      left: slot.x + frame.x + c * cw,
      top: slot.y + frame.y + r * rh,
      width: cw,
      height: Math.max(rh, frame.fontSize * 1.6),
      padding: frame.cellPadding,
      fontFamily: frame.fontFamily,
      fontSize: frame.fontSize,
      lineHeight: 1.3,
      color: resolveColor(frame.color, swatches, '#000'),
      textAlign: frame.align,
      background: '#ffffff',
      transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
      transformOrigin: `${frame.w / 2 - c * cw}px ${frame.h / 2 - r * rh}px`,
    };
  } else if (frame.type === 'text') {
    const st = resolveTextStyle(frame, ed.doc.styles);
    const content = textContentSize(frame);
    const border = frame.stroke ? frame.strokeWidth : 0;
    const opaque = threaded || frame.columns > 1;
    style = {
      left: slot.x + frame.x + border + frame.padding,
      top: slot.y + frame.y + border + frame.padding,
      width: content.w,
      height: opaque ? Math.max(content.h, st.fontSize * st.lineHeight * 3) : content.h,
      fontFamily: st.fontFamily,
      fontSize: st.fontSize,
      fontWeight: st.fontWeight,
      fontStyle: st.italic ? 'italic' : 'normal',
      textDecoration: st.underline ? 'underline' : 'none',
      textTransform: st.uppercase ? 'uppercase' : 'none',
      color: resolveColor(st.color, swatches, '#000'),
      textAlign: st.align,
      lineHeight: st.lineHeight,
      letterSpacing: `${st.letterSpacing / 1000}em`,
      background: opaque ? (frame.fill ? resolveColor(frame.fill, swatches) : bg) : 'transparent',
      transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
      opacity: frame.opacity,
      textShadow: 'none',
    };
  } else return null;

  const finishCell = (dir: 1 | -1) => {
    if (frame.type !== 'table' || !editing.cell) return;
    const [r, c] = editing.cell;
    let idx = r * frame.cols + c + dir;
    idx = (idx + frame.rows * frame.cols) % (frame.rows * frame.cols);
    ed.endEdit();
    setTimeout(() => ed.beginEdit(frame.id, [Math.floor(idx / frame.cols), idx % frame.cols]), 0);
  };

  return (
    <textarea
      ref={ref}
      className={`ly-inline-editor ${frame.type === 'table' ? 'cell' : ''}`}
      style={style}
      value={value}
      spellCheck
      aria-label={t('Edit text')}
      placeholder={frame.type === 'text' ? t('Type here…') : ''}
      onChange={(e) => ed.editText(e.target.value)}
      onBlur={() => ed.endEdit()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          ed.endEdit();
        } else if (e.key === 'Tab' && frame.type === 'table') {
          e.preventDefault();
          finishCell(e.shiftKey ? -1 : 1);
        }
      }}
    />
  );
}
