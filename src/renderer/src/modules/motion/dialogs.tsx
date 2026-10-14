import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Download } from 'lucide-react';
import { useT } from '../../core/i18n';
import { formatTime } from '../../core/utils/format';
import { Button, Field, Modal, NumberField, ProgressBar, Segmented, Select, TextInput, Toggle, toast } from '../../components/ui';
import { detectVideoSupport, ExportCancelled, exportComposition, outputSize, type ExportFormat, type ExportQuality, type ExportSettings } from './export';
import { GraphEditor } from './GraphEditor';
import type { ImageCache } from './media';
import { findKey, setKeysEasing } from './ops';
import { CompositionFields } from './panels';
import { buildKeyIndex, useEditor } from './state';
import { frameCount } from './timeline-math';
import type { Composition, MotionDoc } from './types';

/* --------------------------- Composition settings --------------------------- */

export function CompositionDialog({ title, initial, confirmLabel, onCancel, onConfirm }: { title: string; initial: Composition; confirmLabel: string; onCancel: () => void; onConfirm: (comp: Composition) => void }) {
  const t = useT();
  const [comp, setComp] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => onConfirm(comp)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <CompositionFields comp={comp} onChange={(patch) => setComp((c) => ({ ...c, ...patch }))} />
    </Modal>
  );
}

/* ---------------------------------- Export ---------------------------------- */

const FORMAT_LABELS: Record<ExportFormat, string> = {
  mp4: 'MP4 video',
  webm: 'WebM video',
  gif: 'Animated GIF',
  'png-seq': 'PNG sequence (ZIP)',
  'png-frame': 'Current frame (PNG)',
};

export function ExportDialog({ doc, time, images, initialFormat, onClose }: { doc: MotionDoc; time: number; images: ImageCache; initialFormat?: ExportFormat; onClose: () => void }) {
  const t = useT();
  const comp = doc.comp;
  const [format, setFormat] = useState<ExportFormat>(initialFormat ?? 'mp4');
  const [range, setRange] = useState<'all' | 'work'>(comp.workStart > 0 || comp.workEnd < comp.duration ? 'work' : 'all');
  const [widthMode, setWidthMode] = useState<'1' | '0.5' | '0.25' | 'custom'>('1');
  const [customWidth, setCustomWidth] = useState(Math.min(comp.width, 480));
  const [fps, setFps] = useState(comp.fps);
  const [gifFps, setGifFps] = useState(Math.min(15, comp.fps));
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [dither, setDither] = useState(true);
  const [loop, setLoop] = useState(true);
  const [keepAlpha, setKeepAlpha] = useState(comp.transparent);
  const [fileName, setFileName] = useState(comp.name.replace(/[\\/:*?"<>|]+/g, '_') || 'animation');
  const [support, setSupport] = useState<{ mp4: boolean; webm: boolean; webmAlpha: boolean } | null>(null);
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void detectVideoSupport(comp.width, comp.height).then((s) => {
      if (!alive) return;
      setSupport(s);
      if (!initialFormat && !s.mp4) setFormat(s.webm ? 'webm' : 'gif');
    });
    return () => {
      alive = false;
    };
  }, [comp.width, comp.height, initialFormat]);

  useEffect(() => {
    if (format === 'gif' && widthMode === '1' && comp.width > 800) {
      setWidthMode('custom');
      setCustomWidth(480);
    }
  }, [format, widthMode, comp.width]);

  const width = widthMode === 'custom' ? customWidth : Math.round(comp.width * parseFloat(widthMode));
  const isVideo = format === 'mp4' || format === 'webm';
  const size = outputSize(doc, width, isVideo);
  const outFps = format === 'gif' ? gifFps : fps;
  const start = range === 'work' ? comp.workStart : 0;
  const end = range === 'work' ? comp.workEnd : comp.duration;
  const frames = format === 'png-frame' ? 1 : frameCount(start, end, outFps);
  const unsupported = support && ((format === 'mp4' && !support.mp4) || (format === 'webm' && !support.webm));
  const running = progress !== null;

  const run = async () => {
    const settings: ExportSettings = {
      format,
      range,
      width,
      fps: outFps,
      quality,
      gifDither: dither,
      gifLoop: loop,
      keepAlpha: comp.transparent && keepAlpha,
      frameTime: time,
      fileName: fileName.trim() || 'animation',
    };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ value: 0, label: t('Preparing…') });
    const started = performance.now();
    try {
      const res = await exportComposition(doc, settings, {
        signal: ctrl.signal,
        images,
        onProgress: (value, label) => setProgress({ value, label: t(label) }),
      });
      for (const w of res.warnings) toast.warning(t(w));
      if (res.saved) {
        toast.success(t('Export finished'), t('{n} frame(s) in {s}s', { n: frames, s: Math.round((performance.now() - started) / 100) / 10 }));
        onClose();
      }
    } catch (error) {
      if (error instanceof ExportCancelled || ctrl.signal.aborted) toast.info(t('Export cancelled'));
      else toast.error(t('Export failed'), t(error instanceof Error ? error.message : String(error)));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const formats: ExportFormat[] = ['mp4', 'webm', 'gif', 'png-seq', 'png-frame'];
  return (
    <Modal
      title={t('Export animation')}
      onClose={() => (running ? abortRef.current?.abort() : onClose())}
      footer={
        running ? (
          <Button variant="danger" onClick={() => abortRef.current?.abort()}>
            {t('Cancel export')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Close')}</Button>
            <Button variant="primary" icon={Download} disabled={Boolean(unsupported)} onClick={() => void run()}>
              {t('Export')}
            </Button>
          </>
        )
      }
    >
      <Field label={t('Format')}>
        <Select
          value={format}
          disabled={running}
          options={formats.map((f) => ({
            value: f,
            label: t(FORMAT_LABELS[f]) + ((f === 'mp4' && support && !support.mp4) || (f === 'webm' && support && !support.webm) ? ` — ${t('not supported here')}` : ''),
          }))}
          onChange={setFormat}
        />
      </Field>
      {unsupported && (
        <div className="mo-warn">
          {format === 'mp4'
            ? t('This computer cannot encode MP4 video. Choose WebM, GIF or a PNG sequence instead.')
            : t('This computer cannot encode WebM video. Choose MP4, GIF or a PNG sequence instead.')}
        </div>
      )}
      <Field label={t('File name')}>
        <TextInput small value={fileName} disabled={running} onChange={(e) => setFileName(e.target.value)} />
      </Field>
      {format !== 'png-frame' ? (
        <Field label={t('Range')}>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: 'all', label: t('Whole composition') },
              { value: 'work', label: t('Work area') },
            ]}
          />
        </Field>
      ) : (
        <div className="faint">{t('Frame at {time}', { time: formatTime(time) })}</div>
      )}
      <div className="mo-grid2">
        <Field label={t('Size')}>
          <Select
            value={widthMode}
            onChange={setWidthMode}
            options={[
              { value: '1', label: `100% (${comp.width}×${comp.height})` },
              { value: '0.5', label: `50% (${Math.round(comp.width / 2)}×${Math.round(comp.height / 2)})` },
              { value: '0.25', label: `25% (${Math.round(comp.width / 4)}×${Math.round(comp.height / 4)})` },
              { value: 'custom', label: t('Custom width') },
            ]}
          />
        </Field>
        {widthMode === 'custom' ? (
          <Field label={t('Width')}>
            <NumberField value={customWidth} min={16} max={8192} suffix="px" onChange={(v) => setCustomWidth(Math.round(v))} />
          </Field>
        ) : (
          <span />
        )}
        {format !== 'png-frame' && (
          <Field label={t('Frame rate')}>
            {format === 'gif' ? (
              <Select value={gifFps} options={[8, 10, 12, 15, 20, 24, 25, 30].map((f) => ({ value: f, label: `${f} fps` }))} onChange={setGifFps} />
            ) : (
              <Select value={fps} options={[...new Set([comp.fps, 12, 15, 24, 25, 30, 50, 60])].sort((a, b) => a - b).map((f) => ({ value: f, label: `${f} fps` }))} onChange={setFps} />
            )}
          </Field>
        )}
        {isVideo && (
          <Field label={t('Quality')}>
            <Select
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'low', label: t('Low (small file)') },
                { value: 'medium', label: t('Medium') },
                { value: 'high', label: t('High') },
                { value: 'very-high', label: t('Very high') },
              ]}
            />
          </Field>
        )}
      </div>
      {format === 'gif' && (
        <div className="row" style={{ gap: 16 }}>
          <Toggle checked={dither} onChange={setDither} label={t('Dithering (smoother gradients)')} />
          <Toggle checked={loop} onChange={setLoop} label={t('Loop forever')} />
        </div>
      )}
      {comp.transparent && format !== 'mp4' && (
        <Toggle
          checked={keepAlpha}
          onChange={setKeepAlpha}
          label={format === 'webm' ? (support?.webmAlpha ? t('Keep transparency (VP9 alpha)') : t('Keep transparency (not supported here, exports on black)')) : t('Keep transparency')}
        />
      )}
      {comp.transparent && format === 'mp4' && <div className="faint" style={{ fontSize: 12 }}>{t('MP4 has no transparency: the background is exported as black.')}</div>}
      <div className="faint" style={{ fontSize: 12 }}>
        {t('Output: {w}×{h}, {n} frame(s)', { w: size.width, h: size.height, n: frames })}
        {format !== 'png-frame' ? ` · ${formatTime(frames / outFps)}` : ''}
      </div>
      {running && (
        <div className="col" style={{ gap: 6 }}>
          <ProgressBar value={progress!.value} />
          <span className="faint" style={{ fontSize: 12 }}>
            {Math.round(progress!.value * 100)}% · {progress!.label}
          </span>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------- Curve popover ------------------------------ */

export function CurvePopover({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const t = useT();
  const ed = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: x, top: y, visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y + 6, window.innerHeight - h - 8)) });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest?.('.menu')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const ids = [...ed.selectedKeys];
  const first = ids.map((id) => findKey(ed.doc, ed.keyIndex.get(id))).find(Boolean);
  return createPortal(
    <div ref={ref} className="mo-popover" style={pos} role="dialog" aria-label={t('Easing curve')}>
      <div className="mo-popover-title">{t('Easing curve')}</div>
      {first ? (
        <>
          <div className="faint" style={{ fontSize: 11 }}>
            {t('Shapes the motion from the selected keyframe(s) to the next one ({n} selected).', { n: ids.length })}
          </div>
          <GraphEditor
            easing={first.easing}
            bezier={first.bezier}
            onChange={(easing, bezier) => ed.setDoc((d) => setKeysEasing(d, ids, buildKeyIndex(d), easing, bezier), { record: false })}
            onCommit={(easing, bezier) => {
              ed.setDoc((d) => setKeysEasing(d, ids, buildKeyIndex(d), easing, bezier), { record: false });
              ed.commit('Easing curve');
            }}
          />
        </>
      ) : (
        <div className="faint">{t('Select keyframes in the timeline first.')}</div>
      )}
    </div>,
    document.body,
  );
}
