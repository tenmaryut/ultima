import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowLeftRight,
  Circle,
  Hand,
  Hexagon,
  MousePointer2,
  MousePointerClick,
  PenTool,
  Pencil,
  Pipette,
  RotateCcw,
  Slash,
  Square,
  SquaresExclude,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Star,
  Type,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { IconButton, NumberField, Select, Slider, ToolButton } from '../../components/ui';
import { useT } from '../../core/i18n';
import type { EditActions } from './actions';
import { useEditor, type ToolId } from './editor';
import { DEFAULT_STYLE } from './model';
import { topLevelSelection } from './ops';
import { PaintSwatch } from './panels/PaintField';

export const TOOLS: { id: ToolId; icon: LucideIcon; label: string; key?: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Selection', key: 'V' },
  { id: 'direct', icon: MousePointerClick, label: 'Direct Selection', key: 'A' },
  { id: 'pen', icon: PenTool, label: 'Pen', key: 'P' },
  { id: 'pencil', icon: Pencil, label: 'Pencil', key: 'N' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'M' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'L' },
  { id: 'polygon', icon: Hexagon, label: 'Polygon' },
  { id: 'star', icon: Star, label: 'Star' },
  { id: 'line', icon: Slash, label: 'Line', key: '\\' },
  { id: 'text', icon: Type, label: 'Text', key: 'T' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper', key: 'I' },
  { id: 'hand', icon: Hand, label: 'Hand', key: 'H' },
  { id: 'zoom', icon: ZoomIn, label: 'Zoom', key: 'Z' },
];

export function Toolbox({ onTool }: { onTool: (id: ToolId) => void }) {
  const t = useT();
  const core = useEditor();
  const { style } = core;
  return (
    <div className="toolbar-v vc-toolbox">
      {TOOLS.map((tool, i) => (
        <div key={tool.id}>
          {(i === 2 || i === 4 || i === 9 || i === 11) && <div className="tool-sep" />}
          <ToolButton icon={tool.icon} label={t(tool.label)} shortcut={tool.key} active={core.tool === tool.id} onClick={() => onTool(tool.id)} />
        </div>
      ))}
      <div className="tool-sep" />
      <div className="vc-fillstroke" title={t('Fill and stroke for new objects (X swaps focus, Shift+X swaps colors, D resets)')}>
        <button
          type="button"
          className={`vc-fs-stroke ${core.paintTarget === 'stroke' ? 'front' : ''}`}
          aria-label={t('Stroke')}
          onClick={() => core.setPaintTarget('stroke')}
        >
          <PaintSwatch paint={style.stroke.paint} size={22} />
        </button>
        <button type="button" className={`vc-fs-fill ${core.paintTarget === 'fill' ? 'front' : ''}`} aria-label={t('Fill')} onClick={() => core.setPaintTarget('fill')}>
          <PaintSwatch paint={style.fill} size={22} />
        </button>
      </div>
      <div className="row" style={{ gap: 0, justifyContent: 'center' }}>
        <IconButton icon={ArrowLeftRight} size="sm" label={t('Swap fill and stroke')} onClick={() => core.setStyle({ fill: style.stroke.paint, stroke: { ...style.stroke, paint: style.fill } })} />
        <IconButton icon={RotateCcw} size="sm" label={t('Default fill and stroke')} onClick={() => core.setStyle(DEFAULT_STYLE)} />
      </div>
    </div>
  );
}

/** Contextual options for the active tool, plus align/pathfinder buttons for selections. */
export function ToolOptionsBar({ actions }: { actions: EditActions }) {
  const t = useT();
  const core = useEditor();
  const o = core.options;
  const selCount = topLevelSelection(core.doc.objects, core.selection).length;
  const items: React.ReactNode[] = [];
  switch (core.tool) {
    case 'rect':
      items.push(
        <label key="r" className="vc-opt">
          {t('Radius')}
          <NumberField small value={o.radius} min={0} max={10000} style={{ width: 64 }} onChange={(v) => core.setOptions({ radius: v })} />
        </label>,
      );
      break;
    case 'polygon':
      items.push(
        <label key="s" className="vc-opt">
          {t('Sides')}
          <NumberField small value={o.sides} min={3} max={64} style={{ width: 56 }} onChange={(v) => core.setOptions({ sides: Math.round(v) })} />
        </label>,
      );
      break;
    case 'star':
      items.push(
        <label key="p" className="vc-opt">
          {t('Points')}
          <NumberField small value={o.points} min={3} max={64} style={{ width: 56 }} onChange={(v) => core.setOptions({ points: Math.round(v) })} />
        </label>,
        <label key="i" className="vc-opt">
          {t('Inner radius')}
          <NumberField small value={Math.round(o.inner * 100)} min={5} max={95} suffix="%" style={{ width: 64 }} onChange={(v) => core.setOptions({ inner: v / 100 })} />
        </label>,
      );
      break;
    case 'pencil':
      items.push(
        <div key="sm" className="vc-opt" style={{ width: 180 }}>
          <Slider label={t('Smoothing')} min={0} max={100} value={o.smoothing} onChange={(v) => core.setOptions({ smoothing: v })} />
        </div>,
      );
      break;
    case 'text':
      items.push(
        <Select
          key="f"
          small
          value={o.fontFamily}
          style={{ width: 150 }}
          onFocus={() => core.loadFonts()}
          onPointerDown={() => core.loadFonts()}
          options={(core.fonts.includes(o.fontFamily) ? core.fonts : [o.fontFamily, ...core.fonts]).map((f) => ({ value: f, label: f }))}
          onChange={(v) => core.setOptions({ fontFamily: v })}
        />,
        <NumberField key="sz" small value={o.fontSize} min={1} max={2000} suffix="px" style={{ width: 70 }} onChange={(v) => core.setOptions({ fontSize: v })} />,
        <Select<number>
          key="w"
          small
          value={o.fontWeight}
          style={{ width: 90 }}
          options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))}
          onChange={(v) => core.setOptions({ fontWeight: v })}
        />,
      );
      break;
    case 'pen':
      items.push(
        <span key="h" className="faint vc-hint">
          {t('Click for corners, drag for curves, click the first point to close. Enter or Esc finishes.')}
        </span>,
      );
      break;
    case 'direct':
      items.push(
        <button key="c" type="button" className="btn sm" disabled={!core.nodeSel.length} onClick={() => actions.convertPoints(false)}>
          {t('Corner')}
        </button>,
        <button key="s" type="button" className="btn sm" disabled={!core.nodeSel.length} onClick={() => actions.convertPoints(true)}>
          {t('Smooth')}
        </button>,
        <span key="h" className="faint vc-hint">
          {t('Double-click a segment to add a point · Alt+click a point to convert it')}
        </span>,
      );
      break;
    case 'eyedropper':
      items.push(
        <span key="h" className="faint vc-hint">
          {t('Click an object to copy its fill and stroke to the selection')}
        </span>,
      );
      break;
  }
  if ((core.tool === 'select' || core.tool === 'direct') && selCount > 0) {
    const align = (icon: LucideIcon, label: string, mode: Parameters<EditActions['align']>[0]) => (
      <IconButton key={mode} icon={icon} size="sm" label={t(label)} onClick={() => actions.align(mode)} />
    );
    items.push(
      align(AlignStartVertical, 'Align left', 'left'),
      align(AlignCenterVertical, 'Align horizontal centers', 'hcenter'),
      align(AlignEndVertical, 'Align right', 'right'),
      align(AlignStartHorizontal, 'Align top', 'top'),
      align(AlignCenterHorizontal, 'Align vertical centers', 'vcenter'),
      align(AlignEndHorizontal, 'Align bottom', 'bottom'),
      <IconButton key="dh" icon={AlignHorizontalDistributeCenter} size="sm" label={t('Distribute horizontally')} disabled={selCount < 3} onClick={() => actions.distribute('h')} />,
      <IconButton key="dv" icon={AlignVerticalDistributeCenter} size="sm" label={t('Distribute vertically')} disabled={selCount < 3} onClick={() => actions.distribute('v')} />,
      <Select<'selection' | 'artboard'>
        key="to"
        small
        value={core.viewOpts.alignTo}
        style={{ width: 120 }}
        title={t('Align to')}
        options={[
          { value: 'selection', label: t('To selection') },
          { value: 'artboard', label: t('To artboard') },
        ]}
        onChange={(v) => core.setViewOpts({ alignTo: v })}
      />,
    );
    if (selCount >= 2) {
      items.push(
        <span key="sep" className="vsep" />,
        <IconButton key="pu" icon={SquaresUnite} size="sm" label={t('Unite')} onClick={() => actions.pathfinder('unite')} />,
        <IconButton key="pm" icon={SquaresSubtract} size="sm" label={t('Minus front')} onClick={() => actions.pathfinder('minus-front')} />,
        <IconButton key="pi" icon={SquaresIntersect} size="sm" label={t('Intersect')} onClick={() => actions.pathfinder('intersect')} />,
        <IconButton key="px" icon={SquaresExclude} size="sm" label={t('Exclude')} onClick={() => actions.pathfinder('exclude')} />,
      );
    }
  }
  if (!items.length) {
    items.push(
      <span key="none" className="faint vc-hint">
        {core.tool === 'select' ? t('Click to select, drag to move, Shift for multiple selection') : ''}
      </span>,
    );
  }
  return <>{items}</>;
}
