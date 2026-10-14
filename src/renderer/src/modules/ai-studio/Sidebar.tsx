import { useState } from 'react';
import { CopyPlus, Download, FileDown, MessageSquarePlus, Pencil, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import { Button, IconButton, TextInput, confirmDialog, promptDialog, useContextMenu, type MenuEntry } from '../../components/ui';
import { useT } from '../../core/i18n';
import { useStudio } from './store';
import type { Conversation } from './types';

interface Props {
  busy: Set<string>;
  onNew: () => void;
  onExportMarkdown: (c: Conversation) => void;
  onSaveProject: (c: Conversation) => void;
  onClearAll: () => void;
}

function matches(c: Conversation, words: string[]): boolean {
  if (!words.length) return true;
  const hay = `${c.title}\n${c.messages.map((m) => m.text).join('\n')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function groupLabel(ts: number, t: (k: string) => string): string {
  const day = 86_400_000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return t('Today');
  if (ts >= startOfToday - day) return t('Yesterday');
  if (ts >= startOfToday - 7 * day) return t('Previous 7 days');
  return t('Older');
}

/** Conversation list: new, search, rename, pin, duplicate, export and delete. */
export function Sidebar({ busy, onNew, onExportMarkdown, onSaveProject, onClearAll }: Props) {
  const t = useT();
  const conversations = useStudio((s) => s.conversations);
  const currentId = useStudio((s) => s.currentId);
  const [query, setQuery] = useState('');
  const ctx = useContextMenu();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = conversations.filter((c) => matches(c, words)).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);

  const rename = async (c: Conversation) => {
    const title = await promptDialog({ title: t('Rename chat'), defaultValue: c.title || t('New chat'), confirmLabel: t('Rename') });
    if (title?.trim()) useStudio.getState().updateConversation(c.id, (x) => ({ ...x, title: title.trim().slice(0, 200) }), false);
  };
  const remove = async (c: Conversation) => {
    if (await confirmDialog({ title: t('Delete “{name}”?', { name: c.title || t('New chat') }), message: t('This cannot be undone.'), confirmLabel: t('Delete'), danger: true })) {
      useStudio.getState().removeConversation(c.id);
    }
  };
  const entries = (c: Conversation): MenuEntry[] => [
    { label: t('Rename…'), icon: Pencil, onClick: () => void rename(c) },
    { label: c.pinned ? t('Unpin') : t('Pin to top'), icon: c.pinned ? PinOff : Pin, onClick: () => useStudio.getState().updateConversation(c.id, (x) => ({ ...x, pinned: !x.pinned }), false) },
    { label: t('Duplicate'), icon: CopyPlus, onClick: () => useStudio.getState().duplicateConversation(c.id, t('(copy)')) },
    { type: 'separator' },
    { label: t('Export as Markdown…'), icon: FileDown, onClick: () => onExportMarkdown(c) },
    { label: t('Save as Ultima file…'), icon: Download, onClick: () => onSaveProject(c) },
    { type: 'separator' },
    { label: t('Delete'), icon: Trash2, onClick: () => void remove(c) },
  ];

  let lastGroup = '';
  return (
    <div className="as-sidebar">
      <div className="as-sidebar-top">
        <Button variant="primary" icon={MessageSquarePlus} block onClick={onNew}>
          {t('New chat')}
        </Button>
        <div className="as-search">
          <Search size={13} />
          <TextInput small value={query} placeholder={t('Search chats…')} onChange={(e) => setQuery(e.target.value)} aria-label={t('Search chats')} />
        </div>
      </div>
      <div className="as-conv-list" role="listbox" aria-label={t('Chats')}>
        {!list.length && <div className="faint as-empty-list">{query ? t('No chats match your search.') : t('Your chats will appear here.')}</div>}
        {list.map((c) => {
          const group = c.pinned ? t('Pinned') : groupLabel(c.updatedAt, t);
          const header = group !== lastGroup ? group : null;
          lastGroup = group;
          return (
            <div key={c.id}>
              {header && <div className="as-group">{header}</div>}
              <div
                role="option"
                aria-selected={c.id === currentId}
                className={`as-conv ${c.id === currentId ? 'active' : ''}`}
                onClick={() => useStudio.getState().select(c.id)}
                onDoubleClick={() => void rename(c)}
                onContextMenu={ctx.open(() => entries(c))}
                title={c.title || t('New chat')}
              >
                {busy.has(c.id) && <span className="as-dot" aria-label={t('Answering…')} />}
                {c.pinned && <Pin size={11} className="faint" />}
                <span className="as-conv-title">{c.title || t('New chat')}</span>
                <span className="as-conv-actions">
                  <IconButton icon={Pencil} size="sm" iconSize={12} label={t('Rename')} onClick={(e) => {
                    e.stopPropagation();
                    void rename(c);
                  }} />
                  <IconButton icon={Trash2} size="sm" iconSize={12} label={t('Delete')} onClick={(e) => {
                    e.stopPropagation();
                    void remove(c);
                  }} />
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="as-sidebar-bottom">
        <Button size="sm" variant="ghost" icon={Trash2} onClick={onClearAll} disabled={!conversations.length}>
          {t('Clear all data…')}
        </Button>
      </div>
      {ctx.element}
    </div>
  );
}
