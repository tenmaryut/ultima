import { MASTER_ID, type LayoutDoc, type Point } from '../types';

/** Where each visible page sits on the canvas ("world" = page px, all pages). */
export interface PageSlot {
  index: number;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldLayout {
  slots: PageSlot[];
  width: number;
  height: number;
}

export type ViewMode = 'single' | 'continuous';

export const PAGE_GAP = 48;
export const SPREAD_GAP = 0;

/** Pages of the spread containing `index` (facing pages: 1 | 2-3 | 4-5 …). */
export function spreadOf(doc: LayoutDoc, index: number): number[] {
  if (!doc.facing) return [index];
  if (index === 0) return [0];
  const start = index % 2 === 1 ? index : index - 1;
  return start + 1 < doc.pages.length ? [start, start + 1] : [start];
}

export function spreads(doc: LayoutDoc): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < doc.pages.length; ) {
    const s = spreadOf(doc, i);
    out.push(s);
    i = s[s.length - 1] + 1;
  }
  return out;
}

export function computeWorld(doc: LayoutDoc, mode: ViewMode, currentIndex: number, pageId: string): WorldLayout {
  if (pageId === MASTER_ID) {
    const p = doc.pages[0];
    return { slots: [{ index: -1, id: MASTER_ID, x: 0, y: 0, w: p.width, h: p.height }], width: p.width, height: p.height };
  }
  const groups = mode === 'single' ? [spreadOf(doc, Math.max(0, Math.min(doc.pages.length - 1, currentIndex)))] : spreads(doc);
  // spine position so left/right pages line up in facing mode
  let leftMax = 0;
  let rightMax = 0;
  let maxW = 0;
  for (const g of groups) {
    if (doc.facing) {
      for (const i of g) {
        const p = doc.pages[i];
        if (i % 2 === 1) leftMax = Math.max(leftMax, p.width);
        else rightMax = Math.max(rightMax, p.width);
      }
    } else maxW = Math.max(maxW, ...g.map((i) => doc.pages[i].width));
  }
  const slots: PageSlot[] = [];
  let y = 0;
  for (const g of groups) {
    let rowH = 0;
    for (const i of g) {
      const p = doc.pages[i];
      let x: number;
      if (doc.facing) x = i % 2 === 1 ? leftMax - p.width : i === 0 && g.length === 1 ? leftMax : leftMax + SPREAD_GAP;
      else x = (maxW - p.width) / 2;
      slots.push({ index: i, id: p.id, x, y, w: p.width, h: p.height });
      rowH = Math.max(rowH, p.height);
    }
    y += rowH + PAGE_GAP;
  }
  const width = doc.facing ? leftMax + rightMax + SPREAD_GAP : maxW;
  return { slots, width: Math.max(1, width), height: Math.max(1, y - PAGE_GAP) };
}

export function slotAt(world: WorldLayout, p: Point, margin = 0): PageSlot | null {
  for (const s of world.slots) {
    if (p.x >= s.x - margin && p.x <= s.x + s.w + margin && p.y >= s.y - margin && p.y <= s.y + s.h + margin) return s;
  }
  return null;
}

/** Slot whose vertical center is closest to a world y (continuous scrolling). */
export function nearestSlot(world: WorldLayout, p: Point): PageSlot | null {
  let best: PageSlot | null = null;
  let bestD = Infinity;
  for (const s of world.slots) {
    const dx = p.x < s.x ? s.x - p.x : p.x > s.x + s.w ? p.x - s.x - s.w : 0;
    const dy = p.y < s.y ? s.y - p.y : p.y > s.y + s.h ? p.y - s.y - s.h : 0;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
