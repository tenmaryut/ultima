import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useT } from '../../core/i18n';
import { useContextMenu, type MenuEntry } from '../../components/ui';
import { EASING_TYPES } from './easing';
import { isAnimated } from './keyframes';
import { getProp, layerById, LIMITS, propsForLayer, shiftLayer, updateLayer, updateLayers } from './model';
import { allKeyTimes, copyKeys, deleteKeys, moveKeys, setKeysEasing } from './ops';
import { buildKeyIndex, clipboard, useEditor, useTime } from './state';
import {
  clampTime,
  fitScale,
  formatRulerLabel,
  pickTickStep,
  quantize,
  rulerTicks,
  snapTime,
  timeToX,
  xToTime,
  zoomAround,
  type TimelineScale,
} from './timeline-math';
import { HEADER_H, LayerRow, LEFT_W, PropRow, ROW_H, TRACK_PAD, WiggleRow } from './TimelineRows';
import { TimelineToolbar } from './TimelineToolbar';
import type { AnimProp, Layer, MotionDoc, PropKey, Wiggle } from './types';

type Row =
  | { kind: 'layer'; layer: Layer; index: number }
  | { kind: 'prop'; layer: Layer; key: PropKey }
  | { kind: 'wiggle'; layer: Layer; wiggle: Wiggle };

export type ExpandMode = 'all' | 'animated';

type TlDrag =
  | { kind: 'scrub' }
  | { kind: 'keys'; start: MotionDoc; x0: number; primary: number; ids: string[]; candidates: number[]; moved: boolean }
  | { kind: 'bar'; start: MotionDoc; x0: number; edge: 'body' | 'in' | 'out'; ids: string[]; t0: number; candidates: number[]; moved: boolean }
  | { kind: 'work'; edge: 'start' | 'end' | 'body'; x0: number; s0: number; e0: number }
  | { kind: 'marquee'; x0: number; y0: number; additive: boolean; base: string[] };

function buildRows(layers: Layer[], expanded: Map<string, ExpandMode>): Row[] {
  const rows: Row[] = [];
  layers.forEach((layer, index) => {
    rows.push({ kind: 'layer', layer, index });
    const mode = expanded.get(layer.id);
    if (!mode) return;
    for (const key of propsForLayer(layer)) {
      if (mode === 'animated' && !isAnimated(getProp(layer, key))) continue;
      rows.push({ kind: 'prop', layer, key });
    }
    for (const wiggle of layer.wiggles) rows.push({ kind: 'wiggle', layer, wiggle });
  });
  return rows;
}

function cssColor(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Time ruler drawn on a canvas covering only the visible part of the track. */
function Ruler({ scale, scrollLeft, width, fps, duration }: { scale: TimelineScale; scrollLeft: number; width: number; fps: number; duration: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(HEADER_H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEADER_H);
    const text = cssColor(c, '--text-2', '#8e939d');
    const line = cssColor(c, '--border-strong', '#3a3e47');
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const { major } = pickTickStep(scale.pxPerSec, fps);
    for (const tick of rulerTicks(scale, scrollLeft, scrollLeft + width, fps, duration)) {
      const x = Math.round(tick.x - scrollLeft) + 0.5;
      ctx.strokeStyle = line;
      ctx.beginPath();
      ctx.moveTo(x, tick.major ? 12 : 19);
      ctx.lineTo(x, 24);
      ctx.stroke();
      if (tick.major) {
        ctx.fillStyle = text;
        ctx.fillText(formatRulerLabel(tick.time, fps, major), x + 3, 2);
      }
    }
    // End of composition
    const endX = timeToX(duration, scale) - scrollLeft;
    if (endX >= 0 && endX <= width) {
      ctx.fillStyle = line;
      ctx.fillRect(endX, 0, 1, HEADER_H);
    }
  }, [scale, scrollLeft, width, fps, duration]);
  return <canvas ref={ref} className="mo-ruler-canvas" style={{ left: scrollLeft, width, height: HEADER_H }} />;
}

function PlayheadLine({ scale, height }: { scale: TimelineScale; height: number }) {
  const ed = useEditor();
  const t = useTime(ed.time);
  return <div className="mo-playhead" style={{ left: LEFT_W + timeToX(t, scale), height }} />;
}

function PlayheadHead({ scale }: { scale: TimelineScale }) {
  const ed = useEditor();
  const t = useTime(ed.time);
  return <div className="mo-playhead-head" style={{ left: timeToX(t, scale) }} />;
}

export function Timeline({
  expanded,
  setExpanded,
  loop,
  setLoop,
  addLayerEntries,
  onEditCurve,
}: {
  expanded: Map<string, ExpandMode>;
  setExpanded: (m: Map<string, ExpandMode>) => void;
  loop: boolean;
  setLoop: (v: boolean) => void;
  addLayerEntries: () => MenuEntry[];
  onEditCurve: (x: number, y: number) => void;
}) {
  const t = useT();
  const ed = useEditor();
  const { doc, selected, selectedKeys } = ed;
  const comp = doc.comp;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pxPerSec, setPxPerSec] = useState(120);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewW, setViewW] = useState(900);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<TlDrag | null>(null);
  const ctxMenu = useContextMenu();
  const scale = useMemo<TimelineScale>(() => ({ pxPerSec, pad: TRACK_PAD }), [pxPerSec]);
  const trackWidth = Math.max(viewW - LEFT_W, comp.duration * pxPerSec + TRACK_PAD * 2);
  const rows = useMemo(() => buildRows(doc.layers, expanded), [doc.layers, expanded]);
  const contentHeight = HEADER_H + rows.length * ROW_H;
  const parentOptions = useMemo(() => doc.layers.map((l) => ({ id: l.id, name: l.name })), [doc.layers]);

  // Track the visible width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPxPerSec(fitScale(comp.duration, el.clientWidth - LEFT_W, TRACK_PAD));
    el.scrollLeft = 0;
  }, [comp.duration]);
  // Fit when the composition length changes (and initially).
  useEffect(() => {
    fit();
  }, [fit]);

  const zoomBy = useCallback(
    (factor: number, anchorClientX?: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const anchorX = anchorClientX !== undefined ? anchorClientX - rect.left - LEFT_W : timeToX(ed.time.get(), scale) - el.scrollLeft;
      const z = zoomAround(scale, el.scrollLeft, factor, Math.max(0, anchorX));
      setPxPerSec(z.scale.pxPerSec);
      requestAnimationFrame(() => {
        el.scrollLeft = z.scrollLeft;
      });
    },
    [scale, ed.time],
  );

  // Ctrl/Cmd + wheel zooms the time axis.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.002), e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Keep the playhead visible while playing.
  useEffect(() => {
    if (!ed.playing) return;
    return ed.time.subscribe(() => {
      const el = scrollRef.current;
      if (!el) return;
      const x = timeToX(ed.time.get(), scale);
      const visible = el.clientWidth - LEFT_W;
      if (x < el.scrollLeft || x > el.scrollLeft + visible - 20) el.scrollLeft = Math.max(0, x - 40);
    });
  }, [ed.playing, ed.time, scale]);

  /* ------------------------------- Interactions ------------------------------ */

  const contentPoint = (e: { clientX: number; clientY: number }) => {
    const r = contentRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const timeAt = (clientX: number) => xToTime(contentPoint({ clientX, clientY: 0 }).x - LEFT_W, scale);
  const frame = 1 / comp.fps;

  const selectLayer = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) ed.setSelected(ed.selected.includes(id) ? ed.selected.filter((s) => s !== id) : [...ed.selected, id]);
      else ed.setSelected([id]);
    },
    [ed],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      const next = new Map(expanded);
      if (next.has(id)) next.delete(id);
      else next.set(id, 'all');
      setExpanded(next);
    },
    [expanded, setExpanded],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.mo-row-left, .mo-tl-corner, button, input, select')) return;
    const p = contentPoint(e);
    const kf = target.closest<HTMLElement>('[data-kf]');
    const bar = target.closest<HTMLElement>('[data-bar]');
    const work = target.closest<HTMLElement>('[data-work]');
    const ruler = target.closest<HTMLElement>('[data-ruler]');
    if (ed.playing) ed.togglePlay();
    scrollRef.current?.setPointerCapture(e.pointerId);

    if (work) {
      dragRef.current = { kind: 'work', edge: work.dataset.work as 'start' | 'end' | 'body', x0: e.clientX, s0: comp.workStart, e0: comp.workEnd };
      return;
    }
    if (ruler) {
      dragRef.current = { kind: 'scrub' };
      ed.seek(timeAt(e.clientX));
      return;
    }
    if (kf) {
      const id = kf.dataset.kf!;
      let ids = [...selectedKeys];
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        ids = selectedKeys.has(id) ? ids.filter((k) => k !== id) : [...ids, id];
        ed.setSelectedKeys(new Set(ids));
        if (!ids.includes(id)) return;
      } else if (!selectedKeys.has(id)) {
        ids = [id];
        ed.setSelectedKeys(new Set(ids));
      }
      const ref = ed.keyIndex.get(id);
      const layer = ref && layerById(doc, ref.layerId);
      if (ref && !selected.includes(ref.layerId) && !(e.shiftKey || e.ctrlKey || e.metaKey)) ed.setSelected([ref.layerId]);
      const key = layer && getProp(layer, ref!.prop).keyframes.find((k) => k.id === id);
      if (!key || layer?.locked) return;
      const moving = new Set(ids);
      const candidates = [ed.time.get(), ...allKeyTimes({ ...doc, layers: doc.layers.map((l) => ({ ...l, props: filterProps(l, moving) })) })];
      dragRef.current = { kind: 'keys', start: doc, x0: e.clientX, primary: key.time, ids, candidates, moved: false };
      return;
    }
    if (bar) {
      const id = bar.dataset.bar!;
      const edge = (bar.dataset.edge as 'body' | 'in' | 'out') ?? 'body';
      if (!selected.includes(id)) ed.setSelected([id]);
      const ids = edge === 'body' && selected.includes(id) ? selected : [id];
      const movable = ids.filter((lid) => !layerById(doc, lid)?.locked);
      if (!movable.length) return;
      const layer = layerById(doc, id)!;
      const others = doc.layers.filter((l) => !movable.includes(l.id)).flatMap((l) => [l.inPoint, l.outPoint]);
      dragRef.current = {
        kind: 'bar',
        start: doc,
        x0: e.clientX,
        edge,
        ids: movable,
        t0: edge === 'out' ? layer.outPoint : layer.inPoint,
        candidates: [ed.time.get(), 0, comp.duration, ...others],
        moved: false,
      };
      return;
    }
    // Empty track: marquee selection of keyframes.
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) ed.setSelectedKeys(new Set());
    dragRef.current = { kind: 'marquee', x0: p.x, y0: p.y, additive, base: additive ? [...selectedKeys] : [] };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    switch (drag.kind) {
      case 'scrub': {
        let time = timeAt(e.clientX);
        if (e.shiftKey) time = snapTime(time, allKeyTimes(doc), pxPerSec, 8).time;
        ed.seek(time);
        break;
      }
      case 'keys': {
        let target = quantize(drag.primary + (e.clientX - drag.x0) / pxPerSec, comp.fps);
        if (ed.snapping !== e.shiftKey) target = snapTime(target, drag.candidates, pxPerSec, 6).time;
        const delta = target - drag.primary;
        if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
        drag.moved = true;
        ed.setDoc(moveKeys(drag.start, drag.ids, buildKeyIndex(drag.start), delta), { record: false });
        break;
      }
      case 'bar': {
        let target = quantize(drag.t0 + (e.clientX - drag.x0) / pxPerSec, comp.fps);
        if (ed.snapping !== e.shiftKey) target = snapTime(target, drag.candidates, pxPerSec, 6).time;
        let delta = target - drag.t0;
        if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
        drag.moved = true;
        const start = drag.start;
        if (drag.edge === 'body') {
          // Keep every moved layer (and its keyframes) at t ≥ 0.
          let minStart = Infinity;
          for (const id of drag.ids) {
            const l = layerById(start, id)!;
            const first = Math.min(l.inPoint, ...allKeyTimes(start, [id]));
            minStart = Math.min(minStart, first);
          }
          delta = Math.max(delta, -minStart);
          ed.setDoc(updateLayers(start, drag.ids, (l) => shiftLayer(l, delta)), { record: false });
        } else {
          const id = drag.ids[0];
          ed.setDoc(
            updateLayer(start, id, (l) =>
              drag.edge === 'in'
                ? { ...l, inPoint: clampTime(Math.min(l.inPoint + delta, l.outPoint - frame), LIMITS.maxDuration) }
                : { ...l, outPoint: Math.min(LIMITS.maxDuration, Math.max(l.inPoint + frame, l.outPoint + delta)) },
            ),
            { record: false },
          );
        }
        break;
      }
      case 'work': {
        const dt = (e.clientX - drag.x0) / pxPerSec;
        let s = drag.s0;
        let en = drag.e0;
        if (drag.edge === 'start') s = Math.min(quantize(drag.s0 + dt, comp.fps), en - frame);
        else if (drag.edge === 'end') en = Math.max(quantize(drag.e0 + dt, comp.fps), s + frame);
        else {
          const len = drag.e0 - drag.s0;
          s = quantize(Math.min(Math.max(0, drag.s0 + dt), comp.duration - len), comp.fps);
          en = s + len;
        }
        s = clampTime(s, comp.duration);
        en = clampTime(en, comp.duration);
        ed.setDoc((d) => ({ ...d, comp: { ...d.comp, workStart: s, workEnd: en } }), { record: false });
        break;
      }
      case 'marquee': {
        const p = contentPoint(e);
        const r = { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
        setMarquee(r);
        const ids = new Set(drag.base);
        rows.forEach((row, i) => {
          if (row.kind !== 'prop') return;
          const cy = HEADER_H + i * ROW_H + ROW_H / 2;
          if (cy < r.y || cy > r.y + r.h) return;
          for (const k of getProp(row.layer, row.key).keyframes) {
            const cx = LEFT_W + timeToX(k.time, scale);
            if (cx >= r.x && cx <= r.x + r.w) ids.add(k.id);
          }
        });
        ed.setSelectedKeys(ids);
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    scrollRef.current?.releasePointerCapture?.(e.pointerId);
    setMarquee(null);
    if (!drag) return;
    if (drag.kind === 'keys' && drag.moved) ed.commit('Move keyframes');
    if (drag.kind === 'bar' && drag.moved) ed.commit(drag.edge === 'body' ? 'Move layer in time' : 'Trim layer');
    if (drag.kind === 'work') ed.commit('Work area');
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Pointer capture retargets the event to the scroller: find the key under the cursor.
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const kf = under?.closest<HTMLElement>('[data-kf]');
    if (!kf) return;
    const key = ed.keyIndex.get(kf.dataset.kf!);
    const layer = key && layerById(doc, key.layerId);
    const k = layer && getProp(layer, key!.prop).keyframes.find((x) => x.id === key!.keyId);
    if (k) ed.seek(k.time);
    onEditCurve(e.clientX, e.clientY);
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const kf = (e.target as HTMLElement).closest<HTMLElement>('[data-kf]');
    if (!kf) return;
    e.preventDefault();
    const id = kf.dataset.kf!;
    const ids = selectedKeys.has(id) ? [...selectedKeys] : [id];
    if (!selectedKeys.has(id)) ed.setSelectedKeys(new Set(ids));
    const entries: MenuEntry[] = [
      {
        label: t('Easing'),
        submenu: EASING_TYPES.filter((x) => x.value !== 'bezier').map((x) => ({
          label: t(x.label),
          onClick: () => ed.setDoc((d) => setKeysEasing(d, ids, buildKeyIndex(d), x.value), { label: 'Easing' }),
        })),
      },
      { label: t('Edit curve…'), onClick: () => onEditCurve(e.clientX, e.clientY) },
      { type: 'separator' },
      { label: t('Copy'), shortcut: 'Ctrl+C', onClick: () => (clipboard.keys = copyKeys(doc, ids, ed.keyIndex)) },
      {
        label: t('Delete'),
        shortcut: 'Del',
        onClick: () => {
          ed.setDoc((d) => deleteKeys(d, ids, buildKeyIndex(d), ed.time.get()), { label: 'Delete keyframes' });
          ed.setSelectedKeys(new Set());
        },
      },
    ];
    ctxMenu.show(e.clientX, e.clientY, entries);
  };

  const workX0 = timeToX(comp.workStart, scale);
  const workX1 = timeToX(comp.workEnd, scale);

  return (
    <div className="mo-timeline">
      <TimelineToolbar loop={loop} setLoop={setLoop} onZoom={(f) => zoomBy(f)} onFit={fit} pxPerSec={pxPerSec} addLayerEntries={addLayerEntries} onEditCurve={onEditCurve} />
      <div
        ref={scrollRef}
        className="mo-tl-scroll"
        onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <div ref={contentRef} className="mo-tl-content" style={{ width: LEFT_W + trackWidth, minHeight: '100%', height: contentHeight }}>
          <div className="mo-tl-header" style={{ height: HEADER_H }}>
            <div className="mo-tl-corner" style={{ width: LEFT_W }}>
              <span className="faint">{t('Layers')}</span>
              <span className="faint mo-corner-parent">{t('Parent')}</span>
            </div>
            <div className="mo-ruler" data-ruler="1" style={{ width: trackWidth }}>
              <Ruler scale={scale} scrollLeft={scrollLeft} width={Math.max(0, viewW - LEFT_W)} fps={comp.fps} duration={comp.duration} />
              <div className="mo-work" data-work="body" style={{ left: workX0, width: Math.max(2, workX1 - workX0) }} title={t('Work area')}>
                <span className="mo-work-handle start" data-work="start" />
                <span className="mo-work-handle end" data-work="end" />
              </div>
              <PlayheadHead scale={scale} />
            </div>
          </div>
          {rows.map((row, i) => {
            if (row.kind === 'layer')
              return (
                <LayerRow
                  key={row.layer.id}
                  layer={row.layer}
                  index={row.index}
                  selected={selected.includes(row.layer.id)}
                  expanded={expanded.has(row.layer.id)}
                  scale={scale}
                  trackWidth={trackWidth}
                  parentOptions={parentOptions}
                  onSelect={selectLayer}
                  onToggleExpand={toggleExpand}
                />
              );
            if (row.kind === 'prop')
              return <PropRow key={`${row.layer.id}:${row.key}`} layer={row.layer} propKey={row.key} scale={scale} trackWidth={trackWidth} selectedKeys={selectedKeys} />;
            return <WiggleRow key={`${row.layer.id}:${row.wiggle.id}:${i}`} layer={row.layer} wiggle={row.wiggle} scale={scale} trackWidth={trackWidth} />;
          })}
          {!rows.length && (
            <div className="mo-tl-empty" style={{ left: LEFT_W + 12 }}>
              <Layers size={16} /> {t('No layers yet — use the tools on the left, the Layer menu or drop images here.')}
            </div>
          )}
          <PlayheadLine scale={scale} height={Math.max(contentHeight, 40)} />
          {marquee && <div className="mo-tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>
      {ctxMenu.element}
    </div>
  );
}

/** Props of a layer without the given keyframe ids (snap candidates exclude moving keys). */
function filterProps(layer: Layer, moving: Set<string>): Layer['props'] {
  const out: Record<string, AnimProp> = {};
  for (const [k, p] of Object.entries(layer.props) as [string, AnimProp][]) out[k] = { ...p, keyframes: p.keyframes.filter((kf) => !moving.has(kf.id)) };
  return out as unknown as Layer['props'];
}
