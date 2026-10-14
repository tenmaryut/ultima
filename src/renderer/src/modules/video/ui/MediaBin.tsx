import { memo } from 'react';
import { AlertTriangle, FileUp, FolderOpen, Image as ImageIcon, Link, ListEnd, Music, Plus, RefreshCw, Trash2, Video } from 'lucide-react';
import type { MediaRef, Project } from '../types';
import { useT } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/format';
import { Badge, Button, useContextMenu, type MenuEntry } from '../../../components/ui';
import type { MediaLibrary } from '../media';
import { DND_MIME, setDragPayload } from '../dnd';
import { DEFAULT_STILL_DURATION } from '../presets';

interface MediaBinProps {
  project: Project;
  lib: MediaLibrary;
  libVersion: number;
  canConvert: boolean;
  onImport: () => void;
  onAdd: (mediaId: string, where: 'playhead' | 'end') => void;
  onRemove: (mediaId: string) => void;
  onRelink: () => void;
  onConvert: (mediaId: string) => void;
}

const KIND_ICON = { video: Video, audio: Music, image: ImageIcon };

export const MediaBin = memo(function MediaBin(props: MediaBinProps) {
  const t = useT();
  const ctx = useContextMenu();
  const { project, lib } = props;
  const missing = project.media.filter((m) => !lib.has(m.id));

  const menu = (m: MediaRef): MenuEntry[] => {
    const item = lib.get(m.id);
    const entries: MenuEntry[] = [
      { label: t('Insert at playhead'), icon: Plus, onClick: () => props.onAdd(m.id, 'playhead'), disabled: !item },
      { label: t('Append to the end'), icon: ListEnd, onClick: () => props.onAdd(m.id, 'end'), disabled: !item },
    ];
    if (!item) entries.push({ label: t('Relink missing media…'), icon: Link, onClick: props.onRelink });
    if (item && !item.playable && m.kind !== 'image' && props.canConvert) entries.push({ label: t('Convert with FFmpeg'), icon: RefreshCw, onClick: () => props.onConvert(m.id) });
    entries.push({ type: 'separator' }, { label: t('Remove from project'), icon: Trash2, onClick: () => props.onRemove(m.id) });
    return entries;
  };

  return (
    <>
      <div className="row">
        <Button variant="primary" size="sm" icon={FolderOpen} onClick={props.onImport} style={{ flex: 1 }}>
          {t('Import media…')}
        </Button>
      </div>
      {missing.length > 0 && (
        <div className="vd-note err row" style={{ gap: 6 }}>
          <AlertTriangle size={14} color="var(--danger)" />
          <span className="grow">{t('{count} missing file(s)', { count: missing.length })}</span>
          <Button size="sm" onClick={props.onRelink}>
            {t('Relink…')}
          </Button>
        </div>
      )}
      {project.media.length === 0 ? (
        <div className="vd-dropzone">
          <FileUp size={22} />
          <span>{t('Drop videos, audio and images here, or use Import.')}</span>
        </div>
      ) : (
        <div className="vd-bin-grid">
          {project.media.map((m) => {
            const item = lib.get(m.id);
            const Icon = KIND_ICON[m.kind];
            const meta =
              m.kind === 'audio'
                ? t('Audio')
                : m.kind === 'image'
                  ? `${m.width}×${m.height}`
                  : `${m.width}×${m.height}${m.hasAudio ? '' : ` · ${t('no sound')}`}`;
            return (
              <div
                key={m.id}
                className={`vd-bin-item ${item ? '' : 'missing'}`}
                draggable={Boolean(item)}
                title={m.path ?? m.name}
                onDragStart={(e) => {
                  setDragPayload({ kind: 'media', mediaId: m.id, duration: m.kind === 'image' ? DEFAULT_STILL_DURATION : m.duration });
                  e.dataTransfer.setData(DND_MIME, m.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => setDragPayload(null)}
                onDoubleClick={() => item && props.onAdd(m.id, 'playhead')}
                onContextMenu={ctx.open(() => menu(m))}
              >
                <div className="vd-bin-thumb">
                  {item?.thumb ? <img src={item.thumb} alt="" draggable={false} /> : <Icon size={22} />}
                  {m.kind !== 'image' && <span className="vd-bin-dur">{formatTime(m.duration, false)}</span>}
                </div>
                <div className="vd-bin-name">{m.name}</div>
                <div className="row" style={{ gap: 4, minWidth: 0 }}>
                  <span className="vd-bin-meta grow">{meta}</span>
                  {!item && <Badge tone="err">{t('Missing')}</Badge>}
                  {item && !item.playable && m.kind !== 'image' && (
                    <span title={t('This file can’t be played in the preview. Convert it with FFmpeg (desktop app).')}>
                      <Badge tone="warn">{t('No preview')}</Badge>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="vd-hint">{t('Drag clips onto the timeline · double-click to insert at the playhead · right-click for more.')}</div>
      {ctx.element}
    </>
  );
});
