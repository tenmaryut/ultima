import { describe, expect, it } from 'vitest';
import { collectColors, normalizeColor, paletteMapping, recolorWithMapping } from './colors';
import { boundsUnder } from './geometry';
import { createDocument, createRect, createText, defaultStroke, solid, type VObject } from './model';
import { exportArtboardSvg, exportObjectsSvg } from './svgexport';
import { importSvg } from './svgimport';
import { parseXml } from './xml';

const flat = (objects: VObject[]): VObject[] => objects.flatMap((o) => (o.type === 'group' ? [o, ...flat(o.children)] : [o]));

describe('xml', () => {
  it('parses attributes, entities, CDATA and comments', () => {
    const el = parseXml('<?xml version="1.0"?><!-- c --><svg a="1" b=\'x &amp; y\'><text>A &lt; B</text><style><![CDATA[.a{fill:red}]]></style></svg>');
    expect(el.name).toBe('svg');
    expect(el.attrs.b).toBe('x & y');
    const text = el.children[0];
    expect(text.type === 'element' && text.children[0].type === 'text' && text.children[0].text).toBe('A < B');
  });
});

describe('importSvg', () => {
  it('imports basic shapes with styles and transforms', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 400 200">
      <rect x="10" y="20" width="100" height="50" rx="5" fill="#ff0000" stroke="blue" stroke-width="4"/>
      <circle cx="200" cy="100" r="50" style="fill: rgb(0, 128, 0); opacity: .5"/>
      <g transform="translate(300 0)"><line x1="0" y1="0" x2="50" y2="50" stroke="black"/></g>
      <polygon points="0,0 10,0 5,10" fill="none" stroke="#000"/>
    </svg>`;
    const r = importSvg(svg);
    expect(r.width).toBe(200);
    expect(r.height).toBe(100);
    const [rect, circle, group, poly] = r.objects;
    expect(rect.type).toBe('rect');
    expect(rect.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(rect.stroke.paint).toEqual({ type: 'solid', color: '#0000ff' });
    // the viewBox scale (0.5) is baked into geometry and stroke widths
    expect(rect.stroke.width).toBe(2);
    expect(rect.type === 'rect' && rect.width).toBe(50);
    expect(rect.type === 'rect' && rect.radius).toBe(2.5);
    const rb = boundsUnder(rect, rect.m);
    expect(rb).toMatchObject({ x: 5, y: 10, width: 50, height: 25 });
    expect(circle.type).toBe('ellipse');
    expect(circle.opacity).toBe(0.5);
    expect(circle.fill).toEqual({ type: 'solid', color: '#008000' });
    expect(group.type).toBe('group');
    expect(poly.type).toBe('path');
    expect(poly.fill.type).toBe('none');
  });

  it('applies CSS classes from <style>', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.cls-1{fill:#123456;stroke:#fff}</style>
      <path class="cls-1" d="M0 0H10V10Z"/></svg>`;
    const [p] = importSvg(svg).objects;
    expect(p.fill).toEqual({ type: 'solid', color: '#123456' });
    expect(p.stroke.paint).toEqual({ type: 'solid', color: '#ffffff' });
  });

  it('converts gradients (with href inheritance and user space units)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="base"><stop offset="0" stop-color="#000"/><stop offset="100%" stop-color="#fff" stop-opacity=".5"/></linearGradient>
        <linearGradient id="g" xlink:href="#base" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="60" y2="0"/>
        <radialGradient id="r"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient>
      </defs>
      <rect x="10" y="10" width="50" height="20" fill="url(#g)"/>
      <ellipse cx="50" cy="50" rx="20" ry="10" fill="url(#r)"/>
    </svg>`;
    const [rect, ell] = importSvg(svg).objects;
    expect(rect.fill.type).toBe('linear');
    if (rect.fill.type === 'linear') {
      expect(rect.fill.x1).toBeCloseTo(0, 6);
      expect(rect.fill.x2).toBeCloseTo(1, 6);
      expect(rect.fill.stops[1].color).toBe('rgba(255, 255, 255, 0.5)');
    }
    expect(ell.fill).toMatchObject({ type: 'radial', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 });
  });

  it('imports multi-line text', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">
      <text x="10" y="30" font-family="Georgia, serif" font-size="20" font-weight="bold" text-anchor="middle" fill="#333">
        <tspan x="10" y="30">Hello</tspan><tspan x="10" y="54">World</tspan>
      </text></svg>`;
    const [t] = importSvg(svg).objects;
    expect(t.type).toBe('text');
    if (t.type === 'text') {
      expect(t.text).toBe('Hello\nWorld');
      expect(t.fontFamily).toBe('Georgia');
      expect(t.fontWeight).toBe(700);
      expect(t.align).toBe('center');
      expect(t.lineHeight).toBeCloseTo(1.2, 6);
      expect(t.m[4]).toBe(10);
      expect(t.m[5]).toBe(30);
    }
  });

  it('resolves <use> and embeds unsupported content as raw SVG', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><clipPath id="c"><circle cx="50" cy="50" r="20"/></clipPath><rect id="sq" width="10" height="10" fill="#0f0"/></defs>
      <use href="#sq" x="5" y="5"/>
      <rect width="100" height="100" fill="#00f" clip-path="url(#c)"/>
    </svg>`;
    const r = importSvg(svg);
    const [used, raw] = r.objects;
    expect(used.type).toBe('rect');
    expect(used.m[4]).toBe(5);
    expect(raw.type).toBe('raw');
    expect(r.rawCount).toBe(1);
    if (raw.type === 'raw') expect(raw.content).toContain('clipPath');
  });

  it('honours display:none and the root preserveAspectRatio', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="red"/><rect width="5" height="5" style="display:none"/></svg>`;
    const r = importSvg(svg);
    expect(r.objects).toHaveLength(1);
    const b = boundsUnder(r.objects[0], r.objects[0].m);
    expect(b).toMatchObject({ x: 50, y: 0, width: 100, height: 100 });
  });
});

describe('export', () => {
  it('round-trips a document through SVG', () => {
    const doc = createDocument(400, 300, '#ffffff');
    const rect = createRect(20, 30, 100, 50, { fill: { type: 'linear', stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: 'rgba(0, 0, 255, 0.5)' }], x1: 0, y1: 0, x2: 1, y2: 0 }, stroke: defaultStroke(solid('#000'), 2) }, 8);
    const text = createText(200, 100, 'Hi there', { fontSize: 24, align: 'center' }, solid('#222222'));
    doc.objects = [rect, text];
    const svg = exportArtboardSvg(doc, doc.artboards[0]);
    expect(svg).toContain('<linearGradient id="g1"');
    expect(svg).toContain('viewBox="0 0 400 300"');
    expect(svg).not.toMatch(/id="e[a-z0-9]{6,}/); // ids shortened
    const back = importSvg(svg);
    const items = flat(back.objects).filter((o) => o.type !== 'group');
    const r2 = items.filter((o) => o.type === 'rect')[1];
    const t2 = items.find((o) => o.type === 'text');
    expect(r2 && boundsUnder(r2, r2.m)).toMatchObject({ x: 20, y: 30, width: 100, height: 50 });
    expect(r2?.type === 'rect' && r2.radius).toBe(8);
    expect(r2?.fill.type).toBe('linear');
    expect(t2?.type === 'text' && t2.text).toBe('Hi there');
    expect(t2?.type === 'text' && t2.align).toBe('center');
    // background rect comes first
    expect(items[0].type).toBe('rect');
  });

  it('exports a selection cropped to its bounds', () => {
    const svg = exportObjectsSvg([createRect(50, 50, 10, 20, { fill: solid('#000'), stroke: defaultStroke() })]);
    expect(svg).toContain('viewBox="50 50 10 20"');
  });
});

describe('colors', () => {
  it('normalizes named and functional colors', () => {
    expect(normalizeColor('RebeccaPurple')).toBe('#663399');
    expect(normalizeColor('rgb(255 0 0 / 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
    expect(normalizeColor('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
    expect(normalizeColor('nope')).toBeNull();
  });

  it('collects and remaps document colors', () => {
    const a = createRect(0, 0, 1, 1, { fill: solid('#ff0000'), stroke: defaultStroke(solid('#000000'), 1) });
    const b = createRect(0, 0, 1, 1, { fill: solid('rgba(255, 0, 0, 0.5)'), stroke: defaultStroke() });
    expect(collectColors([a, b])).toEqual(['#ff0000', '#000000']);
    const { objects, changed } = recolorWithMapping([a, b], { '#FF0000': '#00ff00' });
    expect(changed).toBe(2);
    expect(objects[1].fill).toEqual({ type: 'solid', color: 'rgba(0, 255, 0, 0.5)' });
    const mapping = paletteMapping(['#000000', '#ffffff'], ['#222222', '#eeeeee', '#888888']);
    expect(mapping).toEqual({ '#000000': '#222222', '#ffffff': '#eeeeee' });
  });
});
