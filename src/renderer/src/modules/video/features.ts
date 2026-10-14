import { desktop } from '../../core/platform';
import { runAIJson } from '../../core/ai/client';
import { toSpeechWav } from '../../core/utils/audio';
import { blobToBase64 } from '../../core/utils/base64';
import { uid } from '../../core/utils/id';
import type { CaptionCue, Project, TimeRange } from './types';
import type { MediaLibrary } from './media';
import { hasAudioIn, mixRange } from './mix';
import { splitLongCues, transcriptText } from './captions';
import { captionCues, clipEnd, timelineDuration } from './model';
import { parseRoughCut, parseVideoMeta, type VideoMeta } from './aiActions';
import { formatTimecode } from './time';

/* Longer-running helpers behind the Captions and AI menus. */

export class FeatureError extends Error {
  constructor(
    message: string,
    public code: 'no-desktop' | 'no-audio' | 'tool' | 'empty',
  ) {
    super(message);
  }
}

const WINDOW = 600; // seconds of audio sent to the speech-to-text tool at once

/** Mixes the timeline audio and transcribes it with the desktop app's Whisper. */
export async function transcribeTimeline(
  project: Project,
  lib: MediaLibrary,
  range: TimeRange,
  opts: { language?: string; model?: string; maxChars?: number },
  onProgress: (stage: 'mix' | 'transcribe', fraction: number) => void,
  signal: AbortSignal,
): Promise<CaptionCue[]> {
  const api = desktop;
  if (!api) throw new FeatureError('Auto captions run on your computer with Whisper, which needs the Ultima desktop app.', 'no-desktop');
  if (!hasAudioIn(project, range)) throw new FeatureError('There is no audible audio in this range.', 'no-audio');
  const cues: CaptionCue[] = [];
  const total = range.end - range.start;
  for (let start = range.start; start < range.end - 0.05; start += WINDOW) {
    const end = Math.min(range.end, start + WINDOW);
    const part = (start - range.start) / total;
    const share = (end - start) / total;
    const mix = await mixRange(project, lib, { start, end }, {
      sampleRate: 16000,
      channels: 1,
      signal,
      onProgress: (f) => onProgress('mix', part + f * share * 0.3),
    });
    const samples = mix.channels[0];
    if (!samples.some((v) => Math.abs(v) > 1e-4)) continue;
    const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate: mix.sampleRate });
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const wav = await toSpeechWav(buffer);
    onProgress('transcribe', part + share * 0.35);
    const res = await api.tools.transcribe({
      requestId: uid('stt_'),
      wavBase64: await blobToBase64(wav),
      language: opts.language || undefined,
      model: opts.model || undefined,
    });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!res.ok) throw new FeatureError(res.error || 'Transcription failed', 'tool');
    for (const seg of res.segments) {
      const text = seg.text.trim();
      if (text) cues.push({ start: start + Math.max(0, seg.start), end: start + Math.max(seg.start, seg.end), text });
    }
    onProgress('transcribe', part + share);
  }
  if (!cues.length) throw new FeatureError('No speech was recognised.', 'empty');
  return splitLongCues(cues, opts.maxChars ?? 84);
}

/** Mixed mono audio of a range at 16 kHz (for silence detection). */
export async function analyseAudio(
  project: Project,
  lib: MediaLibrary,
  range: TimeRange,
  onProgress: (f: number) => void,
  signal: AbortSignal,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (!hasAudioIn(project, range)) throw new FeatureError('There is no audible audio in this range.', 'no-audio');
  const mix = await mixRange(project, lib, range, { sampleRate: 16000, channels: 1, onProgress, signal });
  return { samples: mix.channels[0], sampleRate: mix.sampleRate };
}

function outline(project: Project): string {
  const clips = project.clips
    .filter((c) => c.kind !== 'caption' && c.kind !== 'audio')
    .sort((a, b) => a.start - b.start)
    .slice(0, 120)
    .map((c) => `- ${formatTimecode(c.start, project.settings.fps)}–${formatTimecode(clipEnd(c), project.settings.fps)} ${c.kind === 'title' ? `title "${c.title?.text ?? ''}"` : c.name}`);
  const markers = project.markers.map((m) => `- ${m.time.toFixed(1)} s ${m.label}`);
  return [`Clips in order:\n${clips.join('\n') || '(none)'}`, markers.length ? `Markers:\n${markers.join('\n')}` : ''].filter(Boolean).join('\n');
}

/** YouTube title options, description, chapters and tags from the transcript (or clip names). */
export async function writeVideoMeta(project: Project, notes: string, signal: AbortSignal, onText?: (t: string) => void): Promise<VideoMeta> {
  const cues = captionCues(project, true);
  const duration = timelineDuration(project);
  if (duration <= 0) throw new FeatureError('The timeline is empty.', 'empty');
  const source = cues.length ? `TRANSCRIPT (from the captions, [m:ss] stamps):\n${transcriptText(cues, 14000)}` : `There is no transcript.\n${outline(project)}`;
  const prompt = [
    `Video "${project.name}", length ${Math.round(duration)} seconds.`,
    source,
    notes.trim() ? `Notes from the creator: ${notes.trim()}` : '',
    `Write YouTube metadata as JSON: {"titles": [5 catchy, accurate title options, max 70 characters each], "description": "2-4 short paragraphs and a call to action", "chapters": [{"time": seconds, "title": string}] (first at 0, chapters at least 10 s apart, 3-10 chapters, or [] when the video is shorter than 1 minute), "tags": [up to 15 keywords]}.`,
    'Write in the language of the transcript. Never invent facts that are not supported by the material.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data } = await runAIJson<unknown>({
    prompt,
    system: 'You are an experienced YouTube producer who writes accurate, engaging titles, descriptions and chapters.',
    signal,
    onText,
  });
  return parseVideoMeta(data, duration);
}

/** Asks the AI which transcript segments to cut for a tighter edit. */
export async function roughCutSuggestions(cues: CaptionCue[], goal: string, signal: AbortSignal): Promise<{ remove: number[]; reason: string }> {
  if (!cues.length) throw new FeatureError('Add captions first (Auto captions or import an SRT file) — the rough cut works from the transcript.', 'empty');
  let size = 0;
  const lines: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const line = `${i}. [${cues[i].start.toFixed(1)}-${cues[i].end.toFixed(1)}] ${cues[i].text.replace(/\s+/g, ' ')}`;
    size += line.length;
    if (size > 24000) break;
    lines.push(line);
  }
  const prompt = [
    'Transcript segments of a video (index. [start-end seconds] text):',
    lines.join('\n'),
    `Goal: ${goal.trim() || 'Tighten the edit: remove filler, false starts, repeated takes and off-topic tangents while keeping the story coherent.'}`,
    'Return JSON {"remove": [indices of the segments to cut], "reason": "one or two sentences"}. Keep segments needed for context. When a sentence is repeated, keep the last (best) take.',
  ].join('\n\n');
  const { data } = await runAIJson<unknown>({ prompt, system: 'You are a professional video editor making a rough cut from a transcript.', signal });
  return parseRoughCut(data, lines.length);
}
