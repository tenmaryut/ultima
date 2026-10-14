/**
 * Transcript features: speech-to-text through the desktop app's Whisper, transcript
 * navigation, "edit by transcript" (deleting words/segments deletes their audio),
 * TXT/SRT/VTT export and AI summaries / show notes.
 */
import { t } from '../../core/i18n';
import { uid } from '../../core/utils/id';
import { blobToBase64 } from '../../core/utils/base64';
import { toSpeechWav } from '../../core/utils/audio';
import { desktop, saveFile } from '../../core/platform';
import { fileBaseName } from '../../core/utils/format';
import { describeAIError, runAI } from '../../core/ai/client';
import { toast } from '../../components/ui';
import type { TranscriptSegment } from './engine/document';
import { audio } from './controller';
import { CancelledError } from './engine/dspClient';
import { setUI, ui } from './state';
import { planTranscriptCut, snapToQuiet, transcriptToSrt, transcriptToText, transcriptToVtt, type TimedText } from './transcriptEdit';

export function transcriptInSeconds(): (TimedText & { id: string })[] {
  const sr = audio.sampleRate;
  return audio.doc.transcript.map((s) => ({ id: s.id, start: s.start / sr, end: s.end / sr, text: s.text }));
}

export function canTranscribe(): boolean {
  return Boolean(desktop);
}

/** Builds an AudioBuffer of [start, end) for the speech-to-text conversion. */
function rangeToAudioBuffer(start: number, end: number): AudioBuffer {
  const channels = audio.doc.channels;
  const buffer = new AudioBuffer({ length: Math.max(1, end - start), numberOfChannels: channels.length, sampleRate: audio.sampleRate });
  channels.forEach((c, i) => buffer.copyToChannel(c.subarray(start, end) as Float32Array<ArrayBuffer>, i));
  return buffer;
}

export async function transcribe(scope: 'all' | 'selection', language?: string): Promise<boolean> {
  const api = desktop;
  if (!api) {
    toast.info(t('Transcription needs the desktop app'), t('Install the Ultima desktop app and a free speech-to-text tool (Whisper) to transcribe audio.'));
    return false;
  }
  if (!audio.length) return false;
  const range = scope === 'selection' && audio.selection() ? audio.selection()! : { start: 0, end: audio.length };
  setUI({ transcribing: true });
  try {
    const result = await audio.runBusy(
      t('Transcribing… this can take a while'),
      async () => {
        const wav = await toSpeechWav(rangeToAudioBuffer(range.start, range.end));
        return api.tools.transcribe({ requestId: uid('stt'), wavBase64: await blobToBase64(wav), language: language || undefined });
      },
      false,
    );
    if (!result) return false;
    if (!result.ok) {
      toast.error(t('Transcription failed'), result.error || '');
      return false;
    }
    const sr = audio.sampleRate;
    const fresh: TranscriptSegment[] = result.segments
      .filter((s) => s.text.trim() && s.end > s.start)
      .map((s) => ({
        id: uid('ts'),
        start: Math.min(range.end, range.start + Math.round(s.start * sr)),
        end: Math.min(range.end, range.start + Math.round(s.end * sr)),
        text: s.text.trim(),
      }))
      .filter((s) => s.end > s.start);
    // keep existing segments outside the transcribed range
    const kept = audio.doc.transcript.filter((s) => s.end <= range.start || s.start >= range.end);
    audio.doc.setMeta({ transcript: [...kept, ...fresh].sort((a, b) => a.start - b.start) }, t('Transcribe'));
    toast.success(t('Transcript ready'), t('{count} segments', { count: fresh.length }));
    return true;
  } finally {
    setUI({ transcribing: false });
  }
}

export function selectSegment(id: string): void {
  const seg = audio.doc.transcript.find((s) => s.id === id);
  if (!seg) return;
  audio.setSelection({ start: seg.start, end: seg.end });
  audio.setCursor(seg.start);
  audio.scrollToShow(seg.start);
}

export function clearTranscript(): void {
  if (audio.doc.transcript.length) audio.doc.setMeta({ transcript: [] }, t('Clear transcript'));
}

/** Deletes a segment AND its audio (cut points snapped to the quietest nearby moment). */
export function deleteSegmentAudio(id: string): void {
  const seg = audio.doc.transcript.find((s) => s.id === id);
  if (!seg) return;
  const sr = audio.sampleRate;
  const radius = Math.round(0.06 * sr);
  const a = snapToQuiet(audio.doc.channels, seg.start, radius, sr);
  const b = Math.max(a + 1, snapToQuiet(audio.doc.channels, seg.end, radius, sr));
  audio.doc.begin(t('Delete transcript segment'), audio.selection());
  try {
    audio.doc.replaceRange(a, b, null, t('Delete transcript segment'));
    audio.doc.setMeta({ transcript: audio.doc.transcript.filter((s) => s.id !== id) }, t('Delete transcript segment'));
  } finally {
    audio.doc.commit(null);
  }
  audio.setSelection(null);
  audio.setCursor(a);
}

/**
 * Applies an edited segment text: deleted words delete their (estimated) audio, the
 * segment text is updated. Returns the number of seconds removed.
 */
export function editSegmentText(id: string, newText: string): number {
  const seg = audio.doc.transcript.find((s) => s.id === id);
  if (!seg) return 0;
  const text = newText.replace(/\s+/g, ' ').trim();
  if (text === seg.text.trim()) return 0;
  if (!text) {
    const dur = (seg.end - seg.start) / audio.sampleRate;
    deleteSegmentAudio(id);
    return dur;
  }
  const plan = planTranscriptCut(seg.text, text, seg.start, seg.end);
  const sr = audio.sampleRate;
  const radius = Math.round(0.08 * sr);
  const cuts = plan.ranges
    .map((r) => {
      const a = snapToQuiet(audio.doc.channels, r.start, radius, sr);
      const b = snapToQuiet(audio.doc.channels, r.end, radius, sr);
      return { start: Math.max(seg.start, Math.min(a, b)), end: Math.min(seg.end, Math.max(a, b)) };
    })
    .filter((r) => r.end - r.start > sr * 0.02);
  audio.doc.begin(t('Edit by transcript'), audio.selection());
  let removed = 0;
  try {
    for (let i = cuts.length - 1; i >= 0; i--) {
      audio.doc.replaceRange(cuts[i].start, cuts[i].end, null, t('Edit by transcript'));
      removed += cuts[i].end - cuts[i].start;
    }
    audio.doc.setMeta({ transcript: audio.doc.transcript.map((s) => (s.id === id ? { ...s, text } : s)) }, t('Edit by transcript'));
  } finally {
    audio.doc.commit(null);
  }
  if (plan.inserted) toast.info(t('Only deleted words change the audio'), t('Added or changed words were saved in the text, but audio cannot be created from text.'));
  return removed / sr;
}

export async function exportTranscript(format: 'txt' | 'srt' | 'vtt'): Promise<void> {
  const segs = transcriptInSeconds();
  if (!segs.length) {
    toast.info(t('There is no transcript yet'));
    return;
  }
  const text = format === 'srt' ? transcriptToSrt(segs) : format === 'vtt' ? transcriptToVtt(segs) : transcriptToText(segs, true);
  const name = `${fileBaseName(ui().docName) || 'transcript'}.${format}`;
  try {
    await saveFile(text, { suggestedName: name, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  } catch (error) {
    toast.error(t('Could not save the file'), error instanceof Error ? error.message : String(error));
  }
}

const NOTES_SYSTEM =
  'You are an experienced podcast and video producer. You write clear, accurate, well-structured notes in Markdown, based only on the transcript you are given. Never invent facts that are not in the transcript. Write in the same language as the transcript.';

export async function summarizeTranscript(kind: 'summary' | 'shownotes'): Promise<void> {
  const segs = transcriptInSeconds();
  if (!segs.length) {
    toast.info(t('Transcribe the audio first'));
    return;
  }
  let body = transcriptToText(segs, true);
  if (body.length > 60000) body = `${body.slice(0, 60000)}\n[…transcript truncated…]`;
  const task =
    kind === 'summary'
      ? 'Summarize this recording: a 3–5 sentence overview, then 5–8 key points as a bulleted list.'
      : 'Write show notes for this episode: a catchy title suggestion, a one-paragraph description, chapters as a list of "mm:ss Title" lines (based on the timestamps), key takeaways, and notable quotes.';
  const result = await audio.runBusy(kind === 'summary' ? t('Summarizing…') : t('Writing show notes…'), async (signal) => {
    try {
      const r = await runAI({ prompt: `${task}\n\nTRANSCRIPT (with [hh:mm:ss] timestamps)\n${body}`, system: NOTES_SYSTEM, signal });
      return r.text;
    } catch (error) {
      if (signal.aborted) throw new CancelledError();
      throw new Error(describeAIError(error));
    }
  });
  if (result) setUI({ dialog: { kind: 'notes', title: kind === 'summary' ? t('Summary') : t('Show notes'), text: result } });
}
