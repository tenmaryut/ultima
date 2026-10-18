import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Flag, Sparkles, Wand2 } from 'lucide-react';
import type { CaptionCue, Project, TimeRange } from '../types';
import { useT } from '../../../core/i18n';
import { Button, Field, Modal, ProgressBar, Select, Slider, Spinner, TextArea, TextInput, Toggle, toast } from '../../../components/ui';
import { describeAIError } from '../../../core/ai/client';
import { useAISettings } from '../../../core/ai/settings';
import { desktop } from '../../../core/platform';
import type { MediaLibrary } from '../media';
import { analyseAudio, FeatureError, roughCutSuggestions, transcribeTimeline, writeVideoMeta } from '../features';
import { DEFAULT_SILENCE, detectSilences, totalLength } from '../silence';
import { formatChapters, type VideoMeta } from '../aiActions';
import { captionCues, timelineDuration } from '../model';
import { formatTimecode, mergeRanges } from '../time';

export function rangeOf(p: Project, kind: 'all' | 'work'): TimeRange {
  return kind === 'work' && p.workArea ? p.workArea : { start: 0, end: timelineDuration(p) };
}

export function RangeField({ project, value, onChange }: { project: Project; value: 'all' | 'work'; onChange: (v: 'all' | 'work') => void }) {
  const t = useT();
  return (
    <Field label={t('Range')}>
      <Select<string>
        value={value}
        onChange={(v) => onChange(v as 'all' | 'work')}
        options={[
          { value: 'all', label: t('Entire timeline') },
          { value: 'work', label: project.workArea ? t('Work area') : t('Work area (not set)'), disabled: !project.workArea },
        ]}
      />
    </Field>
  );
}

async function copy(text: string, t: (k: string) => string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('Copied to clipboard'));
  } catch {
    toast.error(t('Could not copy'));
  }
}

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
  ['hi', 'Hindi'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
] as const;

/* ------------------------------- Auto captions ------------------------------ */

export function AutoCaptionsDialog({
  project,
  lib,
  onDone,
  onClose,
}: {
  project: Project;
  lib: MediaLibrary;
  onDone: (cues: CaptionCue[], replace: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const tools = useAISettings((s) => s.tools);
  const whisper = tools.find((x) => x.id === 'whisper');
  const [language, setLanguage] = useState('');
  const [model, setModel] = useState('');
  const [rangeKind, setRangeKind] = useState<'all' | 'work'>(project.workArea ? 'work' : 'all');
  const [maxChars, setMaxChars] = useState(64);
  const [replace, setReplace] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError('');
    setProgress(0);
    try {
      const cues = await transcribeTimeline(project, lib, rangeOf(project, rangeKind), { language, model, maxChars }, (s, f) => {
        setStage(s === 'mix' ? t('Mixing the timeline audio…') : t('Recognising speech with Whisper… (this can take a few minutes)'));
        setProgress(f);
      }, ctrl.signal);
      onDone(cues, replace);
      toast.success(t('Added {count} captions', { count: cues.length }));
      onClose();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setError(e instanceof FeatureError || e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const busy = progress !== null;
  return (
    <Modal
      title={t('Auto captions')}
      onClose={() => (busy ? abortRef.current?.abort() : onClose())}
      footer={
        busy ? (
          <Button onClick={() => abortRef.current?.abort()}>{t('Cancel')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('Close')}</Button>
            <Button variant="primary" icon={Sparkles} disabled={!desktop} onClick={start}>
              {t('Generate captions')}
            </Button>
          </>
        )
      }
    >
      {!desktop ? (
        <div className="vd-note warn">
          {t('Auto captions run privately on your own computer with Whisper (free speech-to-text). They need the Ultima desktop app — the browser version cannot start local programs. You can still import SRT/VTT files or type captions by hand.')}
        </div>
      ) : (
        <>
          <div className="vd-hint">{t('The timeline audio is mixed, sent to Whisper on this computer, and turned into editable caption clips. Nothing is uploaded.')}</div>
          {whisper && !whisper.available && (
            <div className="vd-note warn">{t('Whisper was not found. Install it with “pip install -U openai-whisper” (or set its path in Settings → Local creative tools), then try again.')}</div>
          )}
          <div className="vd-dialog-grid">
            <Field label={t('Language')}>
              <Select<string> value={language} onChange={setLanguage} options={LANGUAGES.map(([v, l]) => ({ value: v, label: t(l) }))} />
            </Field>
            <Field label={t('Model')}>
              <Select<string>
                value={model}
                onChange={setModel}
                options={[
                  { value: '', label: t('Default (base)') },
                  { value: 'tiny', label: t('tiny (fastest)') },
                  { value: 'small', label: 'small' },
                  { value: 'medium', label: t('medium (more accurate)') },
                  { value: 'large', label: t('large (best, slow)') },
                ]}
              />
            </Field>
            <RangeField project={project} value={rangeKind} onChange={setRangeKind} />
            <Field label={t('Max characters per caption')}>
              <Select<number> value={maxChars} onChange={setMaxChars} options={[32, 42, 64, 84, 120].map((n) => ({ value: n, label: String(n) }))} />
            </Field>
          </div>
          <Toggle checked={replace} onChange={setReplace} label={t('Replace existing captions on the caption track')} />
        </>
      )}
      {busy && (
        <div className="col" style={{ gap: 6 }}>
          <div className="row">
            <Spinner size={14} />
            <span>{stage}</span>
          </div>
          <ProgressBar value={progress ?? 0} />
        </div>
      )}
      {error && <div className="vd-note err">{error}</div>}
    </Modal>
  );
}

/* ------------------------------ Remove silences ----------------------------- */

export function SilenceDialog({
  project,
  lib,
  onPreview,
  onApply,
  onClose,
}: {
  project: Project;
  lib: MediaLibrary;
  onPreview: (ranges: TimeRange[] | null) => void;
  onApply: (ranges: TimeRange[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [rangeKind, setRangeKind] = useState<'all' | 'work'>(project.workArea ? 'work' : 'all');
  const [analysis, setAnalysis] = useState<{ samples: Float32Array; sampleRate: number; offset: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState(DEFAULT_SILENCE.thresholdDb);
  const [minDuration, setMinDuration] = useState(DEFAULT_SILENCE.minDuration);
  const [padding, setPadding] = useState(DEFAULT_SILENCE.padding);
  const abortRef = useRef<AbortController | null>(null);

  const analyse = async (kind: 'all' | 'work') => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError('');
    setAnalysis(null);
    setProgress(0);
    const range = rangeOf(project, kind);
    try {
      const r = await analyseAudio(project, lib, range, setProgress, ctrl.signal);
      if (!ctrl.signal.aborted) setAnalysis({ ...r, offset: range.start });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctrl) {
        setProgress(null);
        abortRef.current = null;
      }
    }
  };

  useEffect(() => {
    void analyse(rangeKind);
    return () => abortRef.current?.abort();
  }, [rangeKind]); // re-analyse when the range changes

  const ranges = useMemo(
    () => (analysis ? detectSilences(analysis.samples, analysis.sampleRate, { thresholdDb: threshold, minDuration, padding }, analysis.offset) : []),
    [analysis, threshold, minDuration, padding],
  );

  useEffect(() => {
    onPreview(ranges.length ? ranges : null);
  }, [ranges, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const fps = project.settings.fps;
  return (
    <Modal
      title={t('Remove silences')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            icon={Wand2}
            disabled={!ranges.length}
            onClick={() => {
              onApply(ranges);
              onClose();
            }}
          >
            {t('Cut {count} silence(s)', { count: ranges.length })}
          </Button>
        </>
      }
    >
      <div className="vd-hint">{t('Finds quiet parts of the mixed audio and cuts them out of every unlocked track (a ripple delete). The red areas on the timeline show what will be removed.')}</div>
      <RangeField project={project} value={rangeKind} onChange={setRangeKind} />
      {progress !== null && (
        <div className="col" style={{ gap: 6 }}>
          <span>{t('Analysing audio…')}</span>
          <ProgressBar value={progress} />
        </div>
      )}
      {error && <div className="vd-note err">{error}</div>}
      {analysis && (
        <>
          <Slider label={t('Silence threshold')} value={threshold} min={-70} max={-15} onChange={setThreshold} format={(v) => `${v} dB`} defaultValue={DEFAULT_SILENCE.thresholdDb} />
          <Slider label={t('Minimum silence length')} value={minDuration} min={0.2} max={3} step={0.05} onChange={setMinDuration} format={(v) => `${v.toFixed(2)} s`} defaultValue={DEFAULT_SILENCE.minDuration} />
          <Slider label={t('Keep around speech')} value={padding} min={0} max={0.5} step={0.01} onChange={setPadding} format={(v) => `${v.toFixed(2)} s`} defaultValue={DEFAULT_SILENCE.padding} />
          <div className="row">
            <strong style={{ color: 'var(--text-0)' }}>{t('{count} silence(s)', { count: ranges.length })}</strong>
            <span className="muted">{t('{seconds} s will be removed', { seconds: totalLength(ranges).toFixed(1) })}</span>
          </div>
          {ranges.length > 0 && (
            <div className="vd-range-list">
              {ranges.slice(0, 500).map((r, i) => (
                <div key={i}>
                  <span>{formatTimecode(r.start, fps)}</span>
                  <span>→ {formatTimecode(r.end, fps)}</span>
                  <span className="faint">{(r.end - r.start).toFixed(2)} s</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* --------------------------- Titles, description, chapters --------------------------- */

export function MetaDialog({ project, onAddMarkers, onClose }: { project: Project; onAddMarkers: (chapters: { time: number; title: string }[]) => void; onClose: () => void }) {
  const t = useT();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const hasTranscript = captionCues(project, true).length > 0;

  const generate = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    try {
      setMeta(await writeVideoMeta(project, notes, ctrl.signal));
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(e instanceof FeatureError ? e.message : describeAIError(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const chapters = meta ? formatChapters(meta.chapters) : '';
  return (
    <Modal
      title={t('Write titles & description')}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Close')}</Button>
          {busy ? (
            <Button onClick={() => abortRef.current?.abort()}>{t('Stop')}</Button>
          ) : (
            <Button variant="primary" icon={Sparkles} onClick={generate}>
              {meta ? t('Try again') : t('Generate')}
            </Button>
          )}
        </>
      }
    >
      <div className="vd-hint">
        {hasTranscript
          ? t('Uses your captions as the transcript to suggest YouTube titles, a description, chapters and tags.')
          : t('No captions found — the AI will work from clip names and markers. Run Auto captions first for much better results.')}
      </div>
      <Field label={t('Notes for the AI (optional)')}>
        <TextInput value={notes} placeholder={t('e.g. channel name, audience, tone, links to include')} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {busy && (
        <div className="row">
          <Spinner size={14} /> {t('Writing…')}
        </div>
      )}
      {error && <div className="vd-note err">{error}</div>}
      {meta && (
        <div className="col" style={{ gap: 10 }}>
          <div className="vd-section-title">{t('Title ideas')}</div>
          {meta.titles.map((title) => (
            <div key={title} className="row">
              <span className="grow selectable" style={{ color: 'var(--text-0)' }}>
                {title}
              </span>
              <Button size="sm" icon={Copy} onClick={() => copy(title, t)}>
                {t('Copy')}
              </Button>
            </div>
          ))}
          <div className="vd-section-title">{t('Description')}</div>
          <div className="vd-copy-block">
            <TextArea rows={7} value={meta.description + (chapters ? `\n\n${chapters}` : '')} readOnly />
            <Button size="sm" icon={Copy} onClick={() => copy(meta.description + (chapters ? `\n\n${chapters}` : ''), t)}>
              {t('Copy')}
            </Button>
          </div>
          {meta.chapters.length > 0 && (
            <div className="row">
              <span className="grow faint">{t('{count} chapters', { count: meta.chapters.length })}</span>
              <Button size="sm" icon={Flag} onClick={() => onAddMarkers(meta.chapters)}>
                {t('Add chapters as markers')}
              </Button>
            </div>
          )}
          {meta.tags.length > 0 && (
            <div className="row">
              <span className="grow faint selectable">{meta.tags.join(', ')}</span>
              <Button size="sm" icon={Copy} onClick={() => copy(meta.tags.join(', '), t)}>
                {t('Copy tags')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Rough cut from transcript ------------------------------ */

export function RoughCutDialog({
  project,
  onPreview,
  onApply,
  onClose,
}: {
  project: Project;
  onPreview: (ranges: TimeRange[] | null) => void;
  onApply: (ranges: TimeRange[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const cues = useMemo(() => captionCues(project, true), [project]);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState<Set<number> | null>(null);
  const [reason, setReason] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const ranges = useMemo(() => (removed ? mergeRanges(cues.filter((_, i) => removed.has(i)), 0.25) : []), [removed, cues]);
  useEffect(() => {
    onPreview(ranges.length ? ranges : null);
  }, [ranges, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const generate = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    try {
      const r = await roughCutSuggestions(cues, goal, ctrl.signal);
      setRemoved(new Set(r.remove));
      setReason(r.reason);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(e instanceof FeatureError ? e.message : describeAIError(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const fps = project.settings.fps;
  return (
    <Modal
      title={t('Rough cut from transcript')}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          {busy ? (
            <Button onClick={() => abortRef.current?.abort()}>{t('Stop')}</Button>
          ) : (
            <Button icon={Sparkles} onClick={generate} disabled={!cues.length}>
              {removed ? t('Ask again') : t('Suggest cuts')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!ranges.length}
            onClick={() => {
              onApply(ranges);
              onClose();
            }}
          >
            {t('Apply {count} cut(s)', { count: ranges.length })}
          </Button>
        </>
      }
    >
      {!cues.length ? (
        <div className="vd-note warn">{t('Add captions first (Auto captions or import an SRT file) — the rough cut works from the transcript.')}</div>
      ) : (
        <>
          <Field label={t('What should the edit achieve? (optional)')}>
            <TextInput value={goal} placeholder={t('e.g. keep it under 60 seconds, remove ums and repeated takes')} onChange={(e) => setGoal(e.target.value)} />
          </Field>
          {busy && (
            <div className="row">
              <Spinner size={14} /> {t('The AI is reading the transcript…')}
            </div>
          )}
          {error && <div className="vd-note err">{error}</div>}
          {reason && <div className="vd-note">{reason}</div>}
          <div className="vd-hint">{t('Click a line to keep or cut it. Cut lines are removed from every unlocked track and the gaps are closed.')}</div>
          <div className="vd-range-list" style={{ maxHeight: 300 }}>
            {cues.map((c, i) => (
              <div
                key={i}
                className={removed?.has(i) ? 'cut' : ''}
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  setRemoved((prev) => {
                    const next = new Set(prev ?? []);
                    next.has(i) ? next.delete(i) : next.add(i);
                    return next;
                  })
                }
              >
                <span>{formatTimecode(c.start, fps)}</span>
                <span style={{ fontFamily: 'var(--font)' }}>{c.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
