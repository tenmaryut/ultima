import { describe, expect, it } from 'vitest';
import { defaultSocialFps, socialPlan } from './social';

describe('TikTok · Reels · Shorts export', () => {
  it('renders 1080 px on the short side at a high bitrate', () => {
    const p = socialPlan(1080, 1920, 60, 60, true);
    expect(p).toMatchObject({ width: 1080, height: 1920, fps: 60, videoBitrate: 24_000_000, audioBitrate: 320_000, vertical: true });
    expect(p.megabytes).toBeCloseTo(182.4, 1);
    expect(socialPlan(2160, 3840, 30, 10, false)).toMatchObject({ width: 1080, height: 1920, videoBitrate: 16_000_000, audioBitrate: 0 });
    expect(socialPlan(720, 1280, 30, 10, true)).toMatchObject({ width: 1080, height: 1920 });
  });

  it('flags projects that are not 9:16', () => {
    expect(socialPlan(1920, 1080, 30, 10, true)).toMatchObject({ width: 1920, height: 1080, vertical: false });
    expect(socialPlan(1080, 1080, 30, 10, true).vertical).toBe(false);
  });

  it('defaults to 60 fps only for 50 fps and faster projects', () => {
    expect([24, 25, 30, 50, 60].map(defaultSocialFps)).toEqual([30, 30, 30, 60, 60]);
  });
});
