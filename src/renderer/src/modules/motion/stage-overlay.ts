import { contentBox } from './bounds';
import type { EvaluatedLayer } from './evaluate';
import { evaluateProp } from './keyframes';
import { apply, multiply, type Mat } from './matrix';
import { parentMatrixAt } from './model';
import { layerHandles, layerQuad, type Handle } from './stage-math';
import type { Layer, MotionDoc, PathNode } from './types';

/** Draws the editing overlay (selection, handles, motion paths, previews) on the stage. */

export interface OverlayColors {
  accent: string;
  guide: string;
  text: string;
  bg: string;
}

export interface MotionPathPoint {
  x: number;
  y: number;
}

export interface MotionPathInfo {
  /** Screen points sampled at every frame. */
  samples: MotionPathPoint[];
  /** Keyframes: screen point + key id. */
  keys: { x: number; y: number; id: string }[];
}

/** Position keyframes of a layer projected to the screen (sampled at every frame). */
export function motionPath(doc: MotionDoc, layer: Layer, view: Mat): MotionPathInfo | null {
  const keys = layer.props.position.keyframes;
  if (keys.length < 2) return null;
  const fps = doc.comp.fps;
  const t0 = keys[0].time;
  const t1 = keys[keys.length - 1].time;
  const steps = Math.min(2000, Math.max(2, Math.round((t1 - t0) * fps)));
  const samples: MotionPathPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const p = evaluateProp(layer.props.position, t);
    const m = multiply(view, parentMatrixAt(doc, layer, t));
    const [x, y] = apply(m, p[0], p[1]);
    samples.push({ x, y });
  }
  return {
    samples,
    keys: keys.map((k) => {
      const m = multiply(view, parentMatrixAt(doc, layer, k.time));
      const [x, y] = apply(m, k.value[0], k.value[1]);
      return { x, y, id: k.id };
    }),
  };
}

export interface PathEditPoint {
  sub: number;
  node: number;
  part: 'node' | 'in' | 'out';
  x: number;
  y: number;
}

/** Screen positions of a path layer's nodes and visible handles. */
export function pathEditPoints(layer: Layer, ev: EvaluatedLayer, view: Mat): PathEditPoint[] {
  const path = layer.shape?.path;
  if (!path) return [];
  const m = multiply(view, ev.world);
  const out: PathEditPoint[] = [];
  path.forEach((sp, si) =>
    sp.nodes.forEach((n: PathNode, ni) => {
      const [x, y] = apply(m, n.x, n.y);
      out.push({ sub: si, node: ni, part: 'node', x, y });
      if (n.inX || n.inY) {
        const [hx, hy] = apply(m, n.x + n.inX, n.y + n.inY);
        out.push({ sub: si, node: ni, part: 'in', x: hx, y: hy });
      }
      if (n.outX || n.outY) {
        const [hx, hy] = apply(m, n.x + n.outX, n.y + n.outY);
        out.push({ sub: si, node: ni, part: 'out', x: hx, y: hy });
      }
    }),
  );
  return out;
}

function quad(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

export interface OverlayState {
  doc: MotionDoc;
  evaluated: Map<string, EvaluatedLayer>;
  time: number;
  view: Mat;
  selected: string[];
  hovered: string | null;
  showHandles: boolean;
  showMotionPath: boolean;
  editPath: boolean;
  marquee?: { x: number; y: number; w: number; h: number } | null;
  /** Shape being drawn (screen rect / line). */
  drawing?: { tool: string; x0: number; y0: number; x1: number; y1: number } | null;
  pen?: { nodes: PathNode[]; cursor: { x: number; y: number } | null } | null;
  guides?: { x?: number; y?: number }[];
  colors: OverlayColors;
}

/** Draws in CSS pixels; the caller sets the device-pixel-ratio transform. */
export function drawOverlay(ctx: CanvasRenderingContext2D, s: OverlayState): Handle[] {
  const { doc, evaluated, view, colors } = s;
  let handles: Handle[] = [];
  ctx.lineJoin = 'round';

  // Null layers are invisible: show a small marker for each.
  for (const layer of doc.layers) {
    if (layer.type !== 'null' || !layer.visible) continue;
    const ev = evaluated.get(layer.id);
    if (!ev) continue;
    const [x, y] = apply(multiply(view, ev.world), ev.anchor[0], ev.anchor[1]);
    ctx.strokeStyle = s.selected.includes(layer.id) ? colors.accent : 'rgba(148, 163, 184, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 6, y - 6, 12, 12);
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.lineTo(x + 9, y);
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x, y + 9);
    ctx.stroke();
  }

  if (s.hovered && !s.selected.includes(s.hovered)) {
    const layer = doc.layers.find((l) => l.id === s.hovered);
    const ev = layer && evaluated.get(layer.id);
    if (layer && ev && layer.type !== 'null') {
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      quad(ctx, layerQuad(ev, contentBox(layer, ev, doc.assets), view));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  const selectedLayers = doc.layers.filter((l) => s.selected.includes(l.id));
  for (const layer of selectedLayers) {
    const ev = evaluated.get(layer.id);
    if (!ev || layer.type === 'null') continue;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.25;
    quad(ctx, layerQuad(ev, contentBox(layer, ev, doc.assets), view));
    ctx.stroke();
  }

  // Motion path of the (single) selected layer.
  if (s.showMotionPath && selectedLayers.length === 1) {
    const mp = motionPath(doc, selectedLayers[0], view);
    if (mp) {
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      mp.samples.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.accent;
      if (mp.samples.length < 600) for (const p of mp.samples) ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      for (const k of mp.keys) {
        ctx.fillStyle = colors.bg;
        ctx.fillRect(k.x - 4, k.y - 4, 8, 8);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(k.x - 4, k.y - 4, 8, 8);
      }
    }
  }

  if (s.showHandles && selectedLayers.length === 1) {
    const layer = selectedLayers[0];
    const ev = evaluated.get(layer.id);
    if (ev && !layer.locked) {
      const box = contentBox(layer, ev, doc.assets);
      handles = layer.type === 'null' ? layerHandles(ev, { x: 0, y: 0, w: 0, h: 0 }, view).filter((h) => h.id === 'anchor') : layerHandles(ev, box, view);
      const rot = handles.find((h) => h.id === 'rot');
      const n = handles.find((h) => h.id === 'n');
      if (rot && n) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(rot.x, rot.y);
        ctx.stroke();
      }
      for (const h of handles) {
        if (h.id === 'anchor') {
          ctx.strokeStyle = colors.accent;
          ctx.fillStyle = colors.bg;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(h.x - 9, h.y);
          ctx.lineTo(h.x + 9, h.y);
          ctx.moveTo(h.x, h.y - 9);
          ctx.lineTo(h.x, h.y + 9);
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        if (h.id === 'rot') {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
          ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
        }
      }
      if (s.editPath && layer.type === 'shape' && layer.shape?.kind === 'path') {
        const pts = pathEditPoints(layer, ev, view);
        const nodes = new Map(pts.filter((p) => p.part === 'node').map((p) => [`${p.sub}:${p.node}`, p]));
        ctx.lineWidth = 1;
        for (const p of pts) {
          if (p.part === 'node') continue;
          const n0 = nodes.get(`${p.sub}:${p.node}`);
          if (!n0) continue;
          ctx.strokeStyle = colors.accent;
          ctx.beginPath();
          ctx.moveTo(n0.x, n0.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.fillStyle = colors.accent;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        for (const p of nodes.values()) {
          ctx.fillStyle = colors.bg;
          ctx.strokeStyle = colors.accent;
          ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
          ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
        }
      }
    }
  }

  if (s.guides?.length) {
    ctx.strokeStyle = colors.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    for (const g of s.guides) {
      ctx.beginPath();
      if (g.x !== undefined) {
        ctx.moveTo(g.x, 0);
        ctx.lineTo(g.x, h);
      }
      if (g.y !== undefined) {
        ctx.moveTo(0, g.y);
        ctx.lineTo(w, g.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (s.marquee) {
    const m = s.marquee;
    ctx.fillStyle = colors.accent;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.accent;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w, m.h);
    ctx.setLineDash([]);
  }

  if (s.drawing) {
    const d = s.drawing;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (d.tool === 'line') {
      ctx.moveTo(d.x0, d.y0);
      ctx.lineTo(d.x1, d.y1);
    } else if (d.tool === 'ellipse') {
      ctx.ellipse((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, Math.abs(d.x1 - d.x0) / 2, Math.abs(d.y1 - d.y0) / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (s.pen && s.pen.nodes.length) {
    const nodes = s.pen.nodes.map((n) => {
      const [x, y] = apply(view, n.x, n.y);
      return { x, y, inX: n.inX * view[0], inY: n.inY * view[3], outX: n.outX * view[0], outY: n.outY * view[3] };
    });
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    nodes.forEach((n, i) => {
      if (!i) ctx.moveTo(n.x, n.y);
      else {
        const p = nodes[i - 1];
        ctx.bezierCurveTo(p.x + p.outX, p.y + p.outY, n.x + n.inX, n.y + n.inY, n.x, n.y);
      }
    });
    if (s.pen.cursor) {
      const last = nodes[nodes.length - 1];
      ctx.setLineDash([4, 4]);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(s.pen.cursor.x, s.pen.cursor.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    nodes.forEach((n, i) => {
      if (n.outX || n.outY) {
        ctx.beginPath();
        ctx.moveTo(n.x + n.inX, n.y + n.inY);
        ctx.lineTo(n.x + n.outX, n.y + n.outY);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = i === 0 ? colors.accent : colors.bg;
      ctx.fillRect(n.x - 3.5, n.y - 3.5, 7, 7);
      ctx.strokeRect(n.x - 3.5, n.y - 3.5, 7, 7);
    });
  }
  return handles;
}
