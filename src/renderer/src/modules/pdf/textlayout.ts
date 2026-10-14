/**
 * Text box layout with the metrics of the standard 14 PDF fonts (pure, unit tested).
 * The same line breaking is used for the on-screen preview and for the text written
 * into the PDF on save, so what you see is what you get.
 */
import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

export type FontFamily = 'helvetica' | 'times' | 'courier';

/** Padding (pt) between a text box edge and its text. */
export const TEXT_PAD = 2;
/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;

export function standardFontFor(family: FontFamily, bold: boolean, italic: boolean): StandardFonts {
  if (family === 'times') {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === 'courier') {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/** CSS font stack that looks like the standard PDF font on screen. */
export function cssFontFamily(family: FontFamily): string {
  if (family === 'times') return "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif";
  if (family === 'courier') return "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', monospace";
  return "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', sans-serif";
}

type Embedder = ReturnType<typeof StandardFontEmbedder.for>;
const embedders = new Map<string, Embedder>();

function embedder(name: StandardFonts): Embedder {
  let e = embedders.get(name);
  if (!e) {
    e = StandardFontEmbedder.for(name as unknown as Parameters<typeof StandardFontEmbedder.for>[0]);
    embedders.set(name, e);
  }
  return e;
}

const winAnsi = () => embedder(StandardFonts.Helvetica).encoding;

/** True when the standard fonts (WinAnsi encoding) can write this character. */
export function isEncodable(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return true;
  if (ch === '\n') return true;
  return winAnsi().canEncodeUnicodeCodePoint(cp);
}

/** Unique characters of `text` that the standard PDF fonts cannot write. */
export function unsupportedCharacters(text: string): string[] {
  const out = new Set<string>();
  for (const ch of normalizeTextForPdf(text)) if (!isEncodable(ch)) out.add(ch);
  return [...out];
}

/** Tabs → spaces, CRLF → LF, other control characters removed. */
export function normalizeTextForPdf(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

export interface FontSpec {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  size: number;
}

/** Width (pt) of a single line of text. Characters the font can't encode are estimated. */
export function textWidth(text: string, font: FontSpec): number {
  const e = embedder(standardFontFor(font.family, font.bold, font.italic));
  let width = 0;
  let run = '';
  const flush = () => {
    if (run) width += e.widthOfTextAtSize(run, font.size);
    run = '';
  };
  for (const ch of text) {
    if (isEncodable(ch)) run += ch;
    else {
      flush();
      const cp = ch.codePointAt(0) ?? 0;
      width += font.size * (isWide(cp) ? 1 : font.family === 'courier' ? 0.6 : 0.58);
    }
  }
  flush();
  return width;
}

export function fontAscent(font: FontSpec): number {
  const f = embedder(standardFontFor(font.family, font.bold, font.italic)).font;
  return ((f.Ascender || f.FontBBox[3]) / 1000) * font.size;
}

export function fontDescent(font: FontSpec): number {
  const f = embedder(standardFontFor(font.family, font.bold, font.italic)).font;
  return ((f.Descender || f.FontBBox[1]) / 1000) * font.size;
}

/** Greedy word wrap. Explicit newlines are kept; words longer than a line are broken. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (maxWidth <= 0 || measure(paragraph) <= maxWidth) {
      out.push(paragraph);
      continue;
    }
    const words = paragraph.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (measure(candidate.trimEnd()) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (/^\s+$/.test(word)) {
        // whitespace that overflows ends the line
        out.push(line.trimEnd());
        line = '';
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = '';
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      // break a long word character by character
      let piece = '';
      for (const ch of word) {
        if (piece && measure(piece + ch) > maxWidth) {
          out.push(piece);
          piece = ch;
        } else piece += ch;
      }
      line = piece;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface TextLayout {
  lines: string[];
  lineHeight: number;
  /** Distance from the top of a line to its baseline. */
  ascent: number;
  /** Upright box size including padding. */
  width: number;
  height: number;
  /** x offset of each line inside the box (alignment). */
  offsets: number[];
}

export type TextAlign = 'left' | 'center' | 'right';

/**
 * Lays out text for a box. With `autoWidth` the box grows with the longest line,
 * otherwise lines wrap at `width`.
 */
export function layoutText(text: string, font: FontSpec, width: number, autoWidth: boolean, align: TextAlign = 'left'): TextLayout {
  const clean = normalizeTextForPdf(text);
  const measure = (s: string) => textWidth(s, font);
  const inner = Math.max(font.size, width - TEXT_PAD * 2);
  const lines = autoWidth ? clean.split('\n') : wrapLines(clean, inner, measure);
  const widths = lines.map(measure);
  const contentW = autoWidth ? Math.max(font.size * 0.5, ...widths) : inner;
  const lineHeight = font.size * LINE_HEIGHT;
  const ascent = fontAscent(font) + (lineHeight - (fontAscent(font) - fontDescent(font))) / 2;
  const offsets = widths.map((w) => (align === 'center' ? (contentW - w) / 2 : align === 'right' ? contentW - w : 0));
  return {
    lines,
    lineHeight,
    ascent,
    width: contentW + TEXT_PAD * 2,
    height: Math.max(1, lines.length) * lineHeight + TEXT_PAD * 2,
    offsets: offsets.map((o) => o + TEXT_PAD),
  };
}
