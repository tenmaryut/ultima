import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { useAppStore, type ModuleId } from '../../core/store';
import { getModule } from '../../core/modules';
import { useT } from '../../core/i18n';
import { useUnsavedWork } from '../../core/unsaved';
import { MenuBar, type MenuEntry } from '../ui/Menu';
import { IconButton } from '../ui';

export interface ModuleLayoutProps {
  moduleId: ModuleId;
  /** Document title shown in the header (e.g. "Untitled-1.png"). */
  title?: string;
  /** Unsaved changes indicator. */
  dirty?: boolean;
  /** Unsaved work anywhere in the module (defaults to `dirty`); closing the window asks first. */
  unsaved?: boolean;
  menus?: { label: string; entries: MenuEntry[] | (() => MenuEntry[]) }[];
  /** Contextual controls in the header (tool options, zoom, ...). */
  toolbar?: ReactNode;
  /** Buttons at the right end of the header (Export, ...). */
  actions?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  bottom?: ReactNode;
  status?: ReactNode;
  /** The module's AIAssistantPanel; shown as a right column when the AI panel is open. */
  ai?: ReactNode;
  rightWidth?: number;
  bottomHeight?: number;
  /** Lets the user drag the bottom panel border (timelines). */
  resizableBottom?: boolean;
  children: ReactNode;
  centerStyle?: CSSProperties;
}

/**
 * Standard module frame: header (title, menus, contextual toolbar, actions, AI toggle),
 * left tool palette, center canvas area, right panels, optional bottom panel (timeline)
 * and status bar. Every editor module uses it so the suite feels like one app.
 */
export function ModuleLayout(props: ModuleLayoutProps) {
  const t = useT();
  useUnsavedWork(props.moduleId, props.unsaved ?? Boolean(props.dirty));
  const mod = getModule(props.moduleId);
  const aiOpen = useAppStore((s) => s.aiPanelOpen);
  const toolAccent = useAppStore((s) => s.accentMode !== 'gradient');
  const toggleAI = useAppStore((s) => s.toggleAIPanel);
  const [bottomHeight, setBottomHeight] = useState(props.bottomHeight ?? 220);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    if (props.bottomHeight) setBottomHeight(props.bottomHeight);
  }, [props.bottomHeight]);

  return (
    <div className="mod" style={toolAccent ? ({ '--accent': mod.color, '--accent-hover': mod.color } as CSSProperties) : undefined}>
      <header className="mod-header">
        <div className="mod-title">
          <span className="badge-dot" />
          <span>{t(mod.name)}</span>
          {props.title && (
            <span className="faint" style={{ fontWeight: 400, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={props.title}>
              — {props.title}
              {props.dirty ? ' •' : ''}
            </span>
          )}
        </div>
        {props.menus && <MenuBar menus={props.menus} />}
        {props.toolbar && (
          <>
            <span className="vsep" />
            <HeaderToolbar>{props.toolbar}</HeaderToolbar>
          </>
        )}
        {!props.toolbar && <span className="spacer" />}
        {props.actions && <div className="row" style={{ gap: 6 }}>{props.actions}</div>}
        {props.ai && (
          <IconButton icon={Sparkles} label={`${t('AI Assistant')} (Ctrl/Cmd+J)`} active={aiOpen} onClick={toggleAI} />
        )}
      </header>
      <div className="mod-body">
        {props.left && <aside className="mod-left">{props.left}</aside>}
        <div className="col grow" style={{ gap: 0, minWidth: 0 }}>
          <div className="row" style={{ flex: 1, minHeight: 0, gap: 0, alignItems: 'stretch' }}>
            <main className="mod-center" style={props.centerStyle}>
              {props.children}
            </main>
            {props.right && (
              <aside className="mod-right" style={props.rightWidth ? { width: props.rightWidth, flexBasis: props.rightWidth } : undefined}>
                {props.right}
              </aside>
            )}
          </div>
          {props.bottom && (
            <section className="mod-bottom" style={{ height: bottomHeight, position: 'relative' }}>
              {props.resizableBottom && (
                <div
                  style={{ position: 'absolute', top: -3, left: 0, right: 0, height: 6, cursor: 'ns-resize', zIndex: 5 }}
                  onPointerDown={(e) => {
                    dragRef.current = { startY: e.clientY, startH: bottomHeight };
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!dragRef.current) return;
                    const h = dragRef.current.startH - (e.clientY - dragRef.current.startY);
                    setBottomHeight(Math.max(120, Math.min(window.innerHeight * 0.7, h)));
                  }}
                  onPointerUp={() => (dragRef.current = null)}
                />
              )}
              {props.bottom}
            </section>
          )}
        </div>
        {props.ai && aiOpen && (
          <aside className="mod-right" style={{ width: 320, flexBasis: 320, overflow: 'hidden' }}>
            {props.ai}
          </aside>
        )}
      </div>
      {props.status && <footer className="mod-status">{props.status}</footer>}
    </div>
  );
}

/**
 * Contextual header controls. When the window is too narrow they scroll sideways (trackpad or mouse
 * wheel) behind faded edges; a classic scrollbar would squeeze the header on Windows and Linux.
 */
function HeaderToolbar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<'' | 'left' | 'right' | 'both'>('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const left = max > 1 && el.scrollLeft > 1;
      const right = max > 1 && el.scrollLeft < max - 1;
      setMore(left && right ? 'both' : left ? 'left' : right ? 'right' : '');
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const changes = new MutationObserver(update);
    changes.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      resize.disconnect();
      changes.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="row grow mod-toolbar"
      data-more={more || undefined}
      onWheel={(e) => {
        const el = e.currentTarget;
        if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        if ((e.target as HTMLElement).closest('input, select, textarea')) return;
        el.scrollLeft += e.deltaY;
      }}
    >
      {children}
    </div>
  );
}
