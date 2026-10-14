/* AI assistant protocol of the Video Editor: instructions, context and a validating executor (see ./ai). */

import { finite, isObj, plainText } from './ai/util';
import { clampNum } from './time';

export { VIDEO_AI_INSTRUCTIONS } from './ai/instructions';
export { describeProject, type DescribeContext } from './ai/describe';
export { applyAIActions, formatResults, findMedia, VIDEO_ACTION_TYPES, type AIApplyResult, type ActionResult, type EditorEffect, type ExecContext } from './ai/executor';
export { plainText } from './ai/util';

/* ------------------------- AI feature result parsing ------------------------ */

export interface VideoMeta {
  titles: string[];
  description: string;
  chapters: { time: number; title: string }[];
  tags: string[];
}

/** Validates the JSON returned for "Write titles & description". */
export function parseVideoMeta(data: unknown, duration: number): VideoMeta {
  const o = isObj(data) ? data : {};
  const titles = (Array.isArray(o.titles) ? o.titles : []).map((t) => plainText(t, 120)).filter(Boolean).slice(0, 8);
  const description = plainText(o.description, 5000);
  let chapters = (Array.isArray(o.chapters) ? o.chapters : [])
    .filter(isObj)
    .map((c) => ({ time: finite(c.time) ? clampNum(c.time, 0, Math.max(0, duration)) : NaN, title: plainText(c.title, 100) }))
    .filter((c) => Number.isFinite(c.time) && c.title)
    .sort((a, b) => a.time - b.time);
  chapters = chapters.filter((c, i) => i === 0 || c.time - chapters[i - 1].time >= 1);
  if (chapters.length && chapters[0].time > 0) chapters[0] = { ...chapters[0], time: 0 };
  const tags = (Array.isArray(o.tags) ? o.tags : []).map((t) => plainText(t, 40)).filter(Boolean).slice(0, 20);
  return { titles, description, chapters, tags };
}

/** "0:00 Intro" lines in YouTube chapter format. */
export function formatChapters(chapters: { time: number; title: string }[]): string {
  return chapters
    .map((c) => {
      const h = Math.floor(c.time / 3600);
      const m = Math.floor((c.time % 3600) / 60);
      const s = Math.floor(c.time % 60);
      const stamp = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
      return `${stamp} ${c.title}`;
    })
    .join('\n');
}

/** Validates a rough-cut answer: indices of transcript segments to remove. */
export function parseRoughCut(data: unknown, segmentCount: number): { remove: number[]; reason: string } {
  const o = isObj(data) ? data : {};
  const remove = [...new Set((Array.isArray(o.remove) ? o.remove : []).filter(finite).map((v) => Math.round(v)))]
    .filter((i) => i >= 0 && i < segmentCount)
    .sort((a, b) => a - b);
  return { remove, reason: plainText(o.reason, 600) };
}
