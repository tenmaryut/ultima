/**
 * Per-page annotation layer: draws the objects (SVG in user space), hit areas for the
 * Select tool, selection boxes/handles (screen space), the live preview of the shape
 * being drawn, and the inline text / note editors.
 */
import { memo } from 'react';
import { annotBounds, inkPoints } from '../annots';
import { applyLinear, contentFrame, rectToScreen, type Matrix } from '../geometry';
import { usePdfUi } from '../store';
import type { Annot, ToolId } from '../types';
import { AnnotShape, matrixAttr } from './AnnotShapes';
import type { Handle, PageGeometry, Preview } from './interactions';
import { TextEditor } from './TextEditor';
import { NotePopup } from './NotePopup';

const HANDLE = 8;

function handlesFor(a: Annot, m: Matrix): Handle[] {
  switch (a.type) {
    case 'line':
    case 'arrow':
      return ['p1', 'p2'];
    case 'note':
    case 'highlight':
    case 'underline':
    case 'strike':
      return [];
    case 'text': {
      const f = contentFrame(a.rect, a.rot);
      const dir = applyLinear(m, f.ax.x, f.ax.y);
      return Math.abs(dir.x) >= Math.abs(dir.y) ? ['w', 'e'] : ['n', 's'];
    }
    default:
      return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  }
}

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  p1: 'move',
  p2: 'move',
};

function HitArea({ a, px, selectable }: { a: Annot; px: number; selectable: boolean }) {
  const pe = selectable ? undefined : 'none';
  const tol = 8 / px;
  switch (a.type) {
    case 'ink':
      return (
        <g pointerEvents={pe ?? 'stroke'}>
          {a.strokes.map((s, i) => (
            <polyline key={i} points={inkPoints(s).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="transparent" strokeWidth={Math.max(a.width, tol)} strokeLinecap="round" />
          ))}
        </g>
      );
    case 'line':
    case 'arrow':
      return <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={Math.max(a.width, tol)} pointerEvents={pe ?? 'stroke'} />;
    case 'highlight':
    case 'underline':
    case 'strike':
      return (
        <g pointerEvents={pe ?? 'all'}>
          {a.rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" />
          ))}
        </g>
      );
    case 'rect':
    case 'ellipse':
      if (!a.fill)
        return a.type === 'rect' ? (
          <rect x={a.rect.x} y={a.rect.y} width={a.rect.w} height={a.rect.h} fill="none" stroke="transparent" strokeWidth={Math.max(a.width, tol)} pointerEvents={pe ?? 'stroke'} />
        ) : (
          <ellipse
            cx={a.rect.x + a.rect.w / 2}
            cy={a.rect.y + a.rect.h / 2}
            rx={a.rect.w / 2}
            ry={a.rect.h / 2}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(a.width, tol)}
            pointerEvents={pe ?? 'stroke'}
          />
        );
      return <rect x={a.rect.x} y={a.rect.y} width={a.rect.w} height={a.rect.h} fill="transparent" pointerEvents={pe ?? 'all'} />;
    default: {
      const b = annotBounds(a);
      return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" pointerEvents={pe ?? 'all'} />;
    }
  }
}

function PreviewShape({ preview, px, tool }: { preview: Preview; px: number; tool: ToolId }) {
  const style = usePdfUi((s) => s.style);
  if (!preview) return null;
  if (preview.kind === 'ink') {
    return (
      <polyline
        points={preview.points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={style.color}
        strokeOpacity={style.opacity}
        strokeWidth={style.strokeWidth * px}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (preview.kind === 'line') {
    return <line x1={preview.a.x} y1={preview.a.y} x2={preview.b.x} y2={preview.b.y} stroke={style.color} strokeWidth={style.strokeWidth * px} strokeLinecap="round" />;
  }
  const r = preview.rect;
  const common = { x: r.left, y: r.top, width: r.width, height: r.height };
  switch (tool) {
    case 'highlight':
      return <rect {...common} fill={style.highlightColor} opacity={0.5} />;
    case 'redact':
      return <rect {...common} fill="rgba(0,0,0,0.45)" stroke="#ef4444" strokeDasharray="5 3" />;
    case 'whiteout':
      return <rect {...common} fill="#ffffff" stroke="var(--accent)" strokeDasharray="4 3" />;
    case 'ellipse':
      return (
        <ellipse
          cx={r.left + r.width / 2}
          cy={r.top + r.height / 2}
          rx={r.width / 2}
          ry={r.height / 2}
          fill={style.fill ?? 'none'}
          fillOpacity={style.opacity}
          stroke={style.color}
          strokeWidth={style.strokeWidth * px}
        />
      );
    case 'rect':
      return <rect {...common} fill={style.fill ?? 'none'} fillOpacity={style.opacity} stroke={style.color} strokeWidth={style.strokeWidth * px} />;
    default:
      return <rect {...common} fill="none" stroke="var(--accent)" strokeDasharray="4 3" />;
  }
}

export interface AnnotLayerProps {
  geom: PageGeometry;
  width: number;
  height: number;
  annots: Annot[];
  preview: Preview;
  onObjectPointerDown: (e: React.PointerEvent, a: Annot) => void;
  onHandlePointerDown: (e: React.PointerEvent, a: Annot, h: Handle) => void;
}

export const AnnotLayer = memo(function AnnotLayer({ geom, width, height, annots, preview, onObjectPointerDown, onHandlePointerDown }: AnnotLayerProps) {
  const tool = usePdfUi((s) => s.tool);
  const selection = usePdfUi((s) => s.selection);
  const editing = usePdfUi((s) => s.editing);
  const m = geom.m;
  const px = Math.hypot(m[0], m[1]) || 1;
  const selectable = tool === 'select';
  const selected = annots.filter((a) => selection.includes(a.id));
  const editingAnnot = annots.find((a) => a.id === editing);
  return (
    <div className="pd-annot-layer">
      <svg className="pd-annot-svg" width={width} height={height}>
        <g transform={matrixAttr(m)}>
          {annots.map((a) => (
            <g
              key={a.id}
              data-annot-id={a.id}
              className={selectable ? 'pd-annot selectable' : 'pd-annot'}
              style={editingAnnot?.id === a.id && a.type === 'text' ? { display: 'none' } : undefined}
              onPointerDown={(e) => onObjectPointerDown(e, a)}
              onDoubleClick={() => {
                if (selectable && (a.type === 'text' || a.type === 'note')) usePdfUi.getState().set({ editing: a.id, selection: [a.id] });
              }}
            >
              <AnnotShape a={a} />
              <HitArea a={a} px={px} selectable={selectable} />
            </g>
          ))}
        </g>
        {selected.map((a) => {
          const r = rectToScreen(m, annotBounds(a));
          const handles = selected.length === 1 && selectable ? handlesFor(a, m) : [];
          const pts: Record<Handle, [number, number]> = {
            nw: [r.left, r.top],
            n: [r.left + r.width / 2, r.top],
            ne: [r.left + r.width, r.top],
            e: [r.left + r.width, r.top + r.height / 2],
            se: [r.left + r.width, r.top + r.height],
            s: [r.left + r.width / 2, r.top + r.height],
            sw: [r.left, r.top + r.height],
            w: [r.left, r.top + r.height / 2],
            p1: [0, 0],
            p2: [0, 0],
          };
          if (a.type === 'line' || a.type === 'arrow') {
            pts.p1 = [m[0] * a.x1 + m[2] * a.y1 + m[4], m[1] * a.x1 + m[3] * a.y1 + m[5]];
            pts.p2 = [m[0] * a.x2 + m[2] * a.y2 + m[4], m[1] * a.x2 + m[3] * a.y2 + m[5]];
          }
          return (
            <g key={`sel-${a.id}`}>
              {a.type !== 'line' && a.type !== 'arrow' && (
                <rect className="pd-sel-box" x={r.left - 2} y={r.top - 2} width={r.width + 4} height={r.height + 4} />
              )}
              {handles.map((h) => (
                <rect
                  key={h}
                  data-handle={h}
                  className="pd-handle"
                  x={pts[h][0] - HANDLE / 2}
                  y={pts[h][1] - HANDLE / 2}
                  width={HANDLE}
                  height={HANDLE}
                  rx={h === 'p1' || h === 'p2' ? HANDLE / 2 : 1.5}
                  style={{ cursor: CURSORS[h] }}
                  onPointerDown={(e) => onHandlePointerDown(e, a, h)}
                />
              ))}
            </g>
          );
        })}
        <PreviewShape preview={preview} px={px} tool={tool} />
      </svg>
      {editingAnnot?.type === 'text' && <TextEditor key={editingAnnot.id} annot={editingAnnot} m={m} />}
      {selectable && selected.length === 1 && selected[0].type === 'note' && <NotePopup key={selected[0].id} annot={selected[0]} m={m} autoFocus={editing === selected[0].id} pageWidth={width} pageHeight={height} />}
    </div>
  );
});
