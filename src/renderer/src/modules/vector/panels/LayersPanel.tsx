import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Code,
  Eye,
  EyeOff,
  Folder,
  Hexagon,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Minus,
  Spline,
  Square,
  Star,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '../../../core/i18n';
import { useEditor } from '../editor';
import type { ObjectType, VObject } from '../model';
import { locate, mapTree, moveObjectTo } from '../ops';

const ICONS: Record<ObjectType, LucideIcon> = {
  rect: Square,
  ellipse: Circle,
  polygon: Hexagon,
  star: Star,
  line: Minus,
  path: Spline,
  text: Type,
  image: ImageIcon,
  group: Folder,
  raw: Code,
};

type DropPos = 'before' | 'after' | 'inside';

export function LayersPanel() {
  const t = useT();
  const core = useEditor();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const selected = new Set(core.selection);

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const setFlag = (id: string, key: 'visible' | 'locked', value: boolean) =>
    core.update((d) => ({ ...d, objects: mapTree(d.objects, (o) => (o.id === id ? { ...o, [key]: value } : o)) }), key === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock');

  const onDrop = (target: VObject, pos: DropPos) => {
    if (!dragId || dragId === target.id) return;
    core.update((d) => {
      if (pos === 'inside' && target.type === 'group') return { ...d, objects: moveObjectTo(d.objects, dragId, target.id, target.children.length) };
      const loc = locate(d.objects, target.id);
      if (!loc) return d;
      // the list shows the topmost object first: "before" = above = higher index
      return { ...d, objects: moveObjectTo(d.objects, dragId, loc.parentId, pos === 'before' ? loc.index + 1 : loc.index) };
    }, 'Reorder');
  };

  const rows: ReactNode[] = [];
  const walk = (list: VObject[], depth: number, parentHidden: boolean) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      const Icon = ICONS[o.type];
      const isOpen = expanded.has(o.id);
      const dim = parentHidden || !o.visible;
      rows.push(
        <div
          key={o.id}
          className={`list-item vc-layer ${selected.has(o.id) ? 'selected' : ''} ${dim ? 'dim' : ''} ${drop?.id === o.id ? `drop-${drop.pos}` : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={renaming !== o.id}
          onDragStart={(e) => {
            setDragId(o.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/x-ultima-layer', o.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDrop(null);
          }}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            const pos: DropPos = o.type === 'group' && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after';
            if (drop?.id !== o.id || drop.pos !== pos) setDrop({ id: o.id, pos });
          }}
          onDragLeave={() => setDrop((d) => (d?.id === o.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            if (drop) onDrop(o, drop.pos);
            setDrop(null);
            setDragId(null);
          }}
          onClick={(e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) core.setSelection(selected.has(o.id) ? core.selection.filter((s) => s !== o.id) : [...core.selection, o.id]);
            else core.setSelection([o.id]);
          }}
          onDoubleClick={() => setRenaming(o.id)}
        >
          {o.type === 'group' ? (
            <button
              type="button"
              className="vc-layer-toggle"
              aria-label={isOpen ? t('Collapse') : t('Expand')}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(o.id);
              }}
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="vc-layer-toggle" />
          )}
          <Icon size={13} className="vc-layer-icon" />
          {renaming === o.id ? (
            <input
              className="input sm grow"
              autoFocus
              defaultValue={o.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const name = e.target.value.trim();
                setRenaming(null);
                if (name && name !== o.name) core.update((d) => ({ ...d, objects: mapTree(d.objects, (x) => (x.id === o.id ? { ...x, name: name.slice(0, 200) } : x)) }), 'Rename');
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <span className="grow vc-layer-name" title={o.name}>
              {o.name}
            </span>
          )}
          <button
            type="button"
            className="vc-layer-btn"
            aria-label={o.visible ? t('Hide') : t('Show')}
            title={o.visible ? t('Hide') : t('Show')}
            onClick={(e) => {
              e.stopPropagation();
              setFlag(o.id, 'visible', !o.visible);
            }}
          >
            {o.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button
            type="button"
            className={`vc-layer-btn ${o.locked ? 'on' : ''}`}
            aria-label={o.locked ? t('Unlock') : t('Lock')}
            title={o.locked ? t('Unlock') : t('Lock')}
            onClick={(e) => {
              e.stopPropagation();
              setFlag(o.id, 'locked', !o.locked);
              if (!o.locked) core.setSelection(core.selection.filter((s) => s !== o.id));
            }}
          >
            {o.locked ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
        </div>,
      );
      if (o.type === 'group' && isOpen) walk(o.children, depth + 1, dim);
    }
  };
  walk(core.doc.objects, 0, false);

  // expand groups that contain the selection
  const objects = core.doc.objects;
  const selection = core.selection;
  useEffect(() => {
    const needOpen = selection.flatMap((id) => {
      const out: string[] = [];
      let loc = locate(objects, id);
      while (loc?.parentId) {
        out.push(loc.parentId);
        loc = locate(objects, loc.parentId);
      }
      return out;
    });
    if (needOpen.length) setExpanded((s) => (needOpen.every((id) => s.has(id)) ? s : new Set([...s, ...needOpen])));
  }, [selection, objects]);

  return (
    <div className="list vc-layers" onDragOver={(e) => dragId && e.preventDefault()}>
      {rows.length ? rows : <div className="faint" style={{ padding: 8 }}>{t('No objects yet. Draw something!')}</div>}
    </div>
  );
}

