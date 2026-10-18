import { useEffect, useMemo, useState } from 'react';
import { AudioWaveform } from 'lucide-react';
import type { Project } from '../types';
import { useT } from '../../../core/i18n';
import { Button, Field, Modal, Select, Slider, Spinner } from '../../../components/ui';
import { BEAT_EFFECTS, BEAT_SOURCES, beatTimes, type AnalysisOf, type BeatEffect, type BeatProblem, type BeatSource, type BeatSyncOptions } from '../beatsync';
import { getClip } from '../model';
import { RangeField, rangeOf } from './AIDialogs';

/* Beat effects: a shake, zoom, flash… on every beat, bar, hit or loud moment of the sound on the timeline. */

const PROBLEMS: Record<BeatProblem, string> = {
  source: 'The sound of this clip is not analysed yet.',
  noBeat: 'No music on the timeline has a steady beat. Try “Strongest hits” or “Loud moments”.',
  noSound: 'No clip with sound on the timeline is analysed yet. Add music or a clip with sound.',
  none: 'Nothing found in this range.',
};

export function BeatDialog({
  project,
  selection,
  analysis,
  waitForAnalysis,
  onApply,
  onClose,
}: {
  project: Project;
  selection: string[];
  analysis: AnalysisOf;
  /** Resolves when the sound on the timeline is analysed (or after a while). */
  waitForAnalysis: () => Promise<void>;
  onApply: (o: BeatSyncOptions) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [effect, setEffect] = useState<BeatEffect>('impact');
  const [on, setOn] = useState<BeatSource>('beats');
  const [every, setEvery] = useState(1);
  const [amount, setAmount] = useState(100);
  const [rangeKind, setRangeKind] = useState<'all' | 'work'>(project.workArea ? 'work' : 'all');
  const [source, setSource] = useState('auto');
  const visualSelected = selection.filter((id) => getClip(project, id)?.visual);
  const [target, setTarget] = useState<'layer' | 'selected'>('layer');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void waitForAnalysis().finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [waitForAnalysis]);

  const sounds = project.clips.filter((c) => (c.kind === 'audio' && !(c.linkId && project.clips.some((o) => o.linkId === c.linkId && o.kind === 'video'))) || (c.kind === 'video' && c.mediaId));
  const range = rangeOf(project, rangeKind);
  const options: BeatSyncOptions = {
    effect,
    on,
    every,
    amount: amount / 100,
    from: range.start,
    to: range.end,
    sourceClipId: source === 'auto' ? undefined : source,
    targetClipIds: target === 'selected' && visualSelected.length ? visualSelected : undefined,
  };
  // the times only depend on the sound, the range and how often
  const found = useMemo(() => (ready ? beatTimes(project, analysis, options) : null), [ready, project, analysis, on, every, rangeKind, source]);

  return (
    <Modal
      title={t('Beat effects')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            icon={AudioWaveform}
            disabled={!found?.times.length}
            onClick={() => {
              onApply(options);
              onClose();
            }}
          >
            {t('Add on {count} beat(s)', { count: found?.times.length ?? 0 })}
          </Button>
        </>
      }
    >
      <div className="vd-hint">{t('Adds a shake, zoom punch, flash… on the beat of your music or on every loud moment of the game sound. It is made of keyframes, so you can still change it.')}</div>
      <Field label={t('Effect')}>
        <Select<BeatEffect> value={effect} onChange={setEffect} options={BEAT_EFFECTS.map((e) => ({ value: e.id, label: t(e.label) }))} />
      </Field>
      <Field label={t('On')}>
        <Select<BeatSource> value={on} onChange={setOn} options={BEAT_SOURCES.map((s) => ({ value: s.id, label: t(s.label) }))} />
      </Field>
      <Field label={t('How often')}>
        <Select<string>
          value={String(every)}
          onChange={(v) => setEvery(Number(v))}
          options={[
            { value: '1', label: t('Every time') },
            { value: '2', label: t('Every 2nd') },
            { value: '4', label: t('Every 4th') },
          ]}
        />
      </Field>
      <Slider label={t('Strength')} value={amount} min={10} max={200} step={5} onChange={setAmount} format={(v) => `${Math.round(v)}%`} defaultValue={100} />
      <Field label={t('Follow the sound of')}>
        <Select<string>
          value={source}
          onChange={setSource}
          options={[{ value: 'auto', label: t('Automatic') }, ...sounds.map((c) => ({ value: c.id, label: `${c.name} (${c.kind === 'audio' ? t('Audio') : t('Video')})` }))]}
        />
      </Field>
      <RangeField project={project} value={rangeKind} onChange={setRangeKind} />
      <Field label={t('Apply to')}>
        <Select<string>
          value={target}
          onChange={(v) => setTarget(v as 'layer' | 'selected')}
          options={[
            { value: 'layer', label: t('A new adjustment layer (everything below reacts)') },
            { value: 'selected', label: t('The selected clips ({count})', { count: visualSelected.length }), disabled: !visualSelected.length },
          ]}
        />
      </Field>
      {!ready ? (
        <div className="row" style={{ gap: 8 }}>
          <Spinner size={14} /> {t('Analysing audio…')}
        </div>
      ) : found?.times.length ? (
        <div className="muted">{t('{count} beat(s) found', { count: found.times.length })}</div>
      ) : (
        <div className="vd-note warn">{t(found?.reason ? PROBLEMS[found.reason] : 'Nothing to follow yet.')}</div>
      )}
    </Modal>
  );
}
