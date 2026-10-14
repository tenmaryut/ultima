import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

/* --------------------------------- Button -------------------------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon: Icon, block, className = '', children, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', variant !== 'default' && variant, size !== 'md' && size, block && 'block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Tooltip + accessible label. */
  label: string;
  active?: boolean;
  size?: 'sm' | 'md';
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, active, size = 'md', iconSize, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`icon-btn ${size === 'sm' ? 'sm' : ''} ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...rest}
    >
      <Icon size={iconSize ?? (size === 'sm' ? 14 : 16)} />
    </button>
  );
});

/** Square tool button for vertical tool palettes. */
export function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tool-btn ${active ? 'active' : ''}`}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={17} />
    </button>
  );
}

/* --------------------------------- Inputs -------------------------------- */

export function Field({ label, children, hint, inline }: { label: ReactNode; children: ReactNode; hint?: ReactNode; inline?: boolean }) {
  return (
    <label className={inline ? 'field-inline' : 'field'}>
      <span className="field-label">
        {label}
        {hint && <span className="faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { small?: boolean }>(
  function TextInput({ className = '', small, ...rest }, ref) {
    return <input ref={ref} className={`input ${small ? 'sm' : ''} ${className}`} {...rest} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className = '', ...rest },
  ref,
) {
  return <textarea ref={ref} className={`textarea ${className}`} {...rest} />;
});

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Select<T extends string | number = string>({
  value,
  options,
  onChange,
  small,
  className = '',
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  small?: boolean;
}) {
  return (
    <select
      className={`select ${small ? 'sm' : ''} ${className}`}
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
      {...rest}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  small,
  disabled,
  title,
  style,
  precision,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  small?: boolean;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  precision?: number;
}) {
  const format = (v: number) => (precision !== undefined ? v.toFixed(precision) : String(Math.round(v * 1000) / 1000));
  const [text, setText] = useState(format(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(value));
  }, [value]);
  const commit = (raw: string) => {
    let v = parseFloat(raw);
    if (Number.isNaN(v)) {
      setText(format(value));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
    setText(format(v));
  };
  return (
    <div className="number-field" style={style} title={title}>
      <input
        className={`input ${small ? 'sm' : ''}`}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(String((parseFloat(text) || 0) + delta));
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  defaultValue,
  format,
  disabled,
}: {
  label?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Fires continuously while dragging. */
  onChange: (value: number) => void;
  /** Fires once when the user releases the slider (good place to record undo history). */
  onCommit?: (value: number) => void;
  /** Double-click resets to this value. */
  defaultValue?: number;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="slider">
      {label !== undefined && (
        <div className="slider-top">
          <label htmlFor={id}>{label}</label>
          <span className="value">{format ? format(value) : Math.round(value * 100) / 100}</span>
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
        onDoubleClick={() => {
          if (defaultValue !== undefined) {
            onChange(defaultValue);
            onCommit?.(defaultValue);
          }
        }}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label?: string; icon?: LucideIcon; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          title={o.title ?? o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <o.icon size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  style,
}: {
  value: T;
  tabs: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  style?: CSSProperties;
}) {
  return (
    <div className="tabs" role="tablist" style={style}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={`tab ${tab.value === value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon && <tab.icon size={14} />}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Panels -------------------------------- */

export function Panel({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel">
      <div className="panel-header" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="grow">{title}</span>
        {actions && (
          <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'err'; children: ReactNode }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
