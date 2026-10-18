import { useRef, useState } from 'react';
import { Captions, Image as ImageIcon, Link2, Music, RotateCcw, Settings2, SlidersHorizontal, Snowflake, Type, Unlink2, Video } from 'lucide-react';
import type { BlendMode, Clip, KeyProp, Project, TitleStyle, TransitionKind, VisualProps } from '../types';
import { useT, type TFunction } from '../../../core/i18n';
import { Button, ColorPicker, Field, IconButton, NumberField, Panel, Segmented, Select, Slider, TextArea, TextInput, Toggle } from '../../../components/ui';
import { clipEnd, freezeFrameAt, getClip, getMedia, getTrack, moveClips, setClipSpeed, setSpeedRamp, sourceOut, trimClip, updateClip, type RampKeep } from '../model';
import { BLEND_MODES, DEFAULT_VISUAL, MAX_VOLUME_DB, MIN_VOLUME_DB, TITLE_ANIMATIONS, TITLE_PRESETS, TRANSITIONS, titlePreset } from '../presets';
import { RAMP_PRESETS, rampPreset, withoutKeys, type RampPreset } from '../keyframes';
import { formatTimecode } from '../time';
import type { TimeStore } from '../timeStore';
import { KeyBar, KeyNumber, KeySlider, type KeyEdit } from './KeyControls';
import { ColorGradePanel, EffectsPanel, MaskPanel } from './LookPanels';
import { SoundPanel } from './SoundPanel';
import { ProjectPanel } from './ProjectPanel';
import { has3D } from '../warp3d';
import { TrackingPanel } from './TrackingPanel';
import { CutoutPanel } from './CutoutPanel';
import { StemsPanel } from './StemsPanel';
import type { StemsApi } from '../useStems';
import type { TrackingApi } from '../useTracking';
import type { CutoutApi } from '../useCutout';

interface InspectorProps {
  project: Project;
  time: TimeStore;
  selection: string[];
  fonts: string[];
  change: (next: Project, opts?: { record?: boolean; label?: string }) => void;
  commit: (label: string) => void;
  onOpenSettings: () => void;
  onImportLut: () => Promise<string[]>;
  onDuck: (clipId: string, amount: number) => void;
  onLink: () => void;
  onUnlink: () => void;
  onSeek: (t: number) => void;
  onRenameMarker: (id: string) => void;
  tracking: TrackingApi;
  cutout: CutoutApi;
  stems: StemsApi;
}

const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, title: Type, caption: Captions, adjustment: SlidersHorizontal };
const KIND_LABEL: Record<Clip['kind'], string> = { video: 'Video clip', image: 'Image clip', audio: 'Audio clip', title: 'Title', caption: 'Caption', adjustment: 'Adjustment layer' };

const dbLabel = (v: number) => (v <= MIN_VOLUME_DB ? '−∞ dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`);

/** The ramp preset a speed curve was made from (with the default speeds), or 'custom'. */
function rampOf(c: Clip): RampPreset | 'custom' {
  const keys = c.speedKeys ?? [];
  const match = RAMP_PRESETS.find(({ id }) => {
    const ref = rampPreset(id, c.duration);
    return ref.length === keys.length && ref.every((k, i) => Math.abs(k.t - keys[i].t) < 1e-3 && Math.abs(k.v - keys[i].v) < 1e-3 && k.ease === keys[i].ease);
  });
  return match?.id ?? 'custom';
}
const pct = (v: number) => `${Math.round(v)}%`;
const sec = (v: number) => `${v.toFixed(2)} s`;

export function Inspector(props: InspectorProps) {
  const t = useT();
  const { project, selection, change, commit } = props;
  const baseRef = useRef<Project | null>(null);
  const [rampKeep, setRampKeep] = useState<RampKeep>('length');
  const clips = selection.map((id) => getClip(project, id)).filter((c): c is Clip => Boolean(c));
  const clip = clips.find((c) => c.kind === 'video' || c.kind === 'image' || c.kind === 'title' || c.kind === 'adjustment') ?? clips[0];

  if (!clip) {
    return <ProjectPanel project={project} change={change} onOpenSettings={props.onOpenSettings} onSeek={props.onSeek} onRenameMarker={props.onRenameMarker} />;
  }

  const fps = project.settings.fps;
  const locked = Boolean(getTrack(project, clip.trackId)?.locked);
  const linkedAudio = clip.kind === 'video' && clip.linkId ? project.clips.filter((c) => c.linkId === clip.linkId && c.kind === 'audio') : [];
  const audioTargets = clip.kind === 'audio' ? [clip] : linkedAudio;

  /** Live edit computed from the state when the gesture started (one undo step on commit). */
  const live = (fn: (base: Project) => Project) => {
    if (!baseRef.current) baseRef.current = project;
    change(fn(baseRef.current), { record: false });
  };
  const done = (label: string) => {
    baseRef.current = null;
    commit(label);
  };
  const set = (fn: (p: Project) => Project, label: string) => {
    baseRef.current = null;
    change(fn(project), { label });
  };
  const editClip = (id: string, fn: (c: Clip) => Clip) => (p: Project) => updateClip(p, id, fn);
  const liveVisual = (patch: Partial<VisualProps>) => live(editClip(clip.id, (c) => ({ ...c, visual: { ...(c.visual ?? DEFAULT_VISUAL), ...patch } })));
  const setVisual = (patch: Partial<VisualProps>, label: string) => set(editClip(clip.id, (c) => ({ ...c, visual: { ...(c.visual ?? DEFAULT_VISUAL), ...patch } })), label);
  const liveTitle = (patch: Partial<TitleStyle>) => live(editClip(clip.id, (c) => (c.title ? { ...c, title: { ...c.title, ...patch } } : c)));
  const setTitle = (patch: Partial<TitleStyle>, label = t('Edit title')) => set(editClip(clip.id, (c) => (c.title ? { ...c, title: { ...c.title, ...patch } } : c)), label);
  const liveAudio = (patch: Partial<Clip>) =>
    live((p) => audioTargets.reduce((acc, a) => updateClip(acc, a.id, (c) => ({ ...c, ...patch })), p));
  /** Keyframe-aware edits of `targets` (fn gets each clip and the playhead time). */
  const keyLive = (targets: Clip[]): KeyEdit => (fn) => {
    const now = props.time.get();
    live((p) => targets.reduce((acc, x) => updateClip(acc, x.id, (c) => fn(c, now)), p));
  };
  const keyApply = (targets: Clip[]): KeyEdit => (fn, label = t('Edit clip')) => {
    const now = props.time.get();
    set((p) => targets.reduce((acc, x) => updateClip(acc, x.id, (c) => fn(c, now)), p), label);
  };
  const keyProps = (targets: Clip[]) => ({ time: props.time, live: keyLive(targets), apply: keyApply(targets), done });
  /** Resets plain values and removes the keyframes of the same properties. */
  const resetVisual = (patch: Partial<VisualProps>, label: string) =>
    set(
      editClip(clip.id, (c) => {
        let next: Clip = { ...c, visual: { ...(c.visual ?? DEFAULT_VISUAL), ...patch } };
        for (const k of Object.keys(patch)) next = withoutKeys(next, k as KeyProp);
        return next;
      }),
      label,
    );
  const sourceClips = [clip, ...audioTargets.filter((a) => a.id !== clip.id)];
  const setOnSource = (patch: Partial<Clip>, label: string) => set((p) => sourceClips.reduce((acc, a) => updateClip(acc, a.id, (c) => ({ ...c, ...patch })), p), label);
  const applyRamp = (id: RampPreset | 'none', keep: RampKeep) => {
    const r = setSpeedRamp(project, clip.id, id === 'none' ? undefined : rampPreset(id, clip.duration), keep);
    if (r) set(() => r.project, id === 'none' ? t('Remove speed curve') : t('Speed curve'));
  };
  const freeze = () => {
    const r = freezeFrameAt(project, clip.id, props.time.get(), 1);
    if (r.id) set(() => r.project, t('Freeze frame'));
  };
  const v = clip.visual ?? DEFAULT_VISUAL;
  const Icon = KIND_ICON[clip.kind];
  const media = getMedia(project, clip.mediaId);
  const visual = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'title' || clip.kind === 'adjustment';
  /** Pictures (not adjustment layers): transitions, crop. */
  const picture = visual && clip.kind !== 'adjustment';
  const clipSet = (fn: (c: Clip) => Clip, label: string) => set(editClip(clip.id, fn), label);
  const clipLive = (fn: (c: Clip) => Clip) => live(editClip(clip.id, fn));
  const fadeMax = Math.max(0.1, Math.min(10, clip.duration));

  return (
    <div className="vd-inspector" style={locked ? { opacity: 0.6, pointerEvents: 'none' } : undefined}>
      <div className="vd-insp-head">
        <div className="row" style={{ gap: 6 }}>
          <Icon size={15} color="var(--accent)" />
          <strong style={{ color: 'var(--text-0)' }}>{t(KIND_LABEL[clip.kind])}</strong>
          {clips.length > 1 && <span className="faint">{t('{count} selected', { count: clips.length })}</span>}
          <span className="spacer" />
          {clip.linkId ? (
            <IconButton size="sm" icon={Unlink2} label={t('Unlink clips')} onClick={props.onUnlink} />
          ) : clips.length > 1 ? (
            <IconButton size="sm" icon={Link2} label={t('Link clips')} onClick={props.onLink} />
          ) : null}
        </div>
        {clip.kind !== 'caption' && clip.kind !== 'title' && (
          <TextInput small value={clip.name} aria-label={t('Clip name')} onChange={(e) => live(editClip(clip.id, (c) => ({ ...c, name: e.target.value })))} onBlur={() => done(t('Rename clip'))} />
        )}
        <div className="vd-grid2">
          <Field label={t('Start (s)')}>
            <NumberField small value={+clip.start.toFixed(3)} min={0} step={1 / fps} onChange={(s) => set((p) => moveClips(p, [clip.id], s - clip.start), t('Move clips'))} />
          </Field>
          <Field label={t('Duration (s)')}>
            <NumberField small value={+clip.duration.toFixed(3)} min={1 / fps} step={1 / fps} onChange={(d) => set((p) => trimClip(p, clip.id, 'end', clip.start + d), t('Trim clip'))} />
          </Field>
        </div>
        <div className="faint" style={{ fontSize: 11 }}>
          {formatTimecode(clip.start, fps)} → {formatTimecode(clipEnd(clip), fps)}
          {(clip.kind === 'video' || clip.kind === 'audio') && media
            ? clip.freeze
              ? ` · ${t('frame at')} ${clip.in.toFixed(2)} s`
              : ` · ${t('source')} ${clip.in.toFixed(2)}–${sourceOut(clip).toFixed(2)} s / ${media.duration.toFixed(2)} s`
            : ''}
        </div>
      </div>

      <KeyBar time={props.time} clips={sourceClips} onSeek={props.onSeek} apply={keyApply(sourceClips)} />

      {clip.kind === 'title' && clip.title && <TitleEditor t={t} title={clip.title} fonts={props.fonts} liveTitle={liveTitle} setTitle={setTitle} done={done} project={project} />}

      {clip.kind === 'caption' && (
        <Panel title={t('Caption')}>
          <TextArea rows={3} value={clip.text ?? ''} onChange={(e) => live(editClip(clip.id, (c) => ({ ...c, text: e.target.value, name: e.target.value.slice(0, 40) })))} onBlur={() => done(t('Edit caption'))} />
          <div className="vd-hint">{t('Caption look (font, size, background) is shared by all captions — see the Captions tab.')}</div>
        </Panel>
      )}

      {visual && (
        <Panel
          title={t('Transform')}
          actions={
            <IconButton
              size="sm"
              icon={RotateCcw}
              label={t('Reset transform')}
              onClick={() => resetVisual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 }, t('Reset transform'))}
            />
          }
        >
          <div className="vd-grid2">
            <KeyNumber {...keyProps([clip])} clip={clip} prop="x" label={t('Position X')} suffix="px" />
            <KeyNumber {...keyProps([clip])} clip={clip} prop="y" label={t('Position Y')} suffix="px" />
          </div>
          <KeySlider {...keyProps([clip])} clip={clip} prop="scale" label={t('Scale')} unit={100} min={5} max={400} format={pct} defaultValue={100} commitLabel={t('Transform')} />
          <KeySlider {...keyProps([clip])} clip={clip} prop="rotation" label={t('Rotation')} min={-180} max={180} format={(x) => `${Math.round(x)}°`} defaultValue={0} commitLabel={t('Transform')} />
          <KeySlider {...keyProps([clip])} clip={clip} prop="opacity" label={t('Opacity')} unit={100} min={0} max={100} format={pct} defaultValue={100} commitLabel={t('Transform')} />
          <div className="vd-hint">{t('◆ animates a value: it adds a keyframe at the playhead, and changes at other times add more.')}</div>
          <Field label={t('Blend mode')}>
            <Select<string>
              small
              value={clip.blend ?? 'normal'}
              onChange={(b) => clipSet((c) => ({ ...c, blend: b === 'normal' ? undefined : (b as BlendMode) }), t('Blend mode'))}
              options={BLEND_MODES.map((b) => ({ value: b.id, label: t(b.label) }))}
            />
          </Field>
          {(clip.kind === 'video' || clip.kind === 'image') && (
            <>
              <div className="vd-section-title">{t('Crop')}</div>
              <div className="vd-grid2">
                {(['cropLeft', 'cropRight', 'cropTop', 'cropBottom'] as const).map((k) => (
                  <Slider
                    key={k}
                    label={t({ cropLeft: 'Left', cropRight: 'Right', cropTop: 'Top', cropBottom: 'Bottom' }[k])}
                    value={Math.round(v[k] * 100)}
                    min={0}
                    max={45}
                    onChange={(x) => liveVisual({ [k]: x / 100 })}
                    onCommit={() => done(t('Crop'))}
                    format={pct}
                    defaultValue={0}
                  />
                ))}
              </div>
            </>
          )}
        </Panel>
      )}

      {(clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'title') && (
        <Panel
          key={`3d-${clip.id}`}
          title={t('3D')}
          defaultOpen={has3D(v)}
          actions={<IconButton size="sm" icon={RotateCcw} label={t('Reset 3D')} onClick={() => resetVisual({ rotateX: 0, rotateY: 0, z: 0, perspective: DEFAULT_VISUAL.perspective }, t('Reset 3D'))} />}
        >
          <KeySlider {...keyProps([clip])} clip={clip} prop="rotateX" label={t('Tilt (X)')} min={-180} max={180} format={(x) => `${Math.round(x)}°`} defaultValue={0} commitLabel={t('3D')} />
          <KeySlider {...keyProps([clip])} clip={clip} prop="rotateY" label={t('Turn (Y)')} min={-180} max={180} format={(x) => `${Math.round(x)}°`} defaultValue={0} commitLabel={t('3D')} />
          <KeySlider {...keyProps([clip])} clip={clip} prop="z" label={t('Depth (Z)')} min={-800} max={5000} step={10} format={(x) => `${Math.round(x)} px`} defaultValue={0} commitLabel={t('3D')} />
          <Slider
            label={t('Perspective')}
            value={v.perspective}
            min={0.4}
            max={6}
            step={0.1}
            onChange={(x) => liveVisual({ perspective: x })}
            onCommit={() => done(t('3D'))}
            format={(x) => (x < 1 ? t('Strong') : x > 3 ? t('Flat') : t('Normal'))}
            defaultValue={DEFAULT_VISUAL.perspective}
          />
          <div className="vd-hint">{t('Tilt and turn the picture in space, push it away or pull it closer. Animate them with ◆ for 3D camera moves.')}</div>
        </Panel>
      )}

      {(clip.kind === 'video' || clip.kind === 'audio') && clip.freeze && (
        <Panel title={t('Speed')}>
          <div className="row" style={{ gap: 6 }}>
            <Snowflake size={13} color="var(--accent)" />
            <span className="vd-hint">{t('Freeze frame: shows one frame of the video for the whole clip.')}</span>
          </div>
        </Panel>
      )}

      {(clip.kind === 'video' || clip.kind === 'audio') && !clip.freeze && (
        <Panel title={t('Speed')}>
          {clip.speedKeys?.length ? (
            <div className="vd-hint">{t('A speed curve changes the speed inside the clip. Pick "None" to go back to one speed.')}</div>
          ) : (
            <>
              <Slider
                label={t('Speed')}
                value={Math.log2(clip.speed)}
                min={-2}
                max={2}
                step={0.01}
                onChange={(x) => live((p) => setClipSpeed(p, clip.id, Math.round(2 ** x * 100) / 100))}
                onCommit={() => done(t('Change speed'))}
                format={() => `${clip.speed.toFixed(2)}×`}
                defaultValue={0}
              />
              <Segmented
                value={String(clip.speed)}
                onChange={(s) => set((p) => setClipSpeed(p, clip.id, parseFloat(s)), t('Change speed'))}
                options={['0.25', '0.5', '1', '1.5', '2', '4'].map((s) => ({ value: s, label: `${s}×` }))}
              />
            </>
          )}
          <Field label={t('Speed curve')}>
            <Select<string>
              small
              value={clip.speedKeys?.length ? rampOf(clip) : 'none'}
              onChange={(id) => id !== 'custom' && applyRamp(id as RampPreset | 'none', rampKeep)}
              options={[
                { value: 'none', label: t('None (one speed)') },
                ...RAMP_PRESETS.map((r) => ({ value: r.id, label: t(r.label) })),
                ...(clip.speedKeys?.length && rampOf(clip) === 'custom' ? [{ value: 'custom', label: t('Custom curve') }] : []),
              ]}
            />
          </Field>
          <Field label={t('A new curve keeps')}>
            <Segmented
              value={rampKeep}
              onChange={setRampKeep}
              options={[
                { value: 'length', label: t('Clip length') },
                { value: 'content', label: t('All content') },
              ]}
            />
          </Field>
          <div className="vd-hint">
            {rampKeep === 'length' ? t('The clip keeps its place and length, so cuts stay on the beat.') : t('The clip shows the same part of the video and gets longer or shorter; later clips move.')}
          </div>
          <Toggle checked={Boolean(clip.reverse)} onChange={(on) => setOnSource({ reverse: on || undefined }, t('Reverse'))} label={t('Play backwards')} />
          {clip.kind === 'video' && (
            <Field label={t('Smooth slow motion (on export)')}>
              <Select<string>
                value={clip.opticalFlow ? 'flow' : clip.frameBlend ? 'blend' : 'off'}
                onChange={(v) => set(editClip(clip.id, (c) => ({ ...c, frameBlend: v === 'blend' || undefined, opticalFlow: v === 'flow' || undefined })), t('Smooth slow motion'))}
                options={[
                  { value: 'off', label: t('Off (repeat frames)') },
                  { value: 'blend', label: t('Blend frames (fast)') },
                  { value: 'flow', label: t('Optical flow: new in-between frames (sharpest)') },
                ]}
              />
            </Field>
          )}
          <Toggle checked={clip.keepPitch} onChange={(keepPitch) => setOnSource({ keepPitch }, t('Keep pitch'))} label={t('Keep audio pitch')} />
          {clip.kind === 'video' && (
            <Button size="sm" icon={Snowflake} onClick={freeze}>
              {t('Freeze frame at the playhead')}
            </Button>
          )}
        </Panel>
      )}

      {audioTargets.length > 0 && (
        <Panel title={clip.kind === 'video' ? t('Audio (linked)') : t('Audio')}>
          <KeySlider
            {...keyProps(audioTargets)}
            clip={audioTargets[0]}
            prop="volume"
            label={t('Volume')}
            min={MIN_VOLUME_DB}
            max={MAX_VOLUME_DB}
            step={0.5}
            format={dbLabel}
            defaultValue={0}
            commitLabel={t('Volume')}
          />
          <Slider label={t('Fade in')} value={audioTargets[0].fadeIn} min={0} max={fadeMax} step={0.05} onChange={(fadeIn) => liveAudio({ fadeIn })} onCommit={() => done(t('Audio fade'))} format={sec} defaultValue={0} />
          <Slider label={t('Fade out')} value={audioTargets[0].fadeOut} min={0} max={fadeMax} step={0.05} onChange={(fadeOut) => liveAudio({ fadeOut })} onCommit={() => done(t('Audio fade'))} format={sec} defaultValue={0} />
        </Panel>
      )}

      {audioTargets.length > 0 && (
        <SoundPanel
          key={`sound-${audioTargets[0].id}`}
          targets={audioTargets}
          time={props.time}
          keyProps={keyProps(audioTargets)}
          set={(fn, label) => set((p) => audioTargets.reduce((acc, a) => updateClip(acc, a.id, fn), p), label)}
          live={(fn) => live((p) => audioTargets.reduce((acc, a) => updateClip(acc, a.id, fn), p))}
          done={done}
          onDuck={props.onDuck}
        />
      )}

      {(clip.kind === 'audio' || (clip.kind === 'video' && getMedia(project, clip.mediaId)?.hasAudio)) && <StemsPanel key={`stems-${clip.id}`} clip={clip} stems={props.stems} />}

      {visual && (
        <Panel title={t('Opacity fades')} defaultOpen={false}>
          <Slider label={t('Fade in')} value={clip.fadeIn} min={0} max={fadeMax} step={0.05} onChange={(fadeIn) => live(editClip(clip.id, (c) => ({ ...c, fadeIn })))} onCommit={() => done(t('Video fade'))} format={sec} defaultValue={0} />
          <Slider label={t('Fade out')} value={clip.fadeOut} min={0} max={fadeMax} step={0.05} onChange={(fadeOut) => live(editClip(clip.id, (c) => ({ ...c, fadeOut })))} onCommit={() => done(t('Video fade'))} format={sec} defaultValue={0} />
        </Panel>
      )}

      {picture && (
        <Panel title={t('Transition in')}>
          <Select<string>
            small
            value={clip.transition?.kind ?? 'none'}
            onChange={(k) =>
              set(editClip(clip.id, (c) => ({ ...c, transition: k === 'none' ? undefined : { kind: k as TransitionKind, duration: Math.min(c.transition?.duration ?? 1, c.duration) } })), t('Transition'))
            }
            options={[{ value: 'none', label: t('None') }, ...TRANSITIONS.map((x) => ({ value: x.kind, label: t(x.label) }))]}
          />
          {clip.transition && (
            <Slider
              label={t('Duration')}
              value={clip.transition.duration}
              min={0.1}
              max={Math.max(0.1, Math.min(5, clip.duration))}
              step={0.05}
              onChange={(d) => live(editClip(clip.id, (c) => (c.transition ? { ...c, transition: { ...c.transition, duration: d } } : c)))}
              onCommit={() => done(t('Transition'))}
              format={sec}
            />
          )}
          <div className="vd-hint">{t('Plays at the start of this clip — from the clip before it on the same track, or from what is below.')}</div>
        </Panel>
      )}

      {picture && (
        <Panel key={`out-${clip.id}`} title={t('Transition out')} defaultOpen={Boolean(clip.transitionOut)}>
          <Select<string>
            small
            value={clip.transitionOut?.kind ?? 'none'}
            onChange={(k) => clipSet((c) => ({ ...c, transitionOut: k === 'none' ? undefined : { kind: k as TransitionKind, duration: Math.min(c.transitionOut?.duration ?? 0.5, c.duration) } }), t('Transition out'))}
            options={[{ value: 'none', label: t('None') }, ...TRANSITIONS.map((x) => ({ value: x.kind, label: t(x.label) }))]}
          />
          {clip.transitionOut && (
            <Slider
              label={t('Duration')}
              value={clip.transitionOut.duration}
              min={0.1}
              max={Math.max(0.1, Math.min(5, clip.duration))}
              step={0.05}
              onChange={(d) => clipLive((c) => (c.transitionOut ? { ...c, transitionOut: { ...c.transitionOut, duration: d } } : c))}
              onCommit={() => done(t('Transition out'))}
              format={sec}
            />
          )}
          <div className="vd-hint">{t('Animates the clip away at its end, showing what is below.')}</div>
        </Panel>
      )}

      {visual && (
        <Panel
          title={t('Color & blur')}
          defaultOpen={clip.kind !== 'title'}
          actions={
            <IconButton size="sm" icon={RotateCcw} label={t('Reset color')} onClick={() => resetVisual({ brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, blur: 0 }, t('Reset color'))} />
          }
        >
          {(['brightness', 'contrast', 'saturation', 'temperature'] as const).map((k) => (
            <KeySlider
              key={k}
              {...keyProps([clip])}
              clip={clip}
              prop={k}
              label={t({ brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', temperature: 'Temperature' }[k])}
              min={-100}
              max={100}
              format={(x) => String(Math.round(x))}
              defaultValue={0}
              commitLabel={t('Color')}
            />
          ))}
          <KeySlider {...keyProps([clip])} clip={clip} prop="hue" label={t('Hue')} min={-180} max={180} format={(x) => `${Math.round(x)}°`} defaultValue={0} commitLabel={t('Color')} />
          <KeySlider {...keyProps([clip])} clip={clip} prop="blur" label={t('Blur')} min={0} max={50} step={0.5} format={(x) => `${+x.toFixed(1)} px`} defaultValue={0} commitLabel={t('Blur')} />
        </Panel>
      )}

      {/* keyed by clip: a panel opens when the selected clip uses it */}
      {visual && <ColorGradePanel key={`grade-${clip.id}`} clip={clip} project={project} set={clipSet} live={clipLive} done={done} onImportLut={props.onImportLut} />}

      {visual && <EffectsPanel key={`fx-${clip.id}`} clip={clip} project={project} time={props.time} keyProps={keyProps([clip])} set={clipSet} live={clipLive} done={done} />}

      {visual && <MaskPanel key={`mask-${clip.id}`} clip={clip} set={clipSet} live={clipLive} done={done} />}

      {clip.kind === 'video' && <TrackingPanel key={`track-${clip.id}`} clip={clip} tracking={props.tracking} selected={selection.filter((id) => id !== clip.id && getClip(project, id)?.visual).length} />}

      {clip.kind === 'video' && <CutoutPanel key={`cut-${clip.id}`} clip={clip} cutout={props.cutout} />}

      {(clip.kind === 'video' || clip.kind === 'image') && (
        <Panel title={t('Chroma key (green screen)')} defaultOpen={v.chromaKey}>
          <Toggle checked={v.chromaKey} onChange={(chromaKey) => setVisual({ chromaKey }, t('Chroma key'))} label={t('Remove a background color')} />
          {v.chromaKey && (
            <>
              <div className="vd-swatches">
                <span className="vd-row-label">{t('Key color')}</span>
                <ColorPicker value={v.chromaColor} alpha={false} onChange={(chromaColor) => liveVisual({ chromaColor })} onCommit={() => done(t('Chroma key'))} label={t('Key color')} />
                <Button size="sm" onClick={() => setVisual({ chromaColor: '#00ff00' }, t('Chroma key'))}>
                  {t('Green')}
                </Button>
                <Button size="sm" onClick={() => setVisual({ chromaColor: '#0047bb' }, t('Chroma key'))}>
                  {t('Blue')}
                </Button>
              </div>
              <Slider label={t('Similarity')} value={Math.round(v.chromaSimilarity * 100)} min={0} max={100} onChange={(x) => liveVisual({ chromaSimilarity: x / 100 })} onCommit={() => done(t('Chroma key'))} format={pct} defaultValue={30} />
              <Slider label={t('Smoothness')} value={Math.round(v.chromaSmoothness * 100)} min={0} max={100} onChange={(x) => liveVisual({ chromaSmoothness: x / 100 })} onCommit={() => done(t('Chroma key'))} format={pct} defaultValue={10} />
              <div className="vd-hint">{t('Tip: use the eyedropper in the color picker to sample the background from the preview.')}</div>
            </>
          )}
        </Panel>
      )}
      {clip.kind === 'adjustment' && (
        <div className="vd-hint" style={{ padding: 10 }}>
          {t('An adjustment layer changes everything on the tracks below it while it lasts: its color, effects, mask and transform apply to the whole picture.')}
        </div>
      )}
      {clips.length > 1 && (
        <div className="vd-hint" style={{ padding: 10 }}>
          {t('The inspector edits the first selected clip. Delete, split, move and copy work on the whole selection.')}
        </div>
      )}
    </div>
  );
}

function TitleEditor({
  t,
  title,
  fonts,
  liveTitle,
  setTitle,
  done,
  project,
}: {
  t: TFunction;
  title: TitleStyle;
  fonts: string[];
  liveTitle: (patch: Partial<TitleStyle>) => void;
  setTitle: (patch: Partial<TitleStyle>, label?: string) => void;
  done: (label: string) => void;
  project: Project;
}) {
  const fontOptions = [...new Set([title.font, ...fonts])].map((f) => ({ value: f, label: f }));
  return (
    <Panel title={t('Text')}>
      <TextArea rows={2} value={title.text} aria-label={t('Title text')} onChange={(e) => liveTitle({ text: e.target.value })} onBlur={() => done(t('Edit title'))} />
      <TextInput small value={title.subtitle} placeholder={t('Second line (optional)')} onChange={(e) => liveTitle({ subtitle: e.target.value })} onBlur={() => done(t('Edit title'))} />
      <Field label={t('Font')}>
        <Select small value={title.font} onChange={(font) => setTitle({ font })} options={fontOptions} />
      </Field>
      <div className="vd-grid3">
        <Field label={t('Size')}>
          <NumberField small value={title.size} min={6} max={1000} onChange={(size) => setTitle({ size })} />
        </Field>
        <Field label={t('Weight')}>
          <Select<number> small value={title.weight} onChange={(weight) => setTitle({ weight })} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} />
        </Field>
        <Field label={t('Italic')}>
          <Toggle checked={title.italic} onChange={(italic) => setTitle({ italic })} />
        </Field>
      </div>
      <div className="vd-swatches">
        <span className="vd-row-label">{t('Color')}</span>
        <ColorPicker value={title.color} onChange={(color) => liveTitle({ color })} onCommit={() => done(t('Edit title'))} label={t('Text color')} />
        <Toggle checked={title.shadow} onChange={(shadow) => setTitle({ shadow })} label={t('Shadow')} />
      </div>
      <div className="vd-swatches">
        <span className="vd-row-label">{t('Outline')}</span>
        <ColorPicker value={title.outlineColor} onChange={(outlineColor) => liveTitle({ outlineColor })} onCommit={() => done(t('Edit title'))} label={t('Outline color')} />
        <NumberField small value={Math.round(title.outlineWidth)} min={0} max={60} suffix="px" onChange={(outlineWidth) => setTitle({ outlineWidth })} style={{ width: 80 }} />
      </div>
      <div className="vd-swatches">
        <span className="vd-row-label">{t('3D depth')}</span>
        <NumberField small value={Math.round(title.extrude ?? 0)} min={0} max={200} suffix="px" onChange={(extrude) => setTitle({ extrude: extrude || undefined })} style={{ width: 80 }} />
        {(title.extrude ?? 0) > 0 && <ColorPicker value={title.extrudeColor ?? '#000000'} onChange={(extrudeColor) => liveTitle({ extrudeColor })} onCommit={() => done(t('Edit title'))} label={t('3D side color')} />}
      </div>
      <div className="vd-swatches">
        <span className="vd-row-label">{t('Background')}</span>
        <Toggle checked={title.box} onChange={(box) => setTitle({ box })} />
        {title.box && <ColorPicker value={title.boxColor} onChange={(boxColor) => liveTitle({ boxColor })} onCommit={() => done(t('Edit title'))} label={t('Background color')} />}
      </div>
      <Field label={t('Alignment')}>
        <Segmented
          value={title.align}
          onChange={(align) => setTitle({ align })}
          options={[
            { value: 'left', label: t('Left') },
            { value: 'center', label: t('Center') },
            { value: 'right', label: t('Right') },
          ]}
        />
      </Field>
      <div className="vd-grid2">
        <Slider label={t('Position X')} value={Math.round(title.x * 100)} min={0} max={100} onChange={(x) => liveTitle({ x: x / 100 })} onCommit={() => done(t('Edit title'))} format={pct} defaultValue={50} />
        <Slider label={t('Position Y')} value={Math.round(title.y * 100)} min={0} max={100} onChange={(y) => liveTitle({ y: y / 100 })} onCommit={() => done(t('Edit title'))} format={pct} defaultValue={50} />
      </div>
      <div className="vd-grid2">
        <Field label={t('Animation')}>
          <Select small value={title.animation} onChange={(animation) => setTitle({ animation })} options={TITLE_ANIMATIONS.map((a) => ({ value: a.id, label: t(a.label) }))} />
        </Field>
        <Field label={t('Anim. length')}>
          <NumberField small value={title.animDuration} min={0.05} max={10} step={0.1} suffix="s" onChange={(animDuration) => setTitle({ animDuration })} />
        </Field>
      </div>
      <Field label={t('Apply a preset look')}>
        <Select<string>
          small
          value=""
          onChange={(id) => {
            if (!id) return;
            const p = titlePreset(id, project.settings.width, project.settings.height);
            setTitle({ ...p, text: title.text, subtitle: title.subtitle || '' }, t('Apply preset'));
          }}
          options={[{ value: '', label: t('Choose…') }, ...TITLE_PRESETS.map((p) => ({ value: p.id, label: t(p.label) }))]}
        />
      </Field>
      <div className="row">
        <Settings2 size={12} className="faint" />
        <span className="vd-hint">{t('Drag the title in the preview to move it.')}</span>
      </div>
    </Panel>
  );
}
