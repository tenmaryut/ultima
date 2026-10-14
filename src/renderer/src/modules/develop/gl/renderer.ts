/**
 * WebGL2 develop pipeline.
 *
 *   source (RGBA8) ─▶ noise reduction (2 passes) ─▶ sharpening (2 passes) ─▶ base
 *   base ─▶ luminance + dark channel (mipmapped) ─▶ texture blur (2 passes)
 *                                              └─▶ downsampled clarity/dehaze blur (2 passes)
 *   final pass: geometry (crop / straighten / rotate / flip) + all color math → canvas or FBO
 *
 * The source passes are cached per pipeline and only re-run when their inputs change, so
 * most slider drags only re-run the final pass.
 */
import { LUT_SIZE } from '../curve';
import { compose, scale, translate, type Affine, type Rect } from '../geometry';
import type { DevelopSettings } from '../params';
import { finalUniforms, passParams, sourcePassKey, type FinalUniforms, type PassParams } from '../pipeline';
import type { Vec3 } from '../color';
import { BLUR, FINAL, LUM, NR, SHARPEN_H, SHARPEN_V, VERTEX } from './shaders';

interface Program {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  hdr: boolean;
  mips: boolean;
}

type TargetName = 'nrTmp' | 'den' | 'shTmp' | 'sharp' | 'lum' | 'texTmp' | 'texBlur' | 'lowTmp' | 'lowBlur' | 'out';

/** A set of GPU textures for one use (preview, detail view, thumbnails/export). */
export class Pipeline {
  src: WebGLTexture | null = null;
  srcW = 0;
  srcH = 0;
  srcKey = '';
  passKey = '';
  base: WebGLTexture | null = null;
  hasTexBlur = false;
  hasLow = false;
  generation = -1;
  targets: Partial<Record<TargetName, Target>> = {};
}

export interface RenderJob {
  settings: DevelopSettings;
  /** Precomputed uniforms (optional; computed from settings otherwise). */
  uniforms?: FinalUniforms;
  atmos: Vec3;
  /** Long edge of the full-resolution source (for relative blur radii). */
  fullLong: number;
  /** Full-resolution source rect covered by the pipeline's source texture. */
  srcRect: Rect;
  /** Source texture px per full-resolution px. */
  srcScale: number;
  /** Output px (full res) → source px (full res). */
  outToSrc: Affine;
  /** Full-resolution output size (for the vignette / grain). */
  outW: number;
  outH: number;
  /** Region of the output to render (full-resolution output px). */
  region: Rect;
  /** Target px per full-resolution output px. */
  outScale: number;
  /** Target size in px. */
  width: number;
  height: number;
  toCanvas: boolean;
  /** Before/after split: x (0..1 of the output) left of which the original is shown; 0 = off, ≥1 = all before. */
  split?: number;
  clip?: boolean;
  /** Vignette + grain (off while editing the crop). */
  effects?: boolean;
  /** Transparent pixels outside the image (crop editing) instead of clamping. */
  fillOutside?: boolean;
}

export class WebGLUnavailableError extends Error {}

export class DevelopRenderer {
  readonly canvas: HTMLCanvasElement;
  gl!: WebGL2RenderingContext;
  hdr = false;
  maxTexture = 4096;
  generation = 0;
  lost = false;
  onRestored: (() => void) | null = null;
  private programs!: Record<'nr' | 'sharpH' | 'sharpV' | 'lum' | 'blur' | 'final', Program>;
  private lut!: WebGLTexture;
  private lutData: Float32Array | null = null;
  private vao!: WebGLVertexArrayObject;
  private dummy!: WebGLTexture;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      try {
        this.init();
        this.lost = false;
        this.onRestored?.();
      } catch {
        // stays lost
      }
    });
    this.init();
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new WebGLUnavailableError('WebGL 2 is not available');
    this.gl = gl;
    this.hdr = Boolean(gl.getExtension('EXT_color_buffer_float'));
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.programs = {
      nr: this.compile(NR),
      sharpH: this.compile(SHARPEN_H),
      sharpV: this.compile(SHARPEN_V),
      lum: this.compile(LUM),
      blur: this.compile(BLUR),
      final: this.compile(FINAL),
    };
    this.vao = gl.createVertexArray()!;
    this.lut = this.texture(LUT_SIZE, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    this.lutData = null;
    this.dummy = this.texture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.generation++;
  }

  private compile(fragment: string): Program {
    const gl = this.gl;
    const make = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`Shader compile error: ${log}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    const vs = make(gl.VERTEX_SHADER, VERTEX);
    const fs = make(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Shader link error: ${gl.getProgramInfoLog(prog)}`);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { prog, loc: new Map() };
  }

  private texture(w: number, h: number, internal: number, format: number, type: number, filter: number, mips = false): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(pl: Pipeline, name: TargetName, w: number, h: number, hdr: boolean, mips = false): Target {
    const gl = this.gl;
    const existing = pl.targets[name];
    if (existing && existing.w === w && existing.h === h && existing.hdr === hdr && existing.mips === mips) return existing;
    if (existing) {
      gl.deleteTexture(existing.tex);
      gl.deleteFramebuffer(existing.fbo);
    }
    const useHdr = hdr && this.hdr;
    const tex = this.texture(w, h, useHdr ? gl.RGBA16F : gl.RGBA8, gl.RGBA, useHdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, gl.LINEAR, mips);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) throw new Error(`Framebuffer incomplete (${status})`);
    const t: Target = { tex, fbo, w, h, hdr, mips };
    pl.targets[name] = t;
    return t;
  }

  /** Frees a pipeline's GPU memory. */
  releasePipeline(pl: Pipeline): void {
    const gl = this.gl;
    if (pl.generation === this.generation) {
      if (pl.src) gl.deleteTexture(pl.src);
      for (const t of Object.values(pl.targets)) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    pl.src = null;
    pl.targets = {};
    pl.srcKey = '';
    pl.passKey = '';
    pl.srcW = pl.srcH = 0;
  }

  private sync(pl: Pipeline): void {
    if (pl.generation !== this.generation) {
      pl.src = null;
      pl.targets = {};
      pl.srcKey = '';
      pl.passKey = '';
      pl.generation = this.generation;
    }
  }

  /** Uploads the source image of a pipeline (skipped when `key` is unchanged). */
  setSource(pl: Pipeline, image: TexImageSource, width: number, height: number, key: string): void {
    this.sync(pl);
    if (pl.src && pl.srcKey === key && pl.srcW === width && pl.srcH === height) return;
    const gl = this.gl;
    if (!pl.src) pl.src = this.texture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, true);
    gl.bindTexture(gl.TEXTURE_2D, pl.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    pl.srcW = width;
    pl.srcH = height;
    pl.srcKey = key;
    pl.passKey = '';
  }

  hasSource(pl: Pipeline, key: string): boolean {
    return pl.generation === this.generation && Boolean(pl.src) && pl.srcKey === key;
  }

  /* ------------------------------ uniforms ------------------------------ */

  private loc(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.loc.has(name)) p.loc.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.loc.get(name) ?? null;
  }

  private run(p: Program, target: Target | null, w: number, h: number, textures: [string, WebGLTexture][], set: (u: UniformSetter) => void): void {
    const gl = this.gl;
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    textures.forEach(([name, tex], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.loc(p, name), unit);
    });
    const u: UniformSetter = {
      f: (n, v) => gl.uniform1f(this.loc(p, n), v),
      i: (n, v) => gl.uniform1i(this.loc(p, n), v),
      b: (n, v) => gl.uniform1i(this.loc(p, n), v ? 1 : 0),
      v2: (n, x, y) => gl.uniform2f(this.loc(p, n), x, y),
      v3: (n, v) => gl.uniform3f(this.loc(p, n), v[0], v[1], v[2]),
      v4: (n, v) => gl.uniform4f(this.loc(p, n), v[0], v[1], v[2], v[3]),
      fv: (n, v) => gl.uniform1fv(this.loc(p, n), v),
      m3: (n, v) => gl.uniformMatrix3fv(this.loc(p, n), false, v),
    };
    set(u);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* --------------------------- source passes --------------------------- */

  private sourcePasses(pl: Pipeline, pp: PassParams): void {
    const key = `${sourcePassKey(pp)}#${pl.srcKey}`;
    if (pl.passKey === key && pl.base) return;
    const gl = this.gl;
    const w = pl.srcW;
    const h = pl.srcH;
    let base = pl.src!;

    if (pp.nrLumaSigma || pp.nrChromaSigma) {
      const tmp = this.target(pl, 'nrTmp', w, h, true);
      const den = this.target(pl, 'den', w, h, true, true);
      const radius = Math.min(40, Math.ceil(3 * Math.max(pp.nrLumaSigma, pp.nrChromaSigma)));
      const common = (u: UniformSetter) => {
        u.v2('uSize', w, h);
        u.f('uSigmaL', pp.nrLumaSigma);
        u.f('uSigmaC', pp.nrChromaSigma);
        u.f('uRange', pp.nrRangeSigma);
        u.i('uRadius', radius);
        u.f('uAmtL', pp.nrLumaSigma ? pp.nrLumaAmount : 0);
        u.f('uAmtC', pp.nrChromaSigma ? pp.nrChromaAmount : 0);
      };
      this.run(this.programs.nr, tmp, w, h, [['uTex', base], ['uOrig', base]], (u) => {
        common(u);
        u.v2('uDir', 1 / w, 0);
        u.i('uPhase', 0);
      });
      this.run(this.programs.nr, den, w, h, [['uTex', tmp.tex], ['uOrig', base]], (u) => {
        common(u);
        u.v2('uDir', 0, 1 / h);
        u.i('uPhase', 1);
      });
      gl.bindTexture(gl.TEXTURE_2D, den.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      base = den.tex;
    }

    if (pp.sharpenSigma) {
      const tmp = this.target(pl, 'shTmp', w, h, true);
      const out = this.target(pl, 'sharp', w, h, true, true);
      const radius = Math.min(24, Math.ceil(3 * pp.sharpenSigma));
      this.run(this.programs.sharpH, tmp, w, h, [['uTex', base]], (u) => {
        u.v2('uSize', w, h);
        u.v2('uDir', 1 / w, 0);
        u.f('uSigma', pp.sharpenSigma);
        u.i('uRadius', radius);
      });
      this.run(this.programs.sharpV, out, w, h, [['uBlurH', tmp.tex], ['uBase', base]], (u) => {
        u.v2('uSize', w, h);
        u.v2('uDir', 0, 1 / h);
        u.f('uSigma', pp.sharpenSigma);
        u.i('uRadius', radius);
        u.f('uAmount', pp.sharpenAmount);
        u.f('uDetail', pp.sharpenDetail);
        u.f('uMasking', pp.sharpenMasking);
      });
      gl.bindTexture(gl.TEXTURE_2D, out.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      base = out.tex;
    }
    pl.base = base;

    const needLow = pp.claritySigma > 0;
    const lum = this.target(pl, 'lum', w, h, true, true);
    this.run(this.programs.lum, lum, w, h, [['uTex', base]], (u) => u.v2('uSize', w, h));
    gl.bindTexture(gl.TEXTURE_2D, lum.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    if (pp.textureSigma) {
      const tmp = this.target(pl, 'texTmp', w, h, true);
      const out = this.target(pl, 'texBlur', w, h, true);
      const radius = Math.min(40, Math.ceil(3 * pp.textureSigma));
      this.run(this.programs.blur, tmp, w, h, [['uTex', lum.tex]], (u) => {
        u.v2('uSize', w, h);
        u.v2('uDir', 1 / w, 0);
        u.f('uSigma', pp.textureSigma);
        u.i('uRadius', radius);
        u.f('uLod', 0);
      });
      this.run(this.programs.blur, out, w, h, [['uTex', tmp.tex]], (u) => {
        u.v2('uSize', w, h);
        u.v2('uDir', 0, 1 / h);
        u.f('uSigma', pp.textureSigma);
        u.i('uRadius', radius);
        u.f('uLod', 0);
      });
    }

    if (needLow) {
      const f = pp.lowFactor;
      const lw = Math.max(1, Math.ceil(w / f));
      const lh = Math.max(1, Math.ceil(h / f));
      const sigma = Math.max(0.6, pp.claritySigma / f);
      const radius = Math.min(40, Math.ceil(3 * sigma));
      const tmp = this.target(pl, 'lowTmp', lw, lh, true);
      const out = this.target(pl, 'lowBlur', lw, lh, true);
      this.run(this.programs.blur, tmp, lw, lh, [['uTex', lum.tex]], (u) => {
        u.v2('uSize', lw, lh);
        u.v2('uDir', 1 / lw, 0);
        u.f('uSigma', sigma);
        u.i('uRadius', radius);
        u.f('uLod', Math.log2(f));
      });
      this.run(this.programs.blur, out, lw, lh, [['uTex', tmp.tex]], (u) => {
        u.v2('uSize', lw, lh);
        u.v2('uDir', 0, 1 / lh);
        u.f('uSigma', sigma);
        u.i('uRadius', radius);
        u.f('uLod', 0);
      });
    }
    pl.hasTexBlur = Boolean(pp.textureSigma);
    pl.hasLow = needLow;
    pl.passKey = key;
  }

  private updateLut(u: FinalUniforms): void {
    if (!u.curveActive) return;
    if (this.lutData && this.lutData.length === u.lut.length && this.lutData.every((v, i) => v === u.lut[i])) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, u.lut);
    this.lutData = u.lut.slice();
  }

  /* ------------------------------- render ------------------------------- */

  /** Runs the pipeline for a job. Canvas jobs draw into `this.canvas`; others into an FBO (see readPixels). */
  render(pl: Pipeline, job: RenderJob): void {
    if (this.lost || this.gl.isContextLost()) throw new Error('The graphics context was lost');
    this.sync(pl);
    if (!pl.src) throw new Error('No source image');
    const s = job.settings;
    const u = job.uniforms ?? finalUniforms(s, job.atmos);
    this.sourcePasses(pl, passParams(s, job.srcScale, job.fullLong));
    this.updateLut(u);

    const toFullOut = compose(translate(job.region.x, job.region.y), scale(1 / job.outScale));
    const toUv = compose(scale(1 / job.srcRect.w, 1 / job.srcRect.h), translate(-job.srcRect.x, -job.srcRect.y));
    const m = compose(toUv, compose(job.outToSrc, toFullOut));
    const map = new Float32Array([m.a, m.b, 0, m.c, m.d, 0, m.e, m.f, 1]);
    const wb = u.wb;
    const wbCol = new Float32Array([wb[0], wb[3], wb[6], wb[1], wb[4], wb[7], wb[2], wb[5], wb[8]]);

    let target: Target | null = null;
    if (job.toCanvas) {
      if (this.canvas.width !== job.width || this.canvas.height !== job.height) {
        this.canvas.width = job.width;
        this.canvas.height = job.height;
      }
    } else {
      target = this.target(pl, 'out', job.width, job.height, false);
    }
    const lum = pl.targets.lum!.tex;
    const textures: [string, WebGLTexture][] = [
      ['uBase', pl.base!],
      ['uOrig', pl.src],
      ['uLum', lum],
      ['uTexBlur', pl.hasTexBlur ? pl.targets.texBlur!.tex : this.dummy],
      ['uLowBlur', pl.hasLow ? pl.targets.lowBlur!.tex : this.dummy],
      ['uLut', this.lut],
    ];
    this.run(this.programs.final, target, job.width, job.height, textures, (x) => {
      x.m3('uMap', map);
      x.v2('uTarget', job.width, job.height);
      x.b('uFlipY', job.toCanvas);
      x.v4('uOutMap', [job.region.x, job.region.y, 1 / job.outScale, 1 / job.outScale]);
      x.v2('uOutFull', job.outW, job.outH);
      x.b('uHasTexBlur', pl.hasTexBlur);
      x.b('uHasLow', pl.hasLow);
      x.m3('uWb', wbCol);
      x.f('uExpGain', u.exposureGain);
      x.f('uDehaze', u.dehaze);
      x.v3('uAtmos', u.atmos);
      x.f('uContrast', u.contrast);
      x.f('uHighlights', u.highlights);
      x.f('uShadows', u.shadows);
      x.f('uWhites', u.whites);
      x.f('uBlacks', u.blacks);
      x.f('uClarity', u.clarity);
      x.f('uTexture', u.texture);
      x.f('uVibrance', u.vibrance);
      x.f('uSaturation', u.saturation);
      x.b('uBw', u.bw);
      x.b('uHslOn', u.hsl.active);
      x.fv('uHslH', u.hsl.hue);
      x.fv('uHslS', u.hsl.sat);
      x.fv('uHslL', u.hsl.lum);
      x.b('uCurveOn', u.curveActive);
      x.b('uGradeOn', u.grading.active);
      x.v4('uGradeS', u.grading.shadow);
      x.v4('uGradeM', u.grading.mid);
      x.v4('uGradeH', u.grading.high);
      x.v4('uGradeG', u.grading.global);
      x.f('uGradeExp', u.grading.exponent);
      x.f('uGradeBal', u.grading.balanceExp);
      x.v4('uVig', [u.vignette.amount, u.vignette.midpoint, u.vignette.roundness, u.vignette.feather]);
      x.v3('uGrain', [u.grain.amount, u.grain.size, u.grain.roughness]);
      x.b('uEffects', job.effects !== false);
      x.f('uSplit', job.split ?? 0);
      x.b('uClip', Boolean(job.clip));
      x.b('uFillOutside', Boolean(job.fillOutside));
      x.b('uDither', true);
    });
  }

  /** Reads the last offscreen render of a pipeline (rows top to bottom). */
  readPixels(pl: Pipeline, out?: Uint8Array): Uint8Array {
    const t = pl.targets.out;
    if (!t) throw new Error('Nothing rendered');
    const gl = this.gl;
    const buf = out && out.length === t.w * t.h * 4 ? out : new Uint8Array(t.w * t.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}

interface UniformSetter {
  f: (name: string, v: number) => void;
  i: (name: string, v: number) => void;
  b: (name: string, v: boolean) => void;
  v2: (name: string, x: number, y: number) => void;
  v3: (name: string, v: ArrayLike<number>) => void;
  v4: (name: string, v: ArrayLike<number>) => void;
  fv: (name: string, v: number[]) => void;
  m3: (name: string, v: Float32Array) => void;
}
