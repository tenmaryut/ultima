import type { Lut3D } from './grade';
import { sampleLut } from './grade';

/*
 * Per-pixel effects of one picture: color grade (a baked 3D LUT), white balance, chroma key,
 * sharpen, RGB split, vignette, film grain and luma fades. A WebGL2 shader does the work; without
 * WebGL the same math runs on the CPU (slower, same result). The preview and the export share it.
 */

export interface PixelParams {
  /** Baked color grade, or null. */
  lut: Lut3D | null;
  /** White balance −100 (cool) … 100 (warm). */
  temperature: number;
  /** 0-1 */
  sharpen: number;
  /** Red/blue offset in output pixels. */
  split: { x: number; y: number } | null;
  /** 0-1 */
  grain: number;
  /** Changes the grain pattern (per frame). */
  seed: number;
  /** 0-1 */
  vignette: number;
  /** Key color 0-255 with similarity / smoothness 0-1. */
  chroma: { r: number; g: number; b: number; similarity: number; smoothness: number } | null;
  /** Luma fade: visible where brighter than `threshold`. */
  luma: { threshold: number; softness: number } | null;
}

export const NO_PIXELS: PixelParams = { lut: null, temperature: 0, sharpen: 0, split: null, grain: 0, seed: 0, vignette: 0, chroma: null, luma: null };

/** True when the parameters change any pixel. */
export function pixelWork(p: PixelParams): boolean {
  return Boolean(p.lut || p.temperature || p.sharpen > 0 || (p.split && (p.split.x || p.split.y)) || p.grain > 0 || p.vignette > 0 || p.chroma || p.luma);
}

/* ------------------------------- Shared math ------------------------------- */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};

/** Channel multipliers of the white balance (as in the earlier CPU version). */
export function temperatureGains(amount: number): [number, number, number] {
  const k = Math.max(-1, Math.min(1, amount / 100));
  return [1 + 0.22 * k, 1 + 0.04 * k, 1 - 0.22 * k];
}

/** Chroma key thresholds in CbCr distance and the key's strongest channel. */
export function chromaThresholds(similarity: number, smoothness: number): [number, number] {
  const t0 = Math.max(0, similarity) * 0.6;
  return [t0, t0 + Math.max(0.005, smoothness * 0.3)];
}

const cb = (r: number, g: number, b: number) => -0.168736 * r - 0.331264 * g + 0.5 * b;
const cr = (r: number, g: number, b: number) => 0.5 * r - 0.418688 * g - 0.081312 * b;

/** Grain noise −0.5…0.5 of a pixel (same pattern as the shader is not needed — only the look). */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5;
}

/**
 * The CPU version: applies the effects to RGBA pixels in place (`data` is width × height, straight
 * alpha). Used without WebGL and in tests.
 */
export function applyPixels(data: Uint8ClampedArray, width: number, height: number, p: PixelParams): void {
  const src = p.split || p.sharpen > 0 ? new Uint8ClampedArray(data) : data;
  const at = (x: number, y: number) => (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
  const [gr, gg, gb] = temperatureGains(p.temperature);
  const key = p.chroma ? { cb: cb(p.chroma.r, p.chroma.g, p.chroma.b) / 255, cr: cr(p.chroma.r, p.chroma.g, p.chroma.b) / 255, t: chromaThresholds(p.chroma.similarity, p.chroma.smoothness), dom: p.chroma.g >= p.chroma.r && p.chroma.g >= p.chroma.b ? 1 : p.chroma.b >= p.chroma.r ? 2 : 0 } : null;
  const sx = p.split ? Math.round(p.split.x) : 0;
  const sy = p.split ? Math.round(p.split.y) : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = src[i] / 255;
      let g = src[i + 1] / 255;
      let b = src[i + 2] / 255;
      let a = src[i + 3] / 255;
      if (sx || sy) {
        const ir = at(x - sx, y - sy);
        const ib = at(x + sx, y + sy);
        r = src[ir] / 255;
        b = src[ib + 2] / 255;
        a = Math.max(a, src[ir + 3] / 255, src[ib + 3] / 255);
      }
      if (p.sharpen > 0) {
        const n = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
        const k = p.sharpen * 1.5;
        r += k * (r - n.reduce((s, j) => s + src[j], 0) / 1020);
        g += k * (g - n.reduce((s, j) => s + src[j + 1], 0) / 1020);
        b += k * (b - n.reduce((s, j) => s + src[j + 2], 0) / 1020);
        r = clamp01(r);
        g = clamp01(g);
        b = clamp01(b);
      }
      if (key) {
        const d = Math.hypot(cb(r, g, b) - key.cb, cr(r, g, b) - key.cr);
        const [t0, t1] = key.t;
        if (d < t1 + 0.08) {
          a *= d < t0 ? 0 : d < t1 ? smoothstep(0, 1, (d - t0) / (t1 - t0)) : 1;
          const k = clamp01((d - t0) / (t1 + 0.08 - t0));
          if (key.dom === 1) {
            const o = Math.max(r, b);
            if (g > o) g = o + (g - o) * k;
          } else if (key.dom === 2) {
            const o = Math.max(r, g);
            if (b > o) b = o + (b - o) * k;
          } else {
            const o = Math.max(g, b);
            if (r > o) r = o + (r - o) * k;
          }
        }
      }
      if (p.temperature) {
        r = clamp01(r * gr);
        g = clamp01(g * gg);
        b = clamp01(b * gb);
      }
      if (p.lut) [r, g, b] = sampleLut(p.lut, r, g, b);
      if (p.vignette > 0) {
        const dx = ((x + 0.5) / width - 0.5) * 2;
        const dy = ((y + 0.5) / height - 0.5) * 2;
        const f = 1 - p.vignette * smoothstep(0.35, 1, Math.hypot(dx, dy) / Math.SQRT2);
        r *= f;
        g *= f;
        b *= f;
      }
      if (p.grain > 0) {
        const n = noise(x, y, p.seed) * p.grain * 0.35;
        r = clamp01(r + n);
        g = clamp01(g + n);
        b = clamp01(b + n);
      }
      if (p.luma) a *= smoothstep(p.luma.threshold - p.luma.softness, p.luma.threshold + p.luma.softness, 0.2126 * r + 0.7152 * g + 0.0722 * b);
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
      data[i + 3] = a * 255;
    }
  }
}

/* --------------------------------- WebGL2 --------------------------------- */

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler3D u_lut;
uniform vec4 u_rect;
uniform vec2 u_px;
uniform vec2 u_out;
uniform float u_lutOn;
uniform float u_lutSize;
uniform vec3 u_temp;
uniform float u_sharpen;
uniform vec2 u_split;
uniform float u_grain;
uniform float u_seed;
uniform float u_vignette;
uniform float u_keyOn;
uniform vec2 u_key;
uniform vec3 u_keyParams;
uniform float u_lumaOn;
uniform vec2 u_luma;

vec4 src(vec2 uv) {
  return texture(u_src, u_rect.xy + clamp(uv, vec2(0.0), vec2(1.0)) * u_rect.zw);
}
vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 uv = v_uv;
  vec4 c = src(uv);
  if (u_split.x != 0.0 || u_split.y != 0.0) {
    vec4 r = src(uv - u_split);
    vec4 b = src(uv + u_split);
    c = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  }
  if (u_sharpen > 0.0) {
    vec3 n = src(uv + vec2(u_px.x, 0.0)).rgb + src(uv - vec2(u_px.x, 0.0)).rgb + src(uv + vec2(0.0, u_px.y)).rgb + src(uv - vec2(0.0, u_px.y)).rgb;
    c.rgb = clamp(c.rgb + u_sharpen * 1.5 * (c.rgb - n * 0.25), 0.0, 1.0);
  }
  if (u_keyOn > 0.5) {
    float d = distance(cbcr(c.rgb), u_key);
    float t0 = u_keyParams.x;
    float t1 = u_keyParams.y;
    if (d < t1 + 0.08) {
      c.a *= d < t0 ? 0.0 : (d < t1 ? smoothstep(0.0, 1.0, (d - t0) / (t1 - t0)) : 1.0);
      float k = clamp((d - t0) / (t1 + 0.08 - t0), 0.0, 1.0);
      if (u_keyParams.z > 1.5) { float m = max(c.r, c.g); if (c.b > m) c.b = m + (c.b - m) * k; }
      else if (u_keyParams.z > 0.5) { float m = max(c.r, c.b); if (c.g > m) c.g = m + (c.g - m) * k; }
      else { float m = max(c.g, c.b); if (c.r > m) c.r = m + (c.r - m) * k; }
    }
  }
  c.rgb = clamp(c.rgb * u_temp, 0.0, 1.0);
  if (u_lutOn > 0.5) {
    c.rgb = texture(u_lut, c.rgb * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize).rgb;
  }
  if (u_vignette > 0.0) {
    vec2 d = (uv - 0.5) * 2.0;
    c.rgb *= 1.0 - u_vignette * smoothstep(0.35, 1.0, length(d) / 1.41421356);
  }
  if (u_grain > 0.0) {
    float g = hash(floor(uv * u_out) + u_seed * 17.0) - 0.5;
    c.rgb = clamp(c.rgb + g * u_grain * 0.35, 0.0, 1.0);
  }
  if (u_lumaOn > 0.5) {
    c.a *= smoothstep(u_luma.x - u_luma.y, u_luma.x + u_luma.y, dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)));
  }
  o = vec4(c.rgb * c.a, c.a);
}`;

interface GLState {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  src: WebGLTexture;
  lut: WebGLTexture;
  lutData: Float32Array | null;
  uniforms: Record<string, WebGLUniformLocation | null>;
  maxTexture: number;
}

let glState: GLState | null = null;
let glFailed = false;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
  return sh;
}

function setupGL(): GLState | null {
  if (glState) return glState;
  if (glFailed || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('no WebGL2');
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const texture = (unit: number, target: number) => {
      const tex = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, tex);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const src = texture(0, gl.TEXTURE_2D);
    const lut = texture(1, gl.TEXTURE_3D);
    // a 2×2×2 identity table until a grade is used, so the sampler is always complete
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, 2, 2, 2, 0, gl.RGB, gl.FLOAT, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]));
    const names = ['u_src', 'u_lut', 'u_rect', 'u_px', 'u_out', 'u_lutOn', 'u_lutSize', 'u_temp', 'u_sharpen', 'u_split', 'u_grain', 'u_seed', 'u_vignette', 'u_keyOn', 'u_key', 'u_keyParams', 'u_lumaOn', 'u_luma'];
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) uniforms[n] = gl.getUniformLocation(program, n);
    gl.uniform1i(uniforms.u_src, 0);
    gl.uniform1i(uniforms.u_lut, 1);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      glState = null;
    });
    glState = { canvas, gl, program, src, lut, lutData: null, uniforms, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };
    return glState;
  } catch {
    glFailed = true;
    return null;
  }
}

function sizeOf(src: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return { w: src.displayWidth, h: src.displayHeight };
  const s = src as { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  return { w: typeof s.width === 'number' ? s.width : 0, h: typeof s.height === 'number' ? s.height : 0 };
}

/** Renders pictures through the effects (one shared WebGL context, CPU fallback). */
export class PixelStage {
  private cpuCanvas: HTMLCanvasElement | null = null;
  private copy: HTMLCanvasElement | null = null;

  /** True when the GPU path is available (false means the slower CPU path). */
  static get gpu(): boolean {
    return setupGL() !== null;
  }

  /**
   * `src` cut to (sx, sy, sw, sh) and scaled to outW × outH with the effects applied. The returned
   * canvas is only valid until the next call (draw it right away).
   */
  run(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, outW: number, outH: number, p: PixelParams): HTMLCanvasElement {
    const w = Math.max(1, Math.min(4096, Math.round(outW)));
    const h = Math.max(1, Math.min(4096, Math.round(outH)));
    const st = setupGL();
    if (st && !st.gl.isContextLost()) {
      try {
        return this.gpu(st, src, sx, sy, sw, sh, w, h, p);
      } catch {
        // fall through to the CPU
      }
    }
    return this.cpu(src, sx, sy, sw, sh, w, h, p);
  }

  private gpu(st: GLState, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number, p: PixelParams): HTMLCanvasElement {
    const { gl, uniforms: u } = st;
    let source = src;
    let { w: iw, h: ih } = sizeOf(src);
    let rx = sx;
    let ry = sy;
    let rw = sw;
    let rh = sh;
    if (!iw || !ih) throw new Error('empty source');
    if (iw > st.maxTexture || ih > st.maxTexture) {
      // too big for a texture: shrink the cut-out first
      if (!this.copy) this.copy = document.createElement('canvas');
      this.copy.width = w;
      this.copy.height = h;
      this.copy.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
      source = this.copy;
      iw = w;
      ih = h;
      rx = 0;
      ry = 0;
      rw = w;
      rh = h;
    }
    if (st.canvas.width !== w || st.canvas.height !== h) {
      st.canvas.width = w;
      st.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // texture rows run bottom-up (flipped), so the cut-out is measured from the bottom
    gl.uniform4f(u.u_rect, rx / iw, 1 - (ry + rh) / ih, rw / iw, rh / ih);
    gl.uniform2f(u.u_px, 1 / w, 1 / h);
    gl.uniform2f(u.u_out, w, h);
    if (p.lut) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, st.lut);
      if (st.lutData !== p.lut.data) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, p.lut.size, p.lut.size, p.lut.size, 0, gl.RGB, gl.FLOAT, p.lut.data);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        st.lutData = p.lut.data;
      }
    }
    gl.uniform1f(u.u_lutOn, p.lut ? 1 : 0);
    gl.uniform1f(u.u_lutSize, p.lut?.size ?? 2);
    const [tr, tg, tb] = temperatureGains(p.temperature);
    gl.uniform3f(u.u_temp, tr, tg, tb);
    gl.uniform1f(u.u_sharpen, p.sharpen);
    // the split moves red one way and blue the other (in output pixels; v runs bottom-up)
    gl.uniform2f(u.u_split, p.split ? p.split.x / w : 0, p.split ? -p.split.y / h : 0);
    gl.uniform1f(u.u_grain, p.grain);
    gl.uniform1f(u.u_seed, p.seed % 997);
    gl.uniform1f(u.u_vignette, p.vignette);
    if (p.chroma) {
      const k = p.chroma;
      const [t0, t1] = chromaThresholds(k.similarity, k.smoothness);
      gl.uniform1f(u.u_keyOn, 1);
      gl.uniform2f(u.u_key, cb(k.r, k.g, k.b) / 255, cr(k.r, k.g, k.b) / 255);
      gl.uniform3f(u.u_keyParams, t0, t1, k.g >= k.r && k.g >= k.b ? 1 : k.b >= k.r ? 2 : 0);
    } else gl.uniform1f(u.u_keyOn, 0);
    gl.uniform1f(u.u_lumaOn, p.luma ? 1 : 0);
    gl.uniform2f(u.u_luma, p.luma?.threshold ?? 0, p.luma?.softness ?? 0.1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return st.canvas;
  }

  private cpu(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number, p: PixelParams): HTMLCanvasElement {
    if (!this.cpuCanvas) this.cpuCanvas = document.createElement('canvas');
    const c = this.cpuCanvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    applyPixels(img.data, w, h, p);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
