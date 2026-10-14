/* TikTok · Reels · Shorts export plan (pure: no DOM, no mediabunny). */
/**
 * TikTok, Instagram Reels and YouTube Shorts re-encode every upload into their own formats; no file can stop
 * that. What keeps the result sharp is a clean source at the exact size they show (1080 px on the short side),
 * a constant 30 or 60 fps, H.264 High with plenty of bitrate and AAC audio.
 */
export type SocialFps = 30 | 60;
export const SOCIAL_FPS: readonly SocialFps[] = [30, 60];
export const SOCIAL_VIDEO_BITRATE: Record<SocialFps, number> = { 30: 16_000_000, 60: 24_000_000 };
export const SOCIAL_AUDIO_BITRATE = 320_000;

export interface SocialPlan {
  width: number;
  height: number;
  fps: SocialFps;
  videoBitrate: number;
  audioBitrate: number;
  /** 9:16, the full-screen shape of these apps. */
  vertical: boolean;
  megabytes: number;
}

export function socialPlan(projectWidth: number, projectHeight: number, fps: SocialFps, seconds: number, audio: boolean): SocialPlan {
  const k = 1080 / Math.max(1, Math.min(projectWidth, projectHeight));
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const width = even(projectWidth * k);
  const height = even(projectHeight * k);
  const videoBitrate = SOCIAL_VIDEO_BITRATE[fps];
  const audioBitrate = audio ? SOCIAL_AUDIO_BITRATE : 0;
  return {
    width,
    height,
    fps,
    videoBitrate,
    audioBitrate,
    vertical: height > width && Math.abs(width / height - 9 / 16) < 0.01,
    megabytes: ((videoBitrate + audioBitrate) * Math.max(0, seconds)) / 8 / 1_000_000,
  };
}

/** 60 fps when the project already runs at 50 fps or more, else 30. */
export function defaultSocialFps(projectFps: number): SocialFps {
  return projectFps >= 50 ? 60 : 30;
}
