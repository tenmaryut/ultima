/**
 * Baseline TIFF decoder (browsers can't decode TIFF): 8/16-bit gray, gray+alpha, RGB and
 * RGBA; strips or tiles; chunky or planar; uncompressed, LZW, Deflate (zlib) and
 * PackBits; horizontal predictor. Returns 8-bit RGBA. Pure apart from the optional
 * DecompressionStream used for Deflate (available in browsers and Node 18+).
 */

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export class TiffError extends Error {}

interface Ifd {
  get(tag: number): number[] | undefined;
}

function reader(bytes: Uint8Array) {
  if (bytes.length < 8) throw new TiffError('Not a TIFF file');
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) throw new TiffError('Not a TIFF file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new TiffError('Not a TIFF file (BigTIFF is not supported)');
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
  const readIfd = (offset: number): { ifd: Ifd; next: number } => {
    if (offset + 2 > bytes.length) throw new TiffError('Corrupt TIFF (IFD offset)');
    const count = u16(offset);
    const map = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > bytes.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      const size = (sizes[type] ?? 1) * n;
      const at = size <= 4 ? e + 8 : u32(e + 8);
      if (at + size > bytes.length || n > 1 << 24) continue;
      const vals: number[] = [];
      for (let k = 0; k < n; k++) {
        if (type === 3 || type === 8) vals.push(u16(at + k * 2));
        else if (type === 4 || type === 9 || type === 13) vals.push(u32(at + k * 4));
        else if (type === 5) vals.push(u32(at + k * 8) / (u32(at + k * 8 + 4) || 1));
        else vals.push(bytes[at + k]);
      }
      map.set(tag, vals);
    }
    const nextAt = offset + 2 + count * 12;
    return { ifd: { get: (tag) => map.get(tag) }, next: nextAt + 4 <= bytes.length ? u32(nextAt) : 0 };
  };
  return { le, u32, readIfd };
}

/* --------------------------------- Codecs --------------------------------- */

export function packBitsDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let ip = 0;
  let op = 0;
  while (ip < input.length && op < expected) {
    const n = (input[ip++] << 24) >> 24;
    if (n >= 0) {
      const len = Math.min(n + 1, expected - op, input.length - ip);
      out.set(input.subarray(ip, ip + len), op);
      ip += n + 1;
      op += len;
    } else if (n !== -128) {
      const len = Math.min(1 - n, expected - op);
      out.fill(input[ip++], op, op + len);
      op += len;
    }
  }
  return out;
}

/** TIFF flavour of LZW (MSB-first codes, "early change"). */
export function lzwDecode(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    length[i] = 1;
  }
  let op = 0;
  let bitPos = 0;
  let codeLen = 9;
  let next = 258;
  let old = -1;
  const totalBits = input.length * 8;
  const read = (): number => {
    if (bitPos + codeLen > totalBits) return 257;
    let v = 0;
    for (let i = 0; i < codeLen; i++) {
      const bit = (input[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1;
      v = (v << 1) | bit;
    }
    bitPos += codeLen;
    return v;
  };
  const write = (code: number): number => {
    const len = length[code];
    let end = op + len - 1;
    let c = code;
    let first = 0;
    while (c >= 0) {
      if (end < expected) out[end] = suffix[c];
      first = suffix[c];
      end--;
      c = prefix[c];
    }
    op += len;
    return first;
  };
  while (op < expected) {
    const code = read();
    if (code === 257) break;
    if (code === 256) {
      codeLen = 9;
      next = 258;
      const first = read();
      if (first === 257) break;
      write(first);
      old = first;
      continue;
    }
    if (old < 0) {
      write(code);
      old = code;
      continue;
    }
    let firstByte: number;
    if (code < next) {
      firstByte = write(code);
    } else {
      // KwKwK case: string(old) + first(string(old))
      const start = op;
      write(old);
      firstByte = out[start] ?? 0;
      if (op < expected) out[op] = firstByte;
      op++;
    }
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = firstByte;
      length[next] = length[old] + 1;
      next++;
    }
    old = code;
    if (next >= (1 << codeLen) - 1 && codeLen < 12) codeLen++;
  }
  return out;
}

async function inflate(input: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> })
    .DecompressionStream;
  if (!DS) throw new TiffError('Deflate-compressed TIFF is not supported here');
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DS('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* --------------------------------- Decode --------------------------------- */

export async function decodeTiff(bytes: Uint8Array, maxPixels = 120_000_000): Promise<DecodedImage> {
  const r = reader(bytes);
  // pick the largest top-level image (skip reduced-resolution thumbnails)
  let offset = r.u32(4);
  let chosen: Ifd | null = null;
  let bestArea = 0;
  const visited = new Set<number>();
  while (offset && !visited.has(offset) && visited.size < 32) {
    visited.add(offset);
    const { ifd, next } = r.readIfd(offset);
    const area = (ifd.get(256)?.[0] ?? 0) * (ifd.get(257)?.[0] ?? 0);
    const subfile = ifd.get(254)?.[0] ?? 0;
    if (area > bestArea && !(subfile & 1 && chosen)) {
      chosen = ifd;
      bestArea = area;
    }
    offset = next;
  }
  if (!chosen) throw new TiffError('TIFF has no image');
  const ifd = chosen;
  const width = ifd.get(256)?.[0] ?? 0;
  const height = ifd.get(257)?.[0] ?? 0;
  if (!width || !height) throw new TiffError('TIFF has no image size');
  if (width * height > maxPixels) throw new TiffError('TIFF is too large');
  const bitsList = ifd.get(258) ?? [1];
  const bits = bitsList[0];
  const spp = ifd.get(277)?.[0] ?? 1;
  const compression = ifd.get(259)?.[0] ?? 1;
  const photometric = ifd.get(262)?.[0] ?? (spp >= 3 ? 2 : 1);
  const planar = ifd.get(284)?.[0] ?? 1;
  const predictor = ifd.get(317)?.[0] ?? 1;
  const sampleFormat = ifd.get(339)?.[0] ?? 1;
  const extra = ifd.get(338)?.[0];
  if (bits !== 8 && bits !== 16) throw new TiffError(`${bits}-bit TIFF is not supported (8 or 16-bit only)`);
  if (sampleFormat !== 1) throw new TiffError('Floating point TIFF is not supported');
  if (![0, 1, 2].includes(photometric)) throw new TiffError('Only grayscale and RGB TIFF files are supported (no CMYK / Lab / YCbCr)');
  if (![1, 5, 8, 32946, 32773].includes(compression)) throw new TiffError('Unsupported TIFF compression (use uncompressed, LZW or ZIP)');
  if (predictor !== 1 && predictor !== 2) throw new TiffError('Unsupported TIFF predictor');

  const bytesPerSample = bits / 8;
  const tiled = Boolean(ifd.get(322));
  const tileW = tiled ? ifd.get(322)![0] : width;
  const tileH = tiled ? (ifd.get(323)?.[0] ?? height) : (ifd.get(278)?.[0] ?? height);
  const offsets = (tiled ? ifd.get(324) : ifd.get(273)) ?? [];
  const counts = (tiled ? ifd.get(325) : ifd.get(279)) ?? [];
  const tilesAcross = tiled ? Math.ceil(width / tileW) : 1;
  const tilesDown = Math.ceil(height / tileH);
  const planes = planar === 2 ? spp : 1;
  const samplesPerChunkPixel = planar === 2 ? 1 : spp;

  // decoded samples, chunky, one value per sample
  const samples = bits === 16 ? new Uint16Array(width * height * spp) : new Uint8Array(width * height * spp);

  const decodeChunk = async (index: number, expected: number): Promise<Uint8Array> => {
    const off = offsets[index];
    const len = counts[index] ?? bytes.length - off;
    if (off === undefined || off >= bytes.length) return new Uint8Array(expected);
    const raw = bytes.subarray(off, Math.min(bytes.length, off + len));
    switch (compression) {
      case 1:
        return raw;
      case 5:
        return lzwDecode(raw, expected);
      case 32773:
        return packBitsDecode(raw, expected);
      default:
        return inflate(raw);
    }
  };

  for (let plane = 0; plane < planes; plane++) {
    for (let ty = 0; ty < tilesDown; ty++) {
      for (let tx = 0; tx < tilesAcross; tx++) {
        const index = plane * tilesAcross * tilesDown + ty * tilesAcross + tx;
        const rows = tiled ? tileH : Math.min(tileH, height - ty * tileH);
        const rowSamples = tileW * samplesPerChunkPixel;
        const expected = rows * rowSamples * bytesPerSample;
        const data = await decodeChunk(index, expected);
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let y = 0; y < rows; y++) {
          const iy = ty * tileH + y;
          if (iy >= height) break;
          // read the row, undo the predictor
          const row = bits === 16 ? new Uint16Array(rowSamples) : new Uint8Array(rowSamples);
          for (let i = 0; i < rowSamples; i++) {
            const at = (y * rowSamples + i) * bytesPerSample;
            if (at + bytesPerSample > data.length) break;
            row[i] = bits === 16 ? dv.getUint16(at, r.le) : data[at];
          }
          if (predictor === 2) {
            for (let i = samplesPerChunkPixel; i < rowSamples; i++) row[i] = (row[i] + row[i - samplesPerChunkPixel]) & (bits === 16 ? 0xffff : 0xff);
          }
          for (let x = 0; x < tileW; x++) {
            const ix = tx * tileW + x;
            if (ix >= width) break;
            const dst = (iy * width + ix) * spp;
            if (planar === 2) samples[dst + plane] = row[x];
            else for (let s = 0; s < spp; s++) samples[dst + s] = row[x * spp + s];
          }
        }
      }
    }
  }

  // to RGBA8
  const out = new Uint8ClampedArray(width * height * 4);
  const max = bits === 16 ? 65535 : 255;
  const to8 = bits === 16 ? (v: number) => v / 257 : (v: number) => v;
  const hasAlpha = (photometric === 2 && spp >= 4) || (photometric <= 1 && spp >= 2);
  const alphaIndex = photometric === 2 ? 3 : 1;
  const premultiplied = extra === 1;
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * spp;
    let rr: number;
    let gg: number;
    let bb: number;
    if (photometric === 2) {
      rr = samples[s];
      gg = samples[s + 1];
      bb = samples[s + 2];
    } else {
      const v = photometric === 0 ? max - samples[s] : samples[s];
      rr = gg = bb = v;
    }
    let a = hasAlpha ? samples[s + alphaIndex] : max;
    if (premultiplied && a > 0 && a < max) {
      const k = max / a;
      rr = Math.min(max, rr * k);
      gg = Math.min(max, gg * k);
      bb = Math.min(max, bb * k);
    }
    if (!hasAlpha) a = max;
    const o = i * 4;
    out[o] = to8(rr);
    out[o + 1] = to8(gg);
    out[o + 2] = to8(bb);
    out[o + 3] = to8(a);
  }
  return { width, height, data: out };
}
