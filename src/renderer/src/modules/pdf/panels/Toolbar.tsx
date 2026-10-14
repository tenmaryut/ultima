/**
 * Header toolbar: view/organize switch, page navigation, zoom, rotate view, find.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, PanelLeft, RotateCcw, RotateCw, Search, ZoomIn, ZoomOut, BookOpen } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { formatZoom } from '../../../core/viewport';
import { DropdownButton, IconButton, Segmented } from '../../../components/ui';
import { useDoc } from '../context';
import { usePdfUi } from '../store';
import { goRelative, openFind, rotateView, setZoom, setZoomMode, zoomBy } from '../viewActions';

function PageInput({ count }: { count: number }) {
  const t = useT();
  const current = usePdfUi((s) => s.currentPage);
  const [text, setText] = useState(String(current + 1));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(current + 1));
  }, [current, focused]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isFinite(n) && n >= 1 && n <= count) usePdfUi.getState().goToPage(n - 1);
    else setText(String(current + 1));
  };
  return (
    <span className="row" style={{ gap: 4, whiteSpace: 'nowrap' }}>
      <input
        className="input sm"
        style={{ width: 46, textAlign: 'center' }}
        aria-label={t('Page number')}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="faint">/ {count}</span>
    </span>
  );
}

export function Toolbar() {
  const t = useT();
  const history = useDoc();
  const count = history.present.pages.length;
  const mode = usePdfUi((s) => s.mode);
  const zoom = usePdfUi((s) => s.zoom);
  const zoomMode = usePdfUi((s) => s.zoomMode);
  const leftPanel = usePdfUi((s) => s.leftPanel);
  const set = usePdfUi((s) => s.set);
  if (!count) return null;
  return (
    <>
      <Segmented
        value={mode}
        onChange={(v) => set({ mode: v, selection: [], editing: null })}
        options={[
          { value: 'view', label: t('View & Edit'), icon: BookOpen },
          { value: 'organize', label: t('Organize'), icon: LayoutGrid },
        ]}
      />
      <span className="vsep" />
      {mode === 'view' && (
        <>
          <IconButton icon={PanelLeft} label={t('Show page thumbnails')} active={!!leftPanel} onClick={() => set({ leftPanel: leftPanel ? null : 'thumbs' })} />
          <IconButton icon={ChevronLeft} label={`${t('Previous page')} (PgUp)`} onClick={() => goRelative(-1, count)} />
          <PageInput count={count} />
          <IconButton icon={ChevronRight} label={`${t('Next page')} (PgDn)`} onClick={() => goRelative(1, count)} />
          <span className="vsep" />
          <IconButton icon={ZoomOut} label={t('Zoom out')} onClick={() => zoomBy(-1)} />
          <DropdownButton
            className="btn sm"
            title={t('Zoom')}
            entries={[
              { label: t('Fit width'), checked: zoomMode === 'fit-width', onClick: () => setZoomMode('fit-width') },
              { label: t('Fit page'), checked: zoomMode === 'fit-page', onClick: () => setZoomMode('fit-page') },
              { type: 'separator' },
              ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => ({ label: `${Math.round(z * 100)}%`, checked: zoomMode === 'custom' && Math.abs(zoom - z) < 0.001, onClick: () => setZoom(z) })),
            ]}
          >
            <span style={{ minWidth: 40, display: 'inline-block', textAlign: 'center' }}>{formatZoom(zoom)}</span>
          </DropdownButton>
          <IconButton icon={ZoomIn} label={t('Zoom in')} onClick={() => zoomBy(1)} />
          <span className="vsep" />
          <IconButton icon={RotateCcw} label={t('Rotate view counter-clockwise')} onClick={() => rotateView(-90)} />
          <IconButton icon={RotateCw} label={t('Rotate view clockwise')} onClick={() => rotateView(90)} />
          <IconButton icon={Search} label={`${t('Find')} (Ctrl+F)`} onClick={openFind} />
        </>
      )}
    </>
  );
}
