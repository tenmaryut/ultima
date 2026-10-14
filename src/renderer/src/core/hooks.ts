import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAppStore, type ModuleHandoff, type ModuleId } from './store';

/** Delivers content other modules (or Home) queued for `moduleId` via `sendToModule`. */
export function useHandoffs(moduleId: ModuleId, handler: (items: ModuleHandoff[]) => void): void {
  const pending = useAppStore((s) => s.handoffs[moduleId]?.length ?? 0);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!pending) return;
    const items = useAppStore.getState().takeHandoffs(moduleId);
    if (items.length) ref.current(items);
  }, [pending, moduleId]);
}

/** Tracks an element's content size. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * File drag & drop on an element. Returns `dragging` for showing a drop overlay.
 * Only reacts to drags that carry files.
 */
export function useFileDrop<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onFiles: (files: File[]) => void,
  enabled = true,
): boolean {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onFiles);
  cb.current = onFiles;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) cb.current(files);
    };
    el.addEventListener('dragenter', onEnter);
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [ref, enabled]);
  return dragging;
}

/** requestAnimationFrame loop that runs only while `running` is true. */
export function useAnimationFrame(running: boolean, callback: (time: number, delta: number) => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const loop = (time: number) => {
      const delta = time - last;
      last = time;
      ref.current(time, delta);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
}

/** Latest value in a ref (handy inside long-lived event handlers). */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Revokes object URLs created for a component when it unmounts. */
export function useObjectUrls(): (blob: Blob) => string {
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    },
    [],
  );
  return (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  };
}
