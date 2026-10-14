import { memo, useState, type ReactNode } from 'react';
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Diamond,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Spline,
  Square,
  Star,
  Timer,
  Trash2,
  Type,
  Activity,
  Minus,
  Hexagon,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '../../core/i18n';
import { ColorPicker } from '../../components/ui';
import { adjacentTime, evaluateProp, findKeyAt, isAnimated } from './keyframes';
import { getProp, isAncestor, PROP_DEFS, setParent as setParentKeepingPlace, updateLayer } from './model';
import { setPropAt, toggleKeyAt, toggleStopwatchOp } from './ops';
import { useEditor, useTime } from './state';
import { timeToX, type TimelineScale } from './timeline-math';
import type { Keyframe, Layer, PropKey, PropValue, Vec2, Wiggle } from './types';
import { ScrubNumber } from './widgets';

export const LEFT_W = 340;
export const ROW_H = 24;
export const HEADER_H = 32;
export const TRACK_PAD = 14;

export function layerIcon(layer: Layer): LucideIcon {
  switch (layer.type) {
    case 'text':
      return Type;
    case 'image':
      return ImageIcon;
    case 'video':
      return Film;
    case 'null':
      return Box;
    case 'solid':
      return Square;
    case 'shape':
      switch (layer.shape?.kind) {
        case 'ellipse':
          return Circle;
        case 'star':
          return Star;
        case 'polygon':
          return Hexagon;
        case 'line':
          return Minus;
        case 'path':
          return Spline;
        default:
          return Square;
      }
  }
}

function keyClass(k: Keyframe): string {
  if (k.easing === 'hold') return 'hold';
  if (k.easing === 'linear') return 'linear';
  return 'eased';
}

/* -------------------------------- Layer row ------------------------------- */

export const LayerRow = memo(function LayerRow({
  layer,
  index,
  selected,
  expanded,
  scale,
  trackWidth,
  parentOptions,
  onSelect,
  onToggleExpand,
}: {
  layer: Layer;
  index: number;
  selected: boolean;
  expanded: boolean;
  scale: TimelineScale;
  trackWidth: number;
  parentOptions: { id: string; name: string }[];
  onSelect: (id: string, e: React.MouseEvent) => void;
  onToggleExpand: (id: string) => void;
}) {
  const t = useT();
  const ed = useEditor();
  const [renaming, setRenaming] = useState(false);
  const Icon = layerIcon(layer);
  const update = (fn: (l: Layer) => Layer, label: string) => ed.setDoc((d) => updateLayer(d, layer.id, fn), { label });
  const keyTimes = new Set<number>();
  for (const prop of Object.values(layer.props)) for (const k of prop.keyframes) keyTimes.add(k.time);
  const x0 = timeToX(layer.inPoint, scale);
  const x1 = timeToX(layer.outPoint, scale);

  return (
    <div className={`mo-row mo-layer-row ${selected ? 'selected' : ''}`} style={{ height: ROW_H }}>
      <div className="mo-row-left" onMouseDown={(e) => onSelect(layer.id, e)}>
        <span className="mo-label-dot" style={{ background: layer.label }} />
        <button
          type="button"
          className={`mo-sw ${layer.visible ? 'on' : ''}`}
          title={t('Show / hide')}
          aria-label={t('Show / hide')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => update((l) => ({ ...l, visible: !l.visible }), 'Visibility')}
        >
          {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button
          type="button"
          className={`mo-sw ${layer.solo ? 'on accent' : ''}`}
          title={t('Solo')}
          aria-label={t('Solo')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => update((l) => ({ ...l, solo: !l.solo }), 'Solo')}
        >
          <CircleDot size={13} />
        </button>
        <button
          type="button"
          className={`mo-sw ${layer.locked ? 'on' : ''}`}
          title={t('Lock')}
          aria-label={t('Lock')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => update((l) => ({ ...l, locked: !l.locked }), 'Lock')}
        >
          {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
        <button
          type="button"
          className="mo-twirl"
          aria-label={expanded ? t('Collapse') : t('Expand')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onToggleExpand(layer.id)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="mo-row-index faint">{index + 1}</span>
        <Icon size={13} className="mo-row-icon" />
        {renaming ? (
          <input
            className="mo-rename"
            autoFocus
            defaultValue={layer.name}
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setRenaming(false);
              const name = e.target.value.trim();
              if (name && name !== layer.name) update((l) => ({ ...l, name: name.slice(0, 120) }), 'Rename layer');
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="mo-row-name" title={layer.name} onDoubleClick={() => setRenaming(true)}>
            {layer.name || t('Untitled')}
          </span>
        )}
        <select
          className="mo-parent-select"
          title={t('Parent')}
          aria-label={t('Parent')}
          value={layer.parentId ?? ''}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const parentId = e.target.value || null;
            ed.setDoc((d) => {
              if (parentId && isAncestor(d, parentId, layer.id)) return d;
              return setParentKeepingPlace(d, layer.id, parentId, ed.time.get());
            }, { label: 'Parent' });
          }}
        >
          <option value="">{t('No parent')}</option>
          {parentOptions
            .filter((o) => o.id !== layer.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </div>
      <div className="mo-row-track" data-track="1" data-layer={layer.id} style={{ width: trackWidth }}>
        <div
          className={`mo-bar ${selected ? 'selected' : ''} ${layer.visible ? '' : 'hidden'}`}
          data-bar={layer.id}
          data-edge="body"
          style={{ left: x0, width: Math.max(2, x1 - x0), ['--bar' as string]: layer.label }}
        >
          <span className="mo-bar-edge in" data-bar={layer.id} data-edge="in" />
          <span className="mo-bar-label">{layer.name}</span>
          <span className="mo-bar-edge out" data-bar={layer.id} data-edge="out" />
        </div>
        {[...keyTimes].map((time) => (
          <span key={time} className="mo-key-dot" style={{ left: timeToX(time, scale) }} />
        ))}
      </div>
    </div>
  );
});

/* --------------------------------- Prop row -------------------------------- */

export function usePropEditing(layerId: string, key: PropKey) {
  const ed = useEditor();
  const label = `Change ${PROP_DEFS[key].label}`;
  return {
    live: (v: PropValue) => ed.setDoc((d) => setPropAt(d, layerId, key, v, ed.time.get()), { record: false }),
    commit: (v: PropValue) => {
      ed.setDoc((d) => setPropAt(d, layerId, key, v, ed.time.get()), { record: false });
      ed.commit(label);
    },
  };
}

/** Editor for a property value (numbers, vectors, colors). */
export function PropValueEditor({ layer, propKey, value, compact }: { layer: Layer; propKey: PropKey; value: PropValue; compact?: boolean }) {
  const t = useT();
  const ed = useEditor();
  const def = PROP_DEFS[propKey];
  const edit = usePropEditing(layer.id, propKey);
  const disabled = layer.locked;
  if (def.kind === 'color') {
    return (
      <ColorPicker
        value={value as string}
        size={compact ? 16 : 22}
        label={t(def.label)}
        onChange={(c) => edit.live(c)}
        onCommit={(c) => edit.commit(c)}
      />
    );
  }
  if (def.kind === 'vec2') {
    const v = value as Vec2;
    const linked = propKey === 'scale' && ed.scaleLinked;
    const setAxis = (axis: 0 | 1, n: number): Vec2 => {
      if (!linked) return axis === 0 ? [n, v[1]] : [v[0], n];
      const other = axis === 0 ? v[1] : v[0];
      const base = axis === 0 ? v[0] : v[1];
      const ratio = base ? other / base : 1;
      return axis === 0 ? [n, n * ratio] : [n * ratio, n];
    };
    return (
      <span className="mo-vec">
        <ScrubNumber value={v[0]} step={def.step} min={def.min} max={def.max} disabled={disabled} width={compact ? 44 : 56} onChange={(n) => edit.live(setAxis(0, n))} onCommit={(n) => edit.commit(setAxis(0, n))} />
        <ScrubNumber value={v[1]} step={def.step} min={def.min} max={def.max} disabled={disabled} width={compact ? 44 : 56} onChange={(n) => edit.live(setAxis(1, n))} onCommit={(n) => edit.commit(setAxis(1, n))} suffix={def.unit} />
      </span>
    );
  }
  return (
    <ScrubNumber
      value={value as number}
      step={def.step}
      min={def.min}
      max={def.max}
      suffix={def.unit}
      disabled={disabled}
      width={compact ? 44 : 56}
      onChange={(n) => edit.live(n)}
      onCommit={(n) => edit.commit(n)}
    />
  );
}

/** Value + keyframe navigator for an animated property (re-renders with the playhead). */
export function AnimatedPropControls({ layer, propKey, compact = true }: { layer: Layer; propKey: PropKey; compact?: boolean }) {
  const t = useT();
  const ed = useEditor();
  const time = useTime(ed.time);
  const prop = getProp(layer, propKey);
  const value = evaluateProp(prop, time);
  const times = prop.keyframes.map((k) => k.time);
  const prev = adjacentTime(times, time, -1);
  const next = adjacentTime(times, time, 1);
  const onKey = Boolean(findKeyAt(prop, time));
  return (
    <>
      <PropValueEditor layer={layer} propKey={propKey} value={value} compact={compact} />
      <span className="mo-keynav">
        <button type="button" className="mo-sw" disabled={prev === null} title={t('Previous keyframe')} aria-label={t('Previous keyframe')} onClick={() => prev !== null && ed.seek(prev)}>
          <ChevronLeft size={12} />
        </button>
        <button
          type="button"
          className={`mo-sw ${onKey ? 'on accent' : ''}`}
          title={onKey ? t('Remove keyframe') : t('Add keyframe')}
          aria-label={onKey ? t('Remove keyframe') : t('Add keyframe')}
          disabled={layer.locked}
          onClick={() => ed.setDoc((d) => toggleKeyAt(d, layer.id, propKey, ed.time.get()), { label: onKey ? 'Remove keyframe' : 'Add keyframe' })}
        >
          <Diamond size={11} fill={onKey ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="mo-sw" disabled={next === null} title={t('Next keyframe')} aria-label={t('Next keyframe')} onClick={() => next !== null && ed.seek(next)}>
          <ChevronRight size={12} />
        </button>
      </span>
    </>
  );
}

export const PropRow = memo(function PropRow({
  layer,
  propKey,
  scale,
  trackWidth,
  selectedKeys,
}: {
  layer: Layer;
  propKey: PropKey;
  scale: TimelineScale;
  trackWidth: number;
  selectedKeys: ReadonlySet<string>;
}) {
  const t = useT();
  const ed = useEditor();
  const prop = getProp(layer, propKey);
  const animated = isAnimated(prop);
  const def = PROP_DEFS[propKey];
  return (
    <div className="mo-row mo-prop-row" style={{ height: ROW_H }}>
      <div className="mo-row-left mo-prop-left">
        <button
          type="button"
          className={`mo-stopwatch ${animated ? 'on' : ''}`}
          title={animated ? t('Stop animating (keeps the current value)') : t('Animate this property')}
          aria-label={t('Stopwatch')}
          aria-pressed={animated}
          disabled={layer.locked}
          onClick={() => ed.setDoc((d) => toggleStopwatchOp(d, layer.id, propKey, ed.time.get()), { label: animated ? 'Stopwatch off' : 'Stopwatch on' })}
        >
          <Timer size={13} />
        </button>
        <span className="mo-prop-label" title={t(def.label)}>
          {t(def.label)}
        </span>
        {animated ? <AnimatedPropControls layer={layer} propKey={propKey} /> : <PropValueEditor layer={layer} propKey={propKey} value={prop.value} compact />}
      </div>
      <div className="mo-row-track" data-track="1" data-layer={layer.id} data-prop={propKey} style={{ width: trackWidth }}>
        {prop.keyframes.map((k: Keyframe) => (
          <span
            key={k.id}
            className={`mo-kf ${keyClass(k)} ${selectedKeys.has(k.id) ? 'selected' : ''}`}
            data-kf={k.id}
            style={{ left: timeToX(k.time, scale) }}
            title={`${Math.round(k.time * 1000) / 1000}s · ${t(easingLabel(k))}`}
          />
        ))}
      </div>
    </div>
  );
});

function easingLabel(k: Keyframe): string {
  const map: Record<string, string> = {
    linear: 'Linear',
    easeIn: 'Ease In',
    easeOut: 'Ease Out',
    easeInOut: 'Ease In-Out',
    hold: 'Hold',
    back: 'Back (overshoot)',
    elastic: 'Elastic',
    bounce: 'Bounce',
    bezier: 'Custom curve',
  };
  return map[k.easing] ?? k.easing;
}

/* -------------------------------- Wiggle row -------------------------------- */

export const WiggleRow = memo(function WiggleRow({ layer, wiggle, scale, trackWidth }: { layer: Layer; wiggle: Wiggle; scale: TimelineScale; trackWidth: number }) {
  const t = useT();
  const ed = useEditor();
  const patch = (p: Partial<Wiggle>, record: boolean) =>
    ed.setDoc((d) => updateLayer(d, layer.id, (l) => ({ ...l, wiggles: l.wiggles.map((w) => (w.id === wiggle.id ? { ...w, ...p } : w)) })), {
      record,
      label: 'Edit wiggle',
    });
  const x0 = timeToX(wiggle.start, scale);
  const x1 = timeToX(wiggle.end, scale);
  return (
    <div className="mo-row mo-prop-row" style={{ height: ROW_H }}>
      <div className="mo-row-left mo-prop-left">
        <Activity size={13} className="mo-wiggle-icon" />
        <span className="mo-prop-label" title={t('Wiggle')}>
          {t('Wiggle')} · {t(wiggle.property === 'position' ? 'Position' : wiggle.property === 'rotation' ? 'Rotation' : wiggle.property === 'scale' ? 'Scale' : 'Opacity')}
        </span>
        <ScrubNumber value={wiggle.frequency} step={0.1} min={0.1} max={30} suffix="Hz" title={t('Frequency')} width={44} onChange={(v) => patch({ frequency: v }, false)} onCommit={(v) => { patch({ frequency: v }, false); ed.commit('Edit wiggle'); }} />
        <ScrubNumber value={wiggle.amplitude} step={1} min={0} max={5000} title={t('Amplitude')} width={40} onChange={(v) => patch({ amplitude: v }, false)} onCommit={(v) => { patch({ amplitude: v }, false); ed.commit('Edit wiggle'); }} />
        <button
          type="button"
          className="mo-sw"
          title={t('Remove wiggle')}
          aria-label={t('Remove wiggle')}
          onClick={() => ed.setDoc((d) => updateLayer(d, layer.id, (l) => ({ ...l, wiggles: l.wiggles.filter((w) => w.id !== wiggle.id) })), { label: 'Remove wiggle' })}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="mo-row-track" data-track="1" style={{ width: trackWidth }}>
        <div className="mo-wiggle-bar" style={{ left: x0, width: Math.max(2, x1 - x0) }} />
      </div>
    </div>
  );
});

/** Wrapper used for group headings inside an expanded layer. */
export function GroupRow({ children, trackWidth }: { children: ReactNode; trackWidth: number }) {
  return (
    <div className="mo-row mo-group-row" style={{ height: ROW_H }}>
      <div className="mo-row-left mo-group-left">{children}</div>
      <div className="mo-row-track" data-track="1" style={{ width: trackWidth }} />
    </div>
  );
}
