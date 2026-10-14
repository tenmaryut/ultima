/**
 * One page of the continuous viewer: pdf.js canvas (rendered at devicePixelRatio and
 * re-rendered after zoom settles), selectable text layer, highlight layer (multiply),
 * form controls and the annotation layer.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../../../core/i18n';
import { engine, PDF_ANNOTATION_MODE, pdfjs } from '../engine';
import { CSS_UNITS, viewportTransform, type Rotation } from '../geometry';
import { pageRegistry } from '../context';
import { usePdfUi, type FindMatch } from '../store';
import type { Annot, FieldValue, PageEntry, PageInfo } from '../types';
import { AnnotLayer } from '../annotations/AnnotLayer';
import { HighlightShapes, matrixAttr } from '../annotations/AnnotShapes';
import { usePageInteractions } from '../annotations/interactions';
import { FieldLayer, type PageWidget } from './FieldLayer';

export interface PageViewProps {
  entry: PageEntry;
  index: number;
  info: PageInfo;
  rotation: Rotation;
  zoom: number;
  renderZoom: number;
  box: { top: number; left: number; width: number; height: number };
  annots: Annot[];
  widgets: PageWidget[];
  fields: Record<string, FieldValue>;
  matches: FindMatch[];
  activeMatch: FindMatch | null;
  priority: number;
}

export const PageView = memo(function PageView(props: PageViewProps) {
  const { entry, index, info, rotation, zoom, renderZoom, box, annots, widgets, fields, matches, activeMatch } = props;
  const t = useT();
  const tool = usePdfUi((s) => s.tool);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const priorityRef = useRef(props.priority);
  priorityRef.current = props.priority;

  const m = useMemo(() => viewportTransform(info.view, zoom * CSS_UNITS, rotation, info.userUnit), [info, zoom, rotation]);
  const geom = useMemo(() => ({ entry, info, rotation, m }), [entry, info, rotation, m]);
  const interactions = usePageInteractions(geom, pageRef);
  const annotationMode = widgets.length ? PDF_ANNOTATION_MODE.ENABLE_FORMS : PDF_ANNOTATION_MODE.ENABLE;

  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    pageRegistry.set(entry.id, { el, m, index });
    return () => {
      if (pageRegistry.get(entry.id)?.el === el) pageRegistry.delete(entry.id);
    };
  }, [entry.id, m, index]);

  // Canvas
  useEffect(() => {
    const ctrl = new AbortController();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    engine
      .renderCanvas(entry.src, entry.index, renderZoom * CSS_UNITS * dpr * (info.userUnit || 1), rotation, {
        signal: ctrl.signal,
        priority: priorityRef.current,
        annotationMode,
      })
      .then((canvas) => {
        const wrap = canvasWrap.current;
        if (ctrl.signal.aborted || !wrap) {
          canvas.width = canvas.height = 0;
          return;
        }
        canvas.className = 'pd-canvas';
        const old = wrap.firstChild;
        wrap.replaceChildren(canvas);
        if (old instanceof HTMLCanvasElement) old.width = old.height = 0;
        setState('ready');
      })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted || error instanceof pdfjs.RenderingCancelledException || (error as Error)?.name === 'AbortError') return;
        console.warn('[pdf] render failed', error);
        setState('error');
      });
    return () => ctrl.abort();
  }, [entry.src, entry.index, rotation, renderZoom, annotationMode, info.userUnit]);

  // Release the bitmap when the page leaves the viewport.
  useEffect(
    () => () => {
      const c = canvasWrap.current?.firstChild;
      if (c instanceof HTMLCanvasElement) c.width = c.height = 0;
    },
    [],
  );

  // Selectable text layer
  useEffect(() => {
    let cancelled = false;
    let layer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    const container = textRef.current;
    void (async () => {
      const [page, text] = await Promise.all([engine.page(entry.src, entry.index), engine.text(entry.src, entry.index)]);
      if (cancelled || !container) return;
      const viewport = page.getViewport({ scale: renderZoom * CSS_UNITS, rotation });
      container.replaceChildren();
      layer = new pdfjs.TextLayer({ textContentSource: text.content, container, viewport });
      await layer.render();
      if (cancelled) return;
      const end = document.createElement('div');
      end.className = 'pd-endofcontent';
      container.append(end);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [entry.src, entry.index, rotation, renderZoom]);

  const pageStyle = {
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
    '--scale-factor': zoom * CSS_UNITS,
    '--user-unit': info.userUnit || 1,
  } as CSSProperties;

  return (
    <div
      ref={pageRef}
      className="pd-page"
      data-page-index={index}
      data-page-id={entry.id}
      data-tool={tool}
      style={pageStyle}
      onPointerDown={interactions.onPagePointerDown}
    >
      <div ref={canvasWrap} className="pd-canvas-wrap" />
      {state === 'loading' && <div className="pd-page-loading" />}
      {state === 'error' && <div className="pd-page-error">{t('This page could not be displayed')}</div>}
      <svg className="pd-markup-layer" width={box.width} height={box.height}>
        <g transform={matrixAttr(m)}>
          <HighlightShapes annots={annots} />
          {matches.map((match, i) => (
            <g key={i} className={match === activeMatch ? 'pd-find-active' : 'pd-find-match'}>
              {match.rects.map((r, j) => (
                <rect key={j} x={r.x} y={r.y} width={r.w} height={r.h} />
              ))}
            </g>
          ))}
        </g>
      </svg>
      <div
        ref={textRef}
        className="pd-textlayer"
        onPointerDown={(e) => {
          const el = e.currentTarget;
          el.classList.add('selecting');
          const up = () => {
            el.classList.remove('selecting');
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointerup', up);
        }}
      />
      {widgets.length > 0 && <FieldLayer widgets={widgets} m={m} fields={fields} />}
      <AnnotLayer
        geom={geom}
        width={box.width}
        height={box.height}
        annots={annots}
        preview={interactions.preview}
        onObjectPointerDown={interactions.onObjectPointerDown}
        onHandlePointerDown={interactions.onHandlePointerDown}
      />
    </div>
  );
});
