import { describe, expect, it } from 'vitest';
import { deltaE, rgbToLab, hexToLab } from './colormath';
import { extractPalette, kmeans, mulberry32, pixelsToLab, sampleAverage, selectClusters } from './extract';

/** Builds an RGBA image whose pixels are noisy copies of `colors` (in equal bands). */
function synthImage(colors: [number, number, number][], width = 90, height = 60, noise = 6, seed = 3) {
  const rnd = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.min(colors.length - 1, Math.floor((x / width) * colors.length));
      const [r, g, b] = colors[band];
      const i = (y * width + x) * 4;
      data[i] = r + (rnd() - 0.5) * 2 * noise;
      data[i + 1] = g + (rnd() - 0.5) * 2 * noise;
      data[i + 2] = b + (rnd() - 0.5) * 2 * noise;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('k-means', () => {
  it('recovers well separated clusters', () => {
    const truth: [number, number, number][] = [
      [220, 30, 40],
      [30, 160, 70],
      [40, 60, 210],
    ];
    const img = synthImage(truth);
    const samples = pixelsToLab(img.data, img.width, img.height);
    const result = kmeans(samples.lab, 3, { seed: 11 });
    expect(result.centers).toHaveLength(3);
    for (const [r, g, b] of truth) {
      const lab = rgbToLab({ r, g, b });
      const nearest = Math.min(...result.centers.map((c) => deltaE(c, lab)));
      expect(nearest).toBeLessThan(3);
    }
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(samples.count);
    // each cluster holds roughly a third of the pixels
    result.counts.forEach((c) => expect(c / samples.count).toBeGreaterThan(0.25));
  });

  it('is deterministic for a seed', () => {
    const img = synthImage([
      [10, 10, 10],
      [250, 250, 250],
      [200, 120, 20],
      [20, 120, 200],
    ]);
    const s = pixelsToLab(img.data, img.width, img.height);
    const a = kmeans(s.lab, 4, { seed: 5 });
    const b = kmeans(s.lab, 4, { seed: 5 });
    expect(a.centers).toEqual(b.centers);
  });

  it('handles fewer points than clusters', () => {
    const pts = new Float64Array([50, 0, 0, 60, 10, 10]);
    const r = kmeans(pts, 5);
    expect(r.centers.length).toBe(2);
  });
});

describe('pixel sampling', () => {
  it('skips transparent pixels', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 10]);
    const s = pixelsToLab(data, 3, 1);
    expect(s.count).toBe(1);
  });
  it('averages a neighbourhood', () => {
    const data = new Uint8ClampedArray(3 * 3 * 4).fill(255);
    expect(sampleAverage(data, 3, 3, 1, 1)).toBe('#ffffff');
  });
});

describe('palette extraction with moods', () => {
  const colors: [number, number, number][] = [
    [15, 15, 20], // near black
    [240, 240, 235], // near white
    [230, 40, 30], // vivid red
    [130, 130, 120], // muted gray
    [40, 70, 200], // vivid blue
    [110, 90, 70], // muted brown
  ];
  const img = synthImage(colors, 120, 40, 4);

  it('returns real pixels with positions', () => {
    const out = extractPalette(img.data, img.width, img.height, { count: 5, mood: 'balanced' });
    expect(out).toHaveLength(5);
    out.forEach((c) => {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(img.width);
      expect(c.y).toBeLessThan(img.height);
    });
  });

  it('dark mood puts the darkest cluster first', () => {
    const out = extractPalette(img.data, img.width, img.height, { count: 3, mood: 'dark' });
    expect(hexToLab(out[0].hex).l).toBeLessThan(15);
  });

  it('colorful mood prefers chromatic colors over neutrals', () => {
    const out = extractPalette(img.data, img.width, img.height, { count: 2, mood: 'colorful' });
    out.forEach((c) => expect(Math.hypot(c.lab.a, c.lab.b)).toBeGreaterThan(40));
  });

  it('muted mood prefers low chroma colors', () => {
    const out = extractPalette(img.data, img.width, img.height, { count: 2, mood: 'muted' });
    out.forEach((c) => expect(Math.hypot(c.lab.a, c.lab.b)).toBeLessThan(25));
  });

  it('selection keeps clusters distinct', () => {
    const centers = [hexToLab('#ff0000'), hexToLab('#fe0101'), hexToLab('#0000ff')];
    const picked = selectClusters(centers, [100, 100, 10], 2, 'balanced');
    expect(picked).toContain(2);
  });
});
