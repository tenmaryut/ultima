import './i18n';
import './color.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Accessibility, Blend, Download, ImagePlus, Library, Palette, Save } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { AIAssistantPanel, type AIAction } from '../../components/ai/AIAssistantPanel';
import { Button, DropOverlay, Segmented, toast, type MenuEntry } from '../../components/ui';
import { useAppStore, type ModuleHandoff } from '../../core/store';
import { useT } from '../../core/i18n';
import { useModuleCommands, useModuleKeydown } from '../../core/commands';
import { useFileDrop, useHandoffs, useLatest } from '../../core/hooks';
import { useHistoryState } from '../../core/history';
import { canvasToAIImage } from '../../core/utils/image';
import { describeAIError } from '../../core/ai/client';
import { formatColor, normalizeHex } from './colormath';
import { HARMONY_RULES, ruleInfo } from './harmony';
import { extractPalette, type Mood } from './extract';
import {
  addSwatch,
  baseIndex,
  createDefaultDoc,
  hexToHsv,
  paletteData,
  regenerate,
  removeSwatch,
  replaceColors,
  reverseSwatches,
  setBaseIndex,
  setRule,
  setSpread,
  setWheel,
  sortSwatches,
  toggleLock,
  type ColorDoc,
} from './state';
import { applyColorActions, COLOR_AI_INSTRUCTIONS, describeDoc } from './aiActions';
import { makeAccessible, nameColors, paletteFromDescription, type GeneratedPalette } from './aiFeatures';
import { duplicatePalette, type SavedPalette } from './library';
import { imageDataToCanvas } from './render';
import type { ColorFormat } from './colormath';
import { WheelView } from './WheelView';
import { SwatchStrip } from './SwatchStrip';
import { ExtractView } from './ExtractView';
import { GradientView } from './GradientView';
import { A11yView } from './A11yView';
import { LibraryView } from './LibraryView';
import { SidePanel, type AITask } from './SidePanel';
import { ExportModal } from './ExportModal';
import { ExtractPanel, HarmonyPanel } from './LeftPanel';
import { useColorFiles, useLibrary } from './files';
import { copyText } from './widgets';

type View = 'wheel' | 'extract' | 'gradient' | 'a11y' | 'library';

export default function ColorModule({ active }: ModuleProps) {
  const t = useT();
  const language = useAppStore((s) => s.language);
  const history = useHistoryState<ColorDoc>(() => ({ ...createDefaultDoc(), name: t('Untitled palette') }));
  const doc = history.present;
  const docRef = useLatest(doc);
  const [view, setView] = useState<View>('wheel');
  const [selected, setSelected] = useState(2);
  const [format, setFormat] = useState<ColorFormat>('hex');
  const [exportOpen, setExportOpen] = useState(false);
  const [aiTask, setAITask] = useState<AITask>(null);
  const [aiMessage, setAIMessage] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<GeneratedPalette | null>(null);
  const [extracting, setExtracting] = useState(false);
  const aiAbort = useRef<AbortController | null>(null);
  const seedRef = useRef(7);
  const centerRef = useRef<HTMLDivElement>(null);

  const sel = Math.min(selected, doc.swatches.length - 1);
  useEffect(() => {
    if (selected > doc.swatches.length - 1) setSelected(doc.swatches.length - 1);
  }, [doc.swatches.length, selected]);

  const change = useCallback((next: ColorDoc, label: string) => history.set(next, { label }), [history]);
  const preview = useCallback((next: ColorDoc) => history.set(next, { record: false }), [history]);
  const commit = useCallback((label: string) => history.commit(label), [history]);

  const lib = useLibrary();

  /* ------------------------------- Extraction ------------------------------- */

  const files = useColorFiles({
    history,
    docRef,
    onImageLoaded: (img, extract) => {
      setView('extract');
      if (extract) runExtraction(img, docRef.current.mood, docRef.current.extractCount);
    },
    onPalette: (name) => {
      setView((v) => (v === 'library' || v === 'gradient' ? v : 'wheel'));
      if (name) toast.success(t('Palette imported'), name);
    },
  });
  const image = files.image;

  function runExtraction(img = files.imageRef.current, mood: Mood = docRef.current.mood, count = docRef.current.extractCount) {
    if (!img) return;
    setExtracting(true);
    // let the busy state paint before the (fast, synchronous) clustering
    requestAnimationFrame(() => {
      try {
        const out = extractPalette(img.small.data, img.small.width, img.small.height, { count, mood, seed: seedRef.current });
        if (!out.length) {
          toast.warning(t('No colors found'), t('The image looks fully transparent.'));
          return;
        }
        const colors = out.map((c) => ({ hex: c.hex, point: { x: (c.x + 0.5) / img.small.width, y: (c.y + 0.5) / img.small.height } }));
        const current = docRef.current;
        history.set({ ...replaceColors(current, colors), mood, extractCount: count }, { label: 'Extract colors' });
      } catch (error) {
        toast.error(t('Could not extract colors'), error instanceof Error ? error.message : String(error));
      } finally {
        setExtracting(false);
      }
    });
  }

  /* --------------------------------- Handoffs -------------------------------- */

  useHandoffs('color', (items: ModuleHandoff[]) => {
    for (const item of items) {
      if (item.kind === 'palette' && item.palette?.length) {
        const colors = item.palette.map((c) => normalizeHex(c)).filter((c): c is string => Boolean(c));
        if (!colors.length) continue;
        const next = replaceColors(docRef.current, colors.map((hex) => ({ hex })), { keepLocked: false });
        change(item.title ? { ...next, name: item.title.slice(0, 120) } : next, 'Open palette');
        setView('wheel');
        toast.success(t('Palette received'), t('{count} colors', { count: colors.length }));
      } else if (item.kind === 'image' && item.image) void files.loadImageUrl(item.image);
      else if (item.kind === 'files' && item.files?.length) void files.openFiles(item.files);
      else if ((item.kind === 'text' && item.text) || (item.kind === 'svg' && item.svg)) files.importText(item.text ?? item.svg ?? '', item.title);
      else if (item.kind === 'json' && item.json) files.importText(JSON.stringify(item.json), item.title);
    }
  });

  const dragging = useFileDrop(centerRef, (list) => void files.openFiles(list), active);

  /* ------------------------------- AI features ------------------------------- */

  const langName = language === 'id' ? 'Indonesian (Bahasa Indonesia)' : 'English';
  const runTask = async (task: Exclude<AITask, null>, fn: (signal: AbortSignal) => Promise<void>) => {
    if (aiTask) return;
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAITask(task);
    setAIMessage(null);
    try {
      await fn(ctrl.signal);
    } catch (error) {
      if (!ctrl.signal.aborted) toast.error(t('The AI request failed'), describeAIError(error));
    } finally {
      setAITask(null);
      aiAbort.current = null;
    }
  };

  const aiDescribe = (description: string, count: number) =>
    void runTask('describe', async (signal) => {
      const result = await paletteFromDescription(description, count, langName, signal);
      const next = replaceColors(docRef.current, result.colors, { keepLocked: false });
      change({ ...next, name: result.name }, 'AI palette');
      setLastGenerated(result);
      setSelected(0);
    });

  const aiNames = () =>
    void runTask('names', async (signal) => {
      const current = docRef.current;
      const names = await nameColors(current.swatches.map((s) => s.hex), langName, signal);
      const latest = docRef.current;
      change({ ...latest, swatches: latest.swatches.map((s, i) => (names[i] ? { ...s, name: names[i] } : s)) }, 'Name colors');
      setAIMessage(t('Named {count} colors.', { count: names.filter(Boolean).length }));
    });

  const aiAccessible = () =>
    void runTask('accessible', async (signal) => {
      const current = docRef.current;
      const result = await makeAccessible(
        current.swatches.map((s) => s.hex),
        current.swatches.map((s) => s.locked),
        langName,
        signal,
      );
      const latest = docRef.current;
      change({ ...latest, rule: 'custom', swatches: latest.swatches.map((s, i) => (result.colors[i] && !s.locked ? { ...s, hex: result.colors[i] } : s)) }, 'Make accessible');
      const passing = result.pairs.filter((p) => p.pass).length;
      setAIMessage(
        [
          t('{passing} of {total} text pairs pass WCAG AA.', { passing, total: result.pairs.length }),
          result.adjusted ? t('Ultima fine-tuned the AI’s answer so every pair reaches 4.5:1.') : '',
          result.notes,
        ]
          .filter(Boolean)
          .join(' '),
      );
    });

  const onAIActions = (actions: AIAction[]) => {
    const result = applyColorActions(docRef.current, actions);
    if (!result.applied) throw new Error(result.notes.join('; ') || t('Nothing to apply'));
    change(result.doc, 'AI edit');
    return result.notes.length
      ? t('{count} change(s) applied, {skipped} skipped', { count: result.applied, skipped: result.notes.length })
      : t('{count} change(s) applied', { count: result.applied });
  };

  /* --------------------------------- Commands -------------------------------- */

  const newPalette = () => {
    const fresh = { ...createDefaultDoc(), name: t('Untitled palette') };
    change(fresh, 'New palette');
    files.reset(fresh);
    lib.setCurrentId(null);
    setSelected(2);
    setView('wheel');
  };

  const removeSelected = () => {
    if (doc.swatches.length <= 1) return;
    change(removeSwatch(doc, sel), 'Remove color');
  };
  const duplicateSelected = () => {
    const s = doc.swatches[sel];
    if (!s) return;
    change(addSwatch(doc, s.hex, sel + 1), 'Duplicate color');
    setSelected(sel + 1);
  };

  useModuleCommands('color', {
    new: newPalette,
    open: () => void files.openDialog(),
    save: () => void files.save(false),
    'save-as': () => void files.save(true),
    export: () => setExportOpen(true),
    undo: history.undo,
    redo: history.redo,
    delete: () => {
      if (view !== 'wheel' && view !== 'extract') return false;
      removeSelected();
    },
    duplicate: () => {
      if (view !== 'wheel' && view !== 'extract') return false;
      duplicateSelected();
    },
  });

  useModuleKeydown(active, (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (view !== 'wheel' && view !== 'extract') return;
    if (e.key === 'ArrowLeft') setSelected(Math.max(0, sel - 1));
    else if (e.key === 'ArrowRight') setSelected(Math.min(doc.swatches.length - 1, sel + 1));
    else if (e.key.toLowerCase() === 'l') change(toggleLock(doc, sel), 'Lock color');
    else if (e.key.toLowerCase() === 'b') change(setBaseIndex(doc, sel), 'Set base color');
    else return;
    e.preventDefault();
  });

  const useIn = (module: 'vector' | 'layout' | 'motion') => {
    useAppStore.getState().sendToModule(module, { kind: 'palette', palette: doc.swatches.map((s) => s.hex), title: doc.name });
  };

  const randomBase = () => {
    const base = hexToHsv(doc.swatches[baseIndex(doc)].hex);
    const next = { h: Math.random() * 360, s: 0.45 + Math.random() * 0.5, v: 0.55 + Math.random() * 0.4 };
    change(regenerate(doc.rule === 'custom' ? { ...doc, rule: 'analogous' } : doc, { ...base, ...next }), 'Random colors');
  };

  /* ---------------------------------- Menus ---------------------------------- */

  const menus: { label: string; entries: MenuEntry[] | (() => MenuEntry[]) }[] = [
    {
      label: t('File'),
      entries: () => [
        { label: t('New palette'), shortcut: 'Ctrl+N', onClick: newPalette },
        { label: t('Open…'), shortcut: 'Ctrl+O', onClick: () => void files.openDialog() },
        { label: t('Open image…'), icon: ImagePlus, onClick: () => void files.openImageDialog() },
        { type: 'separator' },
        { label: t('Save'), shortcut: 'Ctrl+S', onClick: () => void files.save(false) },
        { label: t('Save as…'), shortcut: 'Ctrl+Shift+S', onClick: () => void files.save(true) },
        { label: t('Save to library'), icon: Library, onClick: () => lib.saveDoc(docRef.current) },
        { type: 'separator' },
        { label: t('Export…'), shortcut: 'Ctrl+E', icon: Download, onClick: () => setExportOpen(true) },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), shortcut: 'Ctrl+Z', disabled: !history.canUndo, onClick: history.undo },
        { label: t('Redo'), shortcut: 'Ctrl+Shift+Z', disabled: !history.canRedo, onClick: history.redo },
        { type: 'separator' },
        { label: t('Add color'), disabled: doc.swatches.length >= 12, onClick: () => change(addSwatch(doc, undefined, sel + 1), 'Add color') },
        { label: t('Duplicate color'), shortcut: 'Ctrl+D', onClick: duplicateSelected },
        { label: t('Remove color'), shortcut: 'Del', disabled: doc.swatches.length <= 1, onClick: removeSelected },
        { type: 'separator' },
        { label: t('Sort by lightness'), onClick: () => change(sortSwatches(doc, 'lightness'), 'Sort colors') },
        { label: t('Sort by hue'), onClick: () => change(sortSwatches(doc, 'hue'), 'Sort colors') },
        { label: t('Reverse order'), onClick: () => change(reverseSwatches(doc), 'Reverse colors') },
        { type: 'separator' },
        { label: t('Lock all'), onClick: () => change({ ...doc, swatches: doc.swatches.map((s) => ({ ...s, locked: true })) }, 'Lock all') },
        { label: t('Unlock all'), onClick: () => change({ ...doc, swatches: doc.swatches.map((s) => ({ ...s, locked: false })) }, 'Unlock all') },
        { label: t('Copy hex codes'), onClick: () => void copyText(doc.swatches.map((s) => s.hex.toUpperCase()).join(', ')) },
      ],
    },
    {
      label: t('Harmony'),
      entries: () => [
        ...HARMONY_RULES.map((r): MenuEntry => ({ label: t(r.label), checked: doc.rule === r.id, onClick: () => change(setRule(doc, r.id), 'Harmony rule') })),
        { type: 'separator' },
        { label: t('Artistic wheel (RYB)'), checked: doc.wheel === 'ryb', onClick: () => change(setWheel(doc, 'ryb'), 'Wheel type') },
        { label: t('RGB wheel'), checked: doc.wheel === 'rgb', onClick: () => change(setWheel(doc, 'rgb'), 'Wheel type') },
      ],
    },
  ];

  const views: { value: View; label: string; icon: typeof Palette }[] = [
    { value: 'wheel', label: t('Wheel'), icon: Palette },
    { value: 'extract', label: t('Extract'), icon: ImagePlus },
    { value: 'gradient', label: t('Gradient'), icon: Blend },
    { value: 'a11y', label: t('Accessibility'), icon: Accessibility },
    { value: 'library', label: t('Library'), icon: Library },
  ];

  const left =
    view === 'wheel' ? (
      <HarmonyPanel
        doc={doc}
        onRule={(rule) => change(setRule(doc, rule), 'Harmony rule')}
        onWheel={(wheel) => change(setWheel(doc, wheel), 'Wheel type')}
        onSpreadPreview={(v) => preview(setSpread(doc, v))}
        onSpreadCommit={() => commit('Spread')}
        onRandom={randomBase}
      />
    ) : view === 'extract' ? (
      <ExtractPanel
        doc={doc}
        hasImage={Boolean(image)}
        busy={extracting}
        onMood={(mood) => runExtraction(undefined, mood, doc.extractCount)}
        onCount={(count) => runExtraction(undefined, doc.mood, count)}
        onShuffle={() => {
          seedRef.current = Math.floor(Math.random() * 1e9);
          runExtraction();
        }}
        onOpen={() => void files.openImageDialog()}
        onClear={files.clearImage}
      />
    ) : undefined;

  const base = doc.swatches[baseIndex(doc)];
  const ruleLabel = t(ruleInfo(doc.rule).label);

  return (
    <ModuleLayout
      moduleId="color"
      title={doc.name}
      dirty={files.dirty}
      menus={menus}
      toolbar={<Segmented<View> value={view} onChange={setView} options={views.map((v) => ({ value: v.value, label: v.label, icon: v.icon }))} />}
      actions={
        <>
          <Button size="sm" icon={Save} onClick={() => lib.saveDoc(docRef.current)} title={t('Save to library')}>
            {t('Save to library')}
          </Button>
          <Button size="sm" variant="primary" icon={Download} onClick={() => setExportOpen(true)}>
            {t('Export')}
          </Button>
        </>
      }
      left={left}
      right={
        <SidePanel
          doc={doc}
          selected={sel}
          onSelect={setSelected}
          onChange={change}
          onPreview={preview}
          onCommit={commit}
          onSaveToLibrary={() => lib.saveDoc(docRef.current)}
          onUseIn={useIn}
          aiTask={aiTask}
          onAIDescribe={aiDescribe}
          onAINames={aiNames}
          onAIAccessible={aiAccessible}
          onAIStop={() => aiAbort.current?.abort()}
          lastGenerated={lastGenerated}
          aiMessage={aiMessage}
        />
      }
      rightWidth={300}
      ai={
        <AIAssistantPanel
          moduleId="color"
          moduleName="Color Studio"
          instructions={COLOR_AI_INSTRUCTIONS}
          getContext={async () => {
            const img = files.imageRef.current;
            return {
              summary: describeDoc(docRef.current) + (img ? '\nAn image is loaded for palette extraction (attached as a snapshot when supported).' : ''),
              image: img ? await canvasToAIImage(imageDataToCanvas(img.pick), { maxSize: 768 }) : null,
            };
          }}
          onActions={onAIActions}
          suggestions={[t('Make it warmer'), t('Give me a pastel version'), t('Brand palette for a coffee shop'), t('Make a gradient from these colors')]}
          placeholder={t('Describe the palette you want…')}
          canSnapshot={Boolean(image)}
        />
      }
      status={
        <>
          <span>{t('{count} colors', { count: doc.swatches.length })}</span>
          <span>
            {t('Harmony')}: {ruleLabel}
          </span>
          <span>
            {t('Base')}: <span className="mono">{formatColor(base.hex, 'hex')}</span>
          </span>
          <span>{doc.wheel === 'ryb' ? t('Artistic wheel (RYB)') : t('RGB wheel')}</span>
          <span className="spacer" />
          <span className="faint">{t('←/→ select · L lock · B base · Del remove')}</span>
        </>
      }
    >
      <div className="co-center" ref={centerRef}>
        <DropOverlay show={dragging} label={t('Drop an image or a palette file')} />
        <div className={`co-view co-view-${view}`}>
          {view === 'wheel' && <WheelView doc={doc} selected={sel} onSelect={setSelected} onPreview={preview} onCommit={commit} />}
          {view === 'extract' && (
            <ExtractView doc={doc} image={image} selected={sel} onSelect={setSelected} onPreview={preview} onCommit={commit} onOpenImage={() => void files.openImageDialog()} busy={extracting} />
          )}
          {view === 'gradient' && <GradientView doc={doc} onChange={change} onPreview={preview} onCommit={commit} />}
          {view === 'a11y' && <A11yView doc={doc} onChange={change} onMakeAccessibleAI={aiAccessible} aiBusy={aiTask === 'accessible'} />}
          {view === 'library' && (
            <LibraryView
              library={lib.library}
              currentId={lib.currentId}
              onSaveCurrent={() => lib.saveDoc(docRef.current)}
              onImport={() => void lib.importFiles()}
              onLoad={(p: SavedPalette) => {
                const next = replaceColors(docRef.current, p.colors, { keepLocked: false });
                change({ ...next, name: p.name, tags: [...p.tags] }, 'Open palette');
                lib.setCurrentId(p.id);
                setView('wheel');
              }}
              onUpdate={lib.update}
              onDuplicate={(p) => lib.add(duplicatePalette(p, t('copy')))}
              onDelete={lib.remove}
            />
          )}
        </div>
        {(view === 'wheel' || view === 'extract') && (
          <SwatchStrip
            doc={doc}
            selected={sel}
            onSelect={setSelected}
            format={format}
            onFormat={setFormat}
            onChange={change}
            onPreview={preview}
            onCommit={commit}
            showBrightness={view === 'wheel'}
          />
        )}
      </div>
      {exportOpen && <ExportModal palette={paletteData(doc)} onClose={() => setExportOpen(false)} />}
    </ModuleLayout>
  );
}
