import type { Mat } from './matrix';
import { apply, applyVector, IDENTITY, multiply, rotation, scaling, translate } from './matrix';
import type { PathNode, SubPath } from './types';

/**
 * SVG path data ("d" attribute) → bézier sub-paths. Supports every command
 * (M L H V C S Q T A Z, absolute and relative) and converts everything to cubic nodes.
 */

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** Context-aware scanner: arc flags may be packed without separators ("a1 1 0 011 1"). */
class Scanner {
  i = 0;
  constructor(private s: string) {}
  private skip() {
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
  command(): string {
    const c = this.peekCommand();
    if (!c) throw new Error(`Invalid path data near "${this.s.slice(this.i, this.i + 12)}"`);
    this.i++;
    return c;
  }
  number(): number {
    this.skip();
    NUMBER.lastIndex = this.i;
    const m = NUMBER.exec(this.s);
    if (!m || m.index !== this.i) throw new Error(`Invalid number near "${this.s.slice(this.i, this.i + 12)}"`);
    this.i += m[0].length;
    return parseFloat(m[0]);
  }
  flag(): number {
    this.skip();
    const ch = this.s[this.i];
    if (ch !== '0' && ch !== '1') throw new Error('Invalid arc flag');
    this.i++;
    return ch === '1' ? 1 : 0;
  }
  hasNumber(): boolean {
    this.skip();
    return this.i < this.s.length && /[-+.\d]/.test(this.s[this.i]);
  }
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function node(x: number, y: number): PathNode {
  return { x, y, inX: 0, inY: 0, outX: 0, outY: 0 };
}

/** Converts an SVG elliptical arc into cubic bézier segments ([c1x,c1y,c2x,c2y,x,y]). */
export function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): number[][] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: number[][] = [];
  let t = theta1;
  const point = (a: number): [number, number] => {
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
  };
  const deriv = (a: number): [number, number] => {
    const ex = -rx * Math.sin(a);
    const ey = ry * Math.cos(a);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };
  for (let i = 0; i < segments; i++) {
    const a0 = t;
    const a1 = t + step;
    const p0 = point(a0);
    const p1 = i === segments - 1 ? ([x2, y2] as [number, number]) : point(a1);
    const d0 = deriv(a0);
    const d1 = deriv(a1);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]);
    t = a1;
  }
  return out;
}

export function parsePathData(d: string): SubPath[] {
  const sc = new Scanner(d);
  const result: SubPath[] = [];
  let current: SubPath | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrl: { x: number; y: number; kind: 'c' | 'q' } | null = null;

  const lastNode = () => current!.nodes[current!.nodes.length - 1];
  const ensure = () => {
    if (!current) {
      current = { closed: false, nodes: [node(x, y)] };
      result.push(current);
    }
  };
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) => {
    ensure();
    const prev = lastNode();
    prev.outX = c1x - prev.x;
    prev.outY = c1y - prev.y;
    const n = node(px, py);
    n.inX = c2x - px;
    n.inY = c2y - py;
    current!.nodes.push(n);
    x = px;
    y = py;
  };
  const line = (px: number, py: number) => {
    ensure();
    current!.nodes.push(node(px, py));
    x = px;
    y = py;
  };
  const close = () => {
    if (current) {
      const sp: SubPath = current;
      sp.closed = true;
      const first = sp.nodes[0];
      const last = sp.nodes[sp.nodes.length - 1];
      if (sp.nodes.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
        first.inX = last.inX;
        first.inY = last.inY;
        sp.nodes.pop();
      }
    }
    x = startX;
    y = startY;
    current = null;
    lastCtrl = null;
  };

  let cmd = '';
  while (!sc.done()) {
    if (sc.peekCommand()) cmd = sc.command();
    else if (!cmd) throw new Error('Path data must start with a command');
    else if (cmd === 'z' || cmd === 'Z') throw new Error('Unexpected number after Z');
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    if (lower === 'z') {
      close();
      continue;
    }
    if (ARGS[lower] === undefined) throw new Error(`Unknown path command ${cmd}`);
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (lower) {
      case 'm': {
        x = sc.number() + ox;
        y = sc.number() + oy;
        startX = x;
        startY = y;
        current = { closed: false, nodes: [node(x, y)] };
        result.push(current);
        cmd = rel ? 'l' : 'L'; // subsequent pairs are implicit lineto
        lastCtrl = null;
        break;
      }
      case 'l': {
        const px = sc.number() + ox;
        const py = sc.number() + oy;
        line(px, py);
        lastCtrl = null;
        break;
      }
      case 'h':
        line(sc.number() + ox, y);
        lastCtrl = null;
        break;
      case 'v':
        line(x, sc.number() + oy);
        lastCtrl = null;
        break;
      case 'c': {
        const a = [sc.number(), sc.number(), sc.number(), sc.number(), sc.number(), sc.number()];
        const c2x = a[2] + ox;
        const c2y = a[3] + oy;
        cubic(a[0] + ox, a[1] + oy, c2x, c2y, a[4] + ox, a[5] + oy);
        lastCtrl = { x: c2x, y: c2y, kind: 'c' };
        break;
      }
      case 's': {
        const a = [sc.number(), sc.number(), sc.number(), sc.number()];
        const c1x = lastCtrl?.kind === 'c' ? 2 * x - lastCtrl.x : x;
        const c1y = lastCtrl?.kind === 'c' ? 2 * y - lastCtrl.y : y;
        const c2x = a[0] + ox;
        const c2y = a[1] + oy;
        cubic(c1x, c1y, c2x, c2y, a[2] + ox, a[3] + oy);
        lastCtrl = { x: c2x, y: c2y, kind: 'c' };
        break;
      }
      case 'q':
      case 't': {
        let qx: number;
        let qy: number;
        let px: number;
        let py: number;
        if (lower === 'q') {
          qx = sc.number() + ox;
          qy = sc.number() + oy;
          px = sc.number() + ox;
          py = sc.number() + oy;
        } else {
          qx = lastCtrl?.kind === 'q' ? 2 * x - lastCtrl.x : x;
          qy = lastCtrl?.kind === 'q' ? 2 * y - lastCtrl.y : y;
          px = sc.number() + ox;
          py = sc.number() + oy;
        }
        const sx = x;
        const sy = y;
        cubic(sx + (2 / 3) * (qx - sx), sy + (2 / 3) * (qy - sy), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py);
        lastCtrl = { x: qx, y: qy, kind: 'q' };
        break;
      }
      case 'a': {
        const rx = sc.number();
        const ry = sc.number();
        const rot = sc.number();
        const large = sc.flag();
        const sweep = sc.flag();
        const px = sc.number() + ox;
        const py = sc.number() + oy;
        for (const seg of arcToCubics(x, y, rx, ry, rot, large, sweep, px, py)) {
          cubic(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
        }
        lastCtrl = null;
        break;
      }
    }
    if (!sc.hasNumber() && !sc.peekCommand() && !sc.done()) throw new Error('Invalid path data');
  }
  return result.filter((sp) => sp.nodes.length > 1 || sp.closed);
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Sub-paths → SVG path data. */
export function toPathData(subpaths: SubPath[]): string {
  const parts: string[] = [];
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    const first = sp.nodes[0];
    parts.push(`M${fmt(first.x)} ${fmt(first.y)}`);
    const count = sp.closed ? sp.nodes.length : sp.nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % sp.nodes.length];
      if (!a.outX && !a.outY && !b.inX && !b.inY) parts.push(`L${fmt(b.x)} ${fmt(b.y)}`);
      else parts.push(`C${fmt(a.x + a.outX)} ${fmt(a.y + a.outY)} ${fmt(b.x + b.inX)} ${fmt(b.y + b.inY)} ${fmt(b.x)} ${fmt(b.y)}`);
    }
    if (sp.closed) parts.push('Z');
  }
  return parts.join(' ');
}

/** Applies an affine matrix to every point and handle. */
export function transformSubpaths(subpaths: SubPath[], m: Mat): SubPath[] {
  return subpaths.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => {
      const [x, y] = apply(m, n.x, n.y);
      const [inX, inY] = applyVector(m, n.inX, n.inY);
      const [outX, outY] = applyVector(m, n.outX, n.outY);
      return { x, y, inX, inY, outX, outY };
    }),
  }));
}

/** Parses an SVG `transform` attribute (matrix, translate, scale, rotate, skewX, skewY). */
export function parseTransformAttr(value: string | null | undefined): Mat {
  if (!value) return [...IDENTITY];
  let m: Mat = [...IDENTITY];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const args = match[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(parseFloat)
      .filter((n) => Number.isFinite(n));
    let t: Mat = [...IDENTITY];
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) t = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      case 'translate':
        t = translate(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale':
        t = scaling(args[0] ?? 1, args[1] ?? args[0] ?? 1);
        break;
      case 'rotate':
        if (args.length >= 3) t = multiply(translate(args[1], args[2]), multiply(rotation(args[0]), translate(-args[1], -args[2])));
        else t = rotation(args[0] ?? 0);
        break;
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}
