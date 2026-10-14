import { describe, expect, it } from 'vitest';
import { attachedImages, MAX_AI_IMAGES } from './attachments';

const img = (name: string) => ({ mime: 'image/jpeg', base64: 'AA==', name });

describe('attached images', () => {
  it('keeps the old sentence for a lone snapshot', () => {
    expect(attachedImages(img('s'))).toEqual({ images: [img('s')], note: 'A snapshot of the current canvas is attached.' });
    expect(attachedImages(null)).toEqual({ images: [], note: '' });
  });

  it('numbers the snapshot and each group of pictures', () => {
    const r = attachedImages(img('s'), [
      { images: [img('a'), img('b')], note: 'frame sheets.' },
      { images: [img('c')], note: 'the moments you asked for.' },
    ]);
    expect(r.images.map((i) => i.name)).toEqual(['s', 'a', 'b', 'c']);
    expect(r.note).toBe('Image 1: a snapshot of the current canvas.\nImages 2–3: frame sheets.\nImage 4: the moments you asked for.');
    expect(attachedImages(null, [{ images: [img('a')], note: 'x' }]).note).toBe('Image 1: x');
  });

  it('never sends more pictures than the AI tools accept', () => {
    const many = Array.from({ length: 12 }, (_, i) => img(String(i)));
    expect(attachedImages(img('s'), [{ images: many, note: 'n' }]).images).toHaveLength(MAX_AI_IMAGES);
  });
});
