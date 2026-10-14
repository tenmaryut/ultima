import { resolveTextStyle, substituteTokens } from './styles';
import type { LayoutDoc, TextFrame, TextStyle } from './types';
import type { Flow } from './vnode';

/**
 * Text threading: a story (the text of the head frame) flows through linked frames.
 * Fitting is decided by a Measurer (DOM based in the app, a fake one in tests).
 */
export interface Measurer {
  fits(frame: TextFrame, style: TextStyle, text: string): boolean;
}

/** Largest prefix length of `text` that fits, preferring a word boundary. */
export function splitPoint(text: string, fits: (prefix: string) => boolean): number {
  if (fits(text)) return text.length;
  let lo = 0;
  let hi = text.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(text.slice(0, mid))) lo = mid;
    else hi = mid;
  }
  let k = lo;
  const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\n' || ch === '\t';
  if (k > 0 && k < text.length && !isSpace(text[k]) && !isSpace(text[k - 1])) {
    let ws = k - 1;
    while (ws > 0 && !isSpace(text[ws])) ws--;
    if (ws > 0) k = ws;
  }
  return k;
}

/** Removes the separator at a split: trailing spaces of the first part, leading spaces + one newline of the rest. */
export function splitAt(text: string, k: number): [string, string] {
  const head = text.slice(0, k).replace(/[ \t]+$/, '').replace(/\n$/, '');
  const tail = text.slice(k).replace(/^[ \t]*\n?/, '');
  return [head, tail];
}

function layoutKey(f: TextFrame, style: TextStyle): string {
  return [
    f.w.toFixed(2),
    f.h.toFixed(2),
    f.padding,
    f.stroke ? f.strokeWidth : 0,
    f.columns,
    f.columnGap,
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    style.italic ? 1 : 0,
    style.uppercase ? 1 : 0,
    style.lineHeight,
    style.letterSpacing,
    style.spaceAfter,
  ].join('|');
}

export interface FlowCache {
  stories: Map<string, Flow[]>;
}

export function createFlowCache(): FlowCache {
  return { stories: new Map() };
}

/**
 * Computes the text shown by every text frame of the pages (not master items).
 * Returns frame id → { text, overflow }.
 */
export function computeFlows(doc: LayoutDoc, measurer: Measurer, cache?: FlowCache): Map<string, Flow> {
  const out = new Map<string, Flow>();
  const frames = new Map<string, { frame: TextFrame; pageIndex: number }>();
  doc.pages.forEach((p, pageIndex) => {
    for (const f of p.frames) if (f.type === 'text') frames.set(f.id, { frame: f, pageIndex });
  });
  const hasPred = new Set<string>();
  for (const { frame } of frames.values()) if (frame.nextId && frames.has(frame.nextId)) hasPred.add(frame.nextId);
  const total = String(doc.pages.length);
  const usedKeys = new Set<string>();

  for (const { frame: head, pageIndex } of frames.values()) {
    if (hasPred.has(head.id)) continue;
    const chain: TextFrame[] = [];
    const seen = new Set<string>();
    let cur: TextFrame | undefined = head;
    while (cur && !seen.has(cur.id)) {
      chain.push(cur);
      seen.add(cur.id);
      cur = cur.nextId ? frames.get(cur.nextId)?.frame : undefined;
    }
    const story = substituteTokens(head.text, String(pageIndex + 1), total);
    const styles = chain.map((f) => resolveTextStyle(f, doc.styles));
    const key = `${chain.map((f, i) => `${f.id}:${layoutKey(f, styles[i])}`).join('>')}#${story}`;
    usedKeys.add(key);
    let flows = cache?.stories.get(key);
    if (!flows) {
      flows = [];
      let remaining = story;
      for (let i = 0; i < chain.length; i++) {
        const f = chain[i];
        const style = styles[i];
        if (i === chain.length - 1) {
          flows.push({ text: remaining, overflow: remaining.length > 0 && !measurer.fits(f, style, remaining) });
          break;
        }
        const k = splitPoint(remaining, (t) => measurer.fits(f, style, t));
        const [part, rest] = splitAt(remaining, k);
        flows.push({ text: part, overflow: false });
        remaining = rest;
      }
      cache?.stories.set(key, flows);
    }
    chain.forEach((f, i) => out.set(f.id, flows[i]));
  }
  // frames in broken chains (should not happen after normalization)
  for (const { frame } of frames.values()) if (!out.has(frame.id)) out.set(frame.id, { text: '', overflow: false });
  if (cache && cache.stories.size > 400) {
    for (const k of [...cache.stories.keys()]) if (!usedKeys.has(k)) cache.stories.delete(k);
  }
  return out;
}

/** Overflow of master text frames (shown when editing the master page). */
export function masterOverflow(doc: LayoutDoc, measurer: Measurer): Map<string, Flow> {
  const out = new Map<string, Flow>();
  for (const f of doc.master.frames) {
    if (f.type !== 'text') continue;
    const text = substituteTokens(f.text, '#', String(doc.pages.length));
    out.set(f.id, { text, overflow: text.length > 0 && !measurer.fits(f, resolveTextStyle(f, doc.styles), text) });
  }
  return out;
}
