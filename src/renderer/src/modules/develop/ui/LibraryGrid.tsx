import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ, Copy, FileWarning, ImageOff, Pencil, Search } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { useElementSize } from '../../../core/hooks';
import { IconButton, Select, Spinner } from '../../../components/ui';
import { isEdited } from '../params';
import { requestThumbs } from '../library';
import { getVisible, selectPhoto, setActive, setFilter, setRating, setStore, setView, useDevelop } from '../store';
import { filterActive, LABEL_COLORS, LABELS, displayName, type LabelFilter, type FlagFilter, type Photo, type SortKey } from '../types';
import { FlagIcon, LABEL_NAMES, Stars } from './common';

export function useVisiblePhotos(): Photo[] {
  const photos = useDevelop((s) => s.photos);
  const order = useDevelop((s) => s.order);
  const filter = useDevelop((s) => s.filter);
  const sort = useDevelop((s) => s.sort);
  const sortDesc = useDevelop((s) => s.sortDesc);
  return useMemo(() => getVisible({ ...useDevelop.getState(), photos, order, filter, sort, sortDesc }), [photos, order, filter, sort, sortDesc]);
}

export function ThumbImage({ photo }: { photo: Photo }) {
  const t = useT();
  const url = photo.devThumb ?? photo.thumb;
  if (url) return <img src={url} alt="" draggable={false} />;
  if (photo.kind === 'missing')
    return (
      <div className="dv-thumb-placeholder">
        <FileWarning size={18} />
        <span>{t('Missing')}</span>
      </div>
    );
  if (photo.thumbState === 'error' || photo.kind === 'unsupported')
    return (
      <div className="dv-thumb-placeholder" title={photo.error}>
        <ImageOff size={18} />
        <span>{photo.kind === 'unsupported' ? t('Not supported') : t('Error')}</span>
      </div>
    );
  return (
    <div className="dv-thumb-placeholder">
      <Spinner size={14} />
    </div>
  );
}

const Cell = memo(function Cell({
  photo,
  selected,
  active,
  style,
  onMenu,
}: {
  photo: Photo;
  selected: boolean;
  active: boolean;
  style: React.CSSProperties;
  onMenu: (e: React.MouseEvent, id: string) => void;
}) {
  const t = useT();
  const edited = isEdited(photo.settings);
  return (
    <div
      className={`dv-cell ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${photo.flag === 'reject' ? 'rejected' : ''}`}
      style={style}
      data-id={photo.id}
      role="gridcell"
      aria-selected={selected}
      title={photo.error ?? photo.note ?? displayName(photo)}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        selectPhoto(photo.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single');
      }}
      onDoubleClick={() => {
        setActive(photo.id);
        setView('develop');
      }}
      onContextMenu={(e) => {
        if (!useDevelop.getState().selected.includes(photo.id)) selectPhoto(photo.id, 'single');
        onMenu(e, photo.id);
      }}
    >
      <div className="dv-thumb">
        <ThumbImage photo={photo} />
        <div className="dv-cell-badges">
          {photo.kind === 'raw' && <span className="dv-badge warn">RAW</span>}
          {photo.kind === 'tiff' && <span className="dv-badge">TIFF</span>}
          {photo.kind === 'missing' && <span className="dv-badge err">{t('Missing')}</span>}
          {photo.copyIndex > 0 && (
            <span className="dv-badge" title={t('Virtual copy')}>
              <Copy size={9} /> {photo.copyIndex}
            </span>
          )}
          <span className="spacer" />
          {edited && (
            <span className="dv-badge ok" title={t('Edited')}>
              <Pencil size={9} />
            </span>
          )}
        </div>
      </div>
      <div className="dv-cell-meta">
        {photo.label && <span className="dv-label-stripe" style={{ background: LABEL_COLORS[photo.label] }} />}
        <span className="dv-cell-name">{displayName(photo)}</span>
        <FlagIcon flag={photo.flag} />
        <span onMouseDown={(e) => e.stopPropagation()}>
          <Stars value={photo.rating} size={10} onChange={(v) => setRating([photo.id], v)} />
        </span>
      </div>
    </div>
  );
});

function FilterBar({ shown, total }: { shown: number; total: number }) {
  const t = useT();
  const filter = useDevelop((s) => s.filter);
  const sort = useDevelop((s) => s.sort);
  const sortDesc = useDevelop((s) => s.sortDesc);
  const thumbSize = useDevelop((s) => s.thumbSize);
  const ratingValue = filter.ratingOp === '=' && filter.rating === 0 ? 'unrated' : filter.ratingOp === '>=' ? String(filter.rating) : `eq${filter.rating}`;
  return (
    <div className="dv-filterbar">
      <span className="dv-group" style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 7, color: 'var(--text-3)', pointerEvents: 'none' }} />
        <input
          className="input"
          style={{ width: 150, paddingLeft: 24 }}
          placeholder={t('Search name, camera…')}
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
          aria-label={t('Search')}
        />
      </span>
      <Select
        small
        aria-label={t('Rating filter')}
        value={ratingValue}
        onChange={(v) => {
          if (v === 'unrated') setFilter({ rating: 0, ratingOp: '=' });
          else if (v.startsWith('eq')) setFilter({ rating: Number(v.slice(2)), ratingOp: '=' });
          else setFilter({ rating: Number(v), ratingOp: '>=' });
        }}
        options={[
          { value: '0', label: t('Any rating') },
          ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `≥ ${'★'.repeat(n)}` })),
          { value: 'eq5', label: `= ★★★★★` },
          { value: 'unrated', label: t('Unrated') },
        ]}
        style={{ width: 120 }}
      />
      <Select<FlagFilter>
        small
        aria-label={t('Flag filter')}
        value={filter.flag}
        onChange={(v) => setFilter({ flag: v })}
        options={[
          { value: 'all', label: t('All flags') },
          { value: 'picked', label: t('Picked') },
          { value: 'unflagged', label: t('Unflagged') },
          { value: 'notRejected', label: t('Not rejected') },
          { value: 'rejected', label: t('Rejected') },
        ]}
        style={{ width: 118 }}
      />
      <Select<LabelFilter>
        small
        aria-label={t('Color label filter')}
        value={filter.label}
        onChange={(v) => setFilter({ label: v })}
        options={[{ value: 'any', label: t('Any label') }, { value: 'none', label: t('No label') }, ...LABELS.map((l) => ({ value: l, label: t(LABEL_NAMES[l]) }))]}
        style={{ width: 110 }}
      />
      <Select
        small
        aria-label={t('Edited filter')}
        value={filter.edited}
        onChange={(v) => setFilter({ edited: v as 'all' | 'edited' | 'unedited' })}
        options={[
          { value: 'all', label: t('Edited & unedited') },
          { value: 'edited', label: t('Edited') },
          { value: 'unedited', label: t('Unedited') },
        ]}
        style={{ width: 140 }}
      />
      <span className="spacer" />
      <span className="dv-group">
        <span className="muted">{t('Sort')}</span>
        <Select<SortKey>
          small
          value={sort}
          onChange={(v) => setStore({ sort: v })}
          options={[
            { value: 'name', label: t('File name') },
            { value: 'date', label: t('Capture date') },
            { value: 'rating', label: t('Rating') },
            { value: 'added', label: t('Import order') },
            { value: 'size', label: t('File size') },
          ]}
          style={{ width: 120 }}
        />
        <IconButton icon={sortDesc ? ArrowUpAZ : ArrowDownAZ} size="sm" label={sortDesc ? t('Descending') : t('Ascending')} onClick={() => setStore({ sortDesc: !sortDesc })} />
      </span>
      <input
        type="range"
        className="dv-range"
        style={{ width: 90 }}
        min={110}
        max={300}
        value={thumbSize}
        aria-label={t('Thumbnail size')}
        title={t('Thumbnail size')}
        onChange={(e) => setStore({ thumbSize: Number(e.target.value) })}
      />
      <span className="dv-count">
        {filterActive(filter) ? t('{shown} of {total}', { shown, total }) : t('{count} photos', { count: total })}
      </span>
    </div>
  );
}

const GAP = 8;
const PAD = 10;

export function LibraryGrid({ onMenu }: { onMenu: (e: React.MouseEvent, id: string) => void }) {
  const visible = useVisiblePhotos();
  const total = useDevelop((s) => s.order.length);
  const selected = useDevelop((s) => s.selected);
  const activeId = useDevelop((s) => s.activeId);
  const thumbSize = useDevelop((s) => s.thumbSize);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(scrollRef);
  const [scrollTop, setScrollTop] = useState(0);
  const cellW = thumbSize;
  const cellH = thumbSize + 24;
  const cols = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (cellW + GAP)));
  const rows = Math.ceil(visible.length / cols);
  const totalH = rows * (cellH + GAP) + PAD * 2;
  const first = Math.max(0, Math.floor((scrollTop - PAD) / (cellH + GAP)) - 2);
  const last = Math.min(rows - 1, Math.ceil((scrollTop + height) / (cellH + GAP)) + 2);
  const range = visible.slice(first * cols, (last + 1) * cols);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const extraX = Math.max(0, (width - PAD * 2 - (cols * (cellW + GAP) - GAP)) / 2);

  const rangeKey = range.map((p) => p.id).join(',');
  useEffect(() => {
    requestThumbs(range.map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  // keep the active photo visible (keyboard navigation)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeId) return;
    const idx = visible.findIndex((p) => p.id === activeId);
    if (idx < 0) return;
    const top = PAD + Math.floor(idx / cols) * (cellH + GAP);
    if (top < el.scrollTop) el.scrollTop = top - PAD;
    else if (top + cellH > el.scrollTop + el.clientHeight) el.scrollTop = top + cellH - el.clientHeight + PAD;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, cols]);

  return (
    <>
      <FilterBar shown={visible.length} total={total} />
      <div
        ref={scrollRef}
        className="dv-grid-scroll"
        role="grid"
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setStore({ selected: activeId ? [activeId] : [] });
        }}
      >
        <div className="dv-grid-inner" style={{ height: totalH }}>
          {range.map((p, i) => {
            const index = first * cols + i;
            const r = Math.floor(index / cols);
            const c = index % cols;
            return (
              <Cell
                key={p.id}
                photo={p}
                selected={selectedSet.has(p.id)}
                active={p.id === activeId}
                onMenu={onMenu}
                style={{ left: PAD + extraX + c * (cellW + GAP), top: PAD + r * (cellH + GAP), width: cellW, height: cellH }}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Number of grid columns (for Up/Down keyboard navigation). */
export function gridColumns(): number {
  const el = document.querySelector('.dv-grid-scroll') as HTMLElement | null;
  const size = useDevelop.getState().thumbSize;
  if (!el) return 1;
  return Math.max(1, Math.floor((el.clientWidth - PAD * 2 + GAP) / (size + GAP)));
}
