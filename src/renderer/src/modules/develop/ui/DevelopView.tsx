import { useEffect, useMemo, useRef, useState } from 'react';
import { FileWarning, ImageOff, Monitor } from 'lucide-react';
import { useT } from '../../../core/i18n';
import { useViewport, type ViewportApi } from '../../../core/viewport';
import { pickFiles } from '../../../core/platform';
import { Button, Spinner, toast } from '../../../components/ui';
import type { Vec3 } from '../color';
import { getFull, getPreview, getStats, peekPreview, peekStats, PHOTO_ACCEPT, sourceKeyOf, type PreviewSource } from '../decode';
import { applyAffine, geometry, straightenFromLine } from '../geometry';
import { autoTone } from '../histogram';
import { mergeSettings, type DevelopSettings } from '../params';
import { applyPresetSettings } from '../presets';
import { getRenderer, previewHistogram, rendererProblem, renderPreview, renderRegion } from '../render';
import { relinkFiles } from '../library';
import { whiteBalanceAt, withStraighten } from '../ops';
import { getPhoto, patchPhoto, setStore, useDevelop } from '../store';
import { canDevelop } from '../types';
import { editorFor, useActivePhoto } from './common';
import { CropOverlay } from './CropOverlay';

/** The develop view's viewport, for zoom commands from the header/menus. */
export const viewportRef: { current: ViewportApi | null } = { current: null };

export function DevelopView({ active }: { active: boolean }) {
  const t = useT();
  const photo = useActivePhoto();
  const hoverPreset = useDevelop((s) => s.hoverPreset);
  const compare = useDevelop((s) => s.compare);
  const splitPos = useDevelop((s) => s.splitPos);
  const showClipping = useDevelop((s) => s.showClipping);
  const cropMode = useDevelop((s) => s.cropMode);
  const tool = useDevelop((s) => s.tool);
  const renderer = getRenderer();
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [atmos, setAtmos] = useState<Vec3>([1, 1, 1]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [line, setLine] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const editable = Boolean(photo && canDevelop(photo));
  const photoId = photo?.id;
  const photoSource = photo?.source;

  /* ----------------------------- load the photo ----------------------------- */
  useEffect(() => {
    setLoadError(null);
    const p = photoId ? getPhoto(photoId) : undefined;
    if (!p || !canDevelop(p)) {
      setSource(null);
      return;
    }
    let cancelled = false;
    const cached = peekPreview(p);
    setSource(cached ?? null);
    setAtmos(peekStats(p)?.atmos ?? [1, 1, 1]);
    if (!cached) setLoading(true);
    getPreview(p)
      .then((src) => {
        if (cancelled) return;
        setSource(src);
        const cur = getPhoto(p.id);
        if (cur && (cur.width !== src.fullW || cur.height !== src.fullH)) patchPhoto(p.id, { width: src.fullW, height: src.fullH });
        return getStats(p).then((st) => !cancelled && setAtmos(st.atmos));
      })
      .catch((error: unknown) => !cancelled && setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [photoId, photoSource]);

  const current = source && photo && source.key === sourceKeyOf(photo) ? source : null;
  const base = photo?.settings;
  const renderSettings: DevelopSettings | undefined = useMemo(() => {
    if (!base || !hoverPreset || !photo) return base;
    if (hoverPreset.auto) {
      const st = peekStats(photo);
      return st ? mergeSettings(base, autoTone(st.histogram)) : base;
    }
    return applyPresetSettings(base, hoverPreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, hoverPreset]);

  const fullW = current?.fullW ?? photo?.width ?? 0;
  const fullH = current?.fullH ?? photo?.height ?? 0;
  const geo = renderSettings && fullW ? geometry(renderSettings, fullW, fullH, cropMode) : null;
  const docW = geo?.outW ?? 0;
  const docH = geo?.outH ?? 0;
  const vp = useViewport(containerRef, docW, docH, { fitKey: `${photoId}|${cropMode}`, active });
  viewportRef.current = vp;
  useEffect(() => {
    if (active) setStore({ zoom: vp.zoom });
  }, [active, vp.zoom]);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const displayScale = vp.zoom * dpr;

  /* --------------------------- mount the GL canvas --------------------------- */
  useEffect(() => {
    const doc = docRef.current;
    if (!renderer || !doc) return;
    doc.insertBefore(renderer.canvas, doc.firstChild);
    return () => {
      renderer.canvas.remove();
    };
  }, [renderer]);

  /* --------------------------------- render --------------------------------- */
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHist = useRef(0);
  const split = compare === 'split' ? splitPos : compare === 'before' ? 2 : 0;
  useEffect(() => {
    if (!active || !renderer || !current || !renderSettings) return;
    const raf = requestAnimationFrame(() => {
      try {
        renderPreview(current, renderSettings, atmos, { cropMode, split, clip: showClipping, displayScale });
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
        return;
      }
      const run = () => {
        lastHist.current = performance.now();
        try {
          const h = previewHistogram(current, renderSettings, atmos, cropMode);
          if (h) setStore({ histogram: h });
        } catch {
          // histogram is best effort
        }
      };
      if (histTimer.current) clearTimeout(histTimer.current);
      if (performance.now() - lastHist.current > 140) run();
      else histTimer.current = setTimeout(run, 140);
    });
    return () => cancelAnimationFrame(raf);
  }, [active, renderer, current, renderSettings, atmos, cropMode, split, showClipping, displayScale]);

  /* ------------------- 100% detail overlay (full resolution) ------------------- */
  const detailGen = useRef(0);
  useEffect(() => {
    // settings / photo changed: the old detail render is stale
    detailGen.current++;
    if (detailRef.current) detailRef.current.style.display = 'none';
  }, [renderSettings, photoId, cropMode, compare, showClipping]);

  useEffect(() => {
    const canvas = detailRef.current;
    if (!active || !canvas || !current || !photo || !renderSettings || cropMode || compare !== 'off' || showClipping || !geo) return;
    const s = Math.min(1, displayScale);
    if (s <= current.scale * 1.05) {
      canvas.style.display = 'none';
      return;
    }
    const gen = ++detailGen.current;
    const ctrl = new AbortController();
    const settings = renderSettings;
    const timer = setTimeout(async () => {
      try {
        const full = await getFull(photo);
        const el = containerRef.current;
        if (!el || gen !== detailGen.current) return;
        const v = vp.view;
        const x0 = Math.max(0, Math.floor(-v.x / v.zoom));
        const y0 = Math.max(0, Math.floor(-v.y / v.zoom));
        const x1 = Math.min(geo.outW, Math.ceil((el.clientWidth - v.x) / v.zoom));
        const y1 = Math.min(geo.outH, Math.ceil((el.clientHeight - v.y) / v.zoom));
        if (x1 - x0 < 2 || y1 - y0 < 2) return;
        const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(region.w * s));
        off.height = Math.max(1, Math.round(region.h * s));
        const octx = off.getContext('2d')!;
        await renderRegion({
          full,
          key: `detail:${sourceKeyOf(photo)}`,
          settings,
          atmos,
          region,
          scale: s,
          signal: ctrl.signal,
          onTile: (px, x, y, w, h) => octx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, 0, w * h * 4), w, h), x, y),
        });
        if (gen !== detailGen.current || ctrl.signal.aborted) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')!.drawImage(off, 0, 0);
        Object.assign(canvas.style, { display: 'block', left: `${region.x}px`, top: `${region.y}px`, width: `${region.w}px`, height: `${region.h}px` });
      } catch {
        // detail view is best effort
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, current, renderSettings, atmos, cropMode, compare, showClipping, vp.view.x, vp.view.y, vp.view.zoom, docW, docH]);

  /* --------------------------------- pointer --------------------------------- */
  const press = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !photo || !geo) return;
    if (vp.spaceHeld) {
      vp.startPan(e);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (tool === 'wb' && current) {
      const p = vp.screenToDoc(e.clientX, e.clientY);
      if (p.x < 0 || p.y < 0 || p.x > geo.outW || p.y > geo.outH) return;
      const src = applyAffine(geo.outToSrc, p.x, p.y);
      void whiteBalanceAt(photo.id, src.x * current.scale, src.y * current.scale).then((ok) => ok && setStore({ tool: 'none' }));
      return;
    }
    if (tool === 'level') {
      setLine({ x0: local.x, y0: local.y, x1: local.x, y1: local.y });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    press.current = { x: e.clientX, y: e.clientY, vx: vp.view.x, vy: vp.view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (line) {
      const rect = e.currentTarget.getBoundingClientRect();
      setLine({ ...line, x1: e.clientX - rect.left, y1: e.clientY - rect.top });
      return;
    }
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    vp.setView({ ...vp.view, x: p.vx + dx, y: p.vy + dy });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (line && photo) {
      const l = line;
      setLine(null);
      if (Math.hypot(l.x1 - l.x0, l.y1 - l.y0) > 12 && fullW) {
        const delta = straightenFromLine(l.x0, l.y0, l.x1, l.y1);
        const latest = getPhoto(photo.id)!.settings;
        editorFor(photo).apply(withStraighten(latest, latest.straighten + delta, fullW, fullH), t('Straighten'));
        setStore({ tool: 'none' });
      }
      return;
    }
    const p = press.current;
    press.current = null;
    if (!p || p.moved) return;
    // click toggles fit ↔ 100% at the clicked point
    const rect = e.currentTarget.getBoundingClientRect();
    if (vp.zoom < 0.999) vp.zoomTo(1, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    else vp.fit();
  };

  /* --------------------------------- states --------------------------------- */
  let message: React.ReactNode = null;
  if (!renderer) {
    message = (
      <>
        <Monitor size={30} />
        <strong style={{ color: 'var(--text-0)' }}>{t('WebGL 2 is not available')}</strong>
        <span>{t('Photo Develop renders on the GPU. Enable hardware acceleration (or update your graphics driver / browser) and reopen the module. You can still rate, flag and organize photos in the Library.')}</span>
        {rendererProblem() && <span className="faint mono" style={{ fontSize: 11 }}>{rendererProblem()}</span>}
      </>
    );
  } else if (!photo) {
    message = (
      <>
        <ImageOff size={30} />
        <strong style={{ color: 'var(--text-0)' }}>{t('No photo selected')}</strong>
        <span>{t('Import photos or pick one in the Library (G).')}</span>
      </>
    );
  } else if (photo.kind === 'missing') {
    message = (
      <>
        <FileWarning size={30} />
        <strong style={{ color: 'var(--text-0)' }}>{t('The original file of “{name}” is missing', { name: photo.name })}</strong>
        <span>{t('Your edits are kept in the catalog. Locate the original file to continue editing.')}</span>
        <Button
          variant="primary"
          onClick={async () => {
            const files = await pickFiles({ accept: PHOTO_ACCEPT, multiple: true });
            if (files.length && !(await relinkFiles(files)).size) toast.warning(t('No file matched the missing photo names'));
          }}
        >
          {t('Locate files…')}
        </Button>
      </>
    );
  } else if (!editable) {
    message = (
      <>
        <ImageOff size={30} />
        <strong style={{ color: 'var(--text-0)' }}>{t('“{name}” can’t be developed', { name: photo.name })}</strong>
        <span style={{ maxWidth: 520 }}>{photo.error ?? t('This file type is not supported.')}</span>
      </>
    );
  } else if (loadError) {
    message = (
      <>
        <ImageOff size={30} />
        <strong style={{ color: 'var(--text-0)' }}>{t('Could not open this photo')}</strong>
        <span style={{ maxWidth: 520 }}>{loadError}</span>
      </>
    );
  }

  const showDoc = !message && Boolean(current) && docW > 0;
  const splitX = compare === 'split' && showDoc ? vp.docToScreen(splitPos * docW, 0).x : 0;
  const cursor = vp.spaceHeld ? 'grab' : tool === 'wb' ? 'crosshair' : tool === 'level' ? 'crosshair' : vp.zoom < 0.999 ? 'zoom-in' : 'zoom-out';

  return (
    <div
      ref={containerRef}
      className="dv-viewport"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
        setLine(null);
      }}
    >
      <div ref={docRef} className="dv-doc" style={{ width: docW, height: docH, transform: vp.transform, visibility: showDoc ? 'visible' : 'hidden' }}>
        <canvas ref={detailRef} className="dv-detail" style={{ display: 'none', position: 'absolute' }} />
        {!cropMode && <div className="dv-shadow" />}
      </div>
      {showDoc && cropMode && photo && geo && <CropOverlay photo={photo} wo={geo.wo} ho={geo.ho} fullW={fullW} fullH={fullH} vp={vp} />}
      {showDoc && compare === 'split' && (
        <>
          <div
            className="dv-split"
            style={{ left: splitX }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!(e.buttons & 1)) return;
              e.stopPropagation();
              const p = vp.screenToDoc(e.clientX, e.clientY);
              setStore({ splitPos: Math.max(0.02, Math.min(0.98, p.x / docW)) });
            }}
          />
          <span className="dv-compare-label" style={{ left: Math.max(8, splitX - 70) }}>
            {t('Before')}
          </span>
          <span className="dv-compare-label" style={{ left: splitX + 10 }}>
            {t('After')}
          </span>
        </>
      )}
      {showDoc && compare === 'before' && (
        <span className="dv-compare-label" style={{ left: 10 }}>
          {t('Before')} (\)
        </span>
      )}
      {hoverPreset && showDoc && (
        <span className="dv-compare-label" style={{ right: 10 }}>
          {t('Preview')}: {hoverPreset.builtin ? t(hoverPreset.name) : hoverPreset.name}
        </span>
      )}
      {line && (
        <svg className="dv-crop-svg" style={{ pointerEvents: 'none' }}>
          <line x1={line.x0} y1={line.y0} x2={line.x1} y2={line.y1} stroke="#fff" strokeWidth={1.5} strokeDasharray="5 4" />
        </svg>
      )}
      {tool === 'level' && !line && showDoc && <div className="dv-hud">{t('Draw a line along something that should be level or upright')}</div>}
      {tool === 'wb' && showDoc && <div className="dv-hud">{t('Click a neutral gray or white area')}</div>}
      {message && <div className="dv-center-msg">{message}</div>}
      {!message && (loading || !current) && (
        <div className="dv-center-msg">
          <Spinner size={22} />
        </div>
      )}
    </div>
  );
}
