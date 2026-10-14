import { describe, expect, it } from 'vitest';
import { QUALITY_MODE_BITRATE, avcCodecString } from './avc';

describe('H.264 level', () => {
  it('covers the frame rate, not only the frame size', () => {
    expect(avcCodecString(1080, 1920, 30, 16_000_000)).toBe('avc1.640028'); // 4.0
    expect(avcCodecString(1080, 1920, 60, 24_000_000)).toBe('avc1.64002a'); // 4.2
    expect(avcCodecString(1920, 1080, 60, 12_000_000)).toBe('avc1.64002a');
    expect(avcCodecString(1280, 720, 30, 5_000_000)).toBe('avc1.64001f'); // 3.1
    expect(avcCodecString(3840, 2160, 30, 40_000_000)).toBe('avc1.640033'); // 5.1
    expect(avcCodecString(3840, 2160, 60, 40_000_000)).toBe('avc1.640034'); // 5.2
  });

  it('leaves room for quality-based exports, whose bitrate is not known up front', () => {
    expect(avcCodecString(1920, 1080, 30, QUALITY_MODE_BITRATE)).toBe('avc1.640029'); // 4.1
    expect(avcCodecString(1920, 1080, 60, QUALITY_MODE_BITRATE)).toBe('avc1.64002a');
  });
});
