import { useEffect, useRef, useState } from 'react';
import { Circle, Pause, Play, Repeat, SkipBack, SkipForward, Square, StepBack, StepForward } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { IconButton } from '../../../components/ui';
import { audio } from '../controller';
import { mt } from '../mt';
import { setUI, ui, useAudioUI } from '../state';
import { formatClock } from './draw';

/** Parses "h:mm:ss.mmm", "mm:ss.mmm" or plain seconds. */
export function parseClock(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (!parts.length || parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    const v = parseFloat(p);
    if (!Number.isFinite(v) || v < 0) return null;
    total = total * 60 + v;
  }
  return total;
}

export function TimeField({ value, onCommit, disabled, title }: { value: number; onCommit: (seconds: number) => void; disabled?: boolean; title?: string }) {
  const [text, setText] = useState(formatClock(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatClock(value));
  }, [value]);
  const commit = () => {
    const v = parseClock(text);
    if (v === null) setText(formatClock(value));
    else onCommit(v);
  };
  return (
    <input
      className="input sm au-timefield mono"
      value={text}
      disabled={disabled}
      title={title}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(formatClock(value));
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

const METER_MIN_DB = -60;

/** Horizontal peak + RMS meters with peak hold and clip indicators. */
export function LevelMeters({ active, running, getLevels, channels }: { active: boolean; running: boolean; getLevels: () => { peak: number[]; rms: number[] } | null; channels: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hold = useRef<{ value: number; time: number }[]>([]);
  const clip = useRef<number[]>([]);
  const smooth = useRef<{ peak: number[]; rms: number[] }>({ peak: [], rms: [] });
  const labelsRef = useRef<HTMLSpanElement>(null);
  const t = useT();
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let idleFrames = 0;
    const draw = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cs = getComputedStyle(canvas);
      const bg = cs.getPropertyValue('--bg-0').trim() || '#111';
      const dim = cs.getPropertyValue('--text-3').trim() || '#666';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const lv = getLevels();
      const count = Math.max(1, Math.min(2, lv ? lv.peak.length : channels));
      const now = performance.now();
      const barH = Math.max(4, (h - 12 - (count - 1) * 3) / count);
      const xOf = (db: number) => Math.max(0, Math.min(1, (db - METER_MIN_DB) / -METER_MIN_DB)) * w;
      const toDb = (v: number) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
      const texts: string[] = [];
      for (let c = 0; c < count; c++) {
        const peakIn = lv?.peak[c] ?? 0;
        const rmsIn = lv?.rms[c] ?? 0;
        // ballistics: instant attack, ~20 dB/s fall
        const prevP = smooth.current.peak[c] ?? 0;
        const prevR = smooth.current.rms[c] ?? 0;
        const p = Math.max(peakIn, prevP * 0.9);
        const r = Math.max(rmsIn, prevR * 0.92);
        smooth.current.peak[c] = p;
        smooth.current.rms[c] = r;
        const pdb = toDb(p);
        const rdb = toDb(r);
        const hd = hold.current[c] ?? { value: -120, time: 0 };
        if (pdb >= hd.value || now - hd.time > 1500) hold.current[c] = { value: pdb, time: now };
        if (peakIn >= 0.99997) clip.current[c] = now;
        const y = c * (barH + 3);
        ctx.fillStyle = bg;
        ctx.fillRect(0, y, w, barH);
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#16c79a');
        grad.addColorStop(xOf(-18) / w, '#3ddc84');
        grad.addColorStop(xOf(-9) / w, '#f5d742');
        grad.addColorStop(xOf(-3) / w, '#f59e0b');
        grad.addColorStop(1, '#f05252');
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(0, y, xOf(pdb), barH);
        ctx.globalAlpha = 1;
        ctx.fillRect(0, y + barH * 0.25, xOf(rdb), barH * 0.5);
        const hx = xOf(hold.current[c].value);
        if (hold.current[c].value > METER_MIN_DB) {
          ctx.fillStyle = hold.current[c].value > -0.1 ? '#f05252' : '#e5e7eb';
          ctx.fillRect(Math.min(w - 2, hx), y, 2, barH);
        }
        if (now - (clip.current[c] ?? -1e9) < 2000) {
          ctx.fillStyle = '#f05252';
          ctx.fillRect(w - 5, y, 5, barH);
        }
        texts.push(hold.current[c].value > -100 ? hold.current[c].value.toFixed(1) : '-∞');
      }
      // scale
      ctx.fillStyle = dim;
      ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'bottom';
      for (const db of [-60, -48, -36, -24, -18, -12, -6, 0]) {
        const x = xOf(db);
        ctx.fillRect(Math.round(x) - (db === 0 ? 1 : 0), h - 11, 1, 3);
        const label = String(db);
        const tw = ctx.measureText(label).width;
        if (db === 0) ctx.fillText(label, w - tw, h);
        else if (x + tw / 2 < w - 14) ctx.fillText(label, Math.max(0, x - tw / 2), h);
      }
      if (labelsRef.current) labelsRef.current.textContent = texts.join(' / ');
      // keep animating while audio runs or the bars are still falling
      const quiet = smooth.current.peak.every((v) => v < 1e-4) && hold.current.every((hd) => now - hd.time > 1600);
      idleFrames = quiet ? idleFrames + 1 : 0;
      if (running || idleFrames < 3) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, running, getLevels, channels]);
  return (
    <div className="au-meters" title={t('Level meters: peak (bar), RMS (inner bar) in dBFS')}>
      <canvas ref={ref} />
      <span ref={labelsRef} className="au-meter-readout mono" />
    </div>
  );
}

const playerLevels = () => (audio.player.playing ? audio.player.levels() : null);

export function Transport({ active }: { active: boolean }) {
  const t = useT();
  const playing = useAudioUI((s) => s.playing);
  const loop = useAudioUI((s) => s.loop);
  const tab = useAudioUI((s) => s.tab);
  const cursor = useAudioUI((s) => s.cursor);
  const selection = useAudioUI((s) => s.selection);
  const revision = useAudioUI((s) => s.revision);
  const mtRevision = useAudioUI((s) => s.mtRevision);
  const clockRef = useRef<HTMLDivElement>(null);
  const sr = audio.sampleRate;
  const multitrack = tab === 'multitrack';
  void revision;
  void mtRevision;

  // live clock while playing
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      if (ui().playing) raf = requestAnimationFrame(tick);
      const s = ui();
      let pos: number;
      let rate: number;
      if (s.playing) {
        pos = audio.player.position() ?? 0;
        rate = s.playingMix ? mt.sampleRate : audio.sampleRate;
      } else if (s.tab === 'multitrack') {
        pos = mt.playhead;
        rate = mt.sampleRate;
      } else {
        pos = s.cursor;
        rate = audio.sampleRate;
      }
      if (clockRef.current) clockRef.current.textContent = formatClock(pos / rate);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, playing, cursor, mtRevision, tab]);

  const togglePlay = () => (multitrack ? mt.togglePlay() : audio.togglePlay());
  const stop = () => {
    if (multitrack) {
      if (ui().playingMix) mt.pause();
      mt.playhead = 0;
      mt.bump();
    } else audio.stop();
  };
  const toStart = () => {
    if (multitrack) {
      mt.playhead = 0;
      mt.bump();
      if (ui().playingMix) void mt.play();
    } else audio.seek(0);
  };
  const toEnd = () => {
    if (multitrack) {
      mt.playhead = mt.length;
      mt.bump();
    } else audio.seek(audio.length);
  };
  const selLen = selection ? selection.end - selection.start : 0;

  return (
    <div className="au-transport">
      <div className="au-transport-buttons">
        <IconButton icon={SkipBack} label={t('Go to start (Home)')} onClick={toStart} />
        {!multitrack && <IconButton icon={StepBack} label={t('Previous marker ([)')} onClick={() => audio.jumpToMarker(-1)} />}
        <button type="button" className={`au-play ${playing ? 'playing' : ''}`} title={`${playing ? t('Pause') : t('Play')} (Space)`} aria-label={playing ? t('Pause') : t('Play')} onClick={togglePlay}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <IconButton icon={Square} label={t('Stop (return to start position)')} onClick={stop} />
        {!multitrack && <IconButton icon={StepForward} label={t('Next marker (])')} onClick={() => audio.jumpToMarker(1)} />}
        <IconButton icon={SkipForward} label={t('Go to end (End)')} onClick={toEnd} />
        <IconButton icon={Repeat} label={t('Loop playback (L)')} active={loop} onClick={() => audio.toggleLoop()} />
        {!multitrack && <IconButton icon={Circle} label={t('Record…')} className="au-rec-btn" onClick={() => setUI({ dialog: { kind: 'record' } })} />}
      </div>
      <div className="au-clock mono" ref={clockRef} title={t('Playhead / cursor position')}>
        {formatClock(cursor / sr)}
      </div>
      {!multitrack && (
        <div className="au-selfields">
          <label>
            <span>{t('Start')}</span>
            <TimeField
              value={selection ? selection.start / sr : cursor / sr}
              disabled={!audio.length}
              onCommit={(v) => {
                const s = Math.round(v * sr);
                if (selection) audio.setSelection({ start: Math.min(s, selection.end - 1), end: selection.end });
                else audio.seek(s);
              }}
            />
          </label>
          <label>
            <span>{t('End')}</span>
            <TimeField
              value={selection ? selection.end / sr : cursor / sr}
              disabled={!audio.length}
              onCommit={(v) => {
                const e = Math.round(v * sr);
                const s = selection ? selection.start : cursor;
                if (e > s) audio.setSelection({ start: s, end: e });
              }}
            />
          </label>
          <label>
            <span>{t('Duration')}</span>
            <TimeField
              value={selLen / sr}
              disabled={!audio.length}
              onCommit={(v) => {
                const s = selection ? selection.start : cursor;
                const len = Math.round(v * sr);
                if (len > 0) audio.setSelection({ start: s, end: s + len });
                else audio.setSelection(null);
              }}
            />
          </label>
        </div>
      )}
      <span className="spacer" />
      <LevelMeters active={active} running={playing} getLevels={playerLevels} channels={multitrack ? 2 : Math.max(1, Math.min(2, audio.doc.channels.length))} />
    </div>
  );
}
