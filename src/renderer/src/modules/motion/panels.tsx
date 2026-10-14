import { useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Activity,
  CircleArrowDown,
  Eye,
  EyeOff,
  Keyboard as KeyboardIcon,
  Maximize2,
  PenLine,
  Repeat,
  RotateCw,
  Settings2,
  Sparkles,
  Type,
  Vibrate,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { localizeDefaultName, useT } from '../../core/i18n';
import { formatTime } from '../../core/utils/format';
import { Button, ColorPicker, Field, NumberField, Panel, Select, Toggle } from '../../components/ui';
import { COMP_PRESETS, FPS_OPTIONS, LIMITS, setDuration, updateLayer } from './model';
import { PRESETS, type PresetId } from './presets';
import { useEditor } from './state';
import type { Composition, Layer } from './types';

/* ------------------------------- Composition ------------------------------- */

export function CompositionFields({
  comp,
  onChange,
  onNameCommit,
}: {
  comp: Composition;
  onChange: (patch: Partial<Composition>, label: string) => void;
  /** Called when the name field loses focus (lets callers record one undo step per rename). */
  onNameCommit?: () => void;
}) {
  const t = useT();
  const preset = COMP_PRESETS.find((p) => p.width === comp.width && p.height === comp.height)?.id ?? 'custom';
  return (
    <>
      <Field label={t('Name')}>
        <input
          className="input sm"
          value={localizeDefaultName(t, comp.name, ['Composition 1'])}
          onChange={(e) => onChange({ name: e.target.value.slice(0, 120) }, 'Rename composition')}
          onBlur={onNameCommit}
        />
      </Field>
      <Field label={t('Preset')}>
        <Select
          value={preset}
          options={[...COMP_PRESETS.map((p) => ({ value: p.id, label: t(p.label) })), { value: 'custom', label: t('Custom') }]}
          onChange={(v) => {
            const p = COMP_PRESETS.find((x) => x.id === v);
            if (p) onChange({ width: p.width, height: p.height, ...(p.fps ? { fps: p.fps } : {}) }, 'Composition size');
          }}
        />
      </Field>
      <div className="mo-grid2">
        <Field label={t('Width')}>
          <NumberField value={comp.width} min={LIMITS.minSize} max={LIMITS.maxSize} suffix="px" onChange={(v) => onChange({ width: Math.round(v) }, 'Composition size')} />
        </Field>
        <Field label={t('Height')}>
          <NumberField value={comp.height} min={LIMITS.minSize} max={LIMITS.maxSize} suffix="px" onChange={(v) => onChange({ height: Math.round(v) }, 'Composition size')} />
        </Field>
        <Field label={t('Frame rate')}>
          <Select
            value={FPS_OPTIONS.includes(comp.fps) ? comp.fps : -1}
            options={[...FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` })), ...(FPS_OPTIONS.includes(comp.fps) ? [] : [{ value: -1, label: `${comp.fps} fps` }])]}
            onChange={(v) => v > 0 && onChange({ fps: v }, 'Frame rate')}
          />
        </Field>
        <Field label={t('Duration')}>
          <NumberField value={comp.duration} min={LIMITS.minDuration} max={LIMITS.maxDuration} step={0.5} suffix="s" precision={2} onChange={(v) => onChange({ duration: v }, 'Duration')} />
        </Field>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <span className="field-label" style={{ minWidth: 70 }}>
          {t('Background')}
        </span>
        <ColorPicker value={comp.background} alpha={false} onChange={(c) => onChange({ background: c, transparent: false }, 'Background')} />
        <Toggle checked={comp.transparent} onChange={(v) => onChange({ transparent: v }, 'Transparent background')} label={t('Transparent')} />
      </div>
    </>
  );
}

export function CompositionPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useT();
  const ed = useEditor();
  const comp = ed.doc.comp;
  const change = (patch: Partial<Composition>, label: string) =>
    ed.setDoc(
      (d) => {
        let next = { ...d, comp: { ...d.comp, ...patch, duration: d.comp.duration } };
        if (patch.duration !== undefined) next = setDuration(next, patch.duration);
        return next;
      },
      // Typing a name is committed as one step when the field loses focus.
      { label, record: patch.name === undefined },
    );
  return (
    <div className="mo-props">
      <Panel title={t('Composition')} actions={<Button size="sm" variant="ghost" icon={Settings2} onClick={onOpenSettings}>{t('Settings…')}</Button>}>
        <CompositionFields comp={comp} onChange={change} onNameCommit={() => ed.commit('Rename composition')} />
        <div className="faint" style={{ fontSize: 11 }}>
          {t('{w}×{h} · {fps} fps · {d}', { w: comp.width, h: comp.height, fps: comp.fps, d: formatTime(comp.duration) })}
        </div>
      </Panel>
      <Panel title={t('Shortcuts')} defaultOpen={false}>
        <ShortcutList />
      </Panel>
    </div>
  );
}

function ShortcutList() {
  const t = useT();
  const items: [string, string][] = [
    ['Space', t('Play / pause')],
    ['← / →', t('Previous / next frame (Shift: 10 frames)')],
    ['J / K', t('Previous / next keyframe')],
    ['I / O', t('Go to layer in / out point')],
    ['U', t('Show animated properties')],
    ['B / N', t('Set work area start / end')],
    ['Alt+[ / Alt+]', t('Trim layer in / out to the playhead')],
    ['F9', t('Easy ease selected keyframes')],
    ['V T R E P Y H', t('Select, Text, Rectangle, Ellipse, Pen, Anchor point, Hand')],
    ['Ctrl+C / Ctrl+V', t('Copy / paste keyframes or layers')],
    ['Shift+drag', t('Constrain / snap to keyframes')],
  ];
  return (
    <div className="mo-shortcuts">
      {items.map(([k, v]) => (
        <div key={k} className="row" style={{ gap: 8 }}>
          <kbd className="kbd">{k}</kbd>
          <span className="muted" style={{ fontSize: 12 }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- Presets --------------------------------- */

const PRESET_ICONS: Record<PresetId, LucideIcon> = {
  fadeIn: Eye,
  fadeOut: EyeOff,
  slideInLeft: ArrowRight,
  slideInRight: ArrowLeft,
  slideInTop: ArrowDown,
  slideInBottom: ArrowUp,
  popIn: Maximize2,
  bounceIn: CircleArrowDown,
  spinIn: RotateCw,
  typewriter: KeyboardIcon,
  wordReveal: Type,
  wiggle: Activity,
  pulse: Zap,
  float: Wind,
  drawOn: PenLine,
  shake: Vibrate,
};

export function PresetsPanel({ onApply, onAnimate }: { onApply: (id: PresetId, duration: number, extra: { frequency?: number; amplitude?: number }) => void; onAnimate: () => void }) {
  const t = useT();
  const ed = useEditor();
  const [duration, setDuration] = useState<number | null>(null);
  const [frequency, setFrequency] = useState(2);
  const [amplitude, setAmplitude] = useState(20);
  const none = !ed.selected.length;
  return (
    <div className="mo-props">
      <Panel title={t('Animation presets')}>
        <div className="faint" style={{ fontSize: 12 }}>
          {none ? t('Select one or more layers, then click a preset. It starts at the playhead.') : t('Applies to {n} selected layer(s), starting at the playhead.', { n: ed.selected.length })}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Toggle checked={duration !== null} onChange={(v) => setDuration(v ? 1 : null)} label={t('Custom duration')} />
          {duration !== null && <NumberField value={duration} min={0.05} max={60} step={0.1} suffix="s" style={{ width: 90 }} onChange={setDuration} />}
        </div>
        <div className="mo-preset-grid">
          {PRESETS.map((p) => {
            const Icon = PRESET_ICONS[p.id];
            return (
              <button
                key={p.id}
                type="button"
                className="mo-preset"
                disabled={none}
                title={t(p.description)}
                onClick={() => onApply(p.id, duration ?? p.duration, p.id === 'wiggle' ? { frequency, amplitude } : {})}
              >
                <Icon size={16} />
                <span>{t(p.label)}</span>
              </button>
            );
          })}
        </div>
        <div className="mo-subhead">{t('Wiggle settings')}</div>
        <div className="mo-grid2">
          <Field label={t('Frequency')}>
            <NumberField value={frequency} min={0.1} max={30} step={0.1} suffix="Hz" onChange={setFrequency} />
          </Field>
          <Field label={t('Amplitude')}>
            <NumberField value={amplitude} min={0} max={2000} suffix="px" onChange={setAmplitude} />
          </Field>
        </div>
      </Panel>
      <Panel title={t('AI')}>
        <div className="faint" style={{ fontSize: 12 }}>
          {t('Describe a whole animation and let your AI build the layers and keyframes.')}
        </div>
        <Button icon={Sparkles} variant="primary" onClick={onAnimate}>
          {t('Animate from description…')}
        </Button>
      </Panel>
      <Panel title={t('Tips')} defaultOpen={false}>
        <div className="col muted" style={{ fontSize: 12, gap: 6 }}>
          <span>
            <Repeat size={11} /> {t('Presets replace keyframes inside their time range only, so you can stack an entrance and an exit.')}
          </span>
          <span>
            <Waves size={11} /> {t('Change the easing of any keyframe from the timeline (right-click or double-click a key).')}
          </span>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------- Media ---------------------------------- */

export function MediaSection({ layer, onReplace }: { layer: Layer; onReplace: () => void }) {
  const t = useT();
  const ed = useEditor();
  const asset = layer.assetId ? ed.doc.assets[layer.assetId] : undefined;
  return (
    <Panel title={layer.type === 'video' ? t('Video') : t('Image')}>
      {asset ? (
        <div className="faint" style={{ fontSize: 12 }}>
          {asset.name} · {asset.width}×{asset.height}
          {asset.duration ? ` · ${formatTime(asset.duration)}` : ''}
        </div>
      ) : (
        <div className="faint">{t('Missing media')}</div>
      )}
      {layer.type === 'video' && (
        <Field label={t('Start in source')}>
          <NumberField
            value={layer.mediaOffset ?? 0}
            min={0}
            max={asset?.duration ?? 3600}
            step={0.1}
            suffix="s"
            precision={2}
            onChange={(v) => ed.setDoc((d) => updateLayer(d, layer.id, (l) => ({ ...l, mediaOffset: v })), { label: 'Video start' })}
          />
        </Field>
      )}
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" onClick={onReplace}>
          {t('Replace…')}
        </Button>
        {asset && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const comp = ed.doc.comp;
              const s = Math.min(comp.width / asset.width, comp.height / asset.height) * 100;
              ed.setDoc(
                (d) =>
                  updateLayer(d, layer.id, (l) => ({
                    ...l,
                    props: { ...l.props, scale: { value: [s, s], keyframes: [] }, position: { value: [comp.width / 2, comp.height / 2], keyframes: [] }, anchor: { value: [0, 0], keyframes: [] } },
                  })),
                { label: 'Fit to composition' },
              );
            }}
          >
            {t('Fit to composition')}
          </Button>
        )}
      </div>
    </Panel>
  );
}

/* ----------------------------- Multi selection ----------------------------- */

export function MultiSelection({ count }: { count: number }) {
  const t = useT();
  return (
    <div className="mo-props">
      <Panel title={t('Selection')}>
        <div className="muted">{t('{n} layers selected', { n: count })}</div>
        <div className="faint" style={{ fontSize: 12 }}>
          {t('Drag on the canvas to move them together, apply presets from the Presets tab, or edit them one by one.')}
        </div>
      </Panel>
    </div>
  );
}
