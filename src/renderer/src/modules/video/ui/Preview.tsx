import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, ChevronFirst, ChevronLast, FolderOpen, Grid2x2, Pause, Play, Repeat, StepBack, StepForward } from 'lucide-react';
import type { Clip, Project } from '../types';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Select, promptDialog } from '../../../components/ui';
import type { PreviewEngine } from '../engine';
import { usePlayhead, type TimeStore } from '../timeStore';
import { clipEnd, getClip, getMedia, timelineDuration, updateClip } from '../model';
import { visualLayers } from '../compositor';
import { clipLayout, hitLayout, layoutCorners } from '../fx';
import { titleBox } from '../text';
import { formatTimecode, parseTimecode } from '../time';
import { DEFAULT_VISUAL } from '../presets';

export type PreviewZoom = 'fit' | 0.25 | 0.5 | 1;

interface PreviewProps {
  engine: PreviewEngine | null;
  project: Project;
  time: TimeStore;
  playing: boolean;
  rate: number;
  loop: boolean;
  setLoop: (v: boolean) => void;
  safe: boolean;
  setSafe: (v: boolean) => void;
  zoom: PreviewZoom;
  setZoom: (z: PreviewZoom) => void;
  selection: string[];
  setSelection: (ids: string[]) => void;
  change: (next: Project, opts?: { record?: boolean; label?: string }) => void;
  commit: (label: string) => void;
  onImport: () => void;
  onExportFrame: () => void;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onStep: (frames: number) => void;
}

/** Frame corners (project px) of a visual clip as currently drawn, or null. */
function clipCorners(p: Project, clip: Clip): { x: number; y: number }[] | null {
  const { width: W, height: H } = p.settings;
  const v = clip.visual ?? DEFAULT_VISUAL;
  if (clip.kind === 'title' && clip.title) {
    const b = titleBox(clip.title, W, H);
    const rad = (v.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x + b.w, b.y + b.h],
      [b.x, b.y + b.h],
    ].map(([x, y]) => {
      const lx = (x - W / 2) * v.scale;
      const ly = (y - H / 2) * v.scale;
      return { x: W / 2 + v.x + lx * cos - ly * sin, y: H / 2 + v.y + lx * sin + ly * cos };
    });
  }
  const media = getMedia(p, clip.mediaId);
  if (!media) return null;
  return layoutCorners(clipLayout(media.width || W, media.height || H, W, H, v));
}

function inside(pts: { x: number; y: number }[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function CurrentTime({ time, fps, onSeek }: { time: TimeStore; fps: number; onSeek: (t: number) => void }) {
  const t = useT();
  const now = usePlayhead(time);
  return (
    <span
      className="vd-timecode"
      title={t('Click to go to a time')}
      onClick={async () => {
        const v = await promptDialog({ title: t('Go to time'), message: t('Timecode (HH:MM:SS:FF) or seconds'), defaultValue: formatTimecode(now, fps) });
        const parsed = v === null ? null : parseTimecode(v, fps);
        if (parsed !== null) onSeek(parsed);
      }}
    >
      {formatTimecode(now, fps)}
    </span>
  );
}

function Overlay({ project, time, selection, safe, change, commit, setSelection, dispW }: Pick<PreviewProps, 'project' | 'time' | 'selection' | 'safe' | 'change' | 'commit' | 'setSelection'> & { dispW: number }) {
  const t = useT();
  const now = usePlayhead(time);
  const { width: W, height: H } = project.settings;
  const drag = useRef<{ x0: number; y0: number; base: Project; id: string; vx: number; vy: number; moved: boolean } | null>(null);
  const active = selection
    .map((id) => getClip(project, id))
    .filter((c): c is Clip => Boolean(c && (c.kind === 'video' || c.kind === 'image' || c.kind === 'title') && c.start <= now && now < clipEnd(c)));
  const sel = active[0];
  const corners = sel ? clipCorners(project, sel) : null;

  const toProject = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toProject(e);
    let target = sel && corners && inside(corners, p.x, p.y) ? sel : null;
    if (!target) {
      const layers = visualLayers(project, now).reverse();
      for (const l of layers) {
        const c = l.clip;
        const pts = clipCorners(project, c);
        if (pts && inside(pts, p.x, p.y)) {
          target = c;
          break;
        }
        if (!pts && c.visual && hitLayout(clipLayout(W, H, W, H, c.visual), p.x, p.y)) {
          target = c;
          break;
        }
      }
      setSelection(target ? [target.id] : []);
    }
    if (!target) return;
    const track = project.tracks.find((tr) => tr.id === target!.trackId);
    if (track?.locked) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const v = target.visual ?? DEFAULT_VISUAL;
    drag.current = { x0: e.clientX, y0: e.clientY, base: project, id: target.id, vx: v.x, vy: v.y, moved: false };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const k = W / Math.max(1, dispW);
    let x = d.vx + (e.clientX - d.x0) * k;
    let y = d.vy + (e.clientY - d.y0) * k;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
    d.moved = true;
    if (!e.shiftKey) {
      if (Math.abs(x) < W * 0.008) x = 0;
      if (Math.abs(y) < H * 0.008) y = 0;
    }
    change(updateClip(d.base, d.id, (c) => ({ ...c, visual: { ...(c.visual ?? DEFAULT_VISUAL), x: Math.round(x), y: Math.round(y) } })), { record: false });
  };
  const onUp = () => {
    if (drag.current?.moved) commit(t('Move in frame'));
    drag.current = null;
  };

  return (
    <svg className="vd-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {safe && (
        <>
          <rect className="vd-safe" x={W * 0.05} y={H * 0.05} width={W * 0.9} height={H * 0.9} />
          <rect className="vd-safe" x={W * 0.1} y={H * 0.1} width={W * 0.8} height={H * 0.8} />
          <line className="vd-safe" x1={W / 2 - W * 0.015} y1={H / 2} x2={W / 2 + W * 0.015} y2={H / 2} />
          <line className="vd-safe" x1={W / 2} y1={H / 2 - W * 0.015} x2={W / 2} y2={H / 2 + W * 0.015} />
        </>
      )}
      {corners && <polygon className="vd-sel" points={corners.map((c) => `${c.x},${c.y}`).join(' ')} />}
    </svg>
  );
}

export function Preview(props: PreviewProps) {
  const t = useT();
  const { engine, project } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState({ w: 640, h: 360 });
  const { width: W, height: H, fps } = project.settings;
  const duration = timelineDuration(project);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const s = props.zoom === 'fit' ? Math.max(0.02, Math.min((stage.w - 24) / W, (stage.h - 24) / H)) : props.zoom;
  const dispW = Math.max(16, Math.round(W * s));
  const dispH = Math.max(9, Math.round(H * s));

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(16, Math.min(W, Math.round(dispW * dpr)));
    const ch = Math.max(9, Math.round((cw * H) / W));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    engine?.setScale(cw / W);
    engine?.invalidate();
  }, [engine, dispW, W, H]);

  useEffect(() => {
    if (engine && canvasRef.current) engine.attach(canvasRef.current);
  }, [engine]);

  const empty = project.clips.length === 0;

  return (
    <div className="vd-preview">
      <div ref={stageRef} className={`vd-stage ${props.zoom !== 'fit' ? 'zoomed' : ''}`}>
        <div className="vd-frame checker" style={{ width: dispW, height: dispH }}>
          <canvas ref={canvasRef} aria-label={t('Program monitor')} />
          <Overlay
            project={project}
            time={props.time}
            selection={props.selection}
            safe={props.safe}
            change={props.change}
            commit={props.commit}
            setSelection={props.setSelection}
            dispW={dispW}
          />
        </div>
        {empty && (
          <div className="vd-empty-hint">
            <h2>{t('Start your edit')}</h2>
            <span>{t('Import videos, music and pictures, then drag them onto the timeline. You can also drop files anywhere here.')}</span>
            <Button variant="primary" icon={FolderOpen} onClick={props.onImport}>
              {t('Import media…')}
            </Button>
          </div>
        )}
      </div>
      <div className="vd-transport">
        <IconButton icon={ChevronFirst} label={`${t('Go to start')} (Home)`} onClick={() => props.onSeek(0)} />
        <IconButton icon={StepBack} label={`${t('Previous frame')} (←)`} onClick={() => props.onStep(-1)} />
        <IconButton icon={props.playing ? Pause : Play} label={`${props.playing ? t('Pause') : t('Play')} (Space)`} active={props.playing} onClick={props.onTogglePlay} />
        <IconButton icon={StepForward} label={`${t('Next frame')} (→)`} onClick={() => props.onStep(1)} />
        <IconButton icon={ChevronLast} label={`${t('Go to end')} (End)`} onClick={() => props.onSeek(duration)} />
        <IconButton icon={Repeat} label={t('Loop playback (work area when set)')} active={props.loop} onClick={() => props.setLoop(!props.loop)} />
        <span className="vsep" />
        <CurrentTime time={props.time} fps={fps} onSeek={props.onSeek} />
        <span className="faint">/</span>
        <span className="vd-timecode dim">{formatTimecode(duration, fps)}</span>
        <span className="vd-rate">{props.playing && props.rate !== 1 ? `${props.rate > 0 ? '' : '◀ '}${Math.abs(props.rate)}×` : ''}</span>
        <span className="spacer" />
        <IconButton icon={Grid2x2} label={t('Safe area guides')} active={props.safe} onClick={() => props.setSafe(!props.safe)} />
        <Select<string>
          small
          value={String(props.zoom)}
          onChange={(v) => props.setZoom(v === 'fit' ? 'fit' : (parseFloat(v) as PreviewZoom))}
          options={[
            { value: 'fit', label: t('Fit') },
            { value: '0.25', label: '25%' },
            { value: '0.5', label: '50%' },
            { value: '1', label: '100%' },
          ]}
          style={{ width: 76 }}
          aria-label={t('Preview zoom')}
        />
        <IconButton icon={Camera} label={t('Export frame as PNG')} onClick={props.onExportFrame} />
      </div>
    </div>
  );
}
