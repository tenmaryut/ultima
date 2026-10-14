import { describe, expect, it } from 'vitest';
import { detectHexColors, detectSvg, markdownToPlain, titleFrom } from './detect';

describe('detectSvg', () => {
  it('finds an svg inside a code fence', () => {
    const text = 'Here:\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n```\nEnjoy';
    expect(detectSvg(text)).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  });
  it('handles nested svg elements', () => {
    const svg = '<svg viewBox="0 0 10 10"><svg x="1"><circle r="1"/></svg><rect/></svg>';
    expect(detectSvg(`text ${svg} more`)).toBe(svg);
  });
  it('handles self-closing and multi-line tags, case-insensitively', () => {
    expect(detectSvg('a <svg width="1"/> b')).toBe('<svg width="1"/>');
    const svg = '<SVG\n  viewBox="0 0 1 1">\n<g/></SVG>';
    expect(detectSvg(svg)).toBe(svg);
  });
  it('returns null for missing or unclosed svg', () => {
    expect(detectSvg('no markup here')).toBeNull();
    expect(detectSvg('<svg viewBox="0 0 1 1"><rect/>')).toBeNull();
    expect(detectSvg('<svgfoo></svgfoo>')).toBeNull();
  });
  it('returns the first of several', () => {
    expect(detectSvg('<svg id="a"></svg> and <svg id="b"></svg>')).toBe('<svg id="a"></svg>');
  });
});

describe('detectHexColors', () => {
  it('finds unique colors in order and normalizes them', () => {
    expect(detectHexColors('Primary #1E5EB0, accent #f6c445 and #1e5eb0 again, plus #FFF.')).toEqual(['#1e5eb0', '#f6c445', '#ffffff']);
  });
  it('ignores numbers, entities, longer hex strings and hashtags', () => {
    expect(detectHexColors('Issue #123, &#123; entity, hash #abcdef12, tag #summer, #12345')).toEqual([]);
  });
  it('finds colors in markdown lists and code', () => {
    const md = '- `#0B2545` Abyss\n- **#13315C** Deep\n| #8DA9C4 | Mist |\nfill="#EEF4ED"';
    expect(detectHexColors(md)).toEqual(['#0b2545', '#13315c', '#8da9c4', '#eef4ed']);
  });
  it('respects the maximum', () => {
    const many = Array.from({ length: 30 }, (_, i) => `#${(i * 123456 + 1048576).toString(16).slice(-6)}`).join(' ');
    expect(detectHexColors(many, 5)).toHaveLength(5);
  });
});

describe('markdown helpers', () => {
  it('converts markdown to plain text', () => {
    const md = '# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n[link](https://x.y)';
    expect(markdownToPlain(md)).toBe('Title\n\nSome bold and italic and code.\n\n• one\n• two\n\nconst a = 1;\nlink (https://x.y)');
  });
  it('makes a title from the first line', () => {
    expect(titleFrom('## Plan my trip to Bali\nmore')).toBe('Plan my trip to Bali');
    expect(titleFrom('x'.repeat(100), 20)).toHaveLength(20);
    expect(titleFrom('   ')).toBe('');
  });
});
