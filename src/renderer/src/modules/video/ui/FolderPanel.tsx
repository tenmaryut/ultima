import { memo, useEffect, useRef, useState } from 'react';
import { FolderOpen, FolderPlus, Image as ImageIcon, KeyRound, ListEnd, Music, Plus, RefreshCw, Unlink, Video } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/format';
import { Badge, Button, IconButton, Spinner, useContextMenu, type MenuEntry } from '../../../components/ui';
import type { FolderEntry, FolderLibrary, LinkedFolder } from '../folders';
import { DND_MIME, setDragPayload } from '../dnd';
import { DEFAULT_STILL_DURATION } from '../presets';

/* Linked folders in the media bin: their clips are listed by themselves (newest first) and can be dragged in. */

const KIND_ICON = { video: Video, audio: Music, image: ImageIcon };
const PAGE = 40;

interface FolderPanelProps {
  folders: FolderLibrary;
  folderVersion: number;
  /** Ids already in the project (folder clips keep their id when imported). */
  inProject: Set<string>;
  onLink: () => void;
  onUnlink: (id: string) => void;
  onAllow: (id: string) => void;
  onRefresh: () => void;
  onAdd: (entryId: string, where: 'playhead' | 'end' | 'bin') => void;
}

/** Asks for the file's length and poster once the tile is on screen (a folder can hold thousands of files). */
function useWhenVisible(onVisible: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((list) => {
      if (list.some((e) => e.isIntersecting)) {
        cb.current();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

const FolderTile = memo(function FolderTile({ entry, folders, used, onAdd, menu }: { entry: FolderEntry; folders: FolderLibrary; used: boolean; onAdd: FolderPanelProps['onAdd']; menu: (e: FolderEntry) => MenuEntry[] }) {
  const t = useT();
  const ctx = useContextMenu();
  const ref = useWhenVisible(() => folders.ensureInfo(entry));
  const Icon = KIND_ICON[entry.kind];
  const date = new Date(entry.lastModified).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div
      ref={ref}
      className={`vd-bin-item ${entry.unreadable ? 'missing' : ''}`}
      draggable={!entry.unreadable}
      title={`${entry.path}\n${t('Drag onto the timeline · double-click to insert at the playhead')}`}
      onDragStart={(e) => {
        setDragPayload({ kind: 'folder', entryId: entry.id, duration: entry.kind === 'image' ? DEFAULT_STILL_DURATION : entry.duration ?? 5 });
        e.dataTransfer.setData(DND_MIME, entry.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDragEnd={() => setDragPayload(null)}
      onDoubleClick={() => onAdd(entry.id, 'playhead')}
      onContextMenu={ctx.open(() => menu(entry))}
    >
      <div className="vd-bin-thumb">
        {entry.thumb ? <img src={entry.thumb} alt="" draggable={false} /> : <Icon size={20} />}
        {entry.duration !== undefined && entry.kind !== 'image' && <span className="vd-bin-dur">{formatTime(entry.duration, false)}</span>}
      </div>
      <div className="vd-bin-name">{entry.name}</div>
      <div className="row" style={{ gap: 4, minWidth: 0 }}>
        <span className="vd-bin-meta grow">{date}</span>
        {used && <Badge tone="ok">{t('In project')}</Badge>}
        {entry.unreadable && <Badge tone="err">{t('Unreadable')}</Badge>}
      </div>
      {ctx.element}
    </div>
  );
});

function FolderBlock({ folder, entries, props }: { folder: LinkedFolder; entries: FolderEntry[]; props: FolderPanelProps }) {
  const t = useT();
  const [shown, setShown] = useState(PAGE);
  const menu = (e: FolderEntry): MenuEntry[] => [
    { label: t('Insert at playhead'), icon: Plus, onClick: () => props.onAdd(e.id, 'playhead') },
    { label: t('Append to the end'), icon: ListEnd, onClick: () => props.onAdd(e.id, 'end') },
    { label: t('Add to the media bin'), icon: FolderPlus, onClick: () => props.onAdd(e.id, 'bin'), disabled: props.inProject.has(e.id) },
  ];
  return (
    <div className="vd-folder">
      <div className="vd-folder-head row">
        <FolderOpen size={14} />
        <span className="grow vd-bin-name" title={folder.name}>
          {folder.name}
        </span>
        {folder.scanning ? <Spinner size={12} /> : <span className="faint">{t('{count} files', { count: entries.length })}</span>}
        <IconButton size="sm" icon={RefreshCw} label={t('Look for new files')} onClick={props.onRefresh} disabled={folder.scanning} />
        <IconButton size="sm" icon={Unlink} label={t('Unlink this folder')} onClick={() => props.onUnlink(folder.id)} />
      </div>
      {folder.access !== 'granted' ? (
        <Button size="sm" icon={KeyRound} onClick={() => props.onAllow(folder.id)}>
          {t('Allow Ultima to read this folder again')}
        </Button>
      ) : folder.error ? (
        <div className="vd-note err">{folder.error}</div>
      ) : entries.length === 0 && !folder.scanning ? (
        <div className="vd-hint">{t('No videos, audio or pictures in this folder yet.')}</div>
      ) : (
        <div className="vd-bin-grid">
          {entries.slice(0, shown).map((e) => (
            <FolderTile key={e.id} entry={e} folders={props.folders} used={props.inProject.has(e.id)} onAdd={props.onAdd} menu={menu} />
          ))}
        </div>
      )}
      {folder.access === 'granted' && entries.length > shown && (
        <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
          {t('Show {count} more', { count: Math.min(PAGE, entries.length - shown) })}
        </Button>
      )}
    </div>
  );
}

export const FolderPanel = memo(function FolderPanel(props: FolderPanelProps) {
  const t = useT();
  const { folders } = props;
  return (
    <>
      {folders.folders.map((f) => (
        <FolderBlock key={f.id} folder={f} entries={folders.entries.filter((e) => e.folderId === f.id)} props={props} />
      ))}
      <Button size="sm" icon={FolderPlus} onClick={props.onLink}>
        {folders.folders.length ? t('Link another folder…') : t('Link a folder…')}
      </Button>
      {!folders.folders.length && (
        <div className="vd-hint">{t('Link the folder where your clips are saved (for example your game recordings): its videos show up here by themselves, new ones too, and the AI can look at them and use them.')}</div>
      )}
    </>
  );
});
