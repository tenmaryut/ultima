import type { EditorCore } from '../editor';
import { smoothPoints, polylineToSubpath } from '../fit';
import { hitTest, worldMatrix } from '../geometry';
import { apply, invert, normalizeRect, translate, type Pt } from '../matrix';
import {
  createEllipse,
  createLine,
  createPath,
  createPolygon,
  createRect,
  createStar,
  createText,
  defaultStroke,
  newId,
  NONE,
  solid,
  type Paint,
  type Stroke,
  type VDoc,
  type VObject,
} from '../model';
import { applyStyle } from '../ops';
import { constrain45, snapPoint } from '../snap';
import { layoutText } from '../text';
import { dragged, insertObjects, snapTargetsFor, type Gesture, type PointerInfo, type ToolCtx } from './common';

export type ShapeTool = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line';

/** Text being created: the document before the new (still empty) text was added. */
export const textSession: { id: string | null; startDoc: VDoc | null } = { id: null, startDoc: null };

function strokeForLines(core: EditorCore): Stroke {
  const s = core.style.stroke;
  return s.paint.type === 'none' || s.width <= 0 ? defaultStroke(solid('#000000'), Math.max(1, s.width || 1)) : s;
}

function buildShape(core: EditorCore, tool: ShapeTool, x: number, y: number, w: number, h: number, id: string): VObject {
  const style = core.style;
  const o = core.options;
  let obj: VObject;
  switch (tool) {
    case 'rect':
      obj = createRect(x, y, w, h, style, o.radius);
      break;
    case 'ellipse':
      obj = createEllipse(x, y, w, h, style);
      break;
    case 'polygon':
      obj = createPolygon(x, y, w, h, o.sides, style);
      break;
    case 'star':
      obj = createStar(x, y, w, h, o.points, o.inner, style);
      break;
    default:
      obj = createLine(x, y, x + w, y + h, { stroke: strokeForLines(core) });
  }
  return { ...obj, id };
}

export function shapeGesture(ctx: ToolCtx, start: PointerInfo, tool: ShapeTool): Gesture {
  const core0 = ctx.core();
  const startDoc = core0.doc;
  const snapping = core0.viewOpts.smartGuides || core0.viewOpts.snapToGrid;
  const targets = snapTargetsFor(core0, new Set());
  const snap = (p: Pt) => (snapping ? snapPoint(p, targets, 5 * ctx.px()) : { ...p, guides: [] });
  const s0 = snap(start.world);
  const id = newId();
  let created = false;
  return {
    move(p) {
      if (!created && !dragged(start, p)) return;
      const core = ctx.core();
      const s1 = snap(p.world);
      let obj: VObject;
      if (tool === 'line') {
        let dx = s1.x - s0.x;
        let dy = s1.y - s0.y;
        if (p.shift) ({ dx, dy } = constrain45(p.world.x - s0.x, p.world.y - s0.y));
        obj = { ...createLine(s0.x, s0.y, s0.x + dx, s0.y + dy, { stroke: strokeForLines(core) }), id };
      } else {
        let w = s1.x - s0.x;
        let h = s1.y - s0.y;
        if (p.shift) {
          const s = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * s;
          h = Math.sign(h || 1) * s;
        }
        const r = p.alt ? normalizeRect(s0.x - w, s0.y - h, s0.x + w, s0.y + h) : normalizeRect(s0.x, s0.y, s0.x + w, s0.y + h);
        obj = buildShape(core, tool, r.x, r.y, Math.max(0.01, r.width), Math.max(0.01, r.height), id);
      }
      ctx.setOverlay({ guides: s1.guides });
      core.updateLive(() => insertObjects(startDoc, [obj], core.scope));
      if (!created) core.setSelection([id]);
      created = true;
    },
    up(p) {
      ctx.setOverlay({ guides: [] });
      const core = ctx.core();
      const label = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line' }[tool];
      if (created) {
        core.commit(`Draw ${label.toLowerCase()}`);
        return;
      }
      if (tool === 'line') return;
      // a click creates a default sized shape centred on the cursor
      const size = 100;
      const obj = buildShape(core, tool, p.world.x - size / 2, p.world.y - size / 2, size, size, id);
      core.update((d) => insertObjects(d, [obj], core.scope), `Draw ${label.toLowerCase()}`);
      core.setSelection([id]);
    },
  };
}

export function pencilGesture(ctx: ToolCtx, start: PointerInfo): Gesture {
  const points: Pt[] = [start.world];
  return {
    move(p) {
      const last = points[points.length - 1];
      if (Math.hypot(p.world.x - last.x, p.world.y - last.y) < ctx.px() * 1.5) return;
      points.push(p.world);
      ctx.setOverlay({ pencil: points.slice() });
    },
    up() {
      ctx.setOverlay({ pencil: null });
      if (points.length < 3) return;
      const core = ctx.core();
      const px = ctx.px();
      const first = points[0];
      const last = points[points.length - 1];
      const closed = points.length > 10 && Math.hypot(first.x - last.x, first.y - last.y) < 10 * px;
      const error = (0.6 + (core.options.smoothing / 100) * 7) * px;
      const pts = smoothPoints(points, 1 + Math.round(core.options.smoothing / 35));
      const sub = polylineToSubpath(pts, closed, { error, cornerAngle: (80 * Math.PI) / 180 });
      if (!sub) return;
      const path = createPath({ subpaths: [sub] }, { fill: NONE, stroke: strokeForLines(core) }, 'Pencil path');
      core.update((d) => insertObjects(d, [path], core.scope), 'Pencil');
      core.setSelection([path.id]);
    },
  };
}

/** Text uses the current fill unless it is none/white (the default shape fill), then black. */
export function textFill(core: EditorCore): Paint {
  const f = core.style.fill;
  if (f.type === 'none') return solid('#000000');
  if (f.type === 'solid' && /^#fff(fff)?$/i.test(f.color)) return solid('#000000');
  return f;
}

/** Text tool click: edit the text under the cursor or start a new one. */
export function textDown(ctx: ToolCtx, p: PointerInfo): null {
  const core = ctx.core();
  const hit = hitTest(core.doc.objects, p.world, 3 * ctx.px());
  const leaf = hit?.[hit.length - 1];
  if (leaf && leaf.type === 'text') {
    core.setSelection([leaf.id]);
    textSession.id = null;
    textSession.startDoc = null;
    core.setEditingText(leaf.id);
    return null;
  }
  const t = createText(0, 0, '', { fontFamily: core.options.fontFamily, fontSize: core.options.fontSize, fontWeight: core.options.fontWeight }, textFill(core));
  const ascent = layoutText(t).ascent;
  t.m = translate(p.world.x, p.world.y + ascent);
  const startDoc = core.doc;
  textSession.id = t.id;
  textSession.startDoc = startDoc;
  core.updateLive(() => insertObjects(startDoc, [t], core.scope));
  core.setSelection([t.id]);
  core.setEditingText(t.id);
  return null;
}

/** Eyedropper: copies the clicked object's fill and stroke to the selection and the current style. */
export function eyedropperDown(ctx: ToolCtx, p: PointerInfo): null {
  const core = ctx.core();
  const hit = hitTest(core.doc.objects, p.world, 3 * ctx.px(), undefined, { includeLocked: true });
  const leaf = hit?.[hit.length - 1];
  if (!leaf) return null;
  if (leaf.type === 'image') {
    void sampleImage(core, leaf, p.world);
    return null;
  }
  if (leaf.type === 'group' || leaf.type === 'raw') return null;
  const style = { fill: leaf.fill, stroke: leaf.stroke };
  core.setStyle(style);
  const targets = core.selection.filter((id) => id !== leaf.id);
  if (targets.length) core.updateObjects((objs) => applyStyle(objs, targets, style), 'Eyedropper');
  return null;
}

async function sampleImage(core: EditorCore, img: Extract<VObject, { type: 'image' }>, world: Pt): Promise<void> {
  const wm = worldMatrix(core.doc.objects, img.id);
  if (!wm) return;
  const local = apply(invert(wm), world);
  const el = new Image();
  el.src = img.href;
  try {
    await el.decode();
  } catch {
    return;
  }
  const x = Math.floor((local.x / img.width) * el.naturalWidth);
  const y = Math.floor((local.y / img.height) * el.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const c2d = canvas.getContext('2d');
  if (!c2d) return;
  c2d.drawImage(el, -x, -y);
  const [r, g, b, a] = c2d.getImageData(0, 0, 1, 1).data;
  const color = a < 255 ? `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})` : `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const fill = solid(color);
  core.setStyle({ ...core.style, fill });
  const targets = core.selection.filter((id) => id !== img.id);
  if (targets.length) core.updateObjects((objs) => applyStyle(objs, targets, { fill }), 'Eyedropper');
}

export function zoomGesture(ctx: ToolCtx, start: PointerInfo): Gesture {
  let active = false;
  return {
    move(p) {
      if (!active && !dragged(start, p)) return;
      active = true;
      ctx.setOverlay({ zoomRect: normalizeRect(start.world.x, start.world.y, p.world.x, p.world.y) });
    },
    up(p) {
      ctx.setOverlay({ zoomRect: null });
      const vp = ctx.core().viewport;
      if (active) {
        const r = normalizeRect(start.world.x, start.world.y, p.world.x, p.world.y);
        if (r.width > 1e-6 && r.height > 1e-6) vp.fitRect(r, 10);
      } else if (p.alt) vp.zoomOut(p.screen);
      else vp.zoomIn(p.screen);
    },
  };
}
