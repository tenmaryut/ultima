import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface ViewState {
  zoom: number;
  /** Screen position (px, relative to the container) of the document's origin. */
  x: number;
  y: number;
}

export interface ViewportApi {
  view: ViewState;
  zoom: number;
  setView: (v: ViewState) => void;
  /** Zoom keeping the given container point (default: center) fixed. */
  zoomTo: (zoom: number, anchor?: { x: number; y: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Fit the whole document inside the container with some padding. */
  fit: () => void;
  /** 100% zoom, centered. */
  actualSize: () => void;
  /** Zoom and pan so a document rectangle fills the container (e.g. zoom to selection). */
  fitRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** Converts client (mouse event) coordinates into document coordinates. */
  screenToDoc: (clientX: number, clientY: number) => { x: number; y: number };
  docToScreen: (x: number, y: number) => { x: number; y: number };
  /** CSS transform for an element that is `docWidth x docHeight` px in size (transform-origin 0 0). */
  transform: string;
  /** Start panning from a pointerdown event (hand tool / middle mouse / space+drag). */
  startPan: (e: React.PointerEvent | PointerEvent) => void;
  /** True while the space bar is held (modules should show a grab cursor and pan on drag). */
  spaceHeld: boolean;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;
const STEPS = [0.02, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

/**
 * Pan/zoom state for a document shown inside `containerRef`.
 * - Ctrl/Cmd + wheel (and trackpad pinch) zooms around the cursor, plain wheel pans.
 * - Middle mouse drag or Space + drag pans (call `startPan` from your pointerdown handler
 *   when `spaceHeld` is true or the hand tool is active).
 * - The document is fitted automatically the first time its size is known and whenever
 *   `fitKey` changes (e.g. a new document was opened).
 */
export function useViewport(
  containerRef: RefObject<HTMLElement | null>,
  docWidth: number,
  docHeight: number,
  options: {
    padding?: number;
    fitKey?: unknown;
    active?: boolean;
    /** Re-fit automatically when the document size changes (default true). `fitKey` changes always re-fit. */
    autoFitOnResize?: boolean;
  } = {},
): ViewportApi {
  const padding = options.padding ?? 40;
  const [view, setViewState] = useState<ViewState>({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const setView = useCallback((v: ViewState) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  const containerSize = () => {
    const el = containerRef.current;
    return { w: el?.clientWidth ?? 800, h: el?.clientHeight ?? 600 };
  };

  const fit = useCallback(() => {
    const { w, h } = containerSize();
    if (!docWidth || !docHeight) return;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - padding * 2) / docWidth, (h - padding * 2) / docHeight)));
    setView({ zoom, x: (w - docWidth * zoom) / 2, y: (h - docHeight * zoom) / 2 });
  }, [docWidth, docHeight, padding, setView]);

  const zoomTo = useCallback(
    (zoom: number, anchor?: { x: number; y: number }) => {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      const { w, h } = containerSize();
      const a = anchor ?? { x: w / 2, y: h / 2 };
      const v = viewRef.current;
      const docX = (a.x - v.x) / v.zoom;
      const docY = (a.y - v.y) / v.zoom;
      setView({ zoom: z, x: a.x - docX * z, y: a.y - docY * z });
    },
    [setView],
  );

  const zoomIn = useCallback(() => {
    const z = viewRef.current.zoom;
    zoomTo(STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM);
  }, [zoomTo]);
  const zoomOut = useCallback(() => {
    const z = viewRef.current.zoom;
    zoomTo([...STEPS].reverse().find((s) => s < z * 0.999) ?? MIN_ZOOM);
  }, [zoomTo]);
  const actualSize = useCallback(() => {
    const { w, h } = containerSize();
    setView({ zoom: 1, x: (w - docWidth) / 2, y: (h - docHeight) / 2 });
  }, [docWidth, docHeight, setView]);

  const fitRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const { w, h } = containerSize();
      if (rect.width <= 0 || rect.height <= 0) return;
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((w - padding * 2) / rect.width, (h - padding * 2) / rect.height)));
      setView({ zoom, x: (w - rect.width * zoom) / 2 - rect.x * zoom, y: (h - rect.height * zoom) / 2 - rect.y * zoom });
    },
    [padding, setView],
  );

  // Auto-fit on first size / new document (fitKey) / document resize (unless disabled).
  const fitted = useRef<{ key: unknown; size: string } | null>(null);
  const autoFitOnResize = options.autoFitOnResize ?? true;
  useEffect(() => {
    if (!docWidth || !docHeight) return;
    const el = containerRef.current;
    if (!el || !el.clientWidth) return;
    const size = `${docWidth}x${docHeight}`;
    const prev = fitted.current;
    const needed = !prev || prev.key !== options.fitKey || (autoFitOnResize && prev.size !== size);
    if (!needed) return;
    fitted.current = { key: options.fitKey, size };
    fit();
  });

  // The container may mount after this hook first runs (e.g. a start screen is shown first):
  // reading the ref during render lets the listeners below re-attach once it exists.
  const containerEl = containerRef.current;

  // Wheel zoom / pan.
  useEffect(() => {
    const el = containerEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        zoomTo(v.zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerEl, zoomTo, setView]);

  // Space bar = temporary hand tool.
  useEffect(() => {
    if (options.active === false) return;
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false);
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [options.active]);

  // Middle mouse pans anywhere in the container.
  const startPan = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const start = { x: e.clientX, y: e.clientY, view: viewRef.current };
      const move = (ev: PointerEvent) => {
        setView({ ...start.view, x: start.view.x + ev.clientX - start.x, y: start.view.y + ev.clientY - start.y });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setView],
  );
  useEffect(() => {
    const el = containerEl;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        startPan(e);
      }
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [containerEl, startPan]);

  const screenToDoc = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (clientX - (rect?.left ?? 0) - v.x) / v.zoom, y: (clientY - (rect?.top ?? 0) - v.y) / v.zoom };
    },
    [containerRef],
  );
  const docToScreen = useCallback((x: number, y: number) => {
    const v = viewRef.current;
    return { x: v.x + x * v.zoom, y: v.y + y * v.zoom };
  }, []);

  return {
    view,
    zoom: view.zoom,
    setView,
    zoomTo,
    zoomIn,
    zoomOut,
    fit,
    actualSize,
    fitRect,
    screenToDoc,
    docToScreen,
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
    startPan,
    spaceHeld,
  };
}

export function formatZoom(zoom: number): string {
  return `${zoom >= 1 ? Math.round(zoom * 100) : (zoom * 100).toFixed(zoom < 0.1 ? 1 : 0)}%`;
}
