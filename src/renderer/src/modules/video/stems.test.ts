import { describe, expect, it } from 'vitest';
import { encodeWav, fft, separate, stereoSimilarity, type StemPcm } from './stems';

const SR = 16000;
const seconds = 2;
const n = SR * seconds;

/** A steady tone, and short clicks four times a second (like a hi-hat). */
const tone = (hz: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const clicks = () => {
  const x = new Float32Array(n);
  let s = 7;
  for (let c = 0; c < seconds * 4; c++) {
    const at = Math.round((c + 0.5) * (SR / 4));
    for (let i = 0; i < 160; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      x[at + i] = 0.6 * ((s / 2 ** 32) * 2 - 1) * Math.exp(-i / 40);
    }
  }
  return x;
};
const add = (...xs: Float32Array[]) => Float32Array.from({ length: n }, (_, i) => xs.reduce((a, x) => a + x[i], 0));
/** Energy of a signal while the clicks sound, and between them. */
function energy(x: Float32Array) {
  let on = 0;
  let off = 0;
  for (let i = 0; i < n; i++) {
    const phase = (i % (SR / 4)) / (SR / 4);
    if (phase >= 0.5 && phase < 0.52) on += x[i] * x[i];
    else if (phase > 0.7 && phase < 0.9) off += x[i] * x[i];
  }
  return { on, off };
}
/** Energy at one frequency (correlation with a sine and a cosine). */
function at(x: Float32Array, hz: number) {
  let s = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    s += x[i] * Math.sin((2 * Math.PI * hz * i) / SR);
    c += x[i] * Math.cos((2 * Math.PI * hz * i) / SR);
  }
  return Math.hypot(s, c) / (n / 2);
}

describe('stem separation', () => {
  it('has a working FFT', () => {
    const re = Float64Array.from({ length: 8 }, (_, i) => Math.cos((2 * Math.PI * i) / 8));
    const im = new Float64Array(8);
    fft(re, im);
    expect(re[1]).toBeCloseTo(4, 9);
    expect(re[7]).toBeCloseTo(4, 9);
    fft(re, im, true);
    expect(re[2] / 8).toBeCloseTo(Math.cos(Math.PI / 2), 9);
  });

  it('splits drums from melody, and the two add up to the original', async () => {
    const mix = add(tone(440, 0.3), clicks());
    const pcm: StemPcm = { sampleRate: SR, channels: [mix] };
    const drums = (await separate(pcm, 'drums')).channels[0];
    const melody = (await separate(pcm, 'melody')).channels[0];
    // the drums keep the clicks and lose most of the tone; the melody the other way round
    expect(at(drums, 440)).toBeLessThan(0.3 * 0.25);
    expect(at(melody, 440)).toBeGreaterThan(0.3 * 0.85);
    // while a click sounds, most of its energy is in the drums
    const click = energy(clicks()).on;
    expect(energy(drums).on).toBeGreaterThan(0.6 * click);
    expect(Math.abs(energy(melody).on - energy(tone(440, 0.3)).on)).toBeLessThan(0.4 * click);
    let err = 0;
    let ref = 0;
    for (let i = 2048; i < n - 2048; i++) {
      err += (drums[i] + melody[i] - mix[i]) ** 2;
      ref += mix[i] ** 2;
    }
    expect(err / ref).toBeLessThan(1e-6);
  });

  it('finds the voice in the middle of a stereo mix', async () => {
    // the "voice" (330 Hz) in both channels, a guitar (520 Hz) only on the left, a bass (80 Hz) in the middle
    const voice = tone(330, 0.25);
    const guitar = tone(520, 0.25);
    const bass = tone(80, 0.25);
    const pcm: StemPcm = { sampleRate: SR, channels: [add(voice, guitar, bass), add(voice, bass)] };
    const vocals = await separate(pcm, 'vocals');
    const band = await separate(pcm, 'instrumental');
    const mid = (p: StemPcm, hz: number) => (at(p.channels[0], hz) + at(p.channels[1], hz)) / 2;
    expect(mid(vocals, 330)).toBeGreaterThan(0.25 * 0.8);
    expect(mid(vocals, 520)).toBeLessThan(0.25 * 0.15);
    // the bass is in the middle too, but below the voice's range: it stays with the music
    expect(mid(vocals, 80)).toBeLessThan(0.25 * 0.15);
    expect(mid(band, 330)).toBeLessThan(0.25 * 0.2);
    expect(at(band.channels[0], 520)).toBeGreaterThan(0.25 * 0.8);
    expect(mid(band, 80)).toBeGreaterThan(0.25 * 0.8);
  });

  it('refuses vocals on mono sound, and writes WAV', async () => {
    const mono: StemPcm = { sampleRate: SR, channels: [tone(300, 0.2), tone(300, 0.2)] };
    expect(stereoSimilarity(mono)).toBeGreaterThan(0.999);
    await expect(separate(mono, 'vocals')).rejects.toThrow(/mono/);
    const wav = encodeWav({ sampleRate: 8000, channels: [Float32Array.from([0, 1, -1]), Float32Array.from([0.5, 0, 0])] });
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    const v = new DataView(wav.buffer);
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint32(40, true)]).toEqual([2, 8000, 12]);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 16384, 32767]);
  });
});
