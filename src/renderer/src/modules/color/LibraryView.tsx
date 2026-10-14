import { useState } from 'react';
import { Copy, FolderOpen, Import, MoreHorizontal, Pencil, Save, Search, Tag, Trash2 } from 'lucide-react';
import { Button, DropdownButton, EmptyState, TextInput, confirmDialog, promptDialog } from '../../components/ui';
import { useT } from '../../core/i18n';
import { textOn } from './colormath';
import { parseTags, searchLibrary, type SavedPalette } from './library';

interface Props {
  library: SavedPalette[];
  onSaveCurrent: () => void;
  onImport: () => void;
  onLoad: (p: SavedPalette) => void;
  onUpdate: (p: SavedPalette) => void;
  onDuplicate: (p: SavedPalette) => void;
  onDelete: (p: SavedPalette) => void;
  currentId: string | null;
}

/** Saved palettes with search, rename, tags, duplicate and delete. */
export function LibraryView({ library, onSaveCurrent, onImport, onLoad, onUpdate, onDuplicate, onDelete, currentId }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const results = searchLibrary(library, query);

  const rename = async (p: SavedPalette) => {
    const name = await promptDialog({ title: t('Rename palette'), defaultValue: p.name, confirmLabel: t('Rename') });
    if (name && name.trim()) onUpdate({ ...p, name: name.trim().slice(0, 120), updatedAt: Date.now() });
  };
  const editTags = async (p: SavedPalette) => {
    const text = await promptDialog({ title: t('Tags'), message: t('Separate tags with commas.'), defaultValue: p.tags.join(', '), confirmLabel: t('Save') });
    if (text !== null) onUpdate({ ...p, tags: parseTags(text), updatedAt: Date.now() });
  };
  const remove = async (p: SavedPalette) => {
    if (await confirmDialog({ title: t('Delete “{name}”?', { name: p.name }), message: t('This cannot be undone.'), confirmLabel: t('Delete'), danger: true })) onDelete(p);
  };

  return (
    <div className="co-library">
      <div className="co-library-bar">
        <div className="co-search">
          <Search size={14} />
          <TextInput small value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search by name, tag or #hex…')} aria-label={t('Search palettes')} />
        </div>
        <span className="faint">{t('{count} palettes', { count: library.length })}</span>
        <span className="spacer" />
        <Button size="sm" icon={Import} onClick={onImport}>
          {t('Import…')}
        </Button>
        <Button size="sm" variant="primary" icon={Save} onClick={onSaveCurrent}>
          {t('Save current palette')}
        </Button>
      </div>
      {!library.length ? (
        <div className="co-library-empty-wrap">
          <EmptyState title={t('Your library is empty')}>
            <span className="muted">{t('Save palettes you like to find them again later. They are stored on this computer.')}</span>
            <Button variant="primary" icon={Save} onClick={onSaveCurrent}>
              {t('Save current palette')}
            </Button>
          </EmptyState>
        </div>
      ) : !results.length ? (
        <div className="muted co-library-empty">{t('No palettes match “{query}”.', { query })}</div>
      ) : (
        <div className="co-library-grid">
          {results.map((p) => (
            <article key={p.id} className={`co-card ${p.id === currentId ? 'current' : ''}`}>
              <button type="button" className="co-card-strip" onClick={() => onLoad(p)} title={t('Open in the editor')}>
                {p.colors.map((c, i) => (
                  <span key={i} style={{ background: c.hex, color: textOn(c.hex) }}>
                    <em>{c.hex.slice(1).toUpperCase()}</em>
                  </span>
                ))}
              </button>
              <div className="co-card-meta">
                <div className="col" style={{ gap: 2, minWidth: 0 }}>
                  <strong className="co-card-name" title={p.name}>
                    {p.name}
                  </strong>
                  <span className="faint co-card-date">{new Date(p.updatedAt).toLocaleDateString()}</span>
                </div>
                <span className="spacer" />
                <DropdownButton
                  className="icon-btn sm"
                  title={t('More')}
                  entries={[
                    { label: t('Open in the editor'), icon: FolderOpen, onClick: () => onLoad(p) },
                    { label: t('Rename…'), icon: Pencil, onClick: () => void rename(p) },
                    { label: t('Edit tags…'), icon: Tag, onClick: () => void editTags(p) },
                    { label: t('Duplicate'), icon: Copy, onClick: () => onDuplicate(p) },
                    { type: 'separator' },
                    { label: t('Delete'), icon: Trash2, onClick: () => void remove(p) },
                  ]}
                >
                  <MoreHorizontal size={14} />
                </DropdownButton>
              </div>
              {p.tags.length > 0 && (
                <div className="co-card-tags">
                  {p.tags.map((tag) => (
                    <button key={tag} type="button" className="chip" onClick={() => setQuery(tag)}>
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
