/**
 * FFT primitives for the audio editor (spectrogram, noise reduction, pitch shift,
 * convolution reverb). Pure TypeScript, no DOM — safe for workers and unit tests.
 */

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** In-place iterative radix-2 complex FFT of a fixed size. */
export class FFT {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(size: number) {
    if (!isPow2(size) || size < 2) throw new Error(`FFT size must be a power of two (got ${size})`);
    this.size = size;
    const half = size >> 1;
    this.cos = new Float64Array(half);
    this.sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    let bits = 0;
    while (1 << bits < size) bits++;
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** Forward transform (e^{-i...}). */
  forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, false);
  }

  /** Inverse transform including the 1/N scaling. */
  inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, true);
    const n = this.size;
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }

  private transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    // stage len = 2 (twiddle 1)
    for (let i = 0; i < n; i += 2) {
      const ar = re[i];
      const ai = im[i];
      const br = re[i + 1];
      const bi = im[i + 1];
      re[i] = ar + br;
      im[i] = ai + bi;
      re[i + 1] = ar - br;
      im[i + 1] = ai - bi;
    }
    // stage len = 4 (twiddles 1 and ∓i)
    if (n >= 4) {
      for (let i = 0; i < n; i += 4) {
        let ar = re[i];
        let ai = im[i];
        let br = re[i + 2];
        let bi = im[i + 2];
        re[i] = ar + br;
        im[i] = ai + bi;
        re[i + 2] = ar - br;
        im[i + 2] = ai - bi;
        ar = re[i + 1];
        ai = im[i + 1];
        br = re[i + 3];
        bi = im[i + 3];
        const xr = inverse ? -bi : bi;
        const xi = inverse ? br : -br;
        re[i + 1] = ar + xr;
        im[i + 1] = ai + xi;
        re[i + 3] = ar - xr;
        im[i + 3] = ai - xi;
      }
    }
    const cosT = this.cos;
    const sinT = this.sin;
    for (let len = 8; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let j = 0; j < half; j++) {
        const k = j * step;
        const wr = cosT[k];
        const wi = inverse ? sinT[k] : -sinT[k];
        for (let a = j; a < n; a += len) {
          const b = a + half;
          const rb = re[b];
          const ib = im[b];
          const xr = rb * wr - ib * wi;
          const xi = rb * wi + ib * wr;
          const ra = re[a];
          const ia = im[a];
          re[b] = ra - xr;
          im[b] = ia - xi;
          re[a] = ra + xr;
          im[a] = ia + xi;
        }
      }
    }
  }
}

/**
 * Real FFT of size N implemented with an N/2 complex FFT. The spectrum has N/2 + 1 bins
 * (DC .. Nyquist). Work buffers are owned by the instance, so one instance must not be
 * used concurrently (it never is: everything here is synchronous).
 */
export class RealFFT {
  readonly size: number;
  readonly bins: number;
  private readonly half: FFT;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;

  constructor(size: number) {
    if (!isPow2(size) || size < 4) throw new Error(`FFT size must be a power of two >= 4 (got ${size})`);
    this.size = size;
    this.bins = size / 2 + 1;
    const m = size / 2;
    this.half = new FFT(m);
    this.zr = new Float64Array(m);
    this.zi = new Float64Array(m);
    this.wr = new Float64Array(m);
    this.wi = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      this.wr[k] = Math.cos((2 * Math.PI * k) / size);
      this.wi[k] = -Math.sin((2 * Math.PI * k) / size);
    }
  }

  /**
   * Forward transform of `input` (length N, real) into `outRe`/`outIm` (length N/2 + 1).
   * `input` may be shorter than N (zero padded) when `inputLength` is given.
   */
  forward(input: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array, inputLength = this.size): void {
    const m = this.size / 2;
    const zr = this.zr;
    const zi = this.zi;
    const len = Math.min(inputLength, this.size);
    for (let i = 0; i < m; i++) {
      const a = 2 * i;
      zr[i] = a < len ? input[a] : 0;
      zi[i] = a + 1 < len ? input[a + 1] : 0;
    }
    this.half.forward(zr, zi);
    // k = 0 and k = m
    outRe[0] = zr[0] + zi[0];
    outIm[0] = 0;
    outRe[m] = zr[0] - zi[0];
    outIm[m] = 0;
    for (let k = 1; k < m; k++) {
      const ar = zr[k];
      const ai = zi[k];
      const br = zr[m - k];
      const bi = -zi[m - k]; // conj(Z[m-k])
      const er = (ar + br) * 0.5;
      const ei = (ai + bi) * 0.5;
      // (Z[k] - conj(Z[m-k])) / (2i)
      const dr = (ar - br) * 0.5;
      const di = (ai - bi) * 0.5;
      const or = di; // divide by i: (dr + i di)/i = di - i dr
      const oi = -dr;
      const wr = this.wr[k];
      const wi = this.wi[k];
      outRe[k] = er + (wr * or - wi * oi);
      outIm[k] = ei + (wr * oi + wi * or);
    }
  }

  /** Inverse transform of a half spectrum (N/2 + 1 bins) into `output` (length N), scaled by 1/N. */
  inverse(inRe: Float64Array, inIm: Float64Array, output: Float64Array | Float32Array): void {
    const m = this.size / 2;
    const zr = this.zr;
    const zi = this.zi;
    for (let k = 0; k < m; k++) {
      const ar = inRe[k];
      const ai = inIm[k];
      const br = inRe[m - k];
      const bi = -inIm[m - k]; // conj(X[m-k])
      const er = (ar + br) * 0.5;
      const ei = (ai + bi) * 0.5;
      const dr = (ar - br) * 0.5;
      const di = (ai - bi) * 0.5;
      // Zo = D * W^{-k}  (W^{-k} = conj(W^k))
      const wr = this.wr[k];
      const wi = -this.wi[k];
      const or = dr * wr - di * wi;
      const oi = dr * wi + di * wr;
      // Z = Ze + i Zo
      zr[k] = er - oi;
      zi[k] = ei + or;
    }
    // Z is now exactly the (unscaled) half-size FFT of the packed signal, so the scaled
    // half-size inverse returns x[2m] + i x[2m+1] — i.e. this is the exact inverse.
    this.half.inverse(zr, zi);
    for (let i = 0; i < m; i++) {
      output[2 * i] = zr[i];
      output[2 * i + 1] = zi[i];
    }
  }
}

/** Periodic Hann window (perfect overlap-add at 50% / 75% overlap). */
export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

/** Sum of w[n]^2 over all frames overlapping one sample, for overlap-add normalisation. */
export function overlapAddGain(window: Float64Array, hop: number): number {
  const n = window.length;
  let best = 0;
  // the sum is periodic in the hop; average over one period for robustness
  let total = 0;
  for (let offset = 0; offset < hop; offset++) {
    let s = 0;
    for (let i = offset; i < n; i += hop) s += window[i] * window[i];
    total += s;
    best = Math.max(best, s);
  }
  return total / hop || best || 1;
}
