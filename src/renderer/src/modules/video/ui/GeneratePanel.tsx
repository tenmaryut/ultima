import { useEffect, useRef, useState } from 'react';
import { Crosshair, Dices, MoveHorizontal, Music, Play, Plus, Square } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { getAudioContext } from '../../../core/utils/audio';
import { Button, Field, IconButton, NumberField, Select, Slider, toast } from '../../../components/ui';
import { GENRES, MUSIC_LIMITS, NOTE_NAMES, SCALE_LABELS, fitDrop, genreInfo, renderMusic, type Genre, type ScaleName } from '../music';
import { SFX, SFX_LIMITS, SFX_RATE, renderSfx, type LibraryItem, type SfxVariant } from '../library';

/* Making new sounds: songs from the music generator, and custom versions of the library's sound effects. */

/** Plays one sound at a time (stopping the last), and says which one is playing. */
function usePlayer() {
  const [playing, setPlaying] = useState<string | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => () => source.current?.stop(), []);
  const stop = () => {
    source.current?.stop();
    source.current = null;
    setPlaying(null);
  };
  const play = (id: string, channels: Float32Array[], rate: number) => {
    stop();
    const ctx = getAudioContext();
    const buf = ctx.createBuffer(channels.length, channels[0].length, rate);
    channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => setPlaying((p) => (p === id ? null : p));
    void ctx.resume();
    src.start();
    source.current = src;
    setPlaying(id);
  };
  return { playing, play, stop };
}

const random = () => 1 + Math.floor(Math.random() * 999);

export function MusicGenerator({ timelineLength, playhead, onAdd }: { timelineLength: number; playhead: () => number; onAdd: (o: { genre: Genre; bpm: number; key: string; length: number; dropAt?: number; variation: number }) => Promise<void> }) {
  const t = useT();
  const [genre, setGenre] = useState<Genre>('phonk');
  const [bpm, setBpm] = useState(genreInfo('phonk').bpm);
  const [root, setRoot] = useState(6);
  const [scale, setScale] = useState<ScaleName | 'auto'>('auto');
  const [length, setLength] = useState(timelineLength >= MUSIC_LIMITS.minLength ? Math.round(timelineLength * 100) / 100 : 30);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [variation, setVariation] = useState(1);
  const [busy, setBusy] = useState<'listen' | 'add' | null>(null);
  const player = usePlayer();
  const info = genreInfo(genre);
  const key = `${NOTE_NAMES[root]} ${scale === 'auto' ? SCALE_LABELS[info.scale] : SCALE_LABELS[scale]}`;
  const request = { genre, bpm, key, length, dropAt: dropAt ?? undefined, variation };

  const listen = async () => {
    if (player.playing === 'music') return player.stop();
    setBusy('listen');
    try {
      const lead = dropAt ?? (info.dropBars * 240) / bpm;
      const fit = fitDrop(bpm, lead);
      const pcm = await renderMusic({ genre, bpm: fit.bpm, root, scale: scale === 'auto' ? info.scale : scale, length: Math.min(MUSIC_LIMITS.maxLength, fit.trim + length), dropBars: fit.dropBars, seed: variation });
      // the part that will be on the timeline
      const from = Math.round(fit.trim * pcm.sampleRate);
      player.play('music', pcm.channels.map((c) => c.subarray(from)), pcm.sampleRate);
    } catch (error) {
      toast.error(t('Could not make the music'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    player.stop();
    setBusy('add');
    try {
      await onAdd(request);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="col vd-generate" style={{ gap: 8 }}>
      <Field label={t('Style')}>
        <Select<string>
          small
          value={genre}
          onChange={(v) => {
            setGenre(v as Genre);
            setBpm(genreInfo(v as Genre).bpm);
          }}
          options={GENRES.map((g) => ({ value: g.id, label: t(g.label) }))}
        />
      </Field>
      <div className="vd-hint">{t(info.description)}</div>
      <div className="row" style={{ gap: 6 }}>
        <Field label={t('Tempo (BPM)')}>
          <NumberField small value={bpm} min={MUSIC_LIMITS.minBpm} max={MUSIC_LIMITS.maxBpm} onChange={(v) => setBpm(Math.round(v))} />
        </Field>
        <Field label={t('Key')}>
          <Select<number> small value={root} onChange={setRoot} options={NOTE_NAMES.map((n, i) => ({ value: i, label: n }))} />
        </Field>
      </div>
      <Field label={t('Musical scale')}>
        <Select<string>
          small
          value={scale}
          onChange={(v) => setScale(v as ScaleName | 'auto')}
          options={[{ value: 'auto', label: t('Usual ({scale})', { scale: t(SCALE_LABELS[info.scale]) }) }, ...(Object.keys(SCALE_LABELS) as ScaleName[]).map((s) => ({ value: s, label: t(SCALE_LABELS[s]) }))]}
        />
      </Field>
      <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
        <Field label={t('Length (s)')}>
          <NumberField small value={length} min={MUSIC_LIMITS.minLength} max={MUSIC_LIMITS.maxLength} step={1} onChange={setLength} />
        </Field>
        <IconButton size="sm" icon={MoveHorizontal} label={t('As long as the timeline')} disabled={timelineLength < MUSIC_LIMITS.minLength} onClick={() => setLength(Math.round(Math.min(MUSIC_LIMITS.maxLength, timelineLength) * 100) / 100)} />
        <Field label={t('Drop at (s)')}>
          <NumberField small value={dropAt ?? 0} min={0} max={length} onChange={(v) => setDropAt(v > 0 ? v : null)} title={t('Where the drop lands on the timeline (0: after the usual intro)')} />
        </Field>
        <IconButton size="sm" icon={Crosshair} label={t('Drop at the playhead')} onClick={() => setDropAt(Math.round(playhead() * 100) / 100 || null)} />
      </div>
      <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
        <Field label={t('Variation')}>
          <NumberField small value={variation} min={0} max={1e6} onChange={(v) => setVariation(Math.round(v))} />
        </Field>
        <IconButton size="sm" icon={Dices} label={t('Another variation')} onClick={() => setVariation(random())} />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon={player.playing === 'music' ? Square : Play} disabled={busy !== null} onClick={() => void listen()}>
          {busy === 'listen' ? t('Making…') : player.playing === 'music' ? t('Stop') : t('Listen')}
        </Button>
        <Button size="sm" variant="primary" icon={Music} disabled={busy !== null} onClick={() => void add()}>
          {busy === 'add' ? t('Making…') : t('Add to the timeline')}
        </Button>
      </div>
    </div>
  );
}

export function SoundMaker({ onAdd }: { onAdd: (item: LibraryItem, v: SfxVariant, mode: 'start' | 'end') => void }) {
  const t = useT();
  const [id, setId] = useState('riser');
  const item = SFX.find((s) => s.id === id) ?? SFX[0];
  const [duration, setDuration] = useState(item.duration ?? 1);
  const [pitch, setPitch] = useState(0);
  const [brightness, setBrightness] = useState(0);
  const [seed, setSeed] = useState(0);
  const player = usePlayer();
  const variant: SfxVariant = { duration, pitch, brightness, seed };

  const listen = () => {
    if (player.playing === 'sfx') return player.stop();
    player.play('sfx', [renderSfx(item, variant)], SFX_RATE);
  };

  return (
    <div className="col vd-generate" style={{ gap: 8 }}>
      <Field label={t('Sound')}>
        <Select<string>
          small
          value={id}
          onChange={(v) => {
            setId(v);
            setDuration(SFX.find((s) => s.id === v)?.duration ?? 1);
          }}
          options={SFX.map((s) => ({ value: s.id, label: t(s.label) }))}
        />
      </Field>
      <div className="vd-hint">{t(item.description)}</div>
      <Field label={t('Length (s)')}>
        <NumberField small value={duration} min={SFX_LIMITS.minDuration} max={SFX_LIMITS.maxDuration} step={0.1} precision={2} onChange={setDuration} />
      </Field>
      <Slider label={t('Pitch')} value={pitch} min={-12} max={12} step={1} onChange={setPitch} format={(v) => `${v > 0 ? '+' : ''}${v}`} defaultValue={0} />
      <Slider label={t('Brightness')} value={brightness} min={-1} max={1} step={0.1} onChange={setBrightness} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} defaultValue={0} />
      <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
        <Field label={t('Variation')}>
          <NumberField small value={seed} min={0} max={1e6} onChange={(v) => setSeed(Math.round(v))} />
        </Field>
        <IconButton size="sm" icon={Dices} label={t('Another variation')} onClick={() => setSeed(random())} />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon={player.playing === 'sfx' ? Square : Play} onClick={listen}>
          {player.playing === 'sfx' ? t('Stop') : t('Listen')}
        </Button>
        <Button size="sm" icon={Plus} onClick={() => onAdd(item, variant, 'start')}>
          {t('Add at the playhead')}
        </Button>
        <Button size="sm" icon={Plus} onClick={() => onAdd(item, variant, 'end')} title={t('The sound ends at the playhead: a riser or a snare roll into a drop')}>
          {t('End at the playhead')}
        </Button>
      </div>
    </div>
  );
}
