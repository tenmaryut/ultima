/**
 * Status bar: page position, page size, zoom, selection and tool hint.
 */
import { useT } from '../../../core/i18n';
import { formatZoom } from '../../../core/viewport';
import { useDoc } from '../context';
import { engine } from '../engine';
import { usePdfUi } from '../store';
import { toolDef } from '../tools';

/** "210 × 297 mm (A4)" for a size in points. */
export function describePageSize(wPt: number, hPt: number): string {
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  const named: [string, number, number][] = [
    ['A3', 297, 420],
    ['A4', 210, 297],
    ['A5', 148, 210],
    ['Letter', 216, 279],
    ['Legal', 216, 356],
    ['Tabloid', 279, 432],
  ];
  const w = mm(wPt);
  const h = mm(hPt);
  const match = named.find(([, a, b]) => (Math.abs(a - w) <= 2 && Math.abs(b - h) <= 2) || (Math.abs(a - h) <= 2 && Math.abs(b - w) <= 2));
  return `${w} × ${h} mm${match ? ` (${match[0]}${w > h ? ', landscape' : ''})` : ''}`;
}

export function StatusBar() {
  const t = useT();
  const history = useDoc();
  const doc = history.present;
  const current = usePdfUi((s) => s.currentPage);
  const zoom = usePdfUi((s) => s.zoom);
  const selection = usePdfUi((s) => s.selection);
  const pageSelection = usePdfUi((s) => s.pageSelection);
  const mode = usePdfUi((s) => s.mode);
  const tool = usePdfUi((s) => s.tool);
  const pending = usePdfUi((s) => s.pending);
  const entry = doc.pages[current];
  const info = entry ? engine.info(entry) : undefined;
  let size = '';
  if (entry && info) {
    const w = (info.view[2] - info.view[0]) * info.userUnit;
    const h = (info.view[3] - info.view[1]) * info.userUnit;
    size = engine.rotation(entry) % 180 === 0 ? describePageSize(w, h) : describePageSize(h, w);
  }
  const def = toolDef(tool);
  return (
    <>
      <span>{t('Page {n} of {count}', { n: Math.min(current + 1, doc.pages.length), count: doc.pages.length })}</span>
      {size && <span>{size}</span>}
      {mode === 'view' && <span>{formatZoom(zoom)}</span>}
      {mode === 'view' && selection.length > 0 && <span>{t('{count} object(s) selected', { count: selection.length })}</span>}
      {mode === 'organize' && pageSelection.length > 0 && <span>{t('{count} page(s) selected', { count: pageSelection.length })}</span>}
      {doc.annots.length > 0 && <span className="faint">{t('{count} annotation(s)', { count: doc.annots.length })}</span>}
      <span className="spacer" />
      {mode === 'view' && def && tool !== 'select' && <span className="faint">{pending && (tool === 'image' || tool === 'signature') ? t('Click on a page to place it · Esc to cancel') : t(def.hint)}</span>}
    </>
  );
}
