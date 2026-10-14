import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Mic, RefreshCw, Square } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Badge, Button, Field, IconButton, Modal, Select, toast } from '../../../components/ui';
import { MicRecorder, listInputDevices, type InputDevice } from '../engine/recorder';
import { audio } from '../controller';
import { confirmDiscard, loadDecoded } from '../files';
import { ui } from '../state';
import { LevelMeters } from './Transport';
import { formatClock } from './draw';

type Destination = 'new' | 'insert';

export function RecordDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const recorder = useRef<MicRecorder | null>(null);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [channels, setChannels] = useState<1 | 2>(1);
  const [destination, setDestination] = useState<Destination>(audio.length ? 'insert' : 'new');
  const [state, setState] = useState<'opening' | 'ready' | 'recording' | 'error'>('opening');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listInputDevices());
    } catch {
      setDevices([]);
    }
  }, []);

  // open (or re-open) the input whenever device/channel settings change
  useEffect(() => {
    let cancelled = false;
    const rec = recorder.current ?? new MicRecorder();
    recorder.current = rec;
    setState('opening');
    rec
      .open(deviceId || undefined, channels)
      .then(async () => {
        if (cancelled) return;
        setState('ready');
        await refreshDevices();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(/denied|NotAllowed/i.test(msg) ? t('Microphone access was denied. Allow it in your system or browser settings and try again.') : msg || t('No microphone found.'));
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, channels, refreshDevices, t]);

  useEffect(() => () => recorder.current?.close(), []);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setElapsed(recorder.current?.elapsed() ?? 0), 100);
    return () => clearInterval(id);
  }, [state]);

  const levels = useCallback(() => recorder.current?.levels() ?? null, []);

  const start = () => {
    try {
      if (audio.player.playing) audio.stop();
      recorder.current?.start();
      setElapsed(0);
      setState('recording');
    } catch (e) {
      toast.error(t('Could not start recording'), e instanceof Error ? e.message : String(e));
    }
  };

  const stop = () => {
    const rec = recorder.current;
    if (!rec) return;
    const take = rec.stop();
    setState('ready');
    if (!take.channels[0]?.length) {
      toast.info(t('Nothing was recorded'));
      return;
    }
    if (destination === 'new' || !audio.length) {
      void (async () => {
        if (!(await confirmDiscard())) return;
        loadDecoded(`${t('Recording')} ${new Date().toLocaleTimeString()}.wav`, take.sampleRate, take.channels, t('Microphone recording'));
        audio.doc.markUnsaved();
      })();
    } else {
      audio.insertAudio(take.channels, take.sampleRate, ui().cursor, t('Record'), null);
    }
    toast.success(t('Recorded {s}', { s: formatClock(take.channels[0].length / take.sampleRate, 1) }));
    rec.close();
    onClose();
  };

  const close = () => {
    if (state === 'recording') {
      recorder.current?.stop();
    }
    recorder.current?.close();
    onClose();
  };

  return (
    <Modal title={t('Record from microphone')} onClose={close} width={480}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label={t('Input device')}>
          <Select
            value={deviceId}
            onChange={setDeviceId}
            disabled={state === 'recording'}
            options={[{ value: '', label: t('Default microphone') }, ...devices.filter((d) => d.id && d.id !== 'default').map((d) => ({ value: d.id, label: d.label }))]}
          />
        </Field>
        <IconButton icon={RefreshCw} label={t('Refresh devices')} onClick={() => void refreshDevices()} disabled={state === 'recording'} />
      </div>
      <div className="row">
        <Field label={t('Channels')}>
          <Select<string>
            value={String(channels)}
            disabled={state === 'recording'}
            onChange={(v) => setChannels(v === '2' ? 2 : 1)}
            options={[
              { value: '1', label: t('Mono') },
              { value: '2', label: t('Stereo') },
            ]}
          />
        </Field>
        <Field label={t('Put the recording')}>
          <Select<Destination>
            value={destination}
            disabled={state === 'recording'}
            onChange={setDestination}
            options={[
              { value: 'insert', label: t('Insert at the cursor'), disabled: !audio.length },
              { value: 'new', label: t('In a new file') },
            ]}
          />
        </Field>
      </div>
      <div className="col" style={{ gap: 4 }}>
        <span className="field-label">{t('Input level')}</span>
        <LevelMeters active={state === 'ready' || state === 'recording'} running={state === 'ready' || state === 'recording'} getLevels={levels} channels={channels} />
      </div>
      {state === 'error' && <div className="au-error">{error}</div>}
      <div className="row au-record-row">
        {state === 'recording' ? (
          <Button variant="danger" icon={Square} onClick={stop}>
            {t('Stop')}
          </Button>
        ) : (
          <Button variant="primary" icon={Circle} disabled={state !== 'ready'} onClick={start}>
            {t('Record')}
          </Button>
        )}
        <span className={`au-rec-time mono ${state === 'recording' ? 'live' : ''}`}>
          {state === 'recording' && <span className="au-rec-dot" />}
          {formatClock(elapsed, 1)}
        </span>
        <span className="spacer" />
        {state === 'opening' && <Badge>{t('Opening microphone…')}</Badge>}
        {state === 'ready' && (
          <Badge tone="ok">
            <Mic size={11} /> {t('Ready')} · {recorder.current?.sampleRate ?? 48000} Hz
          </Badge>
        )}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>
        {t('Echo cancellation, noise suppression and automatic gain are turned off for a clean recording. Use headphones to avoid feedback.')}
      </div>
    </Modal>
  );
}
