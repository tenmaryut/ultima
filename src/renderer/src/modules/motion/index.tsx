import './i18n';
import './motion.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Wand2 } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { useModuleCommands } from '../../core/commands';
import { useAnimationFrame } from '../../core/hooks';
import { useHistoryState } from '../../core/history';
import { localizeDefaultName, useT } from '../../core/i18n';
import { pickFiles } from '../../core/platform';
import { canvasToAIImage } from '../../core/utils/image';
import { formatTime } from '../../core/utils/format';
import { formatZoom, useViewport } from '../../core/viewport';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel } from '../../components/ai/AIAssistantPanel';
import { Button, DropOverlay, Tabs, toast } from '../../components/ui';
import { applyAIActions, type AIApplyContext } from './ai-actions';
import { describeDocument, MOTION_AI_INSTRUCTIONS } from './ai-prompts';
import { AnimateDialog, SuggestDialog, type ApplyOptions } from './ai-features';
import { worldBounds } from './bounds';
import { CompositionDialog, CurvePopover, ExportDialog } from './dialogs';
import { evaluateDoc } from './evaluate';
import { renderStill, type ExportFormat } from './export';
import { addMediaLayer } from './files';
import { adjacentTime } from './keyframes';
import { applyVector, invert } from './matrix';
import { ImageCache, previewMedia, revokeAssets, VideoPool } from './media';
import { buildMenus, addLayerEntries, presetEntries, ToolPalette } from './menus';
import {
  animatedProps,
  cloneLayers,
  createDoc,
  createLayer,
  duplicateLayers,
  layerById,
  parentMatrixAt,
  removeLayers,
  reorderLayers,
  setDuration,
  uniqueName,
  updateLayer,
} from './model';
import { allKeyTimes, copyKeys, deleteKeys, easyEase, insertLayers, pasteKeys, removeAllAnimation, trimToWorkArea } from './ops';
import { CompositionPanel, MediaSection, MultiSelection, PresetsPanel } from './panels';
import { applyPreset, presetInfo, type PresetId } from './presets';
import { LayerProperties } from './PropertiesPanel';
import { Stage } from './Stage';
import { buildKeyIndex, clipboard, createTimeStore, EditorContext, useTime, type EditorApi, type ToolId } from './state';
import { Timeline, type ExpandMode } from './Timeline';
import { lastFrameTime, quantize, formatTimecode, frameOf } from './timeline-math';
import type { Composition, Layer, LayerType, MotionDoc, ShapeKind } from './types';
import { useMotionFiles } from './useMotionFiles';
import { useMotionKeys } from './useMotionKeys';

type DialogState =
  | { kind: 'new' }
  | { kind: 'comp' }
  | { kind: 'export'; format?: ExportFormat }
  | { kind: 'animate' }
  | { kind: 'suggest'; layerId: string }
  | null;

function StatusTime({ store, fps }: { store: EditorApi['time']; fps: number }) {
  const t = useTime(store);
  return (
    <span className="mono">
      {formatTimecode(t, fps)} · f{frameOf(t, fps)}
    </span>
  );
}

export default function MotionModule({ active }: ModuleProps) {
  const t = useT();
  const history = useHistoryState<MotionDoc>(() => createDoc());
  const doc = history.present;
  const docRef = useRef(doc);
  docRef.current = doc;
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const time = useMemo(() => createTimeStore(0), []);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [tool, setTool] = useState<ToolId>('select');
  const [snapping, setSnapping] = useState(true);
  const [scaleLinked, setScaleLinked] = useState(true);
  const [expanded, setExpanded] = useState<Map<string, ExpandMode>>(() => new Map());
  const [rightTab, setRightTab] = useState<'props' | 'presets'>('props');
  const [quality, setQuality] = useState(1);
  const [showPaths, setShowPaths] = useState(true);
  const [file, setFile] = useState<{ name: string; path?: string } | null>(null);
  const [savedDoc, setSavedDoc] = useState<MotionDoc>(doc);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [curve, setCurve] = useState<{ x: number; y: number } | null>(null);
  const [focusText, setFocusText] = useState(0);
  const [fitKey, setFitKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const vp = useViewport(containerRef, doc.comp.width, doc.comp.height, { fitKey, active });
  const invalidateRef = useRef<(() => void) | null>(null);
  const images = useMemo(() => new ImageCache(() => invalidateRef.current?.()), []);
  const videos = useMemo(() => new VideoPool(() => invalidateRef.current?.()), []);
  const keyIndex = useMemo(() => buildKeyIndex(doc), [doc]);
  const dirty = doc !== savedDoc;
  const comp = doc.comp;

  useEffect(() => () => videos.dispose(), [videos]);

  /* ----------------------------- Selection hygiene ----------------------------- */

  useEffect(() => {
    setSelected((sel) => {
      const next = sel.filter((id) => doc.layers.some((l) => l.id === id));
      return next.length === sel.length ? sel : next;
    });
    setSelectedKeys((keys) => {
      if (![...keys].some((k) => !keyIndex.has(k))) return keys;
      return new Set([...keys].filter((k) => keyIndex.has(k)));
    });
    videos.prune(doc);
    // Keep the playhead inside the composition.
    const max = lastFrameTime(doc.comp.duration, doc.comp.fps);
    if (time.get() > max) time.set(max);
  }, [doc, keyIndex, videos, time]);

  /* ------------------------------- Time & playback ------------------------------ */

  const seek = useCallback(
    (v: number) => {
      const c = docRef.current.comp;
      time.set(quantize(Math.min(Math.max(0, v), lastFrameTime(c.duration, c.fps)), c.fps));
    },
    [time],
  );
  const playRef = useRef({ t0: 0, start: 0 });
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const togglePlay = useCallback(() => {
    const next = !playingRef.current;
    playingRef.current = next;
    if (next) {
      const c = docRef.current.comp;
      let start = time.get();
      if (start < c.workStart - 1e-6 || start >= c.workEnd - 1 / c.fps - 1e-6) start = c.workStart;
      time.set(quantize(start, c.fps));
      playRef.current = { t0: performance.now(), start };
    }
    setPlaying(next);
  }, [time]);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => videos.setPlaying(playing), [playing, videos]);
  useAnimationFrame(active && playing, (now) => {
    const c = docRef.current.comp;
    const s = playRef.current;
    let tm = s.start + (now - s.t0) / 1000;
    const end = Math.max(c.workStart + 1 / c.fps, c.workEnd);
    if (tm >= end) {
      if (loop) {
        tm = c.workStart;
        playRef.current = { t0: now, start: c.workStart };
      } else {
        setPlaying(false);
        tm = end - 1 / c.fps;
      }
    }
    time.set(Math.floor(tm * c.fps + 1e-6) / c.fps);
  });

  /* ----------------------------------- Editing ---------------------------------- */

  const setDoc = useCallback<EditorApi['setDoc']>((next, options) => history.set(next, options), [history]);
  const editText = useCallback((id: string) => {
    setSelected([id]);
    setRightTab('props');
    setFocusText((n) => n + 1);
  }, []);

  const toParent = (d: MotionDoc, layer: Layer, tm: number) => {
    if (!layer.parentId) return undefined;
    const p = parentMatrixAt(d, layer, tm);
    const inv = invert([p[0], p[1], p[2], p[3], 0, 0]);
    return (dx: number, dy: number) => applyVector(inv, dx, dy) as [number, number];
  };
  const boundsOf = (d: MotionDoc, layer: Layer, tm: number) => {
    const ev = evaluateDoc(d, tm).get(layer.id);
    return ev ? worldBounds(layer, ev, d.assets) : { x: 0, y: 0, w: 0, h: 0 };
  };

  const revealAnimated = useCallback(() => {
    const d = docRef.current;
    const targets = selected.length ? selected : d.layers.map((l) => l.id);
    const animatedTargets = targets.filter((id) => {
      const l = layerById(d, id);
      return l && (animatedProps(l).length || l.wiggles.length);
    });
    const allShown = animatedTargets.length > 0 && animatedTargets.every((id) => expanded.get(id) === 'animated');
    const next = new Map(expanded);
    for (const id of targets) next.delete(id);
    if (!allShown) for (const id of animatedTargets) next.set(id, 'animated');
    setExpanded(next);
  }, [selected, expanded]);

  const api: EditorApi = {
    doc,
    history,
    setDoc,
    commit: history.commit,
    time,
    seek,
    playing,
    togglePlay,
    selected,
    setSelected,
    selectedKeys,
    setSelectedKeys,
    keyIndex,
    tool,
    setTool,
    editText,
    snapping,
    setSnapping,
    revealAnimated,
    scaleLinked,
    setScaleLinked,
  };

  const addLayer = (type: LayerType, shape?: ShapeKind) => {
    const d = docRef.current;
    const layer = createLayer(type, d.comp, { shapeKind: shape, text: t('Your text') }, d.layers.length);
    layer.name = uniqueName(d, layer.name);
    setDoc(insertLayers(d, [layer], selected), { label: 'New layer' });
    setSelected([layer.id]);
    if (type === 'text') editText(layer.id);
  };

  const applyPresetToSelection = (id: PresetId, duration?: number, extra: { frequency?: number; amplitude?: number } = {}) => {
    if (!selected.length) {
      toast.info(t('Select a layer first'));
      return;
    }
    const tm = time.get();
    const dur = duration ?? presetInfo(id).duration;
    let next = docRef.current;
    const problems: string[] = [];
    for (const lid of selected) {
      const layer = layerById(next, lid);
      if (!layer || layer.locked) continue;
      const r = applyPreset(layer, id, { time: tm, duration: dur, comp: next.comp, bounds: boundsOf(next, layer, tm + dur), toParentDelta: toParent(next, layer, tm), ...extra });
      if (r.ok) next = updateLayer(next, lid, () => r.layer);
      else if (r.reason) problems.push(`${layer.name}: ${t(r.reason)}`);
    }
    if (next !== docRef.current) {
      setDoc(next, { label: `Preset: ${presetInfo(id).label}` });
      const exp = new Map(expanded);
      for (const lid of selected) if (!exp.has(lid)) exp.set(lid, 'animated');
      setExpanded(exp);
    }
    if (problems.length) toast.warning(t('Some layers were skipped'), problems.join('\n'));
  };

  /* ----------------------------------- AI ---------------------------------- */

  const aiContext: AIApplyContext = { time: time.get(), bounds: boundsOf, toParentDelta: toParent };
  const applyActions = (actions: unknown[], options: ApplyOptions): string => {
    let base = docRef.current;
    if (options.replace) base = { ...base, layers: [] };
    const r = applyAIActions(base, actions, { ...aiContext, time: time.get() });
    if (r.doc !== docRef.current) {
      setDoc(r.doc, { label: options.label });
      if (r.compositionChanged) setFitKey((k) => k + 1);
    }
    if (r.created.length) setSelected(r.created.slice(-1));
    if (r.notes.length) toast.warning(t('Some AI changes were skipped'), r.notes.slice(0, 6).join('\n'));
    const parts: string[] = [];
    if (r.compositionChanged) parts.push(t('composition updated'));
    if (r.created.length) parts.push(t('{n} layer(s) added', { n: r.created.length }));
    if (r.changedLayers) parts.push(t('{n} layer(s) changed', { n: r.changedLayers }));
    if (r.keyframes) parts.push(t('{n} keyframe(s)', { n: r.keyframes }));
    if (r.presets) parts.push(t('{n} preset(s)', { n: r.presets }));
    if (r.deleted) parts.push(t('{n} layer(s) deleted', { n: r.deleted }));
    return parts.length ? parts.join(' · ') : t('Nothing to change');
  };

  /* --------------------------------- Files --------------------------------- */

  const resetDoc = (next: MotionDoc, name: { name: string; path?: string } | null) => {
    const old = docRef.current;
    history.reset(next);
    setSavedDoc(next);
    setSelected([]);
    setSelectedKeys(new Set());
    setExpanded(new Map());
    setFile(name);
    images.clear();
    time.set(0);
    setPlaying(false);
    setFitKey((k) => k + 1);
    // Old media is unreachable once the history is reset.
    const keep = new Set(Object.keys(next.assets));
    revokeAssets(Object.fromEntries(Object.entries(old.assets).filter(([id]) => !keep.has(id))));
  };

  const { dragging, confirmDiscard, pickImport, pickOpen, save } = useMotionFiles({
    active,
    rootRef,
    docRef,
    dirty,
    selected,
    setDoc,
    setSelected,
    resetDoc,
    file,
    onSaved: (saved, info) => {
      setFile(info);
      setSavedDoc(saved);
    },
  });

  /* ------------------------------ Clipboard etc. ------------------------------ */

  const copy = () => {
    if (selectedKeys.size) {
      clipboard.keys = copyKeys(doc, selectedKeys, keyIndex);
      clipboard.layers = null;
    } else if (selected.length) {
      clipboard.layers = doc.layers.filter((l) => selected.includes(l.id));
      clipboard.assets = doc.assets;
      clipboard.keys = null;
    }
  };
  const paste = () => {
    const d = docRef.current;
    if (clipboard.keys?.length) {
      const r = pasteKeys(d, clipboard.keys, selected, time.get());
      if (r.count) setDoc(r.doc, { label: 'Paste keyframes' });
      else toast.info(t('Select the layer to paste the keyframes into'));
    } else if (clipboard.layers?.length) {
      const source = clipboard.layers.filter((l) => !l.assetId || d.assets[l.assetId] || clipboard.assets[l.assetId]);
      const copies = cloneLayers(source, d);
      const assets = { ...d.assets };
      for (const l of copies) if (l.assetId && !assets[l.assetId]) assets[l.assetId] = clipboard.assets[l.assetId];
      setDoc(insertLayers({ ...d, assets }, copies, selected), { label: 'Paste layers' });
      setSelected(copies.map((l) => l.id));
    }
  };
  const remove = () => {
    if (selectedKeys.size) {
      setDoc((d) => deleteKeys(d, selectedKeys, buildKeyIndex(d), time.get()), { label: 'Delete keyframes' });
      setSelectedKeys(new Set());
    } else if (selected.length) {
      setDoc((d) => removeLayers(d, selected), { label: 'Delete layers' });
      setSelected([]);
    } else return false;
  };
  const duplicate = () => {
    if (!selected.length) return false;
    const r = duplicateLayers(docRef.current, selected);
    setDoc(r.doc, { label: 'Duplicate' });
    setSelected(r.ids);
  };

  const newComposition = async () => {
    if (!(await confirmDiscard())) return;
    setDialog({ kind: 'new' });
  };

  useModuleCommands('motion', {
    new: () => void newComposition(),
    open: () => void pickOpen(),
    save: () => void save(false),
    'save-as': () => void save(true),
    export: () => setDialog({ kind: 'export' }),
    undo: history.undo,
    redo: history.redo,
    delete: remove,
    duplicate,
    'select-all': () => setSelected(doc.layers.map((l) => l.id)),
    deselect: () => {
      setSelected([]);
      setSelectedKeys(new Set());
    },
    'zoom-in': vp.zoomIn,
    'zoom-out': vp.zoomOut,
    'zoom-fit': vp.fit,
    'zoom-100': vp.actualSize,
  });

  useMotionKeys(active, {
    togglePlay,
    stepFrames: (n) => seek(time.get() + n / comp.fps),
    jumpKey: (dir) => {
      const tm = adjacentTime(allKeyTimes(doc, selected), time.get(), dir);
      if (tm !== null) seek(tm);
    },
    revealAnimated,
    goToLayerEdge: (edge) => {
      const l = layerById(doc, selected[0]);
      if (l) seek(edge === 'in' ? l.inPoint : l.outPoint - 1 / comp.fps);
    },
    setWorkArea: (edge) => {
      const tm = time.get();
      setDoc(
        (d) => ({
          ...d,
          comp: edge === 'start' ? { ...d.comp, workStart: Math.min(tm, d.comp.workEnd - 1 / d.comp.fps) } : { ...d.comp, workEnd: Math.max(tm + 1 / d.comp.fps, d.comp.workStart + 1 / d.comp.fps) },
        }),
        { label: 'Work area' },
      );
    },
    trimLayer: (edge) => {
      const tm = time.get();
      setDoc(
        (d) => {
          let next = d;
          for (const id of selected)
            next = updateLayer(next, id, (l) => (edge === 'in' ? (tm < l.outPoint ? { ...l, inPoint: tm } : l) : tm > l.inPoint ? { ...l, outPoint: tm + 1 / d.comp.fps } : l));
          return next;
        },
        { label: 'Trim layer' },
      );
    },
    goToEdge: (edge) => seek(edge === 'start' ? 0 : lastFrameTime(comp.duration, comp.fps)),
    easyEase: () => selectedKeys.size && setDoc((d) => easyEase(d, selectedKeys, buildKeyIndex(d)), { label: 'Easy ease' }),
    copy,
    paste,
    cut: () => {
      copy();
      remove();
    },
    setTool,
    escape: () => setSelectedKeys(new Set()),
  });

  /* ---------------------------------- Layout --------------------------------- */

  const selectedLayer = selected.length === 1 ? layerById(doc, selected[0]) : undefined;
  const addEntries = () => addLayerEntries(t, addLayer, () => void pickImport());
  const menus = buildMenus(t, {
    newDoc: () => void newComposition(),
    open: () => void pickOpen(),
    save: (as) => void save(as),
    importMedia: () => void pickImport(),
    exportAs: (format) => setDialog({ kind: 'export', format }),
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    copy,
    paste,
    cut: () => {
      copy();
      remove();
    },
    duplicate: () => void duplicate(),
    remove: () => void remove(),
    selectAll: () => setSelected(doc.layers.map((l) => l.id)),
    deselect: () => setSelected([]),
    addLayer,
    reorder: (where) => setDoc((d) => reorderLayers(d, selected, where), { label: 'Reorder layers' }),
    hasSelection: selected.length > 0,
    hasKeys: selectedKeys.size > 0,
    applyPreset: (id) => applyPresetToSelection(id),
    easyEase: () => setDoc((d) => easyEase(d, selectedKeys, buildKeyIndex(d)), { label: 'Easy ease' }),
    removeAnimation: () => setDoc((d) => removeAllAnimation(d, selected, time.get()), { label: 'Remove animation' }),
    revealAnimated,
    compSettings: () => setDialog({ kind: 'comp' }),
    trimToWorkArea: () => setDoc((d) => trimToWorkArea(d), { label: 'Trim composition' }),
    workAreaToSelection: () => {
      const ls = doc.layers.filter((l) => selected.includes(l.id));
      if (!ls.length) return;
      const s = Math.max(0, Math.min(...ls.map((l) => l.inPoint)));
      const e = Math.min(comp.duration, Math.max(...ls.map((l) => l.outPoint)));
      if (e > s) setDoc((d) => ({ ...d, comp: { ...d.comp, workStart: s, workEnd: e } }), { label: 'Work area' });
    },
    zoomIn: vp.zoomIn,
    zoomOut: vp.zoomOut,
    fit: vp.fit,
    actual: vp.actualSize,
    quality,
    setQuality,
    showPaths,
    setShowPaths,
    snapping,
    setSnapping,
    animate: () => setDialog({ kind: 'animate' }),
    suggest: () => selected[0] && setDialog({ kind: 'suggest', layerId: selected[0] }),
  });

  const right = (
    <div className="mo-right">
      <Tabs
        value={rightTab}
        onChange={setRightTab}
        tabs={[
          { value: 'props', label: t('Properties') },
          { value: 'presets', label: t('Presets') },
        ]}
      />
      <div className="mo-right-body">
        {rightTab === 'presets' ? (
          <PresetsPanel onApply={(id, d, extra) => applyPresetToSelection(id, d, extra)} onAnimate={() => setDialog({ kind: 'animate' })} />
        ) : selectedLayer ? (
          <LayerProperties
            key={selectedLayer.id}
            layer={selectedLayer}
            focusTextNonce={focusText}
            onSuggest={() => setDialog({ kind: 'suggest', layerId: selectedLayer.id })}
            mediaSection={
              selectedLayer.type === 'image' || selectedLayer.type === 'video' ? (
                <MediaSection layer={selectedLayer} onReplace={() => void replaceMedia(selectedLayer)} />
              ) : undefined
            }
          />
        ) : selected.length > 1 ? (
          <MultiSelection count={selected.length} />
        ) : (
          <CompositionPanel onOpenSettings={() => setDialog({ kind: 'comp' })} />
        )}
      </div>
    </div>
  );

  const replaceMedia = async (layer: Layer) => {
    const files = await pickFiles({ accept: layer.type === 'video' ? 'video/*' : 'image/*' });
    if (!files.length) return;
    try {
      const r = await addMediaLayer(docRef.current, files[0], files[0].name, layer.type === 'video' ? 'video' : 'image', []);
      // Keep the old layer (transform, keyframes) but point it at the new media.
      const next = updateLayer({ ...r.doc, layers: r.doc.layers.filter((l) => l.id !== r.layer.id) }, layer.id, (l) => ({ ...l, assetId: r.layer.assetId }));
      setDoc(next, { label: 'Replace media' });
    } catch (error) {
      toast.error(t('Could not import the file'), error instanceof Error ? error.message : String(error));
    }
  };

  const suggestLayer = dialog?.kind === 'suggest' ? layerById(doc, dialog.layerId) : undefined;

  return (
    <EditorContext.Provider value={api}>
      <div ref={rootRef} className="mo-root">
        <ModuleLayout
          moduleId="motion"
          title={file?.name ?? localizeDefaultName(t, comp.name, ['Composition 1'])}
          dirty={dirty}
          menus={menus}
          toolbar={
            <>
              <button type="button" className="btn sm ghost" title={t('Composition settings…')} onClick={() => setDialog({ kind: 'comp' })}>
                {comp.width}×{comp.height} · {comp.fps} fps · {formatTime(comp.duration)}
              </button>
              <select className="select sm" style={{ width: 120 }} aria-label={t('Preview resolution')} value={quality} onChange={(e) => setQuality(parseFloat(e.target.value))}>
                <option value={1}>{t('Full')}</option>
                <option value={0.5}>{t('Half')}</option>
                <option value={0.25}>{t('Quarter')}</option>
              </select>
              <button type="button" className="btn sm ghost" onClick={vp.fit} title={t('Fit in window')}>
                {formatZoom(vp.zoom)}
              </button>
            </>
          }
          actions={
            <>
              <Button size="sm" icon={Wand2} onClick={() => setDialog({ kind: 'animate' })}>
                {t('Animate with AI')}
              </Button>
              <Button size="sm" variant="primary" icon={Download} onClick={() => setDialog({ kind: 'export' })}>
                {t('Export')}
              </Button>
            </>
          }
          left={<ToolPalette t={t} tool={tool} setTool={setTool} onImport={() => void pickImport()} onNull={() => addLayer('null')} />}
          right={right}
          rightWidth={300}
          bottom={
            <Timeline
              expanded={expanded}
              setExpanded={setExpanded}
              loop={loop}
              setLoop={setLoop}
              addLayerEntries={addEntries}
              onEditCurve={(x, y) => setCurve({ x, y })}
            />
          }
          bottomHeight={290}
          resizableBottom
          status={
            <>
              <StatusTime store={time} fps={comp.fps} />
              <span>{t('{n} layer(s)', { n: doc.layers.length })}</span>
              {selected.length > 0 && <span>{t('{n} selected', { n: selected.length })}</span>}
              {selectedKeys.size > 0 && <span>{t('{n} key(s)', { n: selectedKeys.size })}</span>}
              <span className="spacer" />
              <span>{formatZoom(vp.zoom)}</span>
            </>
          }
          ai={
            <AIAssistantPanel
              moduleId="motion"
              moduleName="Motion Graphics"
              instructions={MOTION_AI_INSTRUCTIONS}
              getContext={async () => {
                const d = docRef.current;
                const tm = time.get();
                const map = evaluateDoc(d, tm);
                const summary = describeDocument(d, tm, selected, (l) => {
                  const ev = map.get(l.id);
                  return ev && l.type !== 'null' ? worldBounds(l, ev, d.assets) : undefined;
                });
                let image = null;
                try {
                  await images.preload(d);
                  image = await canvasToAIImage(renderStill(d, tm, 1280, previewMedia(d, images, videos)));
                } catch {
                  image = null;
                }
                return { summary, image };
              }}
              onActions={(actions) => applyActions(actions, { label: 'AI edit' })}
              suggestions={[t('Make the title bounce in'), t('Fade everything out at the end'), t('Add a lower third with my name'), t('Make the motion snappier')]}
              placeholder={t('Describe an animation change…')}
              canSnapshot
            />
          }
        >
          <Stage
            active={active}
            vp={vp}
            containerRef={containerRef}
            images={images}
            videos={videos}
            invalidateRef={invalidateRef}
            quality={quality}
            showMotionPaths={showPaths}
            presetMenu={() => presetEntries(t, (id) => applyPresetToSelection(id))}
          />
          <DropOverlay show={dragging} label={t('Drop images, videos, SVG or .ultima projects')} />
        </ModuleLayout>
        {dialog?.kind === 'new' && (
          <CompositionDialog
            title={t('New composition')}
            confirmLabel={t('Create')}
            initial={createDoc().comp}
            onCancel={() => setDialog(null)}
            onConfirm={(c: Composition) => {
              setDialog(null);
              resetDoc({ ...createDoc(), comp: { ...c, workStart: 0, workEnd: c.duration } }, null);
            }}
          />
        )}
        {dialog?.kind === 'comp' && (
          <CompositionDialog
            title={t('Composition settings')}
            confirmLabel={t('Apply')}
            initial={comp}
            onCancel={() => setDialog(null)}
            onConfirm={(c) => {
              setDialog(null);
              setDoc((d) => setDuration({ ...d, comp: { ...c, duration: d.comp.duration } }, c.duration), { label: 'Composition settings' });
              setFitKey((k) => k + 1);
            }}
          />
        )}
        {dialog?.kind === 'export' && <ExportDialog doc={doc} time={time.get()} images={images} initialFormat={dialog.format} onClose={() => setDialog(null)} />}
        {dialog?.kind === 'animate' && <AnimateDialog doc={doc} onApply={applyActions} onClose={() => setDialog(null)} />}
        {dialog?.kind === 'suggest' && suggestLayer && <SuggestDialog doc={doc} layer={suggestLayer} onApply={applyActions} onClose={() => setDialog(null)} />}
        {curve && <CurvePopover x={curve.x} y={curve.y} onClose={() => setCurve(null)} />}
      </div>
    </EditorContext.Provider>
  );
}
