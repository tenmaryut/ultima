/**
 * Crop tool: drag a frame (handles, move, new), aspect presets and a straighten angle.
 */
import { cropDoc } from '../docops';
import type { PhotoEngine } from '../engine';
import type { Point, Rect } from '../types';
import type { ToolHandler } from './types';

const rad = (d: number) => (d * Math.PI) / 180;

/* ----------------------------------- Crop ----------------------------------- */

interface CropState {
  rect: Rect;
  docW: number;
  docH: number;
  drag: null | { kind: 'new' | 'move' | 'handle'; hx: number; hy: number; start: Point; r0: Rect };
}

let crop: CropState | null = null;

function cropState(engine: PhotoEngine): CropState | null {
  const doc = engine.doc;
  if (!doc) return null;
  if (!crop || crop.docW !== doc.width || crop.docH !== doc.height) crop = { rect: { x: 0, y: 0, w: doc.width, h: doc.height }, docW: doc.width, docH: doc.height, drag: null };
  return crop;
}

export function cropAspect(engine: PhotoEngine): number | null {
  const a = engine.store.opts.crop.aspect;
  const doc = engine.doc;
  if (a === 'free' || !doc) return null;
  if (a === 'original') return doc.width / doc.height;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(a);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

/** Fits the crop rect to the aspect ratio (largest centered rect inside the current one). */
export function applyCropAspect(engine: PhotoEngine): void {
  const s = cropState(engine);
  const ratio = cropAspect(engine);
  if (!s || !ratio) {
    engine.requestOverlay();
    return;
  }
  const r = s.rect;
  let w = r.w;
  let h = w / ratio;
  if (h > r.h) {
    h = r.h;
    w = h * ratio;
  }
  s.rect = { x: Math.round(r.x + (r.w - w) / 2), y: Math.round(r.y + (r.h - h) / 2), w: Math.round(w), h: Math.round(h) };
  engine.requestOverlay();
}

export function applyCrop(engine: PhotoEngine): void {
  const s = cropState(engine);
  const doc = engine.doc;
  if (!s || !doc) return;
  const angle = engine.store.opts.crop.angle;
  const r = s.rect;
  if (r.w < 1 || r.h < 1) return;
  if (!angle && r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) return;
  try {
    engine.commit(cropDoc(doc, r, angle), 'Crop');
    engine.store.setOpt('crop', { angle: 0 });
  } catch (error) {
    engine.reportError(error);
  }
  crop = null;
  engine.requestOverlay();
}

export function resetCrop(engine: PhotoEngine): void {
  crop = null;
  cropState(engine);
  engine.store.setOpt('crop', { angle: 0 });
  engine.requestOverlay();
}

export function setCropRect(engine: PhotoEngine, rect: Rect): void {
  const s = cropState(engine);
  if (!s) return;
  s.rect = rect;
  engine.requestOverlay();
}

function cropToLocal(s: CropState, p: Point, angle: number): Point {
  const c = { x: s.rect.x + s.rect.w / 2, y: s.rect.y + s.rect.h / 2 };
  const a = rad(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

function cropFromLocal(r: Rect, p: Point, angle: number): Point {
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const a = rad(-angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

export const cropTool: ToolHandler = {
  cursor: () => 'crosshair',
  activate(engine) {
    crop = null;
    cropState(engine);
  },
  down(engine, e) {
    const s = cropState(engine);
    if (!s) return;
    const angle = engine.store.opts.crop.angle;
    const r = s.rect;
    for (const hx of [-1, 0, 1]) {
      for (const hy of [-1, 0, 1]) {
        if (!hx && !hy) continue;
        const p = cropFromLocal(r, { x: r.x + ((hx + 1) / 2) * r.w, y: r.y + ((hy + 1) / 2) * r.h }, angle);
        const sp = engine.docToScreen(p.x, p.y);
        if (Math.hypot(sp.x - e.sx, sp.y - e.sy) <= 8) {
          s.drag = { kind: 'handle', hx, hy, start: cropToLocal(s, e, angle), r0: { ...r } };
          return;
        }
      }
    }
    const l = cropToLocal(s, e, angle);
    const inside = l.x >= r.x && l.x <= r.x + r.w && l.y >= r.y && l.y <= r.y + r.h;
    s.drag = { kind: inside ? 'move' : 'new', hx: 1, hy: 1, start: inside ? l : { x: e.x, y: e.y }, r0: { ...r } };
    if (!inside) s.rect = { x: Math.round(e.x), y: Math.round(e.y), w: 0, h: 0 };
  },
  move(engine, e) {
    const s = cropState(engine);
    if (!s?.drag) return;
    const angle = engine.store.opts.crop.angle;
    const d = s.drag;
    const ratio = cropAspect(engine);
    if (d.kind === 'move') {
      const l = cropToLocal({ ...s, rect: d.r0 }, e, angle);
      s.rect = { ...d.r0, x: Math.round(d.r0.x + l.x - d.start.x), y: Math.round(d.r0.y + l.y - d.start.y) };
    } else if (d.kind === 'new') {
      let w = e.x - d.start.x;
      let h = e.y - d.start.y;
      if (ratio) {
        if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h) || 1) * (Math.abs(w) / ratio);
        else w = (Math.sign(w) || 1) * Math.abs(h) * ratio;
      }
      s.rect = { x: Math.round(Math.min(d.start.x, d.start.x + w)), y: Math.round(Math.min(d.start.y, d.start.y + h)), w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) };
    } else {
      const l = cropToLocal({ ...s, rect: d.r0 }, e, angle);
      let x0 = d.r0.x;
      let y0 = d.r0.y;
      let x1 = d.r0.x + d.r0.w;
      let y1 = d.r0.y + d.r0.h;
      if (d.hx < 0) x0 = l.x;
      if (d.hx > 0) x1 = l.x;
      if (d.hy < 0) y0 = l.y;
      if (d.hy > 0) y1 = l.y;
      let w = Math.max(1, Math.abs(x1 - x0));
      let h = Math.max(1, Math.abs(y1 - y0));
      if (ratio) {
        if (d.hx && d.hy) {
          if (w / ratio > h) h = w / ratio;
          else w = h * ratio;
        } else if (d.hx) h = w / ratio;
        else w = h * ratio;
        if (d.hx < 0) x0 = x1 - w;
        else x1 = x0 + w;
        if (d.hy < 0) y0 = y1 - h;
        else y1 = y0 + h;
        if (!d.hy) {
          const cy = d.r0.y + d.r0.h / 2;
          y0 = cy - h / 2;
          y1 = cy + h / 2;
        }
        if (!d.hx) {
          const cx = d.r0.x + d.r0.w / 2;
          x0 = cx - w / 2;
          x1 = cx + w / 2;
        }
      }
      s.rect = { x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(Math.abs(x1 - x0)), h: Math.round(Math.abs(y1 - y0)) };
    }
  },
  up(engine) {
    const s = cropState(engine);
    if (!s) return;
    if (s.drag?.kind === 'new' && (s.rect.w < 2 || s.rect.h < 2)) s.rect = s.drag.r0;
    s.drag = null;
  },
  dblclick(engine) {
    applyCrop(engine);
  },
  key(engine, e) {
    if (e.key === 'Enter') {
      applyCrop(engine);
      return true;
    }
    if (e.key === 'Escape') {
      resetCrop(engine);
      return true;
    }
    return false;
  },
  overlay(engine, ctx) {
    const s = cropState(engine);
    const container = engine.container;
    if (!s || !container) return;
    const angle = engine.store.opts.crop.angle;
    const r = s.rect;
    const corner = (fx: number, fy: number) => {
      const p = cropFromLocal(r, { x: r.x + fx * r.w, y: r.y + fy * r.h }, angle);
      return engine.docToScreen(p.x, p.y);
    };
    const quad = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, container.clientWidth, container.clientHeight);
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    for (const f of [1 / 3, 2 / 3]) {
      const a = corner(f, 0);
      const b = corner(f, 1);
      const c = corner(0, f);
      const d = corner(1, f);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    for (const hx of [0, 0.5, 1]) {
      for (const hy of [0, 0.5, 1]) {
        if (hx === 0.5 && hy === 0.5) continue;
        const p = corner(hx, hy);
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      }
    }
    const label = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    ctx.font = '11px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const lp = corner(0.5, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(lp.x - tw / 2 - 6, lp.y + 8, tw + 12, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, lp.x - tw / 2, lp.y + 21);
    ctx.restore();
  },
  deactivate() {
    crop = null;
  },
};
