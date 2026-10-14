/**
 * Detectors for things in AI answers that other modules can open: SVG markup and hex
 * colors, plus Markdown → plain text for modules that take text. Pure — unit tested.
 * (SVG found here must still go through sanitizeSvg() before it is used.)
 */

/**
 * Returns the first complete <svg>…</svg> element in a text (inside a code fence or not),
 * handling nested <svg> elements. Null when there is none or it is not closed.
 */
export function detectSvg(text: string): string | null {
  const open = /<svg[\s>]/i;
  const start = text.search(open);
  if (start < 0) return null;
  const tag = /<(\/?)svg\b[^>]*?(\/?)>/gi;
  tag.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    const closing = m[1] === '/';
    const selfClosing = m[2] === '/';
    if (!closing && !selfClosing) depth++;
    else if (closing) depth--;
    else if (selfClosing && depth === 0) return text.slice(start, m.index + m[0].length);
    if (depth === 0) return text.slice(start, m.index + m[0].length);
    if (depth < 0) return null;
  }
  return null;
}

/**
 * Hex colors mentioned in a text, unique and in order, normalised to #rrggbb.
 * Six-digit codes always count; three-digit ones only when they contain a letter
 * (so "#123" issue numbers are ignored). HTML entities like &#123; are skipped.
 */
export function detectHexColors(text: string, max = 16): string[] {
  const out: string[] = [];
  const re = /(^|[^&\w])#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z_])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < max) {
    let hex = m[2].toLowerCase();
    if (hex.length === 3) {
      if (!/[a-f]/.test(hex)) continue;
      hex = [...hex].map((c) => c + c).join('');
    }
    const value = `#${hex}`;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** Simple Markdown → plain text (keeps line structure, list bullets and code contents). */
export function markdownToPlain(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code: string) => code.replace(/\n$/, ''))
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A short title for a conversation from its first message. */
export function titleFrom(text: string, max = 48): string {
  const line = markdownToPlain(text)
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
