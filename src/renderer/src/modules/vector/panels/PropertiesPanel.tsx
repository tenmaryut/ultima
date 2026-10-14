import { useState } from 'react';
import { FlipHorizontal2, FlipVertical2, ImagePlus, Link2, Link2Off, RotateCcw, RotateCw, TextAlignCenter, TextAlignEnd, TextAlignStart } from 'lucide-react';
import { Field, IconButton, NumberField, Panel, Segmented, Select, Slider, TextArea, TextInput, Toggle, toast } from '../../../components/ui';
import { useT } from '../../../core/i18n';
import { pickFiles } from '../../../core/platform';
import { loadImage } from '../../../core/utils/image';
import { useEditor } from '../editor';
import { selectionBounds } from '../geometry';
import { TYPE_LABELS, type FillRule, type TextAlign, type TextObject, type VDoc, type VObject } from '../model';
import { findById, getFrame, mapTree, setFrame, setSelectionBox, topLevelSelection } from '../ops';
import type { EditActions } from '../actions';
import { AppearanceSection } from './AppearancePanel';
import { DocumentSection } from './DocumentSection';

const WEIGHTS = [
  [100, 'Thin'],
  [200, 'Extra Light'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semi Bold'],
  [700, 'Bold'],
  [800, 'Extra Bold'],
  [900, 'Black'],
] as const;

export function PropertiesPanel({ actions }: { actions: EditActions }) {
  const t = useT();
  const core = useEditor();
  const [lockRatio, setLockRatio] = useState(false);
  const objects = core.doc.objects;
  const ids = topLevelSelection(objects, core.selection);
  const objs = ids.map((id) => findById(objects, id)).filter((o): o is VObject => Boolean(o));
  const single = objs.length === 1 ? objs[0] : null;
  const ab = core.activeArtboard;

  const patch = (fn: (o: VObject) => VObject, label: string, live = false) => {
    const set = new Set(ids);
    const apply = (d: VDoc) => ({ ...d, objects: mapTree(d.objects, (o) => (set.has(o.id) ? fn(o) : o)) });
    if (live) core.updateLive(apply);
    else core.update(apply, label);
  };

  if (!objs.length) return <DocumentSection />;

  // transform values (relative to the active artboard)
  const frame = single ? getFrame(objects, single.id) : null;
  const bounds = !single ? selectionBounds(objects, ids) : null;
  const X = frame ? frame.x : (bounds?.x ?? 0);
  const Y = frame ? frame.y : (bounds?.y ?? 0);
  const W = frame ? frame.w : (bounds?.width ?? 0);
  const H = frame ? frame.h : (bounds?.height ?? 0);
  const setBox = (next: { x?: number; y?: number; w?: number; h?: number; rotation?: number }) => {
    let { w, h } = next;
    if (lockRatio && W > 0 && H > 0) {
      if (w !== undefined && h === undefined) h = (w / W) * H;
      else if (h !== undefined && w === undefined) w = (h / H) * W;
    }
    core.update((d) => {
      if (single) return { ...d, objects: setFrame(d.objects, single.id, { ...next, w, h }) };
      return { ...d, objects: setSelectionBox(d.objects, ids, { x: next.x, y: next.y, width: w, height: h }) };
    }, 'Transform');
  };

  const text = single?.type === 'text' ? (single as TextObject) : null;
  const fonts = core.fonts.includes(text?.fontFamily ?? '') || !text ? core.fonts : [text.fontFamily, ...core.fonts];

  return (
    <>
      <Panel title={single ? t(TYPE_LABELS[single.type]) : t('{count} objects', { count: objs.length })}>
        {single && (
          <Field label={t('Name')}>
            <TextInput
              small
              key={single.id}
              defaultValue={single.name}
              onBlur={(e) => e.target.value !== single.name && patch((o) => ({ ...o, name: e.target.value.slice(0, 200) }), 'Rename')}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </Field>
        )}
        <div className="vc-grid2">
          <Field label="X">
            <NumberField small value={round2(X - ab.x)} onChange={(v) => setBox({ x: v + ab.x })} />
          </Field>
          <Field label="Y">
            <NumberField small value={round2(Y - ab.y)} onChange={(v) => setBox({ y: v + ab.y })} />
          </Field>
          <Field label={t('W')}>
            <NumberField small value={round2(W)} min={0.01} onChange={(v) => setBox({ w: v })} />
          </Field>
          <Field label={t('H')}>
            <NumberField small value={round2(H)} min={0.01} onChange={(v) => setBox({ h: v })} />
          </Field>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {single && (
            <NumberField
              small
              value={round2(frame?.rotation ?? 0)}
              suffix="°"
              title={t('Rotation')}
              style={{ width: 84 }}
              onChange={(v) => setBox({ rotation: ((((v + 180) % 360) + 360) % 360) - 180 })}
            />
          )}
          <IconButton icon={lockRatio ? Link2 : Link2Off} size="sm" active={lockRatio} label={t('Keep proportions')} onClick={() => setLockRatio((v) => !v)} />
          <span className="spacer" />
          <IconButton icon={RotateCcw} size="sm" label={t('Rotate 90° left')} onClick={() => actions.rotate(-90)} />
          <IconButton icon={RotateCw} size="sm" label={t('Rotate 90° right')} onClick={() => actions.rotate(90)} />
          <IconButton icon={FlipHorizontal2} size="sm" label={t('Flip horizontal')} onClick={() => actions.flip('h')} />
          <IconButton icon={FlipVertical2} size="sm" label={t('Flip vertical')} onClick={() => actions.flip('v')} />
        </div>
      </Panel>

      {single?.type === 'rect' && (
        <Panel title={t('Rectangle')}>
          <Slider
            label={t('Corner radius')}
            min={0}
            max={Math.max(1, Math.round(Math.min(single.width, single.height) / 2))}
            value={Math.min(single.radius, Math.min(single.width, single.height) / 2)}
            format={(v) => `${Math.round(v)} px`}
            onChange={(v) => patch((o) => (o.type === 'rect' ? { ...o, radius: v } : o), 'Corner radius', true)}
            onCommit={() => core.commit('Corner radius')}
          />
        </Panel>
      )}
      {single?.type === 'polygon' && (
        <Panel title={t('Polygon')}>
          <Slider
            label={t('Sides')}
            min={3}
            max={24}
            value={single.sides}
            onChange={(v) => patch((o) => (o.type === 'polygon' ? { ...o, sides: Math.round(v) } : o), 'Sides', true)}
            onCommit={() => core.commit('Sides')}
          />
        </Panel>
      )}
      {single?.type === 'star' && (
        <Panel title={t('Star')}>
          <Slider
            label={t('Points')}
            min={3}
            max={40}
            value={single.points}
            onChange={(v) => patch((o) => (o.type === 'star' ? { ...o, points: Math.round(v) } : o), 'Points', true)}
            onCommit={() => core.commit('Points')}
          />
          <Slider
            label={t('Inner radius')}
            min={5}
            max={95}
            value={Math.round(single.inner * 100)}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => patch((o) => (o.type === 'star' ? { ...o, inner: v / 100 } : o), 'Inner radius', true)}
            onCommit={() => core.commit('Inner radius')}
          />
        </Panel>
      )}
      {single?.type === 'path' && (
        <Panel title={t('Path')}>
          <Field label={t('Fill rule')} inline>
            <Select<FillRule>
              small
              value={single.geom.fillRule ?? 'nonzero'}
              options={[
                { value: 'nonzero', label: t('Non-zero') },
                { value: 'evenodd', label: t('Even-odd') },
              ]}
              onChange={(v) => patch((o) => (o.type === 'path' ? { ...o, geom: { ...o.geom, fillRule: v } } : o), 'Fill rule')}
            />
          </Field>
          <Toggle
            label={t('Closed')}
            checked={single.geom.subpaths.every((s) => s.closed)}
            onChange={(v) =>
              patch((o) => (o.type === 'path' ? { ...o, geom: { ...o.geom, subpaths: o.geom.subpaths.map((s) => ({ ...s, closed: v })) } } : o), v ? 'Close path' : 'Open path')
            }
          />
        </Panel>
      )}
      {text && (
        <Panel title={t('Text')}>
          <TextArea
            key={text.id}
            rows={3}
            defaultValue={text.text}
            onChange={(e) => {
              const value = e.target.value;
              patch((o) => (o.type === 'text' ? { ...o, text: value } : o), 'Edit text', true);
            }}
            onBlur={() => core.commit('Edit text')}
          />
          <Field label={t('Font')}>
            <Select
              small
              value={text.fontFamily}
              onFocus={() => core.loadFonts()}
              onPointerDown={() => core.loadFonts()}
              options={fonts.map((f) => ({ value: f, label: f }))}
              onChange={(v) => patch((o) => (o.type === 'text' ? { ...o, fontFamily: v } : o), 'Font')}
            />
          </Field>
          <div className="vc-grid2">
            <Field label={t('Size')}>
              <NumberField small value={round2(text.fontSize)} min={1} max={2000} suffix="px" onChange={(v) => patch((o) => (o.type === 'text' ? { ...o, fontSize: v } : o), 'Font size')} />
            </Field>
            <Field label={t('Weight')}>
              <Select<number>
                small
                value={text.fontWeight}
                options={WEIGHTS.map(([w, n]) => ({ value: w, label: `${w} ${t(n)}` }))}
                onChange={(v) => patch((o) => (o.type === 'text' ? { ...o, fontWeight: v } : o), 'Font weight')}
              />
            </Field>
            <Field label={t('Letter spacing')}>
              <NumberField small value={round2(text.letterSpacing)} step={0.5} suffix="px" onChange={(v) => patch((o) => (o.type === 'text' ? { ...o, letterSpacing: v } : o), 'Letter spacing')} />
            </Field>
            <Field label={t('Line height')}>
              <NumberField small value={round2(text.lineHeight)} min={0.3} max={10} step={0.05} onChange={(v) => patch((o) => (o.type === 'text' ? { ...o, lineHeight: v } : o), 'Line height')} />
            </Field>
          </div>
          <div className="row">
            <Segmented<TextAlign>
              value={text.align}
              options={[
                { value: 'left', icon: TextAlignStart, title: t('Align left') },
                { value: 'center', icon: TextAlignCenter, title: t('Align center') },
                { value: 'right', icon: TextAlignEnd, title: t('Align right') },
              ]}
              onChange={(v) => patch((o) => (o.type === 'text' ? { ...o, align: v } : o), 'Text align')}
            />
            <Toggle label={t('Italic')} checked={text.italic} onChange={(v) => patch((o) => (o.type === 'text' ? { ...o, italic: v } : o), 'Italic')} />
          </div>
          {text.onPath && (
            <Slider
              label={t('Start offset')}
              min={0}
              max={100}
              value={text.onPath.offset}
              format={(v) => `${Math.round(v)}%`}
              onChange={(v) => patch((o) => (o.type === 'text' && o.onPath ? { ...o, onPath: { ...o.onPath, offset: v } } : o), 'Text offset', true)}
              onCommit={() => core.commit('Text offset')}
            />
          )}
        </Panel>
      )}
      {single?.type === 'image' && (
        <Panel title={t('Image')}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                const [file] = await pickFiles({ accept: 'image/*' });
                if (!file) return;
                try {
                  const href = await new Promise<string>((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(String(r.result));
                    r.onerror = () => reject(r.error);
                    r.readAsDataURL(file);
                  });
                  patch((o) => (o.type === 'image' ? { ...o, href } : o), 'Replace image');
                } catch (error) {
                  toast.error(t('Could not place the image'), error instanceof Error ? error.message : String(error));
                }
              }}
            >
              <ImagePlus size={13} /> {t('Replace image…')}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                try {
                  const img = await loadImage(single.href);
                  const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
                  setBox({ w: W, h: W / ratio });
                } catch {
                  // ignore
                }
              }}
            >
              {t('Original proportions')}
            </button>
          </div>
        </Panel>
      )}
      <AppearanceSection ids={ids} objs={objs} />
    </>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

