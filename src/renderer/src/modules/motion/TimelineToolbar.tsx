import { useState } from 'react';
import {
  ChartSpline,
  ChevronFirst,
  ChevronLast,
  Magnet,
  Maximize,
  Pause,
  Play,
  Plus,
  Repeat,
  StepBack,
  StepForward,
  Trash2,
  ListFilter,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useT } from '../../core/i18n';
import { DropdownButton, IconButton, type MenuEntry } from '../../components/ui';
import { EASING_TYPES } from './easing';
import { deleteKeys, findKey, setKeysEasing } from './ops';
import { buildKeyIndex, useEditor, useTime } from './state';
import { formatTimecode, frameOf, lastFrameTime, parseTimeInput } from './timeline-math';
import type { EasingType } from './types';

function TimeDisplay() {
  const t = useT();
  const ed = useEditor();
  const time = useTime(ed.time);
  const { fps } = ed.doc.comp;
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null) {
    return (
      <input
        className="input sm mono mo-timecode-input"
        autoFocus
        value={editing}
        aria-label={t('Go to time')}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={() => setEditing(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            const v = parseTimeInput(editing, fps);
            if (v !== null) ed.seek(v);
            setEditing(null);
          }
          if (e.key === 'Escape') setEditing(null);
        }}
      />
    );
  }
  return (
    <button type="button" className="mo-timecode" title={t('Click to type a time (seconds, frames like 45f, or mm:ss:ff)')} onClick={() => setEditing(formatTimecode(time, fps))}>
      <span className="mono">{formatTimecode(time, fps)}</span>
      <span className="faint mono">{t('frame {n}', { n: frameOf(time, fps) })}</span>
    </button>
  );
}

function EasingControls({ onEditCurve }: { onEditCurve: (x: number, y: number) => void }) {
  const t = useT();
  const ed = useEditor();
  const keys = [...ed.selectedKeys].map((id) => findKey(ed.doc, ed.keyIndex.get(id))).filter(Boolean);
  if (!keys.length) return null;
  const types = new Set(keys.map((k) => k!.easing));
  const common = types.size === 1 ? keys[0]!.easing : '';
  return (
    <div className="row mo-easing-controls" style={{ gap: 4 }}>
      <span className="faint" style={{ fontSize: 11 }}>
        {t('{n} key(s)', { n: keys.length })}
      </span>
      <select
        className="select sm"
        style={{ width: 136 }}
        aria-label={t('Easing')}
        value={common}
        onChange={(e) => {
          const easing = e.target.value as EasingType;
          if (!easing) return;
          ed.setDoc((d) => setKeysEasing(d, [...ed.selectedKeys], buildKeyIndex(d), easing, easing === 'bezier' ? keys[0]!.bezier ?? [0.42, 0, 0.58, 1] : undefined), {
            label: 'Easing',
          });
        }}
      >
        {!common && <option value="">{t('Mixed easing')}</option>}
        {EASING_TYPES.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
      <IconButton
        icon={ChartSpline}
        size="sm"
        label={t('Edit curve…')}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onEditCurve(r.left, r.bottom);
        }}
      />
      <IconButton
        icon={Trash2}
        size="sm"
        label={t('Delete keyframes')}
        onClick={() => {
          ed.setDoc((d) => deleteKeys(d, [...ed.selectedKeys], buildKeyIndex(d), ed.time.get()), { label: 'Delete keyframes' });
          ed.setSelectedKeys(new Set());
        }}
      />
    </div>
  );
}

export function TimelineToolbar({
  loop,
  setLoop,
  onZoom,
  onFit,
  pxPerSec,
  addLayerEntries,
  onEditCurve,
}: {
  loop: boolean;
  setLoop: (v: boolean) => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
  pxPerSec: number;
  addLayerEntries: () => MenuEntry[];
  onEditCurve: (x: number, y: number) => void;
}) {
  const t = useT();
  const ed = useEditor();
  const comp = ed.doc.comp;
  const step = (frames: number) => ed.seek(ed.time.get() + frames / comp.fps);
  return (
    <div className="mo-tl-toolbar">
      <TimeDisplay />
      <span className="vsep" />
      <IconButton icon={ChevronFirst} size="sm" label={`${t('Go to start')} (Home)`} onClick={() => ed.seek(ed.time.get() > comp.workStart + 1e-6 ? comp.workStart : 0)} />
      <IconButton icon={StepBack} size="sm" label={`${t('Previous frame')} (←)`} onClick={() => step(-1)} />
      <IconButton icon={ed.playing ? Pause : Play} label={`${ed.playing ? t('Pause') : t('Play')} (Space)`} active={ed.playing} onClick={ed.togglePlay} />
      <IconButton icon={StepForward} size="sm" label={`${t('Next frame')} (→)`} onClick={() => step(1)} />
      <IconButton icon={ChevronLast} size="sm" label={`${t('Go to end')} (End)`} onClick={() => ed.seek(lastFrameTime(comp.duration, comp.fps))} />
      <IconButton icon={Repeat} size="sm" label={t('Loop playback')} active={loop} onClick={() => setLoop(!loop)} />
      <span className="vsep" />
      <IconButton icon={ZoomOut} size="sm" label={t('Zoom out timeline')} onClick={() => onZoom(1 / 1.5)} />
      <input
        type="range"
        className="mo-zoom-range"
        min={0}
        max={100}
        aria-label={t('Timeline zoom')}
        value={Math.round(((Math.log(pxPerSec) - Math.log(4)) / (Math.log(4000) - Math.log(4))) * 100)}
        onChange={(e) => {
          const target = Math.exp(Math.log(4) + (parseFloat(e.target.value) / 100) * (Math.log(4000) - Math.log(4)));
          onZoom(target / pxPerSec);
        }}
      />
      <IconButton icon={ZoomIn} size="sm" label={t('Zoom in timeline')} onClick={() => onZoom(1.5)} />
      <IconButton icon={Maximize} size="sm" label={t('Fit composition')} onClick={onFit} />
      <span className="vsep" />
      <IconButton icon={Magnet} size="sm" label={t('Snapping (hold Shift to invert)')} active={ed.snapping} onClick={() => ed.setSnapping(!ed.snapping)} />
      <IconButton icon={ListFilter} size="sm" label={`${t('Show animated properties')} (U)`} onClick={ed.revealAnimated} />
      <span className="vsep" />
      <EasingControls onEditCurve={onEditCurve} />
      <span className="spacer" />
      <DropdownButton entries={addLayerEntries} className="btn sm" title={t('Add layer')}>
        <Plus size={13} /> {t('Layer')}
      </DropdownButton>
    </div>
  );
}
