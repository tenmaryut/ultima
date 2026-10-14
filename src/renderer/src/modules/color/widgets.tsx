import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { IconButton, toast } from '../../components/ui';
import { t as translate, useT } from '../../core/i18n';
import { formatColor, parseColorValue, toHex, type ColorFormat } from './colormath';

export async function copyText(text: string, what?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(translate('Copied to clipboard'), what ?? (text.length > 80 ? undefined : text));
  } catch {
    toast.error(translate('Could not copy to the clipboard'));
  }
}

export function CopyButton({ text, label, size = 'sm' }: { text: string | (() => string); label?: string; size?: 'sm' | 'md' }) {
  const t = useT();
  return (
    <IconButton
      icon={Copy}
      size={size}
      label={label ?? t('Copy')}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(typeof text === 'function' ? text() : text);
      }}
    />
  );
}

/**
 * Text field showing a color in one model (HEX, RGB, …). Typing a new value and pressing
 * Enter (or leaving the field) sets the color; invalid input is reverted.
 */
export function ValueInput({
  hex,
  format,
  onChange,
  disabled,
  className = '',
  ariaLabel,
}: {
  hex: string;
  format: ColorFormat;
  onChange: (hex: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const t = useT();
  const value = formatColor(hex, format);
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const commit = () => {
    if (text.trim() === value) {
      setInvalid(false);
      return;
    }
    const rgb = parseColorValue(text, format);
    if (!rgb) {
      setInvalid(true);
      toast.warning(t('That is not a valid {format} value', { format: format.toUpperCase() }), text);
      setText(value);
      return;
    }
    setInvalid(false);
    onChange(toHex(rgb));
  };
  return (
    <input
      className={`input sm mono ${invalid ? 'co-invalid' : ''} ${className}`}
      value={text}
      disabled={disabled}
      spellCheck={false}
      aria-label={ariaLabel ?? format.toUpperCase()}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Small row of color chips (used by pickers and previews). */
export function ChipRow({
  colors,
  selected,
  onPick,
  size = 22,
  titles,
}: {
  colors: string[];
  selected?: number | null;
  onPick?: (index: number) => void;
  size?: number;
  titles?: string[];
}) {
  return (
    <div className="co-chips">
      {colors.map((c, i) => (
        <button
          key={`${c}-${i}`}
          type="button"
          className={`co-chip ${selected === i ? 'selected' : ''}`}
          style={{ background: c, width: size, height: size }}
          title={titles?.[i] ?? c.toUpperCase()}
          aria-label={titles?.[i] ?? c.toUpperCase()}
          onClick={() => onPick?.(i)}
          disabled={!onPick}
        />
      ))}
    </div>
  );
}
