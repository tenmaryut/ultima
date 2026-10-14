import { memo, useEffect, useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Pencil } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, ColorPicker, NumberField, Segmented, Select, TextArea, Toggle } from '../../../components/ui';
import { maskAction, rasterizeAction, updateLayerProps } from '../actions';
import { textWithCenter } from '../docops';
import type { PhotoEngine } from '../engine';
import { layoutText } from '../render';
import { usePhotoStore } from '../store';
import type { GlowEffect, Layer, LayerEffects, PhotoDoc, ShadowEffect, ShapeLayer, StrokeEffect, TextAlign, TextLayer } from '../types';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ph-prop-row">
      <span className="ph-prop-label">{label}</span>
      <div className="ph-prop-value">{children}</div>
    </div>
  );
}

function N({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return <NumberField small value={Math.round(value * 100) / 100} onChange={onChange} min={min} max={max} step={step} suffix={suffix} />;
}

const DEFAULT_SHADOW: ShadowEffect = { enabled: true, color: '#000000', opacity: 0.6, angle: 120, distance: 10, size: 12 };
const DEFAULT_STROKE: StrokeEffect = { enabled: true, color: '#000000', size: 3, opacity: 1, position: 'outside' };
const DEFAULT_GLOW: GlowEffect = { enabled: true, color: '#ffe680', opacity: 0.8, size: 18, spread: 10 };

function TextProps({ engine, layer }: { engine: PhotoEngine; layer: TextLayer }) {
  const t = useT();
  const fonts = usePhotoStore((s) => s.fonts);
  const [text, setText] = useState(layer.text);
  useEffect(() => setText(layer.text), [layer.text]);
  const set = (patch: Partial<TextLayer>, label: string | null) => updateLayerProps(engine, layer.id, patch, label);
  const fontList = fonts.includes(layer.font) ? fonts : [layer.font, ...fonts];
  return (
    <>
      <TextArea
        rows={3}
        value={text}
        aria-label={t('Text')}
        onChange={(e) => {
          setText(e.target.value);
          set({ text: e.target.value }, null);
        }}
        onBlur={() => engine.commitLive('Edit Text')}
      />
      <Button size="sm" icon={Pencil} onClick={() => engine.startTextEdit(layer.id)}>
        {t('Edit on canvas')}
      </Button>
      <Row label={t('Font')}>
        <Select small value={layer.font} onChange={(v) => set({ font: v }, 'Font')} options={fontList.map((f) => ({ value: f, label: f }))} />
      </Row>
      <Row label={t('Size')}>
        <N value={layer.size} min={1} max={4000} suffix="px" onChange={(v) => set({ size: v }, 'Font Size')} />
      </Row>
      <Row label={t('Weight')}>
        <Select small value={layer.weight} onChange={(v) => set({ weight: v }, 'Font Weight')} options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} />
      </Row>
      <Row label={t('Style')}>
        <Toggle checked={layer.italic} onChange={(v) => set({ italic: v }, 'Italic')} label={t('Italic')} />
        <Toggle checked={layer.underline} onChange={(v) => set({ underline: v }, 'Underline')} label={t('Underline')} />
      </Row>
      <Row label={t('Color')}>
        <ColorPicker value={layer.color} alpha size={22} onChange={(c) => set({ color: c }, null)} onCommit={() => engine.commitLive('Text Color')} />
      </Row>
      <Row label={t('Align')}>
        <Segmented<TextAlign>
          value={layer.align}
          onChange={(v) => {
            // keep the text block in place when changing the alignment
            const lay = layoutText(layer);
            set(textWithCenter({ ...layer, align: v }, lay.cx, lay.cy), 'Align Text');
          }}
          options={[
            { value: 'left', icon: AlignLeft, title: t('Left') },
            { value: 'center', icon: AlignCenter, title: t('Center') },
            { value: 'right', icon: AlignRight, title: t('Right') },
          ]}
        />
      </Row>
      <Row label={t('Line height')}>
        <N value={layer.lineHeight} min={0.5} max={5} step={0.05} onChange={(v) => set({ lineHeight: v }, 'Line Height')} />
      </Row>
      <Row label={t('Letter spacing')}>
        <N value={layer.letterSpacing} min={-200} max={1000} suffix="px" onChange={(v) => set({ letterSpacing: v }, 'Letter Spacing')} />
      </Row>
      <Row label={t('Rotation')}>
        <N value={layer.rotation} min={-360} max={360} suffix="°" onChange={(v) => set({ rotation: v }, 'Rotate Text')} />
      </Row>
      <Row label="X / Y">
        <N value={layer.x} onChange={(v) => set({ x: v }, 'Move')} />
        <N value={layer.y} onChange={(v) => set({ y: v }, 'Move')} />
      </Row>
    </>
  );
}

function ShapeProps({ engine, layer }: { engine: PhotoEngine; layer: ShapeLayer }) {
  const t = useT();
  const set = (patch: Partial<ShapeLayer>, label: string | null) => updateLayerProps(engine, layer.id, patch, label);
  return (
    <>
      <Row label={t('Shape')}>
        <Select
          small
          value={layer.shape}
          onChange={(v) => set({ shape: v }, 'Change Shape')}
          options={[
            { value: 'rect', label: t('Rectangle') },
            { value: 'roundrect', label: t('Rounded rectangle') },
            { value: 'ellipse', label: t('Ellipse') },
            { value: 'line', label: t('Line') },
          ]}
        />
      </Row>
      <Row label="X / Y">
        <N value={layer.x} onChange={(v) => set({ x: v }, 'Move')} />
        <N value={layer.y} onChange={(v) => set({ y: v }, 'Move')} />
      </Row>
      <Row label={t('W / H')}>
        <N value={layer.w} onChange={(v) => set({ w: v }, 'Resize Shape')} />
        <N value={layer.h} onChange={(v) => set({ h: v }, 'Resize Shape')} />
      </Row>
      {layer.shape !== 'line' && (
        <Row label={t('Fill')}>
          <Toggle checked={layer.fill !== null} onChange={(v) => set({ fill: v ? (usePhotoStore.getState().fg ?? '#000000') : null }, 'Fill')} />
          {layer.fill !== null && <ColorPicker value={layer.fill} alpha size={22} onChange={(c) => set({ fill: c }, null)} onCommit={() => engine.commitLive('Fill Color')} />}
        </Row>
      )}
      <Row label={t('Stroke')}>
        <Toggle checked={layer.stroke !== null} onChange={(v) => set({ stroke: v ? '#000000' : null }, 'Stroke')} />
        {layer.stroke !== null && <ColorPicker value={layer.stroke} alpha size={22} onChange={(c) => set({ stroke: c }, null)} onCommit={() => engine.commitLive('Stroke Color')} />}
        <N value={layer.strokeWidth} min={0} max={1000} suffix="px" onChange={(v) => set({ strokeWidth: v }, 'Stroke Width')} />
      </Row>
      {layer.shape === 'roundrect' && (
        <Row label={t('Radius')}>
          <N value={layer.radius} min={0} max={10000} suffix="px" onChange={(v) => set({ radius: v }, 'Corner Radius')} />
        </Row>
      )}
      <Row label={t('Rotation')}>
        <N value={layer.rotation} min={-360} max={360} suffix="°" onChange={(v) => set({ rotation: v }, 'Rotate Shape')} />
      </Row>
    </>
  );
}

function EffectsEditor({ engine, layer }: { engine: PhotoEngine; layer: Layer }) {
  const t = useT();
  const e = layer.effects;
  const setFx = (patch: Partial<LayerEffects>, label: string | null) => updateLayerProps(engine, layer.id, { effects: { ...e, ...patch } }, label);
  const shadow = e.shadow;
  const stroke = e.stroke;
  const glow = e.glow;
  return (
    <div className="col" style={{ gap: 6 }}>
      <Toggle checked={Boolean(shadow?.enabled)} label={t('Drop shadow')} onChange={(v) => setFx({ shadow: { ...(shadow ?? DEFAULT_SHADOW), enabled: v } }, 'Drop Shadow')} />
      {shadow?.enabled && (
        <div className="ph-fx">
          <Row label={t('Color')}>
            <ColorPicker value={shadow.color} alpha={false} size={20} onChange={(c) => setFx({ shadow: { ...shadow, color: c } }, null)} onCommit={() => engine.commitLive('Drop Shadow')} />
            <N value={Math.round(shadow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => setFx({ shadow: { ...shadow, opacity: v / 100 } }, 'Drop Shadow')} />
          </Row>
          <Row label={t('Angle')}>
            <N value={shadow.angle} min={-360} max={360} suffix="°" onChange={(v) => setFx({ shadow: { ...shadow, angle: v } }, 'Drop Shadow')} />
          </Row>
          <Row label={t('Distance')}>
            <N value={shadow.distance} min={0} max={1000} suffix="px" onChange={(v) => setFx({ shadow: { ...shadow, distance: v } }, 'Drop Shadow')} />
          </Row>
          <Row label={t('Size')}>
            <N value={shadow.size} min={0} max={250} suffix="px" onChange={(v) => setFx({ shadow: { ...shadow, size: v } }, 'Drop Shadow')} />
          </Row>
        </div>
      )}
      <Toggle checked={Boolean(stroke?.enabled)} label={t('Stroke')} onChange={(v) => setFx({ stroke: { ...(stroke ?? DEFAULT_STROKE), enabled: v } }, 'Stroke')} />
      {stroke?.enabled && (
        <div className="ph-fx">
          <Row label={t('Color')}>
            <ColorPicker value={stroke.color} alpha={false} size={20} onChange={(c) => setFx({ stroke: { ...stroke, color: c } }, null)} onCommit={() => engine.commitLive('Stroke')} />
            <N value={Math.round(stroke.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => setFx({ stroke: { ...stroke, opacity: v / 100 } }, 'Stroke')} />
          </Row>
          <Row label={t('Size')}>
            <N value={stroke.size} min={1} max={250} suffix="px" onChange={(v) => setFx({ stroke: { ...stroke, size: v } }, 'Stroke')} />
          </Row>
          <Row label={t('Position')}>
            <Select
              small
              value={stroke.position}
              onChange={(v) => setFx({ stroke: { ...stroke, position: v } }, 'Stroke')}
              options={[
                { value: 'outside', label: t('Outside') },
                { value: 'center', label: t('Center') },
                { value: 'inside', label: t('Inside') },
              ]}
            />
          </Row>
        </div>
      )}
      <Toggle checked={Boolean(glow?.enabled)} label={t('Outer glow')} onChange={(v) => setFx({ glow: { ...(glow ?? DEFAULT_GLOW), enabled: v } }, 'Outer Glow')} />
      {glow?.enabled && (
        <div className="ph-fx">
          <Row label={t('Color')}>
            <ColorPicker value={glow.color} alpha={false} size={20} onChange={(c) => setFx({ glow: { ...glow, color: c } }, null)} onCommit={() => engine.commitLive('Outer Glow')} />
            <N value={Math.round(glow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => setFx({ glow: { ...glow, opacity: v / 100 } }, 'Outer Glow')} />
          </Row>
          <Row label={t('Size')}>
            <N value={glow.size} min={1} max={250} suffix="px" onChange={(v) => setFx({ glow: { ...glow, size: v } }, 'Outer Glow')} />
          </Row>
          <Row label={t('Spread')}>
            <N value={glow.spread} min={0} max={100} suffix="%" onChange={(v) => setFx({ glow: { ...glow, spread: v } }, 'Outer Glow')} />
          </Row>
        </div>
      )}
    </div>
  );
}

export const PropertiesPanel = memo(function PropertiesPanel({ engine, doc }: { engine: PhotoEngine; doc: PhotoDoc }) {
  const t = useT();
  const maskEdit = usePhotoStore((s) => s.maskEdit);
  const setMaskEdit = usePhotoStore((s) => s.setMaskEdit);
  const layer = doc.layers.find((l) => l.id === doc.activeId);
  if (!layer) return <div className="faint">{t('Select a layer to see its properties.')}</div>;
  return (
    <div className="col" style={{ gap: 8 }}>
      {layer.type === 'text' && <TextProps engine={engine} layer={layer} />}
      {layer.type === 'shape' && <ShapeProps engine={engine} layer={layer} />}
      {layer.type === 'raster' && (
        <Row label="X / Y">
          <N value={layer.x} onChange={(v) => updateLayerProps(engine, layer.id, { x: Math.round(v) }, 'Move')} />
          <N value={layer.y} onChange={(v) => updateLayerProps(engine, layer.id, { y: Math.round(v) }, 'Move')} />
        </Row>
      )}
      {layer.type !== 'raster' && (
        <Button size="sm" variant="ghost" onClick={() => void rasterizeAction(engine)}>
          {t('Rasterize Layer')}
        </Button>
      )}
      <div className="ph-prop-section">{t('Layer mask')}</div>
      {layer.mask ? (
        <div className="col" style={{ gap: 6 }}>
          <Toggle checked={layer.mask.enabled} onChange={() => maskAction(engine, 'toggle')} label={t('Enabled')} />
          <Toggle checked={maskEdit} onChange={setMaskEdit} label={t('Paint on the mask')} />
          <span className="faint" style={{ fontSize: 11 }}>
            {t('Black hides, white reveals. Use the brush, eraser, gradient or fill.')}
          </span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            <Button size="sm" onClick={() => maskAction(engine, 'invert')}>
              {t('Invert')}
            </Button>
            <Button size="sm" onClick={() => maskAction(engine, 'apply')}>
              {t('Apply')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => maskAction(engine, 'delete')}>
              {t('Delete')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <Button size="sm" onClick={() => maskAction(engine, 'reveal')}>
            {t('Add mask')}
          </Button>
          {doc.selection && (
            <Button size="sm" onClick={() => maskAction(engine, 'selection')}>
              {t('From selection')}
            </Button>
          )}
        </div>
      )}
      <div className="ph-prop-section">{t('Layer effects')}</div>
      <EffectsEditor engine={engine} layer={layer} />
    </div>
  );
});
