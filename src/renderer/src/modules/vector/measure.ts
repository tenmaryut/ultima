import { fontShorthand, setTextMeasurer, type FontSpec, type TextMeasurer } from './text';

let installed = false;

function canvasMeasurer(): TextMeasurer | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const metricsCache = new Map<string, { ascent: number; descent: number }>();
  return {
    width(text: string, font: FontSpec) {
      ctx.font = fontShorthand(font);
      return ctx.measureText(text).width;
    },
    metrics(font: FontSpec) {
      const key = fontShorthand(font);
      let m = metricsCache.get(key);
      if (!m) {
        ctx.font = key;
        const tm = ctx.measureText('Hg');
        const ascent = Number.isFinite(tm.fontBoundingBoxAscent) && tm.fontBoundingBoxAscent > 0 ? tm.fontBoundingBoxAscent : font.size * 0.9;
        const descent = Number.isFinite(tm.fontBoundingBoxDescent) && tm.fontBoundingBoxDescent > 0 ? tm.fontBoundingBoxDescent : font.size * 0.22;
        m = { ascent, descent };
        if (metricsCache.size > 500) metricsCache.clear();
        metricsCache.set(key, m);
      }
      return m;
    },
  };
}

/** Uses a 2D canvas to measure text exactly like the browser renders it. */
export function installCanvasMeasurer(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const m = canvasMeasurer();
  if (!m) return;
  setTextMeasurer(m);
  // fonts that finish loading later change the widths: reset the caches once
  void document.fonts?.ready.then(() => {
    const fresh = canvasMeasurer();
    if (fresh) setTextMeasurer(fresh);
  });
}
