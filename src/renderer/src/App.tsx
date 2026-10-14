import { Component, Suspense, lazy, useEffect, useMemo, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { MODULES, type ModuleDefinition, type ModuleProps } from './core/modules';
import { useAppStore } from './core/store';
import { applyAppearance, gradientTheme, resolveColorMode } from './core/themes';
import { TranslationScope, t as translateNow, useT } from './core/i18n';
import { useGlobalCommands } from './core/commands';
import { keepUnsavedAfterCrash, releaseCrashedModule, useUnsavedGuard } from './core/unsaved';
import { useProviderDetection } from './core/ai/client';
import { DialogHost, Logo, Spinner, Toasts } from './components/ui';
import { setWindowTitle } from './core/platform';
import { openFilesInApp, openRecentPath } from './core/open';
import { desktop } from './core/platform';

const lazyCache = new Map<string, ComponentType<ModuleProps>>();
function lazyModule(def: ModuleDefinition): ComponentType<ModuleProps> {
  let c = lazyCache.get(def.id);
  if (!c) {
    c = lazy(def.load);
    lazyCache.set(def.id, c);
  }
  return c;
}

class ModuleErrorBoundary extends Component<{ id: string; name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`[ultima] ${this.props.name} crashed`, error);
    keepUnsavedAfterCrash(this.props.id);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <h2>{translateNow('{name} ran into a problem', { name: this.props.name })}</h2>
          <pre className="code-block" style={{ maxWidth: 640, maxHeight: 240, overflow: 'auto' }}>
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              releaseCrashedModule(this.props.id);
              this.setState({ error: null });
            }}
          >
            {translateNow('Reload module')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Dark/light mode, color gradient and accent color on the root element. Dialogs, menus and popovers
 * render in portals outside the tool, so the active tool's own color is set there too unless the
 * user chose the gradient's color for every tool.
 */
function useAppearance(activeDef: ModuleDefinition | undefined) {
  const theme = useAppStore((s) => s.theme);
  const gradient = useAppStore((s) => s.gradient);
  const accentMode = useAppStore((s) => s.accentMode);
  const language = useAppStore((s) => s.language);
  const inTool = activeDef?.section === 'create' || activeDef?.section === 'tools';
  const toolColor = inTool && accentMode !== 'gradient' ? (activeDef?.color ?? null) : null;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      applyAppearance(document.documentElement, { mode: resolveColorMode(theme), theme: gradientTheme(gradient), accentMode, toolColor });
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, gradient, accentMode, toolColor]);
  useEffect(() => {
    document.documentElement.lang = language;
    desktop?.app.setLanguage(language);
  }, [language]);
}

/** Files the operating system asks Ultima to open (double-click, "Open with", command line). */
function useOsOpenFiles() {
  useEffect(() => {
    if (!desktop) return;
    const open = (files: { path: string; name: string }[]) => {
      for (const f of files) void openRecentPath(f.path, f.name);
    };
    void desktop.app.pendingPaths().then(open);
    return desktop.app.onOpenPaths(open);
  }, []);
}

/** Files dropped anywhere that no editor handled open in the matching module. */
function useGlobalFileDrop() {
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void openFilesInApp(files);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}

export default function App() {
  const t = useT();
  const active = useAppStore((s) => s.activeModule);
  const mounted = useAppStore((s) => s.mountedModules);
  const setActive = useAppStore((s) => s.setActiveModule);
  const activeDef = useMemo(() => MODULES.find((m) => m.id === active), [active]);
  useAppearance(activeDef);
  useGlobalCommands();
  useProviderDetection();
  useGlobalFileDrop();
  useOsOpenFiles();
  useUnsavedGuard();

  useEffect(() => {
    setWindowTitle(activeDef && activeDef.id !== 'home' ? `${t(activeDef.name)} — Ultima` : 'Ultima');
  }, [activeDef, t]);

  const sections: ModuleDefinition['section'][] = ['home', 'create', 'tools'];

  return (
    <div className="app-shell">
      <nav className="app-rail" aria-label={t('Modules')}>
        <button type="button" className="logo" title="Ultima" aria-label={t('Home')} onClick={() => setActive('home')}>
          <Logo size={34} />
        </button>
        {sections.map((section, si) => (
          <div key={section} className="col" style={{ gap: 4, alignItems: 'center' }}>
            {si > 0 && <div className="rail-sep" />}
            {MODULES.filter((m) => m.section === section && m.id !== 'home').map((m) => (
              <RailButton key={m.id} def={m} active={active === m.id} onClick={() => setActive(m.id)} />
            ))}
          </div>
        ))}
        <span className="spacer" />
        {MODULES.filter((m) => m.section === 'system').map((m) => (
          <RailButton key={m.id} def={m} active={active === m.id} onClick={() => setActive(m.id)} />
        ))}
      </nav>
      <div className="app-main">
        {MODULES.filter((m) => mounted.includes(m.id)).map((m) => {
          const Comp = lazyModule(m);
          const isActive = m.id === active;
          return (
            <div key={m.id} className="module-host" hidden={!isActive} style={{ '--mod-color': m.color } as CSSProperties}>
              <ModuleErrorBoundary id={m.id} name={t(m.name)}>
                <TranslationScope scope={m.id}>
                  <Suspense
                    fallback={
                      <div className="empty-state">
                        <Spinner size={22} />
                      </div>
                    }
                  >
                    <Comp active={isActive} />
                  </Suspense>
                </TranslationScope>
              </ModuleErrorBoundary>
            </div>
          );
        })}
      </div>
      <Toasts />
      <DialogHost />
    </div>
  );
}

function RailButton({ def, active, onClick }: { def: ModuleDefinition; active: boolean; onClick: () => void }) {
  const t = useT();
  const Icon = def.icon;
  const title = def.replaces ? `${t(def.name)} — ${t('like {app}', { app: def.replaces })}` : t(def.name);
  return (
    <button
      type="button"
      className={`rail-btn ${active ? 'active' : ''}`}
      style={{ '--mod-color': def.color } as CSSProperties}
      title={title}
      aria-label={t(def.name)}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon size={19} color={active ? def.color : undefined} />
      <span className="rail-label">{t(def.short)}</span>
    </button>
  );
}
