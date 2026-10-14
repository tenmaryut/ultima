/**
 * File workflows: new / open (audio, video, .ultima) / save project / export audio,
 * markers export and mixdown — with confirmations, progress and error toasts.
 */
import { t } from '../../core/i18n';
import { pickFiles, saveFile } from '../../core/platform';
import { rememberRecent } from '../../core/open';
import { fileBaseName, formatBytes, formatTime } from '../../core/utils/format';
import { confirmDialog, toast } from '../../components/ui';
import { buildProject, decodeFile, encodeAudio, estimateProjectBytes, isAudioOrVideoFile, isProjectFile, parseProject, OPEN_ACCEPT, EXPORT_FORMATS, type ExportOptions, type ProjectEncoding } from './engine/io';
import { copyRange } from './engine/document';
import { chaptersText } from './transcriptEdit';
import { audio } from './controller';
import { mt } from './mt';
import { setUI, ui } from './state';

export async function confirmDiscard(): Promise<boolean> {
  if (!audio.doc.dirty || !audio.length) return true;
  return confirmDialog({
    title: t('Discard unsaved changes?'),
    message: t('The current audio has changes that were not saved or exported.'),
    confirmLabel: t('Discard'),
    danger: true,
  });
}

export async function newDocument(sampleRate = 48000, channels = 2): Promise<void> {
  if (!(await confirmDiscard())) return;
  audio.stop();
  audio.doc.load({ sampleRate, channels: Array.from({ length: channels }, () => new Float32Array(0)), markers: [], transcript: [] });
  audio.projectPath = undefined;
  audio.sourceFormat = '';
  setUI({ docName: t('Untitled'), selection: null, cursor: 0, stats: null });
  audio.zoomFit();
}

/** Loads decoded audio as the waveform document. */
export function loadDecoded(name: string, sampleRate: number, channels: Float32Array[], format = ''): void {
  audio.stop();
  audio.doc.load({ sampleRate, channels, markers: [], transcript: [] });
  audio.projectPath = undefined;
  audio.sourceFormat = format;
  setUI({ docName: name, selection: null, cursor: 0, stats: null, tab: 'waveform' });
  audio.zoomFit();
}

export async function openAudioFile(file: File): Promise<boolean> {
  const loaded = await audio.runBusy(t('Opening {name}…', { name: file.name }), (_signal, progress) => decodeFile(file, progress), false);
  if (!loaded) return false;
  loadDecoded(file.name, loaded.sampleRate, loaded.channels, loaded.format);
  rememberRecent(file, 'audio');
  return true;
}

export async function openProject(file: File): Promise<boolean> {
  const project = await audio.runBusy(t('Opening {name}…', { name: file.name }), async () => parseProject(await file.text()), false);
  if (!project) return false;
  audio.stop();
  if (project.audio) {
    audio.doc.load({ sampleRate: project.audio.sampleRate, channels: project.audio.channels, markers: project.markers, transcript: project.transcript });
  } else {
    audio.doc.load({ sampleRate: project.session?.sampleRate ?? 48000, channels: [new Float32Array(0), new Float32Array(0)], markers: [], transcript: [] });
  }
  mt.load(project.session, project.sources);
  audio.projectPath = undefined;
  audio.sourceFormat = t('Ultima project');
  setUI({ docName: project.name, selection: null, cursor: 0, stats: null, tab: project.audio || !project.session?.tracks.length ? 'waveform' : 'multitrack' });
  if (project.view) audio.setView(project.view);
  else audio.zoomFit();
  rememberRecent(file, 'audio');
  return true;
}

/** Opens files from the picker, drag & drop or a handoff. */
export async function openFiles(files: File[]): Promise<void> {
  const projects = files.filter(isProjectFile);
  const media = files.filter((f) => !isProjectFile(f) && isAudioOrVideoFile(f));
  const unknown = files.filter((f) => !isProjectFile(f) && !isAudioOrVideoFile(f));
  if (unknown.length) toast.warning(t('Unsupported file type'), unknown.map((f) => f.name).join(', '));
  if (projects.length) {
    if (!(await confirmDiscard())) return;
    await openProject(projects[0]);
    return;
  }
  if (!media.length) return;
  if (ui().tab === 'multitrack') {
    await mt.importFiles(media);
    return;
  }
  if (!(await confirmDiscard())) return;
  const ok = await openAudioFile(media[0]);
  if (ok && media.length > 1) {
    await mt.importFiles(media);
    toast.info(t('{count} files were added to the Multitrack session', { count: media.length }));
  }
}

/** Speech from text: inserted at the cursor (or over the selection), or as a new multitrack clip at the playhead. */
export async function insertSpeech(file: File): Promise<void> {
  const loaded = await audio.runBusy(t('Opening {name}…', { name: file.name }), (_signal, progress) => decodeFile(file, progress), false);
  if (!loaded) return;
  if (ui().tab === 'multitrack') await mt.addAudio(t('Speech'), loaded.channels, loaded.sampleRate);
  else audio.insertAudio(loaded.channels, loaded.sampleRate, ui().cursor, t('Speech from text'), audio.selection());
}

export async function pickAndOpen(): Promise<void> {
  const files = await pickFiles({ accept: OPEN_ACCEPT, multiple: true });
  if (files.length) await openFiles(files);
}

/* ------------------------------- project save ------------------------------- */

export async function saveProject(saveAs = false): Promise<void> {
  const totalSamples =
    audio.doc.channels.reduce((s, c) => s + c.length, 0) + [...mt.sources.values()].reduce((s, src) => s + src.channels.reduce((a, c) => a + c.length, 0), 0);
  if (!totalSamples && !mt.session.tracks.length) {
    toast.info(t('Nothing to save yet'));
    return;
  }
  let encoding: ProjectEncoding = 'float';
  const floatBytes = estimateProjectBytes(totalSamples, 'float');
  if (floatBytes > 120 * 1024 * 1024) {
    const small = await confirmDialog({
      title: t('Large project'),
      message: t('Embedding the audio losslessly makes the project about {size}. Store it compressed with Opus instead (about {small}, slight quality loss)?', {
        size: formatBytes(floatBytes),
        small: formatBytes(estimateProjectBytes(totalSamples, 'opus')),
      }),
      confirmLabel: t('Compress'),
    });
    encoding = small ? 'opus' : floatBytes > 380 * 1024 * 1024 ? 'pcm16' : 'float';
    if (!small && encoding === 'pcm16') toast.info(t('The audio is stored as 16-bit WAV to keep the project file manageable.'));
  }
  const name = fileBaseName(ui().docName) || t('Untitled');
  const json = await audio.runBusy(
    t('Saving project…'),
    () =>
      buildProject(
        {
          name: ui().docName || t('Untitled'),
          audio: audio.length ? { sampleRate: audio.sampleRate, channels: audio.doc.channels } : null,
          markers: audio.doc.markers,
          transcript: audio.doc.transcript,
          session: mt.session.tracks.length ? mt.session : null,
          sources: [...mt.sources.values()],
          view: ui().view,
        },
        encoding,
      ),
    false,
  );
  if (!json) return;
  try {
    const result = await saveFile(json, {
      suggestedName: `${name}.ultima`,
      filters: [{ name: t('Ultima project'), extensions: ['ultima'] }],
      path: saveAs ? undefined : audio.projectPath,
    });
    if (!result) return;
    if (result.path) audio.projectPath = result.path;
    audio.doc.markSaved();
    mt.dirty = false;
    setUI({ savedTick: ui().savedTick + 1 });
    toast.success(t('Project saved'));
  } catch (error) {
    toast.error(t('Could not save the project'), error instanceof Error ? error.message : String(error));
  }
}

/* ---------------------------------- export ---------------------------------- */

export interface ExportRequest extends ExportOptions {
  source: 'waveform' | 'selection' | 'mix';
}

export async function exportAudio(req: ExportRequest): Promise<boolean> {
  const info = EXPORT_FORMATS.find((f) => f.id === req.format) ?? EXPORT_FORMATS[0];
  const base = fileBaseName(ui().docName) || t('Untitled');
  const encoded = await audio.runBusy(t('Exporting {format}…', { format: info.label }), async (signal, progress) => {
    let channels: Float32Array[];
    let sampleRate: number;
    if (req.source === 'mix') {
      channels = await mt.renderMix(signal, (f) => progress(f * 0.3));
      sampleRate = mt.sampleRate;
    } else {
      const sel = req.source === 'selection' ? audio.selection() : null;
      channels = sel ? copyRange(audio.doc.channels, sel.start, sel.end) : audio.doc.channels;
      sampleRate = audio.sampleRate;
    }
    if (!channels[0]?.length) throw new Error(t('There is no audio to export'));
    return encodeAudio(channels, sampleRate, req, (f) => progress(req.source === 'mix' ? 0.3 + f * 0.7 : f));
  });
  if (!encoded) return false;
  const suffix = req.source === 'selection' ? `-${t('selection')}` : req.source === 'mix' ? `-${t('mix')}` : '';
  try {
    const result = await saveFile(new Blob([encoded.bytes as BlobPart], { type: encoded.mime }), {
      suggestedName: `${base}${suffix}.${encoded.extension}`,
      filters: [{ name: info.label, extensions: [encoded.extension] }],
    });
    if (!result) return false;
    if (req.source === 'waveform') audio.doc.markSaved();
    setUI({ savedTick: ui().savedTick + 1 });
    toast.success(t('Exported {name}', { name: `${base}${suffix}.${encoded.extension}` }), formatBytes(encoded.bytes.byteLength));
    return true;
  } catch (error) {
    toast.error(t('Could not save the file'), error instanceof Error ? error.message : String(error));
    return false;
  }
}

/* --------------------------------- markers --------------------------------- */

export async function exportMarkers(kind: 'txt' | 'csv' | 'chapters'): Promise<void> {
  const sr = audio.sampleRate;
  const markers = audio.doc.markers;
  if (!markers.length) {
    toast.info(t('There are no markers yet'), t('Press M to add a marker at the cursor.'));
    return;
  }
  let text: string;
  if (kind === 'chapters') text = chaptersText(markers.map((m) => ({ time: m.pos / sr, label: m.label })), t('Intro'));
  else if (kind === 'csv') text = `Name,Start,Seconds\n${markers.map((m) => `"${m.label.replace(/"/g, '""')}",${formatTime(m.pos / sr)},${(m.pos / sr).toFixed(3)}`).join('\n')}\n`;
  else text = markers.map((m) => `${formatTime(m.pos / sr)}\t${m.label}`).join('\n') + '\n';
  const ext = kind === 'csv' ? 'csv' : 'txt';
  try {
    await saveFile(text, { suggestedName: `${fileBaseName(ui().docName) || 'markers'}-${kind === 'chapters' ? 'chapters' : 'markers'}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  } catch (error) {
    toast.error(t('Could not save the file'), error instanceof Error ? error.message : String(error));
  }
}

/* --------------------------------- mixdown --------------------------------- */

export async function mixdownToNewFile(): Promise<void> {
  if (!mt.length) {
    toast.info(t('Add clips to the session first'));
    return;
  }
  if (!(await confirmDiscard())) return;
  mt.stopIfPlaying();
  const mix = await audio.runBusy(t('Mixing down…'), (signal, progress) => mt.renderMix(signal, progress));
  if (!mix) return;
  loadDecoded(`${t('Mixdown')}.wav`, mt.sampleRate, mix, t('Multitrack mixdown'));
  audio.doc.markUnsaved();
  toast.success(t('Mixdown ready'), t('The mix was opened in the Waveform editor.'));
}
