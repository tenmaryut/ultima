import { ColorPicker, Field, NumberField, Panel, Select, TextInput, Toggle } from '../../../components/ui';
import { useT } from '../../../core/i18n';
import { useEditor } from '../editor';
import { ARTBOARD_PRESETS } from '../model';
import { PaintField } from './PaintField';

/** Shown in the Properties panel when nothing is selected: document, artboard, defaults, grid. */
export function DocumentSection() {
  const t = useT();
  const core = useEditor();
  const ab = core.activeArtboard;
  const setAb = (patch: Partial<typeof ab>, label = 'Artboard') =>
    core.update((d) => ({ ...d, artboards: d.artboards.map((a) => (a.id === ab.id ? { ...a, ...patch } : a)) }), label);
  const preset = ARTBOARD_PRESETS.find((p) => p.width === ab.width && p.height === ab.height)?.id ?? 'custom';

  return (
    <>
      <Panel title={t('Document')}>
        <Field label={t('Name')}>
          <TextInput
            small
            key={core.doc.name}
            defaultValue={core.doc.name}
            onBlur={(e) => e.target.value.trim() && e.target.value !== core.doc.name && core.update((d) => ({ ...d, name: e.target.value.trim().slice(0, 200) }), 'Rename document')}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Field>
      </Panel>
      <Panel title={t('Artboard')}>
        <Field label={t('Size')}>
          <Select
            small
            value={preset}
            options={[...ARTBOARD_PRESETS.map((p) => ({ value: p.id, label: `${t(p.label)} (${p.width}×${p.height})` })), { value: 'custom', label: t('Custom') }]}
            onChange={(id) => {
              const p = ARTBOARD_PRESETS.find((x) => x.id === id);
              if (p) setAb({ width: p.width, height: p.height }, 'Artboard size');
            }}
          />
        </Field>
        <div className="vc-grid2">
          <Field label={t('W')}>
            <NumberField small value={ab.width} min={1} max={100000} onChange={(v) => setAb({ width: Math.round(v) }, 'Artboard size')} />
          </Field>
          <Field label={t('H')}>
            <NumberField small value={ab.height} min={1} max={100000} onChange={(v) => setAb({ height: Math.round(v) }, 'Artboard size')} />
          </Field>
        </div>
        <div className="row">
          <Toggle label={t('Transparent background')} checked={ab.background === null} onChange={(v) => setAb({ background: v ? null : '#ffffff' }, 'Artboard background')} />
          <span className="spacer" />
          {ab.background !== null && (
            <ColorPicker
              value={ab.background}
              alpha={false}
              label={t('Background')}
              onChange={(c) => core.updateLive((d) => ({ ...d, artboards: d.artboards.map((a) => (a.id === ab.id ? { ...a, background: c } : a)) }))}
              onCommit={() => core.commit('Artboard background')}
            />
          )}
        </div>
      </Panel>
      <Panel title={t('New objects')}>
        <Field label={t('Fill')}>
          <PaintField value={core.style.fill} onChange={(p) => core.setStyle({ ...core.style, fill: p })} onCommit={() => undefined} />
        </Field>
        <Field label={t('Stroke')}>
          <PaintField value={core.style.stroke.paint} onChange={(p) => core.setStyle({ ...core.style, stroke: { ...core.style.stroke, paint: p } })} onCommit={() => undefined} />
        </Field>
        <Field label={t('Stroke width')} inline>
          <NumberField small value={core.style.stroke.width} min={0} max={1000} step={0.5} suffix="px" onChange={(v) => core.setStyle({ ...core.style, stroke: { ...core.style.stroke, width: v } })} />
        </Field>
      </Panel>
      <Panel title={t('Grid & snapping')} defaultOpen={false}>
        <Toggle label={t('Show grid')} checked={core.viewOpts.grid} onChange={(v) => core.setViewOpts({ grid: v })} />
        <Toggle label={t('Snap to grid')} checked={core.viewOpts.snapToGrid} onChange={(v) => core.setViewOpts({ snapToGrid: v })} />
        <Toggle label={t('Smart guides')} checked={core.viewOpts.smartGuides} onChange={(v) => core.setViewOpts({ smartGuides: v })} />
        <Field label={t('Grid size')} inline>
          <NumberField small value={core.viewOpts.gridSize} min={2} max={1000} suffix="px" onChange={(v) => core.setViewOpts({ gridSize: Math.round(v) })} />
        </Field>
      </Panel>
    </>
  );
}
