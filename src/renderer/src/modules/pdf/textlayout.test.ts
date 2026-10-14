import { describe, expect, it } from 'vitest';
import { isEncodable, layoutText, standardFontFor, TEXT_PAD, textWidth, unsupportedCharacters, wrapLines } from './textlayout';
import { relayoutText, makeTextAnnot, moveAnnot, resizeAnnot, annotBounds, hitTest, inkPathD, simplifyStroke } from './annots';
import { contentFrame } from './geometry';

const font = { family: 'helvetica' as const, bold: false, italic: false, size: 10 };

describe('standard font metrics', () => {
  it('picks the right standard font', () => {
    expect(standardFontFor('times', true, true)).toBe('Times-BoldItalic');
    expect(standardFontFor('courier', false, true)).toBe('Courier-Oblique');
    expect(standardFontFor('helvetica', true, false)).toBe('Helvetica-Bold');
  });
  it('measures text with AFM widths', () => {
    // Courier is monospaced: 600 units per glyph
    expect(textWidth('abcd', { ...font, family: 'courier' })).toBeCloseTo(24);
    expect(textWidth('', font)).toBe(0);
  });
  it('detects characters outside WinAnsi', () => {
    expect(isEncodable('é')).toBe(true);
    expect(isEncodable('€')).toBe(true);
    expect(isEncodable('中')).toBe(false);
    expect(unsupportedCharacters('Héllo 中文 ✓')).toEqual(['中', '文', '✓']);
    // unsupported characters are estimated instead of throwing
    expect(textWidth('中文', font)).toBeCloseTo(20);
  });
});

describe('wrapping', () => {
  const measure = (s: string) => s.length;
  it('wraps greedily on spaces', () => {
    expect(wrapLines('aaa bbb ccc', 7, measure)).toEqual(['aaa bbb', 'ccc']);
  });
  it('keeps explicit newlines and empty lines', () => {
    expect(wrapLines('a\n\nb', 10, measure)).toEqual(['a', '', 'b']);
  });
  it('breaks words longer than a line', () => {
    expect(wrapLines('abcdefghij', 4, measure)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('lays out boxes with padding and alignment', () => {
    const l = layoutText('Hello\nWorld!', font, 100, true);
    expect(l.lines).toEqual(['Hello', 'World!']);
    expect(l.height).toBeCloseTo(2 * 12 + TEXT_PAD * 2);
    expect(l.width).toBeCloseTo(textWidth('World!', font) + TEXT_PAD * 2);
    const right = layoutText('a', font, 100, false, 'right');
    expect(right.offsets[0]).toBeCloseTo(100 - TEXT_PAD - textWidth('a', font));
  });
});

describe('text annotations', () => {
  it('auto sizes and keeps the visual top-left when text changes', () => {
    const a = makeTextAnnot('p1', { x: 100, y: 700 }, 0, { text: 'Hi', font: 'helvetica', bold: false, italic: false, size: 12, color: '#000' });
    expect(contentFrame(a.rect, 0).origin).toEqual({ x: 100, y: 700 });
    const b = relayoutText({ ...a, text: 'Hi\nthere' });
    expect(b.rect.h).toBeGreaterThan(a.rect.h);
    expect(contentFrame(b.rect, 0).origin.x).toBeCloseTo(100);
    expect(contentFrame(b.rect, 0).origin.y).toBeCloseTo(700);
  });
  it('rotated text boxes grow along the rotated axes', () => {
    const a = makeTextAnnot('p1', { x: 100, y: 200 }, 90, { text: 'Rotated text', font: 'helvetica', bold: false, italic: false, size: 12, color: '#000' });
    const f = contentFrame(a.rect, 90);
    expect(f.origin).toEqual({ x: 100, y: 200 });
    // upright width runs along +y in user space
    expect(a.rect.h).toBeCloseTo(f.width);
  });
  it('resizing a text box changes its wrap width', () => {
    const a = makeTextAnnot('p1', { x: 0, y: 500 }, 0, { text: 'one two three four five six', font: 'helvetica', bold: false, italic: false, size: 12, color: '#000' });
    const b = resizeAnnot(a, { ...a.rect, w: 60 });
    if (b.type !== 'text') throw new Error('expected text');
    expect(b.autoWidth).toBe(false);
    expect(b.rect.w).toBeCloseTo(60);
    expect(b.rect.h).toBeGreaterThan(a.rect.h);
  });
});

describe('annotation geometry', () => {
  const line = { id: 'l', page: 'p', type: 'line' as const, x1: 0, y1: 0, x2: 100, y2: 0, color: '#000', width: 2, opacity: 1 };
  it('hit tests lines with tolerance', () => {
    expect(hitTest(line, { x: 50, y: 2 }, 2)).toBe(true);
    expect(hitTest(line, { x: 50, y: 6 }, 2)).toBe(false);
  });
  it('moves and resizes', () => {
    const moved = moveAnnot(line, 10, 5);
    expect(moved.type === 'line' && [moved.x1, moved.y1, moved.x2, moved.y2]).toEqual([10, 5, 110, 5]);
    const ink = { id: 'i', page: 'p', type: 'ink' as const, strokes: [[0, 0, 10, 10]], color: '#000', width: 0, opacity: 1 };
    const r = resizeAnnot(ink, { x: 0, y: 0, w: 20, h: 20 });
    expect(r.type === 'ink' && r.strokes[0]).toEqual([0, 0, 20, 20]);
    expect(annotBounds(ink)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
  it('builds smooth ink paths and simplifies strokes', () => {
    expect(inkPathD([0, 0, 10, 10])).toBe('M0 0 L10 10');
    expect(inkPathD([0, 0, 10, 10, 20, 0], true)).toBe('M0 0 Q10 -10 15 -5 L20 0');
    expect(simplifyStroke([0, 0, 0.1, 0.1, 0.2, 0.2, 5, 5, 5.1, 5.1])).toEqual([0, 0, 5, 5, 5.1, 5.1]);
  });
});
