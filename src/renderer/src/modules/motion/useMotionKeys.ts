import { useEffect, useRef } from 'react';
import { isEditableTarget } from '../../core/commands';
import { isMac } from '../../core/platform';
import { TOOL_KEYS } from './menus';
import type { ToolId } from './state';

/** Single-key shortcuts of the Motion module (After Effects style). */

export interface MotionKeyHandlers {
  togglePlay: () => void;
  stepFrames: (n: number) => void;
  jumpKey: (direction: -1 | 1) => void;
  revealAnimated: () => void;
  goToLayerEdge: (edge: 'in' | 'out') => void;
  setWorkArea: (edge: 'start' | 'end') => void;
  trimLayer: (edge: 'in' | 'out') => void;
  goToEdge: (edge: 'start' | 'end') => void;
  easyEase: () => void;
  copy: () => void;
  paste: () => void;
  cut: () => void;
  setTool: (tool: ToolId) => void;
  escape: () => void;
}

function modalOpen(): boolean {
  return Boolean(document.querySelector('.modal-backdrop, .mo-popover'));
}

export function useMotionKeys(active: boolean, handlers: MotionKeyHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!active) return;
    // Space toggles playback on release, unless it was used to pan the canvas (Space+drag).
    let spaceDown = false;
    let spaceUsed = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || modalOpen()) return;
      const h = ref.current;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          spaceDown = true;
          spaceUsed = false;
        }
        return;
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'c') {
          e.preventDefault();
          h.copy();
        } else if (k === 'v') {
          e.preventDefault();
          h.paste();
        } else if (k === 'x') {
          e.preventDefault();
          h.cut();
        }
        return;
      }
      if (e.altKey && (e.key === '[' || e.key === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        e.preventDefault();
        h.trimLayer(e.code === 'BracketLeft' || e.key === '[' ? 'in' : 'out');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          h.stepFrames(e.shiftKey ? -10 : -1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          h.stepFrames(e.shiftKey ? 10 : 1);
          return;
        case 'Home':
          e.preventDefault();
          h.goToEdge('start');
          return;
        case 'End':
          e.preventDefault();
          h.goToEdge('end');
          return;
        case 'F9':
          e.preventDefault();
          h.easyEase();
          return;
        case 'Escape':
          h.escape();
          return;
      }
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') h.jumpKey(k === 'j' ? -1 : 1);
      else if (k === 'u') h.revealAnimated();
      else if (k === 'i' || k === 'o') h.goToLayerEdge(k === 'i' ? 'in' : 'out');
      else if (k === 'b' || k === 'n') h.setWorkArea(k === 'b' ? 'start' : 'end');
      else if (TOOL_KEYS[k] && !e.shiftKey) h.setTool(TOOL_KEYS[k]);
      else return;
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceDown) return;
      // Don't let a focused button turn the key release into a click as well.
      e.preventDefault();
      spaceDown = false;
      if (!spaceUsed && !isEditableTarget(e.target) && !modalOpen()) ref.current.togglePlay();
    };
    const onPointerDown = () => {
      if (spaceDown) spaceUsed = true;
    };
    const onBlur = () => {
      spaceDown = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [active]);
}
