import { type ReactNode } from 'react';
import { Check, Combine, Maximize, Minus, Plus, Square, SquareMinus, SquarePlus, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../../../core/i18n';
import type { ViewportApi } from '../../../core/viewport';
import { Button, ColorPicker, IconButton, NumberField, Segmented, Select } from '../../../components/ui';
import { updateLayerProps } from '../actions';
import { findLayer } from '../doc';
import type { PhotoEngine } from '../engine';
import { usePhotoStore } from '../store';
import { applyCrop, applyCropAspect, resetCrop } from '../tools/crop';
import { applyFreeTransform, cancelFreeTransform, startFreeTransform } from '../tools/transform';
import type { PhotoDoc, SelectionMode, TextAlign, ToolOptions as Opts } from '../types';

function Opt({ label, children, title }: { label?: string; children: ReactNode; title?: string }) {
  return (
    <label className="ph-opt" title={title}>
      {label && <span className="ph-opt-label">{label}</span>}
      {children}
    </label>
  );
}

function Num({ label, value, onChange, min, max, step = 1, suffix, width = 58, title }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string; width?: number; title?: string }) {
  return (
    <Opt label={label} title={title}>
      <NumberField small value={value} onChange={onChange} min={min} max={max} step={step} suffix={suffix} style={{ width }} />
    </Opt>
  );
}

/** Percent field for 0..1 values. */
function Pct({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return <Num label={label} value={Math.round(value * 100)} min={min} max={100} suffix="%" onChange={(v) => onChange(v / 100)} />;
}

function Check2({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ph-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SelModes() {
  const t = useT();
  const mode = usePhotoStore((s) => s.opts.selMode);
  const setOpt = usePhotoStore((s) => s.setOpt);
  return (
    <Segmented<SelectionMode>
      value={mode}
      onChange={(v) => setOpt('selMode', v)}
      options={[
        { value: 'new', icon: Square, title: t('New selection') },
        { value: 'add', icon: SquarePlus, title: `${t('Add to selection')} (Shift)` },
        { value: 'subtract', icon: SquareMinus, title: `${t('Subtract from selection')} (Alt)` },
        { value: 'intersect', icon: Combine, title: `${t('Intersect with selection')} (Shift+Alt)` },
      ]}
    />
  );
}

export function ToolOptions({ engine, viewport, doc }: { engine: PhotoEngine; viewport: ViewportApi; doc: PhotoDoc | null }) {
  const t = useT();
  const tool = usePhotoStore((s) => s.tool);
  const opts = usePhotoStore((s) => s.opts);
  const setOpt = usePhotoStore((s) => s.setOpt);
  const fonts = usePhotoStore((s) => s.fonts);
  const maskEdit = usePhotoStore((s) => s.maskEdit);
  const setMaskEdit = usePhotoStore((s) => s.setMaskEdit);
  const transforming = usePhotoStore((s) => s.transforming);
  const active = doc ? findLayer(doc, doc.activeId) : undefined;
  const set = <K extends keyof Opts>(key: K) => (patch: Partial<Opts[K]>) => setOpt(key, patch);

  const maskBadge = maskEdit && active?.mask ? (
    <span className="ph-mask-badge">
      {t('Editing layer mask')}
      <button type="button" aria-label={t('Stop editing the mask')} onClick={() => setMaskEdit(false)}>
        <X size={11} />
      </button>
    </span>
  ) : null;

  const brushCommon = (key: 'brush' | 'eraser' | 'clone' | 'heal' | 'dodge' | 'blur') => {
    const o = opts[key] as { size: number; hardness: number };
    return (
      <>
        <Num label={t('Size')} value={o.size} min={1} max={2500} suffix="px" onChange={(v) => setOpt(key, { size: v } as never)} />
        <Pct label={t('Hardness')} value={o.hardness} onChange={(v) => setOpt(key, { hardness: v } as never)} />
      </>
    );
  };

  let body: ReactNode = null;
  switch (tool) {
    case 'move':
      body = transforming ? (
        <>
          <span className="muted">{t('Drag the handles to scale, outside to rotate. Shift: free aspect / 15° steps. Alt: from center.')}</span>
          <Button size="sm" variant="primary" icon={Check} onClick={() => applyFreeTransform(engine)}>
            {t('Apply')}
          </Button>
          <Button size="sm" icon={X} onClick={() => cancelFreeTransform(engine)}>
            {t('Cancel')}
          </Button>
        </>
      ) : (
        <>
          <Check2 label={t('Auto-select layer')} checked={opts.move.autoSelect} onChange={(v) => set('move')({ autoSelect: v })} />
          <Button size="sm" onClick={() => startFreeTransform(engine)} disabled={!active}>
            {t('Free Transform')} <span className="faint">Ctrl+T</span>
          </Button>
        </>
      );
      break;
    case 'marquee':
      body = (
        <>
          <Segmented
            value={opts.marquee.shape}
            onChange={(v) => set('marquee')({ shape: v })}
            options={[
              { value: 'rect', label: t('Rectangle') },
              { value: 'ellipse', label: t('Ellipse') },
            ]}
          />
          <SelModes />
          <Num label={t('Feather')} value={opts.marquee.feather} min={0} max={250} suffix="px" onChange={(v) => set('marquee')({ feather: v })} />
          <Opt label={t('Style')}>
            <Select
              small
              value={opts.marquee.style}
              onChange={(v) => set('marquee')({ style: v })}
              options={[
                { value: 'normal', label: t('Normal') },
                { value: 'ratio', label: t('Fixed ratio') },
                { value: 'size', label: t('Fixed size') },
              ]}
            />
          </Opt>
          {opts.marquee.style === 'ratio' && (
            <>
              <Num label="W" value={opts.marquee.ratioW} min={0.01} max={1000} step={0.1} width={52} onChange={(v) => set('marquee')({ ratioW: v })} />
              <Num label="H" value={opts.marquee.ratioH} min={0.01} max={1000} step={0.1} width={52} onChange={(v) => set('marquee')({ ratioH: v })} />
            </>
          )}
          {opts.marquee.style === 'size' && (
            <>
              <Num label="W" value={opts.marquee.fixedW} min={1} max={16000} suffix="px" onChange={(v) => set('marquee')({ fixedW: v })} />
              <Num label="H" value={opts.marquee.fixedH} min={1} max={16000} suffix="px" onChange={(v) => set('marquee')({ fixedH: v })} />
            </>
          )}
        </>
      );
      break;
    case 'lasso':
      body = (
        <>
          <Segmented
            value={opts.lasso.kind}
            onChange={(v) => set('lasso')({ kind: v })}
            options={[
              { value: 'free', label: t('Freehand') },
              { value: 'polygon', label: t('Polygonal') },
            ]}
          />
          <SelModes />
          <Num label={t('Feather')} value={opts.lasso.feather} min={0} max={250} suffix="px" onChange={(v) => set('lasso')({ feather: v })} />
          {opts.lasso.kind === 'polygon' && <span className="faint">{t('Click to add points · double-click or Enter to close · Backspace removes a point')}</span>}
        </>
      );
      break;
    case 'wand':
      body = (
        <>
          <SelModes />
          <Num label={t('Tolerance')} value={opts.wand.tolerance} min={0} max={255} onChange={(v) => set('wand')({ tolerance: v })} />
          <Check2 label={t('Anti-alias')} checked={opts.wand.antiAlias} onChange={(v) => set('wand')({ antiAlias: v })} />
          <Check2 label={t('Contiguous')} checked={opts.wand.contiguous} onChange={(v) => set('wand')({ contiguous: v })} />
          <Check2 label={t('Sample all layers')} checked={opts.wand.sampleAll} onChange={(v) => set('wand')({ sampleAll: v })} />
        </>
      );
      break;
    case 'crop':
      body = (
        <>
          <Opt label={t('Ratio')}>
            <Select
              small
              value={opts.crop.aspect}
              onChange={(v) => {
                set('crop')({ aspect: v });
                setTimeout(() => applyCropAspect(engine), 0);
              }}
              options={[
                { value: 'free', label: t('Free') },
                { value: 'original', label: t('Original ratio') },
                { value: '1:1', label: '1:1' },
                { value: '4:5', label: '4:5' },
                { value: '5:4', label: '5:4' },
                { value: '3:2', label: '3:2' },
                { value: '2:3', label: '2:3' },
                { value: '4:3', label: '4:3' },
                { value: '3:4', label: '3:4' },
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
              ]}
            />
          </Opt>
          <Opt label={t('Straighten')}>
            <input
              className="ph-range"
              type="range"
              min={-45}
              max={45}
              step={0.1}
              value={opts.crop.angle}
              onChange={(e) => {
                set('crop')({ angle: parseFloat(e.target.value) });
                engine.requestOverlay();
              }}
              onDoubleClick={() => {
                set('crop')({ angle: 0 });
                engine.requestOverlay();
              }}
            />
            <span className="ph-opt-value">{opts.crop.angle.toFixed(1)}°</span>
          </Opt>
          <Button size="sm" variant="primary" icon={Check} onClick={() => applyCrop(engine)}>
            {t('Crop')}
          </Button>
          <Button size="sm" icon={X} onClick={() => resetCrop(engine)}>
            {t('Reset')}
          </Button>
        </>
      );
      break;
    case 'brush':
      body = (
        <>
          {brushCommon('brush')}
          <Pct label={t('Opacity')} value={opts.brush.opacity} min={1} onChange={(v) => set('brush')({ opacity: v })} />
          <Pct label={t('Flow')} value={opts.brush.flow} min={1} onChange={(v) => set('brush')({ flow: v })} />
          <Pct label={t('Smoothing')} value={opts.brush.smoothing} onChange={(v) => set('brush')({ smoothing: v })} />
          <Check2 label={t('Pressure → size')} checked={opts.brush.pressureSize} onChange={(v) => set('brush')({ pressureSize: v })} />
          <Check2 label={t('Pressure → opacity')} checked={opts.brush.pressureOpacity} onChange={(v) => set('brush')({ pressureOpacity: v })} />
        </>
      );
      break;
    case 'pencil':
      body = (
        <>
          <Num label={t('Size')} value={opts.pencil.size} min={1} max={1000} suffix="px" onChange={(v) => set('pencil')({ size: v })} />
          <Pct label={t('Opacity')} value={opts.pencil.opacity} min={1} onChange={(v) => set('pencil')({ opacity: v })} />
        </>
      );
      break;
    case 'eraser':
      body = (
        <>
          {brushCommon('eraser')}
          <Pct label={t('Opacity')} value={opts.eraser.opacity} min={1} onChange={(v) => set('eraser')({ opacity: v })} />
          <Pct label={t('Flow')} value={opts.eraser.flow} min={1} onChange={(v) => set('eraser')({ flow: v })} />
        </>
      );
      break;
    case 'clone':
      body = (
        <>
          {brushCommon('clone')}
          <Pct label={t('Opacity')} value={opts.clone.opacity} min={1} onChange={(v) => set('clone')({ opacity: v })} />
          <Pct label={t('Flow')} value={opts.clone.flow} min={1} onChange={(v) => set('clone')({ flow: v })} />
          <Check2 label={t('Aligned')} checked={opts.clone.aligned} onChange={(v) => set('clone')({ aligned: v })} />
          <Check2 label={t('Sample all layers')} checked={opts.clone.sampleAll} onChange={(v) => set('clone')({ sampleAll: v })} />
          <span className="faint">{t('Alt-click to set the source')}</span>
        </>
      );
      break;
    case 'heal':
      body = (
        <>
          {brushCommon('heal')}
          <span className="faint">{t('Paint over spots and blemishes to remove them')}</span>
        </>
      );
      break;
    case 'dodge':
      body = (
        <>
          <Segmented
            value={opts.dodge.mode}
            onChange={(v) => set('dodge')({ mode: v })}
            options={[
              { value: 'dodge', label: t('Dodge') },
              { value: 'burn', label: t('Burn') },
              { value: 'sponge', label: t('Sponge') },
            ]}
          />
          {opts.dodge.mode !== 'sponge' ? (
            <Opt label={t('Range')}>
              <Select
                small
                value={opts.dodge.range}
                onChange={(v) => set('dodge')({ range: v })}
                options={[
                  { value: 'shadows', label: t('Shadows') },
                  { value: 'midtones', label: t('Midtones') },
                  { value: 'highlights', label: t('Highlights') },
                ]}
              />
            </Opt>
          ) : (
            <Opt label={t('Mode')}>
              <Select
                small
                value={opts.dodge.sponge}
                onChange={(v) => set('dodge')({ sponge: v })}
                options={[
                  { value: 'desaturate', label: t('Desaturate') },
                  { value: 'saturate', label: t('Saturate') },
                ]}
              />
            </Opt>
          )}
          <Pct label={opts.dodge.mode === 'sponge' ? t('Flow') : t('Exposure')} value={opts.dodge.exposure} min={1} onChange={(v) => set('dodge')({ exposure: v })} />
          {brushCommon('dodge')}
        </>
      );
      break;
    case 'blur':
      body = (
        <>
          <Segmented
            value={opts.blur.mode}
            onChange={(v) => set('blur')({ mode: v })}
            options={[
              { value: 'blur', label: t('Blur') },
              { value: 'sharpen', label: t('Sharpen') },
            ]}
          />
          <Pct label={t('Strength')} value={opts.blur.strength} min={1} onChange={(v) => set('blur')({ strength: v })} />
          {brushCommon('blur')}
        </>
      );
      break;
    case 'bucket':
      body = (
        <>
          <Num label={t('Tolerance')} value={opts.bucket.tolerance} min={0} max={255} onChange={(v) => set('bucket')({ tolerance: v })} />
          <Pct label={t('Opacity')} value={opts.bucket.opacity} min={1} onChange={(v) => set('bucket')({ opacity: v })} />
          <Check2 label={t('Anti-alias')} checked={opts.bucket.antiAlias} onChange={(v) => set('bucket')({ antiAlias: v })} />
          <Check2 label={t('Contiguous')} checked={opts.bucket.contiguous} onChange={(v) => set('bucket')({ contiguous: v })} />
          <Check2 label={t('Sample all layers')} checked={opts.bucket.sampleAll} onChange={(v) => set('bucket')({ sampleAll: v })} />
        </>
      );
      break;
    case 'gradient':
      body = (
        <>
          <Segmented
            value={opts.gradient.type}
            onChange={(v) => set('gradient')({ type: v })}
            options={[
              { value: 'linear', label: t('Linear') },
              { value: 'radial', label: t('Radial') },
            ]}
          />
          <Opt label={t('Colors')}>
            <Select
              small
              value={opts.gradient.colors}
              onChange={(v) => set('gradient')({ colors: v })}
              options={[
                { value: 'fg-bg', label: t('Foreground to background') },
                { value: 'fg-transparent', label: t('Foreground to transparent') },
              ]}
            />
          </Opt>
          <Check2 label={t('Reverse')} checked={opts.gradient.reverse} onChange={(v) => set('gradient')({ reverse: v })} />
          <Pct label={t('Opacity')} value={opts.gradient.opacity} min={1} onChange={(v) => set('gradient')({ opacity: v })} />
        </>
      );
      break;
    case 'eyedropper':
      body = (
        <>
          <Opt label={t('Sample size')}>
            <Select
              small
              value={opts.eyedropper.sampleSize}
              onChange={(v) => set('eyedropper')({ sampleSize: v })}
              options={[
                { value: 1, label: t('Point sample') },
                { value: 3, label: t('3 by 3 average') },
                { value: 5, label: t('5 by 5 average') },
                { value: 11, label: t('11 by 11 average') },
              ]}
            />
          </Opt>
          <Opt label={t('Sample')}>
            <Select
              small
              value={opts.eyedropper.sampleAll ? 'all' : 'layer'}
              onChange={(v) => set('eyedropper')({ sampleAll: v === 'all' })}
              options={[
                { value: 'all', label: t('All layers') },
                { value: 'layer', label: t('Current layer') },
              ]}
            />
          </Opt>
          <span className="faint">{t('Alt-click picks the background color')}</span>
        </>
      );
      break;
    case 'text': {
      const textLayer = active?.type === 'text' ? active : null;
      const apply = (patch: Partial<Opts['text']>) => {
        set('text')(patch);
        if (textLayer) updateLayerProps(engine, textLayer.id, patch, 'Text Style');
      };
      const o = textLayer ? { font: textLayer.font, size: textLayer.size, weight: textLayer.weight, italic: textLayer.italic, align: textLayer.align } : opts.text;
      const fontList = fonts.includes(o.font) ? fonts : [o.font, ...fonts];
      body = (
        <>
          <Opt label={t('Font')}>
            <Select small value={o.font} onChange={(v) => apply({ font: v })} options={fontList.map((f) => ({ value: f, label: f }))} style={{ maxWidth: 170 }} />
          </Opt>
          <Num label={t('Size')} value={Math.round(o.size * 10) / 10} min={1} max={4000} suffix="px" onChange={(v) => apply({ size: v })} />
          <Opt label={t('Weight')}>
            <Select
              small
              value={o.weight}
              onChange={(v) => apply({ weight: v })}
              options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))}
            />
          </Opt>
          <Check2 label={t('Italic')} checked={o.italic} onChange={(v) => apply({ italic: v })} />
          <Segmented<TextAlign>
            value={o.align}
            onChange={(v) => apply({ align: v })}
            options={[
              { value: 'left', label: t('Left') },
              { value: 'center', label: t('Center') },
              { value: 'right', label: t('Right') },
            ]}
          />
          {textLayer && (
            <Opt label={t('Color')}>
              <ColorPicker value={textLayer.color} alpha={false} size={20} onChange={(c) => updateLayerProps(engine, textLayer.id, { color: c }, null)} onCommit={() => engine.commitLive('Text Color')} />
            </Opt>
          )}
        </>
      );
      break;
    }
    case 'shape':
      body = (
        <>
          <Segmented
            value={opts.shape.kind}
            onChange={(v) => set('shape')({ kind: v })}
            options={[
              { value: 'rect', label: t('Rectangle') },
              { value: 'roundrect', label: t('Rounded') },
              { value: 'ellipse', label: t('Ellipse') },
              { value: 'line', label: t('Line') },
            ]}
          />
          {opts.shape.kind !== 'line' && <Check2 label={t('Fill (foreground color)')} checked={opts.shape.fill} onChange={(v) => set('shape')({ fill: v })} />}
          {opts.shape.kind !== 'line' && <Check2 label={t('Stroke')} checked={opts.shape.stroke} onChange={(v) => set('shape')({ stroke: v })} />}
          {opts.shape.kind !== 'line' && opts.shape.stroke && <ColorPicker value={opts.shape.strokeColor} alpha size={20} label={t('Stroke color')} onChange={(c) => set('shape')({ strokeColor: c })} />}
          <Num label={opts.shape.kind === 'line' ? t('Weight') : t('Stroke width')} value={opts.shape.strokeWidth} min={1} max={500} suffix="px" onChange={(v) => set('shape')({ strokeWidth: v })} />
          {opts.shape.kind === 'roundrect' && <Num label={t('Radius')} value={opts.shape.radius} min={0} max={2000} suffix="px" onChange={(v) => set('shape')({ radius: v })} />}
        </>
      );
      break;
    case 'hand':
    case 'zoom':
      body = (
        <>
          <IconButton icon={ZoomOut} size="sm" label={t('Zoom out')} onClick={viewport.zoomOut} />
          <IconButton icon={ZoomIn} size="sm" label={t('Zoom in')} onClick={viewport.zoomIn} />
          <Button size="sm" icon={Maximize} onClick={viewport.fit}>
            {t('Fit on screen')}
          </Button>
          <Button size="sm" onClick={viewport.actualSize}>
            100%
          </Button>
          {tool === 'zoom' && <span className="faint">{t('Click to zoom in, Alt-click to zoom out')}</span>}
        </>
      );
      break;
  }

  return (
    <div className="ph-options">
      {maskBadge}
      {body}
      {(tool === 'brush' || tool === 'eraser' || tool === 'pencil') && (
        <span className="ph-opt-buttons">
          <IconButton icon={Minus} size="sm" label={`${t('Smaller brush')} ([)`} onClick={() => engine.store.setOpt(tool, { size: Math.max(1, Math.round(opts[tool].size / 1.25)) })} />
          <IconButton icon={Plus} size="sm" label={`${t('Larger brush')} (])`} onClick={() => engine.store.setOpt(tool, { size: Math.min(2500, Math.round(opts[tool].size * 1.25) + 1) })} />
        </span>
      )}
    </div>
  );
}
