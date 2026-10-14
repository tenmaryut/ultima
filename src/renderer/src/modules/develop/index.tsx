import './i18n';
import './develop.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, Crop, Download, FolderOpen, ImagePlus, Maximize, SquareSplitHorizontal, TriangleAlert } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { localizeDefaultName, useT } from '../../core/i18n';
import { useFileDrop, useHandoffs } from '../../core/hooks';
import { useModuleCommands, useModuleKeydown } from '../../core/commands';
import { pickFiles, isMac } from '../../core/platform';
import { useAppStore } from '../../core/store';
import { formatZoom } from '../../core/viewport';
import { fileExtension } from '../../core/utils/format';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel } from '../../components/ai/AIAssistantPanel';
import { Button, DropOverlay, EmptyState, IconButton, Kbd, Modal, Panel, Segmented, confirmDialog, toast, useContextMenu } from '../../components/ui';
import { developInstructions } from './ai';
import { assistantContext, executeActions } from './aiFeatures';
import { saveCatalog, openCatalog } from './catalogio';
import { parseCatalog } from './catalog';
import { PHOTO_ACCEPT, urlToFile } from './decode';
import { createVirtualCopy, importFiles, missingCount, relinkFiles, releaseAll, removeFromLibrary, startThumbnailWatcher } from './library';
import { copySettings, DEFAULT_COPY_GROUPS, pasteSettings, resetAll, rotatePhotos, syncSettings, autoToneFor } from './ops';
import { allPresets, usePresetStore } from './presets';
import { isEdited, pickGroups } from './params';
import {
  redo,
  replaceLibrary,
  selectAll,
  selectedIds,
  selectNone,
  setFilter,
  setFlag,
  setLabel,
  setRating,
  setStore,
  setView,
  stepActive,
  undo,
  useDevelop,
  type DevelopState,
} from './store';
import { LABELS, canDevelop } from './types';
import { useActivePhoto } from './ui/common';
import { HistogramView } from './ui/Histogram';
import { BasicPanel, DetailPanel, EffectsPanel } from './ui/panels';
import { ToneCurvePanel } from './ui/ToneCurve';
import { GradingPanel, HslPanel } from './ui/ColorPanels';
import { swapAspect, TransformPanel } from './ui/TransformPanel';
import { DevelopView, viewportRef } from './ui/DevelopView';
import { Filmstrip } from './ui/Filmstrip';
import { LibraryGrid, gridColumns } from './ui/LibraryGrid';
import { HistoryPanel, PresetsPanel } from './ui/LeftPanels';
import { MetadataPanel, QuickDevelopPanel } from './ui/LibraryPanels';
import { ExportDialog, GroupsDialog, SaveCatalogDialog } from './ui/dialogs';
import { AIAutoEditDialog, CullDialog, DescribeLookDialog } from './ui/AIDialogs';
import { buildMenus, photoContextMenu, SHORTCUTS, type MenuActions } from './ui/menus';

type Dialog =
  | { kind: 'export'; ids: string[] }
  | { kind: 'save'; saveAs: boolean }
  | { kind: 'copy' }
  | { kind: 'sync' }
  | { kind: 'savePreset' }
  | { kind: 'aiAutoEdit'; ids: string[] }
  | { kind: 'look' }
  | { kind: 'cull'; ids: string[] }
  | { kind: 'shortcuts' };

const OVERLAYS: DevelopState['overlay'][] = ['thirds', 'grid', 'golden', 'none'];

export default function DevelopModule({ active }: ModuleProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const view = useDevelop((s) => s.view);
  const total = useDevelop((s) => s.order.length);
  const selectedCount = useDevelop((s) => s.selected.length);
  const catalogName = useDevelop((s) => s.catalogName);
  const dirty = useDevelop((s) => s.dirty);
  const compare = useDevelop((s) => s.compare);
  const cropMode = useDevelop((s) => s.cropMode);
  const showClipping = useDevelop((s) => s.showClipping);
  const zoom = useDevelop((s) => s.zoom);
  const photo = useActivePhoto();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const ctxMenu = useContextMenu();
  usePresetStore((s) => s.user);
  const missing = useDevelop((s) => s.order.filter((id) => s.photos[id]?.kind === 'missing' && !s.photos[id]?.masterId).length);

  useEffect(() => startThumbnailWatcher(), []);

  /* ------------------------------- open / import ------------------------------- */
  const openCatalogFile = async (file: File) => {
    const s = useDevelop.getState();
    if (s.order.length && s.dirty) {
      const ok = await confirmDialog({ title: t('Open catalog “{name}”?', { name: file.name }), message: t('The current library has unsaved changes. They will be lost.'), confirmLabel: t('Open'), danger: true });
      if (!ok) return;
    }
    try {
      const n = await openCatalog(file);
      setView(useDevelop.getState().order.length ? useDevelop.getState().view : 'library');
      toast.success(t('Catalog “{name}” opened', { name: useDevelop.getState().catalogName }));
      if (n) toast.warning(t('{count} photo(s) need their original files', { count: n }), t('Use “Locate files…” (or drop the files here) to re-import them — your edits are matched by file name.'));
    } catch (error) {
      toast.error(t('Could not open the catalog'), error instanceof Error ? error.message : String(error));
    }
  };

  const openFiles = async (files: File[]) => {
    const catalogs = files.filter((f) => fileExtension(f.name) === 'ultima');
    const images = files.filter((f) => fileExtension(f.name) !== 'ultima');
    if (catalogs.length) await openCatalogFile(catalogs[0]);
    if (images.length) {
      try {
        await importFiles(images);
      } catch (error) {
        toast.error(t('Import failed'), error instanceof Error ? error.message : String(error));
      }
    }
  };

  const importDialog = async () => {
    const files = await pickFiles({ accept: `${PHOTO_ACCEPT},.ultima`, multiple: true });
    if (files.length) await openFiles(files);
  };
  const openCatalogDialog = async () => {
    const files = await pickFiles({ accept: '.ultima,application/json', multiple: false });
    if (files[0]) await openCatalogFile(files[0]);
  };
  const relinkDialog = async () => {
    const files = await pickFiles({ accept: PHOTO_ACCEPT, multiple: true });
    if (files.length && !(await relinkFiles(files)).size) toast.warning(t('No file matched the missing photo names'));
  };

  const dragging = useFileDrop(rootRef, (files) => void openFiles(files), active);

  useHandoffs('develop', (items) => {
    void (async () => {
      for (const item of items) {
        try {
          if (item.kind === 'files' && item.files?.length) await openFiles(item.files);
          else if (item.kind === 'image' && item.image) await importFiles([await urlToFile(item.image, `${item.title || 'image'}.png`)]);
          else if (item.kind === 'json' && item.json) {
            const parsed = parseCatalog(item.json);
            const blob = new Blob([JSON.stringify(item.json)], { type: 'application/json' });
            await openCatalogFile(new File([blob], `${parsed.name}.ultima`));
          }
        } catch (error) {
          toast.error(t('Could not open this item'), error instanceof Error ? error.message : String(error));
        }
      }
    })();
  });

  /* ---------------------------------- actions ---------------------------------- */
  const newCatalog = async () => {
    const s = useDevelop.getState();
    if (s.order.length && s.dirty && !(await confirmDialog({ title: t('Start a new catalog?'), message: t('The current library has unsaved changes. They will be lost.'), confirmLabel: t('New Catalog'), danger: true }))) return;
    releaseAll();
    replaceLibrary([], { name: 'Untitled catalog' });
    setStore({ view: 'library', histogram: null, catalogPath: undefined });
  };

  const save = () => {
    const s = useDevelop.getState();
    if (!s.order.length) return toast.info(t('The library is empty — import photos first.'));
    if (s.catalogPath) {
      void saveCatalog({ embed: s.catalogEmbed }).catch((error: unknown) => toast.error(t('Could not save the catalog'), error instanceof Error ? error.message : String(error)));
    } else setDialog({ kind: 'save', saveAs: false });
  };

  const exportSelected = () => {
    const ids = selectedIds();
    if (!ids.length) return toast.info(t('Select photos to export first.'));
    setDialog({ kind: 'export', ids });
  };

  const removeSelected = async () => {
    const ids = selectedIds();
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: t('Remove {count} photo(s) from the library?', { count: ids.length }),
      message: t('The files on disk are not deleted. Their edits are removed from this catalog.'),
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (ok) removeFromLibrary(ids);
  };

  const actions: MenuActions = {
    importPhotos: () => void importDialog(),
    openCatalog: () => void openCatalogDialog(),
    newCatalog: () => void newCatalog(),
    save,
    saveAs: () => setDialog({ kind: 'save', saveAs: true }),
    relink: () => void relinkDialog(),
    exportSelected,
    undo: () => void undo(),
    redo: () => void redo(),
    copySettings: () => useDevelop.getState().activeId && setDialog({ kind: 'copy' }),
    syncSettings: () => (selectedIds().length > 1 ? setDialog({ kind: 'sync' }) : toast.info(t('Select two or more photos to sync settings.'))),
    removeSelected: () => void removeSelected(),
    savePreset: () => useDevelop.getState().activeId && setDialog({ kind: 'savePreset' }),
    aiAutoEdit: () => setDialog({ kind: 'aiAutoEdit', ids: selectedIds() }),
    describeLook: () => setDialog({ kind: 'look' }),
    aiCull: () => setDialog({ kind: 'cull', ids: selectedIds() }),
    toggleAI: () => useAppStore.getState().toggleAIPanel(),
    shortcuts: () => setDialog({ kind: 'shortcuts' }),
  };

  const zoomCmd = (fn: 'zoomIn' | 'zoomOut' | 'fit' | 'actualSize') => {
    if (useDevelop.getState().view === 'develop') viewportRef.current?.[fn]();
    else {
      const size = useDevelop.getState().thumbSize;
      if (fn === 'zoomIn') setStore({ thumbSize: Math.min(300, size + 30) });
      else if (fn === 'zoomOut') setStore({ thumbSize: Math.max(110, size - 30) });
      else setStore({ thumbSize: 168 });
    }
  };

  useModuleCommands('develop', {
    new: () => void newCatalog(),
    open: () => void importDialog(),
    save,
    'save-as': () => setDialog({ kind: 'save', saveAs: true }),
    export: exportSelected,
    undo: () => void undo(),
    redo: () => void redo(),
    delete: () => void removeSelected(),
    duplicate: () => {
      const id = useDevelop.getState().activeId;
      if (id) createVirtualCopy(id);
    },
    'select-all': selectAll,
    deselect: selectNone,
    'zoom-in': () => zoomCmd('zoomIn'),
    'zoom-out': () => zoomCmd('zoomOut'),
    'zoom-fit': () => zoomCmd('fit'),
    'zoom-100': () => zoomCmd('actualSize'),
  });

  /* --------------------------------- keyboard --------------------------------- */
  useModuleKeydown(active, (e) => {
    if (document.querySelector('.modal-backdrop')) return;
    const target = e.target as HTMLElement | null;
    // sliders keep their own arrow/home/end keys
    if (target?.tagName === 'INPUT' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
    const s = useDevelop.getState();
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    const sel = selectedIds();
    if (mod && !e.altKey) {
      let handled = true;
      if (e.shiftKey && key === 'c') actions.copySettings();
      else if (e.shiftKey && key === 'v') pasteSettings(sel);
      else if (e.shiftKey && key === 'r') resetAll(sel);
      else if (!e.shiftKey && key === 'a') selectAll();
      else if (!e.shiftKey && key === 'u') void autoToneFor(sel);
      else if (key === '[') rotatePhotos(sel, -1);
      else if (key === ']') rotatePhotos(sel, 1);
      else handled = false;
      if (handled) e.preventDefault();
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const develop = s.view === 'develop';
    let handled = true;
    switch (e.key) {
      case 'g':
      case 'G':
        setView('library');
        break;
      case 'd':
      case 'D':
      case 'e':
      case 'E':
        if (s.order.length) setView('develop');
        break;
      case 'Enter':
        if (!develop && s.activeId) setView('develop');
        else handled = false;
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        setRating(sel, Number(e.key));
        break;
      case '6':
      case '7':
      case '8':
      case '9':
        setLabel(sel, LABELS[Number(e.key) - 6]);
        break;
      case 'p':
      case 'P':
        setFlag(sel, 'pick');
        break;
      case 'x':
      case 'X':
        if (develop && s.cropMode && s.activeId) swapAspect(s.photos[s.activeId]);
        else setFlag(sel, 'reject');
        break;
      case 'u':
      case 'U':
        setFlag(sel, null);
        break;
      case '\\':
        setStore({ compare: s.compare === 'before' ? 'off' : 'before', view: 'develop' });
        break;
      case 'y':
      case 'Y':
        setStore({ compare: s.compare === 'split' ? 'off' : 'split', view: 'develop' });
        break;
      case 'j':
      case 'J':
        setStore({ showClipping: !s.showClipping });
        break;
      case 'r':
      case 'R':
        if (s.activeId) setStore({ cropMode: !s.cropMode, view: 'develop', tool: 'none' });
        break;
      case 'w':
      case 'W':
        if (s.activeId) setStore({ tool: s.tool === 'wb' ? 'none' : 'wb', cropMode: false, view: 'develop' });
        break;
      case 'o':
      case 'O':
        setStore({ overlay: OVERLAYS[(OVERLAYS.indexOf(s.overlay) + 1) % OVERLAYS.length] });
        break;
      case 'z':
      case 'Z':
        if (develop) {
          const vp = viewportRef.current;
          if (vp) {
            if (vp.zoom < 0.999) vp.actualSize();
            else vp.fit();
          }
        } else handled = false;
        break;
      case 'Escape':
        if (s.cropMode) setStore({ cropMode: false });
        else if (s.tool !== 'none') setStore({ tool: 'none' });
        else if (s.compare !== 'off') setStore({ compare: 'off' });
        else handled = false;
        break;
      case 'ArrowLeft':
        stepActive(-1);
        break;
      case 'ArrowRight':
        stepActive(1);
        break;
      case 'ArrowUp':
        stepActive(develop ? -1 : -gridColumns());
        break;
      case 'ArrowDown':
        stepActive(develop ? 1 : gridColumns());
        break;
      case 'Home':
        stepActive(-1e9);
        break;
      case 'End':
        stepActive(1e9);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  /* ---------------------------------- layout ---------------------------------- */
  const menus = useMemo(() => buildMenus(t, actions), [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPhotoMenu = (e: React.MouseEvent, id: string) => ctxMenu.open(photoContextMenu(t, actions, id))(e);
  const editable = Boolean(photo && canDevelop(photo));
  const instructions = useMemo(() => developInstructions(allPresets().map((p) => p.name)), [usePresetStore.getState().user.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toolbar = (
    <>
      <Segmented
        value={view}
        onChange={(v) => (v === 'develop' && !total ? toast.info(t('Import photos first.')) : setView(v))}
        options={[
          { value: 'library', label: t('Library'), title: `${t('Library')} (G)` },
          { value: 'develop', label: t('Develop'), title: `${t('Develop')} (D)` },
        ]}
      />
      {view === 'develop' && editable && (
        <>
          <span className="vsep" />
          <IconButton icon={Columns2} label={`${t('Before / After')} (\\)`} active={compare === 'before'} onClick={() => setStore({ compare: compare === 'before' ? 'off' : 'before' })} />
          <IconButton icon={SquareSplitHorizontal} label={`${t('Split Compare')} (Y)`} active={compare === 'split'} onClick={() => setStore({ compare: compare === 'split' ? 'off' : 'split' })} />
          <IconButton icon={TriangleAlert} label={`${t('Show Clipping')} (J)`} active={showClipping} onClick={() => setStore({ showClipping: !showClipping })} />
          <IconButton icon={Crop} label={`${t('Crop & Straighten')} (R)`} active={cropMode} onClick={() => setStore({ cropMode: !cropMode, tool: 'none' })} />
          <span className="vsep" />
          <IconButton icon={Maximize} label={`${t('Zoom to Fit')} (Ctrl+0)`} onClick={() => viewportRef.current?.fit()} />
          <Button size="sm" variant="ghost" onClick={() => viewportRef.current?.actualSize()} title={`${t('Zoom 100%')} (Ctrl+1)`}>
            1:1
          </Button>
        </>
      )}
    </>
  );

  const left =
    view === 'develop' ? (
      <div className="dv-left dv-scroll">
        <PresetsPanel photo={editable ? photo : undefined} onSavePreset={() => setDialog({ kind: 'savePreset' })} />
        <HistoryPanel photo={photo} />
      </div>
    ) : (
      <div className="dv-left dv-scroll">
        <LibraryNav />
      </div>
    );

  const right =
    view === 'develop' ? (
      <>
        <Panel title={t('Histogram')}>
          <HistogramView photo={photo} />
        </Panel>
        {editable && photo && (
          <>
            <BasicPanel photo={photo} />
            <ToneCurvePanel photo={photo} />
            <HslPanel photo={photo} />
            <GradingPanel photo={photo} />
            <DetailPanel photo={photo} />
            <EffectsPanel photo={photo} />
            <TransformPanel photo={photo} />
          </>
        )}
      </>
    ) : (
      <>
        <QuickDevelopPanel
          onCopy={actions.copySettings}
          onSync={actions.syncSettings}
          onAIAutoEdit={actions.aiAutoEdit}
          onAICull={actions.aiCull}
        />
        <MetadataPanel photo={photo} />
      </>
    );

  const status = (
    <>
      <span>{t('{count} photos', { count: total })}</span>
      {selectedCount > 1 && <span>{t('{count} selected', { count: selectedCount })}</span>}
      {photo && (
        <span>
          {photo.name}
          {photo.width ? ` · ${photo.width} × ${photo.height}` : ''}
        </span>
      )}
      {view === 'develop' && photo && <span>{formatZoom(zoom)}</span>}
      {missing > 0 && <span style={{ color: 'var(--warning)' }}>{t('{count} missing', { count: missing })}</span>}
      <span className="spacer" />
      <span className="faint">{t('Non-destructive · GPU (WebGL 2)')}</span>
    </>
  );

  return (
    <ModuleLayout
      moduleId="develop"
      title={localizeDefaultName(t, catalogName, ['Untitled catalog'])}
      dirty={dirty && total > 0}
      menus={menus}
      toolbar={toolbar}
      actions={
        <>
          <Button size="sm" icon={ImagePlus} onClick={() => void importDialog()}>
            {t('Import')}
          </Button>
          <Button size="sm" variant="primary" icon={Download} disabled={!total} onClick={exportSelected}>
            {t('Export')}
          </Button>
        </>
      }
      left={left}
      right={right}
      rightWidth={300}
      bottom={view === 'develop' && total > 0 ? <Filmstrip onMenu={onPhotoMenu} /> : undefined}
      bottomHeight={104}
      status={status}
      ai={
        <AIAssistantPanel
          moduleId="develop"
          moduleName="Photo Develop"
          instructions={instructions}
          getContext={assistantContext}
          onActions={(list) => executeActions(list)}
          canSnapshot
          suggestions={[t('Auto-enhance this photo'), t('Make it warm and cinematic'), t('Black & white with punchy contrast'), t('Recover the highlights and lift the shadows')]}
        />
      }
    >
      <div ref={rootRef} className="dv-root">
        <DropOverlay show={dragging} label={t('Drop photos or a catalog to import')} />
        {missing > 0 && (
          <div className="dv-banner">
            <TriangleAlert size={15} color="var(--warning)" />
            <span className="grow">{t('{count} photo(s) in this catalog need their original files. Your edits are kept and re-applied by file name.', { count: missing })}</span>
            <Button size="sm" onClick={() => void relinkDialog()}>
              {t('Locate files…')}
            </Button>
          </div>
        )}
        {total === 0 ? (
          <EmptyState icon={<ImagePlus size={36} />} title={t('Develop your photos')}>
            <span style={{ maxWidth: 520 }}>{t('Import a shoot to rate, cull and develop it non-destructively — then export everything at once. JPEG, PNG, WebP, AVIF, TIFF and the previews inside RAW files are supported.')}</span>
            <div className="row">
              <Button variant="primary" icon={ImagePlus} onClick={() => void importDialog()}>
                {t('Import Photos…')}
              </Button>
              <Button icon={FolderOpen} onClick={() => void openCatalogDialog()}>
                {t('Open Catalog…')}
              </Button>
            </div>
            <span className="faint">{t('or drop photos here')}</span>
          </EmptyState>
        ) : view === 'library' ? (
          <LibraryGrid onMenu={onPhotoMenu} />
        ) : (
          <DevelopView active={active && view === 'develop'} />
        )}
      </div>
      {ctxMenu.element}
      {dialog?.kind === 'export' && <ExportDialog ids={dialog.ids} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'save' && <SaveCatalogDialog saveAs={dialog.saveAs} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'copy' && (
        <GroupsDialog title={t('Copy Settings')} confirmLabel={t('Copy')} initial={useDevelop.getState().clipboard?.groups ?? DEFAULT_COPY_GROUPS} onConfirm={(groups) => copySettings(groups)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'sync' && (
        <GroupsDialog title={t('Sync Settings to {count} photo(s)', { count: selectedIds().length - 1 })} confirmLabel={t('Synchronize')} initial={DEFAULT_COPY_GROUPS} onConfirm={(groups) => syncSettings(selectedIds(), groups)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'savePreset' && photo && (
        <GroupsDialog
          title={t('New Preset')}
          confirmLabel={t('Create')}
          nameLabel={t('Preset name')}
          defaultName={t('My preset')}
          initial={DEFAULT_COPY_GROUPS}
          onConfirm={(groups, name) => {
            usePresetStore.getState().add(name, pickGroups(photo.settings, groups));
            toast.success(t('Preset “{name}” saved', { name }));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'aiAutoEdit' && <AIAutoEditDialog ids={dialog.ids} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'look' && <DescribeLookDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'cull' && <CullDialog ids={dialog.ids} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'shortcuts' && (
        <Modal title={t('Keyboard Shortcuts')} onClose={() => setDialog(null)}>
          <div className="dv-kbd-list">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} style={{ display: 'contents' }}>
                <span>
                  <Kbd>{k}</Kbd>
                </span>
                <span>{t(d)}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </ModuleLayout>
  );
}

/** Library left panel: quick collections and catalog actions. */
function LibraryNav() {
  const t = useT();
  const photos = useDevelop((s) => s.photos);
  const order = useDevelop((s) => s.order);
  const filter = useDevelop((s) => s.filter);
  const list = order.map((id) => photos[id]).filter(Boolean);
  const count = (fn: (p: (typeof list)[number]) => boolean) => list.filter(fn).length;
  const entries: { label: string; n: number; apply: () => void; active: boolean }[] = [
    { label: t('All photographs'), n: list.length, apply: () => setFilter({ rating: 0, ratingOp: '>=', flag: 'all', label: 'any', edited: 'all', text: '' }), active: filter.flag === 'all' && filter.rating === 0 && filter.ratingOp === '>=' && filter.edited === 'all' && filter.label === 'any' },
    { label: t('Picked'), n: count((p) => p.flag === 'pick'), apply: () => setFilter({ flag: 'picked' }), active: filter.flag === 'picked' },
    { label: t('Rejected'), n: count((p) => p.flag === 'reject'), apply: () => setFilter({ flag: 'rejected' }), active: filter.flag === 'rejected' },
    { label: t('Unrated'), n: count((p) => p.rating === 0), apply: () => setFilter({ rating: 0, ratingOp: '=' }), active: filter.rating === 0 && filter.ratingOp === '=' },
    { label: t('3 stars and up'), n: count((p) => p.rating >= 3), apply: () => setFilter({ rating: 3, ratingOp: '>=' }), active: filter.rating === 3 && filter.ratingOp === '>=' },
    { label: t('Edited'), n: count((p) => isEdited(p.settings)), apply: () => setFilter({ edited: 'edited' }), active: filter.edited === 'edited' },
  ];
  return (
    <Panel title={t('Catalog')}>
      <div style={{ margin: '0 -6px' }}>
        {entries.map((e) => (
          <div key={e.label} className={`dv-list-item ${e.active ? 'current' : ''}`} onClick={e.apply}>
            <span className="grow">{e.label}</span>
            <span className="faint">{e.n}</span>
          </div>
        ))}
      </div>
      {missingCount() > 0 && <span className="dv-hint" style={{ color: 'var(--warning)' }}>{t('{count} missing', { count: missingCount() })}</span>}
    </Panel>
  );
}
