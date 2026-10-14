import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Pipette } from 'lucide-react';
import { DEFAULT_SWATCHES, hsvToRgb, parseColor, rgbToHsv, toCss, toHex, type HSV } from '../../core/utils/color';

const RECENT_KEY = 'ultima-recent-colors';

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function pushRecent(color: string) {
  const list = [color, ...loadRecent().filter((c) => c !== color)].slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

/**
 * Color swatch button that opens an HSV picker with alpha, hex input, eyedropper
 * (when the platform supports it), default swatches and recent colors.
 * `value`/`onChange` use CSS color strings (#rrggbb or rgba()).
 */
export function ColorPicker({
  value,
  onChange,
  onCommit,
  alpha = true,
  label,
  size = 24,
}: {
  value: string;
  onChange: (color: string) => void;
  /** Called when the popover closes after a change (record undo here). */
  onCommit?: (color: string) => void;
  alpha?: boolean;
  label?: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="swatch"
        style={{ width: size, height: size }}
        title={label ?? value}
        aria-label={label ?? 'Pick color'}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ background: value }} />
      </button>
      {open && (
        <ColorPopover
          anchor={anchor.current}
          value={value}
          alpha={alpha}
          onChange={onChange}
          onClose={(changed, final) => {
            setOpen(false);
            if (changed) {
              pushRecent(final);
              onCommit?.(final);
            }
          }}
        />
      )}
    </>
  );
}

function ColorPopover({
  anchor,
  value,
  alpha,
  onChange,
  onClose,
}: {
  anchor: HTMLElement | null;
  value: string;
  alpha: boolean;
  onChange: (c: string) => void;
  onClose: (changed: boolean, final: string) => void;
}) {
  const initial = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const [hsv, setHsvState] = useState<HSV>(() => rgbToHsv(initial));
  const [a, setAState] = useState(initial.a);
  const hsvRef = useRef(hsv);
  const aRef = useRef(a);
  const setHsv = (next: HSV) => {
    hsvRef.current = next;
    setHsvState(next);
  };
  const setA = (next: number) => {
    aRef.current = next;
    setAState(next);
  };
  const [hex, setHex] = useState(toHex(initial));
  const [pos, setPos] = useState<CSSProperties>({ left: -9999, top: -9999 });
  const ref = useRef<HTMLDivElement>(null);
  const changed = useRef(false);
  const latest = useRef(value);
  const recent = useRef(loadRecent());

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const pw = ref.current.offsetWidth;
    const ph = ref.current.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    setPos({ left: Math.max(8, left), top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      onClose(changed.current, latest.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose(changed.current, latest.current);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  const emit = (nextHsv: HSV, nextA: number) => {
    const rgb = hsvToRgb(nextHsv);
    const css = toCss({ ...rgb, a: alpha ? nextA : 1 });
    setHex(toHex(rgb));
    changed.current = true;
    latest.current = css;
    onChange(css);
  };

  const setFromString = (s: string, keepAlpha = false) => {
    const c = parseColor(s);
    if (!c) return;
    const next = rgbToHsv(c);
    // A plain #rrggbb typed into the hex field keeps the current opacity.
    const alphaGiven = /^#?([0-9a-f]{4}|[0-9a-f]{8})$/i.test(s.trim());
    const nextA = keepAlpha && !alphaGiven ? aRef.current : c.a;
    setHsv(next);
    setA(nextA);
    emit(next, nextA);
  };
  const commitHex = () => {
    if (hex.trim().toLowerCase() === toHex(hsvToRgb(hsvRef.current)).toLowerCase()) return; // unchanged
    setFromString(hex, true);
  };

  const drag = (el: HTMLElement, handler: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    const update = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      handler(
        Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)),
      );
    };
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const pure = hsvToRgb({ h: hsv.h, s: 1, v: 1 });
  const rgb = hsvToRgb(hsv);
  const eyeDropperSupported = 'EyeDropper' in window;

  return createPortal(
    <div ref={ref} className="color-popover" style={pos} role="dialog" aria-label="Color picker">
      <div
        className="color-sv"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${toHex(pure)})`,
        }}
        onPointerDown={(e) =>
          drag(e.currentTarget, (x, y) => {
            const next = { ...hsvRef.current, s: x, v: 1 - y };
            setHsv(next);
            emit(next, aRef.current);
          })(e)
        }
      >
        <span className="knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: toHex(rgb) }} />
      </div>
      <div
        className="color-strip"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        onPointerDown={(e) =>
          drag(e.currentTarget, (x) => {
            const next = { ...hsvRef.current, h: x * 360 };
            setHsv(next);
            emit(next, aRef.current);
          })(e)
        }
      >
        <span className="knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: toHex(pure) }} />
      </div>
      {alpha && (
        <div
          className="color-strip checker"
          onPointerDown={(e) =>
            drag(e.currentTarget, (x) => {
              setA(x);
              emit(hsvRef.current, x);
            })(e)
          }
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 6,
              background: `linear-gradient(to right, transparent, ${toHex(rgb)})`,
            }}
          />
          <span className="knob" style={{ left: `${a * 100}%`, background: toCss({ ...rgb, a }) }} />
        </div>
      )}
      <div className="row">
        <input
          className="input sm mono"
          value={hex}
          aria-label="Hex color"
          onChange={(e) => setHex(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              commitHex();
            }
          }}
        />
        {alpha && (
          <span className="faint mono" style={{ width: 40, textAlign: 'right' }}>
            {Math.round(a * 100)}%
          </span>
        )}
        {eyeDropperSupported && (
          <button
            type="button"
            className="icon-btn sm"
            title="Pick a color from the screen"
            onClick={async () => {
              try {
                const dropper = new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper();
                const res = await dropper.open();
                setFromString(res.sRGBHex);
              } catch {
                // cancelled
              }
            }}
          >
            <Pipette size={14} />
          </button>
        )}
      </div>
      <div className="swatch-grid">
        {DEFAULT_SWATCHES.map((c) => (
          <button key={c} type="button" style={{ background: c }} title={c} onClick={() => setFromString(c)} />
        ))}
      </div>
      {recent.current.length > 0 && (
        <div className="swatch-grid">
          {recent.current.map((c) => (
            <button key={c} type="button" style={{ background: c }} title={c} onClick={() => setFromString(c)} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
