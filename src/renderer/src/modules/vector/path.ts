import { arcToCubics, cubicBounds, flattenCubic, quadToCubic, type Cubic } from './bezier';
import { apply, fmt, type Matrix, type Pt, type Rect, unionRects } from './matrix';
import type { PathGeom, PathNode, SubPath } from './model';

/* ------------------------------- Parsing (d) ------------------------------- */

const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

class Scanner {
  i = 0;
  constructor(private s: string) {}
  skip(): void {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i])) this.i++;
  }
  done(): boolean {
    this.skip();
    return this.i >= this.s.length;
  }
  peekCommand(): string | null {
    this.skip();
    const ch = this.s[this.i];
    return ch && /[MmLlHhVvCcSsQqTtAaZz]/.test(ch) ? ch : null;
  }
  hasNumber(): boolean {
    this.skip();
    return NUM_RE.test(this.s.slice(this.i, this.i + 32));
  }
  number(): number {
    this.skip();
    const m = NUM_RE.exec(this.s.slice(this.i, this.i + 64));
    if (!m) throw new Error(`Expected a number at ${this.i}`);
    this.i += m[0].length;
    return parseFloat(m[0]);
  }
  flag(): boolean {
    this.skip();
    const ch = this.s[this.i];
    if (ch !== '0' && ch !== '1') throw new Error(`Expected an arc flag at ${this.i}`);
    this.i++;
    return ch === '1';
  }
}

const EPS = 1e-6;
const same = (a: Pt, b: Pt, eps = EPS) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/**
 * Parses SVG path data into editable sub paths of cubic béziers. Supports every command
 * (absolute and relative, implicit repeats, arcs, quadratic and smooth curves).
 * Malformed trailing data is ignored (like browsers do).
 */
export function parsePathData(d: string): PathGeom {
  const subpaths: SubPath[] = [];
  const sc = new Scanner(d ?? '');
  const st: { current: SubPath | null } = { current: null };
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Pt | null = null; // for S/T reflection
  let lastCmd = '';

  const startSub = (x: number, y: number) => {
    if (st.current && st.current.nodes.length) subpaths.push(st.current);
    st.current = { nodes: [{ x, y }], closed: false };
  };
  const ensureSub = (): SubPath => {
    if (!st.current || st.current.closed) startSub(cx, cy);
    return st.current as SubPath;
  };
  const lineTo = (x: number, y: number) => {
    const sub = ensureSub();
    sub.nodes.push({ x, y });
    cx = x;
    cy = y;
  };
  const curveTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const sub = ensureSub();
    const last = sub.nodes[sub.nodes.length - 1];
    if (!same({ x: x1, y: y1 }, last, 1e-9)) last.out = { x: x1, y: y1 };
    const node: PathNode = { x, y };
    if (!same({ x: x2, y: y2 }, node, 1e-9)) node.in = { x: x2, y: y2 };
    sub.nodes.push(node);
    cx = x;
    cy = y;
  };

  try {
    while (!sc.done()) {
      let cmd = sc.peekCommand();
      if (cmd) sc.i++;
      else if (lastCmd && lastCmd !== 'Z' && lastCmd !== 'z' && sc.hasNumber()) {
        // implicit repetition; after M the implicit command is L
        cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
      } else break;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      switch (C) {
        case 'M': {
          const x = sc.number() + ox;
          const y = sc.number() + oy;
          startSub(x, y);
          cx = sx = x;
          cy = sy = y;
          lastCtrl = null;
          break;
        }
        case 'L': {
          lineTo(sc.number() + ox, sc.number() + oy);
          lastCtrl = null;
          break;
        }
        case 'H': {
          lineTo(sc.number() + ox, cy);
          lastCtrl = null;
          break;
        }
        case 'V': {
          lineTo(cx, sc.number() + oy);
          lastCtrl = null;
          break;
        }
        case 'C': {
          const x1 = sc.number() + ox;
          const y1 = sc.number() + oy;
          const x2 = sc.number() + ox;
          const y2 = sc.number() + oy;
          const x = sc.number() + ox;
          const y = sc.number() + oy;
          curveTo(x1, y1, x2, y2, x, y);
          lastCtrl = { x: x2, y: y2 };
          break;
        }
        case 'S': {
          const prevC: Pt | null = lastCtrl && /[CcSs]/.test(lastCmd) ? lastCtrl : null;
          const x1: number = prevC ? 2 * cx - prevC.x : cx;
          const y1: number = prevC ? 2 * cy - prevC.y : cy;
          const x2 = sc.number() + ox;
          const y2 = sc.number() + oy;
          const x = sc.number() + ox;
          const y = sc.number() + oy;
          curveTo(x1, y1, x2, y2, x, y);
          lastCtrl = { x: x2, y: y2 };
          break;
        }
        case 'Q': {
          const qx = sc.number() + ox;
          const qy = sc.number() + oy;
          const x = sc.number() + ox;
          const y = sc.number() + oy;
          const c = quadToCubic(cx, cy, qx, qy, x, y);
          curveTo(c[2], c[3], c[4], c[5], x, y);
          lastCtrl = { x: qx, y: qy };
          break;
        }
        case 'T': {
          const prevQ: Pt | null = lastCtrl && /[QqTt]/.test(lastCmd) ? lastCtrl : null;
          const qx: number = prevQ ? 2 * cx - prevQ.x : cx;
          const qy: number = prevQ ? 2 * cy - prevQ.y : cy;
          const x = sc.number() + ox;
          const y = sc.number() + oy;
          const c = quadToCubic(cx, cy, qx, qy, x, y);
          curveTo(c[2], c[3], c[4], c[5], x, y);
          lastCtrl = { x: qx, y: qy };
          break;
        }
        case 'A': {
          const rx = sc.number();
          const ry = sc.number();
          const rot = sc.number();
          const large = sc.flag();
          const sweep = sc.flag();
          const x = sc.number() + ox;
          const y = sc.number() + oy;
          const cubics = arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y);
          if (!cubics.length) {
            cx = x;
            cy = y;
          }
          for (const c of cubics) curveTo(c[2], c[3], c[4], c[5], c[6], c[7]);
          lastCtrl = null;
          break;
        }
        case 'Z': {
          if (st.current) {
            const sub = st.current;
            sub.closed = true;
            const first = sub.nodes[0];
            const last = sub.nodes[sub.nodes.length - 1];
            if (sub.nodes.length > 1 && same(first, last)) {
              if (last.in) first.in = last.in;
              sub.nodes.pop();
            }
          }
          cx = sx;
          cy = sy;
          lastCtrl = null;
          break;
        }
      }
      lastCmd = cmd;
    }
  } catch {
    // keep what was parsed so far (browsers render up to the first error)
  }
  if (st.current && st.current.nodes.length) subpaths.push(st.current);
  const out: PathGeom = { subpaths: subpaths.filter((s) => s.nodes.length > 1) };
  markSmoothNodes(out);
  return out;
}

/** Flags nodes whose handles are collinear as smooth (so editing keeps them smooth). */
export function markSmoothNodes(geom: PathGeom): void {
  for (const sub of geom.subpaths) {
    for (const n of sub.nodes) {
      if (!n.in || !n.out) continue;
      const ax = n.in.x - n.x;
      const ay = n.in.y - n.y;
      const bx = n.out.x - n.x;
      const by = n.out.y - n.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-9 || lb < 1e-9) continue;
      const cross = Math.abs(ax * by - ay * bx) / (la * lb);
      const dot = (ax * bx + ay * by) / (la * lb);
      if (cross < 0.02 && dot < 0) n.smooth = true;
    }
  }
}

/* ----------------------------- Serialization (d) ---------------------------- */

/** Serializes to compact absolute path data (M, L, H, V, C, Z). */
export function serializePath(geom: PathGeom, digits = 3): string {
  const f = (n: number) => fmt(n, digits);
  const parts: string[] = [];
  for (const sub of geom.subpaths) {
    const nodes = sub.nodes;
    if (!nodes.length) continue;
    parts.push(`M${f(nodes[0].x)} ${f(nodes[0].y)}`);
    const count = sub.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      const closing = sub.closed && i === nodes.length - 1;
      if (!a.out && !b.in) {
        if (closing) continue; // Z draws the straight closing segment
        if (f(a.y) === f(b.y) && f(a.x) !== f(b.x)) parts.push(`H${f(b.x)}`);
        else if (f(a.x) === f(b.x) && f(a.y) !== f(b.y)) parts.push(`V${f(b.y)}`);
        else parts.push(`L${f(b.x)} ${f(b.y)}`);
      } else {
        const c1 = a.out ?? a;
        const c2 = b.in ?? b;
        parts.push(`C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`);
      }
    }
    if (sub.closed) parts.push('Z');
  }
  return parts.join('');
}

/* --------------------------------- Helpers --------------------------------- */

export function segmentCubic(a: PathNode, b: PathNode): Cubic {
  const c1 = a.out ?? a;
  const c2 = b.in ?? b;
  return [a.x, a.y, c1.x, c1.y, c2.x, c2.y, b.x, b.y];
}

/** Cubic segments of a sub path (including the closing segment when closed). */
export function subpathCubics(sub: SubPath): Cubic[] {
  const out: Cubic[] = [];
  const n = sub.nodes.length;
  const count = sub.closed ? n : n - 1;
  for (let i = 0; i < count; i++) out.push(segmentCubic(sub.nodes[i], sub.nodes[(i + 1) % n]));
  return out;
}

export function geomBounds(geom: PathGeom): Rect | null {
  const rects: Rect[] = [];
  for (const sub of geom.subpaths) {
    if (sub.nodes.length === 1) rects.push({ x: sub.nodes[0].x, y: sub.nodes[0].y, width: 0, height: 0 });
    for (const c of subpathCubics(sub)) rects.push(cubicBounds(c));
  }
  return unionRects(rects);
}

export function mapGeom(geom: PathGeom, fn: (p: Pt) => Pt): PathGeom {
  return {
    ...geom,
    subpaths: geom.subpaths.map((sub) => ({
      closed: sub.closed,
      nodes: sub.nodes.map((n) => {
        const p = fn(n);
        const node: PathNode = { x: p.x, y: p.y };
        if (n.in) node.in = fn(n.in);
        if (n.out) node.out = fn(n.out);
        if (n.smooth) node.smooth = true;
        return node;
      }),
    })),
  };
}

export function transformGeom(geom: PathGeom, m: Matrix): PathGeom {
  return mapGeom(geom, (p) => apply(m, p));
}

export interface Polyline {
  /** x,y pairs */
  pts: number[];
  closed: boolean;
}

/** Flattens a path into polylines with at most `tolerance` deviation. */
export function flattenGeom(geom: PathGeom, tolerance = 0.25): Polyline[] {
  const out: Polyline[] = [];
  for (const sub of geom.subpaths) {
    if (!sub.nodes.length) continue;
    const pts: number[] = [sub.nodes[0].x, sub.nodes[0].y];
    for (const c of subpathCubics(sub)) flattenCubic(c, tolerance, pts);
    if (sub.closed && pts.length > 2) {
      // drop the duplicated start point produced by the closing segment
      const n = pts.length;
      if (Math.abs(pts[n - 2] - pts[0]) < 1e-9 && Math.abs(pts[n - 1] - pts[1]) < 1e-9) pts.length = n - 2;
    }
    out.push({ pts, closed: sub.closed });
  }
  return out;
}

export function reverseSubpath(sub: SubPath): SubPath {
  const nodes = [...sub.nodes].reverse().map((n) => {
    const node: PathNode = { x: n.x, y: n.y };
    if (n.out) node.in = n.out;
    if (n.in) node.out = n.in;
    if (n.smooth) node.smooth = true;
    return node;
  });
  return { nodes, closed: sub.closed };
}

/** Number of anchor points in a path. */
export function nodeCount(geom: PathGeom): number {
  return geom.subpaths.reduce((n, s) => n + s.nodes.length, 0);
}

/** Signed area of a closed polyline (positive = clockwise in screen coordinates). */
export function polylineArea(pts: number[]): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return a / 2;
}
