/**
 * SVG rendering of annotation objects. Shapes are drawn in PDF user space; the parent
 * <g> applies the page's viewport matrix (zoom + rotation + y flip), so this output
 * lines up exactly with the pdf.js canvas and with what pdf-lib writes on save.
 */
import { memo, useMemo } from 'react';
import { arrowHead, arrowShaftEnd, inkPathD } from '../annots';
import { contentFrame, frameMatrix, type Matrix } from '../geometry';
import { noteIconPath, stampLayout } from '../flatten';
import { cssFontFamily, layoutText, TEXT_PAD } from '../textlayout';
import type { Annot, MarkupAnnot, NoteAnnot, StampAnnot, TextAnnot } from '../types';

export const matrixAttr = (m: Matrix) => `matrix(${m.map((v) => +v.toFixed(6)).join(' ')})`;

function TextShape({ a }: { a: TextAnnot }) {
  const frame = contentFrame(a.rect, a.rot);
  const layout = useMemo(
    () => layoutText(a.text, { family: a.font, bold: a.bold, italic: a.italic, size: a.size }, frame.width, a.autoWidth, a.align),
    [a.text, a.font, a.bold, a.italic, a.size, frame.width, a.autoWidth, a.align],
  );
  return (
    <g transform={matrixAttr(frameMatrix(a.rect, a.rot))}>
      <rect width={frame.width} height={frame.height} fill={a.background ?? 'transparent'} stroke={a.border ?? 'none'} strokeWidth={1} />
      {layout.lines.map((line, i) =>
        line ? (
          <text
            key={i}
            x={layout.offsets[i]}
            y={TEXT_PAD + i * layout.lineHeight + layout.ascent}
            fontFamily={cssFontFamily(a.font)}
            fontSize={a.size}
            fontWeight={a.bold ? 700 : 400}
            fontStyle={a.italic ? 'italic' : 'normal'}
            fill={a.color}
            style={{ whiteSpace: 'pre' }}
          >
            {line}
          </text>
        ) : null,
      )}
    </g>
  );
}

function StampShape({ a }: { a: StampAnnot }) {
  const f = contentFrame(a.rect, a.rot);
  const lay = stampLayout(a.label, f.width, f.height);
  const ins = lay.inset;
  return (
    <g transform={matrixAttr(frameMatrix(a.rect, a.rot))} opacity={0.9}>
      <rect x={ins} y={ins} width={Math.max(0, f.width - ins * 2)} height={Math.max(0, f.height - ins * 2)} rx={lay.radius} fill="none" stroke={a.color} strokeWidth={lay.border} />
      <text x={lay.x} y={lay.baseline} fontFamily={cssFontFamily('helvetica')} fontWeight={700} fontSize={lay.size} fill={a.color} style={{ whiteSpace: 'pre' }}>
        {a.label}
      </text>
    </g>
  );
}

function NoteShape({ a }: { a: NoteAnnot }) {
  const f = contentFrame(a.rect, a.rot);
  return (
    <g transform={matrixAttr(frameMatrix(a.rect, a.rot))}>
      <path d={noteIconPath(f.width, f.height)} fill={a.color} stroke="#3f3f46" strokeWidth={0.8} />
      <path d={`M${f.width * 0.2} ${f.height * 0.25} H${f.width * 0.8} M${f.width * 0.2} ${f.height * 0.42} H${f.width * 0.8} M${f.width * 0.2} ${f.height * 0.59} H${f.width * 0.6}`} stroke="#3f3f46" strokeWidth={0.8} />
    </g>
  );
}

/** Underline / strike-through lines (same geometry as the saved PDF). */
function MarkLines({ a }: { a: MarkupAnnot }) {
  return (
    <g opacity={a.opacity}>
      {a.rects.map((r, i) => {
        const vertical = r.h > r.w * 3;
        const thickness = Math.max(0.6, (vertical ? r.w : r.h) * 0.07);
        const t = a.type === 'underline' ? 0.14 : 0.45;
        return vertical ? (
          <line key={i} x1={r.x + r.w * (1 - t)} y1={r.y} x2={r.x + r.w * (1 - t)} y2={r.y + r.h} stroke={a.color} strokeWidth={thickness} />
        ) : (
          <line key={i} x1={r.x} y1={r.y + r.h * t} x2={r.x + r.w} y2={r.y + r.h * t} stroke={a.color} strokeWidth={thickness} />
        );
      })}
    </g>
  );
}

/** One object in user space. Highlights are drawn by <MarkupLayerShapes> (multiply blending). */
export const AnnotShape = memo(function AnnotShape({ a }: { a: Annot }) {
  switch (a.type) {
    case 'text':
      return <TextShape a={a} />;
    case 'ink':
      return (
        <g opacity={a.opacity}>
          {a.strokes.map((s, i) => (
            <path key={i} d={inkPathD(s)} fill="none" stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </g>
      );
    case 'highlight':
      return null;
    case 'underline':
    case 'strike':
      return <MarkLines a={a} />;
    case 'rect':
      return (
        <rect
          x={a.rect.x}
          y={a.rect.y}
          width={a.rect.w}
          height={a.rect.h}
          fill={a.fill ?? 'none'}
          fillOpacity={a.fill ? a.opacity : undefined}
          stroke={a.width > 0 ? a.stroke : 'none'}
          strokeOpacity={a.opacity}
          strokeWidth={a.width}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={a.rect.x + a.rect.w / 2}
          cy={a.rect.y + a.rect.h / 2}
          rx={a.rect.w / 2}
          ry={a.rect.h / 2}
          fill={a.fill ?? 'none'}
          fillOpacity={a.fill ? a.opacity : undefined}
          stroke={a.width > 0 ? a.stroke : 'none'}
          strokeOpacity={a.opacity}
          strokeWidth={a.width}
        />
      );
    case 'line':
    case 'arrow': {
      const end = a.type === 'arrow' ? arrowShaftEnd(a) : { x: a.x2, y: a.y2 };
      const head = a.type === 'arrow' ? arrowHead(a.x1, a.y1, a.x2, a.y2, a.width) : null;
      return (
        <g opacity={a.opacity}>
          <line x1={a.x1} y1={a.y1} x2={end.x} y2={end.y} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
          {head && <polygon points={head.map((p) => `${p.x},${p.y}`).join(' ')} fill={a.color} />}
        </g>
      );
    }
    case 'image': {
      const f = contentFrame(a.rect, a.rot);
      return (
        <g transform={matrixAttr(frameMatrix(a.rect, a.rot))}>
          <image href={a.src} width={f.width} height={f.height} preserveAspectRatio="none" opacity={a.opacity} />
        </g>
      );
    }
    case 'stamp':
      return <StampShape a={a} />;
    case 'whiteout':
      return <rect x={a.rect.x} y={a.rect.y} width={a.rect.w} height={a.rect.h} fill={a.color || '#ffffff'} />;
    case 'note':
      return <NoteShape a={a} />;
    case 'redact':
      return (
        <rect
          x={a.rect.x}
          y={a.rect.y}
          width={a.rect.w}
          height={a.rect.h}
          fill="rgba(0,0,0,0.45)"
          stroke="#ef4444"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          vectorEffect="non-scaling-stroke"
        />
      );
  }
});

/** Highlight rectangles (rendered in a multiply-blended layer under the text layer). */
export function HighlightShapes({ annots }: { annots: Annot[] }) {
  return (
    <>
      {annots.map((a) =>
        a.type === 'highlight' ? (
          <g key={a.id} fill={a.color} opacity={a.opacity}>
            {a.rects.map((r, i) => (
              <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} />
            ))}
          </g>
        ) : null,
      )}
    </>
  );
}
