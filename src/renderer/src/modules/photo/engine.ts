/**
 * The canvas engine: composites the active document into one display canvas (redrawn on
 * requestAnimationFrame only when something is dirty), draws the screen-space overlay
 * (marching ants, tool feedback, brush outline) and routes pointer input to the active tool.
 */
import type { ViewportApi } from '../../core/viewport';
import { confirmDialog, toast } from '../../components/ui';
import { t } from '../../core/i18n';
import { ctx2d, readPixels } from './canvas';
import { findLayer, getActiveLayer } from './doc';
import { rasterizeLayer } from './docops';
import { compositeDoc, flattenToCanvas, hitTestLayer, type Rendered, type RenderOverrides } from './render';
import { outlineSegments, unionRects } from './selection';
import { activeSession, usePhotoStore, type PhotoState } from './store';
import { TOOLS } from './tools';
import type { ToolEvent, ToolHandler } from './tools/types';
import type { Layer, PhotoDoc, RasterLayer, Rect, Selection, ToolId } from './types';

export interface StatusInfo {
  x: number;
  y: number;
  color: [number, number, number, number] | null;
}

const antsCache = new WeakMap<Selection, { path: Path2D; count: number }>();

function antsPath(sel: Selection): { path: Path2D; count: number } {
  let entry = antsCache.get(sel);
  if (entry) return entry;
  const segs = outlineSegments(sel.mask, sel.width, sel.height, sel.bounds);
  const path = new Path2D();
  for (let i = 0; i < segs.length; i += 4) {
    path.moveTo(segs[i], segs[i + 1]);
    path.lineTo(segs[i + 2], segs[i + 3]);
  }
  entry = { path, count: segs.length / 4 };
  antsCache.set(sel, entry);
  return entry;
}

export class PhotoEngine {
  container: HTMLElement | null = null;
  display: HTMLCanvasElement | null = null;
  overlayCanvas: HTMLCanvasElement | null = null;
  viewport: ViewportApi | null = null;
  active = false;
  overrides: Required<RenderOverrides> = { content: new Map(), mask: new Map(), hidden: new Set() };
  hover: ToolEvent | null = null;
  pressed = false;
  /** Shifts the marching ants while a selection is dragged. */
  antsShift: { x: number; y: number } | null = null;
  showAnts = true;
  antsPhase = 0;
  onStatus?: (info: StatusInfo | null) => void;
  onEditText?: (layerId: string) => void;
  onCursor?: (cursor: string) => void;

  private dirty: Rect | null = null;
  private overlayDirty = false;
  private statusDirty = false;
  private raf = 0;
  private renderedDoc: PhotoDoc | null = null;
  private renderedSession: string | null = null;
  private antsTimer = 0;
  private currentTool: ToolId | null = null;
  private compositeCache: { doc: PhotoDoc; data: Uint8ClampedArray } | null = null;
  private cleanup: (() => void) | null = null;

  /* ------------------------------- accessors ------------------------------- */

  get session() {
    return activeSession();
  }
  get history() {
    return this.session?.history ?? null;
  }
  get doc(): PhotoDoc | null {
    return this.history?.present ?? null;
  }
  get store(): PhotoState {
    return usePhotoStore.getState();
  }
  get tool(): ToolHandler {
    return TOOLS[this.store.tool];
  }
  get zoom(): number {
    return this.viewport?.view.zoom ?? 1;
  }

  activeLayer(): Layer | null {
    const doc = this.doc;
    return doc ? getActiveLayer(doc) : null;
  }

  docToScreen(x: number, y: number): { x: number; y: number } {
    const v = this.viewport?.view ?? { zoom: 1, x: 0, y: 0 };
    return { x: v.x + x * v.zoom, y: v.y + y * v.zoom };
  }

  /* ------------------------------ doc changes ------------------------------ */

  commit(doc: PhotoDoc, label: string): void {
    this.history?.set(doc, { label });
  }

  live(doc: PhotoDoc): void {
    this.history?.set(doc, { record: false });
  }

  commitLive(label: string): void {
    this.history?.commit(label);
  }

  setContentOverride(layerId: string, r: Rendered | null): void {
    if (r) this.overrides.content.set(layerId, r);
    else this.overrides.content.delete(layerId);
  }

  setMaskOverride(layerId: string, r: Rendered | null): void {
    if (r) this.overrides.mask.set(layerId, r);
    else this.overrides.mask.delete(layerId);
  }

  clearOverrides(): void {
    if (!this.overrides.content.size && !this.overrides.mask.size) return;
    this.overrides.content.clear();
    this.overrides.mask.clear();
    this.requestRender();
  }

  /** Flattened pixels of the current document (cached per document state). */
  compositePixels(): { data: Uint8ClampedArray; w: number; h: number } | null {
    const doc = this.doc;
    if (!doc) return null;
    if (this.compositeCache?.doc !== doc) this.compositeCache = { doc, data: readPixels(flattenToCanvas(doc)).data };
    return { data: this.compositeCache.data, w: doc.width, h: doc.height };
  }

  /** Checks that a layer can be edited (not locked). */
  canEdit(layer: Layer | null): layer is Layer {
    if (!layer) {
      toast.info(t('Select a layer first'));
      return false;
    }
    if (layer.locked) {
      toast.info(t('The layer is locked'), t('Unlock it in the Layers panel to edit it.'));
      return false;
    }
    return true;
  }

  /** Returns the active layer as a raster layer, asking to rasterize text/shape layers. */
  async ensureRaster(layerId?: string): Promise<RasterLayer | null> {
    const doc = this.doc;
    if (!doc) return null;
    const layer = layerId ? findLayer(doc, layerId) : getActiveLayer(doc);
    if (!layer || !this.canEdit(layer)) return null;
    if (layer.type === 'raster') return layer;
    const ok = await confirmDialog({
      title: t('Rasterize layer?'),
      message: t('This layer must be converted to pixels before you can paint on it or change its pixels. Its text or shape will no longer be editable.'),
      confirmLabel: t('Rasterize'),
    });
    if (!ok) return null;
    const current = this.doc;
    if (!current) return null;
    const next = rasterizeLayer(current, layer.id);
    this.commit(next, 'Rasterize Layer');
    const raster = findLayer(next, layer.id);
    return raster?.type === 'raster' ? raster : null;
  }

  /* -------------------------------- lifecycle -------------------------------- */

  attach(container: HTMLElement, display: HTMLCanvasElement, overlay: HTMLCanvasElement): void {
    this.detach();
    this.container = container;
    this.display = display;
    this.overlayCanvas = overlay;
    const down = (e: PointerEvent) => this.pointerDown(e);
    const move = (e: PointerEvent) => this.pointerMove(e);
    const up = (e: PointerEvent) => this.pointerUp(e);
    const leave = () => {
      if (this.pressed) return;
      this.hover = null;
      this.statusDirty = true;
      this.requestOverlay();
    };
    const dbl = (e: MouseEvent) => this.doubleClick(e);
    const ctxMenu = (e: MouseEvent) => e.preventDefault();
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', up);
    container.addEventListener('pointerleave', leave);
    container.addEventListener('dblclick', dbl);
    container.addEventListener('contextmenu', ctxMenu);
    const ro = new ResizeObserver(() => this.requestOverlay());
    ro.observe(container);
    this.cleanup = () => {
      container.removeEventListener('pointerdown', down);
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', up);
      container.removeEventListener('pointercancel', up);
      container.removeEventListener('pointerleave', leave);
      container.removeEventListener('dblclick', dbl);
      container.removeEventListener('contextmenu', ctxMenu);
      ro.disconnect();
    };
    this.renderedDoc = null;
    this.syncDoc();
  }

  detach(): void {
    this.cleanup?.();
    this.cleanup = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearInterval(this.antsTimer);
    this.antsTimer = 0;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.updateAntsTimer();
      if (this.pressed) this.finishPress();
      return;
    }
    this.requestRender();
    this.updateAntsTimer();
  }

  /** Called by React whenever the document, session or tool may have changed. */
  syncDoc(): void {
    const doc = this.doc;
    const session = this.session;
    const toolId = this.store.tool;
    if (toolId !== this.currentTool) {
      if (this.currentTool) TOOLS[this.currentTool]?.deactivate?.(this);
      this.currentTool = toolId;
      TOOLS[toolId]?.activate?.(this);
      this.onCursor?.(this.cursor());
    }
    if (!doc || !this.display) {
      this.renderedDoc = null;
      this.requestOverlay();
      this.updateAntsTimer();
      return;
    }
    const sessionChanged = session?.id !== this.renderedSession;
    if (sessionChanged) {
      if (this.currentTool) TOOLS[this.currentTool]?.deactivate?.(this);
      this.overrides.content.clear();
      this.overrides.mask.clear();
      this.overrides.hidden.clear();
      this.renderedSession = session?.id ?? null;
      if (this.currentTool) TOOLS[this.currentTool]?.activate?.(this);
    }
    if (this.display.width !== doc.width || this.display.height !== doc.height) {
      this.display.width = doc.width;
      this.display.height = doc.height;
      this.renderedDoc = null;
    }
    const prev = this.renderedDoc;
    if (!prev || prev.layers !== doc.layers || sessionChanged) this.requestRender();
    this.renderedDoc = doc;
    this.requestOverlay();
    this.updateAntsTimer();
  }

  private updateAntsTimer(): void {
    const want = this.active && Boolean(this.doc?.selection);
    if (want && !this.antsTimer) {
      this.antsTimer = window.setInterval(() => {
        this.antsPhase = (this.antsPhase + 1) % 8;
        this.requestOverlay();
      }, 140);
    } else if (!want && this.antsTimer) {
      window.clearInterval(this.antsTimer);
      this.antsTimer = 0;
    }
  }

  /* --------------------------------- frames --------------------------------- */

  /** Marks a document region (or everything) for recompositing. */
  requestRender(rect?: Rect): void {
    const doc = this.doc;
    if (!doc) return;
    const full = { x: 0, y: 0, w: doc.width, h: doc.height };
    const r = rect ? { x: Math.floor(rect.x) - 1, y: Math.floor(rect.y) - 1, w: Math.ceil(rect.w) + 3, h: Math.ceil(rect.h) + 3 } : full;
    this.dirty = unionRects(this.dirty, r);
    this.schedule();
  }

  requestOverlay(): void {
    this.overlayDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || !this.active) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.frame();
    });
  }

  private frame(): void {
    const doc = this.doc;
    if (this.dirty && doc && this.display) {
      const ctx = ctx2d(this.display);
      const d = this.dirty;
      const r = { x: Math.max(0, d.x), y: Math.max(0, d.y), w: Math.min(doc.width, d.x + d.w) - Math.max(0, d.x), h: Math.min(doc.height, d.y + d.h) - Math.max(0, d.y) };
      if (r.w > 0 && r.h > 0) compositeDoc(doc, ctx, r, this.overrides);
      this.dirty = null;
      this.statusDirty = true;
    }
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.drawOverlay();
    }
    if (this.statusDirty) {
      this.statusDirty = false;
      this.emitStatus();
    }
  }

  private emitStatus(): void {
    if (!this.onStatus) return;
    const h = this.hover;
    const doc = this.doc;
    if (!h || !doc || !this.display) {
      this.onStatus(null);
      return;
    }
    const ix = Math.floor(h.x);
    const iy = Math.floor(h.y);
    let color: StatusInfo['color'] = null;
    if (ix >= 0 && iy >= 0 && ix < doc.width && iy < doc.height) {
      const d = ctx2d(this.display).getImageData(ix, iy, 1, 1).data;
      color = [d[0], d[1], d[2], d[3]];
    }
    this.onStatus({ x: ix, y: iy, color });
  }

  cursor(): string {
    if (this.viewport?.spaceHeld) return 'grab';
    return this.tool.cursor?.(this) ?? 'default';
  }

  private drawOverlay(): void {
    const canvas = this.overlayCanvas;
    const container = this.container;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = ctx2d(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const doc = this.doc;
    if (!doc || !this.viewport) return;
    const v = this.viewport.view;
    if (doc.selection && this.showAnts) {
      const { path } = antsPath(doc.selection);
      const shift = this.antsShift ?? { x: 0, y: 0 };
      ctx.save();
      ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * (v.x + shift.x * v.zoom), dpr * (v.y + shift.y * v.zoom));
      ctx.lineWidth = 1 / v.zoom;
      ctx.setLineDash([4 / v.zoom, 4 / v.zoom]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineDashOffset = -this.antsPhase / v.zoom;
      ctx.stroke(path);
      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = (4 - this.antsPhase) / v.zoom;
      ctx.stroke(path);
      ctx.restore();
    }
    ctx.save();
    this.tool.overlay?.(this, ctx);
    ctx.restore();
    const size = this.tool.brushSize?.(this) ?? 0;
    if (size > 0 && this.hover && !this.viewport.spaceHeld) {
      const r = Math.max(1.5, (size * v.zoom) / 2);
      ctx.beginPath();
      ctx.arc(this.hover.sx, this.hover.sy, r, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.hover.sx, this.hover.sy, Math.max(0.5, r - 1), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      if (r < 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(this.hover.sx - 0.5, this.hover.sy - 5, 1, 10);
        ctx.fillRect(this.hover.sx - 5, this.hover.sy - 0.5, 10, 1);
      }
    }
  }

  /* --------------------------------- pointer --------------------------------- */

  toolEvent(e: PointerEvent | MouseEvent): ToolEvent {
    const rect = this.container!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const p = this.viewport ? this.viewport.screenToDoc(e.clientX, e.clientY) : { x: sx, y: sy };
    const pe = e as PointerEvent;
    const pen = pe.pointerType === 'pen';
    return {
      x: p.x,
      y: p.y,
      sx,
      sy,
      pressure: pen ? Math.max(0.02, pe.pressure || 0) : 1,
      pen,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.ctrlKey || e.metaKey,
      button: e.button,
    };
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.active || !this.doc) return;
    if (e.button === 1) return; // middle mouse: viewport pans
    if (e.button === 2) return;
    if ((e.target as HTMLElement)?.closest?.('.ph-text-editor')) return;
    if (this.viewport?.spaceHeld || this.store.tool === 'hand') {
      e.preventDefault();
      this.viewport?.startPan(e);
      return;
    }
    e.preventDefault();
    const wasEditingText = Boolean(this.store.editingTextId);
    (document.activeElement as HTMLElement | null)?.blur?.();
    // a click outside the text being edited only commits it
    if (wasEditingText && this.store.tool === 'text') return;
    try {
      this.container?.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    this.pressed = true;
    const ev = this.toolEvent(e);
    this.hover = ev;
    try {
      this.tool.down?.(this, ev);
    } catch (error) {
      this.reportError(error);
    }
    this.requestOverlay();
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.active || !this.doc) return;
    const events = this.pressed && typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    for (const pe of list) {
      const ev = this.toolEvent(pe);
      // keep modifier state of the parent event (coalesced events can miss it)
      ev.shift = e.shiftKey;
      ev.alt = e.altKey;
      ev.mod = e.ctrlKey || e.metaKey;
      this.hover = ev;
      try {
        if (this.pressed) this.tool.move?.(this, ev);
        else this.tool.hover?.(this, ev);
      } catch (error) {
        this.reportError(error);
      }
    }
    this.statusDirty = true;
    this.requestOverlay();
  }

  private pointerUp(e: PointerEvent): void {
    if (!this.pressed) return;
    try {
      this.container?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const ev = this.toolEvent(e);
    this.pressed = false;
    try {
      this.tool.up?.(this, ev);
    } catch (error) {
      this.reportError(error);
    }
    this.requestOverlay();
  }

  private finishPress(): void {
    this.pressed = false;
    if (this.hover) {
      try {
        this.tool.up?.(this, this.hover);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private doubleClick(e: MouseEvent): void {
    if (!this.active || !this.doc) return;
    const ev = this.toolEvent(e);
    if (this.tool.dblclick) {
      this.tool.dblclick(this, ev);
      return;
    }
    // double-click a text layer to edit it
    const doc = this.doc;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (l.type === 'text' && l.visible && hitTestLayer(l, ev.x, ev.y)) {
        this.startTextEdit(l.id);
        return;
      }
    }
  }

  startTextEdit(layerId: string): void {
    const doc = this.doc;
    const layer = doc ? findLayer(doc, layerId) : null;
    if (!layer || layer.type !== 'text') return;
    if (layer.locked) {
      toast.info(t('The layer is locked'));
      return;
    }
    this.onEditText?.(layerId);
  }

  /** Keyboard input for the active tool (Enter, Escape, arrows…). */
  handleKey(e: KeyboardEvent): boolean {
    try {
      return this.tool.key?.(this, e) ?? false;
    } catch (error) {
      this.reportError(error);
      return true;
    }
  }

  reportError(error: unknown): void {
    console.error('[photo]', error);
    toast.error(t('Something went wrong'), error instanceof Error ? error.message : String(error));
  }
}
