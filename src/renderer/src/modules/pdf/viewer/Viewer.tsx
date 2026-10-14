/**
 * Continuous vertical page viewer with virtualization (only pages near the viewport
 * are mounted), zoom anchored at the cursor (Ctrl/Cmd + wheel, pinch), fit modes,
 * hand-tool panning and the floating text-selection toolbar.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, EyeOff, Highlighter, Strikethrough, Underline } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { useElementSize } from '../../../core/hooks';
import { toast } from '../../../components/ui';
import { engine } from '../engine';
import { clampZoom, CSS_UNITS, fitZoom, rectToScreen, viewportSize, viewportTransform, type Rect } from '../geometry';
import { selectionInTextLayer, useDoc } from '../context';
import { usePdfUi, type FindMatch } from '../store';
import type { Annot, FieldDef, PageEntry } from '../types';
import { markupSelection } from '../annotations/interactions';
import { PageView } from './PageView';
import type { PageWidget } from './FieldLayer';
import { FindBar } from './FindBar';

const GAP = 14;
const PAD = 18;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function pageAt(boxes: Box[], y: number): number {
  let lo = 0;
  let hi = boxes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (boxes[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Keeps array identities stable for pages whose objects did not change (memoized PageViews). */
function useAnnotsByPage(annots: Annot[]): Map<string, Annot[]> {
  const prev = useRef(new Map<string, Annot[]>());
  return useMemo(() => {
    const next = new Map<string, Annot[]>();
    for (const a of annots) {
      const list = next.get(a.page);
      if (list) list.push(a);
      else next.set(a.page, [a]);
    }
    for (const [page, list] of next) {
      const old = prev.current.get(page);
      if (old && old.length === list.length && old.every((a, i) => a === list[i])) next.set(page, old);
    }
    prev.current = next;
    return next;
  }, [annots]);
}

const EMPTY: never[] = [];

export function Viewer({ active }: { active: boolean }) {
  const t = useT();
  const history = useDoc();
  const doc = history.present;
  const scrollRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(scrollRef);
  const zoom = usePdfUi((s) => s.zoom);
  const zoomMode = usePdfUi((s) => s.zoomMode);
  const viewRotation = usePdfUi((s) => s.viewRotation);
  const scrollRequest = usePdfUi((s) => s.scrollRequest);
  const tool = usePdfUi((s) => s.tool);
  const docInfo = usePdfUi((s) => s.docInfo);
  const find = usePdfUi((s) => s.find);
  const renderZoom = useDebounced(zoom, 220);
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  const [selBar, setSelBar] = useState<{ x: number; y: number } | null>(null);
  const wheelAnchor = useRef<{ x: number; y: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const layout = useMemo(() => {
    const boxes: Box[] = [];
    let y = PAD;
    let maxW = 0;
    for (const entry of doc.pages) {
      const info = engine.info(entry);
      const rot = engine.rotation(entry, viewRotation);
      const s = info ? viewportSize(info.view, zoom * CSS_UNITS, rot, info.userUnit) : { width: 612 * zoom * CSS_UNITS, height: 792 * zoom * CSS_UNITS };
      boxes.push({ top: y, left: 0, width: Math.round(s.width), height: Math.round(s.height) });
      y += Math.round(s.height) + GAP;
      maxW = Math.max(maxW, Math.round(s.width));
    }
    const width = Math.max(size.width, maxW + PAD * 2);
    for (const b of boxes) b.left = Math.round((width - b.width) / 2);
    return { boxes, width, height: Math.max(0, y - GAP + PAD) };
  }, [doc.pages, zoom, viewRotation, size.width]);

  // Fit modes follow the container size (sized for the current page, like Acrobat).
  useEffect(() => {
    if (zoomMode === 'custom' || !doc.pages.length || !size.width) return;
    const entry = doc.pages[Math.min(usePdfUi.getState().currentPage, doc.pages.length - 1)];
    const info = entry ? engine.info(entry) : undefined;
    if (!entry || !info) return;
    const s = viewportSize(info.view, 1, engine.rotation(entry, viewRotation), info.userUnit);
    const z = clampZoom(fitZoom(s.width, s.height, size.width - PAD * 2 - 4, size.height - PAD * 2, zoomMode === 'fit-width' ? 'width' : 'page'));
    if (Math.abs(z - usePdfUi.getState().zoom) > 0.001) usePdfUi.getState().set({ zoom: z });
  }, [zoomMode, size.width, size.height, doc.pages, viewRotation]);

  // Keep the point under the cursor (or the viewport centre) in place when zooming/rotating.
  const prevLayout = useRef(layout);
  const prevKey = useRef(`${zoom}|${viewRotation}`);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const key = `${zoom}|${viewRotation}`;
    if (el && prevKey.current !== key && prevLayout.current.boxes.length && layout.boxes.length) {
      const anchor = wheelAnchor.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      const old = prevLayout.current;
      const docY = el.scrollTop + anchor.y;
      const docX = el.scrollLeft + anchor.x;
      const i = Math.min(pageAt(old.boxes, docY), layout.boxes.length - 1);
      const ob = old.boxes[i];
      const nb = layout.boxes[i];
      if (ob && nb) {
        const fy = (docY - ob.top) / Math.max(1, ob.height);
        const fx = (docX - ob.left) / Math.max(1, ob.width);
        el.scrollTop = nb.top + fy * nb.height - anchor.y;
        el.scrollLeft = nb.left + fx * nb.width - anchor.x;
      }
    }
    prevLayout.current = layout;
    prevKey.current = key;
    wheelAnchor.current = null;
  }, [layout, zoom, viewRotation]);

  // Scroll requests (page navigation, outline, find).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollRequest) return;
    const b = layout.boxes[Math.min(scrollRequest.index, layout.boxes.length - 1)];
    if (!b) return;
    el.scrollTop = scrollRequest.offsetY !== undefined ? b.top + scrollRequest.offsetY - el.clientHeight / 3 : b.top - PAD / 2;
    // keep the page horizontally centred (documents mixing portrait and landscape pages are wider than one page)
    if (layout.width > el.clientWidth) el.scrollLeft = Math.max(0, b.left + b.width / 2 - el.clientWidth / 2);
    setScroll({ top: el.scrollTop, height: el.clientHeight });
  }, [scrollRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScroll({ top: el.scrollTop, height: el.clientHeight });
    setSelBar(null);
    const boxes = prevLayout.current.boxes;
    if (!boxes.length) return;
    const current = pageAt(boxes, el.scrollTop + el.clientHeight * 0.35);
    if (current !== usePdfUi.getState().currentPage) usePdfUi.getState().set({ currentPage: current });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) setScroll({ top: el.scrollTop, height: el.clientHeight });
  }, [size.height]);

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms around the cursor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      wheelAnchor.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
      const z = clampZoom(usePdfUi.getState().zoom * factor);
      usePdfUi.getState().set({ zoom: z, zoomMode: 'custom' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Space = temporary hand tool.
  useEffect(() => {
    if (!active) return;
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [active]);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!(e.button === 1 || (e.button === 0 && (tool === 'hand' || spaceHeld)))) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, top: el.scrollTop, left: el.scrollLeft };
    el.classList.add('panning');
    const move = (ev: PointerEvent) => {
      el.scrollTop = start.top - (ev.clientY - start.y);
      el.scrollLeft = start.left - (ev.clientX - start.x);
    };
    const up = () => {
      el.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerUp = () => {
    if (usePdfUi.getState().tool !== 'select') return;
    setTimeout(() => {
      if (!selectionInTextLayer()) return setSelBar(null);
      const sel = window.getSelection();
      const rects = sel?.rangeCount ? Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0 && r.height > 0) : [];
      const host = scrollRef.current?.parentElement?.getBoundingClientRect();
      const last = rects[rects.length - 1];
      if (!last || !host) return setSelBar(null);
      setSelBar({ x: Math.min(host.width - 220, Math.max(8, last.right - host.left - 100)), y: Math.min(host.height - 40, last.bottom - host.top + 8) });
    }, 0);
  };

  // Widgets of the main source, grouped by source page.
  const widgetsBySrcPage = useMemo(() => {
    const map = new Map<number, PageWidget[]>();
    const defs: FieldDef[] = docInfo?.fieldDefs ?? [];
    for (const def of defs) {
      def.widgets.forEach((widget, i) => {
        const list = map.get(widget.srcIndex) ?? [];
        list.push({ def, widget, key: `${def.name}#${i}` });
        map.set(widget.srcIndex, list);
      });
    }
    return map;
  }, [docInfo?.fieldDefs]);

  const annotsByPage = useAnnotsByPage(doc.annots);
  const matchesByPage = useMemo(() => {
    const map = new Map<string, FindMatch[]>();
    for (const m of find.matches) {
      const list = map.get(m.page);
      if (list) list.push(m);
      else map.set(m.page, [m]);
    }
    return map;
  }, [find.matches]);
  const activeMatch = find.active >= 0 ? (find.matches[find.active] ?? null) : null;

  const buffer = Math.max(600, scroll.height);
  const first = layout.boxes.length ? pageAt(layout.boxes, scroll.top - buffer) : 0;
  const last = layout.boxes.length ? pageAt(layout.boxes, scroll.top + scroll.height + buffer) : -1;
  const centre = scroll.top + scroll.height / 2;
  const visible: { entry: PageEntry; index: number }[] = [];
  for (let i = first; i <= last && i < doc.pages.length; i++) visible.push({ entry: doc.pages[i], index: i });

  const markup = (kind: 'highlight' | 'underline' | 'strike' | 'redact') => {
    const n = markupSelection(history, kind);
    if (!n) toast.info(t('Select some text first'));
    setSelBar(null);
  };

  return (
    <div className="pd-viewer">
      <div
        ref={scrollRef}
        className={`pd-scroll tool-${tool} ${spaceHeld ? 'space' : ''}`}
        tabIndex={-1}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div className="pd-pages" style={{ width: layout.width, height: layout.height }}>
          {visible.map(({ entry, index }) => {
            const info = engine.info(entry);
            if (!info) return null;
            const box = layout.boxes[index];
            const widgets = docInfo?.mainSrc === entry.src ? (widgetsBySrcPage.get(entry.index) ?? EMPTY) : EMPTY;
            return (
              <PageView
                key={entry.id}
                entry={entry}
                index={index}
                info={info}
                rotation={engine.rotation(entry, viewRotation)}
                zoom={zoom}
                renderZoom={renderZoom}
                box={box}
                annots={annotsByPage.get(entry.id) ?? EMPTY}
                widgets={widgets}
                fields={doc.fields}
                matches={matchesByPage.get(entry.id) ?? EMPTY}
                activeMatch={activeMatch && activeMatch.page === entry.id ? activeMatch : null}
                priority={Math.abs(box.top + box.height / 2 - centre)}
              />
            );
          })}
        </div>
      </div>
      {find.open && <FindBar />}
      {selBar && (
        <div className="pd-selbar" style={{ left: selBar.x, top: selBar.y }} onPointerDown={(e) => e.preventDefault()}>
          <button type="button" className="icon-btn sm" title={t('Highlight')} onClick={() => markup('highlight')}>
            <Highlighter size={14} />
          </button>
          <button type="button" className="icon-btn sm" title={t('Underline')} onClick={() => markup('underline')}>
            <Underline size={14} />
          </button>
          <button type="button" className="icon-btn sm" title={t('Strikethrough')} onClick={() => markup('strike')}>
            <Strikethrough size={14} />
          </button>
          <button type="button" className="icon-btn sm" title={t('Mark for redaction')} onClick={() => markup('redact')}>
            <EyeOff size={14} />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            title={t('Copy')}
            onClick={() => {
              const text = window.getSelection()?.toString() ?? '';
              void navigator.clipboard?.writeText(text).then(
                () => toast.success(t('Copied')),
                () => document.execCommand('copy'),
              );
              setSelBar(null);
            }}
          >
            <Copy size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Screen offset (px from the page top) of a rect, for scrolling to find results. */
export function rectOffsetInPage(entry: PageEntry, viewRotation: number, zoom: number, rect: Rect): number {
  const info = engine.info(entry);
  if (!info) return 0;
  const m = viewportTransform(info.view, zoom * CSS_UNITS, engine.rotation(entry, viewRotation), info.userUnit);
  return rectToScreen(m, rect).top;
}
