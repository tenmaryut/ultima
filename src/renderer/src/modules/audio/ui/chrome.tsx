import { AudioWaveform, ClipboardPaste, Copy, Gauge, Layers, Maximize2, Redo2, Scissors, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, IconButton, ProgressBar, Spinner } from '../../../components/ui';
import { audio } from '../controller';
import { mt } from '../mt';
import { setUI, useAudioUI } from '../state';
import { formatClock } from './draw';
import { EffectDialog } from './EffectDialog';
import { ExportDialog, GenerateDialog, NewFileDialog, NotesDialog, RemoveSilenceDialog, ResampleDialog } from './dialogs';
import { RecordDialog } from './RecordDialog';
import { SpeechDialog } from '../../../components/ai/SpeechDialog';
import { insertSpeech } from '../files';

export function Toolbar() {
  const t = useT();
  const tab = useAudioUI((s) => s.tab);
  const spectral = useAudioUI((s) => s.spectral);
  const selection = useAudioUI((s) => s.selection);
  useAudioUI((s) => s.revision);
  useAudioUI((s) => s.mtRevision);
  useAudioUI((s) => s.clipboard);
  const wave = tab === 'waveform';
  return (
    <>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={wave} className={wave ? 'active' : ''} onClick={() => setUI({ tab: 'waveform' })}>
          <AudioWaveform size={13} /> {t('Waveform')}
        </button>
        <button type="button" role="tab" aria-selected={!wave} className={!wave ? 'active' : ''} onClick={() => setUI({ tab: 'multitrack' })}>
          <Layers size={13} /> {t('Multitrack')}
        </button>
      </div>
      <span className="vsep" />
      <IconButton icon={Undo2} label={`${t('Undo')} (Ctrl+Z)`} disabled={wave ? !audio.doc.canUndo : !mt.history.canUndo} onClick={() => (wave ? audio.undo() : mt.undo())} />
      <IconButton icon={Redo2} label={`${t('Redo')} (Ctrl+Shift+Z)`} disabled={wave ? !audio.doc.canRedo : !mt.history.canRedo} onClick={() => (wave ? audio.redo() : mt.redo())} />
      {wave && (
        <>
          <span className="vsep" />
          <IconButton icon={Scissors} label={`${t('Cut')} (Ctrl+X)`} disabled={!selection} onClick={() => audio.cut()} />
          <IconButton icon={Copy} label={`${t('Copy')} (Ctrl+C)`} disabled={!selection} onClick={() => audio.copy()} />
          <IconButton icon={ClipboardPaste} label={`${t('Paste')} (Ctrl+V)`} disabled={!audio.clipboard} onClick={() => audio.paste()} />
          <IconButton icon={Trash2} label={`${t('Delete')} (Del)`} disabled={!selection} onClick={() => audio.deleteSelection()} />
          <span className="vsep" />
          <IconButton icon={ZoomOut} label={`${t('Zoom out')} (Ctrl+-)`} disabled={!audio.length} onClick={() => audio.zoomBy(0.5)} />
          <IconButton icon={ZoomIn} label={`${t('Zoom in')} (Ctrl+=)`} disabled={!audio.length} onClick={() => audio.zoomBy(2)} />
          <IconButton icon={Maximize2} label={selection ? `${t('Zoom to selection')} (Ctrl+1)` : `${t('Zoom out full')} (Ctrl+0)`} disabled={!audio.length} onClick={() => (selection ? audio.zoomToSelection() : audio.zoomFit())} />
          <IconButton icon={Gauge} label={t('Spectral frequency display')} active={spectral} disabled={!audio.length} onClick={() => setUI({ spectral: !spectral })} />
        </>
      )}
    </>
  );
}

export function StatusBar() {
  const t = useT();
  const tab = useAudioUI((s) => s.tab);
  const selection = useAudioUI((s) => s.selection);
  const cursor = useAudioUI((s) => s.cursor);
  const hover = useAudioUI((s) => s.hover);
  const view = useAudioUI((s) => s.view);
  const noisePrint = useAudioUI((s) => s.noisePrint);
  useAudioUI((s) => s.revision);
  useAudioUI((s) => s.mtRevision);
  const sr = audio.sampleRate;
  if (tab === 'multitrack') {
    return (
      <>
        <span>{t('{count} tracks', { count: mt.session.tracks.length })}</span>
        <span>{mt.sampleRate} Hz</span>
        <span>{t('Length')} {formatClock(mt.length / mt.sampleRate)}</span>
        <span>{t('Playhead')} {formatClock(mt.playhead / mt.sampleRate)}</span>
      </>
    );
  }
  if (!audio.hasAudio) return <span>{t('No audio')}</span>;
  return (
    <>
      <span>
        {sr} Hz · {audio.doc.channels.length === 1 ? t('Mono') : audio.doc.channels.length === 2 ? t('Stereo') : `${audio.doc.channels.length} ch`}
      </span>
      <span>
        {t('Duration')} {formatClock(audio.length / sr)}
      </span>
      {selection ? (
        <span>
          {t('Selection')} {formatClock(selection.start / sr)} – {formatClock(selection.end / sr)} ({formatClock((selection.end - selection.start) / sr)})
        </span>
      ) : (
        <span>
          {t('Cursor')} {formatClock(cursor / sr)}
        </span>
      )}
      {hover !== null && (
        <span className="faint">
          {t('Pointer')} {formatClock(hover / sr)}
        </span>
      )}
      <span className="faint">{view.spp >= 1 ? t('{n} samples/px', { n: view.spp < 10 ? view.spp.toFixed(1) : Math.round(view.spp) }) : t('{n} px/sample', { n: (1 / view.spp).toFixed(1) })}</span>
      {noisePrint && <span className="au-status-badge">{t('Noise print')} ✓</span>}
      {audio.clipboard && <span className="faint">{t('Clipboard')} {formatClock(audio.clipboard.channels[0].length / audio.clipboard.sampleRate, 2)}</span>}
    </>
  );
}

export function BusyOverlay() {
  const t = useT();
  const busy = useAudioUI((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="au-busy" role="status" aria-live="polite">
      <div className="au-busy-card">
        <div className="row">
          <Spinner size={16} />
          <strong className="grow">{busy.label}</strong>
        </div>
        {busy.progress !== null ? <ProgressBar value={busy.progress} /> : <div className="faint" style={{ fontSize: 12 }}>{t('Working…')}</div>}
        {busy.cancel && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" onClick={busy.cancel}>
              {t('Cancel')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AudioDialogs() {
  const t = useT();
  const dialog = useAudioUI((s) => s.dialog);
  const tab = useAudioUI((s) => s.tab);
  const close = () => setUI({ dialog: null });
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'effect':
      return <EffectDialog key={dialog.effect} effect={dialog.effect} onClose={close} />;
    case 'generate':
      return <GenerateDialog generator={dialog.generator} onClose={close} />;
    case 'export':
      return <ExportDialog selectionOnly={dialog.selectionOnly} multitrack={dialog.multitrack} onClose={close} />;
    case 'record':
      return <RecordDialog onClose={close} />;
    case 'removeSilence':
      return <RemoveSilenceDialog onClose={close} />;
    case 'resample':
      return <ResampleDialog onClose={close} />;
    case 'newFile':
      return <NewFileDialog onClose={close} />;
    case 'notes':
      return <NotesDialog title={dialog.title} text={dialog.text} onClose={close} />;
    case 'speech':
      return (
        <SpeechDialog
          title={t('Speech from text')}
          confirmLabel={t('Insert')}
          hint={
            tab === 'multitrack'
              ? t('The speech is added on a new track at the playhead.')
              : audio.selection()
                ? t('The speech replaces the selection.')
                : t('The speech is inserted at the cursor.')
          }
          onInsert={insertSpeech}
          onClose={close}
        />
      );
    default:
      return null;
  }
}
