import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * Compact number that can be dragged horizontally to change (like After Effects'
 * "scrubby" values) or clicked to type. Shift = ×10, Alt = ×0.1.
 */
export function ScrubNumber({
  value,
  onChange,
  onCommit,
  step = 1,
  min,
  max,
  precision = 1,
  suffix,
  title,
  disabled,
  style,
  width,
}: {
  value: number;
  /** Live updates while dragging (no undo step). */
  onChange: (v: number) => void;
  /** Called once when a drag or typed edit is finished. */
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  title?: string;
  disabled?: boolean;
  style?: CSSProperties;
  width?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ x: number; v: number; moved: boolean; last: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const fmt = (v: number) => {
    const f = Math.pow(10, precision);
    return String(Math.round(v * f) / f);
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (editing) {
    const finish = (commit: boolean) => {
      setEditing(false);
      if (!commit) return;
      // Simple arithmetic like "+10" or "*2" relative to the current value.
      const raw = text.trim();
      let v = NaN;
      const rel = /^([+\-*/])\s*(-?\d*\.?\d+)$/.exec(raw);
      if (rel && raw[0] !== '-') {
        const n = parseFloat(rel[2]);
        v = rel[1] === '+' ? value + n : rel[1] === '-' ? value - n : rel[1] === '*' ? value * n : n ? value / n : value;
      } else v = parseFloat(raw);
      if (Number.isFinite(v)) onCommit(clamp(v));
    };
    return (
      <input
        ref={inputRef}
        className="mo-scrub-input"
        style={{ width: width ?? 52, ...style }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
      />
    );
  }

  return (
    <span
      className={`mo-scrub ${disabled ? 'disabled' : ''}`}
      style={{ minWidth: width, ...style }}
      title={title}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setText(fmt(value));
          setEditing(true);
        }
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false, last: value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const v = clamp(d.v + Math.round(dx) * step * mult);
        d.last = v;
        onChange(v);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.moved) onCommit(d.last);
        else {
          setText(fmt(value));
          setEditing(true);
        }
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) onCommit(d.last);
      }}
    >
      {fmt(value)}
      {suffix && <span className="mo-scrub-suffix">{suffix}</span>}
    </span>
  );
}
