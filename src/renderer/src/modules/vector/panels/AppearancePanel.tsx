import { ColorPicker, Field, NumberField, Panel, Segmented, Select, Slider, Toggle } from '../../../components/ui';
import { useT } from '../../../core/i18n';
import { useEditor } from '../editor';
import { localBounds } from '../geometry';
import { BLEND_MODES, type BlendMode, type LineCap, type LineJoin, type Paint, type Stroke, type StrokeAlign, type VDoc, type VObject } from '../model';
import { applyStyle, mapTree } from '../ops';
import { PaintField } from './PaintField';

const DASHES: { id: string; label: string; dash: number[] }[] = [
  { id: 'solid', label: 'Solid', dash: [] },
  { id: 'dash', label: 'Dashed', dash: [8, 6] },
  { id: 'long', label: 'Long dash', dash: [16, 8] },
  { id: 'dot', label: 'Dotted', dash: [1, 4] },
  { id: 'dashdot', label: 'Dash dot', dash: [10, 4, 2, 4] },
];

function firstPaintable(o: VObject): VObject | null {
  if (o.type === 'group') {
    for (const c of o.children) {
      const f = firstPaintable(c);
      if (f) return f;
    }
    return null;
  }
  return o.type === 'image' || o.type === 'raw' ? null : o;
}

export function AppearanceSection({ ids, objs }: { ids: string[]; objs: VObject[] }) {
  const t = useT();
  const core = useEditor();
  const leaf = objs.map(firstPaintable).find((o): o is VObject => Boolean(o)) ?? null;
  const first = objs[0];
  const box = leaf ? localBounds(leaf) : { width: 100, height: 100 };

  const style = (patch: { fill?: Paint; stroke?: Partial<Stroke> }, label: string, live = false) => {
    const apply = (d: VDoc) => ({ ...d, objects: applyStyle(d.objects, ids, patch) });
    if (live) core.updateLive(apply);
    else core.update(apply, label);
    // new objects use the last edited style (like the toolbox fill/stroke)
    if (patch.fill) core.setStyle({ ...core.style, fill: patch.fill });
    if (patch.stroke) core.setStyle({ ...core.style, stroke: { ...core.style.stroke, ...patch.stroke } });
  };
  const patch = (fn: (o: VObject) => VObject, label: string, live = false) => {
    const set = new Set(ids);
    const apply = (d: VDoc) => ({ ...d, objects: mapTree(d.objects, (o) => (set.has(o.id) ? fn(o) : o)) });
    if (live) core.updateLive(apply);
    else core.update(apply, label);
  };

  const stroke = leaf?.stroke;
  const dashId = stroke ? (DASHES.find((d) => d.dash.join(',') === stroke.dash.join(','))?.id ?? 'custom') : 'solid';
  const shadow = first.effects.shadow;

  return (
    <>
      {leaf && (
        <Panel title={t('Appearance')}>
          {leaf.type !== 'line' && (
            <Field label={t('Fill')}>
              <PaintField
                value={leaf.fill}
                box={box}
                onChange={(p, live) => style({ fill: p }, 'Fill', live)}
                onCommit={() => core.commit('Fill')}
              />
            </Field>
          )}
          <Field label={t('Stroke')}>
            <PaintField
              value={leaf.stroke.paint}
              box={box}
              onChange={(p, live) => style({ stroke: { paint: p } }, 'Stroke', live)}
              onCommit={() => core.commit('Stroke')}
            />
          </Field>
          {stroke && stroke.paint.type !== 'none' && (
            <>
              <div className="vc-grid2">
                <Field label={t('Width')}>
                  <NumberField small value={stroke.width} min={0} max={1000} step={0.5} suffix="px" onChange={(v) => style({ stroke: { width: v } }, 'Stroke width')} />
                </Field>
                <Field label={t('Dashes')}>
                  <Select
                    small
                    value={dashId}
                    options={[...DASHES.map((d) => ({ value: d.id, label: t(d.label) })), ...(dashId === 'custom' ? [{ value: 'custom', label: t('Custom') }] : [])]}
                    onChange={(v) => {
                      const d = DASHES.find((x) => x.id === v);
                      if (d) style({ stroke: { dash: d.dash.map((n) => n * Math.max(1, stroke.width / 2)) } }, 'Dashes');
                    }}
                  />
                </Field>
              </div>
              {stroke.dash.length > 0 && (
                <Field label={t('Dash pattern')}>
                  <input
                    className="input sm mono"
                    key={stroke.dash.join(' ')}
                    defaultValue={stroke.dash.join(' ')}
                    placeholder="8 4"
                    onBlur={(e) => {
                      const dash = (e.target.value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n >= 0).slice(0, 12);
                      style({ stroke: { dash } }, 'Dashes');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </Field>
              )}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Segmented<LineCap>
                  value={stroke.cap}
                  options={[
                    { value: 'butt', label: t('Butt') },
                    { value: 'round', label: t('Round') },
                    { value: 'square', label: t('Square') },
                  ]}
                  onChange={(v) => style({ stroke: { cap: v } }, 'Line cap')}
                />
                <Segmented<LineJoin>
                  value={stroke.join}
                  options={[
                    { value: 'miter', label: t('Miter') },
                    { value: 'round', label: t('Round') },
                    { value: 'bevel', label: t('Bevel') },
                  ]}
                  onChange={(v) => style({ stroke: { join: v } }, 'Line join')}
                />
              </div>
              {leaf.type !== 'line' && leaf.type !== 'text' && (
                <Field label={t('Stroke position')} inline>
                  <Select<StrokeAlign>
                    small
                    value={stroke.align}
                    options={[
                      { value: 'center', label: t('Center') },
                      { value: 'inside', label: t('Inside') },
                      { value: 'outside', label: t('Outside') },
                    ]}
                    onChange={(v) => style({ stroke: { align: v } }, 'Stroke position')}
                  />
                </Field>
              )}
            </>
          )}
        </Panel>
      )}
      <Panel title={t('Opacity & effects')}>
        <Slider
          label={t('Opacity')}
          min={0}
          max={100}
          value={Math.round(first.opacity * 100)}
          format={(v) => `${Math.round(v)}%`}
          onChange={(v) => patch((o) => ({ ...o, opacity: v / 100 }), 'Opacity', true)}
          onCommit={() => core.commit('Opacity')}
          defaultValue={100}
        />
        <Field label={t('Blend mode')} inline>
          <Select<BlendMode>
            small
            value={first.blend}
            options={BLEND_MODES.map((b) => ({ value: b, label: t(b.charAt(0).toUpperCase() + b.slice(1).replace('-', ' ')) }))}
            onChange={(v) => patch((o) => ({ ...o, blend: v }), 'Blend mode')}
          />
        </Field>
        <Toggle
          label={t('Drop shadow')}
          checked={Boolean(shadow)}
          onChange={(on) =>
            patch(
              (o) => ({ ...o, effects: { ...o.effects, shadow: on ? (o.effects.shadow ?? { x: 0, y: 6, blur: 12, color: 'rgba(0, 0, 0, 0.35)' }) : undefined } }),
              'Drop shadow',
            )
          }
        />
        {shadow && (
          <div className="vc-grid3">
            <Field label="X">
              <NumberField small value={shadow.x} onChange={(v) => patch((o) => ({ ...o, effects: { ...o.effects, shadow: { ...(o.effects.shadow ?? shadow), x: v } } }), 'Shadow')} />
            </Field>
            <Field label="Y">
              <NumberField small value={shadow.y} onChange={(v) => patch((o) => ({ ...o, effects: { ...o.effects, shadow: { ...(o.effects.shadow ?? shadow), y: v } } }), 'Shadow')} />
            </Field>
            <Field label={t('Blur')}>
              <NumberField small value={shadow.blur} min={0} onChange={(v) => patch((o) => ({ ...o, effects: { ...o.effects, shadow: { ...(o.effects.shadow ?? shadow), blur: v } } }), 'Shadow')} />
            </Field>
            <Field label={t('Color')}>
              <ColorPicker
                value={shadow.color}
                onChange={(c) => patch((o) => ({ ...o, effects: { ...o.effects, shadow: { ...(o.effects.shadow ?? shadow), color: c } } }), 'Shadow', true)}
                onCommit={() => core.commit('Shadow color')}
              />
            </Field>
          </div>
        )}
        <Slider
          label={t('Blur')}
          min={0}
          max={50}
          step={0.5}
          value={first.effects.blur ?? 0}
          format={(v) => `${v} px`}
          onChange={(v) => patch((o) => ({ ...o, effects: { ...o.effects, blur: v > 0 ? v : undefined } }), 'Blur', true)}
          onCommit={() => core.commit('Blur')}
          defaultValue={0}
        />
      </Panel>
    </>
  );
}
