import './i18n';
import './vector.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Minus, Plus } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel } from '../../components/ai/AIAssistantPanel';
import { Button, DropOverlay, IconButton, Panel, Tabs, toast, useContextMenu } from '../../components/ui';
import { localizeDefaultName, useT, t as tt } from '../../core/i18n';
import { isEditableTarget, useModuleCommands, useModuleKeydown } from '../../core/commands';
import { useHistoryState } from '../../core/history';
import { useFileDrop, useHandoffs } from '../../core/hooks';
import { listSystemFonts } from '../../core/platform';
import { applyAIActions, buildContext, VECTOR_AI_INSTRUCTIONS } from './ai';
import { GenerateArtworkDialog, LogoIdeasDialog, RecolorDialog, nameLayersWithAI } from './aiFeatures';
import { editActions } from './actions';
import { Canvas } from './canvas/Canvas';
import { Toolbox, ToolOptionsBar } from './chrome';
import { ExportDialog, NewDocumentDialog } from './dialogs';
import { DEFAULT_TOOL_OPTIONS, DEFAULT_VIEW_OPTIONS, EditorContext, type EditorCore, type FileInfo, type ToolId, type ToolOptions, type ViewOptions } from './editor';
import { fileActions } from './fileActions';
import { selectionBounds } from './geometry';
import { unionRects, type Pt } from './matrix';
import { buildMenus, contextEntries, type MenuHandlers } from './menus';
import { allIds, createDocument, DEFAULT_STYLE, type Style, type VDoc } from './model';
import { hitTest } from './geometry';
import { ArtboardsPanel } from './panels/ArtboardsPanel';
import { LayersPanel } from './panels/LayersPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { SwatchesPanel } from './panels/SwatchesPanel';
import { installCanvasMeasurer } from './measure';
import { formatZoom, useVectorViewport } from './viewport';
import type { PenController } from './tools/pen';

installCanvasMeasurer();

const FALLBACK_FONTS = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'system-ui', 'serif', 'sans-serif', 'monospace'];
const TOOL_KEYS: Record<string, ToolId> = { v: 'select', a: 'direct', p: 'pen', n: 'pencil', m: 'rect', l: 'ellipse', '\\': 'line', t: 'text', i: 'eyedropper', h: 'hand', z: 'zoom' };

type Dialog = 'new' | 'export' | 'generate' | 'logos' | 'recolor' | null;
type SideTab = 'layers' | 'swatches' | 'artboards';

export default function VectorModule({ active }: ModuleProps) {
  const t = useT();
  const history = useHistoryState<VDoc>(() => createDocument(1080, 1080, '#ffffff'));
  const doc = history.present;
  const [selection, setSelection] = useState<string[]>([]);
  const [nodeSel, setNodeSel] = useState<string[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  const [tool, setToolState] = useState<ToolId>('select');
  const [options, setOptionsState] = useState<ToolOptions>(DEFAULT_TOOL_OPTIONS);
  const [viewOpts, setViewOptsState] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [paintTarget, setPaintTarget] = useState<'fill' | 'stroke'>('fill');
  const [editingText, setEditingText] = useState<string | null>(null);
  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS);
  const [file, setFile] = useState<FileInfo>({ savedDoc: null });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sideTab, setSideTab] = useState<SideTab>('layers');
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [fitToken, setFitToken] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const penRef = useRef<PenController | null>(null);
  const dropPoint = useRef<Pt | null>(null);
  const fontsLoaded = useRef(false);
  const ctxMenu = useContextMenu();
  const viewport = useVectorViewport(containerRef, active);
  const activeArtboard = doc.artboards.find((a) => a.id === doc.activeArtboard) ?? doc.artboards[0];

  const core: EditorCore = {
    history,
    doc,
    update: (fn, label = 'Edit') => history.set((d) => fn(d), { label }),
    updateLive: (fn) => history.set((d) => fn(d), { record: false }),
    commit: (label) => history.commit(label),
    updateObjects: (fn, label = 'Edit') => history.set((d) => ({ ...d, objects: fn(d.objects) }), { label }),
    selection,
    setSelection,
    nodeSel,
    setNodeSel,
    scope,
    setScope,
    tool,
    setTool: (next) => setTool(next),
    options,
    setOptions: (patch) => setOptionsState((o) => ({ ...o, ...patch })),
    viewOpts,
    setViewOpts: (patch) => setViewOptsState((o) => ({ ...o, ...patch })),
    style,
    setStyle,
    paintTarget,
    setPaintTarget,
    editingText,
    setEditingText,
    viewport,
    fonts,
    loadFonts: () => {
      if (fontsLoaded.current) return;
      fontsLoaded.current = true;
      void listSystemFonts().then((list) => setFonts([...new Set([...FALLBACK_FONTS.slice(0, 1), ...list])]));
    },
    activeArtboard,
    file,
    setFile,
    active,
  };
  const coreRef = useRef(core);
  coreRef.current = core;
  const get = useCallback(() => coreRef.current, []);

  const resetDoc = useCallback(
    (next: VDoc, info: FileInfo = { savedDoc: null }) => {
      penRef.current?.finish(false);
      history.reset(next);
      setSelection([]);
      setNodeSel([]);
      setScope(null);
      setEditingText(null);
      setFile(info.savedDoc ? info : { ...info, savedDoc: next });
      setFitToken((n) => n + 1);
    },
    [history],
  );
  const actions = useMemo(() => editActions(get), [get]);
  const files = useMemo(() => fileActions(get, resetDoc), [get, resetDoc]);

  function setTool(next: ToolId) {
    if (penRef.current?.isDrawing()) penRef.current.finish(false);
    setToolState(next);
    if (next !== 'direct') setNodeSel([]);
  }

  // fit the active artboard for a new/opened document once the canvas has a size
  const fittedToken = useRef(0);
  useEffect(() => {
    if (fittedToken.current === fitToken || !viewport.size.width) return;
    fittedToken.current = fitToken;
    viewport.fitRect({ x: activeArtboard.x, y: activeArtboard.y, width: activeArtboard.width, height: activeArtboard.height });
  }, [fitToken, viewport.size.width, viewport, activeArtboard]);

  // keep selection valid after undo/redo/deletes
  useEffect(() => {
    const ids = allIds(doc.objects);
    if (selection.some((id) => !ids.has(id))) setSelection((s) => s.filter((id) => ids.has(id)));
    if (scope && !ids.has(scope)) setScope(null);
    if (editingText && !ids.has(editingText)) setEditingText(null);
    if (nodeSel.length) setNodeSel((k) => k.filter((key) => ids.has(key.slice(0, key.indexOf(':')))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.objects]);

  const zoomFit = () => viewport.fitRect({ x: activeArtboard.x, y: activeArtboard.y, width: activeArtboard.width, height: activeArtboard.height });
  const zoomAll = () => {
    const r = unionRects(doc.artboards.map((a) => ({ x: a.x, y: a.y, width: a.width, height: a.height })));
    if (r) viewport.fitRect(r);
  };
  const zoomSelection = () => {
    const b = selectionBounds(doc.objects, selection);
    if (b) viewport.fitRect({ ...b, width: Math.max(b.width, 1), height: Math.max(b.height, 1) }, 80);
  };

  const copy = () => {
    const svg = files.copyToClipboard();
    if (svg) void navigator.clipboard?.writeText(svg).catch(() => undefined);
  };
  const cut = () => {
    const svg = files.cut();
    if (svg) void navigator.clipboard?.writeText(svg).catch(() => undefined);
  };
  const paste = async () => {
    let text: string | null = null;
    try {
      text = (await navigator.clipboard?.readText()) ?? null;
    } catch {
      text = null;
    }
    await files.paste(text);
  };
  const handlers: MenuHandlers = {
    newDoc: () => setDialog('new'),
    exportDialog: () => setDialog('export'),
    copy,
    cut,
    paste: () => void paste(),
    zoomFit,
    zoomAll,
    zoom100: () => viewport.actualSize({ x: activeArtboard.x + activeArtboard.width / 2, y: activeArtboard.y + activeArtboard.height / 2 }),
    zoomSelection,
    aiGenerate: () => setDialog('generate'),
    aiLogos: () => setDialog('logos'),
    aiRecolor: () => setDialog('recolor'),
    aiName: () => void nameLayersWithAI(get()),
  };

  useModuleCommands('vector', {
    new: () => setDialog('new'),
    open: () => void files.open(),
    save: () => void files.save(),
    'save-as': () => void files.save(true),
    export: () => setDialog('export'),
    undo: () => (penRef.current?.isDrawing() ? penRef.current.finish(false) : history.undo()),
    redo: history.redo,
    delete: actions.deleteSelection,
    duplicate: actions.duplicate,
    'select-all': actions.selectAll,
    deselect: actions.deselect,
    'zoom-in': () => viewport.zoomIn(),
    'zoom-out': () => viewport.zoomOut(),
    'zoom-fit': zoomFit,
    'zoom-100': handlers.zoom100,
  });

  useModuleKeydown(active, (e) => {
    if (get().editingText) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (mod) {
      const k = key.toLowerCase();
      if (k === 'g') {
        e.preventDefault();
        if (e.shiftKey) actions.ungroup();
        else actions.group();
      } else if (k === 'a' && !e.shiftKey) {
        e.preventDefault();
        actions.selectAll();
      } else if (key === ']' || key === '}') {
        e.preventDefault();
        actions.arrange(e.shiftKey ? 'front' : 'forward');
      } else if (key === '[' || key === '{') {
        e.preventDefault();
        actions.arrange(e.shiftKey ? 'back' : 'backward');
      } else if (key === '2') {
        e.preventDefault();
        if (e.altKey) actions.unlockAll();
        else actions.setLocked(true);
      } else if (key === '3') {
        e.preventDefault();
        if (e.altKey) actions.showAll();
        else actions.hide();
      } else if (key === "'") {
        e.preventDefault();
        core.setViewOpts({ grid: !viewOpts.grid });
      }
      return;
    }
    if (e.altKey) return;
    if (key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      actions.nudge(dx, dy);
      return;
    }
    if (key === 'Enter') {
      if (penRef.current?.isDrawing()) penRef.current.finish(false);
      else if (selection.length === 1 && tool === 'select') {
        const o = doc.objects.find((x) => x.id === selection[0]);
        if (o?.type === 'text' && !o.onPath) setEditingText(o.id);
      }
      return;
    }
    if (key === 'Escape') {
      if (penRef.current?.isDrawing()) penRef.current.finish(false);
      else if (scope) setScope(null);
      else actions.deselect();
      return;
    }
    const lower = key.toLowerCase();
    if (lower === 'x') {
      if (e.shiftKey) setStyle({ fill: style.stroke.paint, stroke: { ...style.stroke, paint: style.fill } });
      else setPaintTarget((p) => (p === 'fill' ? 'stroke' : 'fill'));
      return;
    }
    if (lower === 'd' && !e.shiftKey) return setStyle(DEFAULT_STYLE);
    if (key === '/') return actions.applyPaint({ type: 'none' });
    const next = TOOL_KEYS[lower];
    if (next && !e.shiftKey) setTool(next);
  });

  // system clipboard (copy/cut/paste events also cover Ctrl+C/X/V)
  useEffect(() => {
    if (!active) return;
    const skip = (e: Event) => isEditableTarget(e.target) || Boolean(coreRef.current.editingText);
    const onCopy = (e: ClipboardEvent) => {
      if (skip(e)) return;
      const svg = files.copyToClipboard();
      if (!svg) return;
      e.clipboardData?.setData('text/plain', svg);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (skip(e)) return;
      const svg = files.cut();
      if (!svg) return;
      e.clipboardData?.setData('text/plain', svg);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (skip(e)) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? null;
      const list = Array.from(e.clipboardData?.files ?? []);
      void files.paste(text, list);
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [active, files]);

  useHandoffs('vector', (items) => {
    void (async () => {
      for (const item of items) {
        if (item.kind === 'files' && item.files?.length) await files.openFiles(item.files, 'open');
        else if (item.kind === 'svg' && item.svg) {
          const empty = !get().doc.objects.length && !files.isDirty();
          files.importSvgMarkup(item.svg, empty ? 'open' : 'place', item.title ?? tt('AI artwork'));
        } else if (item.kind === 'palette' && item.palette?.length) {
          const n = actions.addSwatches(item.palette);
          toast.success(n ? tt('{count} colors added to the swatches', { count: n }) : tt('These colors are already in the swatches'));
          setSideTab('swatches');
        } else if (item.kind === 'image' && item.image) {
          try {
            const blob = await (await fetch(item.image)).blob();
            await files.placeImage(blob, item.title ?? tt('Image'));
          } catch (error) {
            toast.error(tt('Could not place the image'), error instanceof Error ? error.message : String(error));
          }
        } else if (item.kind === 'text' && item.text) await files.paste(item.text);
      }
    })();
  });

  const dragging = useFileDrop(containerRef, (list) => void files.openFiles(list, 'place', dropPoint.current ?? undefined), active);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const over = (e: DragEvent) => {
      dropPoint.current = get().viewport.screenToWorld(e.clientX, e.clientY);
    };
    el.addEventListener('dragover', over);
    return () => el.removeEventListener('dragover', over);
  }, [get]);

  const menus = buildMenus(t, core, actions, files, handlers);
  const selCount = selection.length;
  const ab = activeArtboard;

  return (
    <EditorContext.Provider value={core}>
      <ModuleLayout
        moduleId="vector"
        title={localizeDefaultName(t, doc.name, ['Untitled'])}
        dirty={files.isDirty()}
        menus={menus}
        toolbar={<ToolOptionsBar actions={actions} />}
        actions={
          <>
            <IconButton icon={Minus} size="sm" label={t('Zoom out')} onClick={() => viewport.zoomOut()} />
            <button type="button" className="btn sm ghost vc-zoom" title={t('Fit artboard')} onClick={zoomFit}>
              {formatZoom(viewport.view.zoom)}
            </button>
            <IconButton icon={Plus} size="sm" label={t('Zoom in')} onClick={() => viewport.zoomIn()} />
            <Button size="sm" variant="primary" icon={Download} onClick={() => setDialog('export')}>
              {t('Export')}
            </Button>
          </>
        }
        left={<Toolbox onTool={setTool} />}
        right={
          <div className="vc-right">
            <div className="vc-props">
              <PropertiesPanel actions={actions} />
            </div>
            <div className="vc-side">
              <Tabs<SideTab>
                value={sideTab}
                onChange={setSideTab}
                tabs={[
                  { value: 'layers', label: t('Layers') },
                  { value: 'swatches', label: t('Swatches') },
                  { value: 'artboards', label: t('Artboards') },
                ]}
              />
              <div className="vc-side-body">
                {sideTab === 'layers' && <LayersPanel />}
                {sideTab === 'swatches' && (
                  <Panel title={t('Swatches')}>
                    <SwatchesPanel actions={actions} />
                  </Panel>
                )}
                {sideTab === 'artboards' && (
                  <Panel title={t('Artboards')}>
                    <ArtboardsPanel actions={actions} />
                  </Panel>
                )}
              </div>
            </div>
          </div>
        }
        rightWidth={290}
        status={
          <>
            <span>{formatZoom(viewport.view.zoom)}</span>
            <span>
              {ab.name} · {ab.width}×{ab.height}
            </span>
            {cursor && (
              <span className="mono">
                X {Math.round(cursor.x - ab.x)} · Y {Math.round(cursor.y - ab.y)}
              </span>
            )}
            <span>{selCount ? t('{count} selected', { count: selCount }) : t('Nothing selected')}</span>
            {scope && <span className="vc-badge">{t('Inside group — Esc to exit')}</span>}
            <span className="spacer" />
            <span>{history.labels.length ? t('Last: {label}', { label: t(history.labels[history.labels.length - 1]) }) : ''}</span>
          </>
        }
        ai={
          <AIAssistantPanel
            moduleId="vector"
            moduleName="Vector Designer"
            instructions={VECTOR_AI_INSTRUCTIONS}
            getContext={() => buildContext(get())}
            onActions={(list) => applyAIActions(get(), list)}
            suggestions={[t('Design a minimalist poster about coffee'), t('Add a title and subtitle'), t('Recolor everything in a sunset palette'), t('Center everything on the artboard')]}
            canSnapshot
          />
        }
      >
        <Canvas
          core={core}
          containerRef={containerRef}
          penRef={penRef}
          onCursor={setCursor}
          onContextMenu={(e, world) => {
            const c = get();
            const hit = hitTest(c.doc.objects, world, 4 / c.viewport.view.zoom);
            if (hit && !c.selection.includes(hit[0].id)) c.setSelection([hit[0].id]);
            ctxMenu.open(() => contextEntries(t, get(), actions, handlers, true))(e);
          }}
        >
          <DropOverlay show={dragging} label={t('Drop SVG or images to place them')} />
        </Canvas>
        {ctxMenu.element}
      </ModuleLayout>
      {dialog === 'new' && (
        <NewDocumentDialog
          onClose={() => setDialog(null)}
          onCreate={(w, h, bg, name) => {
            setDialog(null);
            void files.newDocument(w, h, bg, name);
          }}
        />
      )}
      {dialog === 'export' && (
        <ExportDialog onClose={() => setDialog(null)} onExport={files.runExport} artboardCount={doc.artboards.length} hasSelection={selection.length > 0} />
      )}
      {dialog === 'generate' && <GenerateArtworkDialog core={core} files={files} onClose={() => setDialog(null)} />}
      {dialog === 'logos' && <LogoIdeasDialog core={core} files={files} onClose={() => setDialog(null)} />}
      {dialog === 'recolor' && <RecolorDialog core={core} onClose={() => setDialog(null)} />}
    </EditorContext.Provider>
  );
}
