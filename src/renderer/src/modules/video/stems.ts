/*
 * Stem separation without AI (pure, unit tested): a streaming short-time Fourier transform splits the sound into
 * what is steady in time (harmonic: melody, chords, vocals) and what is short and broadband (percussive: drums, hits)
 * with median filters, and finds what sits in the middle of a stereo mix (usually the vocals) by comparing left and
 * right. Masks are applied to the spectrum and the sound is put back together by overlap-add, so the stems add up to
 * the original. (Demucs, when installed, does this with a neural network instead — better, but slower.)
 */

export type StemKind = 'instrumental' | 'vocals' | 'drums' | 'melody';

export const STEMS: { id: StemKind; label: string }[] = [
  { id: 'instrumental', label: 'Remove vocals (instrumental)' },
  { id: 'vocals', label: 'Vocals only' },
  { id: 'drums', label: 'Drums only' },
  { id: 'melody', label: 'Remove drums' },
];

export const isStemKind = (v: unknown): v is StemKind => v === 'instrumental' || v === 'vocals' || v === 'drums' || v === 'melody';

export interface StemPcm {
  sampleRate: number;
  channels: Float32Array[];
}

/** In-place radix-2 FFT of (re, im); `inverse` without the 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Median of the first `n` values of `a` (sorts them in place; n is small). */
function median(a: Float64Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > v) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = v;
  }
  return a[n >> 1];
}

/** 0 below `a`, 1 above `b`, smooth in between. */
const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How alike the two channels are (1 = the same: mono), from their correlation. */
export function stereoSimilarity(pcm: StemPcm): number {
  if (pcm.channels.length < 2) return 1;
  const [l, r] = pcm.channels;
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < l.length; i += 4) {
    lr += l[i] * r[i];
    ll += l[i] * l[i];
    rr += r[i] * r[i];
  }
  return ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
}

export interface SeparateOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** One stem of the sound (same length and channels). Vocals need stereo: on mono sound they throw. */
export async function separate(pcm: StemPcm, stem: StemKind, o: SeparateOptions = {}): Promise<StemPcm> {
  const sr = pcm.sampleRate;
  const chs = pcm.channels;
  const len = chs[0]?.length ?? 0;
  const C = chs.length;
  if ((stem === 'vocals' || stem === 'instrumental') && (C < 2 || stereoSimilarity(pcm) > 0.995)) {
    throw new Error('This sound is mono: vocals can only be told apart in stereo music. Install Demucs for mono sound (Settings → Local creative tools).');
  }
  const N = sr > 60000 ? 4096 : 2048;
  const hop = N / 4;
  const bins = N / 2 + 1;
  const R = 8; // median half-width (frames over time, bins over frequency)
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  // Hann² summed over hops of N/4 is 1.5: the overlap-add divides it out
  const norm = 1 / (1.5 * N);
  const out = chs.map(() => new Float32Array(len));
  const frames = Math.ceil((len + N) / hop);
  // a ring of the last 2R+1 frames: spectra of each channel, and their mixed magnitude
  const D = 2 * R + 1;
  const ringRe = Array.from({ length: D }, () => chs.map(() => new Float64Array(bins)));
  const ringIm = Array.from({ length: D }, () => chs.map(() => new Float64Array(bins)));
  const ringMag = Array.from({ length: D }, () => new Float64Array(bins));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const tmp = new Float64Array(D);
  const H = new Float64Array(bins);
  const mask = new Float64Array(bins);
  const binHz = sr / N;

  const analyse = (f: number, slot: number) => {
    const start = f * hop - N / 2;
    ringMag[slot].fill(0);
    for (let c = 0; c < C; c++) {
      const x = chs[c];
      for (let i = 0; i < N; i++) {
        const s = start + i;
        re[i] = s >= 0 && s < len ? x[s] * win[i] : 0;
        im[i] = 0;
      }
      fft(re, im);
      const rr = ringRe[slot][c];
      const ii = ringIm[slot][c];
      for (let k = 0; k < bins; k++) {
        rr[k] = re[k];
        ii[k] = im[k];
        ringMag[slot][k] += Math.hypot(re[k], im[k]) / C;
      }
    }
  };

  const synthesise = (f: number, slot: number) => {
    const mag = ringMag[slot];
    // steady in time (harmonic) against short in time (percussive), over the 2R+1 frames around this one
    for (let k = 0; k < bins; k++) {
      for (let d = 0; d < D; d++) tmp[d] = ringMag[d][k];
      H[k] = median(tmp, D);
    }
    for (let k = 0; k < bins; k++) {
      let n = 0;
      for (let j = Math.max(0, k - R); j <= Math.min(bins - 1, k + R); j++) tmp[n++] = mag[j];
      const P = median(tmp, n);
      const perc = (P * P) / (H[k] * H[k] + P * P + 1e-20);
      if (stem === 'drums') mask[k] = perc;
      else if (stem === 'melody') mask[k] = 1 - perc;
      else {
        // the middle of the stereo mix, harmonic, in the voice's range: the vocals
        const lr = ringRe[slot][0][k] * ringRe[slot][1][k] + ringIm[slot][0][k] * ringIm[slot][1][k];
        const pl = ringRe[slot][0][k] ** 2 + ringIm[slot][0][k] ** 2;
        const pr = ringRe[slot][1][k] ** 2 + ringIm[slot][1][k] ** 2;
        const centre = smooth((2 * lr) / (pl + pr + 1e-20), 0.6, 0.95);
        const hz = k * binHz;
        const band = smooth(hz, 110, 200) * (1 - smooth(hz, 6500, 9500));
        const vocal = centre * band * (1 - perc);
        mask[k] = stem === 'vocals' ? vocal : 1 - vocal;
      }
    }
    const start = f * hop - N / 2;
    for (let c = 0; c < C; c++) {
      const rr = ringRe[slot][c];
      const ii = ringIm[slot][c];
      for (let k = 0; k < bins; k++) {
        re[k] = rr[k] * mask[k];
        im[k] = ii[k] * mask[k];
      }
      // the mirror half of a real signal's spectrum
      for (let k = bins; k < N; k++) {
        re[k] = re[N - k];
        im[k] = -im[N - k];
      }
      fft(re, im, true);
      const y = out[c];
      for (let i = 0; i < N; i++) {
        const s = start + i;
        if (s >= 0 && s < len) y[s] += re[i] * win[i] * norm;
      }
    }
  };

  // frame f is analysed into slot f % D; frame f − R is put back once the R frames after it are known
  for (let f = 0; f < frames + R; f++) {
    if (f < frames) analyse(f, f % D);
    else {
      // past the end: silence
      const slot = f % D;
      ringMag[slot].fill(0);
      for (let c = 0; c < C; c++) {
        ringRe[slot][c].fill(0);
        ringIm[slot][c].fill(0);
      }
    }
    const g = f - R;
    if (g >= 0) synthesise(g, g % D);
    if (f % 64 === 63) {
      if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      o.onProgress?.(Math.min(1, f / (frames + R)));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  o.onProgress?.(1);
  return { sampleRate: sr, channels: out };
}

/** 16-bit WAV bytes of a sound. */
export function encodeWav(p: StemPcm): Uint8Array {
  const C = p.channels.length;
  const n = p.channels[0]?.length ?? 0;
  const data = n * C * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, C, true);
  v.setUint32(24, p.sampleRate, true);
  v.setUint32(28, p.sampleRate * C * 2, true);
  v.setUint16(32, C * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++) {
      const s = Math.max(-1, Math.min(1, p.channels[c][i]));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
