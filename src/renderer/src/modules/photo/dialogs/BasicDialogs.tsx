import { useState } from 'react';
import { Link, Unlink } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, ColorPicker, Field, IconButton, Modal, NumberField, Segmented, Select, Slider, TextInput, Toggle } from '../../../components/ui';
import { canvasSizeAction, exportDocument, exportPsd, fillAction, newDocument, resizeAction } from '../actions';
import type { PhotoEngine } from '../engine';
import type { ExportFormat } from '../io';
import { usePhotoStore } from '../store';
import { BLEND_MODES, MAX_DOC_SIDE, type BlendMode } from '../types';
import { DOC_PRESETS } from '../ui/CanvasParts';

/* ------------------------------- New document ------------------------------- */

export function NewDocDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [preset, setPreset] = useState('hd');
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [bg, setBg] = useState<'white' | 'transparent' | 'color'>('white');
  const [color, setColor] = useState(usePhotoStore.getState().bg);
  const [name, setName] = useState('');
  const create = () => {
    newDocument(w, h, bg === 'white' ? '#ffffff' : bg === 'color' ? color : null, name);
    onClose();
  };
  return (
    <Modal
      title={t('New Document')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={create}>
            {t('Create')}
          </Button>
        </>
      }
    >
      <Field label={t('Name')}>
        <TextInput value={name} placeholder={t('Untitled')} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('Preset')}>
        <Select
          value={preset}
          onChange={(v) => {
            setPreset(v);
            const p = DOC_PRESETS.find((x) => x.id === v);
            if (p) {
              setW(p.w);
              setH(p.h);
            }
          }}
          options={[...DOC_PRESETS.map((p) => ({ value: p.id, label: t(p.label) })), { value: 'custom', label: t('Custom') }]}
        />
      </Field>
      <div className="row">
        <Field label={t('Width')}>
          <NumberField value={w} min={1} max={MAX_DOC_SIDE} suffix="px" onChange={(v) => { setW(Math.round(v)); setPreset('custom'); }} />
        </Field>
        <Field label={t('Height')}>
          <NumberField value={h} min={1} max={MAX_DOC_SIDE} suffix="px" onChange={(v) => { setH(Math.round(v)); setPreset('custom'); }} />
        </Field>
      </div>
      <Field label={t('Background')}>
        <div className="row">
          <Segmented
            value={bg}
            onChange={setBg}
            options={[
              { value: 'white', label: t('White') },
              { value: 'transparent', label: t('Transparent') },
              { value: 'color', label: t('Color') },
            ]}
          />
          {bg === 'color' && <ColorPicker value={color} alpha={false} onChange={setColor} />}
        </div>
      </Field>
    </Modal>
  );
}

/* -------------------------------- Image size -------------------------------- */

export function ImageSizeDialog({ engine, onClose }: { engine: PhotoEngine; onClose: () => void }) {
  const t = useT();
  const doc = engine.doc!;
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [keep, setKeep] = useState(true);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low' | 'nearest'>('high');
  const ratio = doc.width / doc.height;
  return (
    <Modal
      title={t('Image Size')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              resizeAction(engine, w, h, quality);
              onClose();
            }}
          >
            {t('OK')}
          </Button>
        </>
      }
    >
      <div className="muted">{t('Current size: {w} × {h} px', { w: doc.width, h: doc.height })}</div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label={t('Width')}>
          <NumberField value={w} min={1} max={MAX_DOC_SIDE} suffix="px" onChange={(v) => { setW(Math.round(v)); if (keep) setH(Math.max(1, Math.round(v / ratio))); }} />
        </Field>
        <IconButton icon={keep ? Link : Unlink} label={t('Keep aspect ratio')} active={keep} onClick={() => setKeep((k) => !k)} />
        <Field label={t('Height')}>
          <NumberField value={h} min={1} max={MAX_DOC_SIDE} suffix="px" onChange={(v) => { setH(Math.round(v)); if (keep) setW(Math.max(1, Math.round(v * ratio))); }} />
        </Field>
        <Field label={t('Percent')}>
          <NumberField value={Math.round((w / doc.width) * 1000) / 10} min={1} max={1000} suffix="%" onChange={(v) => { setW(Math.max(1, Math.round((doc.width * v) / 100))); setH(Math.max(1, Math.round((doc.height * v) / 100))); }} />
        </Field>
      </div>
      <Field label={t('Resample')}>
        <Select
          value={quality}
          onChange={setQuality}
          options={[
            { value: 'high', label: t('Bicubic (smooth)') },
            { value: 'medium', label: t('Bilinear') },
            { value: 'low', label: t('Fast') },
            { value: 'nearest', label: t('Nearest neighbor (hard edges)') },
          ]}
        />
      </Field>
    </Modal>
  );
}

/* -------------------------------- Canvas size -------------------------------- */

export function CanvasSizeDialog({ engine, onClose }: { engine: PhotoEngine; onClose: () => void }) {
  const t = useT();
  const doc = engine.doc!;
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [relative, setRelative] = useState(false);
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const [fill, setFill] = useState<'transparent' | 'white' | 'bg'>('transparent');
  const bg = usePhotoStore.getState().bg;
  const finalW = relative ? doc.width + w : w;
  const finalH = relative ? doc.height + h : h;
  return (
    <Modal
      title={t('Canvas Size')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              canvasSizeAction(engine, Math.round(finalW), Math.round(finalH), anchor[0], anchor[1], fill === 'white' ? '#ffffff' : fill === 'bg' ? bg : undefined);
              onClose();
            }}
          >
            {t('OK')}
          </Button>
        </>
      }
    >
      <div className="muted">{t('Current size: {w} × {h} px', { w: doc.width, h: doc.height })}</div>
      <Toggle
        checked={relative}
        onChange={(v) => {
          setRelative(v);
          setW(v ? 0 : doc.width);
          setH(v ? 0 : doc.height);
        }}
        label={t('Relative')}
      />
      <div className="row">
        <Field label={t('Width')}>
          <NumberField value={w} min={relative ? -doc.width + 1 : 1} max={MAX_DOC_SIDE} suffix="px" onChange={(v) => setW(Math.round(v))} />
        </Field>
        <Field label={t('Height')}>
          <NumberField value={h} min={relative ? -doc.height + 1 : 1} max={MAX_DOC_SIDE} suffix="px" onChange={(v) => setH(Math.round(v))} />
        </Field>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <Field label={t('Anchor')}>
          <div className="ph-anchor" role="radiogroup" aria-label={t('Anchor')}>
            {[0, 0.5, 1].map((ay) =>
              [0, 0.5, 1].map((ax) => (
                <button
                  key={`${ax}-${ay}`}
                  type="button"
                  role="radio"
                  aria-checked={anchor[0] === ax && anchor[1] === ay}
                  className={anchor[0] === ax && anchor[1] === ay ? 'active' : ''}
                  onClick={() => setAnchor([ax, ay])}
                />
              )),
            )}
          </div>
        </Field>
        <Field label={t('Canvas extension color')}>
          <Select
            value={fill}
            onChange={setFill}
            options={[
              { value: 'transparent', label: t('Transparent') },
              { value: 'white', label: t('White') },
              { value: 'bg', label: t('Background color') },
            ]}
          />
        </Field>
      </div>
      <div className="faint">{t('New size: {w} × {h} px', { w: Math.round(finalW), h: Math.round(finalH) })}</div>
    </Modal>
  );
}

/* ---------------------------------- Export ---------------------------------- */

export function ExportDialog({ engine, onClose }: { engine: PhotoEngine; onClose: () => void }) {
  const t = useT();
  const doc = engine.doc!;
  const [format, setFormat] = useState<ExportFormat | 'psd'>('png');
  const [quality, setQuality] = useState(0.9);
  const [scale, setScale] = useState(100);
  const [matte, setMatte] = useState('#ffffff');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      if (format === 'psd') await exportPsd(engine);
      else await exportDocument(engine, { format, quality, scale: scale / 100, background: format === 'jpeg' ? matte : undefined });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Export')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void go()} disabled={busy}>
            {busy ? t('Exporting…') : t('Export')}
          </Button>
        </>
      }
    >
      <Field label={t('Format')}>
        <Segmented
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPG' },
            { value: 'webp', label: 'WebP' },
            { value: 'psd', label: 'PSD' },
          ]}
        />
      </Field>
      {format === 'psd' ? (
        <div className="muted">{t('Layers, names, opacity, blend modes, visibility and masks are kept. Text and shapes are rasterized; effects are baked into the pixels.')}</div>
      ) : (
        <>
          {format !== 'png' && <Slider label={t('Quality')} value={Math.round(quality * 100)} min={5} max={100} onChange={(v) => setQuality(v / 100)} format={(v) => `${v}%`} />}
          <Slider label={t('Scale')} value={scale} min={5} max={400} step={5} onChange={setScale} format={(v) => `${v}%`} />
          <div className="faint">{t('Output: {w} × {h} px', { w: Math.max(1, Math.round((doc.width * scale) / 100)), h: Math.max(1, Math.round((doc.height * scale) / 100)) })}</div>
          {format === 'jpeg' && (
            <Field label={t('Background for transparent areas')} inline>
              <ColorPicker value={matte} alpha={false} onChange={setMatte} />
            </Field>
          )}
        </>
      )}
    </Modal>
  );
}

/* ----------------------------------- Fill ----------------------------------- */

export function FillDialog({ engine, onClose }: { engine: PhotoEngine; onClose: () => void }) {
  const t = useT();
  const store = usePhotoStore.getState();
  const [contents, setContents] = useState<'fg' | 'bg' | 'color' | 'gray' | 'white' | 'black'>('fg');
  const [color, setColor] = useState(store.fg);
  const [opacity, setOpacity] = useState(100);
  const [blend, setBlend] = useState<BlendMode>('source-over');
  const resolve = () => ({ fg: store.fg, bg: store.bg, color, gray: '#808080', white: '#ffffff', black: '#000000' })[contents];
  return (
    <Modal
      title={t('Fill')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              void fillAction(engine, resolve(), opacity / 100, blend);
              onClose();
            }}
          >
            {t('OK')}
          </Button>
        </>
      }
    >
      <Field label={t('Contents')}>
        <div className="row">
          <Select
            value={contents}
            onChange={setContents}
            options={[
              { value: 'fg', label: t('Foreground color') },
              { value: 'bg', label: t('Background color') },
              { value: 'color', label: t('Color…') },
              { value: 'gray', label: t('50% gray') },
              { value: 'white', label: t('White') },
              { value: 'black', label: t('Black') },
            ]}
          />
          {contents === 'color' && <ColorPicker value={color} alpha={false} onChange={setColor} />}
        </div>
      </Field>
      <Field label={t('Mode')}>
        <Select value={blend} onChange={setBlend} options={BLEND_MODES.map((b) => ({ value: b.value, label: t(b.label) }))} />
      </Field>
      <Slider label={t('Opacity')} value={opacity} min={1} max={100} onChange={setOpacity} format={(v) => `${v}%`} />
      <div className="faint">{engine.doc?.selection ? t('Fills the selection on the active layer.') : t('No selection: fills the whole layer.')}</div>
    </Modal>
  );
}
