import { describe, expect, it } from 'vitest';
import {
  colorKeys,
  importPalette,
  parseColorsFromText,
  parseGpl,
  parsePaletteJson,
  readAse,
  slugify,
  toCssVariables,
  toGpl,
  toJson,
  toScss,
  toTailwind,
  writeAse,
  type PaletteData,
} from './io';

const palette: PaletteData = {
  name: 'Sunset Über',
  colors: [
    { hex: '#2b1b3d', name: 'Night Plum' },
    { hex: '#7a2e5c', name: 'Dusk Berry' },
    { hex: '#d9485f' },
    { hex: '#f28c4b', name: 'Tangerine' },
    { hex: '#ffd27f', name: 'Golden Hour ☀' },
  ],
};

describe('names', () => {
  it('slugifies to valid identifiers', () => {
    expect(slugify('Golden Hour ☀')).toBe('golden-hour');
    expect(slugify('Über Blau')).toBe('uber-blau');
    expect(slugify('123')).toBe('color-123');
    expect(slugify('!!!')).toBe('color');
  });
  it('makes unique keys', () => {
    expect(colorKeys({ name: '', colors: [{ hex: '#000000', name: 'Ink' }, { hex: '#111111', name: 'Ink' }, { hex: '#222222' }] })).toEqual([
      'ink',
      'ink-2',
      'color-3',
    ]);
  });
});

describe('Adobe Swatch Exchange', () => {
  it('writes a valid header', () => {
    const bytes = writeAse(palette);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('ASEF');
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(4)).toBe(1);
    expect(view.getUint16(6)).toBe(0);
    expect(view.getUint32(8)).toBe(palette.colors.length + 2); // group start + colors + group end
  });
  it('round-trips colors, names and the palette name', () => {
    const back = readAse(writeAse(palette));
    expect(back.name).toBe(palette.name);
    expect(back.colors.map((c) => c.hex)).toEqual(palette.colors.map((c) => c.hex));
    expect(back.colors.map((c) => c.name)).toEqual(palette.colors.map((c) => c.name));
  });
  it('reads CMYK, LAB and Gray entries', () => {
    const entries: { model: string; values: number[]; name: string }[] = [
      { model: 'CMYK', values: [0, 1, 1, 0], name: 'Red' },
      { model: 'LAB ', values: [1, 0, 0], name: 'White' },
      { model: 'Gray', values: [0], name: 'Black' },
    ];
    const blocks = entries.map((e) => {
      const nameUnits = e.name.length + 1;
      const len = 2 + nameUnits * 2 + 4 + e.values.length * 4 + 2;
      const b = new DataView(new ArrayBuffer(6 + len));
      b.setUint16(0, 1);
      b.setUint32(2, len);
      b.setUint16(6, nameUnits);
      [...e.name].forEach((ch, i) => b.setUint16(8 + i * 2, ch.charCodeAt(0)));
      let o = 8 + nameUnits * 2;
      [...e.model].forEach((ch) => b.setUint8(o++, ch.charCodeAt(0)));
      e.values.forEach((v) => {
        b.setFloat32(o, v);
        o += 4;
      });
      b.setUint16(o, 2);
      return new Uint8Array(b.buffer);
    });
    const total = 12 + blocks.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(total);
    out.set([0x41, 0x53, 0x45, 0x46]);
    const v = new DataView(out.buffer);
    v.setUint16(4, 1);
    v.setUint32(8, blocks.length);
    let o = 12;
    for (const b of blocks) {
      out.set(b, o);
      o += b.length;
    }
    const p = readAse(out);
    expect(p.colors.map((c) => c.hex)).toEqual(['#ff0000', '#ffffff', '#000000']);
    expect(p.colors.map((c) => c.name)).toEqual(['Red', 'White', 'Black']);
  });
  it('rejects other files', () => {
    expect(() => readAse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow();
  });
});

describe('GIMP palette', () => {
  it('round-trips', () => {
    const text = toGpl(palette);
    expect(text.startsWith('GIMP Palette\nName: Sunset Über\n')).toBe(true);
    const back = parseGpl(text);
    expect(back.name).toBe('Sunset Über');
    expect(back.colors.map((c) => c.hex)).toEqual(palette.colors.map((c) => c.hex));
    expect(back.colors[0].name).toBe('Night Plum');
    expect(back.colors[2].name).toBe('Color 3');
  });
  it('rejects non palettes', () => {
    expect(() => parseGpl('hello')).toThrow();
  });
});

describe('text formats', () => {
  it('CSS variables', () => {
    const css = toCssVariables(palette);
    expect(css).toContain('--night-plum: #2b1b3d;');
    expect(css).toContain('--color-3: #d9485f;');
    expect(css).toContain('--night-plum-rgb: 43 27 61;');
  });
  it('SCSS', () => {
    const scss = toScss(palette);
    expect(scss).toContain('$tangerine: #f28c4b;');
    expect(scss).toContain("$sunset-uber: (");
  });
  it('Tailwind', () => {
    const tw = toTailwind(palette);
    expect(tw).toContain("'sunset-uber': {");
    expect(tw).toContain("'golden-hour': '#ffd27f',");
    expect(tw).toContain('--color-sunset-uber-night-plum: #2b1b3d;');
  });
  it('JSON round-trip', () => {
    const back = parsePaletteJson(toJson(palette));
    expect(back.colors.map((c) => c.hex)).toEqual(palette.colors.map((c) => c.hex));
    expect(back.name).toBe(palette.name);
  });
  it('JSON variants', () => {
    expect(parsePaletteJson('["#fff", "rgb(0,0,0)", "bogus"]').colors.map((c) => c.hex)).toEqual(['#ffffff', '#000000']);
    expect(parsePaletteJson('{"primary":"#123456","accent":"#abcdef"}').colors).toEqual([
      { hex: '#123456', name: 'primary' },
      { hex: '#abcdef', name: 'accent' },
    ]);
    expect(() => parsePaletteJson('{"a":1}')).toThrow();
  });
  it('finds colors in any text', () => {
    const css = ':root{--a:#FF0000;--b: rgb(0 128 255);} .x{color:#abc} #header{} hsl(120 100% 25%)';
    expect(parseColorsFromText(css)).toEqual(['#ff0000', '#0080ff', '#aabbcc', '#008000']);
  });
  it('imports by file type', () => {
    const enc = new TextEncoder();
    expect(importPalette('x.gpl', enc.encode(toGpl(palette))).colors).toHaveLength(5);
    expect(importPalette('x.ase', writeAse(palette)).name).toBe('Sunset Über');
    expect(importPalette('vars.css', enc.encode(toCssVariables(palette))).colors).toHaveLength(5);
    expect(importPalette('theme.json', enc.encode(toJson(palette))).colors[0].name).toBe('Night Plum');
    expect(() => importPalette('empty.txt', enc.encode('nothing here'))).toThrow();
  });
});
