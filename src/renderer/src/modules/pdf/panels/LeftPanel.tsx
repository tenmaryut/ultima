/**
 * Left side: tool palette, page thumbnails and bookmarks (outline).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, ExternalLink, FileOutput, FilePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { openExternal } from '../../../core/platform';
import { Tabs, ToolButton, useContextMenu } from '../../../components/ui';
import { useDoc } from '../context';
import { usePdfUi } from '../store';
import { selectTool, TOOL_GROUPS } from '../tools';
import { duplicate, extractToFile, insertBlank, remove, rotate } from '../pageActions';
import type { Annot, OutlineNode } from '../types';
import { PageThumb } from './PageThumb';

export function ToolPalette() {
  const t = useT();
  const tool = usePdfUi((s) => s.tool);
  return (
    <div className="pd-tools" role="toolbar" aria-label={t('Tools')}>
      {TOOL_GROUPS.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <div className="tool-sep" />}
          {group.map((d) => (
            <ToolButton key={d.id} icon={d.icon} label={t(d.label)} shortcut={d.key} active={tool === d.id} onClick={() => void selectTool(d.id)} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function Thumbnails() {
  const t = useT();
  const history = useDoc();
  const doc = history.present;
  const current = usePdfUi((s) => s.currentPage);
  const viewRotation = usePdfUi((s) => s.viewRotation);
  const goToPage = usePdfUi((s) => s.goToPage);
  const listRef = useRef<HTMLDivElement>(null);
  const ctx = useContextMenu();
  const byPage = useMemo(() => {
    const map = new Map<string, Annot[]>();
    for (const a of doc.annots) map.set(a.page, [...(map.get(a.page) ?? []), a]);
    return map;
  }, [doc.annots]);

  // keep the current page's thumbnail in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb-index="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return (
    <div className="pd-thumbs" ref={listRef}>
      {doc.pages.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className={`pd-thumb ${i === current ? 'current' : ''}`}
          data-thumb-index={i}
          aria-label={t('Page {n}', { n: i + 1 })}
          onClick={() => goToPage(i)}
          onContextMenu={ctx.open(() => [
            { label: t('Rotate clockwise'), icon: RotateCw, onClick: () => rotate(history, [p.id], 90) },
            { label: t('Rotate counter-clockwise'), icon: RotateCcw, onClick: () => rotate(history, [p.id], -90) },
            { label: t('Duplicate page'), icon: Copy, onClick: () => duplicate(history, [p.id]) },
            { label: t('Insert blank page after'), icon: FilePlus, onClick: () => void insertBlank(history, i + 1) },
            { label: t('Extract page…'), icon: FileOutput, onClick: () => void extractToFile(history, [p.id]) },
            { type: 'separator' },
            { label: t('Delete page'), icon: Trash2, disabled: doc.pages.length < 2, onClick: () => void remove(history, [p.id]) },
          ])}
        >
          <PageThumb entry={p} width={120} annots={byPage.get(p.id) ?? []} viewRotation={viewRotation} />
          <span>{i + 1}</span>
        </button>
      ))}
      {ctx.element}
    </div>
  );
}

function OutlineTree({ nodes, depth }: { nodes: OutlineNode[]; depth: number }) {
  const t = useT();
  const history = useDoc();
  const mainSrc = usePdfUi((s) => s.docInfo?.mainSrc);
  const goToPage = usePdfUi((s) => s.goToPage);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const go = (node: OutlineNode) => {
    if (node.url) {
      openExternal(node.url);
      return;
    }
    if (node.srcIndex === null) return;
    const index = history.present.pages.findIndex((p) => p.src === mainSrc && p.index === node.srcIndex);
    if (index >= 0) goToPage(index);
  };
  return (
    <>
      {nodes.map((node, i) => {
        const expanded = open[i] ?? depth === 0;
        return (
          <Fragment key={i}>
            <div className="pd-outline-item" style={{ paddingLeft: 4 + depth * 12 }} onClick={() => go(node)} title={node.title}>
              {node.items.length ? (
                <button
                  type="button"
                  className="pd-outline-toggle"
                  aria-label={expanded ? t('Collapse') : t('Expand')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen((o) => ({ ...o, [i]: !expanded }));
                  }}
                >
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : (
                <span className="pd-outline-toggle" />
              )}
              <span style={{ fontWeight: node.bold ? 700 : undefined, fontStyle: node.italic ? 'italic' : undefined }}>{node.title}</span>
              {node.url && <ExternalLink size={11} style={{ flex: '0 0 auto', marginTop: 3 }} />}
            </div>
            {expanded && node.items.length > 0 && <OutlineTree nodes={node.items} depth={depth + 1} />}
          </Fragment>
        );
      })}
    </>
  );
}

export function LeftPanel() {
  const t = useT();
  const panel = usePdfUi((s) => s.leftPanel);
  const mode = usePdfUi((s) => s.mode);
  const outline = usePdfUi((s) => s.docInfo?.outline ?? []);
  const hasDoc = usePdfUi((s) => !!s.docInfo);
  return (
    <div className="pd-left">
      <ToolPalette />
      {panel && hasDoc && mode === 'view' && (
        <div className="pd-side">
          <Tabs
            value={panel}
            onChange={(v) => usePdfUi.getState().set({ leftPanel: v })}
            tabs={[
              { value: 'thumbs', label: t('Pages') },
              { value: 'outline', label: t('Bookmarks') },
            ]}
          />
          {panel === 'thumbs' ? (
            <Thumbnails />
          ) : (
            <div className="pd-outline">{outline.length ? <OutlineTree nodes={outline} depth={0} /> : <div className="faint" style={{ padding: 10, fontSize: 12 }}>{t('This document has no bookmarks.')}</div>}</div>
          )}
        </div>
      )}
    </div>
  );
}
