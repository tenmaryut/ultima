/**
 * Gradient model + CSS / SVG serialisation. Pure functions — unit tested.
 */
import { parseColor } from '../../core/utils/color';
import { uid } from '../../core/utils/id';
import { toHex } from './colormath';

export type GradientType = 'linear' | 'radial' | 'conic';
export type Interpolation = 'srgb' | 'oklab';

export interface GradientStop {
  id: string;
  /** CSS color: #rrggbb or rgba(). */
  color: string;
  /** 0–100 (%). */
  position: number;
}

export interface GradientDoc {
  type: GradientType;
  /** Degrees (linear direction / conic start angle). */
  angle: number;
  shape: 'circle' | 'ellipse';
  /** Center for radial/conic gradients (%). */
  cx: number;
  cy: number;
  interpolation: Interpolation;
  stops: GradientStop[];
}

export function makeStop(color: string, position: number): GradientStop {
  return { id: uid('gs'), color, position: clampPos(position) };
}

export function clampPos(p: number): number {
  return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p * 10) / 10)) : 0;
}

export function defaultGradient(colors: string[] = ['#ff7a18', '#af002d', '#319197']): GradientDoc {
  return { type: 'linear', angle: 90, shape: 'circle', cx: 50, cy: 50, interpolation: 'srgb', stops: evenStops(colors) };
}

export function evenStops(colors: string[]): GradientStop[] {
  const list = colors.length ? colors : ['#000000', '#ffffff'];
  if (list.length === 1) return [makeStop(list[0], 0), makeStop(list[0], 100)];
  return list.map((c, i) => makeStop(c, (i / (list.length - 1)) * 100));
}

export function sortedStops(g: GradientDoc): GradientStop[] {
  return [...g.stops].sort((a, b) => a.position - b.position);
}

const fmtNum = (n: number) => String(Math.round(n * 10) / 10);

/** The CSS gradient function, e.g. `linear-gradient(90deg, #ff0000 0%, #0000ff 100%)`. */
export function gradientCss(g: GradientDoc, options: { interpolation?: boolean } = {}): string {
  const stops = sortedStops(g)
    .map((s) => `${s.color} ${fmtNum(s.position)}%`)
    .join(', ');
  const interp = options.interpolation !== false && g.interpolation === 'oklab' ? ' in oklab' : '';
  const angle = `${fmtNum(((g.angle % 360) + 360) % 360)}deg`;
  switch (g.type) {
    case 'linear':
      return `linear-gradient(${angle}${interp}, ${stops})`;
    case 'radial':
      return `radial-gradient(${g.shape} at ${fmtNum(g.cx)}% ${fmtNum(g.cy)}%${interp}, ${stops})`;
    case 'conic':
      return `conic-gradient(from ${angle} at ${fmtNum(g.cx)}% ${fmtNum(g.cy)}%${interp}, ${stops})`;
  }
}

/** A ready-to-paste CSS declaration (with an sRGB fallback when interpolating in OKLab). */
export function gradientCssSnippet(g: GradientDoc): string {
  const main = `background: ${gradientCss(g)};`;
  if (g.interpolation !== 'oklab') return main;
  return `background: ${gradientCss(g, { interpolation: false })};\n${main}`;
}

function svgColor(color: string): { color: string; opacity: number } {
  const c = parseColor(color);
  if (!c) return { color: '#000000', opacity: 1 };
  return { color: toHex(c), opacity: Math.round(c.a * 1000) / 1000 };
}

/** SVG document of the gradient (conic gradients are not part of SVG → null). */
export function gradientSvg(g: GradientDoc, width = 1200, height = 600): string | null {
  if (g.type === 'conic') return null;
  const stops = sortedStops(g)
    .map((s) => {
      const c = svgColor(s.color);
      return `<stop offset="${fmtNum(s.position)}%" stop-color="${c.color}"${c.opacity < 1 ? ` stop-opacity="${c.opacity}"` : ''}/>`;
    })
    .join('');
  let def: string;
  if (g.type === 'linear') {
    // CSS angle: 0deg = to top, clockwise. Gradient line length covers the box corners.
    const rad = (g.angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
    const cx = width / 2;
    const cy = height / 2;
    const x1 = cx - dx * half;
    const y1 = cy - dy * half;
    const x2 = cx + dx * half;
    const y2 = cy + dy * half;
    def = `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${fmtNum(x1)}" y1="${fmtNum(y1)}" x2="${fmtNum(x2)}" y2="${fmtNum(y2)}">${stops}</linearGradient>`;
  } else {
    const cx = (g.cx / 100) * width;
    const cy = (g.cy / 100) * height;
    // farthest-corner sizing, like CSS
    const fx = Math.max(cx, width - cx);
    const fy = Math.max(cy, height - cy);
    if (g.shape === 'circle') {
      const r = Math.hypot(fx, fy);
      def = `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${fmtNum(cx)}" cy="${fmtNum(cy)}" r="${fmtNum(r)}">${stops}</radialGradient>`;
    } else {
      const rx = fx * Math.SQRT2;
      const ry = fy * Math.SQRT2;
      def = `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${fmtNum(cx)}" cy="${fmtNum(cy)}" r="${fmtNum(rx)}" gradientTransform="translate(${fmtNum(cx)} ${fmtNum(cy)}) scale(1 ${fmtNum(ry / rx)}) translate(${fmtNum(-cx)} ${fmtNum(-cy)})">${stops}</radialGradient>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${def}</defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

/** sRGB interpolated color of the gradient at `position` (0–100), as #rrggbb. */
export function colorAt(g: GradientDoc, position: number): string {
  const stops = sortedStops(g);
  if (!stops.length) return '#000000';
  const parse = (s: GradientStop) => parseColor(s.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  if (position <= stops[0].position) return toHex(parse(stops[0]));
  for (let i = 1; i < stops.length; i++) {
    if (position <= stops[i].position) {
      const a = parse(stops[i - 1]);
      const b = parse(stops[i]);
      const span = stops[i].position - stops[i - 1].position || 1;
      const t = (position - stops[i - 1].position) / span;
      return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
    }
  }
  return toHex(parse(stops[stops.length - 1]));
}

export function isGradientType(v: unknown): v is GradientType {
  return v === 'linear' || v === 'radial' || v === 'conic';
}
