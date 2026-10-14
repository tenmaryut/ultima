import { Flag, Settings2, Trash2 } from 'lucide-react';
import type { Project } from '../types';
import { useT } from '../../../core/i18n';
import { Button, IconButton, Kbd, Panel } from '../../../components/ui';
import { removeMarker, timelineDuration } from '../model';
import { formatTimecode } from '../time';

export function ProjectPanel({
  project,
  change,
  onOpenSettings,
  onSeek,
  onRenameMarker,
}: {
  project: Project;
  change: (next: Project, opts?: { record?: boolean; label?: string }) => void;
  onOpenSettings: () => void;
  onSeek: (t: number) => void;
  onRenameMarker: (id: string) => void;
}) {
  const t = useT();
  const { width, height, fps, background } = project.settings;
  const dur = timelineDuration(project);
  const shortcuts: [string, string][] = [
    ['Space', t('Play / pause')],
    ['J K L', t('Shuttle back / stop / forward')],
    ['← →', t('Previous / next frame')],
    ['↑ ↓', t('Previous / next edit point')],
    ['Home End', t('Go to start / end')],
    ['S · Ctrl+K', t('Split at playhead')],
    ['Shift+Delete', t('Ripple delete')],
    ['M', t('Add marker')],
    ['I O', t('Set in / out (work area)')],
    ['V C', t('Selection / razor tool')],
    ['N', t('Toggle snapping')],
    ['Ctrl+C Ctrl+V', t('Copy / paste at playhead')],
    ['Ctrl+D', t('Duplicate')],
    ['Ctrl+wheel', t('Zoom the timeline')],
    ['Alt+click', t('Select one side of a linked clip')],
  ];
  return (
    <div className="vd-inspector">
      <Panel title={t('Project')}>
        <div className="vd-kv">
          <span>{t('Resolution')}</span>
          <span>
            {width} × {height}
          </span>
          <span>{t('Frame rate')}</span>
          <span>{fps} fps</span>
          <span>{t('Background')}</span>
          <span className="row" style={{ gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background, border: '1px solid var(--border-strong)' }} />
            {background}
          </span>
          <span>{t('Duration')}</span>
          <span>{formatTimecode(dur, fps)}</span>
          <span>{t('Clips')}</span>
          <span>{project.clips.length}</span>
        </div>
        <Button size="sm" icon={Settings2} onClick={onOpenSettings}>
          {t('Project settings…')}
        </Button>
        <div className="vd-hint">{t('Select a clip on the timeline to edit its position, speed, volume, color, transition or text.')}</div>
      </Panel>
      <Panel title={t('Markers')} defaultOpen={project.markers.length > 0}>
        {!project.markers.length && <div className="vd-hint">{t('Press M to drop a marker at the playhead.')}</div>}
        <div className="list">
          {project.markers.map((m) => (
            <div key={m.id} className="list-item" onClick={() => onSeek(m.time)} onDoubleClick={() => onRenameMarker(m.id)} title={t('Double-click to rename')}>
              <Flag size={12} color="var(--warning)" />
              <span className="mono faint" style={{ fontSize: 11 }}>
                {formatTimecode(m.time, fps)}
              </span>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.label || t('Marker')}
              </span>
              <IconButton
                size="sm"
                icon={Trash2}
                label={t('Delete marker')}
                onClick={(e) => {
                  e.stopPropagation();
                  change(removeMarker(project, m.id), { label: t('Delete marker') });
                }}
              />
            </div>
          ))}
        </div>
      </Panel>
      <Panel title={t('Keyboard shortcuts')} defaultOpen={false}>
        <div className="vd-kv" style={{ fontSize: 11.5 }}>
          {shortcuts.map(([k, label]) => (
            <span key={k} style={{ display: 'contents' }}>
              <span>
                <Kbd>{k}</Kbd>
              </span>
              <span>{label}</span>
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
