import { useEffect, useMemo, useRef } from 'react';
import { useT } from '../../../core/i18n';
import { requestThumbs } from '../library';
import { selectPhoto, useDevelop } from '../store';
import { displayName } from '../types';
import { ThumbImage, useVisiblePhotos } from './LibraryGrid';

export function Filmstrip({ onMenu }: { onMenu: (e: React.MouseEvent, id: string) => void }) {
  const t = useT();
  const visible = useVisiblePhotos();
  const selected = useDevelop((s) => s.selected);
  const activeId = useDevelop((s) => s.activeId);
  const ref = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // thumbnails around the active photo first
  const ids = visible.map((p) => p.id).join(',');
  useEffect(() => {
    const idx = Math.max(0, visible.findIndex((p) => p.id === activeId));
    const near = visible.slice(Math.max(0, idx - 15), idx + 25).map((p) => p.id);
    requestThumbs(near);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, activeId]);

  useEffect(() => {
    const el = ref.current?.querySelector(`[data-id="${activeId}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  if (!visible.length) return <div className="dv-center-msg">{t('No photos match the filter.')}</div>;
  return (
    <div
      className="dv-film"
      ref={ref}
      onWheel={(e) => {
        if (ref.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY;
      }}
    >
      {visible.map((p) => (
        <div
          key={p.id}
          data-id={p.id}
          className={`dv-film-item ${selectedSet.has(p.id) ? 'selected' : ''} ${p.id === activeId ? 'active' : ''}`}
          title={displayName(p)}
          onMouseDown={(e) => e.button === 0 && selectPhoto(p.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single')}
          onContextMenu={(e) => {
            if (!useDevelop.getState().selected.includes(p.id)) selectPhoto(p.id, 'single');
            onMenu(e, p.id);
          }}
        >
          <ThumbImage photo={p} />
          {p.rating > 0 && <span className="dv-film-stars">{'★'.repeat(p.rating)}</span>}
        </div>
      ))}
    </div>
  );
}
