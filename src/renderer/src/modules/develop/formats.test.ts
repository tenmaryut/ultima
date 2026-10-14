import { describe, expect, it } from 'vitest';
import { findEmbeddedJpeg, jpegInfo, parseExifDate, parseJpegExif, readImageHeader, sniffFormat, tiffOrientation } from './exif';
import { decodeTiff, lzwDecode, packBitsDecode } from './tiff';
import { FIXTURES, fromBase64 } from './fixtures.test-data';

const expected = (x: number, y: number) => [x * 50, y * 100, (x * 37 + y * 11) % 256, 255];

describe('TIFF decoder', () => {
  for (const key of ['raw', 'tiff_lzw', 'packbits', 'tiff_adobe_deflate'] as const) {
    it(`decodes ${key}`, async () => {
      const img = await decodeTiff(fromBase64(FIXTURES[key]));
      expect([img.width, img.height]).toEqual([5, 3]);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) expect(Array.from(img.data.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4))).toEqual(expected(x, y));
    });
  }
  it('decodes 8-bit and 16-bit grayscale', async () => {
    const g = await decodeTiff(fromBase64(FIXTURES.gray));
    expect(g.data[4 * 3]).toBe(3 * 17);
    const g16 = await decodeTiff(fromBase64(FIXTURES.gray16));
    expect(g16.data[4 * 2]).toBe(Math.round((2 * 4000) / 257));
  });
  it('packbits and lzw primitives', () => {
    expect(Array.from(packBitsDecode(new Uint8Array([0xfe, 7, 1, 9, 9]), 5))).toEqual([7, 7, 7, 9, 9]);
    expect(lzwDecode(new Uint8Array([0x80, 0x01, 0x40]), 0).length).toBe(0);
  });
  it('rejects non-TIFF data', async () => {
    await expect(decodeTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow();
  });
});

describe('EXIF', () => {
  it('reads camera, exposure, date, lens and orientation from a JPEG', () => {
    const exif = parseJpegExif(fromBase64(FIXTURES.jpeg_exif))!;
    expect(exif.make).toBe('Canon');
    expect(exif.model).toBe('Canon EOS R5');
    expect(exif.iso).toBe(400);
    expect(exif.exposureTime).toBeCloseTo(1 / 500, 9);
    expect(exif.fNumber).toBeCloseTo(2.8, 9);
    expect(exif.focalLength).toBe(50);
    expect(exif.lens).toBe('RF50mm F1.8 STM');
    expect(exif.orientation).toBe(6);
    expect(exif.dateTime).toBe('2023:07:14 18:22:05');
    expect(exif.date).toBe(new Date(2023, 6, 14, 18, 22, 5).getTime());
  });
  it('returns null without EXIF', () => {
    expect(parseJpegExif(fromBase64(FIXTURES.jpeg_plain))).toBeNull();
  });
  it('parses dates', () => {
    expect(parseExifDate('2021:01:02 03:04:05')).toBe(new Date(2021, 0, 2, 3, 4, 5).getTime());
    expect(parseExifDate('garbage')).toBeUndefined();
  });
});

describe('image headers', () => {
  it('reads sizes (with EXIF orientation applied)', () => {
    const j = readImageHeader(fromBase64(FIXTURES.jpeg_exif));
    expect(j.format).toBe('jpeg');
    expect([j.width, j.height]).toEqual([16, 24]);
    const p = readImageHeader(fromBase64(FIXTURES.png));
    expect([p.format, p.width, p.height]).toEqual(['png', 9, 7]);
    const w = readImageHeader(fromBase64(FIXTURES.webp));
    expect([w.format, w.width, w.height]).toEqual(['webp', 9, 7]);
    const t = readImageHeader(fromBase64(FIXTURES.tiff_lzw));
    expect([t.format, t.width, t.height]).toEqual(['tiff', 5, 3]);
  });
  it('detects RAW by extension', () => {
    expect(sniffFormat(new Uint8Array(16), 'DSC_0001.NEF')).toBe('raw');
  });
  it('finds the end of a JPEG stream', () => {
    const bytes = fromBase64(FIXTURES.jpeg_plain);
    const info = jpegInfo(bytes, 0, true)!;
    expect(info.length).toBe(bytes.length);
    expect([info.width, info.height]).toEqual([40, 10]);
  });
});

/** Minimal TIFF container (like a RAW file) with a JPEG preview in IFD0. */
function fakeRaw(jpeg: Uint8Array, orientation = 6): Uint8Array {
  const entries = 3;
  const ifdSize = 2 + entries * 12 + 4;
  const jpegOffset = 8 + ifdSize + 16; // some padding
  const buf = new Uint8Array(jpegOffset + jpeg.length + 32);
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries, true);
  const entry = (i: number, tag: number, type: number, value: number) => {
    const o = 10 + i * 12;
    dv.setUint16(o, tag, true);
    dv.setUint16(o + 2, type, true);
    dv.setUint32(o + 4, 1, true);
    if (type === 3) dv.setUint16(o + 8, value, true);
    else dv.setUint32(o + 8, value, true);
  };
  entry(0, 0x0112, 3, orientation);
  entry(1, 0x0201, 4, jpegOffset);
  entry(2, 0x0202, 4, jpeg.length);
  buf.set(jpeg, jpegOffset);
  return buf;
}

describe('RAW previews', () => {
  it('finds the embedded JPEG through the IFD and reads the orientation', () => {
    const jpeg = fromBase64(FIXTURES.jpeg_plain);
    const raw = fakeRaw(jpeg);
    const found = findEmbeddedJpeg(raw, { scan: false })!;
    expect(found.length).toBe(jpeg.length);
    expect([found.width, found.height]).toEqual([40, 10]);
    expect(tiffOrientation(raw)).toBe(6);
  });
  it('falls back to scanning for JPEG markers', () => {
    const jpeg = fromBase64(FIXTURES.jpeg_plain);
    const blob = new Uint8Array(500 + jpeg.length);
    blob.set(jpeg, 300);
    const found = findEmbeddedJpeg(blob)!;
    expect(found.offset).toBe(300);
    expect(found.length).toBe(jpeg.length);
  });
});
