import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Diamond, Link2, Plus, Sparkles, Timer, Trash2, Unlink2 } from 'lucide-react';
import { listSystemFonts } from '../../core/platform';
import { useT } from '../../core/i18n';
import { Button, ColorPicker, Field, IconButton, NumberField, Panel, Segmented, Select, Toggle } from '../../components/ui';
import { isAnimated } from './keyframes';
import { BLEND_MODES, getProp, isAncestor, LIMITS, PROP_DEFS, setParent, updateLayer } from './model';
import { toggleStopwatchOp } from './ops';
import { useEditor } from './state';
import { AnimatedPropControls, PropValueEditor } from './TimelineRows';
import type { Layer, PropKey, ShapeKind, TextData, ShapeData, Wiggle, WiggleTarget } from './types';

/* --------------------------------- Helpers --------------------------------- */

function AnimRow({ layer, propKey, label }: { layer: Layer; propKey: PropKey; label?: string }) {
  const t = useT();
  const ed = useEditor();
  const prop = getProp(layer, propKey);
  const animated = isAnimated(prop);
  return (
    <div className="mo-anim-row">
      <button
        type="button"
        className={`mo-stopwatch ${animated ? 'on' : ''}`}
        title={animated ? t('Stop animating (keeps the current value)') : t('Animate this property')}
        aria-label={t('Stopwatch')}
        aria-pressed={animated}
        disabled={layer.locked}
        onClick={() => ed.setDoc((d) => toggleStopwatchOp(d, layer.id, propKey, ed.time.get()), { label: animated ? 'Stopwatch off' : 'Stopwatch on' })}
      >
        <Timer size={13} />
      </button>
      <span className="mo-anim-label">{label ?? t(PROP_DEFS[propKey].label)}</span>
      <span className="mo-anim-value">
        {animated ? <AnimatedPropControls layer={layer} propKey={propKey} compact={false} /> : <PropValueEditor layer={layer} propKey={propKey} value={prop.value} />}
      </span>
    </div>
  );
}

function useLayerUpdate(layer: Layer) {
  const ed = useEditor();
  return (fn: (l: Layer) => Layer, label: string, record = true) => ed.setDoc((d) => updateLayer(d, layer.id, fn), { label, record });
}

/* ---------------------------------- Text ----------------------------------- */

let fontCache: string[] | null = null;

function TextSection({ layer, focusNonce }: { layer: Layer; focusNonce: number }) {
  const t = useT();
  const ed = useEditor();
  const update = useLayerUpdate(layer);
  const [fonts, setFonts] = useState<string[]>(fontCache ?? []);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const tx = layer.text!;
  useEffect(() => {
    if (fontCache) return;
    void listSystemFonts().then((list) => {
      fontCache = list;
      setFonts(list);
    });
  }, []);
  useEffect(() => {
    if (!focusNonce) return;
    const el = areaRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [focusNonce]);
  const setText = (patch: Partial<TextData>, label: string, record = true) => update((l) => ({ ...l, text: { ...l.text!, ...patch } }), label, record);
  const fontOptions = [...new Set([tx.fontFamily, ...(fonts.length ? fonts : ['Inter', 'Arial', 'Georgia', 'Impact', 'Courier New', 'sans-serif', 'serif', 'monospace'])])];
  return (
    <Panel title={t('Text')}>
      <textarea
        ref={areaRef}
        className="textarea mo-text-area"
        rows={3}
        value={tx.text}
        disabled={layer.locked}
        aria-label={t('Text')}
        onChange={(e) => {
          const value = e.target.value.slice(0, 5000);
          const firstLine = (s: string) => s.split('\n')[0].slice(0, 40);
          update(
            (l) => ({
              ...l,
              // Un-renamed text layers keep showing their text, like After Effects.
              name: l.name === firstLine(l.text!.text) || !l.name ? firstLine(value) || l.name : l.name,
              text: { ...l.text!, text: value },
            }),
            'Edit text',
            false,
          );
        }}
        onBlur={() => ed.commit('Edit text')}
      />
      <Field label={t('Font')}>
        <Select value={tx.fontFamily} options={fontOptions.map((f) => ({ value: f, label: f }))} onChange={(v) => setText({ fontFamily: v }, 'Font')} />
      </Field>
      <div className="mo-grid2">
        <Field label={t('Size')}>
          <NumberField value={tx.fontSize} min={1} max={2000} suffix="px" onChange={(v) => setText({ fontSize: v }, 'Font size')} />
        </Field>
        <Field label={t('Weight')}>
          <Select
            value={tx.fontWeight}
            options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))}
            onChange={(v) => setText({ fontWeight: v }, 'Font weight')}
          />
        </Field>
        <Field label={t('Line height')}>
          <NumberField value={tx.lineHeight} min={0.5} max={5} step={0.05} onChange={(v) => setText({ lineHeight: v }, 'Line height')} />
        </Field>
        <Field label={t('Alignment')}>
          <Segmented
            value={tx.align}
            onChange={(v) => setText({ align: v }, 'Alignment')}
            options={[
              { value: 'left', icon: AlignLeft, title: t('Left') },
              { value: 'center', icon: AlignCenter, title: t('Center') },
              { value: 'right', icon: AlignRight, title: t('Right') },
            ]}
          />
        </Field>
      </div>
      <Toggle checked={tx.italic} onChange={(v) => setText({ italic: v }, 'Italic')} label={t('Italic')} />
      <Toggle checked={tx.fillEnabled} onChange={(v) => setText({ fillEnabled: v }, 'Fill')} label={t('Fill')} />
      {tx.fillEnabled && <AnimRow layer={layer} propKey="fill" />}
      <Toggle checked={tx.strokeEnabled} onChange={(v) => setText({ strokeEnabled: v }, 'Stroke')} label={t('Stroke')} />
      {tx.strokeEnabled && (
        <>
          <AnimRow layer={layer} propKey="strokeColor" />
          <AnimRow layer={layer} propKey="strokeWidth" />
        </>
      )}
      <AnimRow layer={layer} propKey="letterSpacing" />
      <AnimRow layer={layer} propKey="reveal" />
      <div className="mo-grid2">
        <Field label={t('Reveal by')}>
          <Select
            value={tx.revealMode}
            options={[
              { value: 'chars', label: t('Characters') },
              { value: 'words', label: t('Words') },
              { value: 'lines', label: t('Lines') },
            ]}
            onChange={(v) => setText({ revealMode: v }, 'Reveal mode')}
          />
        </Field>
        <Field label={t('Reveal style')}>
          <Select
            value={tx.revealStyle}
            options={[
              { value: 'instant', label: t('Instant') },
              { value: 'fade', label: t('Fade') },
              { value: 'rise', label: t('Fade & rise') },
            ]}
            onChange={(v) => setText({ revealStyle: v }, 'Reveal style')}
          />
        </Field>
      </div>
    </Panel>
  );
}

/* ---------------------------------- Shape ---------------------------------- */

function ShapeSection({ layer }: { layer: Layer }) {
  const t = useT();
  const update = useLayerUpdate(layer);
  const sh = layer.shape!;
  const setShape = (patch: Partial<ShapeData>, label: string) => update((l) => ({ ...l, shape: { ...l.shape!, ...patch } }), label);
  const kinds: { value: ShapeKind; label: string }[] = [
    { value: 'rect', label: t('Rectangle') },
    { value: 'ellipse', label: t('Ellipse') },
    { value: 'polygon', label: t('Polygon') },
    { value: 'star', label: t('Star') },
    { value: 'line', label: t('Line') },
  ];
  return (
    <Panel title={t('Shape')}>
      {sh.kind !== 'path' ? (
        <Field label={t('Type')}>
          <Select value={sh.kind} options={kinds} onChange={(v) => setShape({ kind: v, fillEnabled: v === 'line' ? false : sh.fillEnabled, strokeEnabled: v === 'line' ? true : sh.strokeEnabled }, 'Shape type')} />
        </Field>
      ) : (
        <div className="faint" style={{ fontSize: 12 }}>
          {t('Path with {n} point(s). Drag points on the canvas to edit them (Alt breaks handles).', { n: (sh.path ?? []).reduce((a, p) => a + p.nodes.length, 0) })}
        </div>
      )}
      {sh.kind !== 'path' && <AnimRow layer={layer} propKey="size" label={sh.kind === 'line' ? t('Length') : undefined} />}
      {sh.kind === 'rect' && <AnimRow layer={layer} propKey="cornerRadius" />}
      {(sh.kind === 'polygon' || sh.kind === 'star') && (
        <div className="mo-grid2">
          <Field label={sh.kind === 'star' ? t('Points') : t('Sides')}>
            <NumberField value={sh.points} min={3} max={100} onChange={(v) => setShape({ points: Math.round(v) }, 'Points')} />
          </Field>
          {sh.kind === 'star' && (
            <Field label={t('Inner radius')}>
              <NumberField value={sh.innerRadius} min={1} max={100} suffix="%" onChange={(v) => setShape({ innerRadius: v }, 'Inner radius')} />
            </Field>
          )}
        </div>
      )}
      {sh.kind !== 'line' && <Toggle checked={sh.fillEnabled} onChange={(v) => setShape({ fillEnabled: v }, 'Fill')} label={t('Fill')} />}
      {sh.fillEnabled && sh.kind !== 'line' && <AnimRow layer={layer} propKey="fill" />}
      <Toggle checked={sh.strokeEnabled} onChange={(v) => setShape({ strokeEnabled: v }, 'Stroke')} label={t('Stroke')} />
      {sh.strokeEnabled && (
        <>
          <AnimRow layer={layer} propKey="strokeColor" />
          <AnimRow layer={layer} propKey="strokeWidth" />
          <div className="mo-grid2">
            <Field label={t('Line cap')}>
              <Select
                value={sh.lineCap}
                options={[
                  { value: 'butt', label: t('Butt') },
                  { value: 'round', label: t('Round') },
                  { value: 'square', label: t('Square') },
                ]}
                onChange={(v) => setShape({ lineCap: v }, 'Line cap')}
              />
            </Field>
            <Field label={t('Line join')}>
              <Select
                value={sh.lineJoin}
                options={[
                  { value: 'miter', label: t('Miter') },
                  { value: 'round', label: t('Round') },
                  { value: 'bevel', label: t('Bevel') },
                ]}
                onChange={(v) => setShape({ lineJoin: v }, 'Line join')}
              />
            </Field>
          </div>
        </>
      )}
      <div className="mo-subhead">{t('Trim Paths')}</div>
      <AnimRow layer={layer} propKey="trimStart" />
      <AnimRow layer={layer} propKey="trimEnd" />
    </Panel>
  );
}

/* --------------------------------- Effects --------------------------------- */

function EffectsSection({ layer }: { layer: Layer }) {
  const t = useT();
  const ed = useEditor();
  const update = useLayerUpdate(layer);
  const fx = layer.effects;
  const setShadow = (patch: Partial<Layer['effects']['shadow']>, record = true) =>
    update((l) => ({ ...l, effects: { ...l.effects, shadow: { ...l.effects.shadow, ...patch } } }), 'Drop shadow', record);
  const setGlow = (patch: Partial<Layer['effects']['glow']>, record = true) =>
    update((l) => ({ ...l, effects: { ...l.effects, glow: { ...l.effects.glow, ...patch } } }), 'Glow', record);
  return (
    <Panel title={t('Effects')} defaultOpen={fx.shadow.enabled || fx.glow.enabled || isAnimated(layer.props.blur) || layer.props.blur.value > 0}>
      <AnimRow layer={layer} propKey="blur" />
      <Toggle checked={fx.shadow.enabled} onChange={(v) => setShadow({ enabled: v })} label={t('Drop shadow')} />
      {fx.shadow.enabled && (
        <div className="mo-grid2">
          <Field label={t('Color')}>
            <ColorPicker value={fx.shadow.color} onChange={(c) => setShadow({ color: c }, false)} onCommit={() => ed.commit('Drop shadow')} />
          </Field>
          <Field label={t('Angle')}>
            <NumberField value={fx.shadow.angle} min={-360} max={360} suffix="°" onChange={(v) => setShadow({ angle: v })} />
          </Field>
          <Field label={t('Distance')}>
            <NumberField value={fx.shadow.distance} min={0} max={2000} suffix="px" onChange={(v) => setShadow({ distance: v })} />
          </Field>
          <Field label={t('Softness')}>
            <NumberField value={fx.shadow.softness} min={0} max={500} suffix="px" onChange={(v) => setShadow({ softness: v })} />
          </Field>
        </div>
      )}
      <Toggle checked={fx.glow.enabled} onChange={(v) => setGlow({ enabled: v })} label={t('Glow')} />
      {fx.glow.enabled && (
        <div className="mo-grid2">
          <Field label={t('Color')}>
            <ColorPicker value={fx.glow.color} onChange={(c) => setGlow({ color: c }, false)} onCommit={() => ed.commit('Glow')} />
          </Field>
          <Field label={t('Radius')}>
            <NumberField value={fx.glow.radius} min={0} max={500} suffix="px" onChange={(v) => setGlow({ radius: v })} />
          </Field>
          <Field label={t('Intensity')}>
            <NumberField value={fx.glow.intensity} min={0} max={300} suffix="%" onChange={(v) => setGlow({ intensity: v })} />
          </Field>
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------- Wiggles --------------------------------- */

function WiggleSection({ layer }: { layer: Layer }) {
  const t = useT();
  const ed = useEditor();
  const update = useLayerUpdate(layer);
  const comp = ed.doc.comp;
  const patch = (id: string, p: Partial<Wiggle>) => update((l) => ({ ...l, wiggles: l.wiggles.map((w) => (w.id === id ? { ...w, ...p } : w)) }), 'Edit wiggle');
  return (
    <Panel
      title={t('Wiggle (procedural)')}
      defaultOpen={layer.wiggles.length > 0}
      actions={
        <IconButton
          icon={Plus}
          size="sm"
          label={t('Add wiggle')}
          onClick={() =>
            update(
              (l) => ({
                ...l,
                wiggles: [
                  ...l.wiggles,
                  { id: `w${Date.now().toString(36)}`, property: 'position', frequency: 2, amplitude: Math.round(Math.min(comp.width, comp.height) * 0.02), seed: Math.floor(Math.random() * 99999), start: l.inPoint, end: l.outPoint },
                ],
              }),
              'Add wiggle',
            )
          }
        />
      }
    >
      {!layer.wiggles.length && <div className="faint" style={{ fontSize: 12 }}>{t('Random smooth motion like the wiggle() expression. Add one with +.')}</div>}
      {layer.wiggles.map((w) => (
        <div key={w.id} className="mo-wiggle-card">
          <div className="row" style={{ gap: 6 }}>
            <Select<WiggleTarget>
              small
              value={w.property}
              options={[
                { value: 'position', label: t('Position') },
                { value: 'rotation', label: t('Rotation') },
                { value: 'scale', label: t('Scale') },
                { value: 'opacity', label: t('Opacity') },
              ]}
              onChange={(v) => patch(w.id, { property: v })}
            />
            <IconButton icon={Trash2} size="sm" label={t('Remove wiggle')} onClick={() => update((l) => ({ ...l, wiggles: l.wiggles.filter((x) => x.id !== w.id) }), 'Remove wiggle')} />
          </div>
          <div className="mo-grid2">
            <Field label={t('Frequency')}>
              <NumberField value={w.frequency} min={0.1} max={30} step={0.1} suffix="Hz" onChange={(v) => patch(w.id, { frequency: v })} />
            </Field>
            <Field label={t('Amplitude')}>
              <NumberField value={w.amplitude} min={0} max={5000} onChange={(v) => patch(w.id, { amplitude: v })} />
            </Field>
            <Field label={t('Start')}>
              <NumberField value={w.start} min={0} max={LIMITS.maxDuration} step={0.1} suffix="s" onChange={(v) => patch(w.id, { start: Math.min(v, w.end) })} />
            </Field>
            <Field label={t('End')}>
              <NumberField value={w.end} min={0} max={LIMITS.maxDuration} step={0.1} suffix="s" onChange={(v) => patch(w.id, { end: Math.max(v, w.start) })} />
            </Field>
          </div>
        </div>
      ))}
    </Panel>
  );
}

/* ---------------------------------- Layer ---------------------------------- */

export function LayerProperties({ layer, focusTextNonce, onSuggest, mediaSection }: { layer: Layer; focusTextNonce: number; onSuggest: () => void; mediaSection?: ReactNode }) {
  const t = useT();
  const ed = useEditor();
  const update = useLayerUpdate(layer);
  const parents = ed.doc.layers.filter((l) => l.id !== layer.id && !isAncestor(ed.doc, l.id, layer.id));
  return (
    <div className="mo-props">
      <div className="mo-props-head">
        <input
          className="input sm"
          value={layer.name}
          aria-label={t('Layer name')}
          onChange={(e) => update((l) => ({ ...l, name: e.target.value.slice(0, 120) }), 'Rename layer', false)}
          onBlur={() => ed.commit('Rename layer')}
        />
        <Button size="sm" icon={Sparkles} title={t('Ask the AI to improve easing and timing of this layer')} onClick={onSuggest}>
          {t('Suggest timing')}
        </Button>
      </div>
      <Panel title={t('Layer')}>
        <div className="mo-grid2">
          <Field label={t('Blend mode')}>
            <Select value={layer.blendMode} options={BLEND_MODES.map((b) => ({ value: b.value, label: t(b.label) }))} onChange={(v) => update((l) => ({ ...l, blendMode: v }), 'Blend mode')} />
          </Field>
          <Field label={t('Parent')}>
            <Select
              value={layer.parentId ?? ''}
              options={[{ value: '', label: t('No parent') }, ...parents.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => ed.setDoc((d) => setParent(d, layer.id, v || null, ed.time.get()), { label: 'Parent' })}
            />
          </Field>
          <Field label={t('In point')}>
            <NumberField value={layer.inPoint} min={0} max={layer.outPoint - 0.01} step={1 / ed.doc.comp.fps} suffix="s" precision={2} onChange={(v) => update((l) => ({ ...l, inPoint: v }), 'Trim layer')} />
          </Field>
          <Field label={t('Out point')}>
            <NumberField value={layer.outPoint} min={layer.inPoint + 0.01} max={LIMITS.maxDuration} step={1 / ed.doc.comp.fps} suffix="s" precision={2} onChange={(v) => update((l) => ({ ...l, outPoint: v }), 'Trim layer')} />
          </Field>
        </div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <Toggle checked={layer.visible} onChange={(v) => update((l) => ({ ...l, visible: v }), 'Visibility')} label={t('Visible')} />
          <Toggle checked={layer.solo} onChange={(v) => update((l) => ({ ...l, solo: v }), 'Solo')} label={t('Solo')} />
          <Toggle checked={layer.locked} onChange={(v) => update((l) => ({ ...l, locked: v }), 'Lock')} label={t('Locked')} />
        </div>
      </Panel>
      <Panel
        title={t('Transform')}
        actions={
          <IconButton
            icon={ed.scaleLinked ? Link2 : Unlink2}
            size="sm"
            label={ed.scaleLinked ? t('Scale X/Y linked') : t('Scale X/Y independent')}
            active={ed.scaleLinked}
            onClick={() => ed.setScaleLinked(!ed.scaleLinked)}
          />
        }
      >
        <AnimRow layer={layer} propKey="anchor" />
        <AnimRow layer={layer} propKey="position" />
        <AnimRow layer={layer} propKey="scale" />
        <AnimRow layer={layer} propKey="rotation" />
        <AnimRow layer={layer} propKey="opacity" />
        <div className="faint mo-hint">
          <Diamond size={10} /> {t('Turn on the stopwatch to animate: every change then sets a keyframe at the playhead.')}
        </div>
      </Panel>
      {layer.type === 'text' && layer.text && <TextSection layer={layer} focusNonce={focusTextNonce} />}
      {layer.type === 'shape' && layer.shape && <ShapeSection layer={layer} />}
      {layer.type === 'solid' && (
        <Panel title={t('Solid')}>
          <AnimRow layer={layer} propKey="fill" label={t('Color')} />
          <AnimRow layer={layer} propKey="size" />
          <Button
            size="sm"
            onClick={() =>
              update((l) => ({
                ...l,
                props: {
                  ...l.props,
                  size: { value: [ed.doc.comp.width, ed.doc.comp.height], keyframes: [] },
                  position: { value: [ed.doc.comp.width / 2, ed.doc.comp.height / 2], keyframes: [] },
                },
              }), 'Fit to composition')
            }
          >
            {t('Fit to composition')}
          </Button>
        </Panel>
      )}
      {mediaSection}
      {layer.type !== 'null' && <EffectsSection layer={layer} />}
      <WiggleSection layer={layer} />
    </div>
  );
}
