import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react';

export type MenuEntry =
  | {
      type?: 'item';
      label: string;
      onClick?: () => void;
      shortcut?: string;
      icon?: LucideIcon;
      disabled?: boolean;
      checked?: boolean;
      submenu?: MenuEntry[];
    }
  | { type: 'separator' }
  | { type: 'heading'; label: string };

/** Floating menu list positioned at a point (used by dropdowns and context menus). */
export function MenuPopup({
  x,
  y,
  entries,
  onClose,
  minWidth,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
  minWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y, visibility: 'hidden' });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let left = x;
    let top = y;
    if (left + el.offsetWidth > window.innerWidth - 6) left = Math.max(6, window.innerWidth - el.offsetWidth - 6);
    if (top + el.offsetHeight > window.innerHeight - 6) top = Math.max(6, window.innerHeight - el.offsetHeight - 6);
    setStyle({ left, top, minWidth });
  }, [x, y, minWidth]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.('.menu')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="menu" style={style} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {entries.map((entry, i) => {
        if (entry.type === 'separator') return <div key={i} className="menu-sep" />;
        if (entry.type === 'heading') return <div key={i} className="menu-heading">{entry.label}</div>;
        const Icon = entry.icon;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={entry.disabled}
            onMouseEnter={(e) => {
              if (entry.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ index: i, x: r.right - 2, y: r.top - 4 });
              } else setSub(null);
            }}
            onClick={(e) => {
              if (entry.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ index: i, x: r.right - 2, y: r.top - 4 });
                return;
              }
              onClose();
              entry.onClick?.();
            }}
          >
            <span style={{ width: 16, display: 'inline-flex' }}>
              {entry.checked ? <Check size={14} /> : Icon ? <Icon size={14} /> : null}
            </span>
            <span>{entry.label}</span>
            {entry.shortcut && <span className="shortcut">{entry.shortcut}</span>}
            {entry.submenu && <ChevronRight size={13} style={{ marginLeft: entry.shortcut ? 4 : 'auto' }} />}
          </button>
        );
      })}
      {sub && (() => {
        const entry = entries[sub.index];
        return entry && entry.type !== 'separator' && entry.type !== 'heading' && entry.submenu ? (
          <MenuPopup x={sub.x} y={sub.y} entries={entry.submenu} onClose={onClose} />
        ) : null;
      })()}
    </div>,
    document.body,
  );
}

/** Horizontal menu bar ("File  Edit  Image  Filter ...") for module headers. */
export function MenuBar({ menus }: { menus: { label: string; entries: MenuEntry[] | (() => MenuEntry[]) }[] }) {
  const [open, setOpen] = useState<{ index: number; x: number; y: number } | null>(null);
  return (
    <nav className="menubar">
      {menus.map((menu, i) => (
        <button
          key={menu.label}
          type="button"
          className={`menubar-item ${open?.index === i ? 'open' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setOpen(open?.index === i ? null : { index: i, x: r.left, y: r.bottom + 2 });
          }}
          onMouseEnter={(e) => {
            if (open && open.index !== i) {
              const r = e.currentTarget.getBoundingClientRect();
              setOpen({ index: i, x: r.left, y: r.bottom + 2 });
            }
          }}
        >
          {menu.label}
        </button>
      ))}
      {open && (
        <MenuPopup
          key={open.index}
          x={open.x}
          y={open.y}
          minWidth={220}
          entries={(() => {
            const e = menus[open.index].entries;
            return typeof e === 'function' ? e() : e;
          })()}
          onClose={() => setOpen(null)}
        />
      )}
    </nav>
  );
}

/** A button that opens a dropdown menu. */
export function DropdownButton({ children, entries, className = 'btn sm', title }: { children: ReactNode; entries: MenuEntry[] | (() => MenuEntry[]); className?: string; title?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        title={title}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos(pos ? null : { x: r.left, y: r.bottom + 4 });
        }}
      >
        {children}
      </button>
      {pos && (
        <MenuPopup x={pos.x} y={pos.y} entries={typeof entries === 'function' ? entries() : entries} onClose={() => setPos(null)} />
      )}
    </>
  );
}

/** Hook for right-click menus: `const ctx = useContextMenu(); <div onContextMenu={ctx.open(entries)}/> {ctx.element}` */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  return {
    open: (entries: MenuEntry[] | (() => MenuEntry[])) => (e: React.MouseEvent) => {
      e.preventDefault();
      setState({ x: e.clientX, y: e.clientY, entries: typeof entries === 'function' ? entries() : entries });
    },
    show: (x: number, y: number, entries: MenuEntry[]) => setState({ x, y, entries }),
    element: state ? <MenuPopup x={state.x} y={state.y} entries={state.entries} onClose={() => setState(null)} /> : null,
  };
}
