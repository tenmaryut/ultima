import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { EditorCore } from '../editor';
import { hitTest } from '../geometry';
import type { Pt } from '../matrix';
import { ArtboardLayer, DocObjects } from '../render';
import { EMPTY_OVERLAY, type Gesture, type OverlayState, type PointerInfo, type ToolCtx } from '../tools/common';
import { addPointAt, directDown, isNodeEditable, segmentAt } from '../tools/direct';
import { eyedropperDown, pencilGesture, shapeGesture, textDown, zoomGesture, type ShapeTool } from '../tools/draw';
import { createPen, type PenController } from '../tools/pen';
import { pickObject, resizeGesture, rotateGesture, scopeInfo, selectDown } from '../tools/select';
import type { HandleId } from '../tools/common';
import { Overlay } from './Overlay';
import { TextEditor } from './TextEditor';

const CURSORS: Record<string, string> = {
  select: 'default',
  direct: 'default',
  pen: 'crosshair',
  pencil: 'crosshair',
  rect: 'crosshair',
  ellipse: 'crosshair',
  polygon: 'crosshair',
  star: 'crosshair',
  line: 'crosshair',
  text: 'text',
  eyedropper: 'copy',
  hand: 'grab',
  zoom: 'zoom-in',
};

export interface CanvasProps {
  core: EditorCore;
  containerRef: RefObject<HTMLDivElement | null>;
  penRef: RefObject<PenController | null>;
  onCursor: (p: Pt | null) => void;
  onContextMenu: (e: React.MouseEvent, world: Pt) => void;
  children?: ReactNode;
}

export function Canvas({ core, containerRef, penRef, onCursor, onContextMenu, children }: CanvasProps) {
  const [overlay, setOverlayState] = useState<OverlayState>(EMPTY_OVERLAY);
  const coreRef = useRef(core);
  coreRef.current = core;
  const gestureRef = useRef<Gesture | null>(null);
  const [panning, setPanning] = useState(false);

  const setOverlay = useCallback((patch: Partial<OverlayState>) => {
    setOverlayState((o) => {
      for (const k of Object.keys(patch) as (keyof OverlayState)[]) if (o[k] !== patch[k]) return { ...o, ...patch };
      return o;
    });
  }, []);

  const ctx = useMemo<ToolCtx>(() => ({ core: () => coreRef.current, setOverlay, px: () => 1 / coreRef.current.viewport.view.zoom }), [setOverlay]);
  const pen = useMemo(() => createPen(ctx), [ctx]);
  penRef.current = pen;

  // clear transient overlays when the tool changes
  useEffect(() => {
    setOverlay({ hover: null, segmentHint: null, guides: [], marquee: null });
  }, [core.tool, setOverlay]);

  const info = (e: React.PointerEvent | React.MouseEvent): PointerInfo => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      world: core.viewport.screenToWorld(e.clientX, e.clientY),
      screen: { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) },
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.ctrlKey || e.metaKey,
      button: e.button,
      target: e.target as Element,
      detail: e.detail,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // keep the browser from moving focus (it would blur a text editor we create now),
    // but commit any field the user was typing in
    e.preventDefault();
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused !== document.body && !containerRef.current?.contains(focused)) focused.blur();
    const p = info(e);
    const tool = core.tool;
    if (tool === 'hand' || core.viewport.spaceHeld) {
      core.viewport.startPan(e);
      setPanning(true);
      const stop = () => {
        setPanning(false);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointerup', stop);
      return;
    }
    let g: Gesture | null = null;
    const handle = (e.target as Element).closest?.('[data-handle]')?.getAttribute('data-handle');
    switch (tool) {
      case 'select':
        if (handle === 'rot') g = rotateGesture(ctx, p);
        else if (handle) g = resizeGesture(ctx, p, handle as HandleId);
        else g = selectDown(ctx, p);
        break;
      case 'direct':
        g = directDown(ctx, p);
        break;
      case 'pen':
        g = pen.down(p);
        break;
      case 'pencil':
        g = pencilGesture(ctx, p);
        break;
      case 'rect':
      case 'ellipse':
      case 'polygon':
      case 'star':
      case 'line':
        g = shapeGesture(ctx, p, tool as ShapeTool);
        break;
      case 'text':
        g = textDown(ctx, p);
        break;
      case 'eyedropper':
        g = eyedropperDown(ctx, p);
        break;
      case 'zoom':
        g = zoomGesture(ctx, p);
        break;
    }
    if (g) {
      e.preventDefault();
      gestureRef.current = g;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const hoverFrame = useRef(0);
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = info(e);
    onCursor(p.world);
    const g = gestureRef.current;
    if (g) {
      g.move(p);
      return;
    }
    if (hoverFrame.current) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const c = coreRef.current;
      const tol = 4 / c.viewport.view.zoom;
      if (c.tool === 'select') {
        const { list, m } = scopeInfo(c.doc.objects, c.scope);
        const hit = hitTest(list, p.world, tol, m);
        setOverlay({ hover: hit ? (p.mod ? hit[hit.length - 1].id : hit[0].id) : null });
      } else if (c.tool === 'direct') {
        const hit = hitTest(c.doc.objects, p.world, tol);
        setOverlay({ hover: hit ? hit[hit.length - 1].id : null });
      } else if (c.tool === 'pen') {
        if (pen.isDrawing()) pen.hover(p);
        else {
          const s = segmentAt(c, p.world, 6 / c.viewport.view.zoom);
          setOverlay({ segmentHint: s ? s.point : null });
        }
      }
    });
  };

  const endGesture = (e: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    if (cancel) g.cancel?.();
    else g.up(info(e));
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = info(e);
    const c = coreRef.current;
    const tol = 4 / c.viewport.view.zoom;
    if (c.tool === 'select') {
      const { list, m } = scopeInfo(c.doc.objects, c.scope);
      const hit = hitTest(list, p.world, tol, m);
      if (!hit) {
        if (c.scope) c.setScope(null);
        return;
      }
      const target = hit[0];
      if (target.type === 'group' && hit.length > 1) {
        c.setScope(target.id);
        c.setSelection([hit[1].id]);
      } else if (target.type === 'text' && !target.onPath) {
        c.setSelection([target.id]);
        c.setEditingText(target.id);
      } else if (isNodeEditable(target)) {
        c.setSelection([target.id]);
        c.setTool('direct');
      }
    } else if (c.tool === 'direct') {
      if (addPointAt(c, p.world, 6 / c.viewport.view.zoom)) return;
      const id = pickObject(ctx, p.world, true);
      const hit = hitTest(c.doc.objects, p.world, tol);
      const leaf = hit?.[hit.length - 1];
      if (leaf?.type === 'text' && !leaf.onPath) {
        c.setTool('select');
        c.setSelection([leaf.id]);
        c.setEditingText(leaf.id);
      } else if (id) c.setSelection([id]);
    }
  };

  const view = core.viewport.view;
  const ab = core.activeArtboard;
  const gridOn = core.viewOpts.grid && core.viewOpts.gridSize * view.zoom >= 4;
  const cursor = panning ? 'grabbing' : core.viewport.spaceHeld ? 'grab' : core.tool === 'zoom' && overlay.zoomRect === null ? 'zoom-in' : CURSORS[core.tool];

  return (
    <div
      ref={containerRef}
      className="vc-canvas canvas-viewport"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endGesture(e)}
      onPointerCancel={(e) => endGesture(e, true)}
      onPointerLeave={() => {
        onCursor(null);
        if (!gestureRef.current) setOverlay({ hover: null, segmentHint: null });
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, core.viewport.screenToWorld(e.clientX, e.clientY));
      }}
    >
      <svg className="vc-svg" width="100%" height="100%">
        <defs>
          <pattern id="vc-checker" width={16} height={16} patternUnits="userSpaceOnUse" patternTransform={`scale(${1 / view.zoom})`}>
            <rect width={16} height={16} fill="#ffffff" />
            <rect width={8} height={8} fill="#d9d9d9" />
            <rect x={8} y={8} width={8} height={8} fill="#d9d9d9" />
          </pattern>
          {gridOn && (
            <pattern
              id="vc-grid"
              width={core.viewOpts.gridSize}
              height={core.viewOpts.gridSize}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${ab.x} ${ab.y})`}
            >
              <path d={`M${core.viewOpts.gridSize} 0H0V${core.viewOpts.gridSize}`} fill="none" stroke="rgba(0, 140, 255, 0.35)" strokeWidth={1 / view.zoom} />
            </pattern>
          )}
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <ArtboardLayer artboards={core.doc.artboards} zoom={view.zoom} />
          <DocObjects objects={core.doc.objects} prefix="vc-" hidden={core.editingText} outline={core.viewOpts.outline} zoom={view.zoom} />
          {gridOn &&
            core.doc.artboards.map((a) => <rect key={a.id} x={a.x} y={a.y} width={a.width} height={a.height} fill="url(#vc-grid)" pointerEvents="none" />)}
        </g>
        <Overlay core={core} overlay={overlay} showHandles={core.tool === 'select'} />
      </svg>
      {core.editingText && <TextEditor key={core.editingText} core={core} id={core.editingText} />}
      {children}
    </div>
  );
}
