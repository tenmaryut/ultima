/**
 * Painting tools: Brush, Pencil, Eraser, Clone Stamp, Spot Healing, Dodge/Burn/Sponge and
 * Blur/Sharpen. All share the StrokeSession pipeline.
 */
import { toast } from '../../../components/ui';
import { t } from '../../../core/i18n';
import { ctx2d, makeCanvas } from '../canvas';
import type { PhotoEngine } from '../engine';
import { luma, parseHex } from '../pixels/adjust';
import { toneBrush } from '../pixels/tone';
import { blurredCopy, unsharpMask } from '../pixels/filters';
import { healPatch } from '../pixels/heal';
import { flattenToCanvas } from '../render';
import { intersectRects } from '../selection';
import type { Layer, Point } from '../types';
import { dabSpacing, Smoother, spacedDabs } from './brushMath';
import { brushStamp, pencilStamp, StrokeSession, type StrokeOptions } from './stroke';
import type { ToolEvent, ToolHandler } from './types';

interface DabSpec {
  size: number;
  alpha: number;
}

interface ActiveStroke {
  session: StrokeSession;
  last: Point;
  lastPressure: number;
  carry: number;
  smoother: Smoother;
  dab: (x: number, y: number, pressure: number) => DabSpec;
  draw: (x: number, y: number, spec: DabSpec) => void;
  spacing: (spec: DabSpec) => number;
  label: string;
  onFinish?: (session: StrokeSession) => void;
}

let stroke: ActiveStroke | null = null;
let flushRaf = 0;
const lastStrokeEnd = new Map<string, Point>();

function scheduleFlush(): void {
  if (flushRaf) return;
  flushRaf = requestAnimationFrame(() => {
    flushRaf = 0;
    stroke?.session.flush();
  });
}

/** Layer (and target) the painting tools act on, or null (with a message). */
export function paintTarget(engine: PhotoEngine, allowMask = true): { layer: Layer; target: 'layer' | 'mask' } | null {
  const layer = engine.activeLayer();
  if (!engine.canEdit(layer)) return null;
  if (!layer.visible) {
    toast.info(t('The layer is hidden'), t('Show the layer to paint on it.'));
    return null;
  }
  if (allowMask && engine.store.maskEdit && layer.mask) return { layer, target: 'mask' };
  if (layer.type !== 'raster') {
    void engine.ensureRaster(layer.id);
    return null;
  }
  return { layer, target: 'layer' };
}

function maskGray(color: string): number {
  const [r, g, b] = parseHex(color);
  return luma(r, g, b) / 255;
}

function beginStroke(engine: PhotoEngine, e: ToolEvent, spec: Omit<ActiveStroke, 'session' | 'last' | 'lastPressure' | 'carry'>, layer: Layer, target: 'layer' | 'mask', options: StrokeOptions, toolId: string): void {
  const session = new StrokeSession(engine, layer, target, options);
  const start = spec.smoother.push({ x: e.x, y: e.y });
  stroke = { ...spec, session, last: start, lastPressure: e.pressure, carry: 0 };
  const prev = lastStrokeEnd.get(toolId);
  if (e.shift && prev) {
    // Shift-click: straight line from the end of the previous stroke
    stroke.last = prev;
    segmentTo(start, e.pressure);
  } else {
    const d = spec.dab(start.x, start.y, e.pressure);
    spec.draw(start.x, start.y, d);
  }
  session.flush();
}

function segmentTo(p: Point, pressure: number): void {
  if (!stroke) return;
  const s = stroke;
  const probe = s.dab(p.x, p.y, pressure);
  const { dabs, carry } = spacedDabs(s.last, p, s.spacing(probe), s.carry);
  for (const d of dabs) {
    const pr = s.lastPressure + (pressure - s.lastPressure) * d.t;
    s.draw(d.x, d.y, s.dab(d.x, d.y, pr));
  }
  s.carry = carry;
  s.last = p;
  s.lastPressure = pressure;
}

function moveStroke(e: ToolEvent): void {
  if (!stroke) return;
  segmentTo(stroke.smoother.push({ x: e.x, y: e.y }), e.pressure);
  scheduleFlush();
}

function endStroke(e: ToolEvent, toolId: string): void {
  if (!stroke) return;
  const s = stroke;
  // catch up with the real pointer position when smoothing
  segmentTo({ x: e.x, y: e.y }, e.pressure);
  lastStrokeEnd.set(toolId, { x: e.x, y: e.y });
  stroke = null;
  cancelAnimationFrame(flushRaf);
  flushRaf = 0;
  if (s.onFinish) s.onFinish(s.session);
  else s.session.finish(s.label);
}

function cancelStroke(): void {
  stroke?.session.cancel();
  stroke = null;
}

function brushLike(toolId: string, label: string, configure: (engine: PhotoEngine, e: ToolEvent, layer: Layer, target: 'layer' | 'mask') => { spec: Omit<ActiveStroke, 'session' | 'last' | 'lastPressure' | 'carry' | 'label'>; options: StrokeOptions } | null, size: (engine: PhotoEngine) => number, allowMask = true): ToolHandler {
  return {
    cursor: () => 'crosshair',
    brushSize: size,
    down(engine, e) {
      const target = paintTarget(engine, allowMask);
      if (!target) return;
      const conf = configure(engine, e, target.layer, target.target);
      if (!conf) return;
      beginStroke(engine, e, { ...conf.spec, label }, target.layer, target.target, conf.options, toolId);
    },
    move: (_engine, e) => moveStroke(e),
    up: (_engine, e) => endStroke(e, toolId),
    key(_engine, e) {
      if (e.key === 'Escape' && stroke) {
        cancelStroke();
        return true;
      }
      return false;
    },
    deactivate: () => cancelStroke(),
  };
}

/* ---------------------------------- Brush ---------------------------------- */

export const brushTool = brushLike(
  'brush',
  'Brush Tool',
  (engine, _e, _layer, target) => {
    const o = engine.store.opts.brush;
    const color = target === 'mask' ? '#ffffff' : engine.store.fg;
    return {
      options: { mode: target === 'mask' ? 'mask' : 'paint', opacity: o.opacity, maskGray: maskGray(engine.store.fg) },
      spec: {
        smoother: new Smoother(o.smoothing),
        dab: (_x, _y, p) => ({ size: Math.max(0.5, o.size * (o.pressureSize ? p : 1)), alpha: o.flow * (o.pressureOpacity ? p : 1) }),
        spacing: (d) => dabSpacing(d.size, o.hardness),
        draw: (x, y, d) => stroke?.session.dab(brushStamp(d.size, o.hardness, color), x, y, d.alpha),
      },
    };
  },
  (engine) => engine.store.opts.brush.size,
);

export const pencilTool = brushLike(
  'pencil',
  'Pencil Tool',
  (engine, _e, _layer, target) => {
    const o = engine.store.opts.pencil;
    const color = target === 'mask' ? '#ffffff' : engine.store.fg;
    return {
      options: { mode: target === 'mask' ? 'mask' : 'paint', opacity: o.opacity, maskGray: maskGray(engine.store.fg) },
      spec: {
        smoother: new Smoother(0),
        dab: () => ({ size: o.size, alpha: 1 }),
        spacing: (d) => Math.max(1, d.size / 4),
        draw: (x, y, d) => {
          const stamp = pencilStamp(d.size, color);
          const s = stroke?.session;
          if (!s) return;
          // snap the stamp's top-left to whole pixels
          s.dab(stamp, Math.floor(x - stamp.width / 2) + stamp.width / 2, Math.floor(y - stamp.height / 2) + stamp.height / 2, 1, true);
        },
      },
    };
  },
  (engine) => engine.store.opts.pencil.size,
);

export const eraserTool = brushLike(
  'eraser',
  'Eraser Tool',
  (engine, _e, _layer, target) => {
    const o = engine.store.opts.eraser;
    return {
      options: target === 'mask' ? { mode: 'mask', opacity: o.opacity, maskGray: maskGray(engine.store.bg) } : { mode: 'erase', opacity: o.opacity },
      spec: {
        smoother: new Smoother(0.15),
        dab: () => ({ size: o.size, alpha: o.flow }),
        spacing: (d) => dabSpacing(d.size, o.hardness),
        draw: (x, y, d) => stroke?.session.dab(brushStamp(d.size, o.hardness, '#ffffff'), x, y, d.alpha),
      },
    };
  },
  (engine) => engine.store.opts.eraser.size,
);

/* ------------------------------- Clone stamp ------------------------------- */

let cloneSource: Point | null = null;
let cloneOffset: Point | null = null;
let cloneStrokeOffset: Point | null = null;
let dabCanvas: HTMLCanvasElement | null = null;

const cloneBase = brushLike(
  'clone',
  'Clone Stamp',
  (engine, e, layer) => {
    const o = engine.store.opts.clone;
    if (!cloneSource) {
      toast.info(t('Set a clone source first'), t('Alt-click (Option-click on a Mac) the area you want to copy from.'));
      return null;
    }
    if (!o.aligned || !cloneOffset) cloneOffset = { x: e.x - cloneSource.x, y: e.y - cloneSource.y };
    cloneStrokeOffset = cloneOffset;
    const doc = engine.doc!;
    const src = o.sampleAll
      ? { canvas: flattenToCanvas(doc, engine.overrides), x: 0, y: 0 }
      : layer.type === 'raster'
        ? { canvas: layer.canvas, x: layer.x, y: layer.y }
        : null;
    if (!src) return null;
    const off = cloneOffset;
    return {
      options: { mode: 'paint', opacity: o.opacity },
      spec: {
        smoother: new Smoother(0.1),
        dab: () => ({ size: o.size, alpha: o.flow }),
        spacing: (d) => dabSpacing(d.size, o.hardness),
        draw: (x, y, d) => {
          const s = stroke?.session;
          if (!s) return;
          const stamp = brushStamp(d.size, o.hardness, '#ffffff');
          if (!dabCanvas || dabCanvas.width < stamp.width || dabCanvas.height < stamp.height) dabCanvas = makeCanvas(stamp.width + 8, stamp.height + 8);
          const dc = ctx2d(dabCanvas);
          dc.save();
          const left = x - stamp.width / 2;
          const top = y - stamp.height / 2;
          dc.clearRect(0, 0, dabCanvas.width, dabCanvas.height);
          dc.globalCompositeOperation = 'source-over';
          dc.drawImage(src.canvas, src.x - (left - off.x), src.y - (top - off.y));
          dc.globalCompositeOperation = 'destination-in';
          dc.drawImage(stamp, 0, 0);
          dc.restore();
          s.bufCtx.globalAlpha = d.alpha;
          s.bufCtx.drawImage(dabCanvas, 0, 0, stamp.width, stamp.height, left - s.area.x, top - s.area.y, stamp.width, stamp.height);
          s.touch({ x: left, y: top, w: stamp.width, h: stamp.height });
        },
      },
    };
  },
  (engine) => engine.store.opts.clone.size,
  false,
);

export const cloneTool: ToolHandler = {
  ...cloneBase,
  down(engine, e) {
    if (e.alt) {
      cloneSource = { x: e.x, y: e.y };
      cloneOffset = null;
      toast.info(t('Clone source set'), t('Now paint where you want to copy it.'));
      engine.requestOverlay();
      return;
    }
    cloneBase.down?.(engine, e);
  },
  up(engine, e) {
    cloneBase.up?.(engine, e);
    cloneStrokeOffset = null;
  },
  overlay(engine, ctx) {
    const h = engine.hover;
    if (!cloneSource) return;
    let p: Point | null = null;
    const off = cloneStrokeOffset ?? (engine.store.opts.clone.aligned ? cloneOffset : null);
    if (h && off) p = { x: h.x - off.x, y: h.y - off.y };
    else if (!off) p = cloneSource;
    if (!p) return;
    const s = engine.docToScreen(p.x, p.y);
    ctx.lineWidth = 1;
    for (const [color, w] of [
      ['rgba(0,0,0,0.75)', 3],
      ['#ffffff', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(s.x - 8, s.y);
      ctx.lineTo(s.x + 8, s.y);
      ctx.moveTo(s.x, s.y - 8);
      ctx.lineTo(s.x, s.y + 8);
      ctx.stroke();
    }
  },
};

/* ------------------------------- Spot healing ------------------------------- */

export const healTool = brushLike(
  'heal',
  'Spot Healing Brush',
  (engine) => {
    const o = engine.store.opts.heal;
    return {
      options: { mode: 'coverage', opacity: 0.55 },
      spec: {
        smoother: new Smoother(0.1),
        dab: () => ({ size: o.size, alpha: 1 }),
        spacing: (d) => dabSpacing(d.size, o.hardness),
        draw: (x, y, d) => stroke?.session.dab(brushStamp(d.size, o.hardness, '#3a3a3a'), x, y, d.alpha),
        onFinish: (session) => {
          const touched = session.touchedRect;
          if (!touched) {
            session.cancel();
            return;
          }
          const m = Math.round(Math.max(touched.w, touched.h) * 1.7 + 12);
          const patch = intersectRects(
            { x: Math.floor(touched.x - m), y: Math.floor(touched.y - m), w: Math.ceil(touched.w + 2 * m), h: Math.ceil(touched.h + 2 * m) },
            session.area,
          );
          if (!patch) {
            session.cancel();
            return;
          }
          try {
            const base = session.basePixels(patch);
            const cov = session.coverage(patch);
            const healed = healPatch(base, patch.w, patch.h, cov);
            session.commitCanvas(session.baseWithPatch(patch, healed), 'Spot Healing Brush');
          } catch (error) {
            session.cancel();
            engine.reportError(error);
          }
        },
      },
    };
  },
  (engine) => engine.store.opts.heal.size,
  false,
);

/* --------------------------------- Toning --------------------------------- */

export const dodgeTool = brushLike(
  'dodge',
  'Dodge / Burn',
  (engine) => {
    const o = engine.store.opts.dodge;
    return {
      options: {
        mode: 'effect',
        opacity: 1,
        effect: {
          margin: 0,
          fn: (data) => {
            const out = data.slice();
            toneBrush(out, o.mode, o.range, o.exposure, o.sponge);
            return out;
          },
        },
      },
      spec: {
        smoother: new Smoother(0.15),
        dab: () => ({ size: o.size, alpha: 0.5 }),
        spacing: (d) => dabSpacing(d.size, o.hardness),
        draw: (x, y, d) => stroke?.session.dab(brushStamp(d.size, o.hardness, '#ffffff'), x, y, d.alpha),
      },
    };
  },
  (engine) => engine.store.opts.dodge.size,
  false,
);

export const blurTool = brushLike(
  'blur',
  'Blur / Sharpen',
  (engine) => {
    const o = engine.store.opts.blur;
    const sigma = 1 + o.strength * 5;
    return {
      options: {
        mode: 'effect',
        opacity: 1,
        effect:
          o.mode === 'blur'
            ? { margin: Math.ceil(sigma * 3) + 2, fn: (data, w, h) => blurredCopy(data, w, h, sigma) }
            : { margin: 6, fn: (data, w, h) => unsharpMask(data.slice(), w, h, { amount: 60 + o.strength * 200, radius: 1.2, threshold: 0 }) },
      },
      spec: {
        smoother: new Smoother(0.15),
        dab: () => ({ size: o.size, alpha: 0.6 }),
        spacing: (d) => dabSpacing(d.size, o.hardness),
        draw: (x, y, d) => stroke?.session.dab(brushStamp(d.size, o.hardness, '#ffffff'), x, y, d.alpha),
      },
    };
  },
  (engine) => engine.store.opts.blur.size,
  false,
);
