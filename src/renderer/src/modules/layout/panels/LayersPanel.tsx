import { useState } from 'react';
import { Circle, Eye, EyeOff, Image as ImageIcon, Lock, LockOpen, Minus, Square, Star, Table2, Triangle, Type } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { IconButton, Panel } from '../../../components/ui';
import { moveFrameToIndex } from '../ops';
import type { Frame } from '../types';
import type { LayoutEditor } from '../useLayoutEditor';

function iconFor(f: Frame) {
  if (f.type === 'text') return Type;
  if (f.type === 'image') return ImageIcon;
  if (f.type === 'table') return Table2;
  switch (f.shape) {
    case 'ellipse':
      return Circle;
    case 'line':
      return Minus;
    case 'triangle':
      return Triangle;
    case 'star':
      return Star;
    default:
      return Square;
  }
}

export function frameLabel(f: Frame, t: (k: string) => string): string {
  if (f.name) return f.name;
  if (f.type === 'text') return f.text.split('\n')[0].slice(0, 40) || t('Text');
  if (f.type === 'image') return t('Image');
  if (f.type === 'table') return t('Table');
  return t({ rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', triangle: 'Triangle', diamond: 'Diamond', star: 'Star' }[f.shape]);
}

export function LayersPanel({ ed }: { ed: LayoutEditor }) {
  const t = useT();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const frames = ed.frames;
  const list = [...frames].reverse();
  return (
    <Panel title={t('Layers')}>
      {!frames.length && <div className="faint ly-hint">{t('No objects on this page yet.')}</div>}
      <div className="list ly-layers">
        {list.map((f, i) => {
          const Icon = iconFor(f);
          const zIndex = frames.length - 1 - i;
          return (
            <div
              key={f.id}
              className={`list-item ly-layer ${ed.selection.includes(f.id) ? 'selected' : ''} ${dropIndex === i ? 'drop' : ''} ${f.hidden ? 'hidden-frame' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragId(f.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-ultima-layer', f.id);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropIndex(i);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== f.id) ed.set(moveFrameToIndex(ed.current(), ed.pageId, dragId, zIndex), 'Reorder');
                setDragId(null);
                setDropIndex(null);
              }}
              onClick={(e) => (f.locked ? ed.setSelection([f.id]) : ed.select([f.id], e.shiftKey ? 'toggle' : 'replace'))}
              onDoubleClick={() => f.type === 'text' && !f.locked && ed.beginEdit(f.id)}
            >
              <Icon size={13} className="faint" />
              <span className="grow ly-layer-name">{frameLabel(f, t)}</span>
              {f.groupId && <span className="badge">{t('group')}</span>}
              <IconButton icon={f.hidden ? EyeOff : Eye} size="sm" iconSize={12} label={f.hidden ? t('Show') : t('Hide')} onClick={(e) => { e.stopPropagation(); ed.toggleHidden(f.id); }} />
              <IconButton icon={f.locked ? Lock : LockOpen} size="sm" iconSize={12} label={f.locked ? t('Unlock') : t('Lock')} active={f.locked} onClick={(e) => { e.stopPropagation(); ed.toggleLock([f.id]); }} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
