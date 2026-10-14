/**
 * WAV (RIFF/WAVE) encoder and decoder working on planar Float32 channel data.
 * Pure TypeScript (no AudioBuffer), so it runs in tests, workers and on the main thread.
 */

export type WavFormat = 'pcm16' | 'pcm24' | 'float32';

export interface WavEncodeOptions {
  format: WavFormat;
  /** Add TPDF dither when reducing to 16-bit. */
  dither?: boolean;
}

export function encodeWavBytes(channels: Float32Array[], sampleRate: number, options: WavEncodeOptions): Uint8Array {
  const numChannels = Math.max(1, channels.length);
  const length = channels[0]?.length ?? 0;
  const bits = options.format === 'pcm16' ? 16 : options.format === 'pcm24' ? 24 : 32;
  const bytesPerSample = bits / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  if (44 + dataSize > 0xffffffff) throw new Error('The audio is too long for a WAV file (4 GB limit). Export a shorter range or a compressed format.');
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, options.format === 'float32' ? 3 : 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);

  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  let o = 44;
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (options.format === 'float32' && littleEndian) {
    // fast path: interleave straight into a typed view (offset 44 is 4-byte aligned)
    const f32 = new Float32Array(out.buffer, 44, length * numChannels);
    for (let c = 0; c < numChannels; c++) {
      const src = channels[c];
      if (!src) continue;
      for (let i = 0, j = c; i < length; i++, j += numChannels) f32[j] = src[i];
    }
  } else if (options.format === 'float32') {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        view.setFloat32(o, channels[c]?.[i] ?? 0, true);
        o += 4;
      }
    }
  } else if (options.format === 'pcm16' && littleEndian && !options.dither) {
    const i16 = new Int16Array(out.buffer, 44, length * numChannels);
    for (let c = 0; c < numChannels; c++) {
      const src = channels[c];
      if (!src) continue;
      for (let i = 0, j = c; i < length; i++, j += numChannels) {
        const v = Math.round(src[i] * 32768);
        i16[j] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
    }
  } else if (options.format === 'pcm16') {
    const dither = Boolean(options.dither);
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = (channels[c]?.[i] ?? 0) * 32768;
        if (dither) s += rand() - rand();
        let v = Math.round(s);
        if (v > 32767) v = 32767;
        else if (v < -32768) v = -32768;
        view.setInt16(o, v, true);
        o += 2;
      }
    }
  } else {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let v = Math.round((channels[c]?.[i] ?? 0) * 8388608);
        if (v > 8388607) v = 8388607;
        else if (v < -8388608) v = -8388608;
        out[o] = v & 0xff;
        out[o + 1] = (v >> 8) & 0xff;
        out[o + 2] = (v >> 16) & 0xff;
        o += 3;
      }
    }
  }
  return out;
}

export interface DecodedWav {
  sampleRate: number;
  channels: Float32Array[];
  bitsPerSample: number;
  float: boolean;
}

/** Returns true when the bytes start with a RIFF/WAVE (or RF64) header. */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return (tag === 'RIFF' || tag === 'RF64') && wave === 'WAVE';
}

export function decodeWavBytes(input: Uint8Array | ArrayBuffer): DecodedWav {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isWav(bytes)) throw new Error('Not a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number; blockAlign: number } | null = null;
  let dataStart = -1;
  let dataSize = 0;
  let ds64DataSize = -1;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    let size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'ds64' && size >= 16) {
      ds64DataSize = view.getUint32(body + 8, true) + view.getUint32(body + 12, true) * 4294967296;
    } else if (id === 'fmt ') {
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true); // extensible sub-format
      fmt = { format, channels, rate, bits, blockAlign };
    } else if (id === 'data') {
      dataStart = body;
      if (size === 0xffffffff && ds64DataSize >= 0) size = ds64DataSize;
      if (size === 0 || size === 0xffffffff || body + size > bytes.length) size = bytes.length - body;
      dataSize = size;
      break;
    }
    pos = body + size + (size & 1);
  }
  if (!fmt) throw new Error('WAV file has no format chunk');
  if (dataStart < 0) throw new Error('WAV file has no audio data');
  const { format, channels: count, rate, bits } = fmt;
  if (count < 1 || count > 32) throw new Error('Unsupported WAV channel count');
  if (rate < 1000 || rate > 768000) throw new Error('Unsupported WAV sample rate');
  const isFloat = format === 3;
  if (!(format === 1 || format === 3)) throw new Error(`Unsupported WAV encoding (format ${format})`);
  const bytesPer = bits / 8;
  if (![1, 2, 3, 4, 8].includes(bytesPer) || (isFloat && bytesPer !== 4 && bytesPer !== 8)) {
    throw new Error(`Unsupported WAV bit depth (${bits})`);
  }
  const blockAlign = fmt.blockAlign || count * bytesPer;
  const frames = Math.floor(dataSize / blockAlign);
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    const frameOff = dataStart + i * blockAlign;
    for (let c = 0; c < count; c++) {
      const o = frameOff + c * bytesPer;
      let v: number;
      if (isFloat) v = bytesPer === 4 ? view.getFloat32(o, true) : view.getFloat64(o, true);
      else if (bytesPer === 1) v = (bytes[o] - 128) / 128;
      else if (bytesPer === 2) v = view.getInt16(o, true) / 32768;
      else if (bytesPer === 3) {
        let x = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
        if (x & 0x800000) x -= 0x1000000;
        v = x / 8388608;
      } else v = view.getInt32(o, true) / 2147483648;
      channels[c][i] = Number.isFinite(v) ? v : 0;
    }
  }
  return { sampleRate: rate, channels, bitsPerSample: bits, float: isFloat };
}
