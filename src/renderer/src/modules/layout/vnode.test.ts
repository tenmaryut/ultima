import { describe, expect, it } from 'vitest';
import { addFrames } from './ops';
import { createDoc, createImageFrame, createShapeFrame, createTableFrame, createTextFrame } from './model';
import { computeFlows, splitAt, splitPoint, type Measurer } from './textflow';
import { linkFrames } from './ops';
import { MASTER_ID, type TextFrame } from './types';
import { escapeText, frameNode, isLeftPage, mirrorFrame, pageNode, styleToCss, toHtml, type VNode } from './vnode';

function collectText(node: VNode | string): string {
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(collectText).join('');
}

describe('serialization', () => {
  it('escapes text and attributes (no markup injection)', () => {
    const html = toHtml({ tag: 'div', attrs: { title: '"><script>' }, children: ['<script>alert(1)</script> & co'] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; co');
    expect(html).toContain('title="&quot;&gt;&lt;script&gt;"');
    expect(escapeText('a<b>c')).toBe('a&lt;b&gt;c');
  });

  it('drops event handler attributes and self-closes void elements', () => {
    const html = toHtml({ tag: 'img', attrs: { src: 'data:image/png;base64,AA', onerror: 'alert(1)' } });
    expect(html).toBe('<img src="data:image/png;base64,AA"/>');
  });

  it('writes kebab-case CSS', () => {
    expect(styleToCss({ fontSize: '12px', WebkitPrintColorAdjust: 'exact' })).toBe('font-size:12px;-webkit-print-color-adjust:exact');
  });
});

describe('page rendering', () => {
  it('renders frames in z-order with master items behind', () => {
    let doc = createDoc({ presetId: 'a4', pages: 2 });
    doc = addFrames(doc, MASTER_ID, [createTextFrame({ text: 'Page {page} of {pages}' })]);
    doc = addFrames(doc, doc.pages[1].id, [createShapeFrame({ fill: '#ff0000' }), createTextFrame({ text: 'Hello' })]);
    const node = pageNode({ doc, page: doc.pages[1], pageIndex: 1, withMaster: true });
    expect(node.children).toHaveLength(3);
    expect(collectText(node)).toContain('Page 2 of 2');
    expect(collectText(node)).toContain('Hello');
    const noMaster = pageNode({ doc, page: { ...doc.pages[1], applyMaster: false }, pageIndex: 1, withMaster: true });
    expect(noMaster.children).toHaveLength(2);
  });

  it('renders paragraphs as separate blocks and keeps empty lines', () => {
    const doc = createDoc();
    const f = createTextFrame({ text: 'One\n\nTwo' });
    const node = frameNode(f, { doc, page: doc.pages[0], pageIndex: 0 })!;
    const block = node.children![0] as VNode;
    expect(block.children).toHaveLength(3);
    expect(collectText(block.children![1] as VNode)).toBe('​');
  });

  it('uses flow text for threaded frames', () => {
    const doc = createDoc();
    const f = createTextFrame({ text: 'full story' });
    const node = frameNode(f, { doc, page: doc.pages[0], pageIndex: 0, flows: new Map([[f.id, { text: 'part', overflow: false }]]) })!;
    expect(collectText(node)).toBe('part');
  });

  it('renders images, placeholders, shapes and tables', () => {
    const doc = { ...createDoc(), assets: { a1: { id: 'a1', name: 'x', src: 'data:image/png;base64,AA', width: 200, height: 100 } } };
    const opts = { doc, page: doc.pages[0], pageIndex: 0 };
    const img = toHtml(frameNode(createImageFrame({ assetId: 'a1', w: 100, h: 100 }), opts)!);
    expect(img).toContain('<img');
    expect(img).toContain('width:200px');
    const placeholder = frameNode(createImageFrame({}), { ...opts, editor: true })!;
    expect(placeholder.style?.backgroundColor).toBeTruthy();
    const tri = toHtml(frameNode(createShapeFrame({ shape: 'triangle', gradient: { kind: 'linear', angle: 90, stops: [{ color: '#000', pos: 0 }, { color: '$2', pos: 1 }] } }), opts)!);
    expect(tri).toContain('<polygon');
    expect(tri).toContain('linearGradient');
    const table = toHtml(frameNode(createTableFrame({ rows: 2, cols: 2, cells: [['A', 'B'], ['<c>', 'd']] }), opts)!);
    expect(table).toContain('<td');
    expect(table).toContain('&lt;c&gt;');
    expect(frameNode({ ...createShapeFrame(), hidden: true }, opts)).toBeNull();
  });

  it('mirrors master frames on left pages', () => {
    const doc = { ...createDoc({ pages: 3 }), facing: true };
    expect(isLeftPage(doc, 0)).toBe(false);
    expect(isLeftPage(doc, 1)).toBe(true);
    const f = createTextFrame({ x: 10, w: 100, overrides: { align: 'left' } });
    const m = mirrorFrame(f, 500) as TextFrame;
    expect(m.x).toBe(390);
    expect(m.overrides.align).toBe('right');
  });

  it('adds the bleed offset', () => {
    let doc = createDoc();
    doc = addFrames(doc, doc.pages[0].id, [createShapeFrame({ x: 0, y: 0 })]);
    const node = pageNode({ doc, page: doc.pages[0], pageIndex: 0, bleed: 10 });
    expect((node.children![0] as VNode).style?.left).toBe('10px');
    expect(node.style?.width).toBe(`${Math.round((doc.pages[0].width + 20) * 1000) / 1000}px`);
  });
});

/** Fake measurer: a frame fits `h / 10` lines of `w / 10` characters. */
const fake: Measurer = {
  fits(frame, _style, text) {
    const perLine = Math.max(1, Math.floor(frame.w / 10));
    const lines = text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
    return lines <= Math.floor(frame.h / 10);
  },
};

describe('text flow', () => {
  it('finds the split point on a word boundary', () => {
    const fits = (t: string) => t.length <= 12;
    const text = 'hello world wide web';
    const k = splitPoint(text, fits);
    expect(k).toBe(12);
    expect(splitAt(text, k)).toEqual(['hello world', 'wide web']);
    expect(splitAt('one two\nthree', 7)).toEqual(['one two', 'three']);
    expect(splitPoint('short', fits)).toBe(5);
    expect(splitPoint('abcdefghijklmnopqrstuvwxyz', fits)).toBe(12);
  });

  it('distributes a story across linked frames and flags overflow', () => {
    let doc = createDoc({ pages: 2 });
    const a = createTextFrame({ w: 100, h: 20, text: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj' });
    const b = createTextFrame({ w: 100, h: 20, text: '' });
    const c = createTextFrame({ w: 100, h: 10, text: 'alone and much too long for this' });
    doc = addFrames(doc, doc.pages[0].id, [a, c]);
    doc = addFrames(doc, doc.pages[1].id, [b]);
    doc = linkFrames(doc, a.id, b.id);
    const flows = computeFlows(doc, fake);
    const fa = flows.get(a.id)!;
    const fb = flows.get(b.id)!;
    expect(fa.overflow).toBe(false);
    expect(fa.text.length).toBeGreaterThan(0);
    expect(`${fa.text} ${fb.text}`).toBe(a.text);
    expect(fb.overflow).toBe(true);
    expect(flows.get(c.id)!.overflow).toBe(true);
  });

  it('substitutes page tokens in stories', () => {
    let doc = createDoc({ pages: 3 });
    const a = createTextFrame({ w: 400, h: 400, text: 'Page {page}/{pages}' });
    doc = addFrames(doc, doc.pages[2].id, [a]);
    expect(computeFlows(doc, fake).get(a.id)!.text).toBe('Page 3/3');
  });
});
