import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Clip, Project, TimeRange, Track, TrackKind } from '../types';
import { useT } from '../../../core/i18n';
import { useContextMenu, type MenuEntry } from '../../../components/ui';
import type { MediaLibrary } from '../media';
import type { TimeStore } from '../timeStore';
import {
  clipEnd,
  displayTracks,
  expandLinked,
  getClip,
  getMedia,
  getTrack,
  moveClips,
  snapPoints,
  splitAt,
  timelineDuration,
  tracksOfKind,
  trimClip,
  updateMarker,
} from '../model';
import { MAX_PPS, MIN_PPS, clampNum, fitPps, snapRange, snapValue } from '../time';
import { DND_MIME, getDragPayload } from '../dnd';
import { ClipView } from './TimelineClip';
import { Playhead, RULER_H, TRACK_HEIGHT, TimelineToolbar, TrackHeader, drawRuler, type ToolbarActions } from './TimelineParts';

export interface TimelineApi {
  /** Timeline position under a screen point (for OS file drops), or null outside the lanes. */
  dropTarget: (clientX: number, clientY: number) => { time: number; trackId: string | null } | null;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
}

export interface TimelineProps {
  project: Project;
  lib: MediaLibrary;
  libVersion: number;
  time: TimeStore;
  playing: boolean;
  selection: string[];
  setSelection: (ids: string[]) => void;
  tool: 'select' | 'razor';
  setTool: (t: 'select' | 'razor') => void;
  snapping: boolean;
  setSnapping: (v: boolean) => void;
  pps: number;
  setPps: (pps: number) => void;
  change: (next: Project, opts?: { record?: boolean; label?: string }) => void;
  commit: (label: string) => void;
  seek: (t: number) => void;
  cutRanges?: TimeRange[] | null;
  onDropMedia: (mediaId: string, time: number, trackId: string | null) => void;
  onDropTitle: (presetId: string, time: number, trackId: string | null) => void;
  onDropFolder: (entryId: string, time: number, trackId: string | null) => void;
  actions: Omit<ToolbarActions, 'zoomIn' | 'zoomOut' | 'zoomFit'>;
  clipMenu: (clip: Clip) => MenuEntry[];
  trackMenu: (track: Track) => MenuEntry[];
  markerMenu: (markerId: string) => MenuEntry[];
  onRenameMarker: (markerId: string) => void;
  onPatchTrack: (trackId: string, patch: Partial<Track>) => void;
  apiRef: MutableRefObject<TimelineApi | null>;
}

interface Row {
  track: Track;
  top: number;
  height: number;
}

type Drag =
  | { kind: 'move'; x0: number; y0: number; base: Project; ids: string[]; primary: string; trackKind: TrackKind; startIdx: number; candidates: number[]; start: number; length: number; started: boolean; clickSelect: string[] | null }
  | { kind: 'trim'; x0: number; base: Project; id: string; edge: 'start' | 'end'; origin: number; candidates: number[]; started: boolean }
  | { kind: 'marquee'; x0: number; y0: number; additive: boolean; base: string[]; started: boolean }
  | { kind: 'scrub'; candidates: number[] }
  | { kind: 'workarea'; t0: number; base: Project }
  | { kind: 'marker'; id: string; x0: number; base: Project; origin: number; started: boolean };

export function Timeline(props: TimelineProps) {
  const { project, lib, libVersion, time, pps, selection, tool, snapping, change, commit, seek } = props;
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const rulerCanvas = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const [view, setView] = useState({ left: 0, width: 800, height: 200 });
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ghost, setGhost] = useState<{ left: number; width: number; top: number; height: number } | null>(null);
  const ctx = useContextMenu();

  const rows: Row[] = useMemo(() => {
    let y = RULER_H;
    return displayTracks(project).map((track) => {
      const r = { track, top: y, height: TRACK_HEIGHT[track.kind] };
      y += r.height;
      return r;
    });
  }, [project]);
  const contentH = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : RULER_H;
  const duration = timelineDuration(project);
  const contentW = Math.max(view.width, (Math.max(duration, 10) + 30) * pps);
  const selected = useMemo(() => new Set(selection), [selection]);
  const fps = project.settings.fps;
  const snapThreshold = 8 / pps;

  // window of content pixels the clip canvases cover (quantized so scrolling re-renders rarely)
  const winStart = Math.floor(view.left / 256) * 256 - 512;
  const winEnd = winStart + view.width + 1536;

  /* ------------------------------ scroll & size ------------------------------ */

  const redrawRuler = useCallback(() => {
    const sc = scrollRef.current;
    if (rulerCanvas.current && sc) drawRuler(rulerCanvas.current, sc.scrollLeft, sc.clientWidth, pps, fps);
  }, [pps, fps]);

  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    if (pendingScroll.current !== null) {
      sc.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
    redrawRuler();
  });

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const ro = new ResizeObserver(() => {
      setView((v) => ({ ...v, width: sc.clientWidth, height: sc.clientHeight }));
      redrawRuler();
    });
    ro.observe(sc);
    return () => ro.disconnect();
  }, [redrawRuler]);

  const onScroll = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    if (headsRef.current) headsRef.current.style.transform = `translateY(${-sc.scrollTop}px)`;
    redrawRuler();
    const q = Math.floor(sc.scrollLeft / 256) * 256;
    setView((v) => (Math.floor(v.left / 256) * 256 === q ? v : { ...v, left: sc.scrollLeft }));
  };

  const zoomAt = useCallback(
    (next: number, anchorX?: number) => {
      const sc = scrollRef.current;
      const z = clampNum(next, MIN_PPS, MAX_PPS);
      if (!sc) return props.setPps(z);
      const ax = anchorX ?? (() => {
        const px = time.get() * pps - sc.scrollLeft;
        return px >= 0 && px <= sc.clientWidth ? px : sc.clientWidth / 2;
      })();
      const anchorTime = (sc.scrollLeft + ax) / pps;
      pendingScroll.current = Math.max(0, anchorTime * z - ax);
      props.setPps(z);
    },
    [pps, props, time],
  );

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = sc.getBoundingClientRect();
      zoomAt(pps * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX - rect.left);
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, [pps, zoomAt]);

  const zoomFit = useCallback(() => {
    const sc = scrollRef.current;
    props.setPps(fitPps(Math.max(duration, 5), (sc?.clientWidth ?? 800) - 20));
    pendingScroll.current = 0;
  }, [duration, props]);

  /* ------------------------------- coordinates ------------------------------- */

  const toContent = (clientX: number, clientY: number) => {
    const sc = scrollRef.current!;
    const r = sc.getBoundingClientRect();
    return { x: clientX - r.left + sc.scrollLeft, y: clientY - r.top + sc.scrollTop };
  };
  const rowAt = (y: number) => rows.find((r) => y >= r.top && y < r.top + r.height) ?? null;

  props.apiRef.current = {
    dropTarget: (clientX, clientY) => {
      const sc = scrollRef.current;
      if (!sc) return null;
      const r = sc.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      const p = toContent(clientX, clientY);
      return { time: Math.max(0, p.x / pps), trackId: rowAt(p.y)?.track.id ?? null };
    },
    zoomIn: () => zoomAt(pps * 1.5),
    zoomOut: () => zoomAt(pps / 1.5),
    zoomFit,
  };

  /* ------------------------------- interactions ------------------------------ */

  const selectionFor = (clip: Clip, additive: boolean, alt: boolean): string[] => {
    const own = alt ? [clip.id] : [...expandLinked(project, [clip.id])];
    if (additive) {
      const has = selected.has(clip.id);
      const set = new Set(selection);
      for (const id of own) has ? set.delete(id) : set.add(id);
      return [...set];
    }
    return own;
  };

  const onLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const p = toContent(e.clientX, e.clientY);
    if (p.y < RULER_H) return;
    const clipEl = target.closest('[data-clip]') as HTMLElement | null;
    const clip = clipEl ? getClip(project, clipEl.dataset.clip!) : undefined;
    const track = clip ? getTrack(project, clip.trackId) : undefined;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (clip && track?.locked) return;
    if (clip && tool === 'razor') {
      let at = p.x / pps;
      if (snapping) at = snapValue(at, [time.get()], snapThreshold).value;
      const r = splitAt(project, at, e.altKey ? [clip.id] : [...expandLinked(project, [clip.id])]);
      if (r.created.length) change(r.project, { label: t('Split clip') });
      return;
    }
    if (clip && track) {
      const part = target.dataset.part as 'start' | 'end' | undefined;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      let ids = selection;
      let clickSelect: string[] | null = null;
      if (additive || !selected.has(clip.id)) {
        ids = selectionFor(clip, additive, e.altKey);
        props.setSelection(ids);
      } else clickSelect = selectionFor(clip, false, e.altKey);
      if (additive && !ids.includes(clip.id)) return;
      if (part) {
        const linked = expandLinked(project, [clip.id]);
        dragRef.current = {
          kind: 'trim',
          x0: e.clientX,
          base: project,
          id: clip.id,
          edge: part,
          origin: part === 'start' ? clip.start : clipEnd(clip),
          candidates: snapPoints(project, { playhead: time.get(), exclude: linked }),
          started: false,
        };
        return;
      }
      const moving = expandLinked(project, ids);
      const group = project.clips.filter((c) => moving.has(c.id));
      const start = Math.min(...group.map((c) => c.start));
      dragRef.current = {
        kind: 'move',
        x0: e.clientX,
        y0: e.clientY,
        base: project,
        ids,
        primary: clip.id,
        trackKind: track.kind,
        startIdx: tracksOfKind(project, track.kind).findIndex((x) => x.id === track.id),
        candidates: snapPoints(project, { playhead: time.get(), exclude: moving }),
        start,
        length: Math.max(...group.map(clipEnd)) - start,
        started: false,
        clickSelect,
      };
      return;
    }
    dragRef.current = { kind: 'marquee', x0: p.x, y0: p.y, additive: e.shiftKey || e.ctrlKey || e.metaKey, base: selection, started: false };
  };

  const onRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toContent(e.clientX, e.clientY);
    const markerId = target.dataset.marker;
    if (markerId) {
      const m = project.markers.find((x) => x.id === markerId);
      if (m) dragRef.current = { kind: 'marker', id: markerId, x0: e.clientX, base: project, origin: m.time, started: false };
      return;
    }
    const at = Math.max(0, p.x / pps);
    if (e.shiftKey) {
      dragRef.current = { kind: 'workarea', t0: at, base: project };
      return;
    }
    const candidates = snapping ? snapPoints(project, {}) : [];
    dragRef.current = { kind: 'scrub', candidates };
    seek(snapping ? snapValue(at, candidates, snapThreshold).value : at);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toContent(e.clientX, e.clientY);
    switch (d.kind) {
      case 'scrub': {
        const at = Math.max(0, p.x / pps);
        seek(snapping ? snapValue(at, d.candidates, snapThreshold).value : at);
        break;
      }
      case 'workarea': {
        const at = Math.max(0, p.x / pps);
        const a = Math.min(d.t0, at);
        const b = Math.max(d.t0, at);
        if (b - a > 1 / fps) change({ ...d.base, workArea: { start: a, end: b } }, { record: false });
        break;
      }
      case 'marker': {
        if (!d.started && Math.abs(e.clientX - d.x0) < 3) return;
        d.started = true;
        let at = Math.max(0, d.origin + (e.clientX - d.x0) / pps);
        if (snapping) at = snapValue(at, snapPoints(d.base, { playhead: time.get() }), snapThreshold).value;
        change(updateMarker(d.base, d.id, { time: at }), { record: false });
        break;
      }
      case 'move': {
        if (!d.started && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
        d.started = true;
        let dt = (e.clientX - d.x0) / pps;
        let line: number | null = null;
        if (snapping) {
          const r = snapRange(d.start + dt, d.length, d.candidates, snapThreshold);
          dt = r.value - d.start;
          line = r.target;
        }
        const row = rowAt(p.y);
        let shift = 0;
        if (row && row.track.kind === d.trackKind) shift = tracksOfKind(d.base, d.trackKind).findIndex((x) => x.id === row.track.id) - d.startIdx;
        change(moveClips(d.base, d.ids, dt, shift, d.trackKind), { record: false });
        setSnapLine(line);
        break;
      }
      case 'trim': {
        if (!d.started && Math.abs(e.clientX - d.x0) < 2) return;
        d.started = true;
        let at = d.origin + (e.clientX - d.x0) / pps;
        let line: number | null = null;
        if (snapping) {
          const r = snapValue(at, d.candidates, snapThreshold);
          at = r.value;
          line = r.target;
        }
        change(trimClip(d.base, d.id, d.edge, at), { record: false });
        setSnapLine(line);
        break;
      }
      case 'marquee': {
        if (!d.started && Math.abs(p.x - d.x0) < 4 && Math.abs(p.y - d.y0) < 4) return;
        d.started = true;
        const x = Math.min(d.x0, p.x);
        const y = Math.min(d.y0, p.y);
        const w = Math.abs(p.x - d.x0);
        const h = Math.abs(p.y - d.y0);
        setMarquee({ x, y, w, h });
        const t0 = x / pps;
        const t1 = (x + w) / pps;
        const hit: string[] = [];
        for (const r of rows) {
          if (r.top + r.height < y || r.top > y + h || r.track.locked) continue;
          for (const c of project.clips) if (c.trackId === r.track.id && c.start < t1 && clipEnd(c) > t0) hit.push(c.id);
        }
        props.setSelection(d.additive ? [...new Set([...d.base, ...hit])] : hit);
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setSnapLine(null);
    setMarquee(null);
    if (!d) return;
    if (d.kind === 'move') {
      if (d.started) commit(t('Move clips'));
      else if (d.clickSelect) props.setSelection(d.clickSelect);
    } else if (d.kind === 'trim' && d.started) commit(t('Trim clip'));
    else if (d.kind === 'workarea') commit(t('Set work area'));
    else if (d.kind === 'marker') {
      if (d.started) commit(t('Move marker'));
      else seek(d.origin);
    } else if (d.kind === 'marquee' && !d.started && !d.additive) props.setSelection([]);
  };

  /* --------------------------------- drag & drop -------------------------------- */

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const payload = getDragPayload();
    const p = toContent(e.clientX, e.clientY);
    const row = rowAt(p.y);
    let at = Math.max(0, p.x / pps);
    const len = payload?.duration ?? 5;
    if (snapping) at = Math.max(0, snapRange(at, len, snapPoints(project, { playhead: time.get() }), snapThreshold).value);
    setGhost(row ? { left: at * pps, width: Math.max(4, len * pps), top: row.top, height: row.height } : null);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const payload = getDragPayload();
    setGhost(null);
    if (!e.dataTransfer.types.includes(DND_MIME) || !payload) return;
    e.preventDefault();
    const p = toContent(e.clientX, e.clientY);
    let at = Math.max(0, p.x / pps);
    if (snapping) at = Math.max(0, snapRange(at, payload.duration, snapPoints(project, { playhead: time.get() }), snapThreshold).value);
    const trackId = rowAt(p.y)?.track.id ?? null;
    if (payload.kind === 'media') props.onDropMedia(payload.mediaId, at, trackId);
    else if (payload.kind === 'folder') props.onDropFolder(payload.entryId, at, trackId);
    else props.onDropTitle(payload.presetId, at, trackId);
  };

  /* ---------------------------------- render ---------------------------------- */

  const visibleT0 = winStart / pps;
  const visibleT1 = winEnd / pps;
  const wa = project.workArea;

  return (
    <div className={`vd-tl ${tool === 'razor' ? 'razor' : ''}`}>
      <TimelineToolbar
        tool={tool}
        setTool={props.setTool}
        snapping={snapping}
        setSnapping={props.setSnapping}
        hasSelection={selection.length > 0}
        pps={pps}
        setPps={(z) => zoomAt(z)}
        actions={{ ...props.actions, zoomIn: () => zoomAt(pps * 1.5), zoomOut: () => zoomAt(pps / 1.5), zoomFit }}
      />
      <div className="vd-tl-main">
        <div className="vd-tl-heads">
          <div ref={headsRef} className="vd-tl-heads-inner">
            <div className="vd-tl-corner faint" style={{ fontSize: 10.5 }}>
              {t('Tracks')}
            </div>
            {rows.map((r) => (
              <TrackHeader
                key={r.track.id}
                track={r.track}
                height={r.height}
                onPatch={props.onPatchTrack}
                onContextMenu={(e, track) => ctx.open(props.trackMenu(track))(e)}
              />
            ))}
          </div>
        </div>
        <div
          ref={scrollRef}
          className="vd-tl-scroll"
          onScroll={onScroll}
          onDragOver={onDragOver}
          onDragLeave={() => setGhost(null)}
          onDrop={onDrop}
        >
          <div className="vd-tl-content" style={{ width: contentW, height: Math.max(contentH, view.height) }}>
            <div
              className="vd-tl-ruler"
              style={{ width: contentW }}
              onPointerDown={onRulerPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => {
                const id = (e.target as HTMLElement).dataset.marker;
                if (id) ctx.open(props.markerMenu(id))(e);
                else e.preventDefault();
              }}
              title={t('Click or drag to move the playhead · Shift+drag to set the work area')}
            >
              <canvas ref={rulerCanvas} />
              {wa && <div className="vd-workarea" style={{ left: wa.start * pps, width: Math.max(2, (wa.end - wa.start) * pps) }} />}
              {project.markers.map((m) => (
                <div
                  key={m.id}
                  className="vd-marker"
                  data-marker={m.id}
                  style={{ left: m.time * pps }}
                  title={m.label || t('Marker')}
                  onDoubleClick={() => props.onRenameMarker(m.id)}
                />
              ))}
            </div>
            <div
              style={{ position: 'absolute', left: 0, top: 0, width: contentW, height: Math.max(contentH, view.height) }}
              onPointerDown={onLanePointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => {
                const el = (e.target as HTMLElement).closest('[data-clip]') as HTMLElement | null;
                const clip = el ? getClip(project, el.dataset.clip!) : undefined;
                if (!clip) return e.preventDefault();
                if (!selected.has(clip.id)) props.setSelection([...expandLinked(project, [clip.id])]);
                ctx.open(props.clipMenu(clip))(e);
              }}
            >
              {rows.map((r) => (
                <div
                  key={r.track.id}
                  className={`vd-lane kind-${r.track.kind} ${r.track.locked ? 'locked' : ''}`}
                  style={{ position: 'absolute', left: 0, right: 0, top: r.top, height: r.height }}
                >
                  {project.clips
                    .filter((c) => c.trackId === r.track.id && c.start <= visibleT1 && clipEnd(c) >= visibleT0)
                    .map((c) => (
                      <ClipView
                        key={c.id}
                        clip={c}
                        pps={pps}
                        height={r.height}
                        winStart={winStart}
                        winEnd={winEnd}
                        selected={selected.has(c.id)}
                        locked={r.track.locked}
                        media={getMedia(project, c.mediaId)}
                        runtime={lib.get(c.mediaId)}
                        lib={lib}
                        libVersion={libVersion}
                        label={c.kind === 'title' ? c.title?.text.split('\n')[0] || t('Title') : c.kind === 'caption' ? c.text ?? '' : c.name}
                      />
                    ))}
                </div>
              ))}
              {ghost && <div className="vd-ghost" style={{ left: ghost.left, width: ghost.width, top: ghost.top + 3, height: ghost.height - 6, bottom: 'auto' }} />}
            </div>
            {wa && <div className="vd-workarea-shade" style={{ left: wa.start * pps, width: (wa.end - wa.start) * pps }} />}
            {project.markers.map((m) => (
              <div key={m.id} className="vd-marker-line" style={{ left: m.time * pps }} />
            ))}
            {props.cutRanges?.map((r, i) => (
              <div key={i} className="vd-cutrange" style={{ left: r.start * pps, width: Math.max(1, (r.end - r.start) * pps) }} />
            ))}
            {marquee && <div className="vd-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
            {snapLine !== null && <div className="vd-snapline" style={{ left: snapLine * pps }} />}
            <Playhead time={time} pps={pps} scrollRef={scrollRef} playing={props.playing} />
          </div>
        </div>
      </div>
      {ctx.element}
    </div>
  );
}
