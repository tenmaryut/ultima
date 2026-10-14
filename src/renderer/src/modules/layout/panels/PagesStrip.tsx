import { useMemo, useState } from 'react';
import { Copy, FilePlus, LayoutTemplate, Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { IconButton, useContextMenu } from '../../../components/ui';
import { spreads } from '../canvas/world';
import { pageGeometry } from '../ops';
import { PageView } from '../PageView';
import { MASTER_ID } from '../types';
import type { LayoutEditor } from '../useLayoutEditor';

const THUMB_H = 92;

/** Bottom strip: master page + page thumbnails (live), add/duplicate/delete, drag to reorder. */
export function PagesStrip({ ed }: { ed: LayoutEditor }) {
  const t = useT();
  const doc = ed.doc;
  const ctx = useContextMenu();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const groups = useMemo(() => spreads(doc), [doc]);
  const master = pageGeometry(doc, MASTER_ID);

  const thumb = (index: number) => {
    const p = doc.pages[index];
    const scale = THUMB_H / p.height;
    const w = Math.max(24, p.width * scale);
    return (
      <div
        key={p.id}
        className={`ly-thumb ${ed.pageId === p.id ? 'current' : ''} ${over === index && drag !== null && drag !== index ? 'drop' : ''}`}
        draggable
        onDragStart={(e) => {
          setDrag(index);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/x-ultima-page', String(index));
        }}
        onDragOver={(e) => {
          if (drag === null) return;
          e.preventDefault();
          setOver(index);
        }}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drag !== null && drag !== index) ed.movePage(drag, index);
          setDrag(null);
          setOver(null);
        }}
        onClick={() => ed.goToPage(p.id)}
        onContextMenu={ctx.open(() => [
          { label: t('Go to page'), onClick: () => ed.goToPage(p.id) },
          { label: t('Insert page after'), icon: FilePlus, onClick: () => ed.addPage(false, index) },
          { label: t('Duplicate page'), icon: Copy, onClick: () => ed.addPage(true, index) },
          { type: 'separator' },
          { label: t('Move left'), disabled: index === 0, onClick: () => ed.movePage(index, index - 1) },
          { label: t('Move right'), disabled: index === doc.pages.length - 1, onClick: () => ed.movePage(index, index + 1) },
          { type: 'separator' },
          { label: t('Delete page'), icon: Trash2, disabled: doc.pages.length <= 1, onClick: () => ed.deletePage(index) },
        ])}
        title={t('Page {n}', { n: index + 1 })}
      >
        <div className="ly-thumb-page" style={{ width: w, height: THUMB_H }}>
          <PageView doc={doc} page={p} pageIndex={index} flows={ed.flows} idPrefix={`t${index}`} scale={scale} />
        </div>
        <span className="ly-thumb-label">{index + 1}</span>
      </div>
    );
  };

  return (
    <div className="ly-pages-strip">
      <div className="ly-strip-tools">
        <IconButton icon={FilePlus} label={t('Add page')} onClick={() => ed.addPage(false)} />
        <IconButton icon={Copy} label={t('Duplicate page')} onClick={() => ed.addPage(true)} disabled={ed.pageIndex < 0} />
        <IconButton icon={Trash2} label={t('Delete page')} onClick={() => ed.deletePage()} disabled={doc.pages.length <= 1 || ed.pageIndex < 0} />
      </div>
      <div className="ly-strip-scroll">
        <div
          className={`ly-thumb master ${ed.pageId === MASTER_ID ? 'current' : ''}`}
          onClick={() => ed.goToPage(MASTER_ID)}
          title={t('Master page: items repeated on every page (headers, footers, page numbers)')}
        >
          <div className="ly-thumb-page" style={{ width: Math.max(24, master.width * (THUMB_H / master.height)), height: THUMB_H }}>
            <PageView doc={doc} page={master} pageIndex={-1} idPrefix="tm" scale={THUMB_H / master.height} />
            <LayoutTemplate size={14} className="ly-thumb-badge" />
          </div>
          <span className="ly-thumb-label">{t('Master')}</span>
        </div>
        <div className="ly-strip-sep" />
        {groups.map((g) => (
          <div key={g.join('-')} className="ly-spread">
            {g.map(thumb)}
          </div>
        ))}
        <button type="button" className="ly-thumb-add" onClick={() => ed.addPage(false, doc.pages.length - 1)} title={t('Add page')}>
          <FilePlus size={18} />
        </button>
      </div>
      {ctx.element}
    </div>
  );
}
