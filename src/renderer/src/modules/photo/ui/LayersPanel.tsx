import { memo, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  FilePlus,
  Lock,
  LockOpen,
  Merge,
  MoreHorizontal,
  Shapes,
  SquareDashedMousePointer,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '../../../core/i18n';
import { DropdownButton, IconButton, Select, type MenuEntry } from '../../../components/ui';
import {
  deleteLayer,
  duplicateLayer,
  flattenAction,
  maskAction,
  mergeDownAction,
  mergeVisibleAction,
  moveLayer,
  newLayer,
  newTextLayer,
  rasterizeAction,
  selectPixelsOf,
  setActive,
  updateLayerProps,
} from '../actions';
import { ctx2d } from '../canvas';
import type { PhotoEngine } from '../engine';
import { layerContent } from '../render';
import { usePhotoStore } from '../store';
import { BLEND_MODES, type BlendMode, type Layer, type PhotoDoc } from '../types';

const THUMB = 34;

function LayerThumb({ layer, doc, mask }: { layer: Layer; doc: PhotoDoc; mask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const source = mask ? layer.mask : layer;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(THUMB / doc.width, THUMB / doc.height);
    const w = Math.max(1, Math.round(doc.width * scale));
    const h = Math.max(1, Math.round(doc.height * scale));
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = ctx2d(c);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, doc.width, doc.height);
    ctx.imageSmoothingQuality = 'medium';
    try {
      if (mask && layer.mask) {
        ctx.fillStyle = layer.mask.reveal ? '#ffffff' : '#000000';
        ctx.fillRect(0, 0, doc.width, doc.height);
        ctx.fillStyle = '#000000';
        ctx.fillRect(layer.mask.x, layer.mask.y, layer.mask.canvas.width, layer.mask.canvas.height);
        ctx.drawImage(layer.mask.canvas, layer.mask.x, layer.mask.y);
      } else {
        const content = layerContent(layer);
        if (content) ctx.drawImage(content.canvas, content.x, content.y);
      }
    } catch {
      // thumbnails are best effort
    }
  }, [source, layer, doc.width, doc.height, mask]);
  return <canvas ref={ref} className="ph-thumb-canvas" />;
}

const TYPE_ICON: Partial<Record<Layer['type'], LucideIcon>> = { text: Type, shape: Shapes };

interface RowProps {
  engine: PhotoEngine;
  doc: PhotoDoc;
  layer: Layer;
  index: number;
  active: boolean;
  maskEdit: boolean;
  onDragStart: (index: number) => void;
  onDrop: (index: number, after: boolean) => void;
}

function LayerRow({ engine, doc, layer, index, active, maskEdit, onDragStart, onDrop }: RowProps) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(layer.name);
  const [dropMark, setDropMark] = useState<'above' | 'below' | null>(null);
  const setMaskEdit = usePhotoStore((s) => s.setMaskEdit);
  const TypeIcon = TYPE_ICON[layer.type];

  const commitName = () => {
    setRenaming(false);
    const v = name.trim();
    if (v && v !== layer.name) updateLayerProps(engine, layer.id, { name: v.slice(0, 200) }, 'Rename Layer');
    else setName(layer.name);
  };

  return (
    <div
      className={`ph-layer ${active ? 'active' : ''} ${layer.visible ? '' : 'hidden'} ${dropMark ? `drop-${dropMark}` : ''}`}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-ultima-layer', layer.id);
        onDragStart(index);
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('text/x-ultima-layer')) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDropMark(e.clientY < r.top + r.height / 2 ? 'above' : 'below');
      }}
      onDragLeave={() => setDropMark(null)}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('text/x-ultima-layer')) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        // rows are shown top layer first: "above" in the list means higher in the stack
        onDrop(index, e.clientY < r.top + r.height / 2);
        setDropMark(null);
      }}
      onClick={() => setActive(engine, layer.id)}
    >
      <button
        type="button"
        className="ph-layer-eye"
        aria-label={layer.visible ? t('Hide layer') : t('Show layer')}
        title={layer.visible ? t('Hide layer') : t('Show layer')}
        onClick={(e) => {
          e.stopPropagation();
          updateLayerProps(engine, layer.id, { visible: !layer.visible }, layer.visible ? 'Hide Layer' : 'Show Layer');
        }}
      >
        {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <span
        className={`ph-thumb checker ${active && !maskEdit ? 'focus' : ''}`}
        title={t('Ctrl-click to select the layer pixels')}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            selectPixelsOf(engine, layer.id);
            return;
          }
          if (active) setMaskEdit(false);
        }}
      >
        <LayerThumb layer={layer} doc={doc} />
      </span>
      {layer.mask && (
        <span
          className={`ph-thumb ${active && maskEdit ? 'focus' : ''} ${layer.mask.enabled ? '' : 'disabled'}`}
          title={t('Layer mask — click to paint on it, Shift-click to disable')}
          onClick={(e) => {
            e.stopPropagation();
            if (e.shiftKey) {
              setActive(engine, layer.id);
              maskAction(engine, 'toggle');
              return;
            }
            setActive(engine, layer.id);
            setMaskEdit(true);
          }}
        >
          <LayerThumb layer={layer} doc={doc} mask />
        </span>
      )}
      <span className="ph-layer-name" onDoubleClick={() => setRenaming(true)}>
        {renaming ? (
          <input
            className="input sm"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setName(layer.name);
                setRenaming(false);
              }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            {TypeIcon && <TypeIcon size={12} className="faint" />}
            <span className="ph-ellipsis" title={layer.name}>
              {layer.name}
            </span>
          </>
        )}
      </span>
      <button
        type="button"
        className={`ph-layer-lock ${layer.locked ? 'on' : ''}`}
        aria-label={layer.locked ? t('Unlock layer') : t('Lock layer')}
        title={layer.locked ? t('Unlock layer') : t('Lock layer')}
        onClick={(e) => {
          e.stopPropagation();
          updateLayerProps(engine, layer.id, { locked: !layer.locked }, layer.locked ? 'Unlock Layer' : 'Lock Layer');
        }}
      >
        {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
      </button>
    </div>
  );
}

export const LayersPanel = memo(function LayersPanel({ engine, doc }: { engine: PhotoEngine; doc: PhotoDoc }) {
  const t = useT();
  const maskEdit = usePhotoStore((s) => s.maskEdit);
  const dragFrom = useRef<number | null>(null);
  const active = doc.layers.find((l) => l.id === doc.activeId) ?? null;
  const [opacity, setOpacity] = useState<number | null>(null);
  const rows = [...doc.layers].map((l, i) => ({ l, i })).reverse();

  const moreEntries = (): MenuEntry[] => [
    { label: t('New Text Layer'), icon: Type, onClick: () => newTextLayer(engine) },
    { label: t('Merge Down'), icon: Merge, onClick: () => mergeDownAction(engine), disabled: !active },
    { label: t('Merge Visible'), onClick: () => mergeVisibleAction(engine) },
    { label: t('Flatten Image'), onClick: () => void flattenAction(engine) },
    { type: 'separator' },
    { label: t('Rasterize Layer'), onClick: () => void rasterizeAction(engine), disabled: !active || active.type === 'raster' },
    { label: t('Select Layer Pixels'), icon: SquareDashedMousePointer, onClick: () => active && selectPixelsOf(engine, active.id), disabled: !active },
    { type: 'separator' },
    { label: t('Add Mask (Reveal All)'), onClick: () => maskAction(engine, 'reveal'), disabled: !active || Boolean(active.mask) },
    { label: t('Add Mask (Hide All)'), onClick: () => maskAction(engine, 'hide'), disabled: !active || Boolean(active.mask) },
    { label: t('Add Mask from Selection'), onClick: () => maskAction(engine, 'selection'), disabled: !active || Boolean(active.mask) || !doc.selection },
    { label: t('Invert Mask'), onClick: () => maskAction(engine, 'invert'), disabled: !active?.mask },
    { label: t('Apply Mask'), onClick: () => maskAction(engine, 'apply'), disabled: !active?.mask },
    { label: t('Delete Mask'), onClick: () => maskAction(engine, 'delete'), disabled: !active?.mask },
  ];

  return (
    <div className="ph-layers">
      <div className="ph-layers-controls">
        <Select<BlendMode>
          small
          value={active?.blend ?? 'source-over'}
          disabled={!active}
          aria-label={t('Blend mode')}
          title={t('Blend mode')}
          onChange={(v) => active && updateLayerProps(engine, active.id, { blend: v }, 'Blend Mode')}
          options={BLEND_MODES.map((b) => ({ value: b.value, label: t(b.label) }))}
        />
        <label className="ph-opacity" title={t('Opacity')}>
          <span>{t('Opacity')}</span>
          <input
            type="range"
            className="ph-range"
            min={0}
            max={100}
            disabled={!active}
            value={opacity ?? Math.round((active?.opacity ?? 1) * 100)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setOpacity(v);
              if (active) updateLayerProps(engine, active.id, { opacity: v / 100 }, null);
            }}
            onPointerUp={() => {
              setOpacity(null);
              engine.commitLive('Opacity');
            }}
            onKeyUp={() => {
              setOpacity(null);
              engine.commitLive('Opacity');
            }}
          />
          <span className="ph-opt-value">{opacity ?? Math.round((active?.opacity ?? 1) * 100)}%</span>
        </label>
      </div>
      <div className="ph-layer-list" role="list">
        {rows.map(({ l, i }) => (
          <LayerRow
            key={l.id}
            engine={engine}
            doc={doc}
            layer={l}
            index={i}
            active={l.id === doc.activeId}
            maskEdit={maskEdit}
            onDragStart={(index) => (dragFrom.current = index)}
            onDrop={(index, above) => {
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from === null) return;
              let to = above ? index + 1 : index;
              if (from < to) to -= 1;
              moveLayer(engine, doc.layers[from].id, to);
            }}
          />
        ))}
        {!doc.layers.length && <div className="faint" style={{ padding: 8 }}>{t('No layers')}</div>}
      </div>
      <div className="ph-layers-actions">
        <IconButton icon={FilePlus} size="sm" label={`${t('New Layer')} (Ctrl+Shift+N)`} onClick={() => newLayer(engine)} />
        <IconButton icon={Copy} size="sm" label={`${t('Duplicate Layer')} (Ctrl+D)`} onClick={() => duplicateLayer(engine)} disabled={!active} />
        <IconButton
          icon={SquareDashedMousePointer}
          size="sm"
          label={active?.mask ? t('Delete Mask') : doc.selection ? t('Add Mask from Selection') : t('Add Layer Mask')}
          onClick={() => maskAction(engine, active?.mask ? 'delete' : doc.selection ? 'selection' : 'reveal')}
          disabled={!active}
        />
        <IconButton icon={ArrowUp} size="sm" label={t('Move Up')} onClick={() => active && moveLayer(engine, active.id, 'up')} disabled={!active} />
        <IconButton icon={ArrowDown} size="sm" label={t('Move Down')} onClick={() => active && moveLayer(engine, active.id, 'down')} disabled={!active} />
        <IconButton icon={Merge} size="sm" label={t('Merge Down')} onClick={() => mergeDownAction(engine)} disabled={!active} />
        <span className="spacer" />
        <DropdownButton className="icon-btn sm" title={t('More layer actions')} entries={moreEntries}>
          <MoreHorizontal size={14} />
        </DropdownButton>
        <IconButton icon={Trash2} size="sm" label={t('Delete Layer')} onClick={() => deleteLayer(engine)} disabled={!active} />
      </div>
    </div>
  );
});
