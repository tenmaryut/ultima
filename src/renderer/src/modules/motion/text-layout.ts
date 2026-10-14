import type { TextData } from './types';

/** Text measurement and layout on a shared canvas (DOM). Results are cached. */

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math']);

export function fontFamilyCss(family: string): string {
  const clean = family.replace(/["';{}<>\\]/g, '').trim() || 'sans-serif';
  return GENERIC_FAMILIES.has(clean.toLowerCase()) ? clean : `"${clean}", sans-serif`;
}

export function fontString(t: Pick<TextData, 'italic' | 'fontWeight' | 'fontSize' | 'fontFamily'>): string {
  return `${t.italic ? 'italic ' : ''}${Math.round(t.fontWeight)} ${Math.max(0.5, t.fontSize)}px ${fontFamilyCss(t.fontFamily)}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    measureCtx = canvas.getContext('2d')!;
  }
  return measureCtx;
}

/** Whether measureText() includes letterSpacing (Chromium does); detected once. */
let spacingMeasured: boolean | null = null;
function measureIncludesSpacing(): boolean {
  if (spacingMeasured === null) {
    const c = ctx();
    c.font = '20px sans-serif';
    c.letterSpacing = '0px';
    const a = c.measureText('ab').width;
    c.letterSpacing = '10px';
    const b = c.measureText('ab').width;
    c.letterSpacing = '0px';
    spacingMeasured = b - a > 5;
  }
  return spacingMeasured;
}

export function supportsLetterSpacing(): boolean {
  return 'letterSpacing' in CanvasRenderingContext2D.prototype;
}

const prefixCache = new Map<string, Float64Array>();

/**
 * Prefix widths of a line: result[i] = x where character i starts (result[length] = full
 * advance including the trailing letter spacing).
 */
export function charOffsets(line: string, font: string, spacing: number): Float64Array {
  const key = `${font}|${spacing}|${line}`;
  let cached = prefixCache.get(key);
  if (cached) return cached;
  const c = ctx();
  const native = supportsLetterSpacing();
  // Detect first: the detection itself changes the context's font.
  const manual = !native || !measureIncludesSpacing();
  c.font = font;
  if (native) c.letterSpacing = `${spacing}px`;
  const chars = Array.from(line);
  cached = new Float64Array(line.length + 1);
  // Index by UTF-16 position so substring offsets line up with String.slice.
  let pos = 0;
  let prefix = '';
  for (let i = 0; i < chars.length; i++) {
    prefix += chars[i];
    const next = pos + chars[i].length;
    const w = c.measureText(prefix).width + (manual ? spacing * (i + 1) : 0);
    for (let k = pos + 1; k <= next; k++) cached[k] = w;
    pos = next;
  }
  if (native) c.letterSpacing = '0px';
  if (prefixCache.size > 400) prefixCache.clear();
  prefixCache.set(key, cached);
  return cached;
}

export interface LayoutLine {
  text: string;
  /** Advance width without the trailing letter spacing. */
  width: number;
  /** Left x of the line in layer space. */
  x: number;
  /** Vertical center of the line in layer space. */
  y: number;
  /** Index of the line's first character in the text without line breaks. */
  start: number;
}

export interface TextLayout {
  font: string;
  lines: LayoutLine[];
  /** Content box in layer space. */
  box: { x: number; y: number; w: number; h: number };
  lineAdvance: number;
  /** Characters without line breaks. */
  charCount: number;
}

const layoutCache = new Map<string, TextLayout>();

export function layoutText(t: TextData, letterSpacing: number): TextLayout {
  const font = fontString(t);
  const key = `${font}|${letterSpacing}|${t.align}|${t.lineHeight}|${t.text}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const rawLines = t.text.replace(/\r\n?/g, '\n').split('\n');
  const lineAdvance = t.fontSize * t.lineHeight;
  const total = rawLines.length * lineAdvance;
  let maxW = 0;
  let start = 0;
  const lines: LayoutLine[] = rawLines.map((text, i) => {
    const offsets = charOffsets(text, font, letterSpacing);
    const width = Math.max(0, offsets[text.length] - (text.length ? letterSpacing : 0));
    maxW = Math.max(maxW, width);
    const line: LayoutLine = { text, width, x: 0, y: -total / 2 + (i + 0.5) * lineAdvance, start };
    start += text.length;
    return line;
  });
  for (const line of lines) {
    if (t.align === 'center') line.x = -line.width / 2;
    else if (t.align === 'right') line.x = -line.width;
  }
  const boxX = t.align === 'center' ? -maxW / 2 : t.align === 'right' ? -maxW : 0;
  const layout: TextLayout = {
    font,
    lines,
    box: { x: boxX, y: -total / 2, w: maxW, h: total },
    lineAdvance,
    charCount: start,
  };
  if (layoutCache.size > 300) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}

/** Fonts finish loading asynchronously: drop cached measurements when they do. */
export function clearTextCaches(): void {
  prefixCache.clear();
  layoutCache.clear();
}
