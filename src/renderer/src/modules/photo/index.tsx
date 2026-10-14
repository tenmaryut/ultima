import './i18n';
import './photo.css';
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel } from '../../components/ai/AIAssistantPanel';
import { Button, DropOverlay, Panel, confirmDialog, toast } from '../../components/ui';
import { useT } from '../../core/i18n';
import { isEditableTarget, useModuleCommands, useModuleKeydown } from '../../core/commands';
import { useFileDrop, useHandoffs } from '../../core/hooks';
import { listSystemFonts } from '../../core/platform';
import { useViewport } from '../../core/viewport';
import { sanitizeSvg } from '../../core/ai/sanitize';
import { fileExtension } from '../../core/utils/format';
import * as A from './actions';
import { executeAIActions, photoAIContext, PHOTO_AI_INSTRUCTIONS } from './ai';
import { removeBackground, removeUniformBackground } from './aiTools';
import { documentFromCanvas } from './docops';
import { PhotoEngine } from './engine';
import { blobToCanvas, projectToDocument, svgToCanvas, urlToCanvas, IMAGE_EXTENSIONS } from './io';
import { buildMenus, type DialogState } from './menus';
import { applyPixelOp, autoAdjust } from './pixelActions';
import { isDirty, useActiveSession, useHistoryVersion, usePhotoStore } from './store';
import { TOOLS } from './tools';
import { cancelFreeTransform, startFreeTransform } from './tools/transform';
import type { ToolId } from './types';
import { AdjustDialog, OP_DEFS } from './dialogs/AdjustDialog';
import { CanvasSizeDialog, ExportDialog, FillDialog, ImageSizeDialog, NewDocDialog } from './dialogs/BasicDialogs';
import { DescribeDialog, GenerateDialog, GenFillDialog } from './dialogs/AIDialogs';
import { DocTabs, StartScreen, TextEditor } from './ui/CanvasParts';
import { LayersPanel } from './ui/LayersPanel';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { HistoryPanel, NavigatorPanel } from './ui/SidePanels';
import { StatusBar, useStatusStore } from './ui/StatusBar';
import { ToolOptions } from './ui/ToolOptions';
import { ToolPalette } from './ui/ToolPalette';

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'move',
  m: 'marquee',
  l: 'lasso',
  w: 'wand',
  c: 'crop',
  i: 'eyedropper',
  j: 'heal',
  s: 'clone',
  b: 'brush',
  e: 'eraser',
  g: 'bucket',
  o: 'dodge',
  r: 'blur',
  t: 'text',
  u: 'shape',
  h: 'hand',
  z: 'zoom',
};

const HINTS: Partial<Record<ToolId, string>> = {
  move: 'Drag to move · Ctrl-click picks a layer · arrows nudge',
  marquee: 'Shift adds · Alt subtracts · drag inside to move the selection',
  lasso: 'Shift adds · Alt subtracts',
  wand: 'Click a color area · Shift adds · Alt subtracts',
  crop: 'Drag handles · Enter applies · Esc resets',
  brush: '[ ] size · Shift-click draws a line · 1–0 opacity',
  pencil: '[ ] size · Shift-click draws a line',
  eraser: '[ ] size',
  clone: 'Alt-click sets the source',
  heal: 'Paint over a spot',
  text: 'Click to type · double-click text to edit',
  shape: 'Shift keeps proportions · Alt draws from the center',
  hand: 'Drag to pan (or hold Space)',
  zoom: 'Click to zoom in · Alt-click to zoom out',
};

export default function PhotoModule({ active }: ModuleProps) {
  const t = useT();
  const engineRef = useRef<PhotoEngine | null>(null);
  if (!engineRef.current) engineRef.current = new PhotoEngine();
  const engine = engineRef.current;
  const session = useActiveSession();
  const version = useHistoryVersion(session?.history);
  const doc = session?.history.present ?? null;
  const tool = usePhotoStore((s) => s.tool);
  const sessions = usePhotoStore((s) => s.sessions);
  const editingTextId = usePhotoStore((s) => s.editingTextId);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toolCursor, setToolCursor] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const viewport = useViewport(viewportRef, doc?.width ?? 0, doc?.height ?? 0, { fitKey: session?.id, active });
  engine.viewport = viewport;

  /* ----------------------------- engine lifecycle ----------------------------- */

  useEffect(() => {
    const c = viewportRef.current;
    const d = displayRef.current;
    const o = overlayRef.current;
    if (!c || !d || !o) return;
    engine.onStatus = (info) => useStatusStore.setState({ info });
    engine.onEditText = (id) => usePhotoStore.getState().setEditingText(id);
    engine.onCursor = (cursor) => setToolCursor(cursor);
    engine.attach(c, d, o);
    return () => engine.detach();
  }, [engine]);

  useEffect(() => {
    engine.setActive(active);
  }, [engine, active]);

  useEffect(() => {
    engine.syncDoc();
  });

  useEffect(() => {
    setToolCursor(null);
  }, [tool]);

  useEffect(() => {
    engine.requestOverlay();
  }, [engine, viewport.view, viewport.spaceHeld]);

  useEffect(() => {
    void listSystemFonts().then((fonts) => usePhotoStore.getState().setFonts(fonts));
  }, []);

  // keep each document's zoom/pan when switching tabs
  const lastSession = useRef<string | null>(null);
  useEffect(() => {
    const store = usePhotoStore.getState();
    const prev = store.sessions.find((s) => s.id === lastSession.current);
    if (prev && prev.id !== session?.id) prev.view = viewport.view;
    if (session && session.id !== lastSession.current && session.view) viewport.setView(session.view);
    lastSession.current = session?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  /* --------------------------------- commands --------------------------------- */

  const transforming = usePhotoStore((s) => s.transforming);
  useModuleCommands('photo', {
    new: () => setDialog({ kind: 'new' }),
    open: () => void A.pickAndOpen(),
    save: () => (engine.doc ? void A.saveProject(engine, false) : false),
    'save-as': () => (engine.doc ? void A.saveProject(engine, true) : false),
    export: () => (engine.doc ? setDialog({ kind: 'export' }) : false),
    undo: () => {
      if (!engine.history) return false;
      if (usePhotoStore.getState().transforming) cancelFreeTransform(engine);
      else engine.history.undo();
    },
    redo: () => (engine.history ? engine.history.redo() : false),
    delete: () => (engine.doc ? void A.deleteAction(engine) : false),
    duplicate: () => (engine.doc ? A.duplicateLayer(engine) : false),
    'select-all': () => (engine.doc ? A.selectAll(engine) : false),
    deselect: () => (engine.doc ? A.deselect(engine) : false),
    'zoom-in': () => viewport.zoomIn(),
    'zoom-out': () => viewport.zoomOut(),
    'zoom-fit': () => viewport.fit(),
    'zoom-100': () => viewport.actualSize(),
  });

  const openAdjust = (id: string) => engine.doc && setDialog({ kind: 'adjust', id });

  useModuleKeydown(active, (e) => {
    if (dialog || editingTextId) return;
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (engine.doc && engine.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (mod) {
      if (!engine.doc) return;
      let handled = true;
      if (key === 'a' && !e.shiftKey) A.selectAll(engine);
      else if (key === 'i' && e.shiftKey) A.inverseSelection(engine);
      else if (key === 'i' && e.altKey) setDialog({ kind: 'imageSize' });
      else if (key === 'c' && e.altKey) setDialog({ kind: 'canvasSize' });
      else if (key === 'c' && e.shiftKey) A.copy(engine, true);
      else if (key === 't') startFreeTransform(engine);
      else if (key === 'n' && e.shiftKey) A.newLayer(engine);
      else if (key === 'e' && e.shiftKey) A.mergeVisibleAction(engine);
      else if (key === 'l') openAdjust('levels');
      else if (key === 'm') openAdjust('curves');
      else if (key === 'u' && e.shiftKey) void applyPixelOp(engine, 'desaturate', {}, 'Desaturate');
      else if (key === 'u') openAdjust('hueSaturation');
      else if (key === 'b') openAdjust('colorBalance');
      else if (key === 'i') void applyPixelOp(engine, 'invert', {}, 'Invert');
      else if (e.key === 'Backspace') void A.fillAction(engine, usePhotoStore.getState().bg);
      else handled = false;
      if (handled) e.preventDefault();
      return;
    }
    if (e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) {
      if (engine.doc) void A.fillAction(engine, usePhotoStore.getState().fg);
      e.preventDefault();
      return;
    }
    if (e.key === 'F5' && e.shiftKey) {
      if (engine.doc) setDialog({ kind: 'fill' });
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const store = usePhotoStore.getState();
    const target = TOOL_KEYS[key];
    if (target) {
      e.preventDefault();
      if (e.shiftKey) {
        if (key === 'b') return store.setTool(store.tool === 'pencil' ? 'brush' : 'pencil');
        if (key === 'g') return store.setTool(store.tool === 'gradient' ? 'bucket' : 'gradient');
        if (key === 'm') return store.setOpt('marquee', { shape: store.opts.marquee.shape === 'rect' ? 'ellipse' : 'rect' });
        if (key === 'l') return store.setOpt('lasso', { kind: store.opts.lasso.kind === 'free' ? 'polygon' : 'free' });
        if (key === 'o') return store.setOpt('dodge', { mode: store.opts.dodge.mode === 'dodge' ? 'burn' : store.opts.dodge.mode === 'burn' ? 'sponge' : 'dodge' });
        if (key === 'r') return store.setOpt('blur', { mode: store.opts.blur.mode === 'blur' ? 'sharpen' : 'blur' });
        if (key === 'u') {
          const kinds = ['rect', 'roundrect', 'ellipse', 'line'] as const;
          return store.setOpt('shape', { kind: kinds[(kinds.indexOf(store.opts.shape.kind) + 1) % kinds.length] });
        }
      }
      store.setTool(target);
      return;
    }
    if (key === 'x') store.swapColors();
    else if (key === 'd') store.resetColors();
    else if (key === '[' || key === ']' || key === '{' || key === '}') {
      const sized = (['brush', 'pencil', 'eraser', 'clone', 'heal', 'dodge', 'blur'] as const).find((x) => x === store.tool);
      if (!sized) return;
      const o = store.opts[sized] as { size: number; hardness?: number };
      if (e.shiftKey && o.hardness !== undefined) store.setOpt(sized, { hardness: Math.max(0, Math.min(1, o.hardness + (key === ']' || key === '}' ? 0.1 : -0.1))) } as never);
      else store.setOpt(sized, { size: key === ']' ? Math.min(2500, Math.round(o.size * 1.2) + 1) : Math.max(1, Math.round(o.size / 1.2)) } as never);
      engine.requestOverlay();
    } else if (/^[0-9]$/.test(key)) {
      const painter = (['brush', 'pencil', 'eraser', 'clone'] as const).find((x) => x === store.tool);
      if (painter) store.setOpt(painter, { opacity: key === '0' ? 1 : Number(key) / 10 } as never);
    } else return;
    e.preventDefault();
  });

  /* ------------------------------ clipboard events ------------------------------ */

  useEffect(() => {
    if (!active) return;
    const blocked = (e: Event) => Boolean(dialog || editingTextId || isEditableTarget(e.target) || isEditableTarget(document.activeElement));
    const onCopy = (e: ClipboardEvent) => {
      if (blocked(e) || !engine.doc) return;
      e.preventDefault();
      A.copy(engine, false);
    };
    const onCut = (e: ClipboardEvent) => {
      if (blocked(e) || !engine.doc) return;
      e.preventDefault();
      A.cut(engine);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (blocked(e)) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const text = e.clipboardData?.getData('text/plain') ?? '';
      e.preventDefault();
      const file = imageItem?.getAsFile();
      if (file) {
        void blobToCanvas(file)
          .then((canvas) => {
            const internal = A.internalClipboard();
            if (internal && internal.canvas.width === canvas.width && internal.canvas.height === canvas.height && engine.doc) A.pasteInternal(engine);
            else A.pasteCanvas(engine, canvas);
          })
          .catch((err: unknown) => toast.error(t('Could not paste the image'), err instanceof Error ? err.message : String(err)));
        return;
      }
      if (/^\s*<svg[\s>]/i.test(text)) {
        void svgToCanvas(text, 512)
          .then((canvas) => A.pasteCanvas(engine, canvas))
          .catch((err: unknown) => toast.error(t('Could not paste the image'), err instanceof Error ? err.message : String(err)));
        return;
      }
      if (!A.pasteInternal(engine)) toast.info(t('Nothing to paste'), t('Copy an image or a selection first.'));
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [active, dialog, editingTextId, engine, t]);

  /* ------------------------------ files & handoffs ------------------------------ */

  const dragging = useFileDrop(
    rootRef,
    (files) => {
      const docs = files.filter((f) => ['ultima', 'psd'].includes(fileExtension(f.name)));
      const images = files.filter((f) => !docs.includes(f) && (f.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(fileExtension(f.name))));
      if (docs.length) void A.openFiles(docs);
      if (images.length) {
        if (engine.doc) void A.placeFiles(engine, images);
        else void A.openFiles(images);
      }
      if (!docs.length && !images.length) toast.warning(t('Unsupported file type'), files.map((f) => f.name).join(', '));
    },
    active,
  );

  const addImageCanvas = async (canvas: HTMLCanvasElement, title: string) => {
    if (engine.doc) {
      const asLayer = await confirmDialog({
        title: t('Add image'),
        message: t('Add the image as a new layer in the current document? Choose Cancel to open it as a new document instead.'),
        confirmLabel: t('Add as layer'),
      });
      if (asLayer) {
        A.placeCanvas(engine, canvas, title);
        return;
      }
    }
    const store = usePhotoStore.getState();
    store.openSession(documentFromCanvas(canvas, 'Background'), title || store.nextUntitled(), 'Open');
  };

  useHandoffs('photo', (items) => {
    void (async () => {
      for (const item of items) {
        try {
          if (item.kind === 'files' && item.files?.length) await A.openFiles(item.files);
          else if (item.kind === 'image' && item.image) await addImageCanvas(await urlToCanvas(item.image), item.title ?? 'Image');
          else if (item.kind === 'svg' && item.svg) {
            const clean = sanitizeSvg(item.svg);
            if (!clean) throw new Error(t('The SVG could not be read'));
            await addImageCanvas(await svgToCanvas(clean, 1024), item.title ?? 'Vector');
          } else if (item.kind === 'text' && item.text) {
            if (!engine.doc) A.newDocument(1920, 1080, '#ffffff');
            A.newTextLayer(engine, item.text.slice(0, 2000));
          } else if (item.kind === 'json' && item.json) {
            const p = await projectToDocument(item.json);
            usePhotoStore.getState().openSession(p.doc, p.name, 'Open');
          } else if (item.kind === 'palette' && item.palette?.length) usePhotoStore.getState().setColors(item.palette[0], item.palette[1]);
        } catch (error) {
          toast.error(t('Could not open the item'), error instanceof Error ? error.message : String(error));
        }
      }
    })();
  });

  /* ----------------------------------- render ----------------------------------- */

  const menus = buildMenus({
    t,
    engine,
    viewport,
    open: setDialog,
    ai: {
      removeBackground: () => void removeBackground(engine),
      removeUniform: () => removeUniformBackground(engine),
      autoEnhance: () => void autoAdjust(engine, 'tone').then(() => applyPixelOp(engine, 'basic', { vibrance: 15 }, 'Auto-Enhance')),
    },
  });

  const view = viewport.view;
  const cursor = viewport.spaceHeld ? 'grab' : (toolCursor ?? TOOLS[tool].cursor?.(engine) ?? 'default');
  const closeDialog = () => setDialog(null);

  const right = doc && session ? (
    <>
      <Panel title={t('Navigator')} defaultOpen={false}>
        <NavigatorPanel engine={engine} viewport={viewport} version={version} />
      </Panel>
      <Panel title={t('Layers')}>
        <LayersPanel engine={engine} doc={doc} />
      </Panel>
      <Panel title={t('Properties')}>
        <PropertiesPanel engine={engine} doc={doc} />
      </Panel>
      <Panel title={t('History')}>
        <HistoryPanel session={session} version={version} />
      </Panel>
    </>
  ) : undefined;

  return (
    <div ref={rootRef} className="ph-root">
      <ModuleLayout
        moduleId="photo"
        title={session?.name}
        dirty={session ? isDirty(session) : false}
        unsaved={sessions.some(isDirty)}
        menus={menus}
        toolbar={<ToolOptions engine={engine} viewport={viewport} doc={doc} />}
        actions={
          doc ? (
            <Button size="sm" variant="primary" icon={Download} onClick={() => setDialog({ kind: 'export' })}>
              {t('Export')}
            </Button>
          ) : undefined
        }
        left={<ToolPalette />}
        right={right}
        rightWidth={290}
        status={<StatusBar doc={doc} zoom={view.zoom} memory={session ? session.history.memoryBytes() : 0} hint={t(HINTS[tool] ?? '')} />}
        ai={
          <AIAssistantPanel
            moduleId="photo"
            moduleName="Photo Editor"
            instructions={PHOTO_AI_INSTRUCTIONS}
            getContext={() => photoAIContext(engine)}
            onActions={(actions) => executeAIActions(engine, actions)}
            suggestions={[t('Auto-enhance this photo'), t('Make it look vintage'), t('Crop to a square'), t('Add a title at the top')]}
            canSnapshot
          />
        }
      >
        <div className="ph-center">
          <DocTabs />
          <div ref={viewportRef} className={`canvas-viewport ph-viewport ${transforming ? 'transforming' : ''}`} style={{ cursor }}>
            {doc && <div className="ph-checker checker" style={{ left: view.x, top: view.y, width: doc.width * view.zoom, height: doc.height * view.zoom }} />}
            <canvas
              ref={displayRef}
              className="ph-display"
              style={{ transform: viewport.transform, display: doc ? 'block' : 'none', imageRendering: view.zoom >= 2 ? 'pixelated' : 'auto' }}
            />
            <canvas ref={overlayRef} className="ph-overlay" />
            {doc && editingTextId && <TextEditor key={editingTextId} engine={engine} layerId={editingTextId} view={view} doc={doc} />}
            {!doc && <StartScreen onNew={() => setDialog({ kind: 'new' })} />}
          </div>
          <DropOverlay show={dragging} label={doc ? t('Drop images to add them as layers') : t('Drop images to open them')} />
        </div>
      </ModuleLayout>
      {dialog?.kind === 'new' && <NewDocDialog onClose={closeDialog} />}
      {dialog?.kind === 'imageSize' && doc && <ImageSizeDialog engine={engine} onClose={closeDialog} />}
      {dialog?.kind === 'canvasSize' && doc && <CanvasSizeDialog engine={engine} onClose={closeDialog} />}
      {dialog?.kind === 'export' && doc && <ExportDialog engine={engine} onClose={closeDialog} />}
      {dialog?.kind === 'fill' && doc && <FillDialog engine={engine} onClose={closeDialog} />}
      {dialog?.kind === 'adjust' && doc && OP_DEFS[dialog.id] && <AdjustDialog key={dialog.id} engine={engine} def={OP_DEFS[dialog.id]} onClose={closeDialog} />}
      {dialog?.kind === 'genfill' && doc && <GenFillDialog engine={engine} onClose={closeDialog} />}
      {dialog?.kind === 'generate' && <GenerateDialog engine={engine} onClose={closeDialog} />}
      {dialog?.kind === 'describe' && doc && <DescribeDialog engine={engine} onClose={closeDialog} />}
    </div>
  );
}
