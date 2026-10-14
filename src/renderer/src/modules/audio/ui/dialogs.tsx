import { useEffect, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { desktop, saveFile } from '../../../core/platform';
import { fileBaseName, formatBytes } from '../../../core/utils/format';
import { Badge, Button, Field, Modal, NumberField, Select, Slider, Spinner, TextInput, Toggle, toast } from '../../../components/ui';
import { Markdown } from '../../../components/ai/Markdown';
import { audio } from '../controller';
import { mt } from '../mt';
import { setUI, ui, useAudioUI, type GeneratorKind } from '../state';
import { findSilence, generate, removeSilence, convertSampleRate } from '../ops';
import { exportAudio, newDocument } from '../files';
import { EXPORT_FORMATS, supportedLossyFormats, type ExportFormat } from '../engine/io';
import { NOISE_COLORS, WAVEFORMS, type NoiseColor, type Waveform } from '../dsp/generate';
import { silenceCutRanges } from '../dsp/analysis';
import { formatClock } from './draw';

const RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000];

/* -------------------------------- Generate -------------------------------- */

const genMemory: Record<string, number | string> = {};

export function GenerateDialog({ generator, onClose }: { generator: GeneratorKind; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<GeneratorKind>(generator);
  const [duration, setDuration] = useState(Number(genMemory.duration ?? 2));
  const [waveform, setWaveform] = useState<Waveform>((genMemory.waveform as Waveform) ?? 'sine');
  const [frequency, setFrequency] = useState(Number(genMemory.frequency ?? 440));
  const [sweep, setSweep] = useState(false);
  const [endFrequency, setEndFrequency] = useState(Number(genMemory.endFrequency ?? 2000));
  const [amplitudeDb, setAmplitudeDb] = useState(Number(genMemory.amplitudeDb ?? -6));
  const [color, setColor] = useState<NoiseColor>((genMemory.color as NoiseColor) ?? 'pink');
  const [digits, setDigits] = useState(String(genMemory.digits ?? '0123456789'));
  const [toneMs, setToneMs] = useState(Number(genMemory.toneMs ?? 120));
  const [gapMs, setGapMs] = useState(Number(genMemory.gapMs ?? 80));
  const titles: Record<GeneratorKind, string> = { tone: t('Generate tone'), noise: t('Generate noise'), silence: t('Generate silence'), dtmf: t('Generate DTMF tones') };
  const go = () => {
    Object.assign(genMemory, { duration, waveform, frequency, endFrequency, amplitudeDb, color, digits, toneMs, gapMs });
    const r = generate({ kind, duration, waveform, frequency, endFrequency: sweep ? endFrequency : undefined, amplitudeDb, color, digits, toneMs, gapMs });
    if (r) onClose();
  };
  return (
    <Modal
      title={titles[kind]}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={go}>
            {t('Generate')}
          </Button>
        </>
      }
    >
      <Select<GeneratorKind>
        value={kind}
        onChange={setKind}
        options={[
          { value: 'tone', label: t('Tone') },
          { value: 'noise', label: t('Noise') },
          { value: 'silence', label: t('Silence') },
          { value: 'dtmf', label: t('DTMF tones') },
        ]}
      />
      {kind === 'tone' && (
        <>
          <Field label={t('Waveform')}>
            <Select<Waveform>
              value={waveform}
              onChange={setWaveform}
              options={WAVEFORMS.map((w) => ({ value: w, label: t({ sine: 'Sine', square: 'Square', sawtooth: 'Sawtooth', triangle: 'Triangle' }[w]) }))}
            />
          </Field>
          <Field label={t('Frequency')}>
            <NumberField value={frequency} min={1} max={24000} step={1} suffix="Hz" onChange={setFrequency} />
          </Field>
          <Toggle checked={sweep} onChange={setSweep} label={t('Sweep to another frequency')} />
          {sweep && (
            <Field label={t('End frequency')}>
              <NumberField value={endFrequency} min={1} max={24000} step={1} suffix="Hz" onChange={setEndFrequency} />
            </Field>
          )}
        </>
      )}
      {kind === 'noise' && (
        <Field label={t('Color')}>
          <Select<NoiseColor> value={color} onChange={setColor} options={NOISE_COLORS.map((c) => ({ value: c, label: t({ white: 'White', pink: 'Pink', brown: 'Brown' }[c]) }))} />
        </Field>
      )}
      {kind === 'dtmf' && (
        <>
          <Field label={t('Digits (0–9, *, #, A–D)')}>
            <TextInput value={digits} onChange={(e) => setDigits(e.target.value)} maxLength={64} />
          </Field>
          <div className="row">
            <Field label={t('Tone length')}>
              <NumberField value={toneMs} min={20} max={2000} step={10} suffix="ms" onChange={setToneMs} />
            </Field>
            <Field label={t('Gap')}>
              <NumberField value={gapMs} min={0} max={2000} step={10} suffix="ms" onChange={setGapMs} />
            </Field>
          </div>
        </>
      )}
      {kind !== 'dtmf' && (
        <Field label={t('Duration')}>
          <NumberField value={duration} min={0.01} max={3600} step={0.1} suffix="s" onChange={setDuration} />
        </Field>
      )}
      {kind !== 'silence' && <Slider label={t('Amplitude')} value={amplitudeDb} min={-60} max={0} step={0.5} defaultValue={-6} onChange={setAmplitudeDb} format={(v) => `${v.toFixed(1)} dBFS`} />}
      <div className="faint" style={{ fontSize: 12 }}>
        {audio.length
          ? audio.selection()
            ? t('The generated audio replaces the selection.')
            : t('The generated audio is inserted at the cursor ({time}).', { time: formatClock(ui().cursor / audio.sampleRate) })
          : t('A new file is created ({rate} Hz, {ch}).', { rate: audio.sampleRate, ch: audio.doc.channels.length === 1 ? t('mono') : t('stereo') })}
      </div>
    </Modal>
  );
}

/* --------------------------------- Export --------------------------------- */

export function ExportDialog({ selectionOnly, multitrack, onClose }: { selectionOnly?: boolean; multitrack?: boolean; onClose: () => void }) {
  const t = useT();
  const selection = useAudioUI((s) => s.selection);
  const [format, setFormat] = useState<ExportFormat>('wav16');
  const [source, setSource] = useState<'waveform' | 'selection' | 'mix'>(multitrack ? 'mix' : selectionOnly && selection ? 'selection' : 'waveform');
  const [rate, setRate] = useState(0);
  const [channels, setChannels] = useState<'keep' | 'mono' | 'stereo'>('keep');
  const [bitrate, setBitrate] = useState(192);
  const [dither, setDither] = useState(true);
  const [lossy, setLossy] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    void supportedLossyFormats().then(setLossy);
  }, []);
  const info = EXPORT_FORMATS.find((f) => f.id === format)!;
  const available = (id: ExportFormat) => {
    const f = EXPORT_FORMATS.find((x) => x.id === id)!;
    if (f.ffmpeg) return Boolean(desktop);
    if (id === 'ogg' || id === 'webm' || id === 'm4a') return lossy ? lossy[id] || (Boolean(desktop) && id !== 'webm') : true;
    return true;
  };
  const srcRate = source === 'mix' ? mt.sampleRate : audio.sampleRate;
  const frames = source === 'mix' ? mt.length : source === 'selection' && selection ? selection.end - selection.start : audio.length;
  const outRate = rate || srcRate;
  const outCh = channels === 'mono' ? 1 : channels === 'stereo' ? 2 : source === 'mix' ? 2 : Math.max(1, audio.doc.channels.length);
  const seconds = frames / srcRate;
  const estimate = info.lossy ? (bitrate * 1000 * seconds) / 8 : seconds * outRate * outCh * (format === 'wav16' ? 2 : format === 'wav24' ? 3 : format === 'flac' ? 1.8 : 4);
  const go = async () => {
    onClose();
    await exportAudio({ format, sampleRate: rate, channels, bitrate, dither, source });
  };
  return (
    <Modal
      title={t('Export audio')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" icon={Download} disabled={!frames || !available(format)} onClick={() => void go()}>
            {t('Export')}
          </Button>
        </>
      }
    >
      <Field label={t('What')}>
        <Select<'waveform' | 'selection' | 'mix'>
          value={source}
          onChange={setSource}
          options={[
            { value: 'waveform', label: t('Whole file'), disabled: !audio.length },
            { value: 'selection', label: t('Selection only'), disabled: !selection },
            { value: 'mix', label: t('Multitrack mix'), disabled: !mt.length },
          ]}
        />
      </Field>
      <Field label={t('Format')}>
        <Select<ExportFormat>
          value={format}
          onChange={setFormat}
          options={EXPORT_FORMATS.map((f) => ({ value: f.id, label: `${f.label}${available(f.id) ? '' : f.ffmpeg ? ` — ${t('desktop app + FFmpeg')}` : ` — ${t('not supported here')}`}`, disabled: !available(f.id) }))}
        />
      </Field>
      {info.ffmpeg && (
        <div className="faint" style={{ fontSize: 12 }}>
          {t('Converted with FFmpeg on your computer (Settings → Local creative tools).')}
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label={t('Sample rate')}>
          <Select<number> value={rate} onChange={setRate} options={[{ value: 0, label: t('Keep ({rate} Hz)', { rate: srcRate }) }, ...RATES.map((r) => ({ value: r, label: `${r} Hz` }))]} />
        </Field>
        <Field label={t('Channels')}>
          <Select<'keep' | 'mono' | 'stereo'>
            value={channels}
            onChange={setChannels}
            options={[
              { value: 'keep', label: t('Keep') },
              { value: 'mono', label: t('Mono') },
              { value: 'stereo', label: t('Stereo') },
            ]}
          />
        </Field>
      </div>
      {info.lossy && (
        <Field label={t('Quality')}>
          <Select<number>
            value={bitrate}
            onChange={setBitrate}
            options={[64, 96, 128, 160, 192, 256, 320].map((b) => ({ value: b, label: `${b} kbps${b === 192 ? ` (${t('recommended')})` : ''}` }))}
          />
        </Field>
      )}
      {format === 'wav16' && <Toggle checked={dither} onChange={setDither} label={t('Dither (reduces quantization distortion)')} />}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Badge>{formatClock(seconds)}</Badge>
        <Badge>
          {outRate} Hz · {outCh === 1 ? t('mono') : t('stereo')}
        </Badge>
        <Badge>≈ {formatBytes(estimate)}</Badge>
      </div>
    </Modal>
  );
}

/* ------------------------------ Remove silence ------------------------------ */

export function RemoveSilenceDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const selection = useAudioUI((s) => s.selection);
  const [thresholdDb, setThreshold] = useState(-45);
  const [minDuration, setMinDuration] = useState(0.6);
  const [padding, setPadding] = useState(0.15);
  const [found, setFound] = useState<{ count: number; seconds: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const scope = selection ?? { start: 0, end: audio.length };
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setScanning(true);
    const timer = setTimeout(() => {
      void findSilence({ thresholdDb, minDuration }, scope, ctrl.signal)
        .then((ranges) => {
          if (cancelled) return;
          const cuts = silenceCutRanges(ranges, audio.sampleRate, padding, audio.length);
          setFound({ count: cuts.length, seconds: cuts.reduce((s, r) => s + r.end - r.start, 0) / audio.sampleRate });
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setScanning(false));
    }, 250);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thresholdDb, minDuration, padding, selection]);
  const go = async () => {
    onClose();
    const r = await removeSilence({ thresholdDb, minDuration, padding }, selection);
    if (r) toast.success(r.count ? t('Removed {count} silent parts ({s} s)', { count: r.count, s: r.seconds.toFixed(1) }) : t('No silence found with these settings'));
  };
  return (
    <Modal
      title={t('Remove silence')}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={!found?.count} onClick={() => void go()}>
            {t('Remove')}
          </Button>
        </>
      }
    >
      <div className="muted" style={{ fontSize: 12.5 }}>
        {t('Deletes pauses that stay below the threshold for at least the minimum duration, keeping a little silence around the sound.')}
      </div>
      <Slider label={t('Threshold')} value={thresholdDb} min={-80} max={-10} step={1} defaultValue={-45} onChange={setThreshold} format={(v) => `${v} dBFS`} />
      <Slider label={t('Minimum silence')} value={minDuration} min={0.1} max={5} step={0.05} defaultValue={0.6} onChange={setMinDuration} format={(v) => `${v.toFixed(2)} s`} />
      <Slider label={t('Keep padding')} value={padding} min={0} max={1} step={0.01} defaultValue={0.15} onChange={setPadding} format={(v) => `${Math.round(v * 1000)} ms`} />
      <div className="row" style={{ minHeight: 24 }}>
        {scanning ? <Spinner size={14} /> : null}
        {found && <Badge tone={found.count ? 'ok' : undefined}>{t('{count} parts · {s} s would be removed', { count: found.count, s: found.seconds.toFixed(1) })}</Badge>}
        <span className="faint" style={{ fontSize: 12 }}>
          {selection ? t('In the selection') : t('In the whole file')}
        </span>
      </div>
    </Modal>
  );
}

/* ------------------------------ Resample / new ------------------------------ */

export function ResampleDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [rate, setRate] = useState(audio.sampleRate === 48000 ? 44100 : 48000);
  return (
    <Modal
      title={t('Convert sample rate')}
      onClose={onClose}
      width={380}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            disabled={rate === audio.sampleRate}
            onClick={() => {
              onClose();
              void convertSampleRate(rate);
            }}
          >
            {t('Convert')}
          </Button>
        </>
      }
    >
      <div className="muted">{t('Current: {rate} Hz', { rate: audio.sampleRate })}</div>
      <Select<number> value={rate} onChange={setRate} options={RATES.map((r) => ({ value: r, label: `${r} Hz` }))} />
    </Modal>
  );
}

export function NewFileDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [rate, setRate] = useState(48000);
  const [channels, setChannels] = useState(2);
  return (
    <Modal
      title={t('New audio file')}
      onClose={onClose}
      width={380}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              void newDocument(rate, channels);
            }}
          >
            {t('Create')}
          </Button>
        </>
      }
    >
      <Field label={t('Sample rate')}>
        <Select<number> value={rate} onChange={setRate} options={RATES.map((r) => ({ value: r, label: `${r} Hz` }))} />
      </Field>
      <Field label={t('Channels')}>
        <Select<number>
          value={channels}
          onChange={setChannels}
          options={[
            { value: 1, label: t('Mono') },
            { value: 2, label: t('Stereo') },
          ]}
        />
      </Field>
      <div className="faint" style={{ fontSize: 12 }}>
        {t('Then record, generate or paste audio into it.')}
      </div>
    </Modal>
  );
}

/* ---------------------------------- Notes ---------------------------------- */

export function NotesDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const t = useT();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('Copied to clipboard'));
    } catch {
      toast.error(t('Could not copy'));
    }
  };
  const save = async () => {
    try {
      await saveFile(text, { suggestedName: `${fileBaseName(ui().docName) || 'notes'}-${title.toLowerCase().replace(/\s+/g, '-')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    } catch (error) {
      toast.error(t('Could not save the file'), error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <Button icon={Copy} onClick={() => void copy()}>
            {t('Copy')}
          </Button>
          <Button icon={Download} onClick={() => void save()}>
            {t('Save as Markdown')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <div className="selectable au-notes">
        <Markdown text={text} />
      </div>
    </Modal>
  );
}

export function closeDialog(): void {
  setUI({ dialog: null });
}
