import { useState } from 'react';
import { FileUp, RotateCcw } from 'lucide-react';
import type { Clip, ClipMask, ColorGrade, CurveChannel, CurvePoint, HueRange, LookId, MaskShape, Project, VisualProps } from '../types';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Panel, Segmented, Select, Slider, Toggle } from '../../../components/ui';
import { DEFAULT_GRADE, DEFAULT_MASK, EFFECT_PROPS } from '../presets';
import { CURVE_CHANNELS, HUE_RANGES, LOOKS, isIdentityCurve } from '../grade';
import { letterboxBars } from '../fx';
import { parseGrade } from '../project';
import { withoutKeys } from '../keyframes';
import { CurvesEditor } from './CurvesEditor';
import { KeySlider, type KeyEdit } from './KeyControls';
import type { TimeStore } from '../timeStore';

/* Inspector panels for effects, color grading and masks. */

type Edit = (fn: (c: Clip) => Clip, label: string) => void;
type Live = (fn: (c: Clip) => Clip) => void;

const pct = (v: number) => `${Math.round(v)}%`;
const px = (v: number) => `${+v.toFixed(1)} px`;

/** A grade with `patch` applied, cleaned (undefined when it no longer does anything). */
function withGrade(c: Clip, patch: Partial<ColorGrade>, lutIds: Set<string>): Clip {
  return { ...c, grade: parseGrade({ ...(c.grade ?? DEFAULT_GRADE), ...patch }, lutIds) };
}

export function EffectsPanel(props: {
  clip: Clip;
  project: Project;
  time: TimeStore;
  keyProps: { time: TimeStore; live: KeyEdit; apply: KeyEdit; done: (label: string) => void };
  set: Edit;
  live: Live;
  done: (label: string) => void;
}) {
  const t = useT();
  const { clip, project } = props;
  const v = clip.visual!;
  const { width: W, height: H } = project.settings;
  const active = EFFECT_PROPS.some((e) => v[e.prop] > 0 || clip.keys?.[e.prop]?.length);
  const setV = (patch: Partial<VisualProps>, label: string) => props.set((c) => ({ ...c, visual: { ...c.visual!, ...patch } }), label);
  return (
    <Panel
      title={t('Effects')}
      defaultOpen={active}
      actions={
        <IconButton
          size="sm"
          icon={RotateCcw}
          label={t('Reset effects')}
          onClick={() =>
            props.set((c) => {
              let next: Clip = { ...c, visual: { ...c.visual!, ...Object.fromEntries(EFFECT_PROPS.map((e) => [e.prop, 0])) } };
              for (const e of EFFECT_PROPS) next = withoutKeys(next, e.prop);
              return next;
            }, t('Reset effects'))
          }
        />
      }
    >
      {EFFECT_PROPS.map((e) => (
        <div key={e.prop}>
          <KeySlider
            {...props.keyProps}
            clip={clip}
            prop={e.prop}
            label={t(e.label)}
            min={0}
            max={e.unit === '%' ? e.max * 100 : e.max}
            step={e.unit === '%' ? 1 : e.step}
            unit={e.unit === '%' ? 100 : 1}
            format={e.unit === '%' ? pct : px}
            defaultValue={0}
            commitLabel={t(e.label)}
          />
          {e.prop === 'shake' && (v.shake > 0 || clip.keys?.shake) && (
            <Slider label={t('Shake speed')} value={v.shakeSpeed} min={1} max={40} step={0.5} onChange={(x) => props.live((c) => ({ ...c, visual: { ...c.visual!, shakeSpeed: x } }))} onCommit={() => props.done(t('Camera shake'))} format={(x) => `${x}/s`} defaultValue={12} />
          )}
          {e.prop === 'glow' && (v.glow > 0 || clip.keys?.glow) && (
            <Slider label={t('Glow radius')} value={v.glowRadius} min={2} max={120} onChange={(x) => props.live((c) => ({ ...c, visual: { ...c.visual!, glowRadius: x } }))} onCommit={() => props.done(t('Glow'))} format={px} defaultValue={24} />
          )}
          {e.prop === 'motionBlur' && (v.motionBlur > 0 || clip.keys?.motionBlur) && (
            <Slider label={t('Blur direction')} value={v.motionBlurAngle} min={-180} max={180} onChange={(x) => props.live((c) => ({ ...c, visual: { ...c.visual!, motionBlurAngle: x } }))} onCommit={() => props.done(t('Motion blur'))} format={(x) => `${Math.round(x)}°`} defaultValue={0} />
          )}
          {e.prop === 'letterbox' && (
            <div className="vd-swatches">
              {[
                ['2.39:1', 2.39],
                ['2:1', 2],
                ['1.85:1', 1.85],
              ].map(([label, ratio]) => (
                <Button key={label} size="sm" onClick={() => setV({ letterbox: letterboxBars(ratio as number, W, H) }, t('Letterbox'))}>
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="vd-hint">{t('Every effect can be animated with ◆ — for example a zoom blur or shake for a fraction of a second on a beat.')}</div>
    </Panel>
  );
}

export function ColorGradePanel(props: { clip: Clip; project: Project; set: Edit; live: Live; done: (label: string) => void; onImportLut: () => Promise<string[]> }) {
  const t = useT();
  const { clip, project } = props;
  const g = clip.grade ?? DEFAULT_GRADE;
  const lutIds = new Set(project.luts.map((l) => l.id));
  const [channel, setChannel] = useState<CurveChannel>('master');
  const [range, setRange] = useState<HueRange>('orange');
  const setGrade = (patch: Partial<ColorGrade>, label: string) => props.set((c) => withGrade(c, patch, lutIds), label);
  const liveGrade = (patch: Partial<ColorGrade>) => props.live((c) => withGrade(c, patch, lutIds));
  const hsl = g.hsl?.[range] ?? { h: 0, s: 0, l: 0 };
  const setHsl = (patch: Partial<{ h: number; s: number; l: number }>, live: boolean) => {
    const next = { ...(g.hsl ?? {}), [range]: { ...hsl, ...patch } };
    if (live) liveGrade({ hsl: next });
    else setGrade({ hsl: next }, t('Color grade'));
  };
  const curve = g.curves?.[channel];
  return (
    <Panel
      title={t('Color grade')}
      defaultOpen={Boolean(clip.grade)}
      actions={<IconButton size="sm" icon={RotateCcw} label={t('Reset color grade')} onClick={() => props.set((c) => ({ ...c, grade: undefined }), t('Reset color grade'))} />}
    >
      <div className="vd-section-title">{t('Look')}</div>
      <Select<string>
        small
        value={g.look ?? 'none'}
        onChange={(id) => setGrade({ look: id === 'none' ? undefined : (id as LookId) }, t('Look'))}
        options={[{ value: 'none', label: t('None') }, ...LOOKS.map((l) => ({ value: l.id, label: t(l.label) }))]}
      />
      {g.look && <Slider label={t('Strength')} value={Math.round(g.lookAmount * 100)} min={0} max={100} onChange={(x) => liveGrade({ lookAmount: x / 100 })} onCommit={() => props.done(t('Look'))} format={pct} defaultValue={100} />}

      <div className="vd-section-title">{t('LUT (.cube)')}</div>
      <div className="vd-swatches">
        <Select<string>
          small
          value={g.lut ?? 'none'}
          onChange={(id) => setGrade({ lut: id === 'none' ? undefined : id }, t('LUT'))}
          options={[{ value: 'none', label: t('None') }, ...project.luts.map((l) => ({ value: l.id, label: l.name }))]}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button
          size="sm"
          icon={FileUp}
          onClick={async () => {
            const ids = await props.onImportLut();
            if (ids.length) props.set((c) => ({ ...c, grade: parseGrade({ ...(c.grade ?? DEFAULT_GRADE), lut: ids[0] }, new Set([...lutIds, ...ids])) }), t('LUT'));
          }}
        >
          {t('Import…')}
        </Button>
      </div>
      {g.lut && <Slider label={t('Strength')} value={Math.round(g.lutAmount * 100)} min={0} max={100} onChange={(x) => liveGrade({ lutAmount: x / 100 })} onCommit={() => props.done(t('LUT'))} format={pct} defaultValue={100} />}

      <div className="vd-section-title">{t('Curves')}</div>
      <Segmented
        value={channel}
        onChange={setChannel}
        options={CURVE_CHANNELS.map((c) => ({ value: c, label: c === 'master' ? t('RGB') : c.toUpperCase() }))}
      />
      <CurvesEditor
        channel={channel}
        points={curve}
        onChange={(pts: CurvePoint[], commit) => {
          const curves = { ...(g.curves ?? {}), [channel]: pts };
          if (commit) setGrade({ curves }, t('Curves'));
          else liveGrade({ curves });
        }}
      />
      {!isIdentityCurve(curve) && (
        <Button size="sm" onClick={() => setGrade({ curves: { ...(g.curves ?? {}), [channel]: undefined } }, t('Curves'))}>
          {t('Reset this curve')}
        </Button>
      )}

      <div className="vd-section-title">{t('Color ranges (HSL)')}</div>
      <div className="vd-hue-ranges" role="radiogroup" aria-label={t('Color range')}>
        {HUE_RANGES.map((r) => {
          const adj = g.hsl?.[r.id];
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={range === r.id}
              title={t(r.label)}
              aria-label={t(r.label)}
              className={`vd-hue ${range === r.id ? 'active' : ''} ${adj && (adj.h || adj.s || adj.l) ? 'changed' : ''}`}
              style={{ background: r.swatch }}
              onClick={() => setRange(r.id)}
            />
          );
        })}
      </div>
      <Slider label={t('Hue')} value={hsl.h} min={-30} max={30} onChange={(h) => setHsl({ h }, true)} onCommit={() => props.done(t('Color grade'))} format={(x) => `${Math.round(x)}°`} defaultValue={0} />
      <Slider label={t('Saturation')} value={hsl.s} min={-100} max={100} onChange={(s) => setHsl({ s }, true)} onCommit={() => props.done(t('Color grade'))} defaultValue={0} />
      <Slider label={t('Luminance')} value={hsl.l} min={-100} max={100} onChange={(l) => setHsl({ l }, true)} onCommit={() => props.done(t('Color grade'))} defaultValue={0} />
    </Panel>
  );
}

const MASK_SHAPES: { value: MaskShape | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'linear', label: 'Linear (split)' },
];

export function MaskPanel(props: { clip: Clip; set: Edit; live: Live; done: (label: string) => void }) {
  const t = useT();
  const m = props.clip.mask;
  const liveMask = (patch: Partial<ClipMask>) => props.live((c) => ({ ...c, mask: { ...(c.mask ?? DEFAULT_MASK), ...patch } }));
  const slider = (key: 'x' | 'y' | 'w' | 'h' | 'feather', label: string, max: number, def: number) => (
    <Slider label={t(label)} value={Math.round((m?.[key] ?? 0) * 100)} min={0} max={max} onChange={(x) => liveMask({ [key]: x / 100 })} onCommit={() => props.done(t('Mask'))} format={pct} defaultValue={def} />
  );
  return (
    <Panel title={t('Mask')} defaultOpen={Boolean(m)}>
      <Select<string>
        small
        value={m?.shape ?? 'none'}
        onChange={(shape) => props.set((c) => ({ ...c, mask: shape === 'none' ? undefined : { ...(c.mask ?? DEFAULT_MASK), shape: shape as MaskShape } }), t('Mask'))}
        options={MASK_SHAPES.map((s) => ({ value: s.value, label: t(s.label) }))}
      />
      {m && (
        <>
          <div className="vd-grid2">
            {slider('x', 'Center X', 100, 50)}
            {slider('y', 'Center Y', 100, 50)}
          </div>
          {m.shape !== 'linear' && (
            <div className="vd-grid2">
              {slider('w', 'Width', 200, 60)}
              {slider('h', 'Height', 200, 60)}
            </div>
          )}
          <Slider label={t('Rotation')} value={m.rotation} min={-180} max={180} onChange={(rotation) => liveMask({ rotation })} onCommit={() => props.done(t('Mask'))} format={(x) => `${Math.round(x)}°`} defaultValue={0} />
          {slider('feather', 'Feather', 50, 5)}
          <Toggle checked={m.invert} onChange={(invert) => props.set((c) => ({ ...c, mask: { ...(c.mask ?? DEFAULT_MASK), invert } }), t('Mask'))} label={t('Invert (show the outside)')} />
          <div className="vd-hint">{t('Positions are fractions of the clip’s picture, so the mask moves with the clip.')}</div>
        </>
      )}
    </Panel>
  );
}
