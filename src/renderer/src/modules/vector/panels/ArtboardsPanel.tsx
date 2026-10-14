import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '../../../components/ui';
import { useT } from '../../../core/i18n';
import type { EditActions } from '../actions';
import { useEditor } from '../editor';

export function ArtboardsPanel({ actions }: { actions: EditActions }) {
  const t = useT();
  const core = useEditor();
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="list">
        {core.doc.artboards.map((ab, i) => (
          <div
            key={ab.id}
            className={`list-item ${ab.id === core.doc.activeArtboard ? 'selected' : ''}`}
            onClick={() => actions.setActiveArtboard(ab.id)}
            onDoubleClick={() => setRenaming(ab.id)}
          >
            <span className="faint mono" style={{ width: 18 }}>
              {i + 1}
            </span>
            {renaming === ab.id ? (
              <input
                className="input sm grow"
                autoFocus
                defaultValue={ab.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setRenaming(null);
                  const name = e.target.value.trim();
                  if (name && name !== ab.name) actions.updateArtboard(ab.id, { name: name.slice(0, 120) }, 'Rename artboard');
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ab.name}
              </span>
            )}
            <span className="faint" style={{ fontSize: 11 }}>
              {ab.width}×{ab.height}
            </span>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <IconButton icon={Plus} size="sm" label={t('Add artboard')} onClick={() => actions.addArtboard()} />
        <IconButton icon={Copy} size="sm" label={t('Duplicate artboard')} onClick={() => actions.duplicateArtboard(core.doc.activeArtboard)} />
        <IconButton icon={Trash2} size="sm" label={t('Delete artboard')} disabled={core.doc.artboards.length <= 1} onClick={() => actions.deleteArtboard(core.doc.activeArtboard)} />
        <span className="faint" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {t('Double-click to rename')}
        </span>
      </div>
    </div>
  );
}
