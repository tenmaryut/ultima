/**
 * View commands: zoom, rotate view, page navigation, find.
 */
import { clampZoom, nextZoomStep, normalizeRotation } from './geometry';
import { usePdfUi, type ZoomMode } from './store';

export function zoomBy(direction: 1 | -1): void {
  const ui = usePdfUi.getState();
  ui.set({ zoom: clampZoom(nextZoomStep(ui.zoom, direction)), zoomMode: 'custom' });
}

export function setZoom(zoom: number): void {
  usePdfUi.getState().set({ zoom: clampZoom(zoom), zoomMode: 'custom' });
}

export function setZoomMode(mode: ZoomMode): void {
  usePdfUi.getState().set({ zoomMode: mode });
}

export function rotateView(delta: number): void {
  const ui = usePdfUi.getState();
  ui.set({ viewRotation: normalizeRotation(ui.viewRotation + delta) });
}

export function goRelative(delta: number, pageCount: number): void {
  const ui = usePdfUi.getState();
  const next = Math.max(0, Math.min(pageCount - 1, ui.currentPage + delta));
  ui.goToPage(next);
}

export function openFind(): void {
  const ui = usePdfUi.getState();
  const selected = window.getSelection()?.toString().trim();
  ui.set({ mode: 'view' });
  ui.setFind({ open: true, ...(selected && selected.length < 120 && !selected.includes('\n') ? { query: selected } : {}) });
}
