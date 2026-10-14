import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Bot, Clock, Download, FolderOpen, GitBranch, Keyboard, Plug, Trash2 } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { MODULES } from '../../core/modules';
import { useAppStore } from '../../core/store';
import { useT } from '../../core/i18n';
import { useFileDrop } from '../../core/hooks';
import { openFilesInApp, openRecentPath, pickAndOpenFiles } from '../../core/open';
import { desktop, isDesktop, isMac, openExternal } from '../../core/platform';
import { useAISettings } from '../../core/ai/settings';
import { PROVIDERS } from '@shared/providers-catalog';
import type { RecentFile } from '@shared/ipc';
import { Badge, Button, DropOverlay, Kbd, Logo } from '../../components/ui';
import '../../i18n/id';

const REPO = 'https://github.com/tenmaryut/ultima';

export default function HomeModule({ active }: ModuleProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useFileDrop(rootRef, (files) => void openFilesInApp(files), active);
  const setActive = useAppStore((s) => s.setActiveModule);
  const recent = useAppStore((s) => s.recent);
  const clearRecent = useAppStore((s) => s.clearRecent);
  const statuses = useAISettings((s) => s.statuses);
  const enabled = useAISettings((s) => s.enabled);
  const [desktopRecent, setDesktopRecent] = useState<RecentFile[]>([]);

  useEffect(() => {
    if (active && desktop) void desktop.files.recent().then(setDesktopRecent).catch(() => undefined);
  }, [active]);

  const connected = PROVIDERS.filter((p) => enabled[p.id] && statuses.find((s) => s.id === p.id)?.available);
  const detectedNotEnabled = PROVIDERS.filter((p) => !enabled[p.id] && statuses.find((s) => s.id === p.id)?.available);
  const mod = isMac ? '⌘' : 'Ctrl';

  const recentItems = recent.slice(0, 12).map((r) => {
    const def = MODULES.find((m) => m.id === r.moduleId);
    const reopenable = Boolean(desktop && r.path && desktopRecent.some((d) => d.path === r.path));
    return { ...r, def, reopenable };
  });

  return (
    <div className="home" ref={rootRef}>
      <DropOverlay show={dragging} label={t('Drop files to open them')} />
      <div className="home-inner">
        <section className="home-hero">
          <Logo size={64} />
          <div className="grow">
            <h1>{t('Welcome to Ultima')}</h1>
            <div className="muted" style={{ fontSize: 14, maxWidth: 720 }}>
              {t('One free, open-source app for photos, graphics, layout, video, motion, audio and PDFs — with AI from the subscriptions you already have, or free local models.')}
            </div>
            <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
              <Button variant="primary" size="lg" icon={FolderOpen} onClick={() => void pickAndOpenFiles()}>
                {t('Open file…')}
              </Button>
              <Button size="lg" icon={Plug} onClick={() => setActive('settings')}>
                {t('Connect AI')}
              </Button>
              <Button size="lg" variant="ghost" icon={BookOpen} onClick={() => openExternal(`${REPO}/blob/main/docs/USER_GUIDE.md`)}>
                {t('User guide')}
              </Button>
              {!isDesktop && (
                <Button size="lg" variant="ghost" icon={Download} onClick={() => openExternal(`${REPO}/releases/latest`)}>
                  {t('Download desktop app')}
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="card row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Bot size={18} color="var(--accent)" />
          <strong style={{ color: 'var(--text-0)' }}>{t('AI connections')}</strong>
          {connected.length ? (
            connected.map((p) => (
              <Badge key={p.id} tone="ok">
                {p.name}
              </Badge>
            ))
          ) : (
            <span className="muted">{t('No AI connected yet.')}</span>
          )}
          {detectedNotEnabled.length > 0 && (
            <span className="muted">
              {t('Found on this computer:')} {detectedNotEnabled.map((p) => p.name).join(', ')}
            </span>
          )}
          <span className="spacer" />
          <Button size="sm" onClick={() => setActive('settings')}>
            {connected.length ? t('Manage') : t('Set up')}
          </Button>
        </section>

        <section>
          <h2 className="section-title">{t('Create')}</h2>
          <div className="module-grid">
            {MODULES.filter((m) => m.section === 'create' || m.section === 'tools').map((m) => {
              const Icon = m.icon;
              return (
                <button key={m.id} type="button" className="module-card" style={{ '--mod-color': m.color } as CSSProperties} onClick={() => setActive(m.id)}>
                  <div className="row">
                    <span className="icon-wrap">
                      <Icon size={19} />
                    </span>
                    <div className="col" style={{ gap: 0 }}>
                      <h3>{t(m.name)}</h3>
                      {m.replaces && <span className="faint" style={{ fontSize: 11 }}>{t('like {app}', { app: m.replaces })}</span>}
                    </div>
                  </div>
                  <span className="muted" style={{ fontSize: 12.5 }}>{t(m.description)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <section className="card grow" style={{ minWidth: 320 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <Clock size={15} />
              <strong className="grow" style={{ color: 'var(--text-0)' }}>{t('Recent files')}</strong>
              {recent.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => {
                    clearRecent();
                    void desktop?.files.clearRecent();
                  }}
                >
                  {t('Clear')}
                </Button>
              )}
            </div>
            {!recentItems.length && <div className="muted">{t('Files you open will show up here.')}</div>}
            <div className="list">
              {recentItems.map((r) => {
                const Icon = r.def?.icon;
                return (
                  <div
                    key={`${r.moduleId}-${r.path ?? r.name}-${r.openedAt}`}
                    className="list-item"
                    style={{ opacity: r.reopenable ? 1 : 0.65, cursor: r.reopenable ? 'pointer' : 'default' }}
                    title={r.reopenable ? r.path : t('Open it again with “Open file…”')}
                    onClick={() => r.reopenable && r.path && void openRecentPath(r.path, r.name)}
                  >
                    {Icon && <Icon size={14} color={r.def?.color} />}
                    <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </span>
                    <span className="faint" style={{ fontSize: 11 }}>
                      {new Date(r.openedAt).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card" style={{ width: 360 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <Keyboard size={15} />
              <strong style={{ color: 'var(--text-0)' }}>{t('Handy shortcuts')}</strong>
            </div>
            <div className="col" style={{ gap: 6, fontSize: 12.5 }}>
              {[
                [`${mod}+O`, t('Open a file')],
                [`${mod}+S`, t('Save project')],
                [`${mod}+E`, t('Export')],
                [`${mod}+Z / ${mod}+Shift+Z`, t('Undo / Redo')],
                [`${mod}+J`, t('Show or hide the AI assistant')],
                [`${mod}+0`, t('Fit to screen')],
                [`${mod}+Shift+H`, t('Back to Home')],
              ].map(([k, label]) => (
                <div key={k} className="row">
                  <Kbd>{k}</Kbd>
                  <span className="muted">{label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="row faint" style={{ justifyContent: 'center', gap: 14, fontSize: 12 }}>
          <span>{t('Ultima is free and open source (MIT).')}</span>
          <a
            href={REPO}
            onClick={(e) => {
              e.preventDefault();
              openExternal(REPO);
            }}
            className="row"
            style={{ gap: 4 }}
          >
            <GitBranch size={13} /> GitHub
          </a>
        </footer>
      </div>
    </div>
  );
}
