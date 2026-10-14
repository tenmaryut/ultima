/* Small validators shared by the Video Editor's AI code (AI output is untrusted input). */

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Removes markup and control characters from AI text (it's drawn on canvas, never as HTML). */
export function plainText(v: unknown, max = 500): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i;
export const safeColor = (v: unknown): string | undefined => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : undefined);

/** Seconds with two decimals, as in the project summary. */
export const sec = (t: number) => `${t.toFixed(2)} s`;
