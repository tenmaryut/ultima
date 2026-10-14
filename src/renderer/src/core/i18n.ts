import { createContext, createElement, useCallback, useContext, type ReactNode } from 'react';
import { useAppStore } from './store';

/**
 * Minimal i18n: the English text itself is the translation key.
 *
 *   const t = useT();
 *   t('Brightness')                      -> "Kecerahan" when language is "id"
 *   t('{count} layers', { count: 3 })    -> interpolation with {name} placeholders
 *
 * Shared strings are registered with `registerTranslations('id', {...})`. Modules register
 * theirs with a scope (`registerTranslations('id', {...}, 'photo')`): inside that module they
 * win over the shared ones, so two modules can word the same English label differently
 * ("Bold" as a font weight vs. a tone of voice). Missing entries fall back to English, so an
 * untranslated string never breaks the UI.
 */

export type Language = 'en' | 'id';

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'id', label: 'Bahasa Indonesia' },
];

const shared: Record<Language, Record<string, string>> = { en: {}, id: {} };
const scoped: Record<Language, Map<string, Record<string, string>>> = { en: new Map(), id: new Map() };
/** All module entries together: the last resort for a string one module borrows from another. */
const borrowed: Record<Language, Record<string, string>> = { en: {}, id: {} };

export function registerTranslations(lang: Language, dict: Record<string, string>, scope?: string): void {
  if (!scope) {
    Object.assign(shared[lang], dict);
    return;
  }
  scoped[lang].set(scope, { ...scoped[lang].get(scope), ...dict });
  Object.assign(borrowed[lang], dict);
}

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Own entries only, so keys like "constructor" or "__proto__" never hit Object.prototype. */
function lookup(dict: Record<string, string> | undefined, key: string): string | undefined {
  return dict && Object.hasOwn(dict, key) ? dict[key] : undefined;
}

export function translate(lang: Language, key: string, vars?: Record<string, string | number>, scope?: string): string {
  const value =
    lang === 'en'
      ? key
      : (lookup(scope ? scoped[lang].get(scope) : undefined, key) ?? lookup(shared[lang], key) ?? lookup(borrowed[lang], key) ?? key);
  return interpolate(value, vars);
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

/** Translate outside React (current language; the active module's wording comes first). */
export const t: TFunction = (key, vars) => {
  const { language, activeModule } = useAppStore.getState();
  return translate(language, key, vars, activeModule);
};

const ScopeContext = createContext<string | undefined>(undefined);

/** Makes `useT()` inside it prefer the translations registered for `scope` (a module id). */
export function TranslationScope({ scope, children }: { scope: string; children: ReactNode }) {
  return createElement(ScopeContext.Provider, { value: scope }, children);
}

/** A built-in default name ("Untitled", a template's name…) in the UI language; names the user typed stay as they are. */
export function localizeDefaultName(t: TFunction, name: string, defaults: readonly string[]): string {
  return defaults.includes(name) ? t(name) : name;
}

/** React hook: returns a `t` bound to the current language and re-renders when it changes. */
export function useT(): TFunction {
  const lang = useAppStore((s) => s.language);
  const scope = useContext(ScopeContext);
  return useCallback<TFunction>((key, vars) => translate(lang, key, vars, scope), [lang, scope]);
}
