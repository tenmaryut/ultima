import { useRef, useState } from 'react';
import { ArrowLeftRight, Download, FileCode, Palette, Trash2 } from 'lucide-react';
import { Button, ColorPicker, Field, NumberField, Panel, Segmented, Select, Slider, toast } from '../../components/ui';
import { saveFile } from '../../core/platform';
import { useT } from '../../core/i18n';
import { slugify } from './io';
import { colorAt, evenStops, gradientCss, gradientCssSnippet, gradientSvg, makeStop, sortedStops, clampPos, type GradientDoc, type GradientType } from './gradient';
import { renderGradientPng } from './render';
import type { ColorDoc } from './state';
import { ChipRow, copyText } from './widgets';

interface Props {
  doc: ColorDoc;
  onChange: (doc: ColorDoc, label: string) => void;
  onPreview: (doc: ColorDoc) => void;
  onCommit: (label: string) => void;
}

const SIZES = [
  { value: '1920x1080', label: '1920 × 1080' },
  { value: '1080x1080', label: '1080 × 1080' },
  { value: '1080x1920', label: '1080 × 1920' },
  { value: '3840x2160', label: '3840 × 2160' },
  { value: '1200x630', label: '1200 × 630' },
];

/** Gradient maker: linear / radial / conic, editable stops, live preview and CSS/SVG/PNG export. */
export function GradientView({ doc, onChange, onPreview, onCommit }: Props) {
  const t = useT();
  const g = doc.gradient;
  const [selectedId, setSelectedId] = useState<string | null>(g.stops[0]?.id ?? null);
  const [size, setSize] = useState('1920x1080');
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointerId: number; moved: boolean } | null>(null);
  const selected = g.stops.find((s) => s.id === selectedId) ?? sortedStops(g)[0];

  const withGradient = (patch: Partial<GradientDoc>): ColorDoc => ({ ...doc, gradient: { ...g, ...patch } });
  const update = (patch: Partial<GradientDoc>, label: string) => onChange(withGradient(patch), label);
  const preview = (patch: Partial<GradientDoc>) => onPreview(withGradient(patch));

  const posFromEvent = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clampPos(((clientX - rect.left) / rect.width) * 100);
  };

  const onBarPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const handle = (e.target as Element).closest('[data-stop]');
    if (handle) {
      const id = handle.getAttribute('data-stop')!;
      setSelectedId(id);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { id, pointerId: e.pointerId, moved: false };
      return;
    }
    if (g.stops.length >= 10) {
      toast.info(t('A gradient can have up to 10 stops'));
      return;
    }
    const position = posFromEvent(e.clientX);
    const stop = makeStop(colorAt(g, position), position);
    update({ stops: [...g.stops, stop] }, 'Add gradient stop');
    setSelectedId(stop.id);
  };
  const onBarPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.moved = true;
    const position = posFromEvent(e.clientX);
    preview({ stops: g.stops.map((s) => (s.id === d.id ? { ...s, position } : s)) });
  };
  const onBarPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.moved) onCommit('Move gradient stop');
  };

  const removeStop = () => {
    if (!selected || g.stops.length <= 2) return;
    update({ stops: g.stops.filter((s) => s.id !== selected.id) }, 'Remove gradient stop');
    setSelectedId(null);
  };

  const exportSvg = async () => {
    const [w, h] = size.split('x').map(Number);
    const svg = gradientSvg(g, w, h);
    if (!svg) {
      toast.warning(t('SVG has no conic gradients'), t('Export a PNG instead, or switch to a linear or radial gradient.'));
      return;
    }
    await saveFile(new Blob([svg], { type: 'image/svg+xml' }), { suggestedName: `${slugify(doc.name, 'gradient')}-gradient.svg`, filters: [{ name: 'SVG', extensions: ['svg'] }] });
  };
  const exportPng = async () => {
    try {
      const [w, h] = size.split('x').map(Number);
      const blob = await renderGradientPng(g, w, h);
      await saveFile(blob, { suggestedName: `${slugify(doc.name, 'gradient')}-gradient.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    } catch (error) {
      toast.error(t('Could not export the gradient'), error instanceof Error ? error.message : String(error));
    }
  };

  const css = gradientCss(g);
  const barCss = gradientCss({ ...g, type: 'linear', angle: 90 });

  return (
    <div className="co-gradient">
      <div className="co-gradient-preview checker">
        <div style={{ background: css }} />
      </div>

      <div className="co-gradient-bar-wrap">
        <div
          ref={barRef}
          className="co-gradient-bar checker"
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerCancel={onBarPointerUp}
          title={t('Click to add a stop, drag a handle to move it')}
        >
          <div className="co-gradient-bar-fill" style={{ background: barCss }} />
          {g.stops.map((s) => (
            <span
              key={s.id}
              data-stop={s.id}
              className={`co-stop ${selected?.id === s.id ? 'selected' : ''}`}
              style={{ left: `${s.position}%` }}
              title={`${s.color} · ${s.position}%`}
            >
              <span style={{ background: s.color }} />
            </span>
          ))}
        </div>
      </div>

      <div className="co-gradient-controls">
        <Panel title={t('Gradient')}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Segmented<GradientType>
              value={g.type}
              onChange={(type) => update({ type }, 'Gradient type')}
              options={[
                { value: 'linear', label: t('Linear') },
                { value: 'radial', label: t('Radial') },
                { value: 'conic', label: t('Conic') },
              ]}
            />
            <Segmented<'srgb' | 'oklab'>
              value={g.interpolation}
              onChange={(interpolation) => update({ interpolation }, 'Gradient interpolation')}
              options={[
                { value: 'srgb', label: 'sRGB', title: t('Classic interpolation (works everywhere)') },
                { value: 'oklab', label: 'OKLab', title: t('Perceptually smooth interpolation (modern browsers)') },
              ]}
            />
            {g.type === 'radial' && (
              <Segmented<'circle' | 'ellipse'>
                value={g.shape}
                onChange={(shape) => update({ shape }, 'Gradient shape')}
                options={[
                  { value: 'circle', label: t('Circle') },
                  { value: 'ellipse', label: t('Ellipse') },
                ]}
              />
            )}
          </div>
          {g.type !== 'radial' && (
            <Slider label={g.type === 'conic' ? t('Start angle') : t('Angle')} value={g.angle} min={0} max={360} onChange={(angle) => preview({ angle })} onCommit={() => onCommit('Gradient angle')} format={(v) => `${Math.round(v)}°`} defaultValue={90} />
          )}
          {g.type !== 'linear' && (
            <div className="row">
              <div className="grow">
                <Slider label={t('Center X')} value={g.cx} min={0} max={100} onChange={(cx) => preview({ cx })} onCommit={() => onCommit('Gradient center')} format={(v) => `${Math.round(v)}%`} defaultValue={50} />
              </div>
              <div className="grow">
                <Slider label={t('Center Y')} value={g.cy} min={0} max={100} onChange={(cy) => preview({ cy })} onCommit={() => onCommit('Gradient center')} format={(v) => `${Math.round(v)}%`} defaultValue={50} />
              </div>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Button size="sm" icon={Palette} onClick={() => update({ stops: evenStops(doc.swatches.map((s) => s.hex)) }, 'Gradient from palette')}>
              {t('From palette')}
            </Button>
            <Button size="sm" icon={ArrowLeftRight} onClick={() => update({ stops: g.stops.map((s) => ({ ...s, position: clampPos(100 - s.position) })) }, 'Reverse gradient')}>
              {t('Reverse')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const sorted = sortedStops(g);
                update({ stops: sorted.map((s, i) => ({ ...s, position: clampPos(sorted.length > 1 ? (i / (sorted.length - 1)) * 100 : 0) })) }, 'Distribute stops');
              }}
            >
              {t('Distribute evenly')}
            </Button>
          </div>
        </Panel>

        {selected && (
          <Panel title={t('Selected stop')}>
            <div className="row">
              <ColorPicker
                value={selected.color}
                size={28}
                label={t('Stop color')}
                onChange={(color) => preview({ stops: g.stops.map((s) => (s.id === selected.id ? { ...s, color } : s)) })}
                onCommit={() => onCommit('Stop color')}
              />
              <span className="mono grow">{selected.color}</span>
              <Field label={t('Position')} inline>
                <NumberField
                  value={selected.position}
                  min={0}
                  max={100}
                  suffix="%"
                  small
                  style={{ width: 84 }}
                  onChange={(position) => update({ stops: g.stops.map((s) => (s.id === selected.id ? { ...s, position: clampPos(position) } : s)) }, 'Move gradient stop')}
                />
              </Field>
              <Button size="sm" variant="danger" icon={Trash2} disabled={g.stops.length <= 2} onClick={removeStop} title={t('Remove stop')} />
            </div>
            <div className="row">
              <span className="faint" style={{ fontSize: 11 }}>
                {t('Use a palette color:')}
              </span>
              <ChipRow
                colors={doc.swatches.map((s) => s.hex)}
                onPick={(i) => update({ stops: g.stops.map((s) => (s.id === selected.id ? { ...s, color: doc.swatches[i].hex } : s)) }, 'Stop color')}
              />
            </div>
          </Panel>
        )}

        <Panel title={t('Export')}>
          <pre className="code-block co-code">{gradientCssSnippet(g)}</pre>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Button size="sm" variant="primary" icon={FileCode} onClick={() => void copyText(gradientCssSnippet(g), t('CSS gradient'))}>
              {t('Copy CSS')}
            </Button>
            <Select value={size} small onChange={setSize} options={SIZES} style={{ width: 120 }} aria-label={t('Image size')} />
            <Button size="sm" icon={Download} onClick={() => void exportPng()}>
              PNG
            </Button>
            <Button size="sm" icon={Download} onClick={() => void exportSvg()} disabled={g.type === 'conic'}>
              SVG
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
