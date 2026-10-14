import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './i18n/id';
import App from './App';
import { useAppStore } from './core/store';
import { applyAppearance, gradientTheme, resolveColorMode } from './core/themes';

// Before the first paint, so a saved gradient does not flash the default one.
const saved = useAppStore.getState();
applyAppearance(document.documentElement, {
  mode: resolveColorMode(saved.theme),
  theme: gradientTheme(saved.gradient),
  accentMode: saved.accentMode,
  toolColor: null,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
