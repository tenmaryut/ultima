import DOMPurify from 'dompurify';

/**
 * Sanitizes SVG markup (from AI answers or opened files) before it is inserted into the
 * DOM or parsed: removes scripts, event handlers, foreignObject and external references.
 */
export function sanitizeSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onbegin', 'onend'],
    ALLOW_DATA_ATTR: false,
  });
  // Drop external href/xlink:href (only allow in-document #refs and embedded data:image).
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === 'href' || name === 'xlink:href') {
        const v = attr.value.trim();
        if (!v.startsWith('#') && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(v)) el.removeAttribute(attr.name);
      }
      if (name === 'style' && /url\(\s*['"]?(?!#|data:image)/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return '';
  return new XMLSerializer().serializeToString(root);
}

/** Finds the first complete <svg>...</svg> block in a text answer (handles nested <svg>). */
export function extractSvg(text: string): string | null {
  const start = text.search(/<svg[\s>]/i);
  if (start < 0) return null;
  const tag = /<(\/?)svg\b[^>]*?(\/?)>/gi;
  tag.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    if (m[1] === '/') depth--;
    else if (m[2] !== '/') depth++;
    if (depth <= 0) return depth === 0 ? text.slice(start, m.index + m[0].length) : null;
  }
  return null;
}

/** Plain text only: strips all markup (for AI text that ends up in labels/layers). */
export function stripHtml(text: string): string {
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
