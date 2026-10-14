import { cssProperty, textBlockNode, type Child } from './vnode';
import type { Measurer } from './textflow';
import type { TextFrame, TextStyle } from './types';

/** Builds real DOM nodes from a VNode tree (no HTML parsing involved). */
export function buildDom(node: Child, inSvg = false): Node {
  if (typeof node === 'string') return document.createTextNode(node);
  const svg = inSvg || node.tag === 'svg';
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', node.tag) : document.createElement(node.tag);
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (/^on/i.test(k) || k === 'xmlns') continue;
    el.setAttribute(k, v);
  }
  if (node.style) {
    const st = (el as HTMLElement | SVGElement).style;
    for (const [k, v] of Object.entries(node.style)) st.setProperty(cssProperty(k), v);
  }
  for (const c of node.children ?? []) el.appendChild(buildDom(c, svg));
  return el;
}

let host: HTMLDivElement | null = null;

function measureHost(): HTMLDivElement {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    contain: 'layout style',
    width: '0',
    height: '0',
    overflow: 'hidden',
  });
  document.body.appendChild(host);
  return host;
}

/** Characters whose glyphs usually reach below the baseline. */
const DESCENDERS = /[gjpqyJQ,;()[\]{}|_@$çşţ]/;

/**
 * Height the text needs. With a tight line height (e.g. 0.9 for display type) the glyph boxes
 * stick out of the line boxes, and scrollHeight counts that. Only descenders in the last
 * paragraph would really be cut off by the frame, so all-caps titles are measured by their
 * line boxes and everything else keeps the stricter scrollHeight.
 */
function usedHeight(el: HTMLElement, columns: number): number {
  const first = el.firstElementChild;
  const last = el.lastElementChild;
  if (columns > 1 || !first || !last || DESCENDERS.test(last.textContent ?? '')) return el.scrollHeight;
  return last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
}

/** Fit cache: (frame layout + style + text) → fits. Cleared when fonts finish loading. */
const fitCache = new Map<string, boolean>();

export function clearMeasureCache(): void {
  fitCache.clear();
}

/** DOM measurer: lays the text out in a hidden element with the exact export markup. */
export const domMeasurer: Measurer = {
  fits(frame: TextFrame, style: TextStyle, text: string): boolean {
    const key = `${frame.w.toFixed(2)}|${frame.h.toFixed(2)}|${frame.padding}|${frame.stroke ? frame.strokeWidth : 0}|${frame.columns}|${frame.columnGap}|${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.italic}|${style.uppercase}|${style.lineHeight}|${style.letterSpacing}|${style.spaceAfter}|${text}`;
    const cached = fitCache.get(key);
    if (cached !== undefined) return cached;
    const el = buildDom(textBlockNode(frame, style, text, [], true)) as HTMLElement;
    const h = measureHost();
    h.replaceChildren(el);
    const fits = usedHeight(el, frame.columns) <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    if (fitCache.size > 5000) fitCache.clear();
    fitCache.set(key, fits);
    return fits;
  },
};
