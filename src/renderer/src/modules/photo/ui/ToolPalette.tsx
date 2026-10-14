import { memo } from 'react';
import {
  ArrowLeftRight,
  Bandage,
  Blend,
  Brush,
  CircleDashed,
  Crop,
  Droplet,
  Eraser,
  Hand,
  Lasso,
  LassoSelect,
  Move,
  PaintBucket,
  Pencil,
  Pipette,
  RotateCcw,
  Shapes,
  SquareDashed,
  Stamp,
  Sun,
  Type,
  WandSparkles,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '../../../core/i18n';
import { ColorPicker, ToolButton } from '../../../components/ui';
import { usePhotoStore } from '../store';
import type { ToolId } from '../types';

export interface ToolDef {
  id: ToolId;
  icon: LucideIcon;
  label: string;
  key: string;
}

export const TOOL_DEFS: ToolDef[] = [
  { id: 'move', icon: Move, label: 'Move', key: 'V' },
  { id: 'marquee', icon: SquareDashed, label: 'Marquee', key: 'M' },
  { id: 'lasso', icon: Lasso, label: 'Lasso', key: 'L' },
  { id: 'wand', icon: WandSparkles, label: 'Magic Wand', key: 'W' },
  { id: 'crop', icon: Crop, label: 'Crop', key: 'C' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper', key: 'I' },
  { id: 'heal', icon: Bandage, label: 'Spot Healing Brush', key: 'J' },
  { id: 'clone', icon: Stamp, label: 'Clone Stamp', key: 'S' },
  { id: 'brush', icon: Brush, label: 'Brush', key: 'B' },
  { id: 'pencil', icon: Pencil, label: 'Pencil', key: 'Shift+B' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', key: 'E' },
  { id: 'bucket', icon: PaintBucket, label: 'Paint Bucket', key: 'G' },
  { id: 'gradient', icon: Blend, label: 'Gradient', key: 'Shift+G' },
  { id: 'dodge', icon: Sun, label: 'Dodge / Burn / Sponge', key: 'O' },
  { id: 'blur', icon: Droplet, label: 'Blur / Sharpen', key: 'R' },
  { id: 'text', icon: Type, label: 'Text', key: 'T' },
  { id: 'shape', icon: Shapes, label: 'Shapes', key: 'U' },
  { id: 'hand', icon: Hand, label: 'Hand', key: 'H' },
  { id: 'zoom', icon: ZoomIn, label: 'Zoom', key: 'Z' },
];

export const ToolPalette = memo(function ToolPalette() {
  const t = useT();
  const tool = usePhotoStore((s) => s.tool);
  const setTool = usePhotoStore((s) => s.setTool);
  const fg = usePhotoStore((s) => s.fg);
  const bg = usePhotoStore((s) => s.bg);
  const setColors = usePhotoStore((s) => s.setColors);
  const swap = usePhotoStore((s) => s.swapColors);
  const reset = usePhotoStore((s) => s.resetColors);
  const marqueeShape = usePhotoStore((s) => s.opts.marquee.shape);
  const lassoKind = usePhotoStore((s) => s.opts.lasso.kind);

  return (
    <div className="ph-palette">
      <div className="ph-tools">
        {TOOL_DEFS.map((d) => {
          const icon = d.id === 'marquee' && marqueeShape === 'ellipse' ? CircleDashed : d.id === 'lasso' && lassoKind === 'polygon' ? LassoSelect : d.icon;
          return <ToolButton key={d.id} icon={icon} label={t(d.label)} shortcut={d.key} active={tool === d.id} onClick={() => setTool(d.id)} />;
        })}
      </div>
      <div className="ph-colors" aria-label={t('Colors')}>
        <div className="ph-color-fg">
          <ColorPicker value={fg} alpha={false} size={26} label={t('Foreground color')} onChange={(c) => setColors(c)} />
        </div>
        <div className="ph-color-bg">
          <ColorPicker value={bg} alpha={false} size={26} label={t('Background color')} onChange={(c) => setColors(undefined, c)} />
        </div>
        <button type="button" className="ph-mini-btn ph-swap" title={`${t('Swap colors')} (X)`} aria-label={t('Swap colors')} onClick={swap}>
          <ArrowLeftRight size={11} />
        </button>
        <button type="button" className="ph-mini-btn ph-reset" title={`${t('Default colors')} (D)`} aria-label={t('Default colors')} onClick={reset}>
          <RotateCcw size={11} />
        </button>
      </div>
    </div>
  );
});
