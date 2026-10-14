import { FlipHorizontal, ImagePlus, Minus, Move, Plus, Trash2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Panel, Segmented, Select, Slider, Toggle } from '../../../components/ui';
import type { Frame, Gradient, ImageFrame, ShapeFrame, ShapeKind, TableFrame, TextAlign } from '../types';
import { fontSizeFromDisplay, fontSizeToDisplay, fontUnit } from '../units';
import type { LayoutEditor } from '../useLayoutEditor';
import { ColorField, FontPicker, NumField, Row, UnitField } from './fields';

/** Gradient editor (2–5 stops, linear/radial). */
export function GradientFields({
  gradient,
  swatches,
  onChange,
  onCommit,
}: {
  gradient: Gradient;
  swatches: string[];
  onChange: (g: Gradient) => void;
  onCommit: (g: Gradient) => void;
}) {
  const t = useT();
  const spread = (stops: Gradient['stops']) => stops.map((s, i) => ({ ...s, pos: stops.length > 1 ? i / (stops.length - 1) : 0 }));
  return (
    <div className="col" style={{ gap: 6 }}>
      <Row>
        <Segmented<'linear' | 'radial'>
          value={gradient.kind}
          onChange={(kind) => onCommit({ ...gradient, kind })}
          options={[
            { value: 'linear', label: t('Linear') },
            { value: 'radial', label: t('Radial') },
          ]}
        />
        {gradient.kind === 'linear' && <NumField value={gradient.angle} min={-360} max={360} step={15} suffix="°" title={t('Angle')} onChange={(angle) => onCommit({ ...gradient, angle })} />}
      </Row>
      {gradient.stops.map((s, i) => (
        <Row key={i}>
          <ColorField
            value={s.color}
            swatches={swatches}
            onChange={(color) => onChange({ ...gradient, stops: gradient.stops.map((x, j) => (j === i ? { ...x, color } : x)) })}
            onCommit={(color) => onCommit({ ...gradient, stops: gradient.stops.map((x, j) => (j === i ? { ...x, color } : x)) })}
          />
          {gradient.stops.length > 2 && (
            <IconButton icon={Minus} size="sm" label={t('Remove color')} onClick={() => onCommit({ ...gradient, stops: spread(gradient.stops.filter((_, j) => j !== i)) })} />
          )}
        </Row>
      ))}
      {gradient.stops.length < 5 && (
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => onCommit({ ...gradient, stops: spread([...gradient.stops, { color: gradient.stops[gradient.stops.length - 1].color, pos: 1 }]) })}>
          {t('Add color')}
        </Button>
      )}
    </div>
  );
}

/** Solid / gradient fill switch. */
export function FillFields({
  fill,
  gradient,
  swatches,
  onPatch,
}: {
  fill: string;
  gradient: Gradient | null;
  swatches: string[];
  onPatch: (patch: { fill?: string; gradient?: Gradient | null }, record?: boolean) => void;
}) {
  const t = useT();
  return (
    <>
      <Segmented<'solid' | 'gradient'>
        value={gradient ? 'gradient' : 'solid'}
        onChange={(mode) =>
          onPatch(
            mode === 'solid'
              ? { gradient: null }
              : { gradient: { kind: 'linear', angle: 135, stops: [{ color: fill || '$2', pos: 0 }, { color: '$3', pos: 1 }] } },
          )
        }
        options={[
          { value: 'solid', label: t('Solid') },
          { value: 'gradient', label: t('Gradient') },
        ]}
      />
      {gradient ? (
        <GradientFields gradient={gradient} swatches={swatches} onChange={(g) => onPatch({ gradient: g }, false)} onCommit={(g) => onPatch({ gradient: g })} />
      ) : (
        <ColorField label={t('Fill')} allowNone value={fill} swatches={swatches} onChange={(v) => onPatch({ fill: v }, false)} onCommit={(v) => onPatch({ fill: v })} />
      )}
    </>
  );
}

const SHAPES: { value: ShapeKind; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'line', label: 'Line' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'star', label: 'Star' },
];

export function ShapePanel({ ed, frame }: { ed: LayoutEditor; frame: ShapeFrame }) {
  const t = useT();
  const unit = ed.doc.unit;
  const sw = ed.doc.swatches;
  const isLine = frame.shape === 'line';
  return (
    <Panel title={t('Shape')}>
      <Select<ShapeKind> small value={frame.shape} onChange={(shape) => ed.patchSelection({ shape }, 'Shape')} options={SHAPES.map((s) => ({ value: s.value, label: t(s.label) }))} aria-label={t('Shape')} />
      {!isLine && <FillFields fill={frame.fill} gradient={frame.gradient} swatches={sw} onPatch={(p, record = true) => ed.patchSelection(p, 'Fill', record)} />}
      <ColorField
        label={isLine ? t('Color') : t('Stroke')}
        allowNone={!isLine}
        value={frame.stroke}
        swatches={sw}
        onChange={(stroke) => ed.patchSelection({ stroke }, 'Stroke', false)}
        onCommit={(stroke) => ed.patchSelection({ stroke, strokeWidth: stroke && !frame.strokeWidth ? 2 : frame.strokeWidth }, 'Stroke')}
      />
      <div className="ly-grid2">
        <UnitField label={isLine ? t('Weight') : t('Width')} value={frame.strokeWidth} unit={unit} min={0} onChange={(strokeWidth) => ed.patchSelection({ strokeWidth }, 'Stroke width')} />
        {frame.shape === 'rect' && <UnitField label={t('Radius')} value={frame.radius} unit={unit} min={0} onChange={(radius) => ed.patchSelection({ radius }, 'Corner radius')} />}
      </div>
      <Toggle checked={frame.dashed} onChange={(dashed) => ed.patchSelection({ dashed }, 'Dashed')} label={t('Dashed')} />
    </Panel>
  );
}

export function ImagePanel({ ed, frame, onPlace }: { ed: LayoutEditor; frame: ImageFrame; onPlace: () => void }) {
  const t = useT();
  const unit = ed.doc.unit;
  const sw = ed.doc.swatches;
  const asset = frame.assetId ? ed.doc.assets[frame.assetId] : undefined;
  return (
    <Panel title={t('Image')}>
      <Row>
        <Button size="sm" icon={ImagePlus} onClick={onPlace}>
          {asset ? t('Replace…') : t('Place image…')}
        </Button>
        {asset && <IconButton icon={Trash2} size="sm" label={t('Remove image')} onClick={() => ed.patchSelection({ assetId: null }, 'Remove image')} />}
      </Row>
      {asset ? (
        <>
          <div className="faint ly-hint" title={asset.name}>
            {asset.name} · {asset.width}×{asset.height}px
          </div>
          <Select<ImageFrame['fit']>
            small
            value={frame.fit}
            onChange={(fit) => ed.patchSelection({ fit }, 'Fit')}
            options={[
              { value: 'fill', label: t('Fill frame (crop)') },
              { value: 'fit', label: t('Fit inside frame') },
              { value: 'stretch', label: t('Stretch') },
              { value: 'none', label: t('Original size') },
            ]}
            aria-label={t('Fit')}
          />
          <Slider label={t('Zoom')} min={10} max={400} value={Math.round(frame.zoom * 100)} defaultValue={100} format={(v) => `${v}%`} onChange={(v) => ed.patchSelection({ zoom: v / 100 }, 'Zoom', false)} onCommit={() => ed.commit('Zoom')} />
          <Slider label={t('Horizontal position')} min={0} max={100} value={Math.round(frame.focalX * 100)} defaultValue={50} format={(v) => `${v}%`} onChange={(v) => ed.patchSelection({ focalX: v / 100 }, 'Position', false)} onCommit={() => ed.commit('Image position')} />
          <Slider label={t('Vertical position')} min={0} max={100} value={Math.round(frame.focalY * 100)} defaultValue={50} format={(v) => `${v}%`} onChange={(v) => ed.patchSelection({ focalY: v / 100 }, 'Position', false)} onCommit={() => ed.commit('Image position')} />
          <Row>
            <Button size="sm" icon={Move} variant={ed.contentId === frame.id ? 'primary' : 'default'} onClick={() => ed.setContentId(ed.contentId === frame.id ? null : frame.id)}>
              {t('Adjust')}
            </Button>
            <IconButton icon={FlipHorizontal} size="sm" label={t('Flip horizontally')} active={frame.flipX} onClick={() => ed.patchSelection({ flipX: !frame.flipX }, 'Flip')} />
            <Toggle checked={frame.grayscale} onChange={(grayscale) => ed.patchSelection({ grayscale }, 'Grayscale')} label={t('Grayscale')} />
          </Row>
        </>
      ) : (
        <ColorField label={t('Placeholder')} value={frame.placeholder} swatches={sw} onChange={(placeholder) => ed.patchSelection({ placeholder }, 'Placeholder', false)} onCommit={(placeholder) => ed.patchSelection({ placeholder }, 'Placeholder')} />
      )}
      <div className="ly-grid2">
        <UnitField label={t('Radius')} value={frame.radius} unit={unit} min={0} onChange={(radius) => ed.patchSelection({ radius }, 'Corner radius')} />
        <UnitField label={t('Border')} value={frame.strokeWidth} unit={unit} min={0} onChange={(strokeWidth) => ed.patchSelection({ strokeWidth, stroke: frame.stroke || '$0' }, 'Border')} />
      </div>
      {frame.strokeWidth > 0 && (
        <ColorField label={t('Border')} allowNone value={frame.stroke} swatches={sw} onChange={(stroke) => ed.patchSelection({ stroke }, 'Border', false)} onCommit={(stroke) => ed.patchSelection({ stroke }, 'Border')} />
      )}
    </Panel>
  );
}

export function TablePanel({ ed, frame }: { ed: LayoutEditor; frame: TableFrame }) {
  const t = useT();
  const unit = ed.doc.unit;
  const sw = ed.doc.swatches;
  const p = (patch: Record<string, unknown>, label: string, record = true) => ed.patchSelection(patch, label, record);
  return (
    <Panel title={t('Table')}>
      <div className="ly-grid2">
        <NumField label={t('Rows')} value={frame.rows} min={1} max={100} precision={0} onChange={(v) => ed.resizeTable(frame.id, Math.round(v), frame.cols)} />
        <NumField label={t('Columns')} value={frame.cols} min={1} max={30} precision={0} onChange={(v) => ed.resizeTable(frame.id, frame.rows, Math.round(v))} />
      </div>
      <div className="faint ly-hint">{t('Double-click a cell to edit it. Tab moves to the next cell.')}</div>
      <FontPicker value={frame.fontFamily} onChange={(fontFamily) => p({ fontFamily }, 'Font')} />
      <Row className="ly-type-row">
        <NumField value={fontSizeToDisplay(frame.fontSize, unit)} min={1} max={500} suffix={fontUnit(unit)} title={t('Font size')} onChange={(v) => p({ fontSize: fontSizeFromDisplay(v, unit) }, 'Font size')} />
        <Select<TextAlign>
          small
          value={frame.align}
          onChange={(align) => p({ align }, 'Align')}
          options={[
            { value: 'left', label: t('Left') },
            { value: 'center', label: t('Center') },
            { value: 'right', label: t('Right') },
          ]}
          aria-label={t('Align')}
        />
      </Row>
      <ColorField label={t('Text')} value={frame.color} swatches={sw} onChange={(color) => p({ color }, 'Color', false)} onCommit={(color) => p({ color }, 'Color')} />
      <Toggle checked={frame.header} onChange={(header) => p({ header }, 'Header row')} label={t('Header row')} />
      {frame.header && (
        <>
          <ColorField label={t('Header')} allowNone value={frame.headerFill} swatches={sw} onChange={(headerFill) => p({ headerFill }, 'Header', false)} onCommit={(headerFill) => p({ headerFill }, 'Header')} />
          <ColorField label={t('Header text')} value={frame.headerColor} swatches={sw} onChange={(headerColor) => p({ headerColor }, 'Header', false)} onCommit={(headerColor) => p({ headerColor }, 'Header')} />
        </>
      )}
      <ColorField label={t('Fill')} allowNone value={frame.fill} swatches={sw} onChange={(fill) => p({ fill }, 'Fill', false)} onCommit={(fill) => p({ fill }, 'Fill')} />
      <ColorField label={t('Banding')} allowNone value={frame.bandFill} swatches={sw} onChange={(bandFill) => p({ bandFill }, 'Banding', false)} onCommit={(bandFill) => p({ bandFill }, 'Banding')} />
      <ColorField label={t('Lines')} allowNone value={frame.stroke} swatches={sw} onChange={(stroke) => p({ stroke }, 'Lines', false)} onCommit={(stroke) => p({ stroke }, 'Lines')} />
      <div className="ly-grid2">
        <UnitField label={t('Lines')} value={frame.strokeWidth} unit={unit} min={0} onChange={(strokeWidth) => p({ strokeWidth }, 'Line width')} />
        <UnitField label={t('Padding')} value={frame.cellPadding} unit={unit} min={0} onChange={(cellPadding) => p({ cellPadding }, 'Cell padding')} />
      </div>
    </Panel>
  );
}

export function ShadowPanel({ ed, frame }: { ed: LayoutEditor; frame: Frame }) {
  const t = useT();
  const s = frame.shadow;
  const unit = ed.doc.unit;
  return (
    <Panel title={t('Shadow')} defaultOpen={Boolean(s)}>
      <Toggle checked={Boolean(s)} onChange={(on) => ed.patchSelection({ shadow: on ? { x: 0, y: 6, blur: 18, color: 'rgba(0, 0, 0, 0.3)' } : null }, 'Shadow')} label={t('Drop shadow')} />
      {s && (
        <>
          <div className="ly-grid3">
            <UnitField label="X" value={s.x} unit={unit} onChange={(x) => ed.patchSelection({ shadow: { ...s, x } }, 'Shadow')} />
            <UnitField label="Y" value={s.y} unit={unit} onChange={(y) => ed.patchSelection({ shadow: { ...s, y } }, 'Shadow')} />
            <UnitField label={t('Blur')} value={s.blur} unit={unit} min={0} onChange={(blur) => ed.patchSelection({ shadow: { ...s, blur } }, 'Shadow')} />
          </div>
          <ColorField value={s.color} swatches={ed.doc.swatches} onChange={(color) => ed.patchSelection({ shadow: { ...s, color } }, 'Shadow', false)} onCommit={(color) => ed.patchSelection({ shadow: { ...s, color } }, 'Shadow')} />
        </>
      )}
    </Panel>
  );
}

