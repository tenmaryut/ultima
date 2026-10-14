/**
 * WSOLA (waveform-similarity overlap-add) time stretching: changes the duration of audio
 * without changing its pitch. Used by the export mix for clips with a speed change and
 * "keep pitch" enabled. Pure (no Web Audio).
 *
 * `rate` > 1 plays faster (shorter output), < 1 slower (longer output).
 */
export function timeStretch(channels: Float32Array[], rate: number, sampleRate: number): Float32Array[] {
  if (!channels.length) return [];
  const inLen = channels[0].length;
  if (inLen === 0 || !Number.isFinite(rate) || rate <= 0) return channels.map((c) => c.slice());
  if (Math.abs(rate - 1) < 1e-3) return channels.map((c) => c.slice());
  const frame = Math.max(64, Math.round(sampleRate * 0.04) & ~1);
  const hs = frame >> 1;
  const ha = hs * rate;
  const tol = Math.max(4, Math.round(sampleRate * 0.009));
  const outLen = Math.max(1, Math.round(inLen / rate));
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const out = channels.map(() => new Float32Array(outLen + frame));
  const norm = new Float32Array(outLen + frame);
  const guide = channels.length === 1 ? channels[0] : mixMono(channels);
  let prev = 0;
  for (let k = 0; ; k++) {
    const outPos = k * hs;
    if (outPos >= outLen) break;
    const nominal = Math.round(k * ha);
    let pos = nominal;
    if (k > 0) pos = bestOffset(guide, prev + hs, nominal, tol, hs, frame);
    pos = Math.max(0, Math.min(pos, Math.max(0, inLen - frame)));
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < frame; i++) {
        const j = pos + i;
        dst[outPos + i] += (j < inLen ? src[j] : 0) * win[i];
      }
    }
    for (let i = 0; i < frame; i++) norm[outPos + i] += win[i];
    prev = pos;
  }
  return out.map((o) => {
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const n = norm[i];
      res[i] = n > 1e-3 ? o[i] / n : o[i];
    }
    return res;
  });
}

function mixMono(channels: Float32Array[]): Float32Array {
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < len; i++) out[i] *= k;
  return out;
}

/** Input position near `nominal` whose waveform best continues the previous frame. */
function bestOffset(guide: Float32Array, natural: number, nominal: number, tol: number, overlap: number, frame: number): number {
  const len = guide.length;
  let best = nominal;
  let bestScore = -Infinity;
  const limit = Math.min(overlap, len - natural);
  if (limit <= 8) return nominal;
  for (let d = -tol; d <= tol; d += 2) {
    const cand = nominal + d;
    if (cand < 0 || cand + frame > len) continue;
    let score = 0;
    for (let i = 0; i < limit; i += 4) score += guide[natural + i] * guide[cand + i];
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}
