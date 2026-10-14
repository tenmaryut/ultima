import { useState } from 'react';
import { AudioWaveform, RotateCcw } from 'lucide-react';
import type { AudioFx, Clip } from '../types';
import { useT } from '../../../core/i18n';
import { Button, Field, IconButton, Panel, Select, Slider } from '../../../components/ui';
import { AUDIO_PRESETS, DEFAULT_AUDIO_FX } from '../presets';
import { OPEN_LOW_PASS, withoutKeys } from '../keyframes';
import { parseAudioFx } from '../project';
import { KeySlider, type KeyEdit } from './KeyControls';
import type { TimeStore } from '../timeStore';

/* Inspector panel for the sound effects of audio clips (or a video's linked sound) and auto ducking. */

const MIN_HZ = 150;
/** Slider position 0-100 ↔ frequency, logarithmic (100 = off). */
const toPos = (hz: number) => (hz >= OPEN_LOW_PASS || hz <= 0 ? 100 : Math.max(0, Math.min(100, (Math.log(hz / MIN_HZ) / Math.log(OPEN_LOW_PASS / MIN_HZ)) * 100)));
const fromPos = (x: number) => (x >= 99.5 ? OPEN_LOW_PASS : Math.round(MIN_HZ * Math.pow(OPEN_LOW_PASS / MIN_HZ, x / 100)));
const hz = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const db = (v: number) => `${v > 0 ? '+' : ''}${+v.toFixed(1)} dB`;

export function SoundPanel(props: {
  /** The audio clips the panel edits (a video's linked sound, or the selected audio clip). */
  targets: Clip[];
  time: TimeStore;
  keyProps: { time: TimeStore; live: KeyEdit; apply: KeyEdit; done: (label: string) => void };
  /** Applies `fn` to every target (one undo step, or live while dragging). */
  set: (fn: (c: Clip) => Clip, label: string) => void;
  live: (fn: (c: Clip) => Clip) => void;
  done: (label: string) => void;
  onDuck: (clipId: string, amount: number) => void;
}) {
  const t = useT();
  const clip = props.targets[0];
  const fx = clip.audioFx ?? DEFAULT_AUDIO_FX;
  const [duck, setDuck] = useState(-12);
  const patch = (c: Clip, p: Partial<AudioFx>): Clip => ({ ...c, audioFx: parseAudioFx({ ...(c.audioFx ?? DEFAULT_AUDIO_FX), ...p }) });
  const live = (p: Partial<AudioFx>) => props.live((c) => patch(c, p));
  const preset = AUDIO_PRESETS.find((a) => JSON.stringify(parseAudioFx(a.fx)) === JSON.stringify(clip.audioFx))?.id ?? (clip.audioFx ? 'custom' : 'none');
  return (
    <Panel
      title={t('Sound effects')}
      defaultOpen={Boolean(clip.audioFx || clip.keys?.lowPass)}
      actions={<IconButton size="sm" icon={RotateCcw} label={t('Reset sound effects')} onClick={() => props.set((c) => withoutKeys({ ...c, audioFx: undefined }, 'lowPass'), t('Sound effects'))} />}
    >
      <Field label={t('Preset')}>
        <Select<string>
          small
          value={preset}
          onChange={(id) => id !== 'custom' && props.set((c) => ({ ...c, audioFx: id === 'none' ? undefined : parseAudioFx(AUDIO_PRESETS.find((a) => a.id === id)!.fx) }), t('Sound effects'))}
          options={[{ value: 'none', label: t('None') }, ...AUDIO_PRESETS.map((a) => ({ value: a.id, label: t(a.label) })), ...(preset === 'custom' ? [{ value: 'custom', label: t('Custom') }] : [])]}
        />
      </Field>
      <Slider label={t('Low cut')} value={fx.highPass} min={0} max={1000} step={10} onChange={(v) => live({ highPass: v })} onCommit={() => props.done(t('Sound effects'))} format={(v) => (v ? hz(v) : t('Off'))} defaultValue={0} />
      <KeySlider
        {...props.keyProps}
        clip={clip}
        prop="lowPass"
        label={t('High cut (muffle)')}
        min={0}
        max={100}
        step={0.5}
        map={{ to: toPos, from: fromPos }}
        format={(x) => (x >= 99.5 ? t('Off') : hz(fromPos(x)))}
        defaultValue={100}
        commitLabel={t('Sound effects')}
      />
      <Slider label={t('Bass')} value={fx.eqLow} min={-24} max={24} step={0.5} onChange={(v) => live({ eqLow: v })} onCommit={() => props.done(t('Sound effects'))} format={db} defaultValue={0} />
      <Slider label={t('Mids')} value={fx.eqMid} min={-24} max={24} step={0.5} onChange={(v) => live({ eqMid: v })} onCommit={() => props.done(t('Sound effects'))} format={db} defaultValue={0} />
      <Slider label={t('Treble')} value={fx.eqHigh} min={-24} max={24} step={0.5} onChange={(v) => live({ eqHigh: v })} onCommit={() => props.done(t('Sound effects'))} format={db} defaultValue={0} />
      <Slider label={t('Reverb')} value={Math.round(fx.reverb * 100)} min={0} max={100} onChange={(v) => live({ reverb: v / 100 })} onCommit={() => props.done(t('Sound effects'))} format={(v) => `${Math.round(v)}%`} defaultValue={0} />
      {fx.reverb > 0 && (
        <Slider label={t('Room size')} value={fx.reverbSize} min={0.2} max={8} step={0.1} onChange={(v) => live({ reverbSize: v })} onCommit={() => props.done(t('Sound effects'))} format={(v) => `${v.toFixed(1)} s`} defaultValue={1.5} />
      )}
      <div className="vd-section-title">{t('Auto ducking')}</div>
      <Slider label={t('Lower by')} value={duck} min={-30} max={-3} step={1} onChange={setDuck} format={db} defaultValue={-12} />
      <Button size="sm" icon={AudioWaveform} onClick={() => props.onDuck(clip.id, duck)}>
        {t('Duck under the other sound')}
      </Button>
      <div className="vd-hint">{t('Lowers this clip (for example the music) wherever the other sound — voice or game audio — is loud, with volume keyframes you can still edit.')}</div>
    </Panel>
  );
}
