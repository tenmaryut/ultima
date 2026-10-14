import type { AIImage } from '@shared/ai-types';

/** Most pictures one request carries (the CLI adapters pass on at most eight). */
export const MAX_AI_IMAGES = 8;

const range = (first: number, last: number) => (first === last ? `Image ${first}` : `Images ${first}–${last}`);

/**
 * The pictures sent with a request — the canvas snapshot first, then groups of the module's own
 * pictures (e.g. frames of every clip) — and the lines that tell the AI what each one shows.
 */
export function attachedImages(snapshot: AIImage | null | undefined, groups: { images: AIImage[]; note: string }[] = []): { images: AIImage[]; note: string } {
  const images: AIImage[] = snapshot ? [snapshot] : [];
  const lines: string[] = [];
  if (snapshot) lines.push('Image 1: a snapshot of the current canvas.');
  for (const g of groups) {
    const room = MAX_AI_IMAGES - images.length;
    const take = g.images.slice(0, Math.max(0, room));
    if (!take.length) continue;
    lines.push(`${range(images.length + 1, images.length + take.length)}: ${g.note || 'more pictures of the document.'}`);
    images.push(...take);
  }
  if (snapshot && images.length === 1) return { images, note: 'A snapshot of the current canvas is attached.' };
  return { images, note: lines.join('\n') };
}
