import './i18n';
import './layout.css';
import { useEffect, useRef, useState } from 'react';
import { Circle, Hand, Image as ImageIcon, LayoutTemplate, Minus, MousePointer2, Sparkles, Square, Table2, Type, ZoomIn, ZoomOut } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel } from '../../components/ai/AIAssistantPanel';
import { Button, DropOverlay, IconButton, Segmented, Tabs, ToolButton, confirmDialog, toast, useContextMenu, type MenuEntry } from '../../components/ui';
import { localizeDefaultName, useT } from '../../core/i18n';
import { useModuleCommands, useModuleKeydown, isEditableTarget } from '../../core/commands';
import { useFileDrop, useHandoffs, useLatest } from '../../core/hooks';
import { pickFiles } from '../../core/platform';
import { rememberRecent } from '../../core/open';
import { useAppStore } from '../../core/store';
import { canvasToAIImage } from '../../core/utils/image';
import { formatZoom } from '../../core/viewport';
import { applyAIActions } from './ai';
import { LAYOUT_AI_INSTRUCTIONS, describeDocument } from './aiText';
import { Canvas, type CanvasApi } from './canvas/Canvas';
import { AIDialogsHost, type AIDialog } from './dialogs/AIDialogsHost';
import { ExportDialog, type ExportFormat } from './dialogs/ExportDialog';
import { NewDocDialog } from './dialogs/NewDocDialog';
import { StartScreen } from './dialogs/StartScreen';
import { renderPageCanvas } from './exporting';
import { fileToAsset, getInternalClipboard, isImageFile, isProjectFile, parseClipboardText, prepareFramesForPaste, readProjectFile, saveProject, setClipboard, urlToAsset } from './fileio';
import { buildMenus, type MenuActions } from './menus';
import { normalizeDoc, createTextFrame } from './model';
import { getFrames, predecessorMap } from './ops';
import { ArrangePanel } from './panels/ArrangePanel';
import { LayersPanel } from './panels/LayersPanel';
import { ImagePanel, ShadowPanel, ShapePanel, TablePanel } from './panels/ObjectPanels';
import { PagePanel } from './panels/PagePanel';
import { PagesStrip } from './panels/PagesStrip';
import { StylesPanel } from './panels/StylesPanel';
import { TextPanel } from './panels/TextPanel';
import { paletteToTheme } from './styles';
import { DEFAULT_DOC_NAMES } from './templates';
import { MASTER_ID, type Frame, type LayoutDoc, type Point } from './types';
import { describeSize, getPreset } from './units';
import { useLayoutEditor, type Tool } from './useLayoutEditor';
import { releaseAssetUrls } from './PageView';

type RightTab = 'design' | 'styles' | 'layers';

export default function LayoutModule({ active }: ModuleProps) {
  const t = useT();
  const ed = useLayoutEditor();
  const canvas = useRef<CanvasApi>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<RightTab>('design');
  const [showStart, setShowStart] = useState(true);
  const [newDoc, setNewDoc] = useState<'templates' | 'blank' | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [aiDialog, setAIDialog] = useState<AIDialog | null>(null);
  const [zoom, setZoom] = useState(1);
  const ctx = useContextMenu();
  const toggleAI = useAppStore((s) => s.toggleAIPanel);
  const doc = ed.doc;

  useEffect(() => {
    releaseAssetUrls(doc.assets);
  }, [doc.assets]);

  /* ------------------------------ documents ------------------------------ */

  const confirmDiscard = async () =>
    !ed.dirty || confirmDialog({ title: t('Discard unsaved changes?'), message: t('The current document has changes that are not saved.'), confirmLabel: t('Discard'), danger: true });

  const startDocument = async (next: LayoutDoc) => {
    if (!showStart && !(await confirmDiscard())) return;
    ed.resetDocument(next);
    setShowStart(false);
    setNewDoc(null);
  };

  const save = async (asNew: boolean) => {
    try {
      const r = await saveProject(ed.current(), asNew ? undefined : ed.savedPath);
      if (r) {
        ed.markSaved(r.path);
        toast.success(t('Project saved'));
      }
    } catch (error) {
      toast.error(t('Could not save'), error instanceof Error ? error.message : String(error));
    }
  };

  const placeImages = async (files: File[], at?: { pageId: string; point: Point } | null) => {
    const assets = [];
    for (const f of files) {
      try {
        assets.push(await fileToAsset(f));
        rememberRecent(f, 'layout');
      } catch (error) {
        toast.error(t('Could not read {name}', { name: f.name }), error instanceof Error ? error.message : undefined);
      }
    }
    if (!assets.length) return;
    if (at && at.pageId !== ed.pageId) ed.goToPage(at.pageId);
    ed.placeAssets(assets, at?.point);
    setShowStart(false);
  };

  const openFiles = async (files: File[], at?: { pageId: string; point: Point } | null) => {
    const project = files.find(isProjectFile);
    const images = files.filter(isImageFile);
    const unknown = files.filter((f) => !isProjectFile(f) && !isImageFile(f));
    if (unknown.length) toast.warning(t('Unsupported file type'), unknown.map((f) => f.name).join(', '));
    if (project) {
      try {
        const next = await readProjectFile(project);
        if (!showStart && !(await confirmDiscard())) return;
        ed.resetDocument(next);
        setShowStart(false);
        rememberRecent(project, 'layout');
      } catch (error) {
        toast.error(t('Could not open file'), error instanceof Error ? error.message : String(error));
      }
    }
    if (images.length) await placeImages(images, at);
  };

  const pickAndOpen = async () => {
    const files = await pickFiles({ accept: '.ultima,image/*,.svg', multiple: true });
    if (files.length) await openFiles(files);
  };

  const pickImageFor = async (frameId?: string) => {
    const files = await pickFiles({ accept: 'image/*,.svg', multiple: !frameId });
    if (!files.length) return;
    if (frameId) ed.setSelection([frameId]);
    await placeImages(frameId ? files.slice(0, 1) : files);
  };

  const dragging = useFileDrop(rootRef, (files) => void openFiles(files, canvas.current?.dropTarget()), active);

  useHandoffs('layout', (items) => {
    void (async () => {
      for (const item of items) {
        try {
          if (item.kind === 'files' && item.files?.length) await openFiles(item.files);
          else if (item.kind === 'image' && item.image) await placeAssetsFromUrl(item.image, item.title);
          else if (item.kind === 'text' && item.text?.trim()) addTextFrame(item.text);
          else if (item.kind === 'palette' && item.palette?.length) {
            ed.setDoc({ swatches: paletteToTheme(item.palette, ed.current().swatches) }, 'Apply palette');
            toast.success(t('Palette applied to the theme colors'));
          } else if (item.kind === 'json' && item.json) {
            const raw = item.json as { module?: string; doc?: unknown };
            if (raw.module === 'layout' && raw.doc) await startDocument(normalizeDoc(raw.doc));
          } else if (item.kind === 'svg' && item.svg) {
            const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.svg)}`;
            await placeAssetsFromUrl(url, item.title ?? 'graphic.svg');
          }
        } catch (error) {
          toast.error(t('Could not open file'), error instanceof Error ? error.message : String(error));
        }
      }
      setShowStart(false);
    })();
  });

  const placeAssetsFromUrl = async (url: string, name?: string) => {
    const asset = await urlToAsset(url, name ?? 'image');
    ed.placeAssets([asset]);
  };

  const addTextFrame = (text: string) => {
    const page = ed.pageId === MASTER_ID ? doc.pages[0] : ed.page;
    const w = Math.max(60, (page.width - page.margins.left - page.margins.right) * 0.8);
    const lines = text.split('\n').length + Math.ceil(text.length / 60);
    const f = createTextFrame({ x: (page.width - w) / 2, y: page.height * 0.3, w, h: Math.min(page.height * 0.6, 28 * lines + 30), text: text.slice(0, 20000), styleId: 'body', name: 'Text' });
    ed.insertFrames([f], ed.pageId, 'Add text');
  };

  /* ------------------------------ clipboard ------------------------------ */

  const copySelection = (): string | null => {
    if (!ed.selection.length) return null;
    const frames = ed.selected;
    const assets = Object.fromEntries(frames.flatMap((f) => (f.type === 'image' && f.assetId && doc.assets[f.assetId] ? [[f.assetId, doc.assets[f.assetId]]] : [])));
    const pred = predecessorMap(doc);
    const copies = frames.map((f): Frame => {
      if (f.type !== 'text') return f;
      const threaded = Boolean(f.nextId) || pred.has(f.id);
      return { ...f, nextId: null, text: threaded ? (ed.flows.get(f.id)?.text ?? f.text) : f.text };
    });
    return setClipboard({ frames: copies, assets, sourcePage: ed.pageId });
  };

  const pasteFrames = (frames: Frame[]) => {
    const internal = getInternalClipboard();
    const sameSpot = internal?.sourcePage === ed.pageId && frames.some((f) => getFrames(ed.current(), ed.pageId).some((g) => g.x === f.x && g.y === f.y));
    const prepared = prepareFramesForPaste(ed.current(), { frames, assets: internal?.assets ?? {}, sourcePage: '' }, sameSpot ? 16 : 0);
    ed.insertFrames(prepared.frames, ed.pageId, 'Paste', prepared.assets);
  };

  const pasteFromMenu = async () => {
    const internal = getInternalClipboard();
    try {
      const text = await navigator.clipboard?.readText?.();
      const frames = text ? parseClipboardText(text) : null;
      if (frames) return pasteFrames(frames);
      if (!internal && text?.trim()) return addTextFrame(text);
    } catch {
      // clipboard permission denied: fall back to the internal clipboard
    }
    if (internal) pasteFrames(internal.frames);
  };

  const clipboardHandlers = useLatest({
    copy: (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || ed.editing) return;
      const text = copySelection();
      if (text === null) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    },
    cut: (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || ed.editing) return;
      const text = copySelection();
      if (text === null) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
      ed.deleteSelection();
    },
    paste: (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || ed.editing || !e.clipboardData) return;
      const files = Array.from(e.clipboardData.files).filter(isImageFile);
      if (files.length) {
        e.preventDefault();
        void placeImages(files);
        return;
      }
      const text = e.clipboardData.getData('text/plain');
      const frames = parseClipboardText(text);
      if (frames) {
        e.preventDefault();
        pasteFrames(frames);
      } else if (text.trim()) {
        e.preventDefault();
        addTextFrame(text);
      }
    },
  });

  useEffect(() => {
    if (!active) return;
    const copy = (e: ClipboardEvent) => clipboardHandlers.current.copy(e);
    const cut = (e: ClipboardEvent) => clipboardHandlers.current.cut(e);
    const paste = (e: ClipboardEvent) => clipboardHandlers.current.paste(e);
    window.addEventListener('copy', copy);
    window.addEventListener('cut', cut);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('copy', copy);
      window.removeEventListener('cut', cut);
      window.removeEventListener('paste', paste);
    };
  }, [active, clipboardHandlers]);

  /* ------------------------------ commands ------------------------------ */

  const fit = () => canvas.current?.fit();
  useModuleCommands('layout', {
    new: () => setNewDoc('templates'),
    open: () => void pickAndOpen(),
    save: () => void save(false),
    'save-as': () => void save(true),
    export: () => setExportFormat('pdf'),
    undo: () => (ed.editing ? false : ed.history.undo()),
    redo: () => (ed.editing ? false : ed.history.redo()),
    delete: () => ed.deleteSelection(),
    duplicate: () => ed.duplicateSelection(),
    'select-all': () => ed.select(ed.frames.filter((f) => !f.locked && !f.hidden).map((f) => f.id)),
    deselect: () => ed.setSelection([]),
    'zoom-in': () => canvas.current?.vp.zoomIn(),
    'zoom-out': () => canvas.current?.vp.zoomOut(),
    'zoom-fit': fit,
    'zoom-100': () => canvas.current?.actualSize(),
  });

  const TOOL_KEYS: Record<string, Tool> = { v: 'select', t: 'text', r: 'rect', e: 'ellipse', l: 'line', f: 'image', h: 'hand' };
  useModuleKeydown(active, (e) => {
    if (newDoc || exportFormat || aiDialog) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey) {
      if (key === 'a' && !e.shiftKey) {
        e.preventDefault();
        ed.select(ed.frames.filter((f) => !f.locked && !f.hidden).map((f) => f.id));
      } else if (key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ed.ungroup();
        else ed.group();
      } else if (key === ']' || key === '}') {
        e.preventDefault();
        ed.reorder(e.shiftKey ? 'front' : 'forward');
      } else if (key === '[' || key === '{') {
        e.preventDefault();
        ed.reorder(e.shiftKey ? 'back' : 'backward');
      } else if (key === 'l') {
        e.preventDefault();
        ed.toggleLock();
      }
      return;
    }
    if (e.altKey) return;
    if (key.startsWith('arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      ed.nudge(key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0);
      return;
    }
    if (key === 'escape') {
      if (ed.linking) ed.setLinking(null);
      else if (ed.contentId) ed.setContentId(null);
      else if (ed.tool !== 'select') ed.setTool('select');
      else ed.setSelection([]);
      return;
    }
    if (key === 'enter' && ed.selected.length === 1 && ed.selected[0].type === 'text') {
      e.preventDefault();
      ed.beginEdit(ed.selected[0].id);
      return;
    }
    if (key === 'pageup' || key === 'pagedown') {
      e.preventDefault();
      if (ed.pageIndex >= 0) ed.goToPage(ed.pageIndex + (key === 'pageup' ? -1 : 1));
      return;
    }
    const tool = TOOL_KEYS[key];
    if (tool && !e.shiftKey) ed.setTool(tool);
  });

  /* --------------------------------- AI --------------------------------- */

  const aiContext = async () => {
    const d = ed.current();
    const index = Math.max(0, ed.pageIndex);
    let image = null;
    try {
      const p = d.pages[index];
      const canvasEl = await renderPageCanvas(d, ed.flows, index, Math.min(1, 1024 / Math.max(p.width, p.height)));
      image = await canvasToAIImage(canvasEl, { maxSize: 1024 });
    } catch {
      // snapshot is optional
    }
    return { summary: describeDocument(d, index, ed.selection, ed.flows, ed.pageId === MASTER_ID), image };
  };

  const onAIActions = (actions: { type: string; [k: string]: unknown }[]) => {
    const r = applyAIActions(ed.current(), actions, { currentPage: Math.max(0, ed.pageIndex) });
    if (!r.applied) throw new Error(r.skipped.slice(0, 3).join('; ') || t('Nothing to apply'));
    ed.set(r.doc, 'AI edit');
    if (r.page !== undefined) ed.goToPage(r.doc.pages[Math.min(r.page, r.doc.pages.length - 1)].id);
    else if (!r.doc.pages.some((p) => p.id === ed.pageId) && ed.pageId !== MASTER_ID) ed.goToPage(0);
    if (r.created.length) setTimeout(() => ed.setSelection(r.created), 0);
    setShowStart(false);
    return r.skipped.length ? t('{n} change(s) applied, {m} skipped', { n: r.applied, m: r.skipped.length }) : t('{n} change(s) applied', { n: r.applied });
  };

  /* --------------------------------- UI --------------------------------- */

  const menuActions: MenuActions = {
      newDoc: (tabName) => setNewDoc(tabName),
      open: () => void pickAndOpen(),
      save: (asNew) => void save(asNew),
      placeImage: () => void pickImageFor(),
      exportAs: setExportFormat,
      copy: () => {
        const text = copySelection();
        if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
      },
      cut: () => {
        const text = copySelection();
        if (text) {
          void navigator.clipboard?.writeText(text).catch(() => undefined);
          ed.deleteSelection();
        }
      },
      paste: () => void pasteFromMenu(),
      fit,
      actualSize: () => canvas.current?.actualSize(),
      zoomIn: () => canvas.current?.vp.zoomIn(),
      zoomOut: () => canvas.current?.vp.zoomOut(),
      brief: () => setAIDialog({ kind: 'brief' }),
      rewrite: () => {
        const f = ed.selected.find((x) => x.type === 'text');
        if (f) setAIDialog({ kind: 'rewrite', frameId: f.id });
      },
      copywriter: () => setAIDialog({ kind: 'copy' }),
      toggleAI,
  };
  const menus = buildMenus(ed, menuActions, t);

  const tools: { id: Tool; icon: typeof Type; label: string; key: string }[] = [
    { id: 'select', icon: MousePointer2, label: t('Select'), key: 'V' },
    { id: 'text', icon: Type, label: t('Text frame'), key: 'T' },
    { id: 'image', icon: ImageIcon, label: t('Image frame'), key: 'F' },
    { id: 'rect', icon: Square, label: t('Rectangle'), key: 'R' },
    { id: 'ellipse', icon: Circle, label: t('Ellipse'), key: 'E' },
    { id: 'line', icon: Minus, label: t('Line'), key: 'L' },
    { id: 'table', icon: Table2, label: t('Table'), key: '' },
    { id: 'hand', icon: Hand, label: t('Hand (hold Space)'), key: 'H' },
  ];

  const single = ed.selected.length === 1 ? ed.selected[0] : null;
  const overflowCount = [...ed.flows.values()].filter((f) => f.overflow).length;
  const preset = getPreset(ed.page.preset);

  const right = (
    <div className="ly-right">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'design', label: t('Design') },
          { value: 'styles', label: t('Styles') },
          { value: 'layers', label: t('Layers') },
        ]}
      />
      <div className="ly-right-scroll">
        {tab === 'design' &&
          (ed.selected.length ? (
            <>
              <ArrangePanel ed={ed} />
              {single?.type === 'text' && <TextPanel ed={ed} frame={single} />}
              {single?.type === 'image' && <ImagePanel ed={ed} frame={single} onPlace={() => void pickImageFor(single.id)} />}
              {single?.type === 'shape' && <ShapePanel ed={ed} frame={single} />}
              {single?.type === 'table' && <TablePanel ed={ed} frame={single} />}
              {single && <ShadowPanel ed={ed} frame={single} />}
            </>
          ) : (
            <PagePanel ed={ed} />
          ))}
        {tab === 'styles' && <StylesPanel ed={ed} />}
        {tab === 'layers' && <LayersPanel ed={ed} />}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="ly-root">
      <ModuleLayout
        moduleId="layout"
        title={localizeDefaultName(t, doc.name, DEFAULT_DOC_NAMES)}
        dirty={ed.dirty}
        menus={menus}
        toolbar={
          <>
            <IconButton icon={ZoomOut} size="sm" label={t('Zoom out')} onClick={() => canvas.current?.vp.zoomOut()} />
            <button type="button" className="btn sm ghost ly-zoom" onClick={fit} title={t('Fit page')}>
              {formatZoom(zoom)}
            </button>
            <IconButton icon={ZoomIn} size="sm" label={t('Zoom in')} onClick={() => canvas.current?.vp.zoomIn()} />
            <span className="vsep" />
            <Segmented
              value={ed.view.mode}
              onChange={(mode) => ed.setView((v) => ({ ...v, mode }))}
              options={[
                { value: 'single', label: t('Page') },
                { value: 'continuous', label: t('Scroll') },
              ]}
            />
            <span className="vsep" />
            <Button size="sm" variant="ghost" icon={LayoutTemplate} onClick={() => setNewDoc('templates')}>
              {t('Templates')}
            </Button>
            <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => setAIDialog({ kind: 'brief' })}>
              {t('AI design')}
            </Button>
          </>
        }
        actions={
          <Button size="sm" variant="primary" onClick={() => setExportFormat('pdf')}>
            {t('Export')}
          </Button>
        }
        left={
          <div className="toolbar-v">
            {tools.map((tool) => (
              <ToolButton key={tool.id} icon={tool.icon} label={tool.label} shortcut={tool.key || undefined} active={ed.tool === tool.id} onClick={() => ed.setTool(tool.id)} />
            ))}
          </div>
        }
        right={right}
        bottom={<PagesStrip ed={ed} />}
        bottomHeight={136}
        status={
          <>
            <span>{ed.pageId === MASTER_ID ? t('Master page') : t('Page {n} of {count}', { n: ed.pageIndex + 1, count: doc.pages.length })}</span>
            <span>
              {preset ? `${t(preset.name)} · ` : ''}
              {describeSize(ed.page.width, ed.page.height, doc.unit)}
            </span>
            <span>{formatZoom(zoom)}</span>
            {ed.selection.length > 0 && <span>{t('{n} selected', { n: ed.selection.length })}</span>}
            {overflowCount > 0 && <span className="ly-status-warn">{t('{n} text frame(s) overflow', { n: overflowCount })}</span>}
            <span className="spacer" />
            <span className="faint">{t('Double-click text to edit · Alt+drag duplicates · Shift keeps proportions')}</span>
          </>
        }
        ai={
          <AIAssistantPanel
            moduleId="layout"
            moduleName="Layout & Publishing module"
            instructions={LAYOUT_AI_INSTRUCTIONS}
            getContext={aiContext}
            onActions={onAIActions}
            canSnapshot
            suggestions={[t('Make the headline bigger and bolder'), t('Use a warmer color palette'), t('Add a footer with page numbers'), t('Tidy up the layout and align everything')]}
            placeholder={t('Ask the AI to change your design…')}
          />
        }
      >
        <Canvas
          ed={ed}
          active={active}
          apiRef={canvas}
          onZoom={setZoom}
          onPickImage={(id) => void pickImageFor(id)}
          onContextMenu={(e, frame) => ctx.show(e.clientX, e.clientY, contextEntries(frame))}
        />
        {showStart && (
          <StartScreen
            onTemplate={(d) => void startDocument(d)}
            onBlank={(d) => void startDocument(d)}
            onOpen={() => void pickAndOpen()}
            onClose={() => setShowStart(false)}
          />
        )}
      </ModuleLayout>
      <DropOverlay show={dragging} label={t('Drop images to place them, or a .ultima project to open it')} />
      {ctx.element}
      {newDoc && <NewDocDialog initialTab={newDoc} onClose={() => setNewDoc(null)} onCreate={(d) => void startDocument(d)} />}
      {exportFormat && <ExportDialog doc={doc} flows={ed.flows} currentPage={ed.pageIndex} initialFormat={exportFormat} onClose={() => setExportFormat(null)} />}
      {aiDialog && <AIDialogsHost dialog={aiDialog} ed={ed} onClose={() => setAIDialog(null)} />}
    </div>
  );

  function contextEntries(frame: Frame | null) {
    const sel = frame ? ed.selected : [];
    const entries: MenuEntry[] = [];
    if (frame) {
      if (frame.type === 'text') {
        entries.push({ label: t('Edit text'), onClick: () => ed.beginEdit(frame.id) });
        entries.push({ label: t('Rewrite with AI…'), icon: Sparkles, onClick: () => setAIDialog({ kind: 'rewrite', frameId: frame.id }) });
        if (ed.pageId !== MASTER_ID) entries.push({ label: t('Continue text in another frame…'), onClick: () => ed.startLink(frame.id) });
        entries.push({ type: 'separator' });
      }
      if (frame.type === 'image') {
        entries.push({ label: frame.assetId ? t('Replace image…') : t('Place image…'), onClick: () => void pickImageFor(frame.id) });
        if (frame.assetId) entries.push({ label: t('Adjust image position'), onClick: () => ed.setContentId(frame.id) });
        entries.push({ type: 'separator' });
      }
      entries.push(
        { label: t('Cut'), onClick: menuActions.cut },
        { label: t('Copy'), onClick: menuActions.copy },
        { label: t('Duplicate'), onClick: () => ed.duplicateSelection() },
        { label: t('Delete'), onClick: () => ed.deleteSelection() },
        { type: 'separator' },
        { label: t('Bring to front'), onClick: () => ed.reorder('front') },
        { label: t('Send to back'), onClick: () => ed.reorder('back') },
      );
      if (sel.length > 1) entries.push({ label: t('Group'), onClick: () => ed.group() });
      if (sel.some((f) => f.groupId)) entries.push({ label: t('Ungroup'), onClick: () => ed.ungroup() });
      entries.push({ label: t('Lock'), onClick: () => ed.toggleLock() });
    } else {
      entries.push(
        { label: t('Paste'), onClick: () => void pasteFromMenu() },
        { label: t('Place image…'), onClick: () => void pickImageFor() },
        { type: 'separator' },
        { label: t('Add page'), onClick: () => ed.addPage(false) },
        { label: t('Fit page'), onClick: fit },
      );
    }
    return entries;
  }
}
