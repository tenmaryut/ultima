import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { useT } from '../../../core/i18n';
import { useElementSize } from '../../../core/hooks';
import { useViewport, type ViewportApi } from '../../../core/viewport';
import { unionRects } from '../geometry';
import { getFrames, pageGeometry, selectionBounds, threadOf } from '../ops';
import { PageView } from '../PageView';
import { MASTER_ID, type Frame, type Point, type Rect } from '../types';
import type { LayoutEditor } from '../useLayoutEditor';
import { InlineEditor } from './InlineEditor';
import { Overlay } from './Overlay';
import { Rulers } from './Rulers';
import { RULER, hitTest, useCanvasInteraction } from './useCanvasInteraction';
import { computeWorld, nearestSlot, slotAt, spreadOf, spreads, type PageSlot } from './world';

export interface CanvasApi {
  vp: ViewportApi;
  fit: () => void;
  actualSize: () => void;
  /** Page id + page point under the last drag-over position (for dropped files). */
  dropTarget: () => { pageId: string; point: Point } | null;
}

interface Props {
  ed: LayoutEditor;
  active: boolean;
  apiRef: Ref<CanvasApi>;
  onPickImage: (frameId: string) => void;
  onContextMenu: (e: React.MouseEvent, frame: Frame | null) => void;
  onZoom?: (zoom: number) => void;
}

export function Canvas({ ed, active, apiRef, onPickImage, onContextMenu, onZoom }: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const doc = ed.doc;
  const world = useMemo(
    () => computeWorld(doc, ed.view.mode, ed.pageIndex, ed.pageId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.pages, doc.facing, ed.view.mode, ed.pageIndex, ed.pageId],
  );
  // area auto-fitted by the viewport: the current spread (single) or the first spread (continuous)
  const fitArea = useMemo(() => {
    if (ed.pageId === MASTER_ID || ed.view.mode === 'single') return { w: world.width, h: world.height };
    const first = spreads(doc)[0] ?? [0];
    const r = unionRects(world.slots.filter((s) => first.includes(s.index)).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })));
    return { w: r ? r.x + r.w : world.width, h: r ? r.y + r.h : world.height };
  }, [world, doc, ed.pageId, ed.view.mode]);
  const vp = useViewport(containerRef, fitArea.w, fitArea.h, { fitKey: `${ed.docKey}|${ed.view.mode}|${ed.pageId === MASTER_ID}`, active, padding: 48 });

  useEffect(() => {
    onZoom?.(vp.zoom);
  }, [vp.zoom, onZoom]);

  const currentSpreadRect = (): Rect | null => {
    if (ed.pageId === MASTER_ID) return world.slots[0] ?? null;
    const ids = spreadOf(doc, Math.max(0, ed.pageIndex));
    return unionRects(world.slots.filter((s) => ids.includes(s.index)));
  };

  const fitRect = (r: Rect | null, keepZoom = false) => {
    const el = containerRef.current;
    if (!el || !r) return;
    const pad = 48 + (ed.view.rulers ? RULER : 0);
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const zoom = keepZoom ? vp.zoom : Math.max(0.02, Math.min(64, Math.min((cw - pad * 2) / r.w, (ch - pad * 2) / r.h)));
    const y = keepZoom && r.h * zoom > ch - pad * 2 ? pad - r.y * zoom : (ch - r.h * zoom) / 2 - r.y * zoom;
    vp.setView({ zoom, x: (cw - r.w * zoom) / 2 - r.x * zoom, y });
  };

  const dropPoint = useRef<Point | null>(null);
  useImperativeHandle(apiRef, () => ({
    vp,
    fit: () => fitRect(currentSpreadRect()),
    actualSize: () => {
      const r = currentSpreadRect();
      const el = containerRef.current;
      if (!r || !el) return;
      vp.setView({ zoom: 1, x: (el.clientWidth - r.w) / 2 - r.x, y: Math.min((el.clientHeight - r.h) / 2, 40) - r.y });
    },
    dropTarget: () => {
      const w = dropPoint.current;
      if (!w) return null;
      const slot = slotAt(world, w) ?? nearestSlot(world, w);
      return slot ? { pageId: slot.id, point: { x: w.x - slot.x, y: w.y - slot.y } } : null;
    },
  }));

  // switching to continuous view: keep the current page in view
  const lastMode = useRef(ed.view.mode);
  useEffect(() => {
    if (lastMode.current === ed.view.mode) return;
    lastMode.current = ed.view.mode;
    const id = requestAnimationFrame(() => fitRect(currentSpreadRect()));
    return () => cancelAnimationFrame(id);
  });

  // continuous view: bring the current page into view when navigating to it
  const lastPage = useRef(ed.pageId);
  useEffect(() => {
    if (lastPage.current === ed.pageId) return;
    lastPage.current = ed.pageId;
    if (ed.view.mode !== 'continuous') return;
    const slot = world.slots.find((s) => s.id === ed.pageId);
    const el = containerRef.current;
    if (!slot || !el) return;
    const a = vp.docToScreen(slot.x, slot.y);
    const b = vp.docToScreen(slot.x + slot.w, slot.y + slot.h);
    const visible = b.y > el.clientHeight * 0.15 && a.y < el.clientHeight * 0.85;
    if (!visible) fitRect(slot, true);
  });

  // continuous view: the page at the center becomes current while scrolling (when nothing is selected)
  useEffect(() => {
    if (ed.view.mode !== 'continuous' || ed.pageId === MASTER_ID || !active) return;
    const id = window.setTimeout(() => {
      const el = containerRef.current;
      if (!el || ed.selection.length || ed.editing) return;
      const c = vp.screenToDoc(el.getBoundingClientRect().left + el.clientWidth / 2, el.getBoundingClientRect().top + el.clientHeight / 2);
      const slot = nearestSlot(world, c);
      if (slot && slot.id !== ed.pageId) {
        lastPage.current = slot.id;
        ed.goToPage(slot.id);
      }
    }, 200);
    return () => window.clearTimeout(id);
  }, [vp.view, ed.view.mode, active, world, ed.pageId, ed.selection.length, ed.editing, vp, ed]);

  const ix = useCanvasInteraction({ ed, vp, world, containerRef, onPickImage });
  const [pointer, setPointer] = useState<{ x: number; y: number; client: { clientX: number; clientY: number } } | null>(null);

  const bleed = ed.view.bleed ? doc.bleed : 0;
  const hideContent = useMemo(() => {
    const e = ed.editing;
    if (!e) return undefined;
    if (e.cell) return new Set([`${e.id}:${e.cell[0]}:${e.cell[1]}`]);
    const f = getFrames(doc, e.pageId).find((x) => x.id === e.id);
    if (f?.type === 'text' && f.columns <= 1 && (e.pageId === MASTER_ID || threadOf(doc, f.id).length < 2)) return new Set([e.id]);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.editing, doc.pages, doc.master]);

  const curSlot = world.slots.find((s) => s.id === ed.pageId) ?? world.slots[0];
  const selBounds = ed.selected.length ? selectionBounds(ed.selected, ed.selection) : null;
  const flows = ed.pageId === MASTER_ID ? undefined : ed.flows;

  const renderSlot = (slot: PageSlot) => {
    const page = pageGeometry(doc, slot.id);
    return (
      <div key={slot.id} className="ly-page-wrap" style={{ left: slot.x - bleed, top: slot.y - bleed, width: slot.w + 2 * bleed, height: slot.h + 2 * bleed }}>
        <PageView
          doc={doc}
          page={page}
          pageIndex={slot.index}
          flows={flows}
          bleed={bleed}
          hideContent={slot.id === ed.editing?.pageId ? hideContent : undefined}
          editor
          idPrefix={`c${slot.index}`}
          className="ly-page"
        />
        {bleed > 0 && (
          <>
            <div className="ly-bleed-shade" style={{ left: 0, top: 0, width: slot.w + 2 * bleed, height: bleed }} />
            <div className="ly-bleed-shade" style={{ left: 0, top: slot.h + bleed, width: slot.w + 2 * bleed, height: bleed }} />
            <div className="ly-bleed-shade" style={{ left: 0, top: bleed, width: bleed, height: slot.h }} />
            <div className="ly-bleed-shade" style={{ left: slot.w + bleed, top: bleed, width: bleed, height: slot.h }} />
          </>
        )}
      </div>
    );
  };

  const labels = world.slots.length > 1 || ed.pageId === MASTER_ID;
  return (
    <div
      ref={containerRef}
      className={`ly-canvas ${ed.view.rulers ? 'with-rulers' : ''}`}
      style={{ cursor: ix.cursorFor(pointer?.client ?? null) }}
      onPointerDown={ix.onPointerDown}
      onPointerMove={(e) => {
        ix.onPointerMove(e);
        const r = containerRef.current?.getBoundingClientRect();
        setPointer({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), client: { clientX: e.clientX, clientY: e.clientY } });
      }}
      onPointerUp={ix.onPointerUp}
      onPointerCancel={ix.onPointerUp}
      onPointerLeave={() => setPointer(null)}
      onDoubleClick={ix.onDoubleClick}
      onDragOver={(e) => {
        dropPoint.current = vp.screenToDoc(e.clientX, e.clientY);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const w = vp.screenToDoc(e.clientX, e.clientY);
        const slot = slotAt(world, w);
        if (!slot) {
          onContextMenu(e, null);
          return;
        }
        if (slot.id !== ed.pageId) ed.goToPage(slot.id);
        const hit = hitTest(getFrames(doc, slot.id), { x: w.x - slot.x, y: w.y - slot.y }, vp.zoom);
        if (hit && !ed.selection.includes(hit.id)) ed.select([hit.id]);
        onContextMenu(e, hit);
      }}
    >
      <div className="ly-world" style={{ transform: vp.transform, width: world.width, height: world.height }}>
        {world.slots.map(renderSlot)}
        {ed.editing && curSlot && ed.editing.pageId === curSlot.id && <InlineEditor key={`${ed.editing.id}-${ed.editing.cell?.join(':') ?? ''}`} ed={ed} slot={curSlot} />}
      </div>
      <Overlay ed={ed} vp={vp} world={world} t={ix.transient} width={size.width} height={size.height} />
      {labels &&
        world.slots.map((slot) => {
          const p = vp.docToScreen(slot.x, slot.y);
          if (p.y < -30 || p.y > size.height) return null;
          return (
            <div key={slot.id} className={`ly-page-label ${slot.id === ed.pageId ? 'current' : ''}`} style={{ left: p.x, top: p.y - 20 }}>
              {slot.id === MASTER_ID ? t('Master page') : t('Page {n}', { n: slot.index + 1 })}
            </div>
          );
        })}
      {ed.view.rulers && curSlot && (
        <Rulers vp={vp} slot={curSlot} unit={doc.unit} width={size.width} height={size.height} selection={selBounds} pointer={pointer} />
      )}
      {ed.linking && <div className="ly-banner">{t('Click the text frame that should continue the text (Esc to cancel)')}</div>}
      {ed.contentId && <div className="ly-banner">{t('Drag to move the image inside its frame. Press Esc when done.')}</div>}
    </div>
  );
}
