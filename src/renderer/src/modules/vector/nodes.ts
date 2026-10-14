import { nearestOnCubic, splitCubic } from './bezier';
import type { Pt } from './matrix';
import type { PathGeom, PathNode, SubPath } from './model';
import { segmentCubic } from './path';

export interface NodeRef {
  sub: number;
  idx: number;
}

const copyNode = (n: PathNode): PathNode => ({ ...n, in: n.in ? { ...n.in } : undefined, out: n.out ? { ...n.out } : undefined });

function clean(n: PathNode): PathNode {
  const out: PathNode = { x: n.x, y: n.y };
  if (n.in && (Math.abs(n.in.x - n.x) > 1e-9 || Math.abs(n.in.y - n.y) > 1e-9)) out.in = n.in;
  if (n.out && (Math.abs(n.out.x - n.x) > 1e-9 || Math.abs(n.out.y - n.y) > 1e-9)) out.out = n.out;
  if (n.smooth && out.in && out.out) out.smooth = true;
  return out;
}

function mapNodes(geom: PathGeom, fn: (n: PathNode, sub: number, idx: number) => PathNode): PathGeom {
  return { ...geom, subpaths: geom.subpaths.map((s, si) => ({ ...s, nodes: s.nodes.map((n, ni) => fn(n, si, ni)) })) };
}

/** Moves anchors (with their handles) by a local offset. */
export function moveNodes(geom: PathGeom, refs: NodeRef[], dx: number, dy: number): PathGeom {
  const set = new Set(refs.map((r) => `${r.sub}:${r.idx}`));
  return mapNodes(geom, (n, s, i) => {
    if (!set.has(`${s}:${i}`)) return n;
    const m = copyNode(n);
    m.x += dx;
    m.y += dy;
    if (m.in) m.in = { x: m.in.x + dx, y: m.in.y + dy };
    if (m.out) m.out = { x: m.out.x + dx, y: m.out.y + dy };
    return clean(m);
  });
}

/** Moves one handle; smooth nodes rotate the opposite handle (keeping its length) unless `breakSmooth`. */
export function setHandle(geom: PathGeom, ref: NodeRef, kind: 'in' | 'out', p: Pt, breakSmooth = false, symmetric = false): PathGeom {
  return mapNodes(geom, (n, s, i) => {
    if (s !== ref.sub || i !== ref.idx) return n;
    const m = copyNode(n);
    m[kind] = { x: p.x, y: p.y };
    const other = kind === 'in' ? 'out' : 'in';
    if (breakSmooth) m.smooth = false;
    else if (m.smooth || symmetric) {
      const vx = p.x - m.x;
      const vy = p.y - m.y;
      const len = Math.hypot(vx, vy);
      const o = m[other];
      const olen = symmetric ? len : o ? Math.hypot(o.x - m.x, o.y - m.y) : 0;
      if (len > 1e-9 && olen > 1e-9) m[other] = { x: m.x - (vx / len) * olen, y: m.y - (vy / len) * olen };
      if (symmetric) m.smooth = true;
    }
    return clean(m);
  });
}

/** Corner ↔ smooth. Smooth handles follow the neighbours' direction (1/3 of the distance). */
export function toggleSmooth(geom: PathGeom, ref: NodeRef, forceSmooth?: boolean): PathGeom {
  const sub = geom.subpaths[ref.sub];
  if (!sub) return geom;
  const n = sub.nodes[ref.idx];
  const makeSmooth = forceSmooth ?? !(n.in || n.out);
  return mapNodes(geom, (node, s, i) => {
    if (s !== ref.sub || i !== ref.idx) return node;
    if (!makeSmooth) return { x: node.x, y: node.y };
    const count = sub.nodes.length;
    const prev = ref.idx > 0 ? sub.nodes[ref.idx - 1] : sub.closed ? sub.nodes[count - 1] : null;
    const next = ref.idx < count - 1 ? sub.nodes[ref.idx + 1] : sub.closed ? sub.nodes[0] : null;
    let tx = (next?.x ?? node.x) - (prev?.x ?? node.x);
    let ty = (next?.y ?? node.y) - (prev?.y ?? node.y);
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-9) return node;
    tx /= tl;
    ty /= tl;
    const dIn = prev ? Math.hypot(prev.x - node.x, prev.y - node.y) / 3 : 0;
    const dOut = next ? Math.hypot(next.x - node.x, next.y - node.y) / 3 : 0;
    const out: PathNode = { x: node.x, y: node.y, smooth: Boolean(prev && next) };
    if (prev) out.in = { x: node.x - tx * dIn, y: node.y - ty * dIn };
    if (next) out.out = { x: node.x + tx * dOut, y: node.y + ty * dOut };
    return out;
  });
}

/** Deletes anchors; sub paths with fewer than 2 anchors disappear. */
export function deleteNodes(geom: PathGeom, refs: NodeRef[]): PathGeom {
  const set = new Set(refs.map((r) => `${r.sub}:${r.idx}`));
  const subpaths: SubPath[] = [];
  geom.subpaths.forEach((s, si) => {
    const nodes = s.nodes.filter((_, ni) => !set.has(`${si}:${ni}`));
    if (nodes.length >= 2) subpaths.push({ ...s, nodes, closed: s.closed && nodes.length >= 3 });
  });
  return { ...geom, subpaths };
}

/** Finds the closest segment to `p` (local coordinates). */
export function nearestSegment(geom: PathGeom, p: Pt): { sub: number; seg: number; t: number; dist: number; point: Pt } | null {
  let best: { sub: number; seg: number; t: number; dist: number; point: Pt } | null = null;
  geom.subpaths.forEach((s, si) => {
    const n = s.nodes.length;
    const count = s.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const c = segmentCubic(s.nodes[i], s.nodes[(i + 1) % n]);
      const r = nearestOnCubic(c, p);
      if (!best || r.dist < best.dist) best = { sub: si, seg: i, t: r.t, dist: r.dist, point: r.point };
    }
  });
  return best;
}

/** Inserts an anchor on segment `seg` at parameter `t` without changing the curve shape. */
export function insertNode(geom: PathGeom, subIndex: number, seg: number, t: number): { geom: PathGeom; index: number } {
  const sub = geom.subpaths[subIndex];
  if (!sub) return { geom, index: -1 };
  const n = sub.nodes.length;
  const a = sub.nodes[seg];
  const b = sub.nodes[(seg + 1) % n];
  const straight = !a.out && !b.in;
  const [left, right] = splitCubic(segmentCubic(a, b), Math.max(0.001, Math.min(0.999, t)));
  const mid: PathNode = { x: left[6], y: left[7] };
  const nodes = sub.nodes.map(copyNode);
  if (!straight) {
    nodes[seg] = clean({ ...nodes[seg], out: { x: left[2], y: left[3] } });
    mid.in = { x: left[4], y: left[5] };
    mid.out = { x: right[2], y: right[3] };
    mid.smooth = true;
    const bi = (seg + 1) % n;
    nodes[bi] = clean({ ...nodes[bi], in: { x: right[4], y: right[5] } });
  }
  nodes.splice(seg + 1, 0, clean(mid));
  const subpaths = geom.subpaths.slice();
  subpaths[subIndex] = { ...sub, nodes };
  return { geom: { ...geom, subpaths }, index: seg + 1 };
}

/** All node refs of a path. */
export function allNodeRefs(geom: PathGeom): NodeRef[] {
  return geom.subpaths.flatMap((s, sub) => s.nodes.map((_, idx) => ({ sub, idx })));
}
