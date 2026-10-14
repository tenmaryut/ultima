import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from './utils/color';
import { GRADIENTS, applyAppearance, gradientCss, gradientTheme, type ColorMode } from './themes';

const contrast = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!);
/** Panel and card backgrounds (--bg-1, --bg-2) of each mode in global.css. */
const PANELS: Record<ColorMode, string[]> = { dark: ['#18191e', '#202228'], light: ['#f6f7f9', '#ffffff'] };

describe('color gradients', () => {
  it('has unique ids, the default first and three valid stops each', () => {
    expect(GRADIENTS[0].id).toBe('ultima');
    expect(new Set(GRADIENTS.map((g) => g.id)).size).toBe(GRADIENTS.length);
    for (const g of GRADIENTS) {
      expect(g.stops).toHaveLength(3);
      for (const color of [...g.stops, ...Object.values(g.accent), ...Object.values(g.hover)]) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps white button text readable and accents visible on panels', () => {
    for (const g of GRADIENTS) {
      for (const mode of ['dark', 'light'] as const) {
        expect(contrast('#ffffff', g.accent[mode]), `${g.id} ${mode}: white on accent`).toBeGreaterThanOrEqual(4.5);
        for (const panel of PANELS[mode]) expect(contrast(g.accent[mode], panel), `${g.id} ${mode}: accent on ${panel}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('falls back to the default for unknown ids', () => {
    expect(gradientTheme('ocean').name).toBe('Ocean');
    expect(gradientTheme('neon').id).toBe('ultima');
    expect(gradientTheme(undefined).id).toBe('ultima');
  });

  it('matches the defaults in global.css, which paint before the app starts', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    const value = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6});`).exec(css)?.[1];
    expect([value('--grad-1'), value('--grad-2'), value('--grad-3')]).toEqual([...GRADIENTS[0].stops]);
    expect(value('--accent')).toBe(GRADIENTS[0].accent.dark);
  });

  it('describes a preview and applies itself to the root element', () => {
    const ocean = gradientTheme('ocean');
    expect(gradientCss(ocean, 90)).toBe('linear-gradient(90deg, #2563eb, #06b6d4, #2dd4bf)');
    const props = new Map<string, string>();
    const root = { dataset: {} as DOMStringMap, style: { setProperty: (k: string, v: string) => void props.set(k, v) } } as unknown as HTMLElement;
    applyAppearance(root, { mode: 'light', theme: ocean, accentMode: 'gradient', toolColor: null });
    expect(root.dataset).toEqual({ theme: 'light', gradient: 'ocean', accent: 'gradient' });
    expect(props.get('--grad-2')).toBe('#06b6d4');
    expect(props.get('--accent')).toBe('#1d4ed8');
    applyAppearance(root, { mode: 'dark', theme: ocean, accentMode: 'tools', toolColor: '#22c55e' });
    expect([props.get('--accent'), props.get('--accent-hover')]).toEqual(['#22c55e', '#22c55e']);
  });
});
