import { useRef } from 'react';
import type { ViewportApi } from '../../../core/viewport';
import { useT } from '../../../core/i18n';
import { constrainCropMove, cropToPx, pxToCrop, type Rect } from '../geometry';
import { aspectRatioOf, type DevelopSettings } from '../params';
import { withStraighten } from '../ops';
import { getPhoto, setStore, useDevelop } from '../store';
import type { Photo } from '../types';
import { editorFor } from './common';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface Drag {
  mode: 'move' | 'resize' | 'rotate';
  handle?: Handle;
  start: Rect;
  pointer: { x: number; y: number };
  settings: DevelopSettings;
  angle0: number;
}

function handlePoint(r: Rect, h: Handle): { x: number; y: number } {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

function resizeRect(start: Rect, h: Handle, p: { x: number; y: number }, ratio: number | null, min: number): Rect {
  const x1 = start.x + start.w;
  const y1 = start.y + start.h;
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  if (h.length === 2) {
    const sx = h.includes('e') ? 1 : -1;
    const sy = h.includes('s') ? 1 : -1;
    const ax = sx > 0 ? start.x : x1;
    const ay = sy > 0 ? start.y : y1;
    let w = Math.max(min, (p.x - ax) * sx);
    let hh = Math.max(min, (p.y - ay) * sy);
    if (ratio) {
      if (w / hh > ratio) w = hh * ratio;
      else hh = w / ratio;
    }
    return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - hh, w, h: hh };
  }
  if (h === 'e' || h === 'w') {
    const w = Math.max(min, h === 'e' ? p.x - start.x : x1 - p.x);
    const hh = ratio ? w / ratio : start.h;
    return { x: h === 'e' ? start.x : x1 - w, y: ratio ? cy - hh / 2 : start.y, w, h: hh };
  }
  const hh = Math.max(min, h === 's' ? p.y - start.y : y1 - p.y);
  const w = ratio ? hh * ratio : start.w;
  return { x: ratio ? cx - w / 2 : start.x, y: h === 's' ? start.y : y1 - hh, w, h: hh };
}

/** Crop rectangle editor drawn over the uncropped, straightened image (screen space). */
export function CropOverlay({ photo, wo, ho, fullW, fullH, vp }: { photo: Photo; wo: number; ho: number; fullW: number; fullH: number; vp: ViewportApi }) {
  const t = useT();
  const overlay = useDevelop((s) => s.overlay);
  const drag = useRef<Drag | null>(null);
  const s = photo.settings;
  const rect = cropToPx(s, wo, ho);
  const a = vp.docToScreen(rect.x, rect.y);
  const b = vp.docToScreen(rect.x + rect.w, rect.y + rect.h);
  const sx = a.x;
  const sy = a.y;
  const sw = b.x - a.x;
  const sh = b.y - a.y;
  const ed = editorFor(photo);

  const lines: number[] = overlay === 'thirds' ? [1 / 3, 2 / 3] : overlay === 'golden' ? [0.382, 0.618] : overlay === 'grid' ? [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6] : [];

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = vp.screenToDoc(e.clientX, e.clientY);
    const box = e.currentTarget.getBoundingClientRect();
    const local = { x: e.clientX - box.left, y: e.clientY - box.top };
    let handle: Handle | undefined;
    for (const h of HANDLES) {
      const hp = handlePoint({ x: sx, y: sy, w: sw, h: sh }, h);
      if (Math.abs(hp.x - local.x) <= 9 && Math.abs(hp.y - local.y) <= 9) handle = h;
    }
    const inside = local.x > sx && local.x < sx + sw && local.y > sy && local.y < sy + sh;
    const latest = getPhoto(photo.id)?.settings ?? s;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    drag.current = {
      mode: handle ? 'resize' : inside ? 'move' : 'rotate',
      handle,
      start: cropToPx(latest, wo, ho),
      pointer: p,
      settings: latest,
      angle0: Math.atan2(p.y - cy, p.x - cx),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = vp.screenToDoc(e.clientX, e.clientY);
    const angle = d.settings.straighten;
    if (d.mode === 'rotate') {
      const cx = d.start.x + d.start.w / 2;
      const cy = d.start.y + d.start.h / 2;
      const delta = ((Math.atan2(p.y - cy, p.x - cx) - d.angle0) * 180) / Math.PI;
      const wrapped = ((delta + 540) % 360) - 180;
      ed.live(withStraighten(d.settings, d.settings.straighten + wrapped, fullW, fullH));
      return;
    }
    let target: Rect;
    if (d.mode === 'move') {
      target = { ...d.start, x: d.start.x + p.x - d.pointer.x, y: d.start.y + p.y - d.pointer.y };
    } else {
      const ratio = aspectRatioOf(d.settings.cropAspect, wo, ho);
      target = resizeRect(d.start, d.handle!, p, ratio, Math.max(wo, ho) * 0.02);
    }
    const next = constrainCropMove(d.start, target, wo, ho, angle);
    ed.live(pxToCrop(next, wo, ho));
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d) ed.commit(d.mode === 'rotate' ? t('Straighten') : t('Crop'));
  };

  const cursorFor = (h: Handle) => (h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize');

  return (
    <svg
      className="dv-crop-svg"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => setStore({ cropMode: false })}
      style={{ cursor: 'alias' }}
    >
      <path d={`M-10000,-10000 H10000 V10000 H-10000 Z M${sx},${sy} V${sy + sh} H${sx + sw} V${sy} Z`} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
      <rect x={sx} y={sy} width={sw} height={sh} fill="transparent" stroke="#fff" strokeWidth={1} style={{ cursor: 'move' }} />
      {lines.map((f) => (
        <g key={f} stroke="rgba(255,255,255,0.55)" strokeWidth={0.8} pointerEvents="none">
          <line x1={sx + sw * f} y1={sy} x2={sx + sw * f} y2={sy + sh} />
          <line x1={sx} y1={sy + sh * f} x2={sx + sw} y2={sy + sh * f} />
        </g>
      ))}
      {HANDLES.map((h) => {
        const hp = handlePoint({ x: sx, y: sy, w: sw, h: sh }, h);
        return <rect key={h} className="dv-crop-handle" x={hp.x - 4} y={hp.y - 4} width={8} height={8} style={{ cursor: cursorFor(h) }} />;
      })}
      <text x={sx + 6} y={sy + sh - 8} fill="#fff" fontSize={11} style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 3 }} pointerEvents="none">
        {Math.round(rect.w)} × {Math.round(rect.h)} · {s.straighten ? `${s.straighten.toFixed(1)}°` : ''}
      </text>
    </svg>
  );
}
