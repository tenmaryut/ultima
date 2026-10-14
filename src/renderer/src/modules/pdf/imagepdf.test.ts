import { describe, expect, it } from 'vitest';
import { imagePlacement, jpegOrientation, PAGE_SIZES } from './imagepdf';

function jpegWithOrientation(o: number): Uint8Array {
  // SOI, APP1 (Exif, big endian TIFF, one IFD entry: 0x0112 orientation)
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, 0xff, 0xda, 0x00, 0x02]);
}

describe('jpegOrientation', () => {
  it('reads the EXIF orientation tag', () => {
    expect(jpegOrientation(jpegWithOrientation(6))).toBe(6);
    expect(jpegOrientation(jpegWithOrientation(1))).toBe(1);
  });
  it('defaults to 1 for other data', () => {
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
  });
});

describe('imagePlacement', () => {
  it('uses the image size for "fit"', () => {
    expect(imagePlacement(960, 480, { size: 'fit', orientation: 'auto', margin: 0 })).toEqual({ pageW: 720, pageH: 360, x: 0, y: 0, width: 720, height: 360 });
  });
  it('centers inside A4 with margins and auto orientation', () => {
    const p = imagePlacement(2000, 1000, { size: 'a4', orientation: 'auto', margin: 36 });
    expect(p.pageW).toBeCloseTo(PAGE_SIZES.a4[1]);
    expect(p.pageH).toBeCloseTo(PAGE_SIZES.a4[0]);
    expect(p.width).toBeCloseTo(PAGE_SIZES.a4[1] - 72);
    expect(p.x).toBeCloseTo(36);
    expect(p.y).toBeCloseTo((p.pageH - p.height) / 2);
  });
  it('respects a forced portrait orientation', () => {
    const p = imagePlacement(2000, 1000, { size: 'letter', orientation: 'portrait', margin: 0 });
    expect([p.pageW, p.pageH]).toEqual([612, 792]);
    expect(p.width).toBeCloseTo(612);
  });
});
