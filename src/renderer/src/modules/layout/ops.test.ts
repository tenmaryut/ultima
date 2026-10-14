import { describe, expect, it } from 'vitest';
import { createDoc, createShapeFrame, createTextFrame, normalizeDoc, parseProject, serializeDoc } from './model';
import {
  addFrames,
  addPage,
  applyParagraphStyle,
  deleteFrames,
  deleteParagraphStyle,
  deletePage,
  duplicateFrames,
  duplicatePage,
  expandGroups,
  groupFrames,
  linkFrames,
  movePage,
  moveFramesToPage,
  reorderList,
  scaleFramesForResize,
  setPageSize,
  setStoryText,
  setTextOverrides,
  storyText,
  threadOf,
  unlinkAfter,
  updateParagraphStyle,
} from './ops';
import { paletteToTheme, resolveColor, resolveTextStyle, substituteTokens, cleanColor, fontStackFor } from './styles';
import type { LayoutDoc, TextFrame } from './types';
import { MASTER_ID } from './types';

function docWithText(): { doc: LayoutDoc; a: TextFrame; b: TextFrame; c: TextFrame } {
  let doc = createDoc({ presetId: 'a4', pages: 2 });
  const a = createTextFrame({ x: 10, y: 10, w: 100, h: 100, text: 'Hello story' });
  const b = createTextFrame({ x: 10, y: 200, w: 100, h: 100, text: '' });
  const c = createTextFrame({ x: 10, y: 10, w: 100, h: 100, text: 'Other' });
  doc = addFrames(doc, doc.pages[0].id, [a, b]);
  doc = addFrames(doc, doc.pages[1].id, [c]);
  return { doc, a, b, c };
}

describe('documents', () => {
  it('creates documents from presets', () => {
    const doc = createDoc({ presetId: 'instagram-post', pages: 3 });
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages[0].width).toBe(1080);
    expect(doc.unit).toBe('px');
    expect(doc.bleed).toBe(0);
    const print = createDoc({ presetId: 'a4', landscape: true });
    expect(print.pages[0].width).toBeGreaterThan(print.pages[0].height);
    expect(print.bleed).toBeGreaterThan(0);
    expect(print.styles.find((s) => s.id === 'body')).toBeTruthy();
  });

  it('round-trips through the project format', () => {
    const { doc } = docWithText();
    const text = serializeDoc(doc);
    expect(JSON.parse(text)).toMatchObject({ app: 'ultima', module: 'layout', version: 1 });
    expect(parseProject(text)).toEqual(doc);
  });

  it('rejects projects of other modules', () => {
    expect(() => parseProject(JSON.stringify({ app: 'ultima', module: 'photo', doc: {} }))).toThrow();
    expect(() => parseProject('{"hello":1}')).toThrow();
  });

  it('repairs garbage input without throwing', () => {
    const doc = normalizeDoc({
      name: 42,
      unit: 'furlong',
      pages: [
        {
          width: 'big',
          height: -5,
          frames: [
            { type: 'text', x: 'a', text: 'ok\u0000<b>', styleId: 'missing', nextId: 'nope', overrides: { fontSize: 99999, color: 'url(evil)', bogus: 1 } },
            { type: 'image', assetId: 'missing', fit: 'weird' },
            { type: 'nope' },
            null,
            { type: 'shape', shape: 'hexagon', fill: 'javascript:alert(1)', gradient: { stops: [{ color: '#f00', pos: 0 }] } },
            { type: 'table', rows: 2, cols: 2, cells: [['a', 5], 'x'] },
          ],
        },
      ],
      swatches: ['#fff', 'nope'],
      assets: { a: { src: 'http://evil.example/x.png' } },
    });
    expect(doc.name).toBe('Untitled');
    expect(doc.unit).toBe('mm');
    expect(doc.pages[0].height).toBeGreaterThanOrEqual(10);
    const [t, img, shape, table] = doc.pages[0].frames;
    expect(t.type).toBe('text');
    if (t.type === 'text') {
      expect(t.text).toBe('ok<b>');
      expect(t.styleId).toBeNull();
      expect(t.nextId).toBeNull();
      expect(t.overrides.fontSize).toBe(2000);
      expect(t.overrides.color).toBe('$0');
      expect('bogus' in t.overrides).toBe(false);
    }
    expect(img.type === 'image' && img.assetId).toBe(null);
    expect(shape.type === 'shape' && shape.shape).toBe('rect');
    expect(shape.type === 'shape' && shape.fill).toBe('');
    expect(shape.type === 'shape' && shape.gradient).toBeNull();
    expect(table.type === 'table' && table.cells).toEqual([
      ['a', ''],
      ['', ''],
    ]);
    expect(doc.assets).toEqual({});
    expect(doc.swatches[1]).toBe('#ffffff');
    expect(doc.swatches.length).toBeGreaterThanOrEqual(6);
    expect(normalizeDoc(null).pages.length).toBe(1);
  });

  it('breaks thread cycles and duplicate predecessors', () => {
    const doc = normalizeDoc({
      pages: [
        {
          frames: [
            { type: 'text', id: 'a', nextId: 'b', text: 'x' },
            { type: 'text', id: 'b', nextId: 'a' },
            { type: 'text', id: 'c', nextId: 'b' },
          ],
        },
      ],
    });
    const next = new Map(doc.pages[0].frames.map((f) => [f.id, f.type === 'text' ? f.nextId : null]));
    const preds = [...next.values()].filter((v) => v === 'b').length;
    expect(preds).toBeLessThanOrEqual(1);
    expect(threadOf(doc, 'a').length).toBeLessThanOrEqual(3);
  });
});

describe('text threads', () => {
  it('links frames, moves extra text into the story and walks the thread', () => {
    const { doc, a, b, c } = docWithText();
    let d = linkFrames(doc, a.id, b.id);
    expect(threadOf(d, b.id)).toEqual([a.id, b.id]);
    d = linkFrames(d, b.id, c.id);
    expect(threadOf(d, a.id)).toEqual([a.id, b.id, c.id]);
    expect(storyText(d, c.id)).toBe('Hello story\nOther');
    // no cycles
    expect(linkFrames(d, c.id, a.id)).toBe(d);
    d = setStoryText(d, c.id, 'New text');
    expect(storyText(d, b.id)).toBe('New text');
    d = unlinkAfter(d, a.id);
    expect(threadOf(d, a.id)).toEqual([a.id]);
  });

  it('re-links around deleted frames and moves the story to the new head', () => {
    const { doc, a, b, c } = docWithText();
    let d = linkFrames(linkFrames(doc, a.id, b.id), b.id, c.id);
    const middle = deleteFrames(d, d.pages[0].id, [b.id]);
    expect(threadOf(middle, a.id)).toEqual([a.id, c.id]);
    d = deleteFrames(d, d.pages[0].id, [a.id, b.id]);
    expect(threadOf(d, c.id)).toEqual([c.id]);
    expect(storyText(d, c.id)).toBe('Hello story\nOther');
  });

  it('applies text style overrides to the whole thread', () => {
    const { doc, a, b } = docWithText();
    let d = linkFrames(doc, a.id, b.id);
    d = setTextOverrides(d, d.pages[0].id, [a.id], { fontSize: 30 });
    const fb = d.pages[0].frames.find((f) => f.id === b.id) as TextFrame;
    expect(resolveTextStyle(fb, d.styles).fontSize).toBe(30);
    // overrides equal to the style are pruned
    d = setTextOverrides(d, d.pages[0].id, [a.id], { fontSize: d.styles.find((s) => s.id === 'body')!.style.fontSize });
    expect((d.pages[0].frames.find((f) => f.id === a.id) as TextFrame).overrides.fontSize).toBeUndefined();
  });
});

describe('frame operations', () => {
  it('duplicates frames with new ids and offsets', () => {
    const { doc, a } = docWithText();
    const r = duplicateFrames(doc, doc.pages[0].id, [a.id], 10, 20);
    expect(r.ids).toHaveLength(1);
    const copy = r.doc.pages[0].frames.find((f) => f.id === r.ids[0])!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.x).toBe(a.x + 10);
    expect(copy.y).toBe(a.y + 20);
  });

  it('copies of continuation frames get the visible text', () => {
    const { doc, a, b } = docWithText();
    const d = linkFrames(doc, a.id, b.id);
    const r = duplicateFrames(d, d.pages[0].id, [b.id], 0, 0, () => 'visible part');
    const copy = r.doc.pages[0].frames.find((f) => f.id === r.ids[0]) as TextFrame;
    expect(copy.text).toBe('visible part');
    expect(copy.nextId).toBeNull();
  });

  it('reorders z-order', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    const ids = (l: { id: string }[]) => l.map((x) => x.id).join('');
    expect(ids(reorderList(list, ['b'], 'front'))).toBe('acdb');
    expect(ids(reorderList(list, ['c'], 'back'))).toBe('cabd');
    expect(ids(reorderList(list, ['b'], 'forward'))).toBe('acbd');
    expect(ids(reorderList(list, ['c'], 'backward'))).toBe('acbd');
    expect(reorderList(list, ['d'], 'forward')).toBe(list);
  });

  it('groups frames and expands group selection', () => {
    let doc = createDoc();
    const s1 = createShapeFrame();
    const s2 = createShapeFrame();
    const s3 = createShapeFrame();
    doc = addFrames(doc, doc.pages[0].id, [s1, s2, s3]);
    doc = groupFrames(doc, doc.pages[0].id, [s1.id, s2.id]);
    expect(expandGroups(doc.pages[0].frames, [s1.id]).sort()).toEqual([s1.id, s2.id].sort());
    expect(expandGroups(doc.pages[0].frames, [s3.id])).toEqual([s3.id]);
  });

  it('moves frames between pages', () => {
    const { doc, a } = docWithText();
    const d = moveFramesToPage(doc, doc.pages[0].id, doc.pages[1].id, [a.id], 5, -5);
    expect(d.pages[0].frames.some((f) => f.id === a.id)).toBe(false);
    const moved = d.pages[1].frames.find((f) => f.id === a.id)!;
    expect(moved.x).toBe(a.x + 5);
  });
});

describe('pages', () => {
  it('adds, duplicates, moves and deletes pages', () => {
    const { doc, a } = docWithText();
    let d = addPage(doc, 1);
    expect(d.pages).toHaveLength(3);
    expect(d.pages[1].frames).toHaveLength(0);
    const dup = duplicatePage(d, d.pages[0].id);
    d = dup.doc;
    expect(d.pages).toHaveLength(4);
    expect(d.pages[1].id).toBe(dup.pageId);
    expect(d.pages[1].frames).toHaveLength(2);
    expect(d.pages[1].frames[0].id).not.toBe(a.id);
    d = movePage(d, 0, 3);
    expect(d.pages[3].frames.some((f) => f.id === a.id)).toBe(true);
    d = deletePage(d, d.pages[3].id);
    expect(d.pages).toHaveLength(3);
    let single = createDoc();
    single = deletePage(single, single.pages[0].id);
    expect(single.pages).toHaveLength(1);
  });

  it('resizes pages, optionally scaling the content', () => {
    let doc = createDoc({ presetId: 'instagram-post' });
    const t = createTextFrame({ x: 100, y: 100, w: 200, h: 100, overrides: { fontSize: 40 } });
    doc = addFrames(doc, doc.pages[0].id, [t]);
    const plain = setPageSize(doc, 'all', 1080, 1920, 'instagram-story');
    expect(plain.pages[0].height).toBe(1920);
    expect(plain.pages[0].frames[0].x).toBe(100);
    const scaled = setPageSize(doc, 'all', 540, 540, 'custom', true);
    const f = scaled.pages[0].frames[0] as TextFrame;
    expect(f.x).toBeCloseTo(50);
    expect(f.w).toBeCloseTo(100);
    expect(f.overrides.fontSize).toBeCloseTo(20);
    const frames = scaleFramesForResize([t], doc.styles, 1000, 1000, 2000, 1000);
    expect(frames[0].x).toBeCloseTo(600);
  });
});

describe('styles and colors', () => {
  it('updates every frame using a paragraph style', () => {
    const { doc, a } = docWithText();
    let d = applyParagraphStyle(doc, doc.pages[0].id, [a.id], 'h1');
    d = updateParagraphStyle(d, 'h1', { fontSize: 77 });
    const f = d.pages[0].frames.find((x) => x.id === a.id) as TextFrame;
    expect(resolveTextStyle(f, d.styles).fontSize).toBe(77);
    d = deleteParagraphStyle(d, 'h1');
    const g = d.pages[0].frames.find((x) => x.id === a.id) as TextFrame;
    expect(g.styleId).toBeNull();
    expect(resolveTextStyle(g, d.styles).fontSize).toBe(77);
  });

  it('applies paragraph styles to master frames', () => {
    let doc = createDoc();
    const t = createTextFrame({ text: 'Footer' });
    doc = addFrames(doc, MASTER_ID, [t]);
    doc = applyParagraphStyle(doc, MASTER_ID, [t.id], 'caption');
    expect((doc.master.frames[0] as TextFrame).styleId).toBe('caption');
  });

  it('resolves theme references and validates colors', () => {
    expect(resolveColor('$2', ['#000', '#111', '#222'])).toBe('#222');
    expect(resolveColor('$9', ['#000'], 'x')).toBe('x');
    expect(resolveColor('', ['#000'], 'none')).toBe('none');
    expect(cleanColor('#ABC', 'x')).toBe('#aabbcc');
    expect(cleanColor('rgba(1,2,3,0.5)', 'x')).toBe('rgba(1, 2, 3, 0.5)');
    expect(cleanColor('red; background:url(x)', 'x')).toBe('x');
    expect(cleanColor('', 'x', true)).toBe('');
    expect(cleanColor('$3', 'x')).toBe('$3');
  });

  it('maps palettes to readable theme roles', () => {
    const theme = paletteToTheme(['#e9c46a', '#264653', '#2a9d8f', '#f4a261', '#e76f51']);
    expect(theme[0]).toBe('#264653');
    expect(theme.length).toBeGreaterThanOrEqual(6);
    const mono = paletteToTheme(['#888888']);
    expect(mono[0]).toBe('#111111');
    expect(mono[1]).toBe('#ffffff');
  });

  it('builds font stacks with fallbacks', () => {
    expect(fontStackFor('Montserrat')).toContain('sans-serif');
    expect(fontStackFor('Playfair Display')).toContain('serif');
    expect(fontStackFor('Fira Code')).toContain('monospace');
    expect(fontStackFor("Evil'; } body { x")).not.toContain(';');
  });

  it('substitutes page tokens', () => {
    expect(substituteTokens('Page {page} of {pages}', '3', '9')).toBe('Page 3 of 9');
    expect(substituteTokens('no tokens', '1', '2')).toBe('no tokens');
  });
});
