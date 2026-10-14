/**
 * Palette import/export formats: CSS variables, SCSS, JSON, Tailwind, Adobe Swatch
 * Exchange (.ase, binary — read and write), GIMP palette (.gpl) and loose text.
 * Pure functions — unit tested in io.test.ts.
 */
import { cmykToRgb, hexToRgb, labToRgb, normalizeHex, rgbToHsl, rgbToHsv, toHex } from './colormath';

export interface PaletteColor {
  hex: string;
  name?: string;
}

export interface PaletteData {
  name: string;
  colors: PaletteColor[];
}

/** "Ocean Blue #2" → "ocean-blue-2" (always a valid CSS identifier). */
export function slugify(text: string, fallback = 'color'): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const out = s || fallback;
  return /^[0-9]/.test(out) ? `${fallback}-${out}` : out;
}

/** Unique variable names for each color: its slugified name or "color-N". */
export function colorKeys(p: PaletteData): string[] {
  const used = new Map<string, number>();
  return p.colors.map((c, i) => {
    const base = c.name?.trim() ? slugify(c.name) : `color-${i + 1}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  });
}

export function toCssVariables(p: PaletteData, prefix = ''): string {
  const keys = colorKeys(p);
  const pre = prefix ? `${slugify(prefix)}-` : '';
  const lines = p.colors.map((c, i) => {
    const { r, g, b } = hexToRgb(c.hex);
    return `  --${pre}${keys[i]}: ${c.hex};\n  --${pre}${keys[i]}-rgb: ${r} ${g} ${b};`;
  });
  return `/* ${p.name || 'Palette'} — Ultima Color Studio */\n:root {\n${lines.join('\n')}\n}\n`;
}

export function toScss(p: PaletteData): string {
  const keys = colorKeys(p);
  const vars = p.colors.map((c, i) => `$${keys[i]}: ${c.hex};`).join('\n');
  const map = keys.map((k) => `  '${k}': $${k},`).join('\n');
  return `// ${p.name || 'Palette'} — Ultima Color Studio\n${vars}\n\n$${slugify(p.name || 'palette', 'palette')}: (\n${map}\n);\n`;
}

export function toJson(p: PaletteData): string {
  return JSON.stringify(
    {
      name: p.name,
      colors: p.colors.map((c) => {
        const rgb = hexToRgb(c.hex);
        const hsl = rgbToHsl(rgb);
        const hsv = rgbToHsv(rgb);
        return {
          name: c.name ?? '',
          hex: c.hex,
          rgb: [rgb.r, rgb.g, rgb.b],
          hsl: [Math.round(hsl.h), Math.round(hsl.s * 100), Math.round(hsl.l * 100)],
          hsb: [Math.round(hsv.h), Math.round(hsv.s * 100), Math.round(hsv.v * 100)],
        };
      }),
    },
    null,
    2,
  );
}

/** Tailwind CSS snippet: v3 config object plus the v4 `@theme` equivalent. */
export function toTailwind(p: PaletteData): string {
  const keys = colorKeys(p);
  const group = slugify(p.name || 'palette', 'palette');
  const entries = p.colors.map((c, i) => `          '${keys[i]}': '${c.hex}',`).join('\n');
  const theme = p.colors.map((c, i) => `  --color-${group}-${keys[i]}: ${c.hex};`).join('\n');
  return `// tailwind.config.js (Tailwind CSS v3)
module.exports = {
  theme: {
    extend: {
      colors: {
        '${group}': {
${entries}
        },
      },
    },
  },
};

/* Tailwind CSS v4 — add to your main CSS file */
@theme {
${theme}
}
`;
}

/* --------------------------------- GIMP .gpl --------------------------------- */

export function toGpl(p: PaletteData): string {
  const lines = p.colors.map((c, i) => {
    const { r, g, b } = hexToRgb(c.hex);
    const name = (c.name?.trim() || `Color ${i + 1}`).replace(/[\r\n\t]+/g, ' ');
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${name}`;
  });
  return `GIMP Palette\nName: ${(p.name || 'Palette').replace(/[\r\n]+/g, ' ')}\nColumns: ${Math.min(16, Math.max(1, p.colors.length))}\n#\n${lines.join('\n')}\n`;
}

export function parseGpl(text: string): PaletteData {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!/^GIMP Palette/i.test(lines[0]?.trim() ?? '')) throw new Error('Not a GIMP palette file');
  let name = '';
  const colors: PaletteColor[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const meta = /^Name:\s*(.*)$/i.exec(line);
    if (meta) {
      name = meta[1].trim();
      continue;
    }
    if (/^Columns:/i.test(line)) continue;
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*(.*)$/.exec(line);
    if (!m) continue;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)));
    const label = m[4].trim();
    colors.push({ hex: toHex({ r, g, b }), name: label && !/^untitled$/i.test(label) ? label : undefined });
  }
  return { name, colors };
}

/* ------------------------------ Adobe .ase ------------------------------ */

const ASE_GROUP_START = 0xc001;
const ASE_GROUP_END = 0xc002;
const ASE_COLOR = 0x0001;

function encodeName(name: string): Uint8Array {
  const units = name.length + 1;
  const out = new Uint8Array(2 + units * 2);
  const view = new DataView(out.buffer);
  view.setUint16(0, units);
  for (let i = 0; i < name.length; i++) view.setUint16(2 + i * 2, name.charCodeAt(i));
  view.setUint16(2 + name.length * 2, 0);
  return out;
}

/** Writes an Adobe Swatch Exchange file: one group (the palette name) of RGB process colors. */
export function writeAse(p: PaletteData): Uint8Array {
  const blocks: { type: number; body: Uint8Array }[] = [];
  const groupName = (p.name || 'Palette').slice(0, 200);
  blocks.push({ type: ASE_GROUP_START, body: encodeName(groupName) });
  p.colors.forEach((c, i) => {
    const name = encodeName((c.name?.trim() || toHex(hexToRgb(c.hex)).toUpperCase()).slice(0, 200) || `Color ${i + 1}`);
    const body = new Uint8Array(name.length + 4 + 12 + 2);
    body.set(name, 0);
    const view = new DataView(body.buffer);
    let o = name.length;
    for (const ch of 'RGB ') view.setUint8(o++, ch.charCodeAt(0));
    const { r, g, b } = hexToRgb(c.hex);
    view.setFloat32(o, r / 255);
    view.setFloat32(o + 4, g / 255);
    view.setFloat32(o + 8, b / 255);
    o += 12;
    view.setUint16(o, 2); // normal (process) color
    blocks.push({ type: ASE_COLOR, body });
  });
  blocks.push({ type: ASE_GROUP_END, body: new Uint8Array(0) });
  const size = 12 + blocks.reduce((sum, b) => sum + 6 + b.body.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x41, 0x53, 0x45, 0x46], 0); // "ASEF"
  view.setUint16(4, 1);
  view.setUint16(6, 0);
  view.setUint32(8, blocks.length);
  let o = 12;
  for (const b of blocks) {
    view.setUint16(o, b.type);
    view.setUint32(o + 2, b.body.length);
    out.set(b.body, o + 6);
    o += 6 + b.body.length;
  }
  return out;
}

/** Reads an .ase file (RGB, CMYK, LAB and Gray entries; groups are flattened). */
export function readAse(input: ArrayBuffer | Uint8Array): PaletteData {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'ASEF') {
    throw new Error('Not an Adobe Swatch Exchange file');
  }
  const count = view.getUint32(8);
  let o = 12;
  let paletteName = '';
  const colors: PaletteColor[] = [];
  const readName = (start: number): { name: string; next: number } => {
    const units = view.getUint16(start);
    let name = '';
    for (let i = 0; i < units; i++) {
      const code = view.getUint16(start + 2 + i * 2);
      if (code) name += String.fromCharCode(code);
    }
    return { name, next: start + 2 + units * 2 };
  };
  for (let i = 0; i < count && o + 6 <= bytes.length; i++) {
    const type = view.getUint16(o);
    const length = view.getUint32(o + 2);
    const start = o + 6;
    const end = start + length;
    if (end > bytes.length) throw new Error('The .ase file is truncated');
    if (type === ASE_GROUP_START && length >= 2) {
      const { name } = readName(start);
      if (!paletteName) paletteName = name;
    } else if (type === ASE_COLOR) {
      const { name, next } = readName(start);
      const model = String.fromCharCode(bytes[next], bytes[next + 1], bytes[next + 2], bytes[next + 3]).trim().toUpperCase();
      const f = (k: number) => view.getFloat32(next + 4 + k * 4);
      let hex: string | null = null;
      if (model === 'RGB') hex = toHex({ r: f(0) * 255, g: f(1) * 255, b: f(2) * 255 });
      else if (model === 'CMYK') hex = toHex(cmykToRgb({ c: f(0), m: f(1), y: f(2), k: f(3) }));
      else if (model === 'LAB') {
        const L = f(0);
        hex = toHex(labToRgb({ l: L <= 1.0001 ? L * 100 : L, a: f(1), b: f(2) }));
      } else if (model === 'GRAY') hex = toHex({ r: f(0) * 255, g: f(0) * 255, b: f(0) * 255 });
      if (hex) colors.push({ hex, name: name && name.toUpperCase() !== hex.toUpperCase() ? name : undefined });
    }
    o = end;
  }
  return { name: paletteName, colors };
}

/* ------------------------------ Loose text import ------------------------------ */

/** Finds colors in any text (CSS, SCSS, JS, Tailwind config, plain lists of hex codes). */
export function parseColorsFromText(text: string, max = 64): string[] {
  const found: string[] = [];
  const re = /#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z_-])|\b(?:rgba?|hsla?)\([^)]*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && found.length < max) {
    const hex = normalizeHex(m[0]);
    if (hex) found.push(hex);
  }
  return found;
}

/**
 * Reads a palette from JSON: our own export, an Ultima project, an array of hex strings,
 * `{colors:[...]}` or `{name: hex}` maps.
 */
export function parsePaletteJson(text: string): PaletteData {
  const data = JSON.parse(text) as unknown;
  const fromList = (list: unknown[]): PaletteColor[] =>
    list
      .map((item): PaletteColor | null => {
        if (typeof item === 'string') {
          const hex = normalizeHex(item);
          return hex ? { hex } : null;
        }
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const hex = normalizeHex(o.hex ?? o.color ?? o.value);
          return hex ? { hex, name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : undefined } : null;
        }
        return null;
      })
      .filter((c): c is PaletteColor => Boolean(c));
  if (Array.isArray(data)) return { name: '', colors: fromList(data) };
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const doc = (o.doc && typeof o.doc === 'object' ? (o.doc as Record<string, unknown>) : o) as Record<string, unknown>;
    const list = doc.swatches ?? doc.colors ?? doc.palette;
    const name = typeof doc.name === 'string' ? doc.name : '';
    if (Array.isArray(list)) return { name, colors: fromList(list) };
    const entries = Object.entries(o)
      .map(([k, v]) => ({ hex: normalizeHex(v), name: k }))
      .filter((c): c is { hex: string; name: string } => Boolean(c.hex));
    if (entries.length) return { name: '', colors: entries };
  }
  throw new Error('No colors found in this JSON file');
}

/** Detects the format of an imported file by name/content and parses it. */
export function importPalette(name: string, bytes: Uint8Array): PaletteData {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const baseName = name.replace(/\.[^.]+$/, '');
  if (ext === 'ase' || (bytes.length >= 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'ASEF')) {
    const p = readAse(bytes);
    return { name: p.name || baseName, colors: p.colors };
  }
  const text = new TextDecoder().decode(bytes);
  if (ext === 'gpl' || /^﻿?GIMP Palette/.test(text)) {
    const p = parseGpl(text);
    return { name: p.name || baseName, colors: p.colors };
  }
  if (ext === 'json' || ext === 'ultima') {
    try {
      const p = parsePaletteJson(text);
      if (p.colors.length) return { name: p.name || baseName, colors: p.colors };
    } catch {
      // fall back to loose parsing
    }
  }
  const hexes = parseColorsFromText(text);
  if (!hexes.length) throw new Error('No colors found in this file');
  return { name: baseName, colors: hexes.map((hex) => ({ hex })) };
}
