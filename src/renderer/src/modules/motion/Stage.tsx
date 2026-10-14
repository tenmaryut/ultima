import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { useAnimationFrame, useLatest } from '../../core/hooks';
import { useModuleKeydown } from '../../core/commands';
import type { ViewportApi } from '../../core/viewport';
import { useT } from '../../core/i18n';
import { toast, useContextMenu, type MenuEntry } from '../../components/ui';
import { contentBox, transformedBounds } from './bounds';
import { evaluateDoc, type EvaluatedLayer } from './evaluate';
import { centerSubpaths } from './geometry';
import { applyVector, invert, type Mat } from './matrix';
import { previewMedia, type ImageCache, type VideoPool } from './media';
import { createLayer, layerById, parentMatrixAt, reorderLayers, uniqueName, duplicateLayers, removeLayers } from './model';
import { insertLayers, removeAllAnimation, setPropAt } from './ops';
import { FrameRenderer } from './render';
import { clearTextCaches } from './text-layout';
import { useEditor } from './state';
import {
  applyAnchor,
  applyMotionKey,
  applyMove,
  applyPathEdit,
  moveItems,
  rotationFor,
  scaleFor,
  snapMove,
  startAnchor,
  startRotate,
  startScale,
  worldMatrixAt,
  type AnchorDrag,
  type MoveItem,
  type RotateDrag,
  type ScaleDrag,
} from './stage-drag';
import { HANDLE_CURSORS, hitHandle, hitTestLayers, layersInRect, rectFrom, type Handle } from './stage-math';
import { drawOverlay, motionPath, pathEditPoints, type OverlayColors } from './stage-overlay';
import type { MotionDoc, PathNode, ShapeKind, Vec2 } from './types';

type Drag =
  | { kind: 'move'; start: MotionDoc; x0: number; y0: number; items: MoveItem[]; box: { x: number; y: number; w: number; h: number } | null; moved: boolean }
  | { kind: 'scale'; start: MotionDoc; d: ScaleDrag }
  | { kind: 'rotate'; start: MotionDoc; d: RotateDrag }
  | { kind: 'anchor'; start: MotionDoc; d: AnchorDrag }
  | { kind: 'motionKey'; start: MotionDoc; id: string; keyId: string; v0: Vec2; inv: Mat; x0: number; y0: number }
  | { kind: 'pathEdit'; start: MotionDoc; id: string; sub: number; node: number; part: 'node' | 'in' | 'out'; invWorld: Mat }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean; base: string[] }
  | { kind: 'draw'; tool: string; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'pen' };

const SHAPE_TOOLS: Record<string, ShapeKind> = { rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', star: 'star', line: 'line' };

let tileCanvas: HTMLCanvasElement | null = null;
/** 16×16 light checkerboard tile for transparent compositions. */
function checkerTile(): HTMLCanvasElement {
  if (!tileCanvas) {
    tileCanvas = document.createElement('canvas');
    tileCanvas.width = 16;
    tileCanvas.height = 16;
    const c = tileCanvas.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 16, 16);
    c.fillStyle = '#d9d9d9';
    c.fillRect(8, 0, 8, 8);
    c.fillRect(0, 8, 8, 8);
  }
  return tileCanvas;
}

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export function Stage({
  active,
  vp,
  containerRef,
  images,
  videos,
  invalidateRef,
  quality,
  showMotionPaths,
  presetMenu,
}: {
  active: boolean;
  vp: ViewportApi;
  containerRef: RefObject<HTMLDivElement | null>;
  images: ImageCache;
  videos: VideoPool;
  invalidateRef: MutableRefObject<(() => void) | null>;
  quality: number;
  showMotionPaths: boolean;
  presetMenu: (ids: string[]) => MenuEntry[];
}) {
  const t = useT();
  const ed = useEditor();
  const { doc, selected, tool } = ed;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FrameRenderer | null>(null);
  const dirty = useRef(true);
  const dragRef = useRef<Drag | null>(null);
  const penRef = useRef<{ nodes: PathNode[]; dragging: boolean; cursor: { x: number; y: number } | null }>({ nodes: [], dragging: false, cursor: null });
  const hoverRef = useRef<string | null>(null);
  const guidesRef = useRef<{ x?: number; y?: number }[]>([]);
  const handlesRef = useRef<Handle[]>([]);
  const evalRef = useRef<{ doc: MotionDoc; time: number; map: Map<string, EvaluatedLayer> } | null>(null);
  const colorsRef = useRef<OverlayColors | null>(null);
  const latest = useLatest({ ed, vp, quality, showMotionPaths });
  const ctxMenu = useContextMenu();

  const invalidate = useCallback(() => {
    dirty.current = true;
  }, []);
  useEffect(() => {
    invalidateRef.current = invalidate;
    return () => {
      if (invalidateRef.current === invalidate) invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);
  useEffect(invalidate, [doc, selected, vp.view, quality, showMotionPaths, tool, invalidate, active]);
  // Redraw on playhead changes without re-rendering React every frame.
  useEffect(() => ed.time.subscribe(invalidate), [ed.time, invalidate]);
  useEffect(() => {
    rendererRef.current = new FrameRenderer();
    return () => rendererRef.current?.dispose();
  }, []);
  // Text measured with a fallback font must be re-measured once web fonts arrive.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    const onLoaded = () => {
      clearTextCaches();
      invalidate();
    };
    fonts.addEventListener('loadingdone', onLoaded);
    return () => fonts.removeEventListener('loadingdone', onLoaded);
  }, [invalidate]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(invalidate);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, invalidate]);

  const evaluated = (d: MotionDoc, tm: number) => {
    const cached = evalRef.current;
    if (cached && cached.doc === d && cached.time === tm) return cached.map;
    const map = evaluateDoc(d, tm);
    evalRef.current = { doc: d, time: tm, map };
    return map;
  };

  const viewMatrix = (): Mat => {
    const v = latest.current.vp.view;
    return [v.zoom, 0, 0, v.zoom, v.x, v.y];
  };

  /* --------------------------------- Drawing -------------------------------- */

  const draw = () => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const renderer = rendererRef.current;
    if (!container || !canvas || !overlay || !renderer) return;
    const { ed: e, vp: v, quality: q, showMotionPaths: showPaths } = latest.current;
    const tm = e.time.get();
    const d = e.doc;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;
    const dpr = window.devicePixelRatio || 1;
    const rdpr = dpr * q;
    const W = Math.max(1, Math.round(cw * rdpr));
    const H = Math.max(1, Math.round(ch * rdpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const OW = Math.round(cw * dpr);
    const OH = Math.round(ch * dpr);
    if (overlay.width !== OW || overlay.height !== OH) {
      overlay.width = OW;
      overlay.height = OH;
    }
    if (!colorsRef.current || !e.playing) {
      colorsRef.current = {
        accent: cssVar(container, '--accent', '#c084fc'),
        guide: '#ff3d9a',
        text: cssVar(container, '--text-0', '#ffffff'),
        bg: cssVar(container, '--bg-1', '#18191e'),
      };
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const z = v.view.zoom;
    const base: Mat = [rdpr * z, 0, 0, rdpr * z, rdpr * v.view.x, rdpr * v.view.y];
    const comp = d.comp;
    // Composition frame: soft shadow, then checkerboard for transparent comps.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const rx = base[4];
    const ry = base[5];
    const rw = comp.width * base[0];
    const rh = comp.height * base[3];
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 18 * rdpr;
    ctx.fillStyle = comp.transparent ? '#ffffff' : comp.background;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.shadowColor = 'transparent';
    if (comp.transparent) {
      const pattern = ctx.createPattern(checkerTile(), 'repeat');
      if (pattern) {
        pattern.setTransform(new DOMMatrix([rdpr, 0, 0, rdpr, rx, ry]));
        ctx.fillStyle = pattern;
        ctx.fillRect(rx, ry, rw, rh);
      }
    }
    ctx.restore();
    const map = evaluated(d, tm);
    renderer.render(ctx, d, {
      time: tm,
      base,
      pixelScale: rdpr * z,
      background: false,
      clip: true,
      media: previewMedia(d, images, videos),
      evaluated: map,
    });

    const octx = overlay.getContext('2d')!;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, OW, OH);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const drag = dragRef.current;
    const pen = penRef.current;
    const view = viewMatrix();
    handlesRef.current = drawOverlay(octx, {
      doc: d,
      evaluated: map,
      time: tm,
      view,
      selected: e.selected,
      hovered: drag ? null : hoverRef.current,
      showHandles: (e.tool === 'select' || e.tool === 'anchor') && !e.playing,
      showMotionPath: showPaths,
      editPath: e.tool === 'select',
      marquee:
        drag?.kind === 'marquee'
          ? (() => {
              const a = applyVector(view, 1, 1);
              const r = rectFrom(drag.x0, drag.y0, drag.x1, drag.y1);
              return { x: r.x * a[0] + view[4], y: r.y * a[1] + view[5], w: r.w * a[0], h: r.h * a[1] };
            })()
          : null,
      drawing:
        drag?.kind === 'draw'
          ? { tool: drag.tool, x0: drag.x0 * view[0] + view[4], y0: drag.y0 * view[3] + view[5], x1: drag.x1 * view[0] + view[4], y1: drag.y1 * view[3] + view[5] }
          : null,
      pen: e.tool === 'pen' ? { nodes: pen.nodes, cursor: pen.cursor } : null,
      guides: guidesRef.current.map((g) => ({ x: g.x !== undefined ? g.x * view[0] + view[4] : undefined, y: g.y !== undefined ? g.y * view[3] + view[5] : undefined })),
      colors: colorsRef.current!,
    });
  };

  useAnimationFrame(active, () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      draw();
    } catch (error) {
      console.error('[motion] stage render failed', error);
    }
  });

  /* --------------------------------- Helpers -------------------------------- */

  const point = (e: { clientX: number; clientY: number }) => vp.screenToDoc(e.clientX, e.clientY);
  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finishPen = (closed: boolean) => {
    const pen = penRef.current;
    const nodes = pen.nodes;
    penRef.current = { nodes: [], dragging: false, cursor: null };
    invalidate();
    if (nodes.length < 2) return;
    const { subpaths, cx, cy } = centerSubpaths([{ closed, nodes }]);
    const d = ed.doc;
    const layer = createLayer('shape', d.comp, { shapeKind: 'path', name: uniqueName(d, 'Path') }, d.layers.length);
    layer.shape = { ...layer.shape!, path: subpaths, fillEnabled: closed, strokeEnabled: true };
    layer.props.position = { value: [cx, cy], keyframes: [] };
    ed.setDoc(insertLayers(d, [layer], ed.selected), { label: 'Pen path' });
    ed.setSelected([layer.id]);
  };

  useEffect(() => {
    if (tool !== 'pen' && penRef.current.nodes.length) finishPen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  useModuleKeydown(active && tool === 'pen', (e) => {
    if (e.key === 'Enter') finishPen(false);
    else if (e.key === 'Escape') {
      if (penRef.current.nodes.length >= 2) finishPen(false);
      else {
        penRef.current = { nodes: [], dragging: false, cursor: null };
        invalidate();
      }
    }
  });

  const createShape = (kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, shift: boolean, alt: boolean) => {
    const d = ed.doc;
    const tiny = Math.hypot(x1 - x0, y1 - y0) < 4 / vp.zoom;
    const layer = createLayer('shape', d.comp, { shapeKind: kind, name: uniqueName(d, kind === 'rect' ? 'Rectangle' : kind[0].toUpperCase() + kind.slice(1)) }, d.layers.length);
    if (kind === 'line') {
      const len = tiny ? layer.props.size.value[0] : Math.hypot(x1 - x0, y1 - y0);
      let angle = tiny ? 0 : (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
      if (shift) angle = Math.round(angle / 45) * 45;
      const rad = (angle * Math.PI) / 180;
      const ex = tiny ? x0 : x0 + Math.cos(rad) * len;
      const ey = tiny ? y0 : y0 + Math.sin(rad) * len;
      layer.props.size = { value: [len, 0], keyframes: [] };
      layer.props.rotation = { value: angle, keyframes: [] };
      layer.props.position = { value: tiny ? [x0, y0] : [(x0 + ex) / 2, (y0 + ey) / 2], keyframes: [] };
    } else {
      let w = Math.abs(x1 - x0);
      let h = Math.abs(y1 - y0);
      if (shift) w = h = Math.max(w, h);
      if (tiny) [w, h] = layer.props.size.value;
      const cx = tiny ? x0 : alt ? x0 : x0 + (Math.sign(x1 - x0) || 1) * (w / 2);
      const cy = tiny ? y0 : alt ? y0 : y0 + (Math.sign(y1 - y0) || 1) * (h / 2);
      if (alt && !tiny) {
        w *= 2;
        h *= 2;
      }
      layer.props.size = { value: [Math.max(1, w), Math.max(1, h)], keyframes: [] };
      layer.props.position = { value: [cx, cy], keyframes: [] };
    }
    ed.setDoc(insertLayers(d, [layer], ed.selected), { label: `New ${kind}` });
    ed.setSelected([layer.id]);
    ed.setTool('select');
  };

  /* --------------------------------- Pointer -------------------------------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    if (vp.spaceHeld || tool === 'hand') {
      vp.startPan(e);
      return;
    }
    if (ed.playing) ed.togglePlay();
    container.setPointerCapture(e.pointerId);
    const p = point(e);
    const s = screenPoint(e);
    const tm = ed.time.get();
    const d = ed.doc;
    const map = evaluated(d, tm);

    if (tool === 'text') {
      const layer = createLayer('text', d.comp, { position: [p.x, p.y], text: t('Your text') }, d.layers.length);
      ed.setDoc(insertLayers(d, [layer], ed.selected), { label: 'New text' });
      ed.setSelected([layer.id]);
      ed.setTool('select');
      ed.editText(layer.id);
      return;
    }
    if (SHAPE_TOOLS[tool]) {
      dragRef.current = { kind: 'draw', tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      return;
    }
    if (tool === 'pen') {
      const pen = penRef.current;
      if (pen.nodes.length >= 3) {
        const first = pen.nodes[0];
        const fs = { x: first.x * vp.zoom + vp.view.x, y: first.y * vp.zoom + vp.view.y };
        if (Math.hypot(fs.x - s.x, fs.y - s.y) <= 8) {
          finishPen(true);
          return;
        }
      }
      pen.nodes = [...pen.nodes, { x: p.x, y: p.y, inX: 0, inY: 0, outX: 0, outY: 0 }];
      pen.dragging = true;
      dragRef.current = { kind: 'pen' };
      invalidate();
      return;
    }

    // Select / anchor tools
    const single = selected.length === 1 ? layerById(d, selected[0]) : undefined;
    if (single && !single.locked) {
      const h = hitHandle(handlesRef.current, s.x, s.y);
      if (h) {
        const world = worldMatrixAt(d, single, tm);
        if (h.id === 'anchor' && (tool === 'anchor' || e.altKey)) {
          dragRef.current = { kind: 'anchor', start: d, d: startAnchor(single, world, tm) };
          return;
        }
        if (h.id === 'rot') {
          dragRef.current = { kind: 'rotate', start: d, d: startRotate(single, world, p.x, p.y, tm) };
          return;
        }
        if (h.id !== 'anchor' && tool === 'select') {
          dragRef.current = { kind: 'scale', start: d, d: startScale(d, single, h.id, h.lx, h.ly, tm) };
          return;
        }
      }
      if (tool === 'select' && showMotionPaths) {
        const mp = motionPath(d, single, viewMatrix());
        const key = mp?.keys.find((k) => Math.hypot(k.x - s.x, k.y - s.y) <= 6);
        if (key) {
          const kf = single.props.position.keyframes.find((k) => k.id === key.id)!;
          const pm = parentMatrixAt(d, single, kf.time);
          dragRef.current = { kind: 'motionKey', start: d, id: single.id, keyId: key.id, v0: kf.value, inv: invert([pm[0], pm[1], pm[2], pm[3], 0, 0]), x0: p.x, y0: p.y };
          return;
        }
      }
      if (tool === 'select' && single.type === 'shape' && single.shape?.kind === 'path') {
        const ev = map.get(single.id);
        if (ev) {
          const pts = pathEditPoints(single, ev, viewMatrix());
          // Handles first (they sit on top of nodes when short).
          const hit = [...pts].sort((a, b) => (a.part === 'node' ? 1 : 0) - (b.part === 'node' ? 1 : 0)).find((pt) => Math.hypot(pt.x - s.x, pt.y - s.y) <= 6);
          if (hit) {
            dragRef.current = { kind: 'pathEdit', start: d, id: single.id, sub: hit.sub, node: hit.node, part: hit.part, invWorld: invert(ev.world) };
            return;
          }
        }
      }
    }
    const hit = hitTestLayers(d, map, p.x, p.y, tm, 4 / vp.zoom);
    if (hit) {
      let sel = selected;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        sel = selected.includes(hit) ? selected.filter((id) => id !== hit) : [...selected, hit];
        ed.setSelected(sel);
        if (!sel.includes(hit)) return;
      } else if (!selected.includes(hit)) {
        sel = [hit];
        ed.setSelected(sel);
      }
      if (tool !== 'select') return;
      const items = moveItems(d, sel, tm);
      if (!items.length) return;
      const boxes = sel
        .map((id) => {
          const l = layerById(d, id);
          const ev = map.get(id);
          return l && ev ? transformedBounds(ev.world, contentBox(l, ev, d.assets)) : null;
        })
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      const box = boxes.length
        ? boxes.reduce((a, b) => {
            const x = Math.min(a.x, b.x);
            const y = Math.min(a.y, b.y);
            return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          })
        : null;
      dragRef.current = { kind: 'move', start: d, x0: p.x, y0: p.y, items, box, moved: false };
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) ed.setSelected([]);
    dragRef.current = { kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive, base: additive ? selected : [] };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const p = point(e);
    const tm = ed.time.get();
    if (!drag) {
      if (tool === 'pen') {
        penRef.current.cursor = screenPoint(e);
        invalidate();
      } else if (tool === 'select' || tool === 'anchor') updateHover(e);
      return;
    }
    switch (drag.kind) {
      case 'move': {
        let dx = p.x - drag.x0;
        let dy = p.y - drag.y0;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        guidesRef.current = [];
        if (drag.box && ed.snapping && !(e.ctrlKey || e.metaKey)) {
          const snap = snapMove(drag.box, dx, dy, ed.doc.comp.width, ed.doc.comp.height, 6 / vp.zoom);
          dx = snap.dx;
          dy = snap.dy;
          guidesRef.current = snap.guides;
        }
        if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) * vp.zoom < 2) return;
        drag.moved = true;
        ed.setDoc(applyMove(drag.start, drag.items, dx, dy, tm), { record: false });
        break;
      }
      case 'scale': {
        const value = scaleFor(drag.d, p.x, p.y, e.shiftKey);
        ed.setDoc(setPropAt(drag.start, drag.d.id, 'scale', value, tm), { record: false });
        break;
      }
      case 'rotate':
        ed.setDoc(setPropAt(drag.start, drag.d.id, 'rotation', rotationFor(drag.d, p.x, p.y, e.shiftKey), tm), { record: false });
        break;
      case 'anchor':
        ed.setDoc(applyAnchor(drag.start, drag.d, p.x, p.y, tm), { record: false });
        break;
      case 'motionKey':
        ed.setDoc(applyMotionKey(drag.start, drag.id, drag.keyId, drag.v0, drag.inv, p.x - drag.x0, p.y - drag.y0), { record: false });
        break;
      case 'pathEdit': {
        const [lx, ly] = [drag.invWorld[0] * p.x + drag.invWorld[2] * p.y + drag.invWorld[4], drag.invWorld[1] * p.x + drag.invWorld[3] * p.y + drag.invWorld[5]];
        ed.setDoc(applyPathEdit(drag.start, drag.id, drag.sub, drag.node, drag.part, lx, ly, e.altKey), { record: false });
        break;
      }
      case 'marquee':
        drag.x1 = p.x;
        drag.y1 = p.y;
        invalidate();
        break;
      case 'draw':
        drag.x1 = p.x;
        drag.y1 = p.y;
        invalidate();
        break;
      case 'pen': {
        const pen = penRef.current;
        const last = pen.nodes[pen.nodes.length - 1];
        if (!last || !pen.dragging) break;
        const ox = p.x - last.x;
        const oy = p.y - last.y;
        if (Math.hypot(ox, oy) * vp.zoom < 3) break;
        pen.nodes = [...pen.nodes.slice(0, -1), { ...last, outX: ox, outY: oy, inX: -ox, inY: -oy }];
        invalidate();
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    guidesRef.current = [];
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    if (!drag) return;
    switch (drag.kind) {
      case 'move':
        if (drag.moved) ed.commit('Move');
        break;
      case 'scale':
        ed.commit('Scale');
        break;
      case 'rotate':
        ed.commit('Rotate');
        break;
      case 'anchor':
        ed.commit('Move anchor point');
        break;
      case 'motionKey':
        ed.commit('Edit motion path');
        break;
      case 'pathEdit':
        ed.commit('Edit path');
        break;
      case 'marquee': {
        const r = rectFrom(drag.x0, drag.y0, drag.x1, drag.y1);
        if (r.w * vp.zoom > 3 || r.h * vp.zoom > 3) {
          const ids = layersInRect(ed.doc, evaluated(ed.doc, ed.time.get()), r, ed.time.get());
          ed.setSelected([...new Set([...drag.base, ...ids])]);
        }
        break;
      }
      case 'draw':
        createShape(SHAPE_TOOLS[drag.tool], drag.x0, drag.y0, drag.x1, drag.y1, e.shiftKey, e.altKey);
        break;
      case 'pen':
        penRef.current.dragging = false;
        break;
    }
    invalidate();
  };

  const updateHover = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const s = screenPoint(e);
    const h = hitHandle(handlesRef.current, s.x, s.y);
    let cursor = tool === 'anchor' ? 'crosshair' : 'default';
    if (h && (h.id !== 'anchor' || tool === 'anchor' || e.altKey)) cursor = HANDLE_CURSORS[h.id];
    const p = point(e);
    const tm = ed.time.get();
    const hit = h ? null : hitTestLayers(ed.doc, evaluated(ed.doc, tm), p.x, p.y, tm, 4 / vp.zoom);
    if (hit && cursor === 'default') cursor = 'move';
    if (container.style.cursor !== cursor) container.style.cursor = cursor;
    if (hoverRef.current !== hit) {
      hoverRef.current = hit;
      invalidate();
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'pen') {
      // The double click's first click already added a node; drop the duplicate.
      const pen = penRef.current;
      if (pen.nodes.length > 2) pen.nodes = pen.nodes.slice(0, -1);
      finishPen(false);
      return;
    }
    const p = point(e);
    const tm = ed.time.get();
    const hit = hitTestLayers(ed.doc, evaluated(ed.doc, tm), p.x, p.y, tm, 4 / vp.zoom);
    const layer = layerById(ed.doc, hit);
    if (layer?.type === 'text') ed.editText(layer.id);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const p = point(e);
    const tm = ed.time.get();
    const hit = hitTestLayers(ed.doc, evaluated(ed.doc, tm), p.x, p.y, tm, 4 / vp.zoom);
    if (!hit) return;
    const ids = selected.includes(hit) ? selected : [hit];
    if (!selected.includes(hit)) ed.setSelected([hit]);
    const entries: MenuEntry[] = [
      { label: t('Duplicate'), shortcut: 'Ctrl+D', onClick: () => {
        const r = duplicateLayers(ed.doc, ids);
        ed.setDoc(r.doc, { label: 'Duplicate' });
        ed.setSelected(r.ids);
      } },
      { label: t('Delete'), shortcut: 'Del', onClick: () => {
        ed.setDoc(removeLayers(ed.doc, ids), { label: 'Delete layers' });
        ed.setSelected([]);
      } },
      { type: 'separator' },
      { label: t('Bring to Front'), onClick: () => ed.setDoc(reorderLayers(ed.doc, ids, 'top'), { label: 'Reorder' }) },
      { label: t('Send to Back'), onClick: () => ed.setDoc(reorderLayers(ed.doc, ids, 'bottom'), { label: 'Reorder' }) },
      { type: 'separator' },
      { label: t('Animation Presets'), submenu: presetMenu(ids) },
      { label: t('Remove Animation'), onClick: () => {
        ed.setDoc(removeAllAnimation(ed.doc, ids, ed.time.get()), { label: 'Remove animation' });
        toast.info(t('Animation removed'));
      } },
    ];
    ctxMenu.show(e.clientX, e.clientY, entries);
  };

  const onPointerLeave = () => {
    if (hoverRef.current) {
      hoverRef.current = null;
      invalidate();
    }
    if (penRef.current.cursor) {
      penRef.current.cursor = null;
      invalidate();
    }
  };

  const toolCursor = tool === 'hand' || vp.spaceHeld ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div
      ref={containerRef}
      className="canvas-viewport mo-stage"
      style={{ cursor: toolCursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} className="mo-stage-canvas" />
      <canvas ref={overlayRef} className="mo-stage-canvas" />
      {ctxMenu.element}
    </div>
  );
}
