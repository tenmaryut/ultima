import { memo, useSyncExternalStore } from 'react';
import { Download, FileUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { CaptionStyle, Clip, Project } from '../types';
import { useT } from '../../../core/i18n';
import { Button, ColorPicker, DropdownButton, Field, IconButton, NumberField, Panel, Segmented, Select, Slider, TextArea, Toggle } from '../../../components/ui';
import type { TimeStore } from '../timeStore';
import { captionClips, clipEnd, deleteClips, updateClip } from '../model';
import { formatTimecode } from '../time';
import { EPS } from '../time';

interface CaptionsPanelProps {
  project: Project;
  time: TimeStore;
  fonts: string[];
  selection: string[];
  setSelection: (ids: string[]) => void;
  change: (next: Project, opts?: { record?: boolean; label?: string }) => void;
  commit: (label: string) => void;
  seek: (t: number) => void;
  onAutoCaptions: () => void;
  onAdd: () => void;
  onImport: () => void;
  onExport: (format: 'srt' | 'vtt') => void;
}

function useActiveCaption(time: TimeStore, clips: Clip[]): string | null {
  return useSyncExternalStore(time.subscribe, () => {
    const now = time.get();
    return clips.find((c) => c.start <= now + EPS && now < clipEnd(c) - EPS)?.id ?? null;
  });
}

export function CaptionStyleEditor({
  project,
  fonts,
  change,
  commit,
}: Pick<CaptionsPanelProps, 'project' | 'fonts' | 'change' | 'commit'>) {
  const t = useT();
  const s = project.captionStyle;
  const live = (patch: Partial<CaptionStyle>) => change({ ...project, captionStyle: { ...s, ...patch } }, { record: false });
  const set = (patch: Partial<CaptionStyle>) => change({ ...project, captionStyle: { ...s, ...patch } }, { label: t('Caption style') });
  const done = () => commit(t('Caption style'));
  return (
    <>
      <Field label={t('Font')}>
        <Select small value={s.font} onChange={(font) => set({ font })} options={[...new Set([s.font, ...fonts])].map((f) => ({ value: f, label: f }))} />
      </Field>
      <div className="vd-grid2">
        <Field label={t('Size')}>
          <NumberField small value={s.size} min={8} max={400} suffix="px" onChange={(size) => set({ size })} />
        </Field>
        <Field label={t('Weight')}>
          <Select<number>
            small
            value={s.weight}
            onChange={(weight) => set({ weight })}
            options={[400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))}
          />
        </Field>
      </div>
      <div className="vd-swatches">
        <span className="vd-row-label">{t('Text')}</span>
        <ColorPicker value={s.color} alpha={false} onChange={(color) => live({ color })} onCommit={done} label={t('Text color')} />
        <Toggle checked={s.box} onChange={(box) => set({ box })} label={t('Background')} />
        {s.box && <ColorPicker value={s.boxColor} onChange={(boxColor) => live({ boxColor })} onCommit={done} label={t('Background color')} />}
      </div>
      <div className="vd-swatches">
        <span className="vd-row-label">{t('Outline')}</span>
        <ColorPicker value={s.outlineColor} alpha={false} onChange={(outlineColor) => live({ outlineColor })} onCommit={done} label={t('Outline color')} />
        <NumberField small value={s.outlineWidth} min={0} max={40} suffix="px" onChange={(outlineWidth) => set({ outlineWidth })} style={{ width: 80 }} />
      </div>
      <Field label={t('Position')}>
        <Segmented
          value={s.position}
          onChange={(position) => set({ position })}
          options={[
            { value: 'bottom', label: t('Bottom') },
            { value: 'top', label: t('Top') },
          ]}
        />
      </Field>
      <Slider label={t('Distance from edge')} value={Math.round(s.margin * 100)} min={0} max={40} onChange={(v) => live({ margin: v / 100 })} onCommit={done} format={(v) => `${v}%`} defaultValue={7} />
      <Slider label={t('Max width')} value={Math.round(s.maxWidth * 100)} min={30} max={100} onChange={(v) => live({ maxWidth: v / 100 })} onCommit={done} format={(v) => `${v}%`} defaultValue={84} />
    </>
  );
}

export const CaptionsPanel = memo(function CaptionsPanel(props: CaptionsPanelProps) {
  const t = useT();
  const { project, change, commit } = props;
  const clips = captionClips(project, true);
  const activeId = useActiveCaption(props.time, clips);
  const fps = project.settings.fps;
  return (
    <>
      <Button variant="primary" size="sm" icon={Sparkles} onClick={props.onAutoCaptions}>
        {t('Auto captions…')}
      </Button>
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" icon={Plus} onClick={props.onAdd} style={{ flex: 1 }}>
          {t('Add caption')}
        </Button>
        <IconButton icon={FileUp} label={t('Import SRT / VTT…')} onClick={props.onImport} />
        <DropdownButton
          className="icon-btn"
          title={t('Export captions')}
          entries={[
            { label: t('Export SRT…'), onClick: () => props.onExport('srt'), disabled: !clips.length },
            { label: t('Export WebVTT…'), onClick: () => props.onExport('vtt'), disabled: !clips.length },
          ]}
        >
          <Download size={16} />
        </DropdownButton>
      </div>
      <Panel title={t('Caption style')} defaultOpen={false}>
        <CaptionStyleEditor project={project} fonts={props.fonts} change={change} commit={commit} />
      </Panel>
      {!clips.length && <div className="vd-hint">{t('No captions yet. Generate them from speech, import an SRT/VTT file, or add them by hand at the playhead.')}</div>}
      <div className="vd-cap-list">
        {clips.slice(0, 2000).map((c) => (
          <div key={c.id} className={`vd-cap ${c.id === activeId || props.selection.includes(c.id) ? 'active' : ''}`}>
            <div className="row" style={{ gap: 4 }}>
              <span
                className="vd-cap-time grow"
                onClick={() => {
                  props.seek(c.start + 1e-3);
                  props.setSelection([c.id]);
                }}
                title={t('Go to this caption')}
              >
                {formatTimecode(c.start, fps)} → {formatTimecode(clipEnd(c), fps)}
              </span>
              <IconButton size="sm" icon={Trash2} label={t('Delete caption')} onClick={() => change(deleteClips(project, [c.id]), { label: t('Delete caption') })} />
            </div>
            <TextArea
              value={c.text ?? ''}
              rows={2}
              onChange={(e) => change(updateClip(project, c.id, (x) => ({ ...x, text: e.target.value, name: e.target.value.slice(0, 40) })), { record: false })}
              onBlur={() => commit(t('Edit caption'))}
            />
          </div>
        ))}
      </div>
    </>
  );
});
