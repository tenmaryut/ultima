import { useRef } from 'react';
import { Captions, Image as ImageIcon, Link2, Music, RotateCcw, Settings2, Type, Unlink2, Video } from 'lucide-react';
import type { Clip, Project, TitleStyle, TransitionKind, VisualProps } from '../types';
import { useT, type TFunction } from '../../../core/i18n';
import { Button, ColorPicker, Field, IconButton, NumberField, Panel, Segmented, Select, Slider, TextArea, TextInput, Toggle } from '../../../components/ui';
import { clipEnd, getClip, getMedia, getTrack, moveClips, setClipSpeed, trimClip, updateClip } from '../model';
import { DEFAULT_VISUAL, MAX_VOLUME_DB, MIN_VOLUME_DB, TITLE_ANIMATIONS, TITLE_PRESETS, TRANSITIONS, titlePreset } from '../presets';
import { formatTimecode } from '../time';
import { ProjectPanel } from './ProjectPanel';

interface InspectorProps {
  project: Project;
  selection: string[];
  fonts: string[];
  change: (next: Project, opts?: { record?: boolean; label?: string }) => void;
  commit: (label: string) => void;
  onOpenSettings: () => void;
  onLink: () => void;
  onUnlink: () => void;
  onSeek: (t: number) => void;
  onRenameMarker: (id: string) => void;
}

const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, title: Type, caption: Captions };
const KIND_LABEL: Record<Clip['kind'], string> = { video: 'Video clip', image: 'Image clip', audio: 'Audio clip', title: 'Title', caption: 'Caption' };

const dbLabel = (v: number) => (v <= MIN_VOLUME_DB ? '−∞ dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`);
const pct = (v: number) => `${Math.round(v)}%`;
const sec = (v: number) => `${v.toFixed(2)} s`;

export function Inspector(props: InspectorProps) {
  const t = useT();
  const { project, selection, change, commit } = props;
  const baseRef = useRef<Project | null>(null);
  const clips = selection.map((id) => getClip(project, id)).filter((c): c is Clip => Boolean(c));
  const clip = clips.find((c) => c.kind === 'video' || c.kind === 'image' || c.kind === 'title') ?? clips[0];

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
  const v = clip.visual ?? DEFAULT_VISUAL;
  const Icon = KIND_ICON[clip.kind];
  const media = getMedia(project, clip.mediaId);
  const visual = clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'title';
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
          {(clip.kind === 'video' || clip.kind === 'audio') && media ? ` · ${t('source')} ${clip.in.toFixed(2)}–${(clip.in + clip.duration * clip.speed).toFixed(2)} s / ${media.duration.toFixed(2)} s` : ''}
        </div>
      </div>

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
              onClick={() => setVisual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 }, t('Reset transform'))}
            />
          }
        >
          <div className="vd-grid2">
            <Field label={t('Position X')}>
              <NumberField small value={Math.round(v.x)} suffix="px" onChange={(x) => setVisual({ x }, t('Transform'))} />
            </Field>
            <Field label={t('Position Y')}>
              <NumberField small value={Math.round(v.y)} suffix="px" onChange={(y) => setVisual({ y }, t('Transform'))} />
            </Field>
          </div>
          <Slider label={t('Scale')} value={Math.round(v.scale * 100)} min={5} max={400} onChange={(s) => liveVisual({ scale: s / 100 })} onCommit={() => done(t('Transform'))} format={pct} defaultValue={100} />
          <Slider label={t('Rotation')} value={v.rotation} min={-180} max={180} onChange={(rotation) => liveVisual({ rotation })} onCommit={() => done(t('Transform'))} format={(x) => `${Math.round(x)}°`} defaultValue={0} />
          <Slider label={t('Opacity')} value={Math.round(v.opacity * 100)} min={0} max={100} onChange={(o) => liveVisual({ opacity: o / 100 })} onCommit={() => done(t('Transform'))} format={pct} defaultValue={100} />
          {clip.kind !== 'title' && (
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

      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <Panel title={t('Speed')}>
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
          <Toggle
            checked={clip.keepPitch}
            onChange={(keepPitch) => set((p) => [clip, ...audioTargets].reduce((acc, a) => updateClip(acc, a.id, (c) => ({ ...c, keepPitch })), p), t('Keep pitch'))}
            label={t('Keep audio pitch')}
          />
        </Panel>
      )}

      {audioTargets.length > 0 && (
        <Panel title={clip.kind === 'video' ? t('Audio (linked)') : t('Audio')}>
          <Slider
            label={t('Volume')}
            value={audioTargets[0].volume}
            min={MIN_VOLUME_DB}
            max={MAX_VOLUME_DB}
            step={0.5}
            onChange={(volume) => liveAudio({ volume })}
            onCommit={() => done(t('Volume'))}
            format={dbLabel}
            defaultValue={0}
          />
          <Slider label={t('Fade in')} value={audioTargets[0].fadeIn} min={0} max={fadeMax} step={0.05} onChange={(fadeIn) => liveAudio({ fadeIn })} onCommit={() => done(t('Audio fade'))} format={sec} defaultValue={0} />
          <Slider label={t('Fade out')} value={audioTargets[0].fadeOut} min={0} max={fadeMax} step={0.05} onChange={(fadeOut) => liveAudio({ fadeOut })} onCommit={() => done(t('Audio fade'))} format={sec} defaultValue={0} />
        </Panel>
      )}

      {visual && (
        <Panel title={t('Opacity fades')} defaultOpen={false}>
          <Slider label={t('Fade in')} value={clip.fadeIn} min={0} max={fadeMax} step={0.05} onChange={(fadeIn) => live(editClip(clip.id, (c) => ({ ...c, fadeIn })))} onCommit={() => done(t('Video fade'))} format={sec} defaultValue={0} />
          <Slider label={t('Fade out')} value={clip.fadeOut} min={0} max={fadeMax} step={0.05} onChange={(fadeOut) => live(editClip(clip.id, (c) => ({ ...c, fadeOut })))} onCommit={() => done(t('Video fade'))} format={sec} defaultValue={0} />
        </Panel>
      )}

      {visual && (
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

      {visual && (
        <Panel
          title={t('Color & blur')}
          defaultOpen={clip.kind !== 'title'}
          actions={
            <IconButton size="sm" icon={RotateCcw} label={t('Reset color')} onClick={() => setVisual({ brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, blur: 0 }, t('Reset color'))} />
          }
        >
          {(['brightness', 'contrast', 'saturation', 'temperature'] as const).map((k) => (
            <Slider
              key={k}
              label={t({ brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', temperature: 'Temperature' }[k])}
              value={v[k]}
              min={-100}
              max={100}
              onChange={(x) => liveVisual({ [k]: x })}
              onCommit={() => done(t('Color'))}
              defaultValue={0}
            />
          ))}
          <Slider label={t('Hue')} value={v.hue} min={-180} max={180} onChange={(hue) => liveVisual({ hue })} onCommit={() => done(t('Color'))} format={(x) => `${Math.round(x)}°`} defaultValue={0} />
          <Slider label={t('Blur')} value={v.blur} min={0} max={50} step={0.5} onChange={(blur) => liveVisual({ blur })} onCommit={() => done(t('Blur'))} format={(x) => `${x} px`} defaultValue={0} />
        </Panel>
      )}

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
