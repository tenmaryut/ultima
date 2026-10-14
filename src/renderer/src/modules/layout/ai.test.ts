import { describe, expect, it } from 'vitest';
import { applyAIActions, findStyleId, pageSizeFromAI, validatePageSpec } from './ai';
import { cleanAIText, describeDocument, validateCopy } from './aiText';
import { addFrames } from './ops';
import { createDoc, createShapeFrame, createTextFrame } from './model';
import { resolveTextStyle } from './styles';
import type { TextFrame } from './types';

function baseDoc() {
  let doc = createDoc({ presetId: 'instagram-post', pages: 2 });
  const title = createTextFrame({ x: 80, y: 80, w: 900, h: 200, text: 'Hello', styleId: 'title' });
  const box = createShapeFrame({ x: 0, y: 0, w: 100, h: 100 });
  doc = addFrames(doc, doc.pages[0].id, [box, title]);
  return { doc, title, box };
}

describe('AI actions', () => {
  it('adds text, shapes and image frames on the right page', () => {
    const { doc } = baseDoc();
    const r = applyAIActions(
      doc,
      [
        { type: 'addText', x: 10, y: 20, w: 300, h: 80, text: 'Big news', style: 'Heading 1', fontSize: 64, color: '#ff0000', align: 'center' },
        { type: 'addShape', shape: 'circle', x: 1, y: 2, w: 50, h: 50, fill: '$2' },
        { type: 'addImageFrame', page: 2, x: 0, y: 0, w: 200, h: 200, placeholderColor: '#cccccc', radius: 12 },
      ],
      { currentPage: 0 },
    );
    expect(r.applied).toBe(3);
    expect(r.created).toHaveLength(3);
    const t = r.doc.pages[0].frames.find((f) => f.id === r.created[0]) as TextFrame;
    expect(t.styleId).toBe('h1');
    expect(resolveTextStyle(t, r.doc.styles).fontSize).toBe(64);
    expect(t.overrides.align).toBe('center');
    const s = r.doc.pages[0].frames.find((f) => f.id === r.created[1])!;
    expect(s.type === 'shape' && s.shape).toBe('ellipse');
    expect(r.doc.pages[1].frames).toHaveLength(1);
    expect(r.page).toBe(1);
  });

  it('clamps numbers, cleans colors and ignores unknown actions', () => {
    const { doc } = baseDoc();
    const r = applyAIActions(
      doc,
      [
        { type: 'addText', x: 1e9, y: -1e9, w: -5, h: 'abc', text: 'x', color: 'url(javascript:alert(1))', fontSize: 1e9 },
        { type: 'launchMissiles' },
        'garbage',
        { type: 'delete', ids: ['does-not-exist'] },
      ],
      { currentPage: 0 },
    );
    expect(r.applied).toBe(1);
    expect(r.skipped.length).toBe(3);
    const t = r.doc.pages[0].frames.find((f) => f.id === r.created[0]) as TextFrame;
    expect(t.x).toBeLessThanOrEqual(1080 * 2);
    expect(t.y).toBeGreaterThanOrEqual(-1080);
    expect(t.w).toBeGreaterThanOrEqual(1);
    expect(t.overrides.color).toBe('$0');
    expect(t.overrides.fontSize).toBe(1000);
  });

  it('updates, rewrites, reorders and deletes frames', () => {
    const { doc, title, box } = baseDoc();
    const r = applyAIActions(
      doc,
      [
        { type: 'update', id: title.id, props: { x: 5, fontSize: 99, color: '$5', text: 'Updated', style: 'subtitle' } },
        { type: 'rewriteText', id: title.id, text: 'Rewritten' },
        { type: 'reorder', id: box.id, to: 'front' },
        { type: 'update', id: 'missing', props: { x: 1 } },
      ],
      { currentPage: 0 },
    );
    expect(r.applied).toBe(3);
    const t = r.doc.pages[0].frames.find((f) => f.id === title.id) as TextFrame;
    expect(t.x).toBe(5);
    expect(t.text).toBe('Rewritten');
    expect(t.styleId).toBe('subtitle');
    expect(resolveTextStyle(t, r.doc.styles).fontSize).toBe(99);
    expect(r.doc.pages[0].frames[r.doc.pages[0].frames.length - 1].id).toBe(box.id);
    const del = applyAIActions(r.doc, [{ type: 'delete', ids: [box.id] }], { currentPage: 0 });
    expect(del.doc.pages[0].frames.some((f) => f.id === box.id)).toBe(false);
  });

  it('manages pages, sizes, backgrounds, themes and templates', () => {
    const { doc } = baseDoc();
    const r = applyAIActions(
      doc,
      [
        { type: 'addPage', size: 'instagram-story', background: '#000000' },
        { type: 'setPageSize', page: 1, width: 210, height: 297, unit: 'mm' },
        { type: 'setBackground', page: 2, color: '#123456', gradient: { angle: 90, colors: ['$2', '$3'] } },
        { type: 'setTheme', colors: ['#111111', '#fefefe', 'nope'] },
      ],
      { currentPage: 0 },
    );
    expect(r.doc.pages).toHaveLength(3);
    expect(r.doc.pages[2].height).toBe(1920);
    expect(r.doc.pages[2].background).toBe('#000000');
    expect(r.doc.pages[0].width).toBeCloseTo(793.7, 1);
    expect(r.doc.pages[1].background).toBe('#123456');
    expect(r.doc.pages[1].gradient?.stops).toHaveLength(2);
    expect(r.doc.swatches[0]).toBe('#111111');
    expect(r.doc.swatches[2]).toBe(doc.swatches[2]);
    const t = applyAIActions(doc, [{ type: 'applyTemplate', name: 'Certificate' }], { currentPage: 0 });
    expect(t.applied).toBe(1);
    expect(t.doc.pages[0].width).toBeGreaterThan(t.doc.pages[0].height);
    expect(applyAIActions(doc, [{ type: 'applyTemplate', name: 'nope' }], { currentPage: 0 }).applied).toBe(0);
  });

  it('updates paragraph styles', () => {
    const { doc, title } = baseDoc();
    const r = applyAIActions(doc, [{ type: 'updateStyle', style: 'title', props: { fontSize: 140, fontFamily: 'Georgia' } }], { currentPage: 0 });
    const t = r.doc.pages[0].frames.find((f) => f.id === title.id) as TextFrame;
    const st = resolveTextStyle(t, r.doc.styles);
    expect(st.fontSize).toBe(140);
    expect(st.fontFamily.startsWith('Georgia')).toBe(true);
  });

  it('resolves style names and page sizes', () => {
    const { doc } = baseDoc();
    expect(findStyleId(doc.styles, 'Heading 2')).toBe('h2');
    expect(findStyleId(doc.styles, 'BODY')).toBe('body');
    expect(findStyleId(doc.styles, 'unknown')).toBeNull();
    expect(pageSizeFromAI({ preset: 'A4', orientation: 'landscape' }, { width: 1, height: 1 })!.width).toBeCloseTo(1122.5, 1);
    expect(pageSizeFromAI({ width: 2, height: 3, unit: 'in' }, { width: 1, height: 1 })).toEqual({ width: 192, height: 288, preset: 'custom' });
    expect(pageSizeFromAI({}, { width: 1, height: 1 })).toBeNull();
  });
});

describe('design-from-brief spec validator', () => {
  const styles = createDoc().styles;

  it('builds a page from a valid spec', () => {
    const spec = validatePageSpec(
      {
        size: 'instagram-post',
        theme: ['#1a1a1a', '#fff8f0', '#c2410c', '#78350f', '#a8a29e', '#fde68a'],
        background: '$1',
        backgroundGradient: { angle: 180, colors: ['$1', '$5'] },
        frames: [
          { type: 'shape', shape: 'rect', x: 0, y: 0, w: 1080, h: 300, fill: '$2' },
          { type: 'image', x: 100, y: 320, w: 880, h: 400, placeholderColor: '$4' },
          { type: 'text', x: 80, y: 760, w: 920, h: 140, text: 'Grand opening', style: 'title', fontSize: 110, fontFamily: 'Montserrat', color: '$0' },
          { type: 'text', x: 80, y: 900, w: 920, h: 60, text: '' },
          { type: 'video', x: 0 },
        ],
      },
      { width: 800, height: 600, preset: 'custom' },
      styles,
    );
    expect(spec.width).toBe(1080);
    expect(spec.preset).toBe('instagram-post');
    expect(spec.frames).toHaveLength(3);
    expect(spec.swatches?.[2]).toBe('#c2410c');
    expect(spec.gradient?.stops).toHaveLength(2);
    expect(spec.warnings.length).toBe(2);
    const text = spec.frames[2] as TextFrame;
    expect(text.overrides.fontFamily).toContain('Montserrat');
    expect(text.overrides.fontFamily).toContain('sans-serif');
  });

  it('survives garbage', () => {
    const spec = validatePageSpec('nonsense', { width: 800, height: 600, preset: 'custom' }, styles);
    expect(spec.width).toBe(800);
    expect(spec.frames).toEqual([]);
    expect(spec.warnings).toContain('no elements');
    const spec2 = validatePageSpec({ size: { width: 1e9, height: -1 }, frames: [{ type: 'text', text: 'x', x: 'NaN' }] }, { width: 800, height: 600, preset: 'custom' }, styles);
    expect(spec2.width).toBeLessThanOrEqual(50_000);
    expect(spec2.height).toBeGreaterThanOrEqual(10);
    expect(Number.isFinite(spec2.frames[0].x)).toBe(true);
  });
});

describe('AI text helpers', () => {
  it('describes the document with ids, sizes and selection', () => {
    const { doc, title } = baseDoc();
    const text = describeDocument(doc, 0, [title.id]);
    expect(text).toContain(title.id);
    expect(text).toContain('1080x1080px');
    expect(text).toContain('Selected frame ids');
    expect(text).toContain('(CURRENT)');
  });

  it('cleans plain text answers', () => {
    expect(cleanAIText('```\nhello\n```')).toBe('hello');
    expect(cleanAIText('"quoted"')).toBe('quoted');
    expect(cleanAIText('  plain ')).toBe('plain');
  });

  it('validates generated copy', () => {
    expect(validateCopy({ headline: 'Hi', body: 'Text', cta: 'Go', extra: 1 })).toEqual({ headline: 'Hi', subheadline: '', body: 'Text', cta: 'Go' });
    expect(validateCopy({})).toBeNull();
    expect(validateCopy('x')).toBeNull();
  });
});

describe('spec post-processing', () => {
  it('resolves theme references to literal colors', async () => {
    const { resolveThemeRefs } = await import('./ai');
    const frames = resolveThemeRefs(
      [createShapeFrame({ fill: '$2', stroke: '#000000', gradient: { kind: 'linear', angle: 0, stops: [{ color: '$0', pos: 0 }, { color: '$1', pos: 1 }] } }), createTextFrame({ overrides: { color: '$1' } })],
      ['#000000', '#ffffff', '#ff0000'],
    );
    const s = frames[0];
    expect(s.type === 'shape' && s.fill).toBe('#ff0000');
    expect(s.type === 'shape' && s.gradient?.stops[1].color).toBe('#ffffff');
    expect(frames[1].type === 'text' && frames[1].overrides.color).toBe('#ffffff');
  });

  it('stacks generated copy inside the margins', async () => {
    const { copyToFrames } = await import('./ai');
    const doc = createDoc({ presetId: 'a4' });
    const frames = copyToFrames({ headline: 'Big news', subheadline: 'Sub', body: 'Line one\nLine two', cta: 'Call now' }, doc.pages[0], doc.styles);
    expect(frames).toHaveLength(4);
    for (let i = 1; i < frames.length; i++) expect(frames[i].y).toBeGreaterThan(frames[i - 1].y + frames[i - 1].h - 0.01);
    expect(frames.every((f) => f.x >= doc.pages[0].margins.left - 0.01)).toBe(true);
    expect(copyToFrames({ headline: '', subheadline: '', body: 'x', cta: '' }, doc.pages[0], doc.styles)).toHaveLength(1);
  });
});
