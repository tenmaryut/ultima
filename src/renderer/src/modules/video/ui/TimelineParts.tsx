import { memo, useEffect, useRef, type RefObject } from 'react';
import {
  Captions,
  Eye,
  EyeOff,
  Flag,
  Headphones,
  Link2,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  MousePointer2,
  Plus,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Unlink2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  ArrowLeftToLine,
  ArrowRightToLine,
  Film,
  Music,
} from 'lucide-react';
import type { Track, TrackKind } from '../types';
import { useT } from '../../../core/i18n';
import { DropdownButton, IconButton } from '../../../components/ui';
import type { TimeStore } from '../timeStore';
import { formatRulerTime, rulerStep } from '../time';

export const TRACK_HEIGHT: Record<TrackKind, number> = { video: 58, audio: 50, caption: 32 };
export const RULER_H = 28;

/* ---------------------------------- Ruler --------------------------------- */

/** Canvas with ticks + labels for the visible time range (redrawn imperatively on scroll). */
export function drawRuler(canvas: HTMLCanvasElement, scrollLeft: number, width: number, pps: number, fps: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(width));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(RULER_H * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(RULER_H * dpr);
  }
  canvas.style.width = `${w}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, RULER_H);
  const css = getComputedStyle(canvas);
  const tick = css.getPropertyValue('--text-3').trim() || '#777';
  const text = css.getPropertyValue('--text-2').trim() || '#aaa';
  const { major, minor } = rulerStep(pps, fps);
  const t0 = scrollLeft / pps;
  const t1 = (scrollLeft + w) / pps;
  ctx.fillStyle = tick;
  const firstMinor = Math.floor(t0 / minor) * minor;
  for (let t = firstMinor; t <= t1; t += minor) {
    const x = Math.round(t * pps - scrollLeft) + 0.5;
    ctx.fillRect(x, RULER_H - 5, 1, 5);
  }
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  const firstMajor = Math.floor(t0 / major) * major;
  const withFrames = major < 1;
  for (let t = firstMajor; t <= t1 + major; t += major) {
    const x = Math.round(t * pps - scrollLeft) + 0.5;
    ctx.fillStyle = tick;
    ctx.fillRect(x, RULER_H - 11, 1, 11);
    ctx.fillStyle = text;
    ctx.fillText(formatRulerTime(t + 1e-9, fps, withFrames), x + 4, 11);
  }
}

/* -------------------------------- Playhead -------------------------------- */

/** Playhead line; follows the time store at 60 fps and pages the view during playback. */
export const Playhead = memo(function Playhead({
  time,
  pps,
  scrollRef,
  playing,
}: {
  time: TimeStore;
  pps: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  playing: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const x = time.get() * pps;
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const sc = scrollRef.current;
      if (playing && sc) {
        if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - 80;
        else if (x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 80);
      }
    };
    update();
    return time.subscribe(update);
  }, [time, pps, scrollRef, playing]);
  return <div ref={ref} className="vd-playhead" />;
});

/* ------------------------------- Track header ------------------------------ */

export const TrackHeader = memo(function TrackHeader({
  track,
  height,
  onPatch,
  onContextMenu,
}: {
  track: Track;
  height: number;
  onPatch: (trackId: string, patch: Partial<Track>) => void;
  onContextMenu: (e: React.MouseEvent, track: Track) => void;
}) {
  const t = useT();
  return (
    <div className={`vd-tl-head kind-${track.kind}`} style={{ height }} onContextMenu={(e) => onContextMenu(e, track)}>
      <span className="vd-track-name" title={track.name}>
        {track.name}
      </span>
      {track.kind !== 'audio' && (
        <IconButton
          size="sm"
          icon={track.hidden ? EyeOff : Eye}
          label={track.hidden ? t('Show track') : t('Hide track')}
          active={track.hidden}
          onClick={() => onPatch(track.id, { hidden: !track.hidden })}
        />
      )}
      {track.kind === 'audio' && (
        <>
          <IconButton
            size="sm"
            icon={track.muted ? VolumeX : Volume2}
            label={track.muted ? t('Unmute track') : t('Mute track')}
            active={track.muted}
            onClick={() => onPatch(track.id, { muted: !track.muted })}
          />
          <IconButton size="sm" icon={Headphones} label={t('Solo track')} active={track.solo} onClick={() => onPatch(track.id, { solo: !track.solo })} />
        </>
      )}
      <IconButton
        size="sm"
        icon={track.locked ? Lock : LockOpen}
        label={track.locked ? t('Unlock track') : t('Lock track')}
        active={track.locked}
        onClick={() => onPatch(track.id, { locked: !track.locked })}
      />
    </div>
  );
});

/* --------------------------------- Toolbar --------------------------------- */

export interface ToolbarActions {
  split: () => void;
  rippleDelete: () => void;
  deleteSelection: () => void;
  link: () => void;
  unlink: () => void;
  addMarker: () => void;
  setIn: () => void;
  setOut: () => void;
  addTrack: (kind: TrackKind) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
}

export function TimelineToolbar({
  tool,
  setTool,
  snapping,
  setSnapping,
  hasSelection,
  pps,
  setPps,
  actions,
}: {
  tool: 'select' | 'razor';
  setTool: (t: 'select' | 'razor') => void;
  snapping: boolean;
  setSnapping: (v: boolean) => void;
  hasSelection: boolean;
  pps: number;
  setPps: (pps: number) => void;
  actions: ToolbarActions;
}) {
  const t = useT();
  const zoomValue = Math.log(pps);
  return (
    <div className="vd-tl-toolbar">
      <IconButton icon={MousePointer2} label={`${t('Selection tool')} (V)`} active={tool === 'select'} onClick={() => setTool('select')} />
      <IconButton icon={Scissors} label={`${t('Razor tool')} (C)`} active={tool === 'razor'} onClick={() => setTool('razor')} />
      <IconButton icon={Magnet} label={`${t('Snapping')} (N)`} active={snapping} onClick={() => setSnapping(!snapping)} />
      <span className="vsep" />
      <IconButton icon={SquareSplitHorizontal} label={`${t('Split at playhead')} (S)`} onClick={actions.split} />
      <IconButton icon={ArrowLeftToLine} label={`${t('Ripple delete')} (Shift+Delete)`} onClick={actions.rippleDelete} disabled={!hasSelection} />
      <IconButton icon={Trash2} label={`${t('Delete')} (Delete)`} onClick={actions.deleteSelection} disabled={!hasSelection} />
      <IconButton icon={Link2} label={t('Link clips')} onClick={actions.link} disabled={!hasSelection} />
      <IconButton icon={Unlink2} label={t('Unlink clips')} onClick={actions.unlink} disabled={!hasSelection} />
      <span className="vsep" />
      <IconButton icon={Flag} label={`${t('Add marker')} (M)`} onClick={actions.addMarker} />
      <IconButton icon={ArrowRightToLine} label={`${t('Set in point')} (I)`} onClick={actions.setIn} iconSize={15} />
      <IconButton icon={ArrowLeftToLine} label={`${t('Set out point')} (O)`} onClick={actions.setOut} iconSize={15} style={{ transform: 'scaleX(-1)' }} />
      <DropdownButton
        className="btn sm ghost"
        title={t('Add track')}
        entries={[
          { label: t('Video track'), icon: Film, onClick: () => actions.addTrack('video') },
          { label: t('Audio track'), icon: Music, onClick: () => actions.addTrack('audio') },
          { label: t('Caption track'), icon: Captions, onClick: () => actions.addTrack('caption') },
        ]}
      >
        <Plus size={13} /> {t('Track')}
      </DropdownButton>
      <span className="spacer" />
      <IconButton icon={ZoomOut} label={`${t('Zoom out')} (Ctrl+−)`} onClick={actions.zoomOut} />
      <input
        type="range"
        className="vd-zoom-range"
        aria-label={t('Timeline zoom')}
        min={Math.log(0.5)}
        max={Math.log(2400)}
        step={0.01}
        value={zoomValue}
        onChange={(e) => setPps(Math.exp(parseFloat(e.target.value)))}
      />
      <IconButton icon={ZoomIn} label={`${t('Zoom in')} (Ctrl+=)`} onClick={actions.zoomIn} />
      <IconButton icon={Maximize2} label={`${t('Fit timeline')} (Ctrl+0)`} onClick={actions.zoomFit} />
    </div>
  );
}
