import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import type { Project, TimeRange } from '../types';
import { useT } from '../../../core/i18n';
import { Button, Field, Modal, NumberField, ProgressBar, Select, Toggle, toast } from '../../../components/ui';
import { canvasToBlob } from '../../../core/utils/image';
import { desktop, saveFile } from '../../../core/platform';
import { ExportFolderSettings, showExport, useExportFolder } from '../../../components/ExportFolder';
import { useAISettings } from '../../../core/ai/settings';
import type { MediaLibrary } from '../media';
import type { TimeStore } from '../timeStore';
import { captionClips, timelineDuration } from '../model';
import { hasAudioIn } from '../mix';
import { formatTimecode } from '../time';
import {
  chooseCodecs,
  exportVideoFile,
  exportWavFile,
  exportWithFfmpeg,
  ffmpegReady,
  renderGif,
  renderStill,
  type CodecChoice,
  type CodecNote,
  type QualityLevel,
} from '../exporter';
import { SOCIAL_AUDIO_BITRATE, SOCIAL_FPS, defaultSocialFps, socialPlan, type SocialFps } from '../social';

export type ExportKind = 'social' | 'mp4' | 'webm' | 'ffmpeg' | 'gif' | 'wav' | 'png';

interface ExportDialogProps {
  project: Project;
  lib: MediaLibrary;
  time: TimeStore;
  initialKind?: ExportKind;
  initialRange?: 'all' | 'work';
  /** Start right away (the AI asked for the export): it goes into the export folder unless the user wants to be asked. */
  autoStart?: boolean;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}

const SIZES = ['project', '2160', '1440', '1080', '720', '480', '360'] as const;
type SizeId = (typeof SIZES)[number];

function outputSize(W: number, H: number, id: SizeId): { width: number; height: number } {
  if (id === 'project') return { width: W, height: H };
  const k = parseInt(id, 10) / Math.min(W, H);
  return { width: Math.max(16, Math.round((W * k) / 2) * 2), height: Math.max(16, Math.round((H * k) / 2) * 2) };
}

/** Frame rates offered for video exports: the project's plus the common ones. */
function frameRates(projectFps: number): number[] {
  return [...new Set([projectFps, 24, 25, 30, 50, 60])].sort((a, b) => a - b);
}

export function ExportDialog({ project, lib, time, initialKind = 'mp4', initialRange, autoStart, onClose, onBusy }: ExportDialogProps) {
  const t = useT();
  const tools = useAISettings((s) => s.tools);
  const { width: W, height: H, fps } = project.settings;
  const total = timelineDuration(project);
  const [kind, setKind] = useState<ExportKind>(initialKind);
  const [size, setSize] = useState<SizeId>('project');
  const [quality, setQuality] = useState<QualityLevel>('high');
  const [useBitrate, setUseBitrate] = useState(false);
  const [mbps, setMbps] = useState(12);
  const [audio, setAudio] = useState(true);
  const [audioKbps, setAudioKbps] = useState(192);
  const [rangeKind, setRangeKind] = useState<'all' | 'work'>(initialRange === 'all' || !project.workArea ? 'all' : 'work');
  const [burn, setBurn] = useState(captionClips(project).length > 0);
  const [container, setContainer] = useState<'mp4' | 'mov'>('mp4');
  const [exportFps, setExportFps] = useState(fps);
  const [socialFps, setSocialFps] = useState<SocialFps>(defaultSocialFps(fps));
  const [gifWidth, setGifWidth] = useState(480);
  const [gifFps, setGifFps] = useState(12);
  const [codecs, setCodecs] = useState<CodecChoice | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const started = useRef(false);
  const [folder, setFolder] = useExportFolder();
  const out = outputSize(W, H, size);
  const range: TimeRange = rangeKind === 'work' && project.workArea ? project.workArea : { start: 0, end: total };
  const length = Math.max(0, range.end - range.start);
  const offline = useMemo(() => project.clips.filter((c) => c.mediaId && !lib.has(c.mediaId)).length, [project, lib]);
  const hasCaptions = captionClips(project).length > 0;
  const canFfmpeg = ffmpegReady(tools);
  const busy = progress !== null;
  const social = kind === 'social';
  const audible = audio && hasAudioIn(project, range);
  const plan = socialPlan(W, H, socialFps, length, audible);
  const encode = social ? { width: plan.width, height: plan.height, fps: plan.fps } : { ...out, fps: exportFps };
  // TikTok & co. expect H.264 + AAC: browsers' encoders when they have AAC, else FFmpeg, else Opus audio.
  const socialRoute: 'webcodecs' | 'ffmpeg' | 'fallback' | 'blocked' | null =
    !social || !codecs
      ? null
      : codecs.video && (codecs.audio === 'aac' || !audible)
        ? 'webcodecs'
        : canFfmpeg
          ? 'ffmpeg'
          : codecs.video
            ? 'fallback'
            : 'blocked';

  useEffect(() => {
    if (kind !== 'mp4' && kind !== 'webm' && kind !== 'social') return;
    let alive = true;
    setCodecs(null);
    void chooseCodecs(kind === 'webm' ? 'webm' : 'mp4', encode.width, encode.height, encode.fps).then((c) => alive && setCodecs(c));
    return () => {
      alive = false;
    };
  }, [kind, encode.width, encode.height, encode.fps]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const noteText = (n: CodecNote) =>
    ({
      'no-h264': t('This system cannot encode H.264 video. Choose WebM, or (desktop app) “MP4/MOV via FFmpeg” for maximum compatibility.'),
      'no-video-encoder': t('No WebM video encoder (VP9/VP8) is available on this system.'),
      'opus-in-mp4': t('The AAC encoder is not available here, so the audio will be Opus inside the MP4 (plays in browsers and VLC). Use “MP4/MOV via FFmpeg” for QuickTime and older devices.'),
      'no-audio-encoder': t('No audio encoder is available — the video will be silent.'),
    })[n];

  const run = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress(0);
    onBusy(true);
    const base = project.name.replace(/[\\/:*?"<>|]+/g, '_') || 'video';
    const settings = {
      format: kind === 'webm' ? ('webm' as const) : ('mp4' as const),
      width: out.width,
      height: out.height,
      fps: exportFps,
      quality,
      videoBitrate: useBitrate ? Math.round(mbps * 1_000_000) : null,
      audio: audio && hasAudioIn(project, range),
      audioBitrate: audioKbps * 1000,
      range,
      burnCaptions: burn,
    };
    try {
      let result: { path?: string } | null = null;
      if (kind === 'social') {
        const upload = {
          ...settings,
          format: 'mp4' as const,
          width: plan.width,
          height: plan.height,
          fps: plan.fps,
          quality: 'very-high' as const,
          videoBitrate: plan.videoBitrate,
          audioBitrate: SOCIAL_AUDIO_BITRATE,
        };
        const name = `${base}-${plan.width}x${plan.height}-${plan.fps}fps`;
        setStage(t('Rendering video…'));
        if (socialRoute === 'ffmpeg') {
          result = await exportWithFfmpeg(project, lib, upload, 'mp4', name, (f, s) => {
            setProgress(f);
            setStage(s === 'render' ? t('Rendering video…') : t('Converting with FFmpeg…'));
          }, ctrl.signal, 'social');
        } else {
          if (!codecs?.video) throw new Error(t('No video encoder available'));
          result = await exportVideoFile(project, lib, upload, codecs, name, setProgress, ctrl.signal);
        }
      } else if (kind === 'mp4' || kind === 'webm') {
        if (!codecs?.video) throw new Error(t('No video encoder available'));
        setStage(t('Rendering video…'));
        result = await exportVideoFile(project, lib, settings, codecs, base, setProgress, ctrl.signal);
      } else if (kind === 'ffmpeg') {
        setStage(t('Rendering video…'));
        result = await exportWithFfmpeg(project, lib, settings, container, base, (f, s) => {
          setProgress(f);
          setStage(s === 'render' ? t('Rendering video…') : t('Converting with FFmpeg…'));
        }, ctrl.signal);
      } else if (kind === 'gif') {
        setStage(t('Rendering GIF…'));
        const bytes = await renderGif(project, lib, { range, width: gifWidth, fps: gifFps, burnCaptions: burn }, setProgress, ctrl.signal);
        result = await saveFile(bytes, { suggestedName: `${base}.gif`, filters: [{ name: 'GIF', extensions: ['gif'] }], toExportFolder: true });
      } else if (kind === 'wav') {
        setStage(t('Mixing audio…'));
        result = await exportWavFile(project, lib, range, base, setProgress, ctrl.signal);
      } else {
        setStage(t('Rendering frame…'));
        const canvas = await renderStill(project, lib, time.get(), out.width / W);
        const blob = await canvasToBlob(canvas, 'image/png');
        result = await saveFile(blob, { suggestedName: `${base}-${formatTimecode(time.get(), fps).replace(/:/g, '-')}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }], toExportFolder: true });
      }
      if (result) {
        const path = result.path;
        toast.success(t('Export finished'), path, path && desktop ? { label: t('Show in folder'), run: () => showExport(path) } : undefined);
        onClose();
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') toast.info(t('Export cancelled'));
      else toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
    } finally {
      abortRef.current = null;
      setProgress(null);
      onBusy(false);
    }
  };

  const formats: { id: ExportKind; title: string; sub: string; disabled?: boolean; wide?: boolean }[] = [
    { id: 'social', title: 'TikTok · Reels · Shorts', sub: t('Upload-ready MP4: 1080 px, 30 or 60 fps, high bitrate'), wide: true },
    { id: 'mp4', title: 'MP4', sub: t('H.264 + AAC') },
    { id: 'webm', title: 'WebM', sub: t('VP9 + Opus') },
    { id: 'ffmpeg', title: t('MP4/MOV via FFmpeg'), sub: canFfmpeg ? t('Most compatible') : t('Desktop app + FFmpeg'), disabled: !canFfmpeg },
    { id: 'gif', title: 'GIF', sub: t('Short animation') },
    { id: 'wav', title: 'WAV', sub: t('Audio only') },
    { id: 'png', title: 'PNG', sub: t('Current frame') },
  ];
  const videoLike = kind === 'mp4' || kind === 'webm' || kind === 'ffmpeg';
  const blocked = ((kind === 'mp4' || kind === 'webm') && (!codecs || !codecs.video)) || (social && (!socialRoute || socialRoute === 'blocked'));
  const gifTooLong = kind === 'gif' && length > 60;
  const nothing = kind !== 'png' && length <= 0;
  const silent = kind === 'wav' && !hasAudioIn(project, range);
  // waits for the encoder check (and the export folder) before an automatic start
  const ready = !blocked && !nothing && !gifTooLong && !silent && (!desktop || folder !== null) && (kind === 'mp4' || kind === 'webm' || social ? codecs !== null : true);

  useEffect(() => {
    if (!autoStart || started.current || busy || !ready) return;
    started.current = true;
    void run();
  });

  return (
    <Modal
      title={t('Export')}
      wide
      onClose={() => (busy ? abortRef.current?.abort() : onClose())}
      footer={
        busy ? (
          <Button variant="danger" onClick={() => abortRef.current?.abort()}>
            {t('Cancel export')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Close')}</Button>
            <Button variant="primary" icon={Download} disabled={blocked || nothing || gifTooLong || silent} onClick={run}>
              {t('Export')}
            </Button>
          </>
        )
      }
    >
      <div className="vd-format-list">
        {formats.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`vd-format ${kind === f.id ? 'active' : ''} ${f.wide ? 'wide' : ''}`}
            disabled={busy || f.disabled}
            onClick={() => setKind(f.id)}
            title={f.disabled ? t('Needs the desktop app with FFmpeg installed') : undefined}
          >
            {f.wide && <Smartphone size={18} />}
            <span className="col" style={{ gap: 2 }}>
              <strong>{f.title}</strong>
              <span>{f.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {busy ? (
        <div className="col" style={{ gap: 8, padding: '12px 0' }}>
          <div className="row">
            <span className="grow">{stage}</span>
            <span className="mono">{Math.round((progress ?? 0) * 100)}%</span>
          </div>
          <ProgressBar value={progress ?? 0} />
          <div className="vd-hint">{t('Rendering is frame-accurate and may take a while for long timelines. Keep Ultima open.')}</div>
        </div>
      ) : (
        <>
          <div className="vd-dialog-grid">
            {kind !== 'png' && (
              <Field label={t('Range')}>
                <Select<string>
                  value={rangeKind}
                  onChange={(v) => setRangeKind(v as 'all' | 'work')}
                  options={[
                    { value: 'all', label: `${t('Entire timeline')} (${formatTimecode(total, fps)})` },
                    { value: 'work', label: project.workArea ? `${t('Work area')} (${formatTimecode(project.workArea.end - project.workArea.start, fps)})` : t('Work area (not set)'), disabled: !project.workArea },
                  ]}
                />
              </Field>
            )}
            {social && (
              <Field label={t('Frame rate')}>
                <Select<number> value={socialFps} onChange={(v) => setSocialFps(v as SocialFps)} options={SOCIAL_FPS.map((f) => ({ value: f, label: `${f} fps` }))} />
              </Field>
            )}
            {videoLike && (
              <Field label={t('Frame rate')}>
                <Select<number>
                  value={exportFps}
                  onChange={setExportFps}
                  options={frameRates(fps).map((f) => ({ value: f, label: f === fps ? `${f} fps (${t('Project')})` : `${f} fps` }))}
                />
              </Field>
            )}
            {(videoLike || kind === 'png') && (
              <Field label={t('Resolution')}>
                <Select<string>
                  value={size}
                  onChange={(v) => setSize(v as SizeId)}
                  options={SIZES.map((id) => {
                    const o = outputSize(W, H, id);
                    return { value: id, label: id === 'project' ? `${t('Project')} (${W}×${H})` : `${id}p (${o.width}×${o.height})` };
                  })}
                />
              </Field>
            )}
            {videoLike && (
              <Field label={t('Quality')}>
                <Select<string>
                  value={useBitrate ? 'bitrate' : quality}
                  onChange={(v) => {
                    if (v === 'bitrate') setUseBitrate(true);
                    else {
                      setUseBitrate(false);
                      setQuality(v as QualityLevel);
                    }
                  }}
                  options={[
                    { value: 'low', label: t('Low (small file)') },
                    { value: 'medium', label: t('Medium') },
                    { value: 'high', label: t('High') },
                    { value: 'very-high', label: t('Very high') },
                    { value: 'bitrate', label: t('Custom bitrate…'), disabled: kind === 'ffmpeg' },
                  ]}
                />
              </Field>
            )}
            {videoLike && useBitrate && kind !== 'ffmpeg' && (
              <Field label={t('Video bitrate')}>
                <NumberField value={mbps} min={0.5} max={200} step={0.5} suffix="Mbps" onChange={setMbps} />
              </Field>
            )}
            {kind === 'ffmpeg' && (
              <Field label={t('Container')}>
                <Select<string> value={container} onChange={(v) => setContainer(v as 'mp4' | 'mov')} options={[{ value: 'mp4', label: 'MP4 (H.264/AAC)' }, { value: 'mov', label: 'MOV (H.264/AAC)' }]} />
              </Field>
            )}
            {videoLike && (
              <Field label={t('Audio')}>
                <div className="row">
                  <Toggle checked={audio} onChange={setAudio} />
                  <Select<number> small value={audioKbps} onChange={setAudioKbps} disabled={!audio} options={[96, 128, 160, 192, 256, 320].map((k) => ({ value: k, label: `${k} kbps` }))} />
                </div>
              </Field>
            )}
            {social && (
              <Field label={t('Audio')}>
                <Toggle checked={audio} onChange={setAudio} label={t('AAC 320 kbps')} />
              </Field>
            )}
            {kind === 'gif' && (
              <>
                <Field label={t('Width')}>
                  <Select<number> value={gifWidth} onChange={setGifWidth} options={[240, 320, 480, 640, 800].map((w) => ({ value: w, label: `${w} px` }))} />
                </Field>
                <Field label={t('Frame rate')}>
                  <Select<number> value={gifFps} onChange={setGifFps} options={[8, 10, 12, 15, 20, 25].map((f) => ({ value: f, label: `${f} fps` }))} />
                </Field>
              </>
            )}
            {(videoLike || social || kind === 'gif') && hasCaptions && (
              <Field label={t('Captions')}>
                <Toggle checked={burn} onChange={setBurn} label={t('Burn captions into the picture')} />
              </Field>
            )}
          </div>
          <ExportFolderSettings compact info={folder} onChange={setFolder} />
          {social && <SocialNotes plan={plan} projectFps={fps} route={socialRoute} />}
          {(kind === 'mp4' || kind === 'webm' || social) && !codecs && <div className="vd-hint">{t('Checking which encoders this system supports…')}</div>}
          {(kind === 'mp4' || kind === 'webm' || (social && socialRoute === 'fallback')) && codecs?.notes.map((n) => (
            <div key={n} className={`vd-note ${n.startsWith('no-') ? 'err' : 'warn'}`}>
              {noteText(n)}
            </div>
          ))}
          {kind === 'ffmpeg' && <div className="vd-note">{t('Ultima renders a high-quality WebM first, then your FFmpeg converts it to H.264/AAC. The intermediate file is kept in memory.')}</div>}
          {kind === 'png' && <div className="vd-note">{t('Saves the frame at the playhead ({time}).', { time: formatTimecode(time.get(), fps) })}</div>}
          {gifTooLong && <div className="vd-note warn">{t('GIFs are limited to 60 seconds. Set a shorter work area (I / O keys) and export the work area.')}</div>}
          {silent && <div className="vd-note warn">{t('There is no audible audio in this range.')}</div>}
          {nothing && <div className="vd-note warn">{t('The timeline is empty.')}</div>}
          {offline > 0 && <div className="vd-note warn">{t('{count} clip(s) use missing media and will render empty. Relink them first for a complete export.', { count: offline })}</div>}
          {kind !== 'png' && length > 0 && (
            <div className="vd-hint">
              {t('Output')}:{' '}
              {kind === 'wav'
                ? 'WAV 48 kHz 16-bit'
                : kind === 'gif'
                  ? `${gifWidth} px, ${gifFps} fps`
                  : social
                    ? `MP4 ${plan.width}×${plan.height}, ${plan.fps} fps, H.264 ${plan.videoBitrate / 1_000_000} Mbps${audible ? ', AAC 320 kbps' : ''}`
                    : `${out.width}×${out.height}, ${exportFps} fps`}{' '}
              · {formatTimecode(length, fps)}
              {social ? ` · ~${Math.max(1, Math.round(plan.megabytes))} MB` : ''}
              {videoLike && useBitrate && kind !== 'ffmpeg' ? ` · ~${Math.round((mbps * length) / 8 + (audioKbps * length) / 8000)} MB` : ''}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/** What TikTok & co. do with uploads, and how to lose as little as possible. */
function SocialNotes({ plan, projectFps, route }: { plan: ReturnType<typeof socialPlan>; projectFps: number; route: 'webcodecs' | 'ffmpeg' | 'fallback' | 'blocked' | null }) {
  const t = useT();
  return (
    <>
      <div className="vd-note">
        {t('TikTok, Instagram and YouTube re-encode every upload — no app or file can switch that off. This export hands them the cleanest source at the exact size they show, so their compression takes away as little as possible.')}
      </div>
      {!plan.vertical && (
        <div className="vd-note warn">
          {t('This project is {size}. TikTok, Reels and Shorts fill the screen with 9:16 video: set Project settings → Resolution to Vertical 9:16 (1080×1920).', { size: `${plan.width}×${plan.height}` })}
        </div>
      )}
      {plan.fps === 60 && projectFps < 50 && (
        <div className="vd-hint">
          {t('Your project runs at {fps} fps. Titles, transitions and motion get all 60 frames, but clips recorded at 30 fps stay at 30. For 60 fps footage, set the project to 60 fps too.', { fps: projectFps })}
        </div>
      )}
      {route === 'ffmpeg' && <div className="vd-hint">{t('This system has no AAC encoder, so FFmpeg writes the final MP4 (H.264 + AAC).')}</div>}
      {route === 'fallback' && (
        <div className="vd-note warn">{t('No AAC encoder here and FFmpeg is not installed, so the audio will be Opus. Install FFmpeg (Settings → Local creative tools) for AAC, which every app accepts.')}</div>
      )}
      {route === 'blocked' && <div className="vd-note err">{t('This system cannot encode H.264 video. Install FFmpeg (Settings → Local creative tools) to export for TikTok, Reels and Shorts.')}</div>}
      {plan.megabytes > 250 && <div className="vd-hint">{t('About {mb} MB. If the phone app refuses a file this big, upload it from a computer at tiktok.com.', { mb: Math.round(plan.megabytes) })}</div>}
      <div className="vd-tips">
        <strong>{t('When you upload')}</strong>
        <ul>
          <li>{t('In TikTok, turn on “Allow high-quality uploads” (More options) before you post.')}</li>
          <li>{t('Upload over Wi-Fi with Data Saver off.')}</li>
          <li>{t('Finish text, music and effects here: edits made inside the app are rendered again there.')}</li>
          <li>{t('Upload this file as it is — sending it through a chat app first compresses it again.')}</li>
        </ul>
      </div>
    </>
  );
}
