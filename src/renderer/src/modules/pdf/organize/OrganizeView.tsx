/**
 * Organize pages: a grid of thumbnails to select (click, Ctrl/Cmd-click, Shift-click),
 * reorder by dragging, rotate, delete, duplicate, insert, extract and split.
 */
import { useMemo, useRef, useState } from 'react';
import { Copy, FileInput, FileOutput, FilePlus, Images, RotateCcw, RotateCw, Scissors, Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Slider } from '../../../components/ui';
import { useDoc } from '../context';
import { usePdfUi } from '../store';
import { rangeBetween } from '../organize';
import { duplicate, extractToFile, insertBlank, move, remove, rotate } from '../pageActions';
import { pickAndInsert } from '../menus';
import type { Annot } from '../types';
import { PageThumb } from '../panels/PageThumb';

export function OrganizeView() {
  const t = useT();
  const history = useDoc();
  const doc = history.present;
  const selection = usePdfUi((s) => s.pageSelection);
  const set = usePdfUi((s) => s.set);
  const [thumbW, setThumbW] = useState(150);
  const [drag, setDrag] = useState<{ ids: string[]; x: number; y: number; slot: number; marker: { left: number; top: number; height: number } | null } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const byPage = useMemo(() => {
    const map = new Map<string, Annot[]>();
    for (const a of doc.annots) map.set(a.page, [...(map.get(a.page) ?? []), a]);
    return map;
  }, [doc.annots]);
  const selected = new Set(selection);
  const targets = selection.length ? selection : [];

  const select = (id: string, e: React.MouseEvent | React.PointerEvent) => {
    if (e.shiftKey && anchor.current) {
      set({ pageSelection: rangeBetween(doc.pages, anchor.current, id) });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      set({ pageSelection: selected.has(id) ? selection.filter((x) => x !== id) : [...selection, id] });
    } else if (!selected.has(id)) {
      set({ pageSelection: [id] });
    }
    anchor.current = id;
  };

  /** Insertion slot (0..pages.length) under a client point, plus where to draw the marker. */
  const slotAt = (x: number, y: number) => {
    const grid = gridRef.current;
    if (!grid) return { slot: doc.pages.length, marker: null };
    const items = Array.from(grid.querySelectorAll<HTMLElement>('[data-org-index]'));
    const gridBox = grid.getBoundingClientRect();
    let best: { slot: number; dist: number; left: number; top: number; height: number } | null = null;
    for (const el of items) {
      const i = Number(el.dataset.orgIndex);
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      const rowDist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const before = x < r.left + r.width / 2;
      const edge = before ? r.left : r.right;
      const dist = rowDist * 4 + Math.abs(x - edge) + Math.abs(y - cy) * 0.01;
      if (!best || dist < best.dist) best = { slot: before ? i : i + 1, dist, left: edge - gridBox.left - 8, top: r.top - gridBox.top, height: r.height };
    }
    return best ? { slot: best.slot, marker: { left: best.left, top: best.top, height: best.height } } : { slot: doc.pages.length, marker: null };
  };

  const onItemPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    select(id, e);
    const start = { x: e.clientX, y: e.clientY };
    const ids = selected.has(id) && !e.shiftKey && !(e.ctrlKey || e.metaKey) ? doc.pages.filter((p) => selected.has(p.id)).map((p) => p.id) : [id];
    let dragging = false;
    let current = { slot: -1, marker: null as { left: number; top: number; height: number } | null, x: 0, y: 0 };
    const scroller = scrollRef.current;
    let autoScroll = 0;
    const tick = () => {
      if (!dragging || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const edge = 60;
      const dy = current.y < r.top + edge ? -12 : current.y > r.bottom - edge ? 12 : 0;
      if (dy) {
        scroller.scrollTop += dy;
        const s = slotAt(current.x, current.y);
        current = { ...current, ...s };
        setDrag({ ids, x: current.x, y: current.y, slot: s.slot, marker: s.marker });
      }
      autoScroll = requestAnimationFrame(tick);
    };
    const moveH = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      if (!dragging) {
        dragging = true;
        set({ pageSelection: ids });
        autoScroll = requestAnimationFrame(tick);
      }
      const s = slotAt(ev.clientX, ev.clientY);
      current = { slot: s.slot, marker: s.marker, x: ev.clientX, y: ev.clientY };
      setDrag({ ids, x: ev.clientX, y: ev.clientY, slot: s.slot, marker: s.marker });
    };
    const up = () => {
      window.removeEventListener('pointermove', moveH);
      window.removeEventListener('pointerup', up);
      cancelAnimationFrame(autoScroll);
      if (dragging && current.slot >= 0) move(history, ids, current.slot);
      setDrag(null);
    };
    window.addEventListener('pointermove', moveH);
    window.addEventListener('pointerup', up);
  };

  const insertAt = () => {
    const last = doc.pages.reduce((m, p, i) => (selected.has(p.id) ? i : m), -1);
    return last >= 0 ? last + 1 : doc.pages.length;
  };

  return (
    <div className="pd-center">
      <div className="row" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)', flexWrap: 'wrap', gap: 6 }}>
        <span className="faint" style={{ fontSize: 12, minWidth: 110 }}>
          {selection.length ? t('{count} page(s) selected', { count: selection.length }) : t('{count} pages', { count: doc.pages.length })}
        </span>
        <IconButton icon={RotateCcw} label={t('Rotate counter-clockwise')} disabled={!targets.length} onClick={() => rotate(history, targets, -90)} />
        <IconButton icon={RotateCw} label={t('Rotate clockwise')} disabled={!targets.length} onClick={() => rotate(history, targets, 90)} />
        <IconButton icon={Copy} label={t('Duplicate')} disabled={!targets.length} onClick={() => duplicate(history, targets)} />
        <IconButton icon={Trash2} label={t('Delete')} disabled={!targets.length || targets.length >= doc.pages.length} onClick={() => void remove(history, targets)} />
        <span className="vsep" />
        <Button size="sm" icon={FilePlus} onClick={() => void insertBlank(history, insertAt())}>
          {t('Blank page')}
        </Button>
        <Button size="sm" icon={FileInput} onClick={() => void pickAndInsert(history, insertAt())}>
          {t('Insert file…')}
        </Button>
        <Button size="sm" icon={Images} onClick={() => set({ dialog: 'insert-images' })}>
          {t('Insert images…')}
        </Button>
        <span className="vsep" />
        <Button size="sm" icon={FileOutput} disabled={!targets.length} onClick={() => void extractToFile(history, targets)}>
          {t('Extract')}
        </Button>
        <Button size="sm" icon={Scissors} disabled={doc.pages.length < 2} onClick={() => set({ dialog: 'split' })}>
          {t('Split…')}
        </Button>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => set({ pageSelection: selection.length === doc.pages.length ? [] : doc.pages.map((p) => p.id) })}>
          {selection.length === doc.pages.length ? t('Select none') : t('Select all')}
        </Button>
        <div style={{ width: 110 }}>
          <Slider value={thumbW} min={90} max={320} step={10} onChange={setThumbW} />
        </div>
      </div>
      <div
        ref={scrollRef}
        className="pd-organize"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || e.target === gridRef.current) set({ pageSelection: [] });
        }}
      >
        <div ref={gridRef} className="pd-org-grid" style={{ position: 'relative', ['--pd-thumb-w' as string]: `${thumbW + 20}px` }}>
          {doc.pages.map((p, i) => (
            <div
              key={p.id}
              data-org-index={i}
              className={`pd-org-item ${selected.has(p.id) ? 'selected' : ''} ${drag?.ids.includes(p.id) ? 'dragging' : ''}`}
              onPointerDown={(e) => onItemPointerDown(e, p.id)}
              onDoubleClick={() => {
                set({ mode: 'view' });
                usePdfUi.getState().goToPage(i);
              }}
              title={t('Double-click to open this page')}
            >
              <PageThumb entry={p} width={thumbW} annots={byPage.get(p.id) ?? []} />
              <span>{i + 1}</span>
              <div className="pd-org-actions">
                <IconButton icon={RotateCcw} size="sm" label={t('Rotate counter-clockwise')} onClick={() => rotate(history, [p.id], -90)} />
                <IconButton icon={RotateCw} size="sm" label={t('Rotate clockwise')} onClick={() => rotate(history, [p.id], 90)} />
                <IconButton icon={Trash2} size="sm" label={t('Delete')} disabled={doc.pages.length < 2} onClick={() => void remove(history, [p.id], false)} />
              </div>
            </div>
          ))}
          {drag?.marker && <div className="pd-drop-marker" style={{ left: drag.marker.left + 6, top: drag.marker.top, height: drag.marker.height }} />}
        </div>
      </div>
      {drag && (
        <div className="pd-org-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
          {t('{count} page(s)', { count: drag.ids.length })}
        </div>
      )}
    </div>
  );
}
