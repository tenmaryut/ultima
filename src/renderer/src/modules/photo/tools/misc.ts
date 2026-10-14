/**
 * Eyedropper, Hand, Zoom, Text and Shape tools.
 */
import { toHex } from '../../../core/utils/color';
import { insertLayer, makeShapeLayer, makeTextLayer } from '../doc';
import type { PhotoEngine } from '../engine';
import { hitTestLayer } from '../render';
import type { Point } from '../types';
import { constrainRect, snapAngle } from './brushMath';
import { activeLayerDocPixels } from './select';
import type { ToolEvent, ToolHandler } from './types';

/* -------------------------------- Eyedropper -------------------------------- */

export function sampleColor(engine: PhotoEngine, x: number, y: number, size: number, all: boolean): string | null {
  const doc = engine.doc;
  if (!doc) return null;
  const data = all ? engine.compositePixels()?.data : activeLayerDocPixels(engine);
  if (!data) return null;
  const half = Math.floor(Math.max(1, size) / 2);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let yy = cy - half; yy <= cy + half; yy++) {
    for (let xx = cx - half; xx <= cx + half; xx++) {
      if (xx < 0 || yy < 0 || xx >= doc.width || yy >= doc.height) continue;
      const i = (yy * doc.width + xx) * 4;
      const al = data[i + 3];
      r += data[i] * al;
      g += data[i + 1] * al;
      b += data[i + 2] * al;
      a += al;
    }
  }
  if (!a) return null;
  return toHex({ r: r / a, g: g / a, b: b / a });
}

function pick(engine: PhotoEngine, e: ToolEvent): void {
  const o = engine.store.opts.eyedropper;
  const color = sampleColor(engine, e.x, e.y, o.sampleSize, o.sampleAll);
  if (!color) return;
  if (e.alt) engine.store.setColors(undefined, color);
  else engine.store.setColors(color);
}

export const eyedropperTool: ToolHandler = {
  cursor: () => 'crosshair',
  down: pick,
  move: pick,
};

/* ------------------------------- Hand / Zoom ------------------------------- */

export const handTool: ToolHandler = {
  cursor: () => 'grab',
};

export const zoomTool: ToolHandler = {
  cursor: () => 'zoom-in',
  down(engine, e) {
    const vp = engine.viewport;
    if (!vp) return;
    const z = vp.view.zoom;
    vp.zoomTo(e.alt ? z / 1.6 : z * 1.6, { x: e.sx, y: e.sy });
  },
};

/* ----------------------------------- Text ----------------------------------- */

export const textTool: ToolHandler = {
  cursor: () => 'text',
  down(engine, e) {
    const doc = engine.doc!;
    if (engine.store.editingTextId) return;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (l.type === 'text' && l.visible && hitTestLayer(l, e.x, e.y)) {
        if (doc.activeId !== l.id) engine.live({ ...doc, activeId: l.id });
        engine.startTextEdit(l.id);
        return;
      }
    }
    const o = engine.store.opts.text;
    const layer = makeTextLayer({
      text: '',
      name: 'Text',
      x: Math.round(e.x),
      y: Math.round(e.y - o.size * 0.75),
      font: o.font,
      size: o.size,
      weight: o.weight,
      italic: o.italic,
      align: o.align,
      color: engine.store.fg,
    });
    engine.live(insertLayer(doc, layer));
    engine.startTextEdit(layer.id);
  },
};

/* ---------------------------------- Shapes ---------------------------------- */

let shapeDrag: { start: Point } | null = null;

export const shapeTool: ToolHandler = {
  cursor: () => 'crosshair',
  down(_engine, e) {
    shapeDrag = { start: { x: e.x, y: e.y } };
  },
  move(engine, e) {
    if (!shapeDrag) return;
    const o = engine.store.opts.shape;
    const start = shapeDrag.start;
    let end: Point = { x: e.x, y: e.y };
    if (e.shift) end = o.kind === 'line' ? snapAngle(start, end) : constrainRect(start, end, 1);
    if (o.kind !== 'line' && e.alt) {
      // draw from the center
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      shapePreview(engine, { x: start.x - dx, y: start.y - dy }, { x: start.x + dx, y: start.y + dy });
      return;
    }
    shapePreview(engine, start, end);
  },
  up(engine) {
    const d = shapeDrag;
    shapeDrag = null;
    if (!d) return;
    if (engine.history?.hasLiveChanges) engine.commitLive('Shape Tool');
  },
  key(engine, e) {
    if (e.key === 'Escape' && shapeDrag) {
      shapeDrag = null;
      engine.history?.discardLive();
      return true;
    }
    return false;
  },
};

function shapePreview(engine: PhotoEngine, a: Point, b: Point): void {
  const history = engine.history;
  if (!history) return;
  if (history.hasLiveChanges) history.discardLive();
  const doc = history.present;
  const o = engine.store.opts.shape;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
  const fg = engine.store.fg;
  const layer =
    o.kind === 'line'
      ? makeShapeLayer({ shape: 'line', x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, fill: null, stroke: fg, strokeWidth: Math.max(1, o.strokeWidth) })
      : makeShapeLayer({
          shape: o.kind,
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          w: Math.abs(b.x - a.x),
          h: Math.abs(b.y - a.y),
          fill: o.fill ? fg : null,
          stroke: o.stroke ? o.strokeColor : null,
          strokeWidth: o.strokeWidth,
          radius: o.radius,
        });
  if (o.kind !== 'line' && !layer.fill && !layer.stroke) layer.stroke = fg;
  engine.live(insertLayer(doc, layer));
}
