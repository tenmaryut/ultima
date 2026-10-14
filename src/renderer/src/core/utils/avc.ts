/* H.264 levels for exports (pure: no DOM, no mediabunny). */

/**
 * Bitrate assumed when picking an H.264 level for quality-based exports: those run at a constant quantizer, so
 * their real bitrate is not known up front. A level that allows more than the stream uses is harmless.
 */
export const QUALITY_MODE_BITRATE = 50_000_000;

/** H.264 levels: [level_idc, max frame size in macroblocks, max macroblocks per second, max bitrate (Main/High, bit/s)]. */
const AVC_LEVELS: readonly [number, number, number, number][] = [
  [30, 1620, 40_500, 10_000_000],
  [31, 3600, 108_000, 14_000_000],
  [32, 5120, 216_000, 20_000_000],
  [40, 8192, 245_760, 20_000_000],
  [41, 8192, 245_760, 50_000_000],
  [42, 8704, 522_240, 50_000_000],
  [50, 22_080, 589_824, 135_000_000],
  [51, 36_864, 983_040, 240_000_000],
  [52, 36_864, 2_073_600, 240_000_000],
  [60, 139_264, 4_177_920, 240_000_000],
  [61, 139_264, 8_355_840, 480_000_000],
  [62, 139_264, 16_711_680, 800_000_000],
];

/**
 * H.264 High profile codec string ("avc1.6400xx") whose level covers the frame size, the frame rate and the
 * bitrate. 1080p at 60 fps needs level 4.2; a level picked from the frame size alone would say 4.0, which
 * strict decoders and upload pipelines may treat as out of spec.
 */
export function avcCodecString(width: number, height: number, fps: number, bitrate: number): string {
  const frame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = frame * fps;
  const level = AVC_LEVELS.find(([, maxFrame, maxRate, maxBitrate]) => frame <= maxFrame && rate <= maxRate && bitrate <= maxBitrate)?.[0] ?? 62;
  return `avc1.6400${level.toString(16).padStart(2, '0')}`;
}
