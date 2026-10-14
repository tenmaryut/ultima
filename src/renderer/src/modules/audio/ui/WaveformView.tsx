import { useEffect, useRef, type CSSProperties } from 'react';
import { AudioWaveform, FolderOpen, Mic, Minus, Music, Plus } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, EmptyState, IconButton, promptDialog, useContextMenu } from '../../../components/ui';
import { audio } from '../controller';
import { setUI, ui, useAudioUI } from '../state';
import { pickAndOpen } from '../files';
import { buildContextMenu } from './menus';
import { drawLane, drawRuler, drawSpectrogram, readTheme, spectroLabels, type Theme } from './draw';
import { createColumns, type PeakColumns } from '../engine/peaks';

type Drag =
  | { kind: 'select'; anchor: number; startX: number; moved: boolean }
  | { kind: 'pan'; startX: number; startView: number }
  | { kind: 'overview'; grab: number }
  | { kind: 'marker'; id: string; pos: number; startX: number; moved: boolean }
  | { kind: 'scrub' };

const RULER_H = 26;
const OVERVIEW_H = 34;

export function WaveformView({ active }: { active: boolean }) {
  const t = useT();
  const revision = useAudioUI((s) => s.revision);
  const ampZoom = useAudioUI((s) => s.ampZoom);
  const lanesRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const dirty = useRef({ wave: true, overlay: true, ruler: true, overview: true });
  const raf = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const drag = useRef<Drag | null>(null);
  const markerDrag = useRef<{ id: string; pos: number } | null>(null);
  const pointerX = useRef(0);
  const themeRef = useRef<Theme | null>(null);
  const overviewCols = useRef<PeakColumns | null>(null);
  const ctxMenu = useContextMenu();
  void revision;

  const schedule = (parts: Partial<Record<'wave' | 'overlay' | 'ruler' | 'overview', boolean>> = { wave: true, overlay: true, ruler: true, overview: true }) => {
    Object.assign(dirty.current, parts);
    if (!raf.current && activeRef.current) raf.current = requestAnimationFrame(frame);
  };

  const laneLayout = () => {
    const { h } = size.current;
    const count = Math.max(1, audio.doc.channels.length);
    const spectral = ui().spectral;
    const waveH = spectral ? h * 0.4 : h;
    const waveLane = waveH / count;
    const specLane = spectral ? (h - waveH) / count : 0;
    return { count, waveLane, specLane, waveH };
  };

  const sampleAt = (clientX: number) => {
    const rect = lanesRef.current!.getBoundingClientRect();
    const v = ui().view;
    return v.start + (clientX - rect.left) * v.spp;
  };

  function frame() {
    raf.current = 0;
    if (!activeRef.current) return;
    let again = false;
    if (audio.peaks.dirty) {
      audio.peaks.pump(10);
      dirty.current.wave = true;
      dirty.current.overview = true;
      again = audio.peaks.dirty;
    }
    const s = ui();
    if (s.playing && !s.playingMix) {
      const pos = audio.player.position();
      if (pos !== null && s.follow && !drag.current) {
        const span = size.current.w * s.view.spp;
        if (pos > s.view.start + span * 0.96 || pos < s.view.start) audio.setView({ start: pos - span * 0.04, spp: s.view.spp });
      }
      dirty.current.overlay = true;
      dirty.current.overview = true;
      again = true;
    }
    if (drag.current?.kind === 'select') {
      // auto-scroll while selecting beyond the edges
      const w = size.current.w;
      const x = pointerX.current;
      if (x < 0 || x > w) {
        const v = ui().view;
        const over = x < 0 ? x : x - w;
        audio.setView({ start: v.start + over * v.spp * 0.25, spp: v.spp });
        updateSelectionDrag();
        again = true;
      }
    }
    draw();
    if (again) raf.current = requestAnimationFrame(frame);
  }

  function draw() {
    const theme = (themeRef.current ??= readTheme(lanesRef.current ?? document.body));
    const { w, h, dpr } = size.current;
    if (!w || !h) return;
    const s = ui();
    const d = dirty.current;
    if (d.wave) drawWave(theme, w, h, dpr, s.view, s.ampZoom);
    if (d.ruler || d.overlay) drawRulerLayer(theme, w, dpr);
    if (d.overlay) drawOverlay(theme, w, h, dpr);
    if (d.overview) drawOverview(theme, w, dpr);
    dirty.current = { wave: false, overlay: false, ruler: false, overview: false };
  }

  function drawWave(theme: Theme, w: number, h: number, dpr: number, view = ui().view, amp = ui().ampZoom) {
    const ctx = waveRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.lane;
    ctx.fillRect(0, 0, w * dpr, h * dpr);
    if (!audio.length) return;
    const { count, waveLane, specLane, waveH } = laneLayout();
    for (let c = 0; c < count; c++) {
      drawLane(ctx, audio.peaks, audio.doc.channels[c], c, view, c * waveLane, waveLane, w, dpr, amp, theme);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.border;
    for (let c = 1; c < count; c++) ctx.fillRect(0, Math.round(c * waveLane), w, 1);
    if (specLane > 0) {
      for (let c = 0; c < count; c++) {
        drawSpectrogram(ctx, audio.doc.channels[c], audio.sampleRate, view, waveH + c * specLane, specLane, w, dpr, { log: ui().spectralLog, floorDb: -110, ceilDb: -12 });
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = theme.border;
      ctx.fillRect(0, Math.round(waveH), w, 1);
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      for (let c = 0; c < count; c++) {
        for (const l of spectroLabels(audio.sampleRate, specLane, ui().spectralLog)) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(w - 34, waveH + c * specLane + l.y - 7, 32, 13);
          ctx.fillStyle = '#e8e8f0';
          ctx.fillText(l.label, w - 31, waveH + c * specLane + l.y);
        }
      }
    }
    // channel labels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const names = count === 2 ? ['L', 'R'] : count === 1 ? ['M'] : Array.from({ length: count }, (_, i) => String(i + 1));
    for (let c = 0; c < count; c++) {
      ctx.fillStyle = theme.textDim;
      ctx.fillText(names[c], 6, c * waveLane + 5);
    }
  }

  function drawOverlay(theme: Theme, w: number, h: number, dpr: number) {
    const ctx = overlayRef.current?.getContext('2d');
    if (!ctx) return;
    const s = ui();
    const v = s.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!audio.length) return;
    const xOf = (pos: number) => (pos - v.start) / v.spp;
    const sel = s.selection;
    if (sel) {
      const x1 = Math.max(-2, xOf(sel.start));
      const x2 = Math.min(w + 2, xOf(sel.end));
      if (x2 > 0 && x1 < w) {
        ctx.fillStyle = theme.selection;
        ctx.globalAlpha = 0.22;
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
        ctx.globalAlpha = 0.9;
        ctx.fillRect(Math.round(x1), 0, 1, h);
        ctx.fillRect(Math.round(x2) - 1, 0, 1, h);
        ctx.globalAlpha = 1;
      }
    }
    // markers
    ctx.strokeStyle = theme.marker;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const m of audio.doc.markers) {
      const pos = markerDrag.current?.id === m.id ? markerDrag.current.pos : m.pos;
      const x = Math.round(xOf(pos)) + 0.5;
      if (x < -1 || x > w + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // cursor
    const cx = Math.round(xOf(s.cursor)) + 0.5;
    if (cx >= 0 && cx <= w) {
      ctx.strokeStyle = theme.cursor;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // playhead
    if (s.playing && !s.playingMix) {
      const pos = audio.player.position();
      if (pos !== null) {
        const px = Math.round(xOf(pos));
        ctx.fillStyle = theme.playhead;
        ctx.fillRect(px - 1, 0, 2, h);
      }
    }
    // hover line
    if (s.hover !== null && !drag.current) {
      const hx = Math.round(xOf(s.hover)) + 0.5;
      ctx.strokeStyle = theme.textDim;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawRulerLayer(theme: Theme, w: number, dpr: number) {
    const ctx = rulerRef.current?.getContext('2d');
    if (!ctx) return;
    const s = ui();
    const v = s.view;
    drawRuler(ctx, w, RULER_H, dpr, v, audio.sampleRate, theme);
    if (!audio.length) return;
    const xOf = (pos: number) => (pos - v.start) / v.spp;
    if (s.selection) {
      ctx.fillStyle = theme.selection;
      ctx.globalAlpha = 0.35;
      const x1 = xOf(s.selection.start);
      ctx.fillRect(x1, RULER_H - 5, xOf(s.selection.end) - x1, 4);
      ctx.globalAlpha = 1;
    }
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const m of audio.doc.markers) {
      const pos = markerDrag.current?.id === m.id ? markerDrag.current.pos : m.pos;
      const x = Math.round(xOf(pos));
      if (x < -120 || x > w + 4) continue;
      ctx.fillStyle = theme.marker;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 2);
      ctx.lineTo(x - 5, RULER_H - 10);
      ctx.lineTo(x + 5, RULER_H - 10);
      ctx.closePath();
      ctx.fill();
      const label = m.label.length > 24 ? `${m.label.slice(0, 23)}…` : m.label;
      const tw = ctx.measureText(label).width;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(x + 4, 2, tw + 8, 13);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1b1300';
      ctx.fillText(label, x + 8, 9);
    }
    const playing = s.playing && !s.playingMix ? audio.player.position() : null;
    const head = playing ?? s.cursor;
    const hx = Math.round(xOf(head));
    if (hx >= -6 && hx <= w + 6) {
      ctx.fillStyle = playing !== null ? theme.playhead : theme.cursor;
      ctx.beginPath();
      ctx.moveTo(hx, RULER_H);
      ctx.lineTo(hx - 5, RULER_H - 8);
      ctx.lineTo(hx + 5, RULER_H - 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawOverview(theme: Theme, w: number, dpr: number) {
    const ctx = overviewRef.current?.getContext('2d');
    if (!ctx) return;
    const s = ui();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = Math.round(w * dpr);
    const H = Math.round(OVERVIEW_H * dpr);
    ctx.clearRect(0, 0, W, H);
    const len = audio.length;
    if (!len) return;
    const spp = len / W;
    if (!overviewCols.current || overviewCols.current.min.length !== W) overviewCols.current = createColumns(W);
    const cols = overviewCols.current;
    const lo = new Float32Array(W).fill(0);
    const hi = new Float32Array(W).fill(0);
    for (let c = 0; c < audio.doc.channels.length; c++) {
      audio.peaks.query(c, 0, spp, cols);
      for (let x = 0; x < W; x++) {
        if (!cols.valid[x]) continue;
        if (cols.min[x] < lo[x]) lo[x] = cols.min[x];
        if (cols.max[x] > hi[x]) hi[x] = cols.max[x];
      }
    }
    ctx.fillStyle = theme.wave;
    ctx.globalAlpha = 0.75;
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      const y1 = mid - Math.min(1, hi[x]) * (mid - 2);
      const y2 = mid - Math.max(-1, lo[x]) * (mid - 2);
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    ctx.globalAlpha = 1;
    const xOf = (pos: number) => (pos / len) * W;
    if (s.selection) {
      ctx.fillStyle = theme.selection;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(xOf(s.selection.start), 0, Math.max(1, xOf(s.selection.end) - xOf(s.selection.start)), H);
      ctx.globalAlpha = 1;
    }
    const v = s.view;
    const vx = xOf(v.start);
    const vw = Math.max(3 * dpr, xOf(v.start + size.current.w * v.spp) - vx);
    ctx.strokeStyle = theme.cursor;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.globalAlpha = 0.8;
    ctx.strokeRect(vx + 0.5, 0.5, vw - 1, H - 1);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = theme.cursor;
    ctx.fillRect(vx, 0, vw, H);
    ctx.globalAlpha = 1;
    const head = s.playing && !s.playingMix ? audio.player.position() : s.cursor;
    if (head !== null) {
      ctx.fillStyle = s.playing ? theme.playhead : theme.cursor;
      ctx.fillRect(Math.round(xOf(head)), 0, Math.max(1, dpr), H);
    }
  }

  /* ------------------------------ sizing ------------------------------ */

  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      size.current = { w, h, dpr };
      for (const [canvas, ch] of [
        [waveRef.current, h],
        [overlayRef.current, h],
        [rulerRef.current, RULER_H],
        [overviewRef.current, OVERVIEW_H],
      ] as const) {
        if (!canvas) continue;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(ch * dpr));
        canvas.style.width = `${w}px`;
        canvas.style.height = `${ch}px`;
      }
      const firstSize = audio.viewWidth === 800 && w !== 800;
      audio.viewWidth = Math.max(50, w);
      if (firstSize && audio.length) audio.zoomFit();
      else audio.setView(ui().view);
      themeRef.current = null;
      schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------- subscriptions ---------------------------- */

  useEffect(() => {
    const unsub = useAudioUI.subscribe((s, prev) => {
      if (s.view !== prev.view || s.revision !== prev.revision || s.ampZoom !== prev.ampZoom || s.spectral !== prev.spectral || s.spectralLog !== prev.spectralLog) schedule();
      else if (s.selection !== prev.selection || s.cursor !== prev.cursor || s.hover !== prev.hover || s.playing !== prev.playing) schedule({ overlay: true, ruler: true, overview: true });
    });
    // theme, gradient or accent changes (data attributes on <html>)
    const mo = new MutationObserver(() => {
      themeRef.current = null;
      schedule();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-gradient', 'data-accent'] });
    return () => {
      unsub();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) schedule();
    else if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /* ------------------------------ wheel ------------------------------ */

  useEffect(() => {
    const els = [lanesRef.current, rulerRef.current, overviewRef.current].filter(Boolean) as HTMLElement[];
    const onWheel = (e: WheelEvent) => {
      if (!audio.length) return;
      e.preventDefault();
      const v = ui().view;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        audio.zoomBy(Math.exp(-e.deltaY * unit * 0.0025), sampleAt(e.clientX));
      } else if (e.altKey) {
        const amp = Math.min(64, Math.max(0.25, ui().ampZoom * Math.exp(-e.deltaY * unit * 0.002)));
        setUI({ ampZoom: amp });
      } else {
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        audio.setView({ start: v.start + dx * unit * v.spp, spp: v.spp });
      }
    };
    els.forEach((el) => el.addEventListener('wheel', onWheel, { passive: false }));
    return () => els.forEach((el) => el.removeEventListener('wheel', onWheel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------- lane pointer events --------------------------- */

  function updateSelectionDrag() {
    const d = drag.current;
    if (!d || d.kind !== 'select') return;
    const rect = lanesRef.current!.getBoundingClientRect();
    const pos = Math.max(0, Math.min(audio.length, sampleAt(rect.left + pointerX.current)));
    if (!d.moved && Math.abs(pointerX.current - d.startX) < 3) return;
    d.moved = true;
    audio.setSelection({ start: Math.min(d.anchor, pos), end: Math.max(d.anchor, pos) });
  }

  const onLaneDown = (e: React.PointerEvent) => {
    if (!audio.length) return;
    const rect = lanesRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    pointerX.current = x;
    if (e.button === 1) {
      e.preventDefault();
      drag.current = { kind: 'pan', startX: x, startView: ui().view.start };
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const v = ui().view;
    const pos = Math.max(0, Math.min(audio.length, sampleAt(e.clientX)));
    const sel = audio.selection();
    let anchor = pos;
    let moved = false;
    if (sel) {
      const xs = (sel.start - v.start) / v.spp;
      const xe = (sel.end - v.start) / v.spp;
      if (Math.abs(x - xs) <= 6) {
        anchor = sel.end;
        moved = true;
      } else if (Math.abs(x - xe) <= 6) {
        anchor = sel.start;
        moved = true;
      } else if (e.shiftKey) {
        anchor = Math.abs(pos - sel.start) < Math.abs(pos - sel.end) ? sel.end : sel.start;
        moved = true;
      }
    } else if (e.shiftKey) {
      anchor = ui().cursor;
      moved = true;
    }
    drag.current = { kind: 'select', anchor, startX: x, moved };
    if (moved) audio.setSelection({ start: Math.min(anchor, pos), end: Math.max(anchor, pos) });
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onLaneMove = (e: React.PointerEvent) => {
    if (!audio.length) return;
    const rect = lanesRef.current!.getBoundingClientRect();
    pointerX.current = e.clientX - rect.left;
    const d = drag.current;
    if (!d) {
      setUI({ hover: Math.max(0, Math.min(audio.length, sampleAt(e.clientX))) });
      const sel = audio.selection();
      if (sel && overlayRef.current) {
        const v = ui().view;
        const near = Math.abs(pointerX.current - (sel.start - v.start) / v.spp) <= 6 || Math.abs(pointerX.current - (sel.end - v.start) / v.spp) <= 6;
        overlayRef.current.style.cursor = near ? 'col-resize' : 'text';
      }
      return;
    }
    if (d.kind === 'pan') {
      const v = ui().view;
      audio.setView({ start: d.startView - (pointerX.current - d.startX) * v.spp, spp: v.spp });
      return;
    }
    if (d.kind === 'select') {
      updateSelectionDrag();
      if (pointerX.current < 0 || pointerX.current > size.current.w) schedule({ overlay: true });
    }
  };

  const onLaneUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (d.kind === 'select') {
      if (!d.moved) {
        audio.setSelection(null);
        audio.seek(Math.max(0, Math.min(audio.length, sampleAt(e.clientX))));
      } else {
        const sel = audio.selection();
        if (sel && !ui().playing) audio.setCursor(sel.start);
      }
    }
  };

  const onLaneDoubleClick = () => {
    const v = ui().view;
    audio.setSelection({ start: v.start, end: v.start + size.current.w * v.spp });
  };

  /* ------------------------------- ruler ------------------------------- */

  const markerAt = (clientX: number, clientY: number) => {
    const rect = rulerRef.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const v = ui().view;
    for (const m of [...audio.doc.markers].reverse()) {
      const mx = (m.pos - v.start) / v.spp;
      if (Math.abs(x - mx) <= 6 && y >= RULER_H - 12) return m;
      if (y < 16 && x >= mx && x <= mx + 12 + m.label.length * 6) return m;
    }
    return null;
  };

  const onRulerDown = (e: React.PointerEvent) => {
    if (!audio.length || e.button !== 0) return;
    const m = markerAt(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture(e.pointerId);
    if (m) {
      drag.current = { kind: 'marker', id: m.id, pos: m.pos, startX: e.clientX, moved: false };
      markerDrag.current = { id: m.id, pos: m.pos };
      return;
    }
    drag.current = { kind: 'scrub' };
    audio.seek(Math.max(0, Math.min(audio.length, sampleAt(e.clientX))));
  };

  const onRulerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (rulerRef.current) rulerRef.current.style.cursor = markerAt(e.clientX, e.clientY) ? 'ew-resize' : 'pointer';
      return;
    }
    const pos = Math.max(0, Math.min(audio.length, sampleAt(e.clientX)));
    if (d.kind === 'marker') {
      if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
      d.moved = true;
      markerDrag.current = { id: d.id, pos: Math.round(pos) };
      schedule({ overlay: true, ruler: true });
    } else if (d.kind === 'scrub') {
      audio.setCursor(pos);
    }
  };

  const onRulerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (d?.kind === 'marker') {
      const md = markerDrag.current;
      markerDrag.current = null;
      if (d.moved && md) audio.updateMarker(d.id, { pos: md.pos });
      else audio.seek(d.pos);
      schedule({ overlay: true, ruler: true });
    } else if (d?.kind === 'scrub' && ui().playing && !ui().playingMix && !ui().previewing) {
      audio.seek(ui().cursor);
    }
  };

  const onRulerDoubleClick = async (e: React.MouseEvent) => {
    const m = markerAt(e.clientX, e.clientY);
    if (!m) {
      audio.addMarker(Math.round(sampleAt(e.clientX)));
      return;
    }
    const label = await promptDialog({ title: t('Rename marker'), defaultValue: m.label, confirmLabel: t('Rename') });
    if (label !== null && label.trim()) audio.updateMarker(m.id, { label: label.trim().slice(0, 120) });
  };

  /* ------------------------------ overview ------------------------------ */

  const overviewPos = (clientX: number) => {
    const rect = overviewRef.current!.getBoundingClientRect();
    return ((clientX - rect.left) / Math.max(1, rect.width)) * audio.length;
  };

  const onOverviewDown = (e: React.PointerEvent) => {
    if (!audio.length || e.button !== 0) return;
    const v = ui().view;
    const span = size.current.w * v.spp;
    const pos = overviewPos(e.clientX);
    const inside = pos >= v.start && pos <= v.start + span;
    const grab = inside ? pos - v.start : span / 2;
    drag.current = { kind: 'overview', grab };
    audio.setView({ start: pos - grab, spp: v.spp });
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onOverviewMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.kind !== 'overview') return;
    audio.setView({ start: overviewPos(e.clientX) - d.grab, spp: ui().view.spp });
  };

  const onOverviewUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const empty = !audio.length;
  const style = { '--au-ruler-h': `${RULER_H}px` } as CSSProperties;

  return (
    <div className="au-wave" style={style}>
      <canvas ref={overviewRef} className="au-overview" onPointerDown={onOverviewDown} onPointerMove={onOverviewMove} onPointerUp={onOverviewUp} />
      <canvas
        ref={rulerRef}
        className="au-ruler"
        onPointerDown={onRulerDown}
        onPointerMove={onRulerMove}
        onPointerUp={onRulerUp}
        onDoubleClick={(e) => void onRulerDoubleClick(e)}
      />
      <div className="au-lanes" ref={lanesRef} onContextMenu={empty ? undefined : ctxMenu.open(() => buildContextMenu(sampleAt(pointerX.current + (lanesRef.current?.getBoundingClientRect().left ?? 0))))}>
        <canvas ref={waveRef} className="au-canvas" />
        <canvas
          ref={overlayRef}
          className="au-canvas au-overlay"
          onPointerDown={onLaneDown}
          onPointerMove={onLaneMove}
          onPointerUp={onLaneUp}
          onPointerLeave={() => !drag.current && setUI({ hover: null })}
          onDoubleClick={onLaneDoubleClick}
        />
        {!empty && (
          <div className="au-ampzoom">
            <IconButton icon={Plus} size="sm" label={t('Zoom in amplitude (Alt+wheel)')} onClick={() => setUI({ ampZoom: Math.min(64, ampZoom * 1.5) })} />
            <button type="button" className="au-ampzoom-value" title={t('Reset amplitude zoom')} onClick={() => setUI({ ampZoom: 1 })}>
              {ampZoom === 1 ? '1×' : `${ampZoom < 10 ? ampZoom.toFixed(1) : Math.round(ampZoom)}×`}
            </button>
            <IconButton icon={Minus} size="sm" label={t('Zoom out amplitude')} onClick={() => setUI({ ampZoom: Math.max(0.25, ampZoom / 1.5) })} />
          </div>
        )}
        {empty && (
          <EmptyState icon={<AudioWaveform size={40} color="var(--accent)" />} title={audio.hasAudio ? t('This file is empty') : t('Open, record or generate audio')}>
            <div className="muted" style={{ maxWidth: 440 }}>
              {t('Drop an audio or video file here (MP3, WAV, OGG, FLAC, M4A, AAC, Opus, WebM, MP4…), record from your microphone, or generate a tone.')}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button variant="primary" icon={FolderOpen} onClick={() => void pickAndOpen()}>
                {t('Open file…')}
              </Button>
              <Button icon={Mic} onClick={() => setUI({ dialog: { kind: 'record' } })}>
                {t('Record…')}
              </Button>
              <Button icon={Music} onClick={() => setUI({ dialog: { kind: 'generate', generator: 'tone' } })}>
                {t('Generate tone…')}
              </Button>
            </div>
          </EmptyState>
        )}
      </div>
      {ctxMenu.element}
    </div>
  );
}
