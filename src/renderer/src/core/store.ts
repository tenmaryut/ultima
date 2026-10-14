import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Language } from './i18n';
import type { AccentMode, GradientId } from './themes';

export type ModuleId =
  | 'home'
  | 'photo'
  | 'develop'
  | 'vector'
  | 'layout'
  | 'video'
  | 'motion'
  | 'audio'
  | 'pdf'
  | 'color'
  | 'ai-studio'
  | 'settings';

export type ThemeSetting = 'dark' | 'light' | 'system';

export interface RecentEntry {
  name: string;
  moduleId: ModuleId;
  path?: string;
  openedAt: number;
}

/** Content handed from one module to another (e.g. AI Studio -> Vector "open this SVG"). */
export interface ModuleHandoff {
  kind: 'files' | 'svg' | 'text' | 'image' | 'palette' | 'json';
  files?: File[];
  svg?: string;
  text?: string;
  /** data: URL or object URL */
  image?: string;
  palette?: string[];
  json?: unknown;
  title?: string;
  /** Video: put the imported files on the timeline at the playhead (e.g. a voice-over). */
  place?: 'playhead';
}

interface AppState {
  activeModule: ModuleId;
  /** Modules that were opened at least once stay mounted (hidden) so work is never lost. */
  mountedModules: ModuleId[];
  theme: ThemeSetting;
  /** Color gradient of the app's look (logo, top line, Home banner, accent). */
  gradient: GradientId;
  accentMode: AccentMode;
  language: Language;
  /** AI assistant side panel visibility per module. */
  aiPanelOpen: boolean;
  recent: RecentEntry[];
  handoffs: Partial<Record<ModuleId, ModuleHandoff[]>>;

  setActiveModule: (id: ModuleId) => void;
  setTheme: (theme: ThemeSetting) => void;
  setGradient: (gradient: GradientId) => void;
  setAccentMode: (mode: AccentMode) => void;
  setLanguage: (lang: Language) => void;
  setAIPanelOpen: (open: boolean) => void;
  toggleAIPanel: () => void;
  addRecent: (entry: Omit<RecentEntry, 'openedAt'>) => void;
  clearRecent: () => void;
  /** Switch to `moduleId` and queue something for it to open. */
  sendToModule: (moduleId: ModuleId, handoff: ModuleHandoff) => void;
  /** Called by a module to take (and clear) everything queued for it. */
  takeHandoffs: (moduleId: ModuleId) => ModuleHandoff[];
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeModule: 'home',
      mountedModules: ['home'],
      theme: 'dark',
      gradient: 'ultima',
      accentMode: 'tools',
      language: navigator.language?.toLowerCase().startsWith('id') ? 'id' : 'en',
      aiPanelOpen: true,
      recent: [],
      handoffs: {},

      setActiveModule: (id) =>
        set((s) => ({
          activeModule: id,
          mountedModules: s.mountedModules.includes(id) ? s.mountedModules : [...s.mountedModules, id],
        })),
      setTheme: (theme) => set({ theme }),
      setGradient: (gradient) => set({ gradient }),
      setAccentMode: (accentMode) => set({ accentMode }),
      setLanguage: (language) => set({ language }),
      setAIPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),
      toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
      addRecent: (entry) =>
        set((s) => ({
          recent: [
            { ...entry, openedAt: Date.now() },
            ...s.recent.filter((r) => !(r.name === entry.name && r.moduleId === entry.moduleId && r.path === entry.path)),
          ].slice(0, 24),
        })),
      clearRecent: () => set({ recent: [] }),
      sendToModule: (moduleId, handoff) => {
        set((s) => ({
          handoffs: { ...s.handoffs, [moduleId]: [...(s.handoffs[moduleId] ?? []), handoff] },
        }));
        get().setActiveModule(moduleId);
      },
      takeHandoffs: (moduleId) => {
        const items = get().handoffs[moduleId] ?? [];
        if (items.length) set((s) => ({ handoffs: { ...s.handoffs, [moduleId]: [] } }));
        return items;
      },
    }),
    {
      name: 'ultima-app',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme, gradient: s.gradient, accentMode: s.accentMode, language: s.language, aiPanelOpen: s.aiPanelOpen, recent: s.recent }),
    },
  ),
);
