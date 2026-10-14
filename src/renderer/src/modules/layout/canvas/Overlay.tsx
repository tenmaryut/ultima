import { useT } from '../../../core/i18n';
import type { ViewportApi } from '../../../core/viewport';
import { HANDLES, handlePosition, rectCenter, rectCorners, imagePlacement } from '../geometry';
import { getFrames, pageGeometry, selectionBounds, threadOf } from '../ops';
import { columnRanges } from '../snapping';
import { MASTER_ID, type Frame, type LayoutDoc, type Point, type Rect } from '../types';
import type { LayoutEditor } from '../useLayoutEditor';
import { isLeftPage } from '../vnode';
import type { Transient } from './useCanvasInteraction';
import type { PageSlot, WorldLayout } from './world';

interface Props {
  ed: LayoutEditor;
  vp: ViewportApi;
  world: WorldLayout;
  t: Transient;
  width: number;
  height: number;
}

const pts = (list: Point[]) => list.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(' ');

export function Overlay({ ed, vp, world, t, width, height }: Props) {
  const toS = (slot: PageSlot, p: Point) => vp.docToScreen(slot.x + p.x, slot.y + p.y);
  const poly = (slot: PageSlot, r: Rect, rot: number) => pts(rectCorners(r, rot).map((p) => toS(slot, p)));
  const doc = ed.doc;
  const cur = world.slots.find((s) => s.id === ed.pageId) ?? world.slots[0];
  const zoom = vp.zoom;
  const visible = (slot: PageSlot) => {
    const a = vp.docToScreen(slot.x, slot.y);
    const b = vp.docToScreen(slot.x + slot.w, slot.y + slot.h);
    return b.x > -50 && b.y > -50 && a.x < width + 50 && a.y < height + 50;
  };
  const slots = world.slots.filter(visible);

  return (
    <svg className="ly-overlay" width={width} height={height}>
      {slots.map((slot) => (
        <PageGuides key={slot.id} doc={doc} slot={slot} toS={toS} show={ed.view.guides} bleed={ed.view.bleed ? doc.bleed : 0} />
      ))}
      {ed.view.edges &&
        slots.map((slot) =>
          getFrames(doc, slot.id)
            .filter((f) => !f.hidden && (f.type === 'text' || (f.type === 'image' && !f.assetId)))
            .map((f) => <polygon key={`e-${f.id}`} className="ly-edge" points={poly(slot, f, f.rotation)} />),
        )}
      {slots.map((slot) => (
        <OverflowMarks key={`o-${slot.id}`} ed={ed} slot={slot} toS={toS} />
      ))}
      <ThreadLinks ed={ed} world={world} toS={toS} />
      {t.hover && !ed.selection.includes(t.hover) && cur && (() => {
        const f = ed.frames.find((x) => x.id === t.hover);
        return f ? <polygon className={ed.linking && f.type === 'text' ? 'ly-link-target' : 'ly-hover'} points={poly(cur, f, f.rotation)} /> : null;
      })()}
      {cur && ed.contentId && <ContentGhost ed={ed} slot={cur} toS={toS} />}
      {cur && <Selection ed={ed} slot={cur} toS={toS} poly={poly} />}
      {cur &&
        t.guides.map((g, i) => {
          const a = g.axis === 'x' ? toS(cur, { x: g.value, y: g.from }) : toS(cur, { x: g.from, y: g.value });
          const b = g.axis === 'x' ? toS(cur, { x: g.value, y: g.to }) : toS(cur, { x: g.to, y: g.value });
          return <line key={i} className="ly-smart" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      {cur && t.marquee && (() => {
        const a = toS(cur, t.marquee);
        return <rect className="ly-marquee" x={a.x} y={a.y} width={t.marquee.w * zoom} height={t.marquee.h * zoom} />;
      })()}
      {cur && t.create && (() => {
        if (t.create.line) {
          const a = toS(cur, t.create.line.a);
          const b = toS(cur, t.create.line.b);
          return <line className="ly-create" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        }
        const a = toS(cur, t.create.rect);
        const isEllipse = t.create.tool === 'ellipse';
        return isEllipse ? (
          <ellipse className="ly-create" cx={a.x + (t.create.rect.w * zoom) / 2} cy={a.y + (t.create.rect.h * zoom) / 2} rx={(t.create.rect.w * zoom) / 2} ry={(t.create.rect.h * zoom) / 2} />
        ) : (
          <rect className="ly-create" x={a.x} y={a.y} width={t.create.rect.w * zoom} height={t.create.rect.h * zoom} />
        );
      })()}
    </svg>
  );
}

function PageGuides({ doc, slot, toS, show, bleed }: { doc: LayoutDoc; slot: PageSlot; toS: (s: PageSlot, p: Point) => Point; show: boolean; bleed: number }) {
  const page = pageGeometry(doc, slot.id);
  const a = toS(slot, { x: 0, y: 0 });
  const b = toS(slot, { x: page.width, y: page.height });
  const items: React.ReactNode[] = [<rect key="trim" className="ly-trim" x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} />];
  if (!show) return <>{items}</>;
  if (bleed > 0) {
    const ba = toS(slot, { x: -bleed, y: -bleed });
    const bb = toS(slot, { x: page.width + bleed, y: page.height + bleed });
    items.push(<rect key="bleed" className="ly-bleed" x={ba.x} y={ba.y} width={bb.x - ba.x} height={bb.y - ba.y} />);
  }
  const mirror = slot.id !== MASTER_ID && doc.facing && isLeftPage(doc, slot.index);
  const m = mirror ? { ...page.margins, left: page.margins.right, right: page.margins.left } : page.margins;
  const ma = toS(slot, { x: m.left, y: m.top });
  const mb = toS(slot, { x: page.width - m.right, y: page.height - m.bottom });
  if (page.columns > 1) {
    columnRanges({ ...page, margins: m }).forEach(([x0, x1], i) => {
      const p0 = toS(slot, { x: x0, y: 0 });
      const p1 = toS(slot, { x: x1, y: 0 });
      items.push(<rect key={`c${i}`} className="ly-column" x={p0.x} y={ma.y} width={p1.x - p0.x} height={mb.y - ma.y} />);
    });
  }
  items.push(<rect key="margin" className="ly-margin" x={ma.x} y={ma.y} width={mb.x - ma.x} height={mb.y - ma.y} />);
  page.guides.x.forEach((x, i) => {
    const p = toS(slot, { x, y: 0 });
    items.push(<line key={`gx${i}`} className="ly-guide" x1={p.x} y1={a.y - 4000} x2={p.x} y2={b.y + 4000} />);
  });
  page.guides.y.forEach((y, i) => {
    const p = toS(slot, { x: 0, y });
    items.push(<line key={`gy${i}`} className="ly-guide" x1={a.x - 4000} y1={p.y} x2={b.x + 4000} y2={p.y} />);
  });
  return <>{items}</>;
}

function OverflowMarks({ ed, slot, toS }: { ed: LayoutEditor; slot: PageSlot; toS: (s: PageSlot, p: Point) => Point }) {
  const t = useT();
  const flows = slot.id === MASTER_ID ? ed.masterFlows : ed.flows;
  const frames = getFrames(ed.doc, slot.id).filter((f) => f.type === 'text' && !f.hidden && flows.get(f.id)?.overflow);
  return (
    <>
      {frames.map((f) => {
        const p = toS(slot, handlePosition(f, f.rotation, 'se'));
        return (
          <g key={f.id} className="ly-overflow" transform={`translate(${p.x - 7}, ${p.y - 7})`}>
            <title>{t('Text overflows — enlarge the frame or link it to another frame')}</title>
            <rect width={11} height={11} />
            <path d="M5.5 2.5 V8.5 M2.5 5.5 H8.5" />
          </g>
        );
      })}
    </>
  );
}

/** Lines from each frame of the selected text thread to the next one. */
function ThreadLinks({ ed, world, toS }: { ed: LayoutEditor; world: WorldLayout; toS: (s: PageSlot, p: Point) => Point }) {
  const first = ed.selected.find((f) => f.type === 'text');
  if (!first || ed.pageId === MASTER_ID) return null;
  const chain = threadOf(ed.doc, first.id);
  if (chain.length < 2) return null;
  const where = (id: string): { slot: PageSlot; f: Frame } | null => {
    for (const slot of world.slots) {
      const f = getFrames(ed.doc, slot.id).find((x) => x.id === id);
      if (f) return { slot, f };
    }
    return null;
  };
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = where(chain[i]);
    const b = where(chain[i + 1]);
    if (!a || !b) continue;
    const p = toS(a.slot, handlePosition(a.f, a.f.rotation, 'se'));
    const q = toS(b.slot, handlePosition(b.f, b.f.rotation, 'nw'));
    lines.push(<path key={i} className="ly-thread" d={`M${p.x},${p.y} C${p.x + 60},${p.y} ${q.x - 60},${q.y} ${q.x},${q.y}`} />);
    lines.push(<circle key={`a${i}`} className="ly-thread-port" cx={p.x} cy={p.y} r={3.5} />);
    lines.push(<circle key={`b${i}`} className="ly-thread-port" cx={q.x} cy={q.y} r={3.5} />);
  }
  return <>{lines}</>;
}

function ContentGhost({ ed, slot, toS }: { ed: LayoutEditor; slot: PageSlot; toS: (s: PageSlot, p: Point) => Point }) {
  const f = ed.frames.find((x) => x.id === ed.contentId);
  if (!f || f.type !== 'image' || !f.assetId) return null;
  const a = ed.doc.assets[f.assetId];
  if (!a) return null;
  const r = imagePlacement(f.w, f.h, a.width, a.height, f.fit, f.focalX, f.focalY, f.zoom);
  const c = rectCenter(f);
  const box = { x: f.x + r.x, y: f.y + r.y, w: r.w, h: r.h };
  const corners = rectCorners(box, 0).map((p) => {
    // rotate around the frame center
    const rad = (f.rotation * Math.PI) / 180;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return toS(slot, { x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad) });
  });
  return <polygon className="ly-content-ghost" points={pts(corners)} />;
}

function Selection({ ed, slot, toS, poly }: { ed: LayoutEditor; slot: PageSlot; toS: (s: PageSlot, p: Point) => Point; poly: (s: PageSlot, r: Rect, rot: number) => string }) {
  const sel = ed.selected.filter((f) => !f.hidden);
  if (!sel.length) return null;
  const movable = sel.filter((f) => !f.locked);
  const single = movable.length === 1 ? movable[0] : null;
  const box = single ?? (movable.length ? selectionBounds(movable, movable.map((f) => f.id)) : null);
  const rot = single ? single.rotation : 0;
  const items: React.ReactNode[] = sel.map((f) => <polygon key={f.id} className={f.locked ? 'ly-sel locked' : 'ly-sel'} points={poly(slot, f, f.rotation)} />);
  if (box && !ed.editing) {
    if (!single) items.push(<polygon key="box" className="ly-sel-box" points={poly(slot, box, 0)} />);
    const center = toS(slot, rectCenter(box));
    const top = toS(slot, handlePosition(box, rot, 'n'));
    const len = Math.hypot(top.x - center.x, top.y - center.y) || 1;
    const knob = { x: top.x + ((top.x - center.x) / len) * 24, y: top.y + ((top.y - center.y) / len) * 24 };
    items.push(<line key="rl" className="ly-rot-line" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} />);
    items.push(<circle key="rk" className="ly-rot-knob" cx={knob.x} cy={knob.y} r={5} />);
    for (const h of HANDLES) {
      const p = toS(slot, handlePosition(box, rot, h));
      items.push(<rect key={h} className="ly-handle" x={p.x - 4} y={p.y - 4} width={8} height={8} />);
    }
  }
  return <>{items}</>;
}
