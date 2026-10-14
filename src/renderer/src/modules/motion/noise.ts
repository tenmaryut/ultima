/** Deterministic smooth noise for procedural animation (wiggle). Same input → same output. */

/** Integer hash → [-1, 1]. */
export function hash1(i: number, seed: number): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** 1D value noise with smootherstep interpolation, roughly in [-1, 1]. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash1(i, seed);
  const b = hash1(i + 1, seed);
  return a + (b - a) * u;
}

/** Two octaves of noise (like wiggle(freq, amp) with its default octave settings), in [-1, 1]. */
export function fractalNoise(x: number, seed: number): number {
  return (noise1(x, seed) + 0.5 * noise1(x * 2 + 17.31, seed + 101)) / 1.5;
}

/**
 * Wiggle offset at time `t` for a wiggle active in [start, end]. The effect eases in and
 * out over a short ramp at both ends so it never jumps.
 */
export function wiggleOffset(t: number, frequency: number, amplitude: number, seed: number, start: number, end: number, channel = 0): number {
  if (t < start || t > end || amplitude === 0 || frequency <= 0) return 0;
  const ramp = Math.min(0.25, (end - start) / 4);
  let envelope = 1;
  if (ramp > 0) {
    const edge = Math.min(t - start, end - t) / ramp;
    if (edge < 1) envelope = edge * edge * (3 - 2 * edge);
  }
  return amplitude * envelope * fractalNoise(t * frequency, seed * 7 + channel * 1013);
}
