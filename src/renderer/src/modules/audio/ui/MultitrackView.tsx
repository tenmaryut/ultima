import { useEffect, useRef } from 'react';
import { AudioWaveform, Download, FileUp, Layers, Maximize2, Plus, Scissors, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { pickFiles } from '../../../core/platform';
import { Button, EmptyState, IconButton, promptDialog, useContextMenu } from '../../../components/ui';
import { mt } from '../mt';
import { audio } from '../controller';
import { setUI, ui, useAudioUI } from '../state';
import { mixdownToNewFile, loadDecoded, confirmDiscard } from '../files';
import { OPEN_ACCEPT } from '../engine/io';
import { findClip, type MtClip, type MtSession } from '../engine/multitrack';
import { createColumns } from '../engine/peaks';
import { drawRuler, readTheme, type Theme } from './draw';

const ROW_H = 84;
const RULER_H = 26;
const EDGE = 7;

type Drag =
  | { kind: 'move'; id: string; startX: number; origStart: number; origSession: MtSession; moved: boolean }
  | { kind: 'trim'; id: string; edge: 'start' | 'end'; origSession: MtSession }
  | { kind: 'playhead' };

const columns = { current: createColumns(1) };

function TrackHeader({ index }: { index: number }) {
  const t = useT();
  const track = mt.session.tracks[index];
  if (!track) return null;
  return (
    <div className="au-mt-header" style={{ height: ROW_H }}>
      <div className="row" style={{ gap: 4 }}>
        <span className="au-mt-color" style={{ background: track.color }} />
        <span
          className="grow au-mt-name"
          title={t('Double-click to rename')}
          onDoubleClick={async () => {
            const name = await promptDialog({ title: t('Rename track'), defaultValue: track.name, confirmLabel: t('Rename') });
            if (name !== null && name.trim()) mt.updateTrack(track.id, { name: name.trim().slice(0, 60) });
          }}
        >
          {track.name}
        </span>
        <button type="button" className={`au-ms ${track.mute ? 'on mute' : ''}`} title={t('Mute')} onClick={() => mt.updateTrack(track.id, { mute: !track.mute })}>
          M
        </button>
        <button type="button" className={`au-ms ${track.solo ? 'on solo' : ''}`} title={t('Solo')} onClick={() => mt.updateTrack(track.id, { solo: !track.solo })}>
          S
        </button>
        <IconButton icon={Trash2} size="sm" label={t('Delete track')} onClick={() => mt.removeTrack(track.id)} />
      </div>
      <label className="au-mt-slider" title={t('Volume')}>
        <span className="faint">{t('Vol')}</span>
        <input
          type="range"
          min={-60}
          max={12}
          step={0.5}
          value={track.volumeDb}
          onChange={(e) => mt.updateTrack(track.id, { volumeDb: parseFloat(e.target.value) }, false)}
          onPointerDown={() => (prevSession.current = mt.session)}
          onPointerUp={() => prevSession.current && mt.commitFrom(prevSession.current, t('Track volume'))}
          onDoubleClick={() => mt.updateTrack(track.id, { volumeDb: 0 })}
        />
        <span className="mono">{track.volumeDb > 0 ? '+' : ''}{track.volumeDb.toFixed(1)}</span>
      </label>
      <label className="au-mt-slider" title={t('Pan')}>
        <span className="faint">{t('Pan')}</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.02}
          value={track.pan}
          onChange={(e) => mt.updateTrack(track.id, { pan: parseFloat(e.target.value) }, false)}
          onPointerDown={() => (prevSession.current = mt.session)}
          onPointerUp={() => prevSession.current && mt.commitFrom(prevSession.current, t('Track pan'))}
          onDoubleClick={() => mt.updateTrack(track.id, { pan: 0 })}
        />
        <span className="mono">{Math.abs(track.pan) < 0.01 ? 'C' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}</span>
      </label>
    </div>
  );
}

const prevSession: { current: MtSession | null } = { current: null };

export function MultitrackView({ active }: { active: boolean }) {
  const t = useT();
  const mtRevision = useAudioUI((s) => s.mtRevision);
  const timelineRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const raf = useRef(0);
  const themeRef = useRef<Theme | null>(null);
  const ctxMenu = useContextMenu();
  const activeRef = useRef(active);
  activeRef.current = active;
  void mtRevision;
  const tracks = mt.session.tracks;

  const schedule = () => {
    if (!raf.current && activeRef.current) raf.current = requestAnimationFrame(frame);
  };

  function frame() {
    raf.current = 0;
    let again = false;
    for (const src of mt.sources.values()) {
      if (src.peaks.dirty) {
        src.peaks.pump(6);
        again = again || src.peaks.dirty;
      }
    }
    const s = ui();
    if (s.playing && s.playingMix) {
      const pos = audio.player.position();
      if (pos !== null) {
        mt.playhead = pos;
        const span = mt.viewWidth * mt.view.spp;
        if (pos > mt.view.start + span * 0.95 || pos < mt.view.start) mt.view = { ...mt.view, start: Math.max(0, pos - span * 0.05) };
      }
      again = true;
    }
    draw();
    if (again) raf.current = requestAnimationFrame(frame);
  }

  function draw() {
    const theme = (themeRef.current ??= readTheme(timelineRef.current ?? document.body));
    const dpr = window.devicePixelRatio || 1;
    const w = timelineRef.current?.clientWidth ?? 0;
    if (!w) return;
    const ruler = rulerRef.current;
    if (ruler) {
      ruler.width = Math.round(w * dpr);
      ruler.height = Math.round(RULER_H * dpr);
      ruler.style.width = `${w}px`;
      const rctx = ruler.getContext('2d')!;
      drawRuler(rctx, w, RULER_H, dpr, mt.view, mt.sampleRate, theme);
      const px = (mt.playhead - mt.view.start) / mt.view.spp;
      rctx.fillStyle = theme.playhead;
      rctx.beginPath();
      rctx.moveTo(px, RULER_H);
      rctx.lineTo(px - 5, RULER_H - 8);
      rctx.lineTo(px + 5, RULER_H - 8);
      rctx.fill();
    }
    const canvas = lanesRef.current;
    if (!canvas) return;
    // read live state: draw() also runs from callbacks created during earlier renders
    const h = Math.max(ROW_H, mt.session.tracks.length * ROW_H);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.lane;
    ctx.fillRect(0, 0, w, h);
    const v = mt.view;
    const xOf = (f: number) => (f - v.start) / v.spp;
    mt.session.tracks.forEach((track, i) => {
      const y = i * ROW_H;
      ctx.fillStyle = theme.grid;
      ctx.fillRect(0, y + ROW_H - 1, w, 1);
      for (const clip of track.clips) {
        const x1 = xOf(clip.start);
        const x2 = xOf(clip.start + clip.length);
        if (x2 < 0 || x1 > w) continue;
        drawClip(ctx, clip, x1, x2, y + 3, ROW_H - 7, track.color, clip.id === mt.selectedClip, track.mute, theme, dpr);
      }
    });
    const px = Math.round(xOf(mt.playhead)) + 0.5;
    ctx.strokeStyle = theme.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  function drawClip(ctx: CanvasRenderingContext2D, clip: MtClip, x1: number, x2: number, y: number, h: number, color: string, selected: boolean, muted: boolean, theme: Theme, dpr: number) {
    const src = mt.sources.get(clip.sourceId);
    const w = Math.max(2, x2 - x1);
    ctx.save();
    ctx.globalAlpha = muted ? 0.4 : 1;
    ctx.beginPath();
    ctx.roundRect(x1, y, w, h, 5);
    ctx.fillStyle = color + '33';
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? theme.cursor : color;
    ctx.stroke();
    ctx.clip();
    if (src) {
      const visibleFrom = Math.max(x1, 0);
      const visibleTo = Math.min(x2, ctx.canvas.width / dpr);
      const cols = Math.max(1, Math.round(visibleTo - visibleFrom));
      if (columns.current.min.length !== cols) columns.current = createColumns(cols);
      const spp = mt.view.spp;
      const startSample = clip.offset + (visibleFrom - x1) * spp;
      const mid = y + h / 2 + 6;
      const amp = (h - 18) / 2;
      ctx.fillStyle = color;
      for (let c = 0; c < Math.min(2, src.channels.length); c++) {
        src.peaks.query(c, startSample, spp, columns.current);
        const { min, max, valid } = columns.current;
        for (let i = 0; i < cols; i++) {
          if (!valid[i]) continue;
          const sampleIdx = startSample + i * spp;
          if (sampleIdx >= clip.offset + clip.length) break;
          const top = mid - Math.min(1, max[i]) * amp;
          const bottom = mid - Math.max(-1, min[i]) * amp;
          ctx.globalAlpha = (muted ? 0.3 : 0.8) / (c + 1);
          ctx.fillRect(visibleFrom + i, top, 1, Math.max(1, bottom - top));
        }
      }
      ctx.globalAlpha = muted ? 0.4 : 1;
    }
    // fades
    ctx.strokeStyle = theme.cursor;
    ctx.lineWidth = 1;
    if (clip.fadeIn > 0) {
      ctx.beginPath();
      ctx.moveTo(x1, y + h);
      ctx.lineTo(x1 + clip.fadeIn / mt.view.spp, y);
      ctx.stroke();
    }
    if (clip.fadeOut > 0) {
      ctx.beginPath();
      ctx.moveTo(x2 - clip.fadeOut / mt.view.spp, y);
      ctx.lineTo(x2, y + h);
      ctx.stroke();
    }
    ctx.fillStyle = theme.text;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(src?.name ?? '?', x1 + 6, y + 4);
    ctx.restore();
  }

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      mt.viewWidth = el.clientWidth;
      themeRef.current = null;
      schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    schedule();
  });

  useEffect(() => {
    const unsub = useAudioUI.subscribe((s, prev) => {
      if (s.playing !== prev.playing || s.mtRevision !== prev.mtRevision) schedule();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active && raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
  }, [active]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        mt.zoomBy(Math.exp(-e.deltaY * 0.0025), mt.view.start + (e.clientX - rect.left) * mt.view.spp);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        mt.scrollTo(mt.view.start + (e.deltaX || e.deltaY) * mt.view.spp);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const frameAt = (clientX: number) => {
    const rect = lanesRef.current!.getBoundingClientRect();
    return mt.view.start + (clientX - rect.left) * mt.view.spp;
  };

  const hitClip = (clientX: number, clientY: number): { clip: MtClip; edge: 'start' | 'end' | null } | null => {
    const rect = lanesRef.current!.getBoundingClientRect();
    const row = Math.floor((clientY - rect.top) / ROW_H);
    const track = mt.session.tracks[row];
    if (!track) return null;
    const x = clientX - rect.left;
    for (const clip of [...track.clips].reverse()) {
      const x1 = (clip.start - mt.view.start) / mt.view.spp;
      const x2 = (clip.start + clip.length - mt.view.start) / mt.view.spp;
      if (x >= x1 - 2 && x <= x2 + 2) return { clip, edge: x - x1 <= EDGE && x2 - x1 > EDGE * 3 ? 'start' : x2 - x <= EDGE && x2 - x1 > EDGE * 3 ? 'end' : null };
    }
    return null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const hit = hitClip(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture(e.pointerId);
    if (!hit) {
      mt.selectClip(null);
      drag.current = { kind: 'playhead' };
      mt.playhead = Math.max(0, Math.round(frameAt(e.clientX)));
      if (ui().playingMix) void mt.play();
      mt.bump();
      return;
    }
    mt.selectClip(hit.clip.id);
    drag.current = hit.edge
      ? { kind: 'trim', id: hit.clip.id, edge: hit.edge, origSession: mt.session }
      : { kind: 'move', id: hit.clip.id, startX: e.clientX, origStart: hit.clip.start, origSession: mt.session, moved: false };
  };

  const snap = (frame: number, ignoreId: string) => {
    const tol = 8 * mt.view.spp;
    const candidates = [0, mt.playhead];
    for (const tr of mt.session.tracks) for (const c of tr.clips) if (c.id !== ignoreId) candidates.push(c.start, c.start + c.length);
    let best = frame;
    let bestD = tol;
    for (const c of candidates) {
      const d = Math.abs(c - frame);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      const hit = hitClip(e.clientX, e.clientY);
      if (lanesRef.current) lanesRef.current.style.cursor = hit?.edge ? 'ew-resize' : hit ? 'grab' : 'default';
      return;
    }
    if (d.kind === 'playhead') {
      mt.playhead = Math.max(0, Math.round(frameAt(e.clientX)));
      mt.bump();
      return;
    }
    if (d.kind === 'trim') {
      mt.trimClip(d.id, d.edge, snap(frameAt(e.clientX), d.id), false);
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
    d.moved = true;
    const found = findClip(mt.session, d.id);
    if (!found) return;
    const rect = lanesRef.current!.getBoundingClientRect();
    const row = Math.max(0, Math.min(mt.session.tracks.length - 1, Math.floor((e.clientY - rect.top) / ROW_H)));
    let start = d.origStart + (e.clientX - d.startX) * mt.view.spp;
    const snappedStart = snap(start, d.id);
    const snappedEnd = snap(start + found.clip.length, d.id) - found.clip.length;
    start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd;
    mt.moveClip(d.id, start, mt.session.tracks[row]?.id, false);
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (d?.kind === 'move' && d.moved) mt.commitFrom(d.origSession, t('Move clip'));
    if (d?.kind === 'trim') mt.commitFrom(d.origSession, t('Trim clip'));
  };

  const openInWaveform = async (clip: MtClip) => {
    const src = mt.sources.get(clip.sourceId);
    if (!src || !(await confirmDiscard())) return;
    loadDecoded(`${src.name}.wav`, src.sampleRate, src.channels.map((c) => c.slice(clip.offset, clip.offset + clip.length)), t('Multitrack clip'));
  };

  const clipMenu = (e: React.MouseEvent) => {
    const hit = hitClip(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const clip = hit.clip;
    mt.selectClip(clip.id);
    const half = Math.round(mt.sampleRate * 0.5);
    ctxMenu.show(e.clientX, e.clientY, [
      { label: t('Split at playhead'), icon: Scissors, onClick: () => mt.splitAtPlayhead() },
      { label: t('Duplicate'), onClick: () => mt.duplicateSelectedClip() },
      { label: t('Delete'), icon: Trash2, onClick: () => mt.deleteSelectedClip() },
      { type: 'separator' },
      { label: t('Fade in 0.5 s'), onClick: () => mt.set({ ...mt.session, tracks: mt.session.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === clip.id ? { ...c, fadeIn: Math.min(half, c.length) } : c)) })) }, true, t('Fade')) },
      { label: t('Fade out 0.5 s'), onClick: () => mt.set({ ...mt.session, tracks: mt.session.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === clip.id ? { ...c, fadeOut: Math.min(half, c.length) } : c)) })) }, true, t('Fade')) },
      { label: t('Remove fades'), onClick: () => mt.set({ ...mt.session, tracks: mt.session.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === clip.id ? { ...c, fadeIn: 0, fadeOut: 0 } : c)) })) }, true, t('Fade')) },
      { type: 'separator' },
      { label: t('Open clip in Waveform editor'), icon: AudioWaveform, onClick: () => void openInWaveform(clip) },
    ]);
  };

  const importFiles = async () => {
    const files = await pickFiles({ accept: OPEN_ACCEPT.replace(',.ultima', ''), multiple: true });
    if (files.length) await mt.importFiles(files);
  };

  return (
    <div className="au-mt">
      <div className="au-mt-toolbar">
        <Button size="sm" icon={Plus} onClick={() => mt.addTrack()}>
          {t('Track')}
        </Button>
        <Button size="sm" icon={FileUp} onClick={() => void importFiles()}>
          {t('Import files…')}
        </Button>
        <Button size="sm" icon={AudioWaveform} disabled={!audio.length} onClick={() => void mt.addFromWaveform()}>
          {t('Add waveform audio')}
        </Button>
        <IconButton icon={Scissors} label={t('Split at playhead (S)')} disabled={!mt.length} onClick={() => mt.splitAtPlayhead()} />
        <span className="vsep" />
        <IconButton icon={ZoomOut} label={t('Zoom out')} onClick={() => mt.zoomBy(0.5)} />
        <IconButton icon={ZoomIn} label={t('Zoom in')} onClick={() => mt.zoomBy(2)} />
        <IconButton icon={Maximize2} label={t('Zoom to fit')} onClick={() => mt.fit()} />
        <span className="spacer" />
        <Button size="sm" icon={Download} disabled={!mt.length} onClick={() => setUI({ dialog: { kind: 'export', multitrack: true } })}>
          {t('Export mix…')}
        </Button>
        <Button size="sm" variant="primary" icon={Layers} disabled={!mt.length} onClick={() => void mixdownToNewFile()}>
          {t('Mixdown to new file')}
        </Button>
      </div>
      <div className="au-mt-rulerrow">
        <div className="au-mt-corner" />
        <div className="au-mt-rulerwrap">
          <canvas
            ref={rulerRef}
            className="au-mt-ruler"
            onPointerDown={(e) => {
              mt.playhead = Math.max(0, Math.round(mt.view.start + (e.clientX - e.currentTarget.getBoundingClientRect().left) * mt.view.spp));
              if (ui().playingMix) void mt.play();
              mt.bump();
            }}
          />
        </div>
      </div>
      <div className="au-mt-scroll">
        <div className="au-mt-headers">
          {tracks.map((tr, i) => (
            <TrackHeader key={tr.id} index={i} />
          ))}
        </div>
        <div className="au-mt-timeline" ref={timelineRef} onContextMenu={clipMenu}>
          <canvas ref={lanesRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
          {!tracks.length && (
            <EmptyState icon={<Layers size={36} color="var(--accent)" />} title={t('Multitrack session')}>
              <div className="muted" style={{ maxWidth: 420 }}>
                {t('Combine several recordings: import files or add the audio from the Waveform editor, then move clips in time, set volume and pan, and mix down.')}
              </div>
              <div className="row">
                <Button variant="primary" icon={FileUp} onClick={() => void importFiles()}>
                  {t('Import files…')}
                </Button>
                <Button icon={AudioWaveform} disabled={!audio.length} onClick={() => void mt.addFromWaveform()}>
                  {t('Add waveform audio')}
                </Button>
              </div>
            </EmptyState>
          )}
        </div>
      </div>
      {ctxMenu.element}
    </div>
  );
}
