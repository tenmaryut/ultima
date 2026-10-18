import type { Clip, Project, VisualProps } from './types';

/*
 * 3D placement of a clip (the math is pure and unit tested): its picture lies on a plane that tilts (rotateX) and
 * turns (rotateY) around the clip's centre and moves away or closer (z), seen by a camera `perspective` × the frame
 * height in front of the frame centre. That is a projective map of the flat frame — a homography — which the GPU
 * (or the CPU without WebGL) uses to fetch every output pixel from the flatly drawn clip.
 */

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const has3D = (v: Pick<VisualProps, 'rotateX' | 'rotateY' | 'z'>) => Math.abs(v.rotateX) > 0.01 || Math.abs(v.rotateY) > 0.01 || Math.abs(v.z) > 0.01;

export interface Plane3D {
  rotateX: number;
  rotateY: number;
  z: number;
  /** Camera distance from the frame, project px. */
  focal: number;
  /** The point the plane turns around, project px. */
  pivot: { x: number; y: number };
  W: number;
  H: number;
}

/** Where a point of the flat frame ends up, or null when it is behind the camera. */
export function projectPoint(p: Plane3D, x: number, y: number): { x: number; y: number } | null {
  const a = (p.rotateX * Math.PI) / 180;
  const b = (p.rotateY * Math.PI) / 180;
  const X = x - p.pivot.x;
  const Y = y - p.pivot.y;
  // tilt: the top goes away for positive angles
  const y1 = Y * Math.cos(a);
  const z1 = -Y * Math.sin(a);
  // turn: the right side goes away for positive angles
  const x2 = X * Math.cos(b) - z1 * Math.sin(b);
  const z2 = X * Math.sin(b) + z1 * Math.cos(b) + p.z;
  const d = p.focal + z2;
  if (d <= p.focal * 0.02) return null;
  const k = p.focal / d;
  return { x: p.W / 2 + (p.pivot.x + x2 - p.W / 2) * k, y: p.H / 2 + (p.pivot.y + y1 - p.H / 2) * k };
}

/** Solves the 8×8 system of a homography through four point pairs. */
function solveHomography(src: { x: number; y: number }[], dst: { x: number; y: number }[]): Mat3 | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let best = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r;
    if (Math.abs(A[best][c]) < 1e-12) return null;
    [A[c], A[best]] = [A[best], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** The homography of a plane: from the flat frame (project px) to where the camera sees it. */
export function planeHomography(p: Plane3D): Mat3 | null {
  const r = Math.max(p.W, p.H) / 4;
  const src = [
    { x: p.pivot.x - r, y: p.pivot.y - r },
    { x: p.pivot.x + r, y: p.pivot.y - r },
    { x: p.pivot.x + r, y: p.pivot.y + r },
    { x: p.pivot.x - r, y: p.pivot.y + r },
  ];
  const dst = src.map((q) => projectPoint(p, q.x, q.y));
  if (dst.some((q) => !q)) return null;
  return solveHomography(src, dst as { x: number; y: number }[]);
}

export function applyHomography(m: Mat3, x: number, y: number): { x: number; y: number } | null {
  const w = m[6] * x + m[7] * y + m[8];
  if (Math.abs(w) < 1e-12) return null;
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** The point a clip turns around in 3D: a picture's centre, a title's anchor. */
export function pivotOf(p: Project, c: Clip, v: VisualProps): { x: number; y: number } {
  const { width: W, height: H } = p.settings;
  if (c.kind === 'title' && c.title) {
    const rad = (v.rotation * Math.PI) / 180;
    const ax = (c.title.x - 0.5) * W * v.scale;
    const ay = (c.title.y - 0.5) * H * v.scale;
    return { x: W / 2 + v.x + ax * Math.cos(rad) - ay * Math.sin(rad), y: H / 2 + v.y + ax * Math.sin(rad) + ay * Math.cos(rad) };
  }
  return { x: W / 2 + v.x, y: H / 2 + v.y };
}

/** The homography of a clip with the given look, or null when it is flat (or seen edge-on / from behind). */
export function clipHomography(p: Project, c: Clip, v: VisualProps): Mat3 | null {
  if (!has3D(v)) return null;
  const { width: W, height: H } = p.settings;
  return planeHomography({ rotateX: v.rotateX, rotateY: v.rotateY, z: v.z, focal: Math.max(0.2, v.perspective) * H, pivot: pivotOf(p, c, v), W, H });
}

/* --------------------------------- Drawing --------------------------------- */

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D u_src;
uniform mat3 u_inv;
uniform vec2 u_size;
uniform float u_scale;
void main() {
  // output pixel → project px (top-left origin) → the flat picture → texture coordinates (rows bottom-up)
  vec2 q = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_scale;
  vec3 s = u_inv * vec3(q, 1.0);
  if (s.z <= 0.0) { o = vec4(0.0); return; }
  vec2 uv = (s.xy / s.z) * u_scale / u_size;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.0); return; }
  o = texture(u_src, vec2(uv.x, 1.0 - uv.y));
}`;

interface WarpGL {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  tex: WebGLTexture;
  u: Record<string, WebGLUniformLocation | null>;
}

let warpGL: WarpGL | null = null;
let warpFailed = false;

function setupWarp(): WarpGL | null {
  if (warpGL && !warpGL.gl.isContextLost()) return warpGL;
  if (warpFailed || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('no WebGL2');
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // mipmaps keep a plane seen at a steep angle from shimmering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of ['u_src', 'u_inv', 'u_size', 'u_scale']) u[n] = gl.getUniformLocation(program, n);
    gl.uniform1i(u.u_src, 0);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      warpGL = null;
    });
    warpGL = { canvas, gl, tex, u };
    return warpGL;
  } catch {
    warpFailed = true;
    return null;
  }
}

/** Draws a frame-sized picture through a homography (GPU, or CPU without WebGL). */
export class WarpStage {
  private cpuCanvas: HTMLCanvasElement | null = null;

  /**
   * `src` (a canvas of the frame at `scale` px per project px) seen through `m` (project px → project px); the
   * returned canvas, the same size, is only valid until the next call.
   */
  run(src: HTMLCanvasElement, m: Mat3, scale: number): HTMLCanvasElement {
    const inv = invert3(m);
    const st = setupWarp();
    if (inv && st) {
      try {
        return this.gpu(st, src, inv, scale);
      } catch {
        // fall through to the CPU
      }
    }
    return this.cpu(src, inv, scale);
  }

  private gpu(st: WarpGL, src: HTMLCanvasElement, inv: Mat3, scale: number): HTMLCanvasElement {
    const { gl, u } = st;
    const w = src.width;
    const h = src.height;
    if (st.canvas.width !== w || st.canvas.height !== h) {
      st.canvas.width = w;
      st.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    // GLSL matrices are column-major
    gl.uniformMatrix3fv(u.u_inv, false, [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
    gl.uniform2f(u.u_size, w, h);
    gl.uniform1f(u.u_scale, scale);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return st.canvas;
  }

  private cpu(src: HTMLCanvasElement, inv: Mat3 | null, scale: number): HTMLCanvasElement {
    const w = src.width;
    const h = src.height;
    if (!this.cpuCanvas) this.cpuCanvas = document.createElement('canvas');
    const out = this.cpuCanvas;
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d')!;
    if (!inv) return out;
    const from = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    const img = octx.createImageData(w, h);
    warpPixels(from, img.data, w, h, inv, scale);
    octx.putImageData(img, 0, 0);
    return out;
  }
}

/** The CPU path (and the reference for tests): every output pixel fetched from `src` through `inv`, bilinear. */
export function warpPixels(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, inv: Mat3, scale: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const qx = (x + 0.5) / scale;
      const qy = (y + 0.5) / scale;
      const sw = inv[6] * qx + inv[7] * qy + inv[8];
      const o = (y * w + x) * 4;
      if (sw <= 0) continue;
      const fx = ((inv[0] * qx + inv[1] * qy + inv[2]) / sw) * scale - 0.5;
      const fy = ((inv[3] * qx + inv[4] * qy + inv[5]) / sw) * scale - 0.5;
      if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) continue;
      const ix = Math.max(0, Math.min(w - 2, Math.floor(fx)));
      const iy = Math.max(0, Math.min(h - 2, Math.floor(fy)));
      const ax = Math.min(1, Math.max(0, fx - ix));
      const ay = Math.min(1, Math.max(0, fy - iy));
      const i = (iy * w + ix) * 4;
      const j = i + w * 4;
      // mixed with their alpha, so transparent neighbours don't darken the edges
      const k00 = (1 - ax) * (1 - ay) * src[i + 3];
      const k10 = ax * (1 - ay) * src[i + 7];
      const k01 = (1 - ax) * ay * src[j + 3];
      const k11 = ax * ay * src[j + 7];
      const a = k00 + k10 + k01 + k11;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) dst[o + c] = (k00 * src[i + c] + k10 * src[i + 4 + c] + k01 * src[j + c] + k11 * src[j + 4 + c]) / a;
      dst[o + 3] = a;
    }
  }
}
