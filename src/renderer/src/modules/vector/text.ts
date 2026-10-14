import type { Rect } from './matrix';
import type { TextObject } from './model';
import { geomBounds } from './path';

export interface FontSpec {
  family: string;
  size: number;
  weight: number;
  italic: boolean;
}

export interface FontMetrics {
  /** Distance from the baseline to the top of the font's em box (positive). */
  ascent: number;
  descent: number;
}

export interface TextMeasurer {
  width(text: string, font: FontSpec): number;
  metrics(font: FontSpec): FontMetrics;
}

/** Rough estimate used in tests / when no canvas is available. */
const estimateMeasurer: TextMeasurer = {
  width(text, font) {
    let w = 0;
    for (const ch of text) {
      if (/[il.,:;'|!\s]/.test(ch)) w += 0.3;
      else if (/[mwMW@]/.test(ch)) w += 0.85;
      else if (/[A-Z0-9]/.test(ch)) w += 0.65;
      else w += 0.55;
    }
    return w * font.size * (font.weight >= 600 ? 1.05 : 1);
  },
  metrics(font) {
    return { ascent: font.size * 0.9, descent: font.size * 0.22 };
  },
};

let measurer: TextMeasurer = estimateMeasurer;
const widthCache = new Map<string, number>();

/** Installs a real measurer (canvas based) — called once by the UI. */
export function setTextMeasurer(m: TextMeasurer): void {
  measurer = m;
  widthCache.clear();
}

/** Family list for CSS / SVG: quotes names with spaces and adds a generic fallback. */
export function cssFontFamily(family: string): string {
  const generic = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
  const clean = family.replace(/["'<>;{}]/g, '').trim() || 'sans-serif';
  if (generic.includes(clean)) return clean;
  const quoted = /\s/.test(clean) ? `'${clean}'` : clean;
  const fallback = /mono|courier|consol/i.test(clean) ? 'monospace' : /serif|times|georgia|garamond/i.test(clean) && !/sans/i.test(clean) ? 'serif' : 'sans-serif';
  return `${quoted}, ${fallback}`;
}

export function fontShorthand(font: FontSpec): string {
  return `${font.italic ? 'italic ' : ''}${font.weight} ${font.size}px ${cssFontFamily(font.family)}`;
}

export function fontOf(o: Pick<TextObject, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic'>): FontSpec {
  return { family: o.fontFamily, size: o.fontSize, weight: o.fontWeight, italic: o.italic };
}

export function measureLine(text: string, font: FontSpec, letterSpacing = 0): number {
  if (!text) return 0;
  const key = `${fontShorthand(font)}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    w = measurer.width(text, font);
    if (widthCache.size > 4000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w + letterSpacing * [...text].length;
}

export function fontMetrics(font: FontSpec): FontMetrics {
  return measurer.metrics(font);
}

export interface TextLine {
  text: string;
  width: number;
  /** Left edge in local coordinates. */
  x: number;
  /** Baseline in local coordinates. */
  baseline: number;
}

export interface TextLayout {
  lines: TextLine[];
  width: number;
  lineHeight: number;
  ascent: number;
  descent: number;
  bounds: Rect;
}

/** Anchor factor: 0 = left, 0.5 = center, 1 = right. */
export function alignFactor(align: TextObject['align']): number {
  return align === 'center' ? 0.5 : align === 'right' ? 1 : 0;
}

export function layoutText(o: Pick<TextObject, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'letterSpacing' | 'lineHeight' | 'align'>): TextLayout {
  const font = fontOf(o);
  const { ascent, descent } = fontMetrics(font);
  const lh = o.fontSize * o.lineHeight;
  const a = alignFactor(o.align);
  const rows = o.text.split('\n');
  let maxW = 0;
  const lines: TextLine[] = rows.map((text, i) => {
    const width = measureLine(text, font, o.letterSpacing);
    maxW = Math.max(maxW, width);
    return { text, width, x: -width * a, baseline: i * lh };
  });
  const width = Math.max(maxW, o.fontSize * 0.3);
  const bounds: Rect = {
    x: -width * a,
    y: -ascent,
    width,
    height: ascent + descent + (rows.length - 1) * lh,
  };
  return { lines, width, lineHeight: lh, ascent, descent, bounds };
}

/** Local bounds of a text object (point text or text on a path). */
export function textBounds(o: TextObject): Rect {
  if (o.onPath) {
    const b = geomBounds(o.onPath.geom);
    if (b) {
      const pad = o.fontSize;
      return { x: b.x - pad * 0.25, y: b.y - pad, width: b.width + pad * 0.5, height: b.height + pad * 1.3 };
    }
  }
  return layoutText(o).bounds;
}
