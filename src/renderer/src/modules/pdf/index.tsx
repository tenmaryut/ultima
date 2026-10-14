import './i18n';
import './pdf.css';
import { useEffect, useRef } from 'react';
import { Combine, Download, FilePlus, FileText, FolderOpen, Images, Save } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import type { ModuleHandoff } from '../../core/store';
import { useT } from '../../core/i18n';
import { useHistoryState, type HistoryState } from '../../core/history';
import { useFileDrop, useHandoffs } from '../../core/hooks';
import { useModuleCommands, useModuleKeydown } from '../../core/commands';
import { setWindowTitle } from '../../core/platform';
import { dataUrlToBlob } from '../../core/utils/base64';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { Button, DropdownButton, DropOverlay, ProgressBar, Spinner, toast } from '../../components/ui';
import { sanitizeSvg } from '../../core/ai/sanitize';
import { DocContext } from './context';
import { EMPTY_DOC, type DocState } from './types';
import { usePdfUi } from './store';
import { Viewer } from './viewer/Viewer';
import { LeftPanel } from './panels/LeftPanel';
import { Toolbar } from './panels/Toolbar';
import { RightPanel } from './panels/RightPanel';
import { StatusBar } from './panels/StatusBar';
import { OrganizeView } from './organize/OrganizeView';
import { PdfDialogHost } from './dialogs/PdfDialogHost';
import { DialogsHost } from './dialogs/DialogsHost';
import { PdfAssistant } from './ai/PdfAssistant';
import { buildMenus, exportEntries, pickAndOpen } from './menus';
import { isDirty, isProjectJson, newBlankDocument, openFiles, openText, restoreProject, savePdf } from './docActions';
import { deleteSelection, duplicateSelection, nudgeSelection, selectAllOnPage } from './editActions';
import { remove, targetPages } from './pageActions';
import { goRelative, openFind, setZoom, setZoomMode, zoomBy } from './viewActions';
import { ALL_TOOLS, selectTool } from './tools';
import { stepMatch } from './viewer/FindBar';

export default function PdfModule({ active }: ModuleProps) {
  const t = useT();
  const history = useHistoryState<DocState>(EMPTY_DOC);
  const doc = history.present;
  const rootRef = useRef<HTMLDivElement>(null);
  const docInfo = usePdfUi((s) => s.docInfo);
  const mode = usePdfUi((s) => s.mode);
  const busy = usePdfUi((s) => s.busy);
  const hasDoc = doc.pages.length > 0;
  const historyRef = useRef(history);
  historyRef.current = history;

  const dragging = useFileDrop(rootRef, (files) => void openFiles(files, historyRef.current), active);

  useHandoffs('pdf', (items) => void receiveHandoffs(items));

  async function receiveHandoffs(items: ModuleHandoff[]) {
    const h = historyRef.current;
    for (const item of items) {
      try {
        if (item.kind === 'files' && item.files?.length) await openFiles(item.files, h);
        else if (item.kind === 'image' && item.image) {
          const blob = item.image.startsWith('data:') ? dataUrlToBlob(item.image) : await (await fetch(item.image)).blob();
          const ext = blob.type.split('/')[1] || 'png';
          await openFiles([new File([blob], `${item.title || 'image'}.${ext}`, { type: blob.type })], h);
        } else if (item.kind === 'svg' && item.svg) {
          const clean = sanitizeSvg(item.svg);
          if (!clean) continue;
          const png = await svgToPng(clean);
          await openFiles([new File([png], `${item.title || 'graphic'}.png`, { type: 'image/png' })], h);
        } else if (item.kind === 'text' && item.text) await openText(item.text, item.title ?? '', h);
        else if (item.kind === 'json' && isProjectJson(item.json)) await restoreProject(item.json, h);
      } catch (error) {
        toast.error(t('Could not open file'), error instanceof Error ? error.message : String(error));
      }
    }
  }

  useEffect(() => {
    if (active) setWindowTitle(docInfo ? `${docInfo.name}${isDirty(doc) ? ' •' : ''} — Ultima` : 'Ultima');
  }, [active, docInfo, doc]);

  useModuleCommands('pdf', {
    new: () => void newBlankDocument(history),
    open: () => void pickAndOpen(history),
    save: () => (hasDoc ? void savePdf(history) : false),
    'save-as': () => (hasDoc ? void savePdf(history, true) : false),
    export: () => (hasDoc ? usePdfUi.getState().set({ dialog: 'export-images' }) : false),
    undo: () => history.undo(),
    redo: () => history.redo(),
    delete: () => {
      if (deleteSelection(history)) return;
      const ui = usePdfUi.getState();
      if (ui.mode === 'organize' && ui.pageSelection.length) void remove(history, targetPages(doc));
      else return false;
    },
    duplicate: () => {
      if (!duplicateSelection(history)) return false;
    },
    'select-all': () => {
      const ui = usePdfUi.getState();
      if (ui.mode === 'organize') ui.set({ pageSelection: doc.pages.map((p) => p.id) });
      else selectAllOnPage(history);
    },
    deselect: () => usePdfUi.getState().set({ selection: [], pageSelection: [] }),
    'zoom-in': () => zoomBy(1),
    'zoom-out': () => zoomBy(-1),
    'zoom-fit': () => setZoomMode('fit-width'),
    'zoom-100': () => setZoom(1),
  });

  // Ctrl/Cmd+F (find) and F3 work even while typing in the find field.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 'f' && historyRef.current.present.pages.length) {
        e.preventDefault();
        openFind();
      } else if (e.key === 'F3' || (mod && e.key.toLowerCase() === 'g')) {
        e.preventDefault();
        stepMatch(e.shiftKey ? -1 : 1, historyRef.current.present.pages);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useModuleKeydown(active, (e) => {
    if (!hasDoc || e.ctrlKey || e.metaKey || e.altKey) return;
    const ui = usePdfUi.getState();
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      goRelative(e.key === 'PageDown' ? 1 : -1, doc.pages.length);
      return;
    }
    if ((e.key === 'Home' || e.key === 'End') && ui.mode === 'view') {
      e.preventDefault();
      ui.goToPage(e.key === 'Home' ? 0 : doc.pages.length - 1);
      return;
    }
    if (e.key === 'Escape') {
      if (ui.selection.length || ui.pending || ui.tool !== 'select') ui.set({ selection: [], pending: null, tool: 'select', editing: null });
      else if (ui.find.open) ui.setFind({ open: false, matches: [] });
      return;
    }
    if (e.key.startsWith('Arrow') && ui.selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      nudgeSelection(history, dx, dy);
      return;
    }
    if (e.key === 'Enter' && ui.selection.length === 1) {
      const a = doc.annots.find((x) => x.id === ui.selection[0]);
      if (a && (a.type === 'text' || a.type === 'note')) {
        e.preventDefault();
        ui.set({ editing: a.id });
      }
      return;
    }
    if (e.key.length === 1 && !e.shiftKey && ui.mode === 'view') {
      const tool = ALL_TOOLS.find((d) => d.key?.toLowerCase() === e.key.toLowerCase());
      if (tool) {
        e.preventDefault();
        void selectTool(tool.id);
      }
    }
  });

  const menus = buildMenus(history);

  return (
    <DocContext.Provider value={history}>
      <div ref={rootRef} style={{ height: '100%' }}>
        <ModuleLayout
          moduleId="pdf"
          title={docInfo?.name}
          dirty={hasDoc && isDirty(doc)}
          menus={menus}
          toolbar={hasDoc ? <Toolbar /> : undefined}
          actions={
            hasDoc ? (
              <>
                <Button size="sm" variant="primary" icon={Save} onClick={() => void savePdf(history)}>
                  {t('Save')}
                </Button>
                <DropdownButton className="btn sm" title={t('Export')} entries={() => exportEntries(history)}>
                  <Download size={13} /> {t('Export')}
                </DropdownButton>
              </>
            ) : undefined
          }
          left={hasDoc && mode === 'view' ? <LeftPanel /> : undefined}
          right={hasDoc ? <RightPanel /> : undefined}
          ai={<PdfAssistant />}
          status={hasDoc ? <StatusBar /> : undefined}
        >
          <div className="pd-center">
            {!hasDoc ? (
              <EmptyPdf history={history} />
            ) : mode === 'organize' ? (
              <OrganizeView />
            ) : (
              <Viewer active={active} />
            )}
            {busy && (
              <div className="pd-busy" role="status">
                <div className="row">
                  <Spinner size={14} />
                  <span>{busy.label}</span>
                </div>
                {busy.progress !== null && <ProgressBar value={busy.progress} />}
              </div>
            )}
            <DropOverlay show={dragging} label={hasDoc ? t('Drop PDFs or images to add or open them') : t('Drop PDFs or images to open them')} />
          </div>
        </ModuleLayout>
      </div>
      <PdfDialogHost />
      <DialogsHost />
    </DocContext.Provider>
  );

}

function EmptyPdf({ history }: { history: HistoryState<DocState> }) {
  const t = useT();
  return (
    <div className="pd-empty">
      <div className="pd-empty-card">
        <FileText size={44} color="var(--accent)" />
        <h2>{t('PDF Studio')}</h2>
        <div>{t('Open a PDF to read, annotate, sign, fill forms, organize pages or ask the AI about it. You can also drop files here.')}</div>
        <div className="pd-empty-actions">
          <button type="button" className="pd-choice primary" onClick={() => void pickAndOpen(history)}>
            <FolderOpen size={18} />
            <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
              <strong>{t('Open PDF…')}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{t('PDF, images or .ultima project')}</span>
            </span>
          </button>
          <button type="button" className="pd-choice" onClick={() => void pickAndOpen(history)}>
            <Combine size={18} />
            <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
              <strong>{t('Combine files…')}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{t('Merge several PDFs and images')}</span>
            </span>
          </button>
          <button type="button" className="pd-choice" onClick={() => usePdfUi.getState().set({ dialog: 'images' })}>
            <Images size={18} />
            <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
              <strong>{t('Images to PDF…')}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{t('A4, Letter or the size of each image')}</span>
            </span>
          </button>
          <button type="button" className="pd-choice" onClick={() => void newBlankDocument(history)}>
            <FilePlus size={18} />
            <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
              <strong>{t('New blank PDF')}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{t('Start from an empty A4 page')}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

async function svgToPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not read the SVG'));
      img.src = url;
    });
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    const scale = Math.min(4, 2048 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
