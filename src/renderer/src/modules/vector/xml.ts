/** Minimal, forgiving XML parser for SVG documents (no DTD support, no external entities). */

export interface XElement {
  type: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
}

export interface XText {
  type: 'text';
  text: string;
}

export type XNode = XElement | XText;

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

const NAME_RE = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;

/** Parses XML text; returns the root element or throws when there is none. */
export function parseXml(src: string): XElement {
  const root: XElement = { type: 'element', name: '#document', attrs: {}, children: [] };
  const stack: XElement[] = [root];
  let i = 0;
  const n = src.length;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const text = src.slice(i);
      if (text.trim()) top().children.push({ type: 'text', text: decodeEntities(text) });
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (stack.length > 1) top().children.push({ type: 'text', text: decodeEntities(text) });
    }
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      const text = src.slice(i + 9, end < 0 ? n : end);
      top().children.push({ type: 'text', text });
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (src.startsWith('<!', i)) {
      // DOCTYPE (possibly with an internal subset)
      const bracket = src.indexOf('[', i);
      const gt = src.indexOf('>', i);
      if (bracket >= 0 && gt >= 0 && bracket < gt) {
        const end = src.indexOf(']>', bracket);
        i = end < 0 ? n : end + 2;
      } else i = gt < 0 ? n : gt + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      const gt = src.indexOf('>', i);
      const name = src.slice(i + 2, gt < 0 ? n : gt).trim();
      i = gt < 0 ? n : gt + 1;
      // pop to the matching element (tolerates unclosed tags)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    // start tag
    i++;
    NAME_RE.lastIndex = i;
    const nm = NAME_RE.exec(src);
    if (!nm) {
      top().children.push({ type: 'text', text: '<' });
      continue;
    }
    const el: XElement = { type: 'element', name: nm[0], attrs: {}, children: [] };
    i = NAME_RE.lastIndex;
    let selfClosing = false;
    while (i < n) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === '/' && src[i + 1] === '>') {
        selfClosing = true;
        i += 2;
        break;
      }
      if (src[i] === '>') {
        i++;
        break;
      }
      NAME_RE.lastIndex = i;
      const an = NAME_RE.exec(src);
      if (!an) {
        i++;
        continue;
      }
      i = NAME_RE.lastIndex;
      while (i < n && /\s/.test(src[i])) i++;
      let value = '';
      if (src[i] === '=') {
        i++;
        while (i < n && /\s/.test(src[i])) i++;
        const q = src[i];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, i + 1);
          value = src.slice(i + 1, end < 0 ? n : end);
          i = end < 0 ? n : end + 1;
        } else {
          const start = i;
          while (i < n && !/[\s>]/.test(src[i]) && !(src[i] === '/' && src[i + 1] === '>')) i++;
          value = src.slice(start, i);
        }
      }
      el.attrs[an[0]] = decodeEntities(value);
    }
    top().children.push(el);
    if (!selfClosing) stack.push(el);
  }
  const first = root.children.find((c): c is XElement => c.type === 'element');
  if (!first) throw new Error('No XML element found');
  return first;
}

export function serializeXml(node: XNode): string {
  if (node.type === 'text') return escapeText(node.text);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  if (!node.children.length) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serializeXml).join('')}</${node.name}>`;
}

/** Local name without a namespace prefix ("svg:rect" → "rect"). */
export function localName(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

export function textContent(node: XNode): string {
  if (node.type === 'text') return node.text;
  return node.children.map(textContent).join('');
}

export function walkElements(el: XElement, fn: (e: XElement) => void): void {
  fn(el);
  for (const c of el.children) if (c.type === 'element') walkElements(c, fn);
}
