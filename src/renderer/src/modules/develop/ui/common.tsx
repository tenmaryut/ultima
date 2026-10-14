import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ban, Flag, RotateCcw, Star } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { IconButton, Panel } from '../../../components/ui';
import { PARAMS, clampParam, formatParam, paramLabel, type DevelopSettings, type NumericKey } from '../params';
import { commitSettings, getPhoto, setSettings, useDevelop } from '../store';
import { LABEL_COLORS, LABELS, type ColorLabel, type Flag as FlagValue, type Photo } from '../types';

/* ---------------------------------- Hooks ---------------------------------- */

export function useActivePhoto(): Photo | undefined {
  return useDevelop((s) => (s.activeId ? s.photos[s.activeId] : undefined));
}

export interface SettingsEditor {
  settings: DevelopSettings;
  /** Live change (no undo step yet). */
  live: (patch: Partial<DevelopSettings>) => void;
  /** Records the live changes as one undo step. */
  commit: (label?: string) => void;
  /** Change + undo step at once. */
  apply: (patch: Partial<DevelopSettings>, label?: string) => void;
}

export function editorFor(photo: Photo): SettingsEditor {
  const latest = () => getPhoto(photo.id)?.settings ?? photo.settings;
  return {
    settings: photo.settings,
    live: (patch) => setSettings(photo.id, { ...latest(), ...patch }, { record: false }),
    commit: (label) => commitSettings(photo.id, label),
    apply: (patch, label) => setSettings(photo.id, { ...latest(), ...patch }, { record: true, label }),
  };
}

/* ------------------------------- Param slider ------------------------------- */

function ValueField({ k, value, onSet }: { k: NumericKey; value: number; onSet: (v: number) => void }) {
  const [text, setText] = useState(formatParam(k, value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(formatParam(k, value));
  }, [k, value]);
  const commit = () => {
    const v = parseFloat(text.replace(',', '.').replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(v)) onSet(clampParam(k, v));
    setText(formatParam(k, Number.isFinite(v) ? clampParam(k, v) : value));
  };
  return (
    <input
      className="dv-slider-value"
      value={text}
      aria-label={paramLabel(k)}
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
          setText(formatParam(k, value));
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

export interface ParamSliderProps {
  k: NumericKey;
  value: number;
  editor: SettingsEditor;
  /** Custom track (CSS background), e.g. a hue gradient. */
  track?: string;
  label?: string;
  disabled?: boolean;
}

/** Lightroom-style slider: double-click the label (or the thumb) to reset, click the value to type. */
export const ParamSlider = memo(function ParamSlider({ k, value, editor, track, label, disabled }: ParamSliderProps) {
  const t = useT();
  const def = PARAMS[k];
  const pct = (v: number) => ((v - def.min) / (def.max - def.min)) * 100;
  const zero = Math.min(Math.max(pct(def.def), 0), 100);
  const cur = pct(value);
  const style = {
    '--lo': `${Math.min(zero, cur)}%`,
    '--hi': `${Math.max(zero, cur)}%`,
    ...(track ? { '--track': track } : {}),
  } as CSSProperties;
  const name = label ?? t(def.label);
  const reset = () => {
    if (value === def.def) return;
    editor.apply({ [k]: def.def } as Partial<DevelopSettings>, `${t('Reset')} ${name}`);
  };
  return (
    <div className={`dv-slider ${value !== def.def ? 'changed' : ''}`}>
      <div className="dv-slider-top">
        <span className="dv-slider-label" title={t('Double-click to reset')} onDoubleClick={reset}>
          {name}
        </span>
        <ValueField k={k} value={value} onSet={(v) => editor.apply({ [k]: v } as Partial<DevelopSettings>, name)} />
      </div>
      <input
        type="range"
        className="dv-range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        disabled={disabled}
        style={style}
        aria-label={name}
        onChange={(e) => editor.live({ [k]: clampParam(k, parseFloat(e.target.value)) } as Partial<DevelopSettings>)}
        onPointerUp={() => editor.commit(name)}
        onKeyUp={() => editor.commit(name)}
        onDoubleClick={reset}
      />
    </div>
  );
});

/** Collapsible right-panel section with a reset button. */
export function Section({ title, onReset, children, defaultOpen = true, extra }: { title: string; onReset?: () => void; children: ReactNode; defaultOpen?: boolean; extra?: ReactNode }) {
  const t = useT();
  return (
    <Panel
      title={title}
      defaultOpen={defaultOpen}
      actions={
        <>
          {extra}
          {onReset && <IconButton icon={RotateCcw} size="sm" iconSize={12} label={`${t('Reset')} ${title}`} onClick={onReset} />}
        </>
      }
    >
      {children}
    </Panel>
  );
}

/* --------------------------- Rating / flag / label --------------------------- */

export function Stars({ value, onChange, size = 13 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const t = useT();
  return (
    <span className="dv-stars" role={onChange ? 'radiogroup' : undefined} aria-label={t('Rating')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`dv-star ${n <= value ? 'on' : ''}`}
          title={t('{count} star(s)', { count: n })}
          aria-label={t('{count} star(s)', { count: n })}
          tabIndex={onChange ? 0 : -1}
          disabled={!onChange}
          style={onChange ? undefined : { cursor: 'default' }}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(value === n ? 0 : n);
          }}
        >
          <Star size={size} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

export function FlagButtons({ value, onChange }: { value: FlagValue; onChange: (f: FlagValue) => void }) {
  const t = useT();
  return (
    <span className="dv-row-tight">
      <button type="button" className={`dv-flag-btn ${value === 'pick' ? 'on' : ''}`} title={`${t('Pick')} (P)`} aria-pressed={value === 'pick'} onClick={() => onChange(value === 'pick' ? null : 'pick')}>
        <Flag size={13} fill={value === 'pick' ? 'currentColor' : 'none'} />
      </button>
      <button type="button" className={`dv-flag-btn reject ${value === 'reject' ? 'on' : ''}`} title={`${t('Reject')} (X)`} aria-pressed={value === 'reject'} onClick={() => onChange(value === 'reject' ? null : 'reject')}>
        <Ban size={13} />
      </button>
    </span>
  );
}

export const LABEL_NAMES: Record<ColorLabel, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' };

export function LabelButtons({ value, onChange }: { value: ColorLabel | null; onChange: (l: ColorLabel | null) => void }) {
  const t = useT();
  return (
    <span className="dv-row-tight" style={{ gap: 5 }}>
      {LABELS.map((l, i) => (
        <button
          key={l}
          type="button"
          className={`dv-label-btn ${value === l ? 'on' : ''}`}
          style={{ background: LABEL_COLORS[l] }}
          title={`${t(LABEL_NAMES[l])}${i < 4 ? ` (${i + 6})` : ''}`}
          aria-label={t(LABEL_NAMES[l])}
          aria-pressed={value === l}
          onClick={() => onChange(value === l ? null : l)}
        />
      ))}
    </span>
  );
}

/** Small read-only flag indicator. */
export function FlagIcon({ flag }: { flag: FlagValue }) {
  if (flag === 'pick') return <Flag size={11} fill="currentColor" color="var(--text-0)" />;
  if (flag === 'reject') return <Ban size={11} color="var(--danger)" />;
  return null;
}
