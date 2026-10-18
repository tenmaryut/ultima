import { half, type Gray } from './tracker';

/*
 * Optical-flow slow motion (pure, unit tested): dense motion between two frames with pyramidal Lucas–Kanade, and the
 * frames in between made by moving the pixels of both frames part of the way along that motion — the way Twixtor
 * makes new frames instead of repeating or cross-fading old ones.
 */

/** Motion of every pixel of a picture of w × h (in its own pixels). */
export interface Flow {
  w: number;
  h: number;
  u: Float32Array;
  v: Float32Array;
}

/** Sum over a (2r+1)² window around every pixel (clamped at the edges), in place of `src`. */
function boxFilter(src: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  // rows
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  // columns
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/** Bilinear sample of a single-channel picture (clamped at the edges). */
function sample(d: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = Math.min(Math.max(x, 0), w - 1.001);
  const fy = Math.min(Math.max(y, 0), h - 1.001);
  const ix = fx | 0;
  const iy = fy | 0;
  const ax = fx - ix;
  const ay = fy - iy;
  const i = iy * w + ix;
  return (1 - ay) * ((1 - ax) * d[i] + ax * d[i + 1]) + ay * ((1 - ax) * d[i + w] + ax * d[i + w + 1]);
}

/** 3×3 median of each pixel (removes lone wrong vectors). */
function median3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  const win = new Float32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) win[k++] = src[yy * w + Math.min(w - 1, Math.max(0, x + dx))];
      }
      win.sort();
      out[y * w + x] = win[4];
    }
  }
  return out;
}

/**
 * Points each 8×8 block (every 4 px) at its best match within ±r px of where the flow points now, when that match is
 * clearly better: lets small objects that move differently from their surroundings (a player against a panning
 * background) escape the coarser levels' estimate, which only sees the background.
 */
function correctByBlocks(A: Gray, B: Gray, u: Float32Array, v: Float32Array, r: number): void {
  const { w, h } = A;
  const nu = u.slice();
  const nv = v.slice();
  const a = A.data;
  const b = B.data;
  // blocks every 4 px: their chosen motion, and whether they had texture to measure it by
  const bw = Math.max(0, Math.floor((w - 8) / 4) + 1);
  const bh = Math.max(0, Math.floor((h - 8) / 4) + 1);
  const ku = new Float32Array(bw * bh);
  const kv = new Float32Array(bw * bh);
  const known = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    const cy = by * 4 + 4;
    for (let bx = 0; bx < bw; bx++) {
      const cx = bx * 4 + 4;
      const i = cy * w + cx;
      const fu = Math.round(u[i]);
      const fv = Math.round(v[i]);
      ku[by * bw + bx] = u[i];
      kv[by * bw + bx] = v[i];
      // flat blocks (a plain wall, the middle of a plain shape) can't tell motions apart: they get their neighbours'
      let texture = 0;
      for (let y = cy - 4; y < cy + 3; y++) for (let x = cx - 4; x < cx + 3; x++) texture += Math.abs(a[y * w + x + 1] - a[y * w + x]) + Math.abs(a[(y + 1) * w + x] - a[y * w + x]);
      if (texture / 49 < 1.5) continue;
      known[by * bw + bx] = 1;
      const sadAt = (ox: number, oy: number, limit: number) => {
        let sad = 0;
        for (let y = 0; y < 8 && sad < limit; y++) {
          const ra = (cy - 4 + y) * w + cx - 4;
          const rb = ra + oy * w + ox;
          for (let x = 0; x < 8; x++) sad += Math.abs(a[ra + x] - b[rb + x]);
        }
        return sad;
      };
      const fits = (ox: number, oy: number) => cx - 4 + ox >= 0 && cx + 4 + ox <= w && cy - 4 + oy >= 0 && cy + 4 + oy <= h;
      const base = fits(fu, fv) ? sadAt(fu, fv, Infinity) : Infinity;
      let best = base;
      let bu = fu;
      let bv = fv;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ox = fu + dx;
          const oy = fv + dy;
          if (!fits(ox, oy)) continue;
          const sad = sadAt(ox, oy, best);
          // ties go to the smaller change
          if (sad < best - 1e-3 || (Math.abs(sad - best) <= 1e-3 && dx * dx + dy * dy < (bu - fu) ** 2 + (bv - fv) ** 2)) {
            best = sad;
            bu = ox;
            bv = oy;
          }
        }
      }
      if ((bu !== fu || bv !== fv) && best < 0.7 * base) {
        ku[by * bw + bx] = bu;
        kv[by * bw + bx] = bv;
      }
    }
  }
  // flat blocks take the median motion of measured neighbours, growing inwards from the edges of plain areas
  const mid = (list: number[]) => list.sort((p, q) => p - q)[list.length >> 1];
  for (let pass = 0; pass < 8; pass++) {
    const add: [number, number, number][] = [];
    for (let k = 0; k < bw * bh; k++) {
      if (known[k]) continue;
      const bx = k % bw;
      const by = (k / bw) | 0;
      const us: number[] = [];
      const vs: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if ((dx || dy) && x >= 0 && y >= 0 && x < bw && y < bh && known[y * bw + x]) {
            us.push(ku[y * bw + x]);
            vs.push(kv[y * bw + x]);
          }
        }
      }
      if (us.length >= 2) add.push([k, mid(us), mid(vs)]);
    }
    if (!add.length) break;
    for (const [k, mu, mv] of add) {
      ku[k] = mu;
      kv[k] = mv;
      known[k] = 1;
    }
  }
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const k = by * bw + bx;
      const cx = bx * 4 + 4;
      const cy = by * 4 + 4;
      if (ku[k] === u[cy * w + cx] && kv[k] === v[cy * w + cx]) continue;
      for (let y = cy - 2; y < cy + 2; y++) {
        for (let x = cx - 2; x < cx + 2; x++) {
          nu[y * w + x] = ku[k];
          nv[y * w + x] = kv[k];
        }
      }
    }
  }
  u.set(nu);
  v.set(nv);
}

export interface FlowOptions {
  /** Window half-size of the least-squares fit (px at each level). */
  radius?: number;
  /** Refinements per pyramid level. */
  iterations?: number;
}

/** Dense optical flow from `a` to `b` (pixel x of `a` is at x + (u, v) in `b`). */
export function opticalFlow(a: Gray, b: Gray, o: FlowOptions = {}): Flow {
  const radius = o.radius ?? 4;
  const iterations = o.iterations ?? 3;
  const pa: Gray[] = [a];
  const pb: Gray[] = [b];
  while (pa.length < 6 && Math.min(pa[pa.length - 1].w, pa[pa.length - 1].h) >= 32) {
    pa.push(half(pa[pa.length - 1]));
    pb.push(half(pb[pb.length - 1]));
  }
  let u: Float32Array = new Float32Array(0);
  let v: Float32Array = new Float32Array(0);
  let pw = 0;
  let ph = 0;
  for (let l = pa.length - 1; l >= 0; l--) {
    const A = pa[l];
    const B = pb[l];
    const { w, h } = A;
    const n = w * h;
    // the motion of the coarser level, twice as long here
    const nu = new Float32Array(n);
    const nv = new Float32Array(n);
    if (pw) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = ((x + 0.5) * pw) / w - 0.5;
          const sy = ((y + 0.5) * ph) / h - 0.5;
          nu[y * w + x] = sample(u, pw, ph, sx, sy) * (w / pw);
          nv[y * w + x] = sample(v, pw, ph, sx, sy) * (h / ph);
        }
      }
    }
    u = nu;
    v = nv;
    pw = w;
    ph = h;
    // a search first, wider on the coarser levels where small fast things go missing — but not on the tiniest ones,
    // where an 8 px block is a big part of the picture and look-alikes are everywhere
    if (w >= 64 && h >= 16) {
      correctByBlocks(A, B, u, v, l > 0 ? 8 : 3);
      u = median3(u, w, h);
      v = median3(v, w, h);
    }
    // gradients of a (central differences)
    const ix = new Float32Array(n);
    const iy = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        ix[i] = 0.5 * (A.data[y * w + Math.min(w - 1, x + 1)] - A.data[y * w + Math.max(0, x - 1)]);
        iy[i] = 0.5 * (A.data[Math.min(h - 1, y + 1) * w + x] - A.data[Math.max(0, y - 1) * w + x]);
      }
    }
    const xx = new Float32Array(n);
    const xy = new Float32Array(n);
    const yy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xx[i] = ix[i] * ix[i];
      xy[i] = ix[i] * iy[i];
      yy[i] = iy[i] * iy[i];
    }
    const tmp = new Float32Array(n);
    boxFilter(xx, w, h, radius, tmp);
    boxFilter(xy, w, h, radius, tmp);
    boxFilter(yy, w, h, radius, tmp);
    const xt = new Float32Array(n);
    const yt = new Float32Array(n);
    const reg = 0.5 * (2 * radius + 1) ** 2;
    for (let it = 0; it < iterations; it++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const d = sample(B.data, w, h, x + u[i], y + v[i]) - A.data[i];
          xt[i] = ix[i] * d;
          yt[i] = iy[i] * d;
        }
      }
      boxFilter(xt, w, h, radius, tmp);
      boxFilter(yt, w, h, radius, tmp);
      for (let i = 0; i < n; i++) {
        // a little regularization keeps flat areas from wandering
        const a11 = xx[i] + reg;
        const a22 = yy[i] + reg;
        const det = a11 * a22 - xy[i] * xy[i];
        if (det <= 1e-6) continue;
        u[i] += (-a22 * xt[i] + xy[i] * yt[i]) / det;
        v[i] += (xy[i] * xt[i] - a11 * yt[i]) / det;
      }
    }
    u = median3(u, w, h);
    v = median3(v, w, h);
  }
  return { w: pw, h: ph, u, v };
}

/** Bilinear RGBA sample into `out[o…o+3]`. */
function sampleRGBA(d: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Float32Array, o: number): void {
  const fx = Math.min(Math.max(x, 0), w - 1.001);
  const fy = Math.min(Math.max(y, 0), h - 1.001);
  const ix = fx | 0;
  const iy = fy | 0;
  const ax = fx - ix;
  const ay = fy - iy;
  const i = (iy * w + ix) * 4;
  const j = i + w * 4;
  const w00 = (1 - ax) * (1 - ay);
  const w10 = ax * (1 - ay);
  const w01 = (1 - ax) * ay;
  const w11 = ax * ay;
  for (let c = 0; c < 4; c++) out[o + c] = w00 * d[i + c] + w10 * d[i + 4 + c] + w01 * d[j + c] + w11 * d[j + 4 + c];
}

/** Both flows of a pair of frames, and how sure each pixel is to be seen in the other frame (0-1). */
export interface FlowPair {
  ab: Flow;
  ba: Flow;
  seenA: Float32Array;
  seenB: Float32Array;
}

/** A pixel is seen in the other frame when going there and back lands where it started (within a few px). */
function seen(f: Flow, back: Flow): Float32Array {
  const out = new Float32Array(f.w * f.h);
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      const tx = x + f.u[i];
      const ty = y + f.v[i];
      if (tx < 0 || ty < 0 || tx > f.w - 1 || ty > f.h - 1) continue;
      const ex = f.u[i] + sample(back.u, back.w, back.h, tx, ty);
      const ey = f.v[i] + sample(back.v, back.w, back.h, tx, ty);
      out[i] = Math.exp(-(ex * ex + ey * ey) / 32);
    }
  }
  return out;
}

export function flowPair(ab: Flow, ba: Flow): FlowPair {
  return { ab, ba, seenA: seen(ab, ba), seenB: seen(ba, ab) };
}

/** From each pixel of the picture at time t (0 = a, 1 = b) back to a and on to b, at the flows' size, and how visible. */
export interface TimeFlows {
  w: number;
  h: number;
  u0: Float32Array;
  v0: Float32Array;
  u1: Float32Array;
  v1: Float32Array;
  /** How much a (and b) can be trusted there (0 = covered in that frame). */
  vis0: Float32Array;
  vis1: Float32Array;
}

/**
 * Moves the pixels of one frame `k` of the way along their motion and leaves behind, at each place they land, the
 * way back: places nobody lands on (uncovered later) get visibility 0. Pixels that are seen in both frames count
 * most, so a moving player covering the background wins over the background it covers.
 */
function project(f: Flow, sure: Float32Array, k: number): { u: Float32Array; v: Float32Array; vis: Float32Array } {
  const { w, h } = f;
  const n = w * h;
  const su = new Float32Array(n);
  const sv = new Float32Array(n);
  const sw = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const fx = x + k * f.u[i];
      const fy = y + k * f.v[i];
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const ax = fx - ix;
      const ay = fy - iy;
      const wt = 0.02 + sure[i];
      const bu = -k * f.u[i];
      const bv = -k * f.v[i];
      for (let j = 0; j < 4; j++) {
        const nx = ix + (j & 1);
        const ny = iy + (j >> 1);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const bw = wt * ((j & 1 ? ax : 1 - ax) * (j >> 1 ? ay : 1 - ay));
        const o = ny * w + nx;
        sw[o] += bw;
        su[o] += bw * bu;
        sv[o] += bw * bv;
      }
    }
  }
  const vis = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    if (sw[o] > 1e-4) {
      su[o] /= sw[o];
      sv[o] /= sw[o];
    }
    vis[o] = Math.min(1, sw[o] / 0.3);
  }
  return { u: su, v: sv, vis };
}

export function flowsAt(p: FlowPair, t: number): TimeFlows {
  const { w, h } = p.ab;
  const a = project(p.ab, p.seenA, t);
  const b = project(p.ba, p.seenB, 1 - t);
  // where neither frame lands, the plain approximation fills in
  for (let i = 0; i < w * h; i++) {
    if (a.vis[i] > 0.05 || b.vis[i] > 0.05) continue;
    a.u[i] = -(1 - t) * t * p.ab.u[i] + t * t * p.ba.u[i];
    a.v[i] = -(1 - t) * t * p.ab.v[i] + t * t * p.ba.v[i];
    b.u[i] = (1 - t) * (1 - t) * p.ab.u[i] - t * (1 - t) * p.ba.u[i];
    b.v[i] = (1 - t) * (1 - t) * p.ab.v[i] - t * (1 - t) * p.ba.v[i];
    a.vis[i] = b.vis[i] = 1;
  }
  return { w, h, u0: a.u, v0: a.v, u1: b.u, v1: b.v, vis0: a.vis, vis1: b.vis };
}

/**
 * The picture `t` (0-1) of the way from `a` to `b` (RGBA, w × h, any size): each pixel is fetched from both frames
 * along the motion and mixed by nearness and by how visible it is in each — what only one frame shows comes from that
 * frame, and where the two still disagree the nearer frame wins, so edges stay clean instead of doubled.
 */
export function interpolateAt(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, f: TimeFlows, t: number, out?: Uint8ClampedArray<ArrayBuffer>): Uint8ClampedArray<ArrayBuffer> {
  const res = out ?? new Uint8ClampedArray(w * h * 4);
  const sx = w / f.w;
  const sy = h / f.h;
  const px = new Float32Array(8);
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / sy - 0.5;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / sx - 0.5;
      const u0 = sample(f.u0, f.w, f.h, fx, fy) * sx;
      const v0 = sample(f.v0, f.w, f.h, fx, fy) * sy;
      const u1 = sample(f.u1, f.w, f.h, fx, fy) * sx;
      const v1 = sample(f.v1, f.w, f.h, fx, fy) * sy;
      const s0 = sample(f.vis0, f.w, f.h, fx, fy);
      const s1 = sample(f.vis1, f.w, f.h, fx, fy);
      sampleRGBA(a, w, h, x + u0, y + v0, px, 0);
      sampleRGBA(b, w, h, x + u1, y + v1, px, 4);
      let wa = (1 - t) * s0;
      let wb = t * s1;
      const diff = Math.abs(px[0] - px[4]) + Math.abs(px[1] - px[5]) + Math.abs(px[2] - px[6]);
      if (diff > 60) {
        // still far apart: lean on the nearer frame
        const k = Math.min(1, (diff - 60) / 120);
        if (t < 0.5) wb *= 1 - k;
        else wa *= 1 - k;
      }
      const sum = wa + wb;
      const ka = sum > 1e-6 ? wa / sum : t < 0.5 ? 1 : 0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) res[o + c] = ka * px[c] + (1 - ka) * px[4 + c];
    }
  }
  return res;
}

/** One frame in between, from the two flows (at any lower resolution). */
export function interpolateFrames(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, ab: Flow, ba: Flow, t: number, out?: Uint8ClampedArray<ArrayBuffer>): Uint8ClampedArray<ArrayBuffer> {
  return interpolateAt(a, b, w, h, flowsAt(flowPair(ab, ba), t), t, out);
}
