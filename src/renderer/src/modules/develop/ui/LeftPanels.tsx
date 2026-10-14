import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Redo2, Undo2 } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { IconButton, Panel, confirmDialog, promptDialog, useContextMenu } from '../../../components/ui';
import { applyPreset } from '../ops';
import { BUILTIN_PRESETS, usePresetStore, type Preset } from '../presets';
import { jumpToHistory, redo, selectedIds, setStore, undo, useDevelop } from '../store';
import type { Photo } from '../types';

function PresetGroup({ title, presets, onApply, onMenu }: { title: string; presets: Preset[]; onApply: (p: Preset) => void; onMenu: (e: React.MouseEvent, p: Preset) => void }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  if (!presets.length) return null;
  return (
    <div>
      <div className="dv-group-title" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {title}
      </div>
      {open &&
        presets.map((p) => (
          <div
            key={p.id}
            className="dv-list-item"
            role="button"
            tabIndex={0}
            onMouseEnter={() => setStore({ hoverPreset: p })}
            onMouseLeave={() => setStore({ hoverPreset: null })}
            onClick={() => onApply(p)}
            onKeyDown={(e) => e.key === 'Enter' && onApply(p)}
            onContextMenu={(e) => onMenu(e, p)}
          >
            {p.builtin ? t(p.name) : p.name}
          </div>
        ))}
    </div>
  );
}

export function PresetsPanel({ photo, onSavePreset }: { photo?: Photo; onSavePreset: () => void }) {
  const t = useT();
  const user = usePresetStore((s) => s.user);
  const selectedCount = useDevelop((s) => s.selected.length);
  const menu = useContextMenu();
  const apply = (p: Preset) => {
    if (!photo) return;
    setStore({ hoverPreset: null });
    void applyPreset([photo.id], p);
  };
  const onMenu = (e: React.MouseEvent, p: Preset) => {
    const entries = [
      { label: t('Apply to this photo'), onClick: () => apply(p), disabled: !photo },
      { label: t('Apply to {count} selected photo(s)', { count: Math.max(1, selectedCount) }), onClick: () => void applyPreset(selectedIds(), p), disabled: !photo },
    ];
    const userEntries = p.builtin
      ? []
      : [
          { type: 'separator' as const },
          {
            label: t('Update with current settings'),
            disabled: !photo,
            onClick: () => {
              if (!photo) return;
              const keys = Object.keys(p.settings);
              const next: Record<string, unknown> = {};
              for (const k of keys) next[k] = (photo.settings as unknown as Record<string, unknown>)[k];
              usePresetStore.getState().replace(usePresetStore.getState().user.map((x) => (x.id === p.id ? { ...x, settings: next as Preset['settings'] } : x)));
            },
          },
          {
            label: t('Rename…'),
            onClick: async () => {
              const name = await promptDialog({ title: t('Rename preset'), defaultValue: p.name, confirmLabel: t('Rename') });
              if (name?.trim()) usePresetStore.getState().rename(p.id, name);
            },
          },
          {
            label: t('Delete'),
            onClick: async () => {
              if (await confirmDialog({ title: t('Delete preset “{name}”?', { name: p.name }), confirmLabel: t('Delete'), danger: true })) usePresetStore.getState().remove(p.id);
            },
          },
        ];
    menu.open([...entries, ...userEntries])(e);
  };
  const groups: { title: string; list: Preset[] }[] = [
    { title: t('User Presets'), list: user },
    { title: t('Color'), list: BUILTIN_PRESETS.filter((p) => p.category === 'Color') },
    { title: t('Creative'), list: BUILTIN_PRESETS.filter((p) => p.category === 'Creative') },
    { title: t('Black & White'), list: BUILTIN_PRESETS.filter((p) => p.category === 'B&W') },
  ];
  return (
    <Panel title={t('Presets')} actions={<IconButton icon={Plus} size="sm" label={t('Save current settings as a preset')} onClick={onSavePreset} disabled={!photo} />}>
      <div className="dv-hint">{t('Hover to preview, click to apply. Right-click for more.')}</div>
      <div style={{ margin: '0 -6px' }}>
        {groups.map((g) => (
          <PresetGroup key={g.title} title={g.title} presets={g.list} onApply={apply} onMenu={onMenu} />
        ))}
      </div>
      {menu.element}
    </Panel>
  );
}

export function HistoryPanel({ photo }: { photo?: Photo }) {
  const t = useT();
  const history = useDevelop((s) => (photo ? s.histories[photo.id] : undefined));
  if (!photo || !history) return null;
  const past = history.past;
  const future = history.future;
  return (
    <Panel
      title={t('History')}
      actions={
        <>
          <IconButton icon={Undo2} size="sm" label={`${t('Undo')} (Ctrl+Z)`} disabled={!past.length} onClick={() => undo(photo.id)} />
          <IconButton icon={Redo2} size="sm" label={`${t('Redo')} (Ctrl+Shift+Z)`} disabled={!future.length} onClick={() => redo(photo.id)} />
        </>
      }
    >
      <div style={{ margin: '0 -6px' }}>
        {future.map((entry, k) => (
          <div key={`f${k}`} className="dv-list-item future" onClick={() => jumpToHistory(photo.id, past.length + future.length - k - 1)} title={t('Redo to here')}>
            {entry.label}
          </div>
        ))}
        {past
          .map((entry, i) => ({ entry, i }))
          .reverse()
          .map(({ entry, i }) => (
            <div key={`p${i}`} className={`dv-list-item ${i === past.length - 1 ? 'current' : ''}`} onClick={() => jumpToHistory(photo.id, i)}>
              {entry.label}
            </div>
          ))}
        <div className={`dv-list-item ${past.length === 0 ? 'current' : ''}`} onClick={() => jumpToHistory(photo.id, -1)}>
          {t('Import')}
        </div>
      </div>
    </Panel>
  );
}
