import type { XElement } from './xml';
import { localName } from './xml';

/** Presentation properties the importer understands. */
export const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'display',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'letter-spacing',
  'mix-blend-mode',
  'color',
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'stop-color',
  'stop-opacity',
  'line-height',
] as const;

/** Properties that are NOT inherited by children. */
export const NON_INHERITED = new Set(['opacity', 'display', 'mix-blend-mode', 'clip-path', 'mask', 'filter', 'stop-color', 'stop-opacity']);

export type StyleMap = Record<string, string>;

export function parseStyleAttr(style: string | undefined): StyleMap {
  const out: StyleMap = {};
  if (!style) return out;
  for (const part of style.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part
      .slice(i + 1)
      .replace(/!important/i, '')
      .trim();
    if (k && v) out[k] = v;
  }
  return out;
}

interface CssRule {
  selectors: string[];
  decls: StyleMap;
  specificity: number;
  order: number;
}

/** Parses simple CSS (class, id, tag and compound selectors). At-rules are skipped. */
export function parseCss(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  let order = 0;
  while (i < clean.length) {
    const open = clean.indexOf('{', i);
    if (open < 0) break;
    const selectorText = clean.slice(i, open).trim();
    if (selectorText.startsWith('@')) {
      // skip a whole at-rule block (with nested braces)
      let depth = 1;
      let j = open + 1;
      while (j < clean.length && depth) {
        if (clean[j] === '{') depth++;
        else if (clean[j] === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    const close = clean.indexOf('}', open);
    if (close < 0) break;
    const decls = parseStyleAttr(clean.slice(open + 1, close));
    for (const sel of selectorText.split(',')) {
      const s = sel.trim();
      if (!s) continue;
      rules.push({ selectors: [s], decls, specificity: specificity(s), order: order++ });
    }
    i = close + 1;
  }
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

function specificity(sel: string): number {
  const last = sel.split(/\s+|>|\+|~/).filter(Boolean).pop() ?? '';
  const ids = (last.match(/#[\w-]+/g) ?? []).length;
  const classes = (last.match(/\.[\w-]+/g) ?? []).length;
  const tag = /^[a-zA-Z]/.test(last) ? 1 : 0;
  return ids * 100 + classes * 10 + tag;
}

/** Matches the last compound selector against an element (descendant combinators are approximated). */
function matchesSelector(el: XElement, sel: string): boolean {
  const last = sel.split(/\s+|>|\+|~/).filter(Boolean).pop();
  if (!last) return false;
  if (last === '*') return true;
  const m = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+)*)$/.exec(last);
  if (!m) return false;
  if (m[1] && m[1] !== '*' && localName(el.name) !== m[1]) return false;
  const classes = (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
  for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.' && !classes.includes(part.slice(1))) return false;
    if (part[0] === '#' && el.attrs.id !== part.slice(1)) return false;
  }
  return true;
}

/** Element's own declared style: presentation attributes < CSS rules < style attribute. */
export function declaredStyle(el: XElement, rules: CssRule[]): StyleMap {
  const out: StyleMap = {};
  for (const p of STYLE_PROPS) {
    const v = el.attrs[p];
    if (v !== undefined && v !== '') out[p] = v.trim();
  }
  for (const r of rules) if (r.selectors.some((s) => matchesSelector(el, s))) Object.assign(out, r.decls);
  Object.assign(out, parseStyleAttr(el.attrs.style));
  return out;
}

/** Child style = inherited properties of the parent + the child's own declarations. */
export function computeStyle(parent: StyleMap, own: StyleMap): StyleMap {
  const out: StyleMap = {};
  for (const [k, v] of Object.entries(parent)) if (!NON_INHERITED.has(k)) out[k] = v;
  for (const [k, v] of Object.entries(own)) {
    if (v === 'inherit') {
      if (parent[k] !== undefined) out[k] = parent[k];
    } else out[k] = v;
  }
  return out;
}

/** Parses an SVG length; `ref` is used for percentages, `fontSize` for em units. */
export function parseLength(v: string | undefined, ref = 0, fontSize = 16): number | null {
  if (v === undefined) return null;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v);
  if (!m) return null;
  const num = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case '':
    case 'px':
      return num;
    case 'pt':
      return (num * 96) / 72;
    case 'pc':
      return num * 16;
    case 'mm':
      return (num * 96) / 25.4;
    case 'cm':
      return (num * 96) / 2.54;
    case 'in':
      return num * 96;
    case 'em':
      return num * fontSize;
    case 'ex':
      return num * fontSize * 0.5;
    case 'rem':
      return num * 16;
    case '%':
      return (num / 100) * ref;
    default:
      return num;
  }
}

export function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Fraction from "0.5" or "50%". */
export function fraction(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const s = v.trim();
  if (s.endsWith('%')) return parseFloat(s) / 100;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

export function parseNumberList(v: string | undefined): number[] {
  if (!v) return [];
  return (v.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
}

/** "url(#id)" → "id" */
export function urlRef(v: string | undefined): string | null {
  if (!v) return null;
  const m = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(v);
  return m ? m[1] : null;
}

export function hrefOf(el: XElement): string | undefined {
  return el.attrs.href ?? el.attrs['xlink:href'];
}

export function parseFontWeight(v: string | undefined): number {
  if (!v) return 400;
  if (v === 'bold' || v === 'bolder') return 700;
  if (v === 'normal' || v === 'lighter') return 400;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(100, Math.min(900, Math.round(n / 100) * 100)) : 400;
}

/** First font family name from a CSS font-family list. */
export function firstFontFamily(v: string | undefined): string {
  if (!v) return 'Inter';
  const first = v.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  return first || 'Inter';
}
