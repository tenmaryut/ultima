import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Link2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { listSystemFonts } from '../../../core/platform';
import { ColorPicker } from '../../../components/ui';
import { FONT_STACKS, isThemeRef, primaryFont, resolveColor, fontStackFor, THEME_ROLES } from '../styles';
import type { Unit } from '../types';
import { formatLength, fromUnit, parseLength } from '../units';

/** Number input showing a px value in the document unit; accepts "12mm", "1/2in", "10+2"… */
export function UnitField({
  value,
  unit,
  onChange,
  min,
  max,
  label,
  title,
  disabled,
}: {
  value: number;
  unit: Unit;
  onChange: (px: number) => void;
  min?: number;
  max?: number;
  label?: string;
  title?: string;
  disabled?: boolean;
}) {
  const shown = formatLength(value, unit, false);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = (raw: string) => {
    let v = parseLength(raw, unit);
    if (v === null) {
      setText(shown);
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (Math.abs(v - value) > 1e-6) onChange(v);
    setText(formatLength(v, unit, false));
  };
  return (
    <label className="ly-unit-field" title={title}>
      {label && <span className="ly-unit-label">{label}</span>}
      <input
        className="input sm"
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = unit === 'in' ? 0.0625 : 1;
            const cur = parseLength(text, unit) ?? value;
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(formatLength(cur + fromUnit(delta, unit), unit, false));
          }
        }}
      />
      <span className="ly-unit-suffix">{unit}</span>
    </label>
  );
}

/** Small numeric field with a suffix (pt, %, °…). */
export function NumField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  label,
  title,
  precision = 2,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  label?: string;
  title?: string;
  precision?: number;
}) {
  const f = (v: number) => String(Math.round(v * 10 ** precision) / 10 ** precision);
  const [text, setText] = useState(f(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(f(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (raw: string) => {
    let v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v)) {
      setText(f(value));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setText(f(v));
  };
  return (
    <label className="ly-unit-field" title={title}>
      {label && <span className="ly-unit-label">{label}</span>}
      <input
        className="input sm"
        value={text}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            commit(String((parseFloat(text) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
          }
        }}
      />
      {suffix && <span className="ly-unit-suffix">{suffix}</span>}
    </label>
  );
}

/**
 * Color field: picker + the document's theme colors. Picking a theme swatch stores a
 * reference ("$2") so the color follows the theme.
 */
export function ColorField({
  value,
  swatches,
  onChange,
  onCommit,
  allowNone,
  label,
}: {
  value: string;
  swatches: string[];
  /** Live change (no undo step). */
  onChange: (v: string) => void;
  /** Final change (undo step). */
  onCommit: (v: string) => void;
  allowNone?: boolean;
  label?: string;
}) {
  const t = useT();
  const resolved = value ? resolveColor(value, swatches, '#000000') : 'transparent';
  const linked = isThemeRef(value);
  return (
    <div className="ly-color-field">
      {label && <span className="ly-unit-label">{label}</span>}
      <ColorPicker value={resolved} onChange={onChange} onCommit={onCommit} label={label ?? t('Color')} />
      <div className="ly-theme-swatches">
        {swatches.slice(0, 8).map((c, i) => (
          <button
            key={i}
            type="button"
            className={`ly-mini-swatch ${value === `$${i}` ? 'active' : ''}`}
            style={{ background: c }}
            title={`${t(THEME_ROLES[i] ?? 'Theme color')} (${c})`}
            onClick={() => onCommit(`$${i}`)}
          />
        ))}
        {allowNone && (
          <button type="button" className={`ly-mini-swatch none ${!value ? 'active' : ''}`} title={t('None')} onClick={() => onCommit('')}>
            <Ban size={11} />
          </button>
        )}
      </div>
      {linked && (
        <span className="ly-linked" title={t('Linked to a theme color')}>
          <Link2 size={11} />
        </span>
      )}
    </div>
  );
}

/* --------------------------------- Fonts --------------------------------- */

let fontCache: string[] | null = null;
let fontPromise: Promise<string[]> | null = null;

export function useSystemFonts(): [string[], () => void] {
  const [fonts, setFonts] = useState<string[]>(fontCache ?? []);
  const load = () => {
    if (fontCache && fontCache.length > 20) return;
    fontPromise = listSystemFonts().then((list) => {
      fontCache = list;
      return list;
    });
    void fontPromise.then(setFonts);
  };
  useEffect(() => {
    if (!fontCache) {
      fontPromise ??= listSystemFonts().then((list) => {
        fontCache = list;
        return list;
      });
      void fontPromise.then(setFonts);
    }
  }, []);
  return [fonts, load];
}

const SUGGESTED = [
  { label: 'Sans (Inter)', stack: FONT_STACKS.sans },
  { label: 'Serif (Georgia)', stack: FONT_STACKS.serif },
  { label: 'Display (Arial Black)', stack: FONT_STACKS.display },
  { label: 'Elegant (Playfair / Didot)', stack: FONT_STACKS.elegant },
  { label: 'Condensed', stack: FONT_STACKS.condensed },
  { label: 'Mono', stack: FONT_STACKS.mono },
];

export function FontPicker({ value, onChange }: { value: string; onChange: (stack: string) => void }) {
  const t = useT();
  const [fonts, requestFonts] = useSystemFonts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: -9999, top: -9999 });
  const current = primaryFont(value);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) return;
    const r = anchor.current.getBoundingClientRect();
    const h = pop.current.offsetHeight;
    const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos({ left: Math.min(r.left, window.innerWidth - 268), top, width: Math.max(240, r.width) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (pop.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fonts.filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 300);
  }, [fonts, query]);

  const choose = (stack: string) => {
    onChange(stack);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="select sm ly-font-button"
        style={{ fontFamily: value }}
        title={value}
        onClick={() => {
          requestFonts();
          setOpen((o) => !o);
        }}
      >
        {current}
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="ly-font-pop" style={pos} role="listbox" aria-label={t('Fonts')}>
            <input className="input sm" autoFocus placeholder={t('Search fonts…')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) choose(filtered[0] ? fontStackFor(filtered[0]) : fontStackFor(query.trim()));
            }} />
            <div className="ly-font-list">
              {!query &&
                SUGGESTED.map((s) => (
                  <button key={s.label} type="button" className={`ly-font-item ${value === s.stack ? 'active' : ''}`} style={{ fontFamily: s.stack }} onClick={() => choose(s.stack)}>
                    {t(s.label)}
                  </button>
                ))}
              {!query && <div className="ly-font-sep">{t('Installed fonts')}</div>}
              {filtered.map((f) => (
                <button key={f} type="button" className={`ly-font-item ${current === f ? 'active' : ''}`} style={{ fontFamily: `'${f.replace(/'/g, '')}', sans-serif` }} onClick={() => choose(fontStackFor(f))}>
                  {f}
                </button>
              ))}
              {query && !filtered.length && (
                <button type="button" className="ly-font-item" onClick={() => choose(fontStackFor(query.trim()))}>
                  {t('Use “{name}”', { name: query.trim() })}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function Row({ children, style, className = '' }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={`ly-row ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="ly-grid2">{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="ly-label">{children}</span>;
}
