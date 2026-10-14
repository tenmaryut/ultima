import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildPdf, blankPdf, type ExportContext } from './exporter';
import { detectFields, coerceFieldValue } from './forms';
import { makeTextAnnot } from './annots';
import type { Annot, DocState, PageInfo } from './types';
import { EMPTY_META } from './types';

// 1×1 red PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function makeSource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([300 + i * 10, 400]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 360, size: 20, font });
  }
  const form = doc.getForm();
  const name = form.createTextField('person.name');
  name.addToPage(doc.getPage(0), { x: 20, y: 300, width: 200, height: 20 });
  const agree = form.createCheckBox('agree');
  agree.addToPage(doc.getPage(0), { x: 20, y: 260, width: 14, height: 14 });
  const color = form.createRadioGroup('color');
  color.addOptionToPage('red', doc.getPage(1), { x: 20, y: 200, width: 14, height: 14 });
  color.addOptionToPage('blue', doc.getPage(1), { x: 60, y: 200, width: 14, height: 14 });
  const city = form.createDropdown('city');
  city.addOptions(['Jakarta', 'Bandung']);
  city.addToPage(doc.getPage(1), { x: 20, y: 150, width: 120, height: 20 });
  return doc.save();
}

function infos(sizes: [number, number][]): PageInfo[] {
  return sizes.map(([w, h]) => ({ view: [0, 0, w, h], rotate: 0, userUnit: 1 }));
}

describe('form detection', () => {
  it('finds fields, widgets and values', async () => {
    const doc = await PDFDocument.load(await makeSource());
    const { defs, values } = detectFields(doc);
    const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
    expect(Object.keys(byName).sort()).toEqual(['agree', 'city', 'color', 'person.name']);
    expect(byName['person.name'].type).toBe('text');
    expect(byName['person.name'].widgets[0]).toMatchObject({ srcIndex: 0, rect: { x: 19.5, y: 299.5, w: 201, h: 21 } });
    expect(byName.color.type).toBe('radio');
    expect(byName.color.options).toEqual(['red', 'blue']);
    expect(byName.color.widgets.map((w) => [w.srcIndex, w.option])).toEqual([
      [1, 'red'],
      [1, 'blue'],
    ]);
    expect(byName.city.options).toEqual(['Jakarta', 'Bandung']);
    expect(values.agree).toBe(false);
    expect(coerceFieldValue(byName.agree, 'yes')).toBe(true);
    expect(coerceFieldValue(byName.city, 'bandung')).toBe('Bandung');
    expect(coerceFieldValue(byName.city, 'Paris')).toBeNull();
  });
});

describe('buildPdf', () => {
  it('reorders, rotates, duplicates, merges sources and flattens objects', async () => {
    const main = await makeSource();
    const other = await blankPdf(500, 500, 2);
    const sources: Record<string, { bytes: Uint8Array; pages: PageInfo[] }> = {
      main: { bytes: main, pages: infos([[300, 400], [310, 400], [320, 400]]) },
      other: { bytes: other, pages: infos([[500, 500], [500, 500]]) },
    };
    const ctx: ExportContext = {
      mainSrc: 'main',
      source: (id) => (sources[id] ? { bytes: async () => sources[id].bytes, pages: sources[id].pages } : undefined),
      initialFields: { 'person.name': '', agree: false, color: '', city: '' },
    };
    const annots: Annot[] = [
      makeTextAnnot('p3', { x: 20, y: 380 }, 0, { text: 'Hello ✓ world', font: 'times', bold: true, italic: false, size: 14, color: '#ff0000' }),
      { id: 'i', page: 'p3', type: 'ink', strokes: [[10, 10, 20, 30, 40, 20]], color: '#0000ff', width: 2, opacity: 0.8 },
      { id: 'h', page: 'p1', type: 'highlight', rects: [{ x: 10, y: 10, w: 50, h: 12 }], color: '#ffff00', opacity: 0.4 },
      { id: 'u', page: 'p1', type: 'underline', rects: [{ x: 10, y: 30, w: 50, h: 12 }], color: '#00aa00', opacity: 1 },
      { id: 'r', page: 'p1', type: 'rect', rect: { x: 5, y: 5, w: 40, h: 40 }, stroke: '#000000', fill: '#cccccc', width: 1, opacity: 0.5 },
      { id: 'e', page: 'p1', type: 'ellipse', rect: { x: 5, y: 5, w: 40, h: 20 }, stroke: '#000000', fill: null, width: 1, opacity: 1 },
      { id: 'a', page: 'p1', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100, color: '#000000', width: 2, opacity: 1 },
      { id: 'img', page: 'p1', type: 'image', rect: { x: 100, y: 100, w: 20, h: 20 }, rot: 90, src: PNG, kind: 'signature', opacity: 1 },
      { id: 's', page: 'p2', type: 'stamp', rect: { x: 50, y: 50, w: 120, h: 34 }, rot: 0, label: 'APPROVED', color: '#15803d' },
      { id: 'w', page: 'p2', type: 'whiteout', rect: { x: 0, y: 0, w: 30, h: 30 }, color: '#ffffff' },
      { id: 'n', page: 'p2', type: 'note', rect: { x: 200, y: 300, w: 20, h: 20 }, rot: 0, text: 'Check this', color: '#facc15', author: 'Tester', createdAt: 0 },
      { id: 'x', page: 'p2', type: 'redact', rect: { x: 0, y: 0, w: 10, h: 10 } },
    ];
    const state: DocState = {
      pages: [
        { id: 'p1', src: 'main', index: 2, rotate: 90 },
        { id: 'p2', src: 'main', index: 0, rotate: 0 },
        { id: 'p3', src: 'other', index: 1, rotate: 0 },
        { id: 'p4', src: 'main', index: 0, rotate: 180 },
      ],
      annots,
      fields: { 'person.name': 'Budi Santoso', agree: true, color: 'blue', city: 'Bandung' },
      meta: { ...EMPTY_META, title: 'Exported', author: 'Ultima Test', keywords: 'a, b' },
    };
    const bytes = await buildPdf(state, ctx);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(4);
    expect(out.getPages().map((p) => [p.getWidth(), p.getRotation().angle])).toEqual([
      [320, 90],
      [300, 0],
      [500, 0],
      [300, 180],
    ]);
    expect(out.getTitle()).toBe('Exported');
    expect(out.getAuthor()).toBe('Ultima Test');
    // page 1 of the source was deleted -> the radio group and dropdown on it are gone
    const { values, defs } = detectFields(out);
    expect(defs.map((d) => d.name).sort()).toEqual(['agree', 'person.name']);
    expect(values['person.name']).toBe('Budi Santoso');
    expect(values.agree).toBe(true);
    // the sticky note became a real comment
    const annotsOnP2 = out.getPage(1).node.Annots();
    const subtypes = annotsOnP2?.asArray().map((ref) => out.context.lookup(ref)?.toString() ?? '') ?? [];
    expect(subtypes.some((s) => s.includes('/Subtype /Text') && s.includes('/Name /Comment'))).toBe(true);
  });

  it('flattens forms and exports subsets without the main source', async () => {
    const main = await makeSource();
    const ctx: ExportContext = {
      mainSrc: 'main',
      source: () => ({ bytes: async () => main, pages: infos([[300, 400], [310, 400], [320, 400]]) }),
      initialFields: {},
    };
    const state: DocState = {
      pages: [
        { id: 'a', src: 'main', index: 0, rotate: 0 },
        { id: 'b', src: 'main', index: 1, rotate: 0 },
      ],
      annots: [],
      fields: { 'person.name': 'X' },
      meta: EMPTY_META,
    };
    const flat = await PDFDocument.load(await buildPdf(state, ctx, { flattenForms: true }));
    expect(detectFields(flat).defs).toHaveLength(0);
    const subset = await PDFDocument.load(await buildPdf(state, ctx, { pageIds: ['b'] }));
    expect(subset.getPageCount()).toBe(1);
    expect(subset.getPage(0).getWidth()).toBe(310);
  });

  it('builds documents made only of other sources', async () => {
    const blank = await blankPdf(200, 100);
    const ctx: ExportContext = { mainSrc: null, source: () => ({ bytes: async () => blank, pages: infos([[200, 100]]) }), initialFields: {} };
    const out = await PDFDocument.load(
      await buildPdf({ pages: [{ id: 'x', src: 'b', index: 0, rotate: 270 }], annots: [], fields: {}, meta: EMPTY_META }, ctx),
    );
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getRotation().angle).toBe(270);
  });
});
