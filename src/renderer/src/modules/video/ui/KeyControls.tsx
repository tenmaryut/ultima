import { ChevronLeft, ChevronRight, Diamond, X } from 'lucide-react';
import type { Clip, Easing, KeyProp } from '../types';
import { useT } from '../../../core/i18n';
import { Field, IconButton, NumberField, Select, Slider } from '../../../components/ui';
import { EASINGS, KEY_TOLERANCE, keyTimes, setEaseAt, setValueAt, toggleKeyAt, valueAt, withoutKeys } from '../keyframes';
import { usePlayhead, type TimeStore } from '../timeStore';

/* Keyframe controls of the inspector: sliders that animate, the keyframe button and the keyframe bar. */

/** Applies `fn(clip, playhead)` to the edited clip(s). */
export type KeyEdit = (fn: (c: Clip, playhead: number) => Clip, label?: string) => void;

/** Seconds into a clip at timeline time `t`. */
export const localOf = (c: Clip, t: number) => Math.min(Math.max(0, t - c.start), c.duration);

const EASE_LABELS: Record<Easing, string> = { linear: 'Linear', easeIn: 'Ease in', easeOut: 'Ease out', easeInOut: 'Ease in and out', hold: 'Hold' };

interface KeySliderProps {
  time: TimeStore;
  /** The clip whose keyframes are shown (for volume: the audio clip). */
  clip: Clip;
  prop: KeyProp;
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Slider units per value unit (100 shows 0–1 as 0–100). */
  unit?: number;
  format?: (x: number) => string;
  defaultValue?: number;
  /** Live change while dragging (one undo step on `done`). */
  live: KeyEdit;
  /** One undo step. */
  apply: KeyEdit;
  done: (label: string) => void;
  commitLabel: string;
}

/** A slider whose property can be animated: with keyframes it shows and keys the value at the playhead. */
export function KeySlider(props: KeySliderProps) {
  return props.clip.keys?.[props.prop]?.length ? <AnimatedSlider {...props} /> : <PlainSlider {...props} />;
}

function KeyButton({ state, onClick }: { state: 'off' | 'animated' | 'on'; onClick: () => void }) {
  const t = useT();
  const label = state === 'on' ? t('Remove the keyframe at the playhead') : state === 'animated' ? t('Add a keyframe at the playhead') : t('Animate: add a keyframe at the playhead');
  return <IconButton size="sm" iconSize={12} icon={Diamond} label={label} className={`vd-keybtn ${state}`} active={state === 'on'} onClick={onClick} />;
}

function PlainSlider(p: KeySliderProps) {
  const t = useT();
  const unit = p.unit ?? 1;
  return (
    <div className="vd-keyrow">
      <Slider
        label={p.label}
        value={valueAt(p.clip, p.prop, 0) * unit}
        min={p.min}
        max={p.max}
        step={p.step}
        onChange={(x) => p.live((c) => setValueAt(c, p.prop, 0, x / unit))}
        onCommit={() => p.done(p.commitLabel)}
        format={p.format}
        defaultValue={p.defaultValue}
      />
      <KeyButton state="off" onClick={() => p.apply((c, now) => toggleKeyAt(c, p.prop, localOf(c, now)), t('Add keyframe'))} />
    </div>
  );
}

function AnimatedSlider(p: KeySliderProps) {
  const t = useT();
  const now = usePlayhead(p.time);
  const unit = p.unit ?? 1;
  const local = localOf(p.clip, now);
  const onKey = Boolean(p.clip.keys?.[p.prop]?.some((k) => Math.abs(k.t - local) <= KEY_TOLERANCE));
  return (
    <div className="vd-keyrow animated">
      <Slider
        label={p.label}
        value={valueAt(p.clip, p.prop, local) * unit}
        min={p.min}
        max={p.max}
        step={p.step}
        onChange={(x) => p.live((c, at) => setValueAt(c, p.prop, localOf(c, at), x / unit))}
        onCommit={() => p.done(p.commitLabel)}
        format={p.format}
        defaultValue={p.defaultValue}
      />
      <KeyButton state={onKey ? 'on' : 'animated'} onClick={() => p.apply((c, at) => toggleKeyAt(c, p.prop, localOf(c, at)), onKey ? t('Remove keyframe') : t('Add keyframe'))} />
    </div>
  );
}

/** A number field (pixels) whose property can be animated, like KeySlider. */
export function KeyNumber(props: Omit<KeySliderProps, 'min' | 'max' | 'step' | 'unit' | 'format' | 'defaultValue' | 'live' | 'done' | 'commitLabel'> & { suffix?: string }) {
  return props.clip.keys?.[props.prop]?.length ? <AnimatedNumber {...props} /> : <PlainNumber {...props} />;
}

type KeyNumberProps = Parameters<typeof KeyNumber>[0];

function PlainNumber(p: KeyNumberProps) {
  const t = useT();
  return (
    <Field label={p.label}>
      <div className="vd-keyrow">
        <NumberField small value={Math.round(valueAt(p.clip, p.prop, 0))} suffix={p.suffix} onChange={(x) => p.apply((c) => setValueAt(c, p.prop, 0, x), t('Transform'))} />
        <KeyButton state="off" onClick={() => p.apply((c, now) => toggleKeyAt(c, p.prop, localOf(c, now)), t('Add keyframe'))} />
      </div>
    </Field>
  );
}

function AnimatedNumber(p: KeyNumberProps) {
  const t = useT();
  const now = usePlayhead(p.time);
  const local = localOf(p.clip, now);
  const onKey = Boolean(p.clip.keys?.[p.prop]?.some((k) => Math.abs(k.t - local) <= KEY_TOLERANCE));
  return (
    <Field label={p.label}>
      <div className="vd-keyrow animated">
        <NumberField small value={Math.round(valueAt(p.clip, p.prop, local))} suffix={p.suffix} onChange={(x) => p.apply((c, at) => setValueAt(c, p.prop, localOf(c, at), x), t('Transform'))} />
        <KeyButton state={onKey ? 'on' : 'animated'} onClick={() => p.apply((c, at) => toggleKeyAt(c, p.prop, localOf(c, at)), onKey ? t('Remove keyframe') : t('Add keyframe'))} />
      </div>
    </Field>
  );
}

/** Keyframe navigation, the easing of the keyframes at the playhead, and "remove all". */
export function KeyBar({ time, clips, onSeek, apply }: { time: TimeStore; clips: Clip[]; onSeek: (t: number) => void; apply: KeyEdit }) {
  const t = useT();
  const now = usePlayhead(time);
  const times: number[] = [];
  for (const c of clips) for (const k of keyTimes(c)) if (!times.some((x) => Math.abs(x - (c.start + k)) <= KEY_TOLERANCE)) times.push(c.start + k);
  if (!times.length) return null;
  times.sort((a, b) => a - b);
  const prev = [...times].reverse().find((x) => x < now - KEY_TOLERANCE);
  const next = times.find((x) => x > now + KEY_TOLERANCE);
  const here = clips.flatMap((c) => Object.values(c.keys ?? {}).flatMap((l) => (l ?? []).filter((k) => Math.abs(c.start + k.t - now) <= KEY_TOLERANCE)));
  return (
    <div className="vd-keybar">
      <Diamond size={12} className="vd-keybar-icon" />
      <span>{t('{count} keyframe(s)', { count: times.length })}</span>
      <IconButton size="sm" icon={ChevronLeft} label={t('Previous keyframe')} disabled={prev === undefined} onClick={() => prev !== undefined && onSeek(prev)} />
      <IconButton size="sm" icon={ChevronRight} label={t('Next keyframe')} disabled={next === undefined} onClick={() => next !== undefined && onSeek(next)} />
      <span className="spacer" />
      {here.length > 0 && (
        <Select<Easing>
          small
          value={here[0].ease}
          aria-label={t('Easing of the keyframe at the playhead')}
          title={t('Easing of the keyframe at the playhead')}
          onChange={(e) => apply((c, at) => setEaseAt(c, localOf(c, at), e), t('Keyframe easing'))}
          options={EASINGS.map((e) => ({ value: e, label: t(EASE_LABELS[e]) }))}
        />
      )}
      <IconButton size="sm" icon={X} label={t('Remove all keyframes')} onClick={() => apply((c) => withoutKeys(c), t('Remove keyframes'))} />
    </div>
  );
}
