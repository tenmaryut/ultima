import { useState } from 'react';
import { Captions, Check, Download, Pencil, Play, Sparkles, Trash2, X } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { Button, DropdownButton, IconButton, Panel, Select, Spinner, TextArea, TextInput, toast } from '../../../components/ui';
import { audio } from '../controller';
import { useAudioUI } from '../state';
import { canTranscribe, clearTranscript, deleteSegmentAudio, editSegmentText, exportTranscript, selectSegment, summarizeTranscript, transcribe } from '../transcript';
import { formatClock } from './draw';

const LANGUAGES = [
  ['', 'Detect automatically'],
  ['en', 'English'],
  ['id', 'Indonesian'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['ru', 'Russian'],
] as const;

export function TranscriptPanel() {
  const t = useT();
  useAudioUI((s) => s.revision);
  const transcribing = useAudioUI((s) => s.transcribing);
  const cursor = useAudioUI((s) => s.cursor);
  const selection = useAudioUI((s) => s.selection);
  const [language, setLanguage] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const sr = audio.sampleRate;
  const segments = audio.doc.transcript;
  const shown = filter.trim() ? segments.filter((s) => s.text.toLowerCase().includes(filter.trim().toLowerCase())) : segments;
  const desktopOk = canTranscribe();

  const saveEdit = () => {
    if (!editing) return;
    const removed = editSegmentText(editing.id, editing.text);
    setEditing(null);
    if (removed > 0) toast.success(t('Removed {s} s of audio', { s: removed.toFixed(2) }), t('Undo with Ctrl+Z if a cut sounds wrong.'));
  };

  return (
    <Panel
      title={`${t('Transcript')}${segments.length ? ` (${segments.length})` : ''}`}
      actions={
        <>
          <DropdownButton
            className="icon-btn sm"
            title={t('Export transcript')}
            entries={[
              { label: t('Text (.txt)'), disabled: !segments.length, onClick: () => void exportTranscript('txt') },
              { label: t('Subtitles (.srt)'), disabled: !segments.length, onClick: () => void exportTranscript('srt') },
              { label: t('WebVTT (.vtt)'), disabled: !segments.length, onClick: () => void exportTranscript('vtt') },
            ]}
          >
            <Download size={13} />
          </DropdownButton>
          <IconButton icon={Trash2} size="sm" label={t('Clear transcript')} disabled={!segments.length} onClick={() => clearTranscript()} />
        </>
      }
    >
      {!desktopOk && (
        <div className="faint" style={{ fontSize: 12 }}>
          {t('Transcription runs Whisper on your computer through the desktop app. Transcripts saved in projects still open here.')}
        </div>
      )}
      <div className="row">
        <Select small value={language} onChange={setLanguage} options={LANGUAGES.map(([v, l]) => ({ value: v, label: t(l) }))} disabled={!desktopOk} />
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Button size="sm" variant="primary" icon={Captions} disabled={!desktopOk || !audio.length || transcribing} onClick={() => void transcribe('all', language)}>
          {t('Transcribe')}
        </Button>
        <Button size="sm" disabled={!desktopOk || !selection || transcribing} onClick={() => void transcribe('selection', language)}>
          {t('Selection')}
        </Button>
        {transcribing && <Spinner size={13} />}
      </div>
      {segments.length > 0 && (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button size="sm" icon={Sparkles} onClick={() => void summarizeTranscript('summary')}>
              {t('Summarize')}
            </Button>
            <Button size="sm" icon={Sparkles} onClick={() => void summarizeTranscript('shownotes')}>
              {t('Show notes')}
            </Button>
          </div>
          <TextInput small placeholder={t('Search the transcript…')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="faint" style={{ fontSize: 11 }}>
            {t('Edit a segment and delete words to cut them from the audio.')}
          </div>
        </>
      )}
      <div className="au-transcript">
        {shown.map((s) => {
          const active = cursor >= s.start && cursor < s.end;
          if (editing?.id === s.id) {
            return (
              <div key={s.id} className="au-seg editing">
                <TextArea
                  value={editing.text}
                  rows={3}
                  autoFocus
                  onChange={(e) => setEditing({ id: s.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEdit();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                <div className="row">
                  <Button size="sm" variant="primary" icon={Check} onClick={saveEdit}>
                    {t('Apply cut')}
                  </Button>
                  <Button size="sm" icon={X} onClick={() => setEditing(null)}>
                    {t('Cancel')}
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <div key={s.id} className={`au-seg ${active ? 'active' : ''}`} onClick={() => selectSegment(s.id)}>
              <div className="au-seg-head">
                <span className="mono">{formatClock(s.start / sr, 1)}</span>
                <span className="spacer" />
                <IconButton
                  icon={Play}
                  size="sm"
                  label={t('Play segment')}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSegment(s.id);
                    void audio.play({ from: s.start });
                  }}
                />
                <IconButton
                  icon={Pencil}
                  size="sm"
                  label={t('Edit text (delete words to cut audio)')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing({ id: s.id, text: s.text });
                  }}
                />
                <IconButton
                  icon={Trash2}
                  size="sm"
                  label={t('Delete this segment and its audio')}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSegmentAudio(s.id);
                  }}
                />
              </div>
              <div className="au-seg-text">{s.text}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
