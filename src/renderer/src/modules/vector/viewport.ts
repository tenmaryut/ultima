import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Pt, Rect } from './matrix';

export interface View {
  zoom: number;
  /** Screen position (container px) of world (0,0). */
  x: number;
  y: number;
}

export interface VectorViewport {
  view: View;
  setView: (v: View) => void;
  zoomAt: (zoom: number, anchor?: Pt) => void;
  zoomIn: (anchor?: Pt) => void;
  zoomOut: (anchor?: Pt) => void;
  /** Fits a world rectangle into the container. */
  fitRect: (r: Rect, padding?: number) => void;
  /** 100% zoom centered on a world point. */
  actualSize: (center: Pt) => void;
  screenToWorld: (clientX: number, clientY: number) => Pt;
  worldToScreen: (p: Pt) => Pt;
  startPan: (e: { clientX: number; clientY: number }) => void;
  spaceHeld: boolean;
  /** Container size (px). */
  size: { width: number; height: number };
}

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 256;
const STEPS = [0.01, 0.02, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];

/**
 * Zoom/pan for the vector canvas: Ctrl/Cmd+wheel (or pinch) zooms at the cursor, wheel
 * pans, middle mouse and Space+drag pan. Listeners are removed while `active` is false.
 */
export function useVectorViewport(containerRef: RefObject<HTMLElement | null>, active: boolean): VectorViewport {
  const [view, setViewState] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [containerRef]);

  const zoomAt = useCallback(
    (zoom: number, anchor?: Pt) => {
      const el = containerRef.current;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      const a = anchor ?? { x: (el?.clientWidth ?? 800) / 2, y: (el?.clientHeight ?? 600) / 2 };
      const v = viewRef.current;
      const wx = (a.x - v.x) / v.zoom;
      const wy = (a.y - v.y) / v.zoom;
      setView({ zoom: z, x: a.x - wx * z, y: a.y - wy * z });
    },
    [containerRef, setView],
  );

  const zoomIn = useCallback((anchor?: Pt) => zoomAt(STEPS.find((s) => s > viewRef.current.zoom * 1.001) ?? MAX_ZOOM, anchor), [zoomAt]);
  const zoomOut = useCallback(
    (anchor?: Pt) => zoomAt([...STEPS].reverse().find((s) => s < viewRef.current.zoom * 0.999) ?? MIN_ZOOM, anchor),
    [zoomAt],
  );

  const fitRect = useCallback(
    (r: Rect, padding = 48) => {
      const el = containerRef.current;
      const w = el?.clientWidth || 800;
      const h = el?.clientHeight || 600;
      const rw = Math.max(1, r.width);
      const rh = Math.max(1, r.height);
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - padding * 2) / rw, (h - padding * 2) / rh)));
      setView({ zoom, x: w / 2 - (r.x + rw / 2) * zoom, y: h / 2 - (r.y + rh / 2) * zoom });
    },
    [containerRef, setView],
  );

  const actualSize = useCallback(
    (center: Pt) => {
      const el = containerRef.current;
      setView({ zoom: 1, x: (el?.clientWidth ?? 800) / 2 - center.x, y: (el?.clientHeight ?? 600) / 2 - center.y });
    },
    [containerRef, setView],
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = containerRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (clientX - (rect?.left ?? 0) - v.x) / v.zoom, y: (clientY - (rect?.top ?? 0) - v.y) / v.zoom };
    },
    [containerRef],
  );

  const worldToScreen = useCallback((p: Pt): Pt => {
    const v = viewRef.current;
    return { x: v.x + p.x * v.zoom, y: v.y + p.y * v.zoom };
  }, []);

  const startPan = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const start = { x: e.clientX, y: e.clientY, view: viewRef.current };
      const move = (ev: PointerEvent) => setView({ ...start.view, x: start.view.x + ev.clientX - start.x, y: start.view.y + ev.clientY - start.y });
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setView],
  );

  // wheel zoom/pan + middle mouse pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !active) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        zoomAt(v.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        const unit = e.deltaMode === 1 ? 16 : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
        setView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        startPan(e);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
    };
  }, [containerRef, active, zoomAt, setView, startPan]);

  // space = temporary hand tool
  useEffect(() => {
    if (!active) return;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [active]);

  return { view, setView, zoomAt, zoomIn, zoomOut, fitRect, actualSize, screenToWorld, worldToScreen, startPan, spaceHeld, size };
}

export function formatZoom(zoom: number): string {
  return `${zoom >= 1 ? Math.round(zoom * 100) : (zoom * 100).toFixed(zoom < 0.1 ? 1 : 0)}%`;
}
