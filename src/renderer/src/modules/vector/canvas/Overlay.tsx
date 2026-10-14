import { memo, type ReactNode } from 'react';
import { nodeKey, type EditorCore } from '../editor';
import { boundsUnder, objectGeom, worldMatrix } from '../geometry';
import { apply, decompose, multiply, rectCorners, type Matrix, type Pt } from '../matrix';
import type { VObject } from '../model';
import { findById, topLevelSelection } from '../ops';
import { serializePath, transformGeom } from '../path';
import { HANDLES, handleCursor, handleLocal, selectionFrame, type OverlayState } from '../tools/common';
import { isNodeEditable } from '../tools/direct';

const pts = (list: Pt[]) => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

function outlinePath(o: VObject, m: Matrix): string {
  if (o.type === 'group' || o.type === 'text' || o.type === 'image' || o.type === 'raw') {
    const b = boundsUnder(o, m);
    if (!b) return '';
    return `M${pts(rectCorners(b)).replace(/ /g, 'L')}Z`;
  }
  const g = objectGeom(o);
  return g ? serializePath(transformGeom(g, m), 1) : '';
}

export const Overlay = memo(function Overlay({ core, overlay, showHandles }: { core: EditorCore; overlay: OverlayState; showHandles: boolean }) {
  const { view } = core.viewport;
  const V: Matrix = [view.zoom, 0, 0, view.zoom, view.x, view.y];
  const toScreen = (p: Pt) => apply(V, p);
  const objects = core.doc.objects;
  const items: ReactNode[] = [];

  // artboard names
  core.doc.artboards.forEach((ab) => {
    const p = toScreen({ x: ab.x, y: ab.y });
    const active = ab.id === core.doc.activeArtboard;
    items.push(
      <text key={`abl-${ab.id}`} x={p.x} y={p.y - 6} className={`vc-ab-label ${active ? 'active' : ''}`}>
        {ab.name}
      </text>,
    );
    if (active && core.doc.artboards.length > 1) {
      const q = toScreen({ x: ab.x + ab.width, y: ab.y + ab.height });
      items.push(<rect key={`aba-${ab.id}`} x={p.x - 1} y={p.y - 1} width={q.x - p.x + 2} height={q.y - p.y + 2} className="vc-ab-active" />);
    }
  });

  // entered group
  if (core.scope) {
    const g = findById(objects, core.scope);
    const pm = worldMatrix(objects, core.scope);
    if (g && pm) {
      const b = boundsUnder(g, pm);
      if (b) {
        const c = rectCorners(b).map(toScreen);
        items.push(<polygon key="scope" points={pts(c)} className="vc-scope" />);
      }
    }
  }

  // hover outline
  if (overlay.hover && !core.selection.includes(overlay.hover)) {
    const o = findById(objects, overlay.hover);
    const wm = o ? worldMatrix(objects, o.id) : null;
    if (o && wm) items.push(<path key="hover" d={outlinePath(o, multiply(V, wm))} className="vc-hover" />);
  }

  // selection
  const sel = topLevelSelection(objects, core.selection).filter((id) => id !== core.editingText);
  if (sel.length) {
    if (sel.length > 1 || core.tool === 'direct') {
      for (const id of sel) {
        const o = findById(objects, id);
        const wm = worldMatrix(objects, id);
        if (o && wm) items.push(<path key={`so-${id}`} d={outlinePath(o, multiply(V, wm))} className="vc-sel-outline" />);
      }
    }
    const frame = selectionFrame(objects, sel);
    const locked = sel.some((id) => findById(objects, id)?.locked);
    if (frame && core.tool !== 'direct') {
      const fm = multiply(V, frame.m);
      const corners = rectCorners(frame.box).map((c) => apply(fm, c));
      items.push(<polygon key="frame" points={pts(corners)} className="vc-frame" />);
      if (showHandles && !locked) {
        // rotation knob above the top edge
        const top = apply(fm, handleLocal(frame.box, 'n'));
        const bottom = apply(fm, handleLocal(frame.box, 's'));
        let ux = top.x - bottom.x;
        let uy = top.y - bottom.y;
        const ul = Math.hypot(ux, uy);
        if (ul < 1e-6) {
          const d = decompose(frame.m);
          const a = ((d.rotation - 90) * Math.PI) / 180;
          ux = Math.cos(a);
          uy = Math.sin(a);
        } else {
          ux /= ul;
          uy /= ul;
        }
        const knob = { x: top.x + ux * 22, y: top.y + uy * 22 };
        items.push(<line key="rotl" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} className="vc-frame" />);
        items.push(<circle key="rot" cx={knob.x} cy={knob.y} r={5} className="vc-handle vc-rot" data-handle="rot" />);
        for (const h of HANDLES) {
          const p = apply(fm, handleLocal(frame.box, h));
          items.push(
            <rect key={`h-${h}`} x={p.x - 4} y={p.y - 4} width={8} height={8} className="vc-handle" data-handle={h} style={{ cursor: handleCursor(h, frame.m) }} />,
          );
        }
      }
    }
  }

  // path nodes (direct selection, or the pen with a selected path)
  if (core.tool === 'direct' || core.tool === 'pen') {
    const selected = new Set(core.nodeSel);
    for (const id of core.selection) {
      const o = findById(objects, id);
      if (!o || !isNodeEditable(o)) continue;
      const wm = worldMatrix(objects, id);
      const g = objectGeom(o);
      if (!wm || !g) continue;
      const m = multiply(V, wm);
      g.subpaths.forEach((s, si) =>
        s.nodes.forEach((n, ni) => {
          const key = nodeKey(id, si, ni);
          const p = apply(m, n);
          if (selected.has(key) && core.tool === 'direct') {
            for (const kind of ['in', 'out'] as const) {
              const h = n[kind];
              if (!h) continue;
              const hp = apply(m, h);
              items.push(<line key={`hl-${key}-${kind}`} x1={p.x} y1={p.y} x2={hp.x} y2={hp.y} className="vc-hline" />);
              items.push(<circle key={`hc-${key}-${kind}`} cx={hp.x} cy={hp.y} r={4} className="vc-hdot" data-node={key} data-kind={kind} />);
            }
          }
          items.push(
            <rect
              key={`n-${key}`}
              x={p.x - 3.5}
              y={p.y - 3.5}
              width={7}
              height={7}
              className={`vc-node ${selected.has(key) ? 'sel' : ''} ${n.smooth ? 'smooth' : ''}`}
              data-node={key}
              data-kind="anchor"
            />,
          );
        }),
      );
    }
  }

  // pen preview
  if (overlay.pen && overlay.pen.nodes.length) {
    const nodes = overlay.pen.nodes.map((n) => ({
      ...n,
      ...toScreen(n),
      in: n.in ? toScreen(n.in) : undefined,
      out: n.out ? toScreen(n.out) : undefined,
    }));
    const d = serializePath({ subpaths: [{ nodes, closed: false }] }, 1);
    items.push(<path key="pen" d={d} className="vc-pen-path" />);
    const last = nodes[nodes.length - 1];
    if (overlay.pen.cursor && !overlay.pen.dragging) {
      const c = toScreen(overlay.pen.cursor);
      const c1 = last.out ?? last;
      items.push(<path key="pen-rb" d={`M${last.x} ${last.y}C${c1.x} ${c1.y} ${c.x} ${c.y} ${c.x} ${c.y}`} className="vc-pen-rubber" />);
    }
    nodes.forEach((n, i) => {
      if (i === nodes.length - 1) {
        for (const h of [n.in, n.out]) {
          if (!h) continue;
          items.push(<line key={`pl-${i}-${h.x}`} x1={n.x} y1={n.y} x2={h.x} y2={h.y} className="vc-hline" />);
          items.push(<circle key={`pc-${i}-${h.x}`} cx={h.x} cy={h.y} r={3.5} className="vc-hdot" />);
        }
      }
      items.push(<rect key={`pn-${i}`} x={n.x - 3.5} y={n.y - 3.5} width={7} height={7} className={`vc-node ${i === 0 ? 'first' : ''} ${i === nodes.length - 1 ? 'sel' : ''}`} />);
    });
  }

  if (overlay.pencil && overlay.pencil.length > 1) {
    items.push(<polyline key="pencil" points={pts(overlay.pencil.map(toScreen))} className="vc-pencil" />);
  }

  for (const [i, g] of overlay.guides.entries()) {
    const a = g.axis === 'x' ? toScreen({ x: g.value, y: g.from }) : toScreen({ x: g.from, y: g.value });
    const b = g.axis === 'x' ? toScreen({ x: g.value, y: g.to }) : toScreen({ x: g.to, y: g.value });
    items.push(<line key={`g-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="vc-guide" />);
  }

  for (const [key, r] of [
    ['marquee', overlay.marquee],
    ['zoom', overlay.zoomRect],
  ] as const) {
    if (!r) continue;
    const a = toScreen({ x: r.x, y: r.y });
    const b = toScreen({ x: r.x + r.width, y: r.y + r.height });
    items.push(<rect key={key} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} className="vc-marquee" />);
  }

  if (overlay.segmentHint) {
    const p = toScreen(overlay.segmentHint);
    items.push(<circle key="seg" cx={p.x} cy={p.y} r={4} className="vc-seg-hint" />);
  }

  return <g className="vc-overlay">{items}</g>;
});
