import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Button } from './controls';
import { t } from '../../core/i18n';

/* --------------------------------- Toasts -------------------------------- */

type ToastKind = 'info' | 'success' | 'error' | 'warning';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
}

const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, 'id'>, ms?: number) => void; dismiss: (id: number) => void }>(
  (set, get) => ({
    items: [],
    push: (item, ms = 4500) => {
      const id = Date.now() + Math.random();
      set({ items: [...get().items.slice(-4), { ...item, id }] });
      if (ms > 0) setTimeout(() => get().dismiss(id), ms);
    },
    dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
  }),
);

export const toast = {
  info: (message: string, detail?: string) => useToasts.getState().push({ kind: 'info', message, detail }),
  success: (message: string, detail?: string) => useToasts.getState().push({ kind: 'success', message, detail }),
  warning: (message: string, detail?: string) => useToasts.getState().push({ kind: 'warning', message, detail }, 7000),
  error: (message: string, detail?: string) => useToasts.getState().push({ kind: 'error', message, detail }, 9000),
};

export function Toasts() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const icons = { info: Info, success: CheckCircle2, error: XCircle, warning: AlertTriangle };
  const colors = { info: 'var(--info)', success: 'var(--success)', error: 'var(--danger)', warning: 'var(--warning)' };
  return (
    <div className="toasts" aria-live="polite">
      {items.map((item) => {
        const Icon = icons[item.kind];
        return (
          <div key={item.id} className={`toast ${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={18} color={colors[item.kind]} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <div className="grow selectable">
              <div>{item.message}</div>
              {item.detail && <div className="muted" style={{ fontSize: 12, marginTop: 2, whiteSpace: 'pre-wrap' }}>{item.detail}</div>}
            </div>
            <button type="button" className="icon-btn sm" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------- Modal --------------------------------- */

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide,
  width,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span className="grow">{title}</span>
          <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------- Promise based dialogs ------------------------- */

interface DialogRequest {
  id: number;
  kind: 'confirm' | 'prompt' | 'alert';
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Prompt only: hide the typed text (passwords). */
  password?: boolean;
  resolve: (value: unknown) => void;
}

const useDialogs = create<{ queue: DialogRequest[] }>(() => ({ queue: [] }));

function openDialog<T>(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<T> {
  return new Promise<T>((resolve) => {
    const item: DialogRequest = { ...req, id: Date.now() + Math.random(), resolve: resolve as (v: unknown) => void };
    useDialogs.setState((s) => ({ queue: [...s.queue, item] }));
  });
}

export function confirmDialog(options: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return openDialog<boolean>({ kind: 'confirm', ...options });
}

export function promptDialog(options: {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Hide the typed text (for passwords). */
  password?: boolean;
}): Promise<string | null> {
  return openDialog<string | null>({ kind: 'prompt', ...options });
}

export function alertDialog(options: { title: string; message?: string }): Promise<void> {
  return openDialog<void>({ kind: 'alert', ...options });
}

export function DialogHost() {
  const current = useDialogs((s) => s.queue[0]);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (current) {
      setValue(current.defaultValue ?? '');
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [current]);
  if (!current) return null;
  const finish = (result: unknown) => {
    current.resolve(result);
    useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));
  };
  const cancelValue = current.kind === 'confirm' ? false : current.kind === 'prompt' ? null : undefined;
  return (
    <Modal
      title={current.title}
      onClose={() => finish(cancelValue)}
      footer={
        <>
          {current.kind !== 'alert' && <Button onClick={() => finish(cancelValue)}>{t('Cancel')}</Button>}
          <Button
            variant={current.danger ? 'danger' : 'primary'}
            onClick={() => finish(current.kind === 'prompt' ? value : current.kind === 'confirm' ? true : undefined)}
          >
            {current.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      {current.message && <div className="selectable" style={{ whiteSpace: 'pre-wrap' }}>{current.message}</div>}
      {current.kind === 'prompt' && (
        <input
          ref={inputRef}
          className="input"
          type={current.password ? 'password' : 'text'}
          autoComplete={current.password ? 'off' : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && finish(value)}
        />
      )}
    </Modal>
  );
}

/* ------------------------------- Empty state ------------------------------ */

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function DropOverlay({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return <div className="drop-overlay">{label}</div>;
}
