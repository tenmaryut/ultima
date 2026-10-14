import { formatSrtTime } from '../../core/utils/format';
import type { CaptionCue } from './types';

/* Pure SRT / WebVTT parsing and serialization (no DOM). */

const TIME_RE = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/;

/** "00:01:02,345", "01:02.345", "1:02:03.5" -> seconds (NaN when invalid). */
export function parseCueTime(text: string): number {
  const m = TIME_RE.exec(text.trim());
  if (!m) return NaN;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) / 1000 : 0;
  return h * 3600 + min * 60 + s + frac;
}

/** Removes simple markup (<i>, <b>, <c.class>, {\an8}) and decodes the few entities SRT/VTT use. */
export function cleanCueText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function normalize(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function parseBlocks(text: string, vtt: boolean): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = normalize(text).split(/\n{2,}/);
  for (const raw of blocks) {
    const lines = raw.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && !l.trim()));
    if (!lines.length) continue;
    if (vtt && /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0].trim())) {
      // a WEBVTT header may be followed directly by a cue without a blank line
      const arrow = lines.findIndex((l) => l.includes('-->'));
      if (!/^WEBVTT/.test(lines[0].trim()) || arrow < 0) continue;
      lines.splice(0, arrow);
    }
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const [a, rest] = lines[idx].split('-->');
    const start = parseCueTime(a);
    const end = parseCueTime((rest ?? '').trim().split(/\s+/)[0] ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const body = cleanCueText(lines.slice(idx + 1).join('\n'));
    if (!body) continue;
    cues.push({ start, end: Math.max(end, start + 0.05), text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function parseSrt(text: string): CaptionCue[] {
  return parseBlocks(text, false);
}

export function parseVtt(text: string): CaptionCue[] {
  return parseBlocks(text, true);
}

/** Detects the format from the header (or file name) and parses it. */
export function parseSubtitles(text: string, fileName = ''): CaptionCue[] {
  const head = normalize(text).trimStart();
  if (head.startsWith('WEBVTT') || /\.vtt$/i.test(fileName)) return parseVtt(text);
  return parseSrt(text);
}

export function serializeSrt(cues: CaptionCue[]): string {
  return (
    cues
      .filter((c) => c.text.trim())
      .map((c, i) => `${i + 1}\n${formatSrtTime(c.start, ',')} --> ${formatSrtTime(Math.max(c.end, c.start), ',')}\n${c.text.trim()}`)
      .join('\n\n') + '\n'
  );
}

export function serializeVtt(cues: CaptionCue[]): string {
  const body = cues
    .filter((c) => c.text.trim())
    .map((c) => `${formatSrtTime(c.start, '.')} --> ${formatSrtTime(Math.max(c.end, c.start), '.')}\n${c.text.trim().replace(/-->/g, '→')}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/**
 * Splits long cues (e.g. from speech-to-text) into readable pieces of at most `maxChars`
 * characters, distributing the time proportionally to the text length.
 */
export function splitLongCues(cues: CaptionCue[], maxChars = 84): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (text.length <= maxChars) {
      if (text) out.push({ ...cue, text });
      continue;
    }
    const words = text.split(' ');
    const chunks: string[] = [];
    let current = '';
    for (const w of words) {
      if (current && (current + ' ' + w).length > maxChars) {
        chunks.push(current);
        current = w;
      } else current = current ? `${current} ${w}` : w;
    }
    if (current) chunks.push(current);
    const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let t = cue.start;
    const span = cue.end - cue.start;
    chunks.forEach((chunk, i) => {
      const end = i === chunks.length - 1 ? cue.end : t + (span * chunk.length) / total;
      out.push({ start: t, end, text: chunk });
      t = end;
    });
  }
  return out;
}

/** Plain transcript with [mm:ss] stamps (for AI prompts). */
export function transcriptText(cues: CaptionCue[], maxChars = 16000): string {
  const lines: string[] = [];
  let size = 0;
  for (const c of cues) {
    const m = Math.floor(c.start / 60);
    const s = Math.floor(c.start % 60);
    const line = `[${m}:${String(s).padStart(2, '0')}] ${c.text.replace(/\s+/g, ' ')}`;
    size += line.length + 1;
    if (size > maxChars) {
      lines.push('[…]');
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
